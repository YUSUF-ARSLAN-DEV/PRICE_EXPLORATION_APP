"""Batch runner: gate -> fetch -> store raw -> parse -> publish -> account (plan 3.1, 3.2, 3.6)."""

import json
import logging
from dataclasses import dataclass
from typing import Any

from .adapters.base import SourceAdapter
from .config import Settings
from .db import Conn, connect
from .fetcher import BlockedError, CircuitBreaker, CircuitOpen, FetchError, PoliteFetcher
from .pipeline import PublishStats, dead_letter, publish_offers
from .store import ArtifactStore

log = logging.getLogger(__name__)


class SourceNotApproved(Exception):
    """The Source Registry does not allow this source to run (policy P2)."""


@dataclass
class BatchResult:
    batch_id: str
    status: str
    fetched: int
    stats: PublishStats
    error: str | None = None


def load_source(conn: Conn, source_id: str) -> dict[str, Any]:
    row = conn.execute("select * from sources where id = %s", (source_id,)).fetchone()
    if row is None:
        raise SourceNotApproved(f"unknown source {source_id}")
    return row


def assert_runnable(source: dict[str, Any]) -> None:
    """Policy P2, enforced in code: never run anything that is not green and live."""
    if source["kill_switch"]:
        raise SourceNotApproved(
            f"source {source['id']} is disabled (kill switch: {source['kill_switch_reason']})"
        )
    if source["legal_status"] != "green":
        raise SourceNotApproved(
            f"source {source['id']} is not approved (legal_status={source['legal_status']})"
        )


def make_fetcher(settings: Settings, source_id: str) -> PoliteFetcher:
    """Fetcher whose circuit breaker disables the source in the Source Registry when it trips."""

    def on_trip(reason: str) -> None:
        with connect(settings.database_url) as c:
            c.execute("select disable_source(%s, %s)", (source_id, f"circuit breaker: {reason}"))
        log.error("ALERT source %s disabled automatically: %s", source_id, reason)

    return PoliteFetcher(settings, breaker=CircuitBreaker(settings.breaker_threshold, on_trip))


def run_source(
    conn: Conn, adapter: SourceAdapter, store: ArtifactStore, settings: Settings
) -> BatchResult:
    source = load_source(conn, adapter.source_id)
    assert_runnable(source)  # raises before any network access

    row = conn.execute(
        "insert into ingestion_batches (source_id) values (%s) returning id", (source["id"],)
    ).fetchone()
    assert row is not None
    batch_id = str(row["id"])
    conn.commit()
    stats = PublishStats()
    fetched = 0
    try:
        artefacts = adapter.fetch()
        for art in artefacts:
            stored = store.put(str(source["id"]), batch_id, art.name, art.content)
            conn.execute(
                """insert into raw_artefacts
                     (batch_id, uri, source_url, content_type, sha256, size_bytes)
                   values (%s, %s, %s, %s, %s, %s)""",
                (
                    batch_id,
                    stored.uri,
                    art.source_url,
                    art.content_type,
                    stored.sha256,
                    stored.size_bytes,
                ),
            )
        parsed = adapter.parse(artefacts)
        fetched = parsed.total
        stats.valid, stats.invalid = len(parsed.offers), len(parsed.invalid)

        for raw, err in parsed.invalid:
            dead_letter(conn, batch_id, str(source["id"]), raw, err)

        too_bad = (
            fetched >= settings.invalid_ratio_min_rows
            and len(parsed.invalid) / fetched > settings.max_invalid_ratio
        )
        if too_bad:
            # Plan 3.6: likely a format change. Publish nothing and alert rather than load garbage.
            msg = (
                f"{len(parsed.invalid)}/{fetched} rows invalid (> {settings.max_invalid_ratio:.0%})"
            )
            return _finish(conn, batch_id, source, "failed", fetched, stats, msg)

        publish_offers(conn, source, batch_id, parsed.offers, settings, stats)
        return _finish(conn, batch_id, source, "succeeded", fetched, stats, None)
    except (BlockedError, CircuitOpen) as exc:
        conn.rollback()
        return _finish(conn, batch_id, source, "aborted", fetched, stats, str(exc))
    except FetchError as exc:
        conn.rollback()
        return _finish(conn, batch_id, source, "failed", fetched, stats, str(exc))
    except Exception as exc:
        conn.rollback()
        _finish(conn, batch_id, source, "failed", fetched, stats, f"{type(exc).__name__}: {exc}")
        raise


def _finish(
    conn: Conn,
    batch_id: str,
    source: dict[str, Any],
    status: str,
    fetched: int,
    stats: PublishStats,
    error: str | None,
) -> BatchResult:
    conn.execute(
        """update ingestion_batches
              set status = %s::batch_status, finished_at = now(), rows_fetched = %s,
                  rows_valid = %s, rows_invalid = %s, rows_published = %s, rows_held = %s,
                  error = %s, stats = %s::jsonb
            where id = %s""",
        (
            status,
            fetched,
            stats.valid,
            stats.invalid,
            stats.published,
            stats.held,
            error,
            json.dumps(stats.as_json()),
            batch_id,
        ),
    )
    if status == "succeeded" and stats.published + stats.held > 0:
        conn.execute("update sources set last_ok_at = now() where id = %s", (source["id"],))
    conn.commit()
    log.info("batch %s %s: %s %s", batch_id, status, stats.as_json(), error or "")
    return BatchResult(batch_id, status, fetched, stats, error)

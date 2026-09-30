"""Scheduled housekeeping (plan 0.9, 3.2, 2.1): run daily by a cron job.

* ensure future price partitions exist
* delete raw artefacts past their 90-day retention (blob first, then mark the row)
* delete old dead letters (90 days)
* enforce personal-data retention (search history, erased-user tombstones)
"""

import logging
from typing import Any

from .db import Conn
from .store import ArtifactStore

log = logging.getLogger(__name__)


def purge_expired_artefacts(conn: Conn, store: ArtifactStore) -> int:
    rows = conn.execute(
        "select id, uri from raw_artefacts where deleted_at is null and expires_at < now()"
    ).fetchall()
    for row in rows:
        store.delete(row["uri"])
        conn.execute("update raw_artefacts set deleted_at = now() where id = %s", (row["id"],))
    conn.commit()
    return len(rows)


def run_maintenance(conn: Conn, store: ArtifactStore) -> dict[str, Any]:
    out: dict[str, Any] = {}
    row = conn.execute("select ensure_price_partitions(1, 3) as n").fetchone()
    assert row is not None
    out["partitions_created"] = row["n"]
    out["artefacts_deleted"] = purge_expired_artefacts(conn, store)
    row = conn.execute(
        "with d as (delete from dead_letters where created_at < now() - interval '90 days' "
        "returning 1) select count(*) as n from d"
    ).fetchone()
    assert row is not None
    out["dead_letters_deleted"] = row["n"]
    out["privacy_purge"] = {
        r["entity"]: r["rows_affected"]
        for r in conn.execute("select * from purge_expired_personal_data()").fetchall()
    }
    conn.commit()
    log.info("maintenance: %s", out)
    return out

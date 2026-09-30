"""Integration tests: real Postgres, real migrations, real batch runner."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from qarib_ingest.adapters.base import ParseResult, RawArtefact, SourceAdapter
from qarib_ingest.adapters.feed import CsvFeedAdapter
from qarib_ingest.batch import SourceNotApproved, make_fetcher, run_source
from qarib_ingest.cli import main as cli_main
from qarib_ingest.config import Settings
from qarib_ingest.db import Conn
from qarib_ingest.maintenance import run_maintenance
from qarib_ingest.store import LocalArtifactStore

from .conftest import LocalServer, Seeded, make_source


def write_csv(
    tmp_path: Path, rows: list[str], header: str = "sku,name,price,size,was_price,promo,branch"
) -> Path:
    p = tmp_path / f"feed-{uuid.uuid4().hex[:6]}.csv"
    p.write_text(header + "\n" + "\n".join(rows) + "\n", encoding="utf-8")
    return p


def run_csv(conn: Conn, s: Seeded, path: Path, settings: Settings, tmp_path: Path):  # type: ignore[no-untyped-def]
    store = LocalArtifactStore(tmp_path / "store")
    return run_source(conn, CsvFeedAdapter(s.source_id, path=path), store, settings)


def scalar(conn: Conn, sql: str, *params: object) -> object:
    row = conn.execute(sql, params).fetchone()  # type: ignore[arg-type,unused-ignore]
    assert row is not None
    return next(iter(row.values()))


# ---- happy path -------------------------------------------------------------------------------
def test_feed_batch_publishes_prices_and_keeps_an_audit_trail(
    conn: Conn, settings: Settings, tmp_path: Path
) -> None:
    s = make_source(conn)
    feed = write_csv(
        tmp_path,
        [
            "A1,Fresh Milk Full Fat,6.50,1L,7.25,Save 0.75,",
            "A2,حليب طازج,5.90,2 x 500ml,,,",
            "A3,Basmati Rice,32.00,5kg,,Buy 2 save 10%,",
        ],
    )
    res = run_csv(conn, s, feed, settings, tmp_path)
    assert res.status == "succeeded", res.error
    assert (res.fetched, res.stats.published, res.stats.invalid, res.stats.held) == (3, 3, 0, 0)
    assert res.stats.new_listings == 3

    assert (
        scalar(
            conn,
            "select count(*) from current_prices cp join retailer_products rp "
            "on rp.id = cp.retailer_product_id where rp.source_id = %s",
            s.source_id,
        )
        == 3
    )
    # new listings await matching (Phase 4): unmatched => not public
    assert (
        scalar(
            conn,
            "select count(*) from retailer_products where source_id = %s "
            "and match_status = 'review' and product_id is null",
            s.source_id,
        )
        == 3
    )
    promos = dict(
        (r["external_sku"], r["promo_type"])
        for r in conn.execute(
            "select rp.external_sku, cp.promo_type from current_prices cp "
            "join retailer_products rp on rp.id = cp.retailer_product_id where rp.source_id = %s",
            (s.source_id,),
        )
    )
    assert promos == {"A1": "discount", "A2": "none", "A3": "multibuy"}
    assert (
        scalar(
            conn,
            "select raw_name_normalised from retailer_products where external_sku = 'A2' "
            "and source_id = %s",
            s.source_id,
        )
        == "حليب طازج"
    )

    batch = conn.execute(
        "select * from ingestion_batches where id = %s", (res.batch_id,)
    ).fetchone()
    assert batch is not None and batch["status"] == "succeeded" and batch["rows_published"] == 3
    assert batch["finished_at"] is not None
    art = conn.execute(
        "select * from raw_artefacts where batch_id = %s", (res.batch_id,)
    ).fetchone()
    assert art is not None and art["size_bytes"] == feed.stat().st_size
    assert (art["expires_at"] - art["fetched_at"]).days == 90
    assert (
        scalar(conn, "select last_ok_at is not null from sources where id = %s", s.source_id)
        is True
    )


def test_reingesting_updates_the_same_listing_and_keeps_history(
    conn: Conn, settings: Settings, tmp_path: Path
) -> None:
    s = make_source(conn)
    run_csv(conn, s, write_csv(tmp_path, ["A1,Milk,6.50,1L,,,"]), settings, tmp_path)
    res = run_csv(conn, s, write_csv(tmp_path, ["A1,Milk 1L,6.75,1L,,,"]), settings, tmp_path)
    assert res.stats.new_listings == 0 and res.stats.published == 1
    assert (
        scalar(conn, "select count(*) from retailer_products where source_id = %s", s.source_id)
        == 1
    )
    assert scalar(conn, "select count(*) from prices where source_id = %s", s.source_id) == 2
    assert scalar(
        conn, "select price_qar from current_prices where source_id = %s", s.source_id
    ) == Decimal("6.75")


def test_matched_listing_keeps_its_product_link_when_reseen(
    conn: Conn, settings: Settings, tmp_path: Path
) -> None:
    s = make_source(conn)
    run_csv(conn, s, write_csv(tmp_path, ["A1,Milk,6.50,1L,,,"]), settings, tmp_path)
    cat = conn.execute(
        "insert into categories (slug, name_en, name_ar) values (%s,'c','c') returning id",
        ("c-" + uuid.uuid4().hex[:6],),
    ).fetchone()
    assert cat is not None
    prod = conn.execute(
        "insert into products (canonical_name_en, category_id, size_value, size_unit) "
        "values ('Milk', %s, 1, 'l') returning id",
        (cat["id"],),
    ).fetchone()
    assert prod is not None
    conn.execute(
        "update retailer_products set product_id = %s, match_status = 'manual' where source_id = %s",
        (prod["id"], s.source_id),
    )
    conn.commit()
    run_csv(conn, s, write_csv(tmp_path, ["A1,Milk renamed,6.60,1L,,,"]), settings, tmp_path)
    row = conn.execute(
        "select product_id, match_status from retailer_products where source_id = %s",
        (s.source_id,),
    ).fetchone()
    assert row is not None and row["product_id"] == prod["id"] and row["match_status"] == "manual"
    assert scalar(
        conn, "select unit_price_qar from current_prices where source_id = %s", s.source_id
    ) == Decimal("6.6")


# ---- policy gate (P2) -------------------------------------------------------------------------
class ExplodingAdapter(SourceAdapter):
    def fetch(self) -> list[RawArtefact]:
        raise AssertionError("fetch() must never be reached for an unapproved source")

    def parse(self, artefacts: list[RawArtefact]) -> ParseResult:
        raise AssertionError("unreachable")


@pytest.mark.parametrize("status", ["red", "amber", "disabled"])
def test_unapproved_sources_are_refused_before_any_io(
    conn: Conn, settings: Settings, tmp_path: Path, status: str
) -> None:
    s = make_source(conn, status=status, approval=None)
    with pytest.raises(SourceNotApproved, match="not approved"):
        run_source(conn, ExplodingAdapter(s.source_id), LocalArtifactStore(tmp_path), settings)
    assert (
        scalar(conn, "select count(*) from ingestion_batches where source_id = %s", s.source_id)
        == 0
    )


def test_kill_switched_source_is_refused(conn: Conn, settings: Settings, tmp_path: Path) -> None:
    s = make_source(conn)
    conn.execute("select disable_source(%s, 'takedown request from retailer')", (s.source_id,))
    conn.commit()
    with pytest.raises(SourceNotApproved, match="takedown request"):
        run_source(conn, ExplodingAdapter(s.source_id), LocalArtifactStore(tmp_path), settings)


def test_unknown_source_is_refused(conn: Conn, settings: Settings, tmp_path: Path) -> None:
    with pytest.raises(SourceNotApproved, match="unknown source"):
        run_source(
            conn, ExplodingAdapter(str(uuid.uuid4())), LocalArtifactStore(tmp_path), settings
        )


# ---- bad data ---------------------------------------------------------------------------------
def test_invalid_rows_become_dead_letters_and_good_rows_still_publish(
    conn: Conn, settings: Settings, tmp_path: Path
) -> None:
    s = make_source(conn)
    rows = ["G%d,Good %d,%d.50,1kg,,," % (i, i, i + 1) for i in range(1, 9)]
    rows += ["B1,Bad price,abc,1kg,,,", "B2,,4.00,1kg,,,"]  # 2/10 invalid = 20% < 30% threshold
    res = run_csv(conn, s, write_csv(tmp_path, rows), settings, tmp_path)
    assert res.status == "succeeded"
    assert (res.stats.published, res.stats.invalid) == (8, 2)
    dl = conn.execute(
        "select raw, error from dead_letters where batch_id = %s", (res.batch_id,)
    ).fetchall()
    assert len(dl) == 2 and all(d["error"] for d in dl)


def test_format_change_aborts_the_batch_and_publishes_nothing(
    conn: Conn, settings: Settings, tmp_path: Path
) -> None:
    s = make_source(conn)
    rows = [f"X{i},Item {i},oops,1kg,,," for i in range(10)]
    res = run_csv(conn, s, write_csv(tmp_path, rows), settings, tmp_path)
    assert res.status == "failed" and "invalid" in (res.error or "")
    assert scalar(conn, "select count(*) from prices where source_id = %s", s.source_id) == 0
    assert scalar(conn, "select count(*) from dead_letters where batch_id = %s", res.batch_id) == 10
    assert scalar(conn, "select last_ok_at is null from sources where id = %s", s.source_id) is True


@pytest.mark.parametrize("price", ["0", "0.00", "99999"])
def test_insane_prices_are_dead_lettered(
    conn: Conn, settings: Settings, tmp_path: Path, price: str
) -> None:
    s = make_source(conn)
    res = run_csv(
        conn,
        s,
        write_csv(tmp_path, [f"A1,Milk,{price},1L,,,", "A2,Ok,3.00,1L,,,"]),
        settings,
        tmp_path,
    )
    assert (res.stats.published, res.stats.invalid) == (1, 1)


def test_was_price_not_above_price_is_dropped_not_rejected(
    conn: Conn, settings: Settings, tmp_path: Path
) -> None:
    s = make_source(conn)
    res = run_csv(
        conn,
        s,
        write_csv(tmp_path, ["A1,Milk,6.50,1L,6.50,,", "A2,Tea,4.00,1kg,5.00,,"]),
        settings,
        tmp_path,
    )
    assert res.stats.published == 2 and res.stats.was_price_dropped == 1
    rows = {
        r["external_sku"]: r
        for r in conn.execute(
            "select rp.external_sku, cp.was_price_qar, cp.promo_type from current_prices cp "
            "join retailer_products rp on rp.id = cp.retailer_product_id where rp.source_id = %s",
            (s.source_id,),
        )
    }
    assert rows["A1"]["was_price_qar"] is None and rows["A1"]["promo_type"] == "none"
    assert float(rows["A2"]["was_price_qar"]) == 5.0 and rows["A2"]["promo_type"] == "discount"


def test_branch_hint_resolves_known_branch_else_default_price(
    conn: Conn, settings: Settings, tmp_path: Path
) -> None:
    s = make_source(conn)
    conn.execute(
        "insert into branches (retailer_id, name, city) values (%s, 'Al Wakra', 'Al Wakra')",
        (s.retailer_id,),
    )
    conn.commit()
    res = run_csv(
        conn,
        s,
        write_csv(
            tmp_path,
            ["A1,Milk,6.5,1L,,,al wakra", "A2,Tea,4,1kg,,,Unknown Store", "A3,Rice,9,1kg,,,"],
        ),
        settings,
        tmp_path,
    )
    assert res.stats.published == 3 and res.stats.unresolved_branches == 1
    with_branch = scalar(
        conn,
        "select count(*) from current_prices where source_id = %s and branch_id is not null",
        s.source_id,
    )
    assert with_branch == 1


# ---- outlier gate (3.6) -----------------------------------------------------------------------
def seed_history(conn: Conn, s: Seeded, sku: str, price: float, n: int = 3) -> str:
    rp = conn.execute(
        "insert into retailer_products (retailer_id, source_id, external_sku, raw_name) "
        "values (%s, %s, %s, 'x') returning id",
        (s.retailer_id, s.source_id, sku),
    ).fetchone()
    assert rp is not None
    for d in range(1, n + 1):
        conn.execute(
            "select record_price(%s, null, %s::numeric, null, 'none', null, true, now() - make_interval(days => %s::int), %s)",
            (rp["id"], price, d, s.source_id),
        )
    conn.commit()
    return str(rp["id"])


def test_big_price_jump_is_held_for_review_not_published(
    conn: Conn, settings: Settings, tmp_path: Path
) -> None:
    s = make_source(conn)
    rp = seed_history(conn, s, "A1", 10.0)
    res = run_csv(
        conn,
        s,
        write_csv(tmp_path, ["A1,Milk,30.00,1L,,,", "A2,Tea,4.00,1kg,,,"]),
        settings,
        tmp_path,
    )
    assert (res.stats.published, res.stats.held) == (1, 1)
    assert (
        scalar(conn, "select price_qar from current_prices where retailer_product_id = %s", rp)
        == 10
    )
    held = conn.execute(
        "select * from held_prices where retailer_product_id = %s", (rp,)
    ).fetchone()
    assert (
        held is not None and held["status"] == "pending" and float(held["reference_median"]) == 10.0
    )

    # a human approves it -> published through the normal gate
    conn.execute("select release_held_price(%s, 'reviewer@example.qa')", (held["id"],))
    conn.commit()
    assert (
        scalar(conn, "select price_qar from current_prices where retailer_product_id = %s", rp)
        == 30
    )
    assert scalar(conn, "select status from held_prices where id = %s", held["id"]) == "approved"
    with pytest.raises(Exception, match="already approved"):
        conn.execute("select release_held_price(%s, 'x')", (held["id"],))
    conn.rollback()


def test_small_moves_and_thin_history_are_not_held(
    conn: Conn, settings: Settings, tmp_path: Path
) -> None:
    s = make_source(conn)
    seed_history(conn, s, "A1", 10.0)  # 3 observations
    seed_history(conn, s, "A2", 10.0, n=2)  # too little history to judge
    res = run_csv(
        conn,
        s,
        write_csv(tmp_path, ["A1,Milk,14.00,1L,,,", "A2,Tea,40.00,1kg,,,"]),
        settings,
        tmp_path,
    )
    assert (res.stats.published, res.stats.held) == (2, 0)


# ---- circuit breaker -> Source Registry -------------------------------------------------------
def test_repeated_blocks_disable_the_source_in_the_registry(
    conn: Conn, settings: Settings, tmp_path: Path, server: LocalServer
) -> None:
    s = make_source(conn, method="partner_feed")
    server.add("/feed.csv", "forbidden", status=403)
    fetcher = make_fetcher(settings, s.source_id)
    store = LocalArtifactStore(tmp_path)

    def adapter() -> CsvFeedAdapter:
        return CsvFeedAdapter(s.source_id, url=server.base + "/feed.csv", fetcher=fetcher)

    for _ in range(3):
        res = run_source(conn, adapter(), store, settings)
        assert res.status == "aborted"
    row = conn.execute(
        "select kill_switch, kill_switch_reason from sources where id = %s", (s.source_id,)
    ).fetchone()
    assert (
        row is not None
        and row["kill_switch"] is True
        and "circuit breaker" in row["kill_switch_reason"]
    )
    audit = conn.execute(
        "select actor from audit_log where entity_id = %s and action = 'source.updated'",
        (s.source_id,),
    ).fetchall()
    assert audit, "disabling a source is audited"

    hits_before = len(server.requests)
    with pytest.raises(SourceNotApproved, match="circuit breaker"):
        run_source(conn, adapter(), store, settings)
    assert len(server.requests) == hits_before, "a disabled source generates no traffic"
    health = conn.execute(
        "select * from source_health where source_id = %s", (s.source_id,)
    ).fetchone()
    assert (
        health is not None
        and health["kill_switch"] is True
        and health["last_batch_status"] == "aborted"
    )


# ---- maintenance + health + CLI ---------------------------------------------------------------
def test_maintenance_purges_expired_artefacts_and_old_dead_letters(
    conn: Conn, settings: Settings, tmp_path: Path
) -> None:
    s = make_source(conn)
    store = LocalArtifactStore(tmp_path / "store")
    res = run_source(
        conn,
        CsvFeedAdapter(s.source_id, path=write_csv(tmp_path, ["A1,Milk,6.5,1L,,,", "B,,1,,,,"])),
        store,
        settings,
    )
    uri = str(scalar(conn, "select uri from raw_artefacts where batch_id = %s", res.batch_id))
    assert store.exists(uri)
    conn.execute(
        "update raw_artefacts set expires_at = now() - interval '1 day' where batch_id = %s",
        (res.batch_id,),
    )
    conn.execute(
        "update dead_letters set created_at = now() - interval '91 days' where batch_id = %s",
        (res.batch_id,),
    )
    conn.commit()

    out = run_maintenance(conn, store)
    assert out["artefacts_deleted"] >= 1 and out["dead_letters_deleted"] >= 1
    assert not store.exists(uri)
    assert (
        scalar(
            conn,
            "select deleted_at is not null from raw_artefacts where batch_id = %s",
            res.batch_id,
        )
        is True
    )
    assert "search_history" in out["privacy_purge"]


def test_source_health_view_reports_invalid_ratio_and_held(
    conn: Conn, settings: Settings, tmp_path: Path
) -> None:
    s = make_source(conn)
    seed_history(conn, s, "A1", 10.0)
    rows = (
        ["A1,Milk,50,1L,,,"]
        + [f"G{i},Good,{i + 1},1kg,,," for i in range(8)]
        + ["B1,Bad,abc,1kg,,,"]
    )
    run_csv(conn, s, write_csv(tmp_path, rows), settings, tmp_path)
    h = conn.execute("select * from source_health where source_id = %s", (s.source_id,)).fetchone()
    assert h is not None
    assert (
        h["last_batch_status"] == "succeeded" and h["rows_fetched"] == 10 and h["rows_invalid"] == 1
    )
    assert float(h["invalid_ratio"]) == 0.1 and h["held_pending"] == 1
    assert float(h["hours_since_ok"]) < 1


def test_cli_run_feed_and_refusal(
    pg_url: str,
    conn: Conn,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DATABASE_URL", pg_url)
    monkeypatch.setenv("INGEST_ARTEFACT_DIR", str(tmp_path / "a"))
    monkeypatch.delenv("AZURE_STORAGE_CONNECTION_STRING", raising=False)
    good, bad = make_source(conn), make_source(conn, status="red", approval=None)
    feed = write_csv(tmp_path, ["A1,Milk,6.5,1L,,,"])
    assert cli_main(["run-feed", "--source-id", good.source_id, "--file", str(feed)]) == 0
    assert "succeeded" in capsys.readouterr().out
    assert cli_main(["run-feed", "--source-id", bad.source_id, "--file", str(feed)]) == 3
    assert "REFUSED" in capsys.readouterr().err
    assert cli_main(["health"]) == 0
    assert cli_main(["maintenance"]) == 0


def test_timestamps_from_feed_are_respected(conn: Conn, settings: Settings, tmp_path: Path) -> None:
    s = make_source(conn)
    old = (datetime.now(UTC) - timedelta(days=3)).isoformat()
    feed = write_csv(
        tmp_path,
        [f"A1,Milk,6.5,1L,,,,{old}"],
        header="sku,name,price,size,was_price,promo,branch,observed_at",
    )
    run_csv(conn, s, feed, settings, tmp_path)
    age = scalar(
        conn,
        "select extract(epoch from now() - observed_at) / 86400 from current_prices where source_id = %s",
        s.source_id,
    )
    assert 2.9 < float(age) < 3.1  # type: ignore[arg-type]

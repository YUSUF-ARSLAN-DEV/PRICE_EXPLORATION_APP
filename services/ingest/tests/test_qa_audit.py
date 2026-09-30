"""The accuracy audit (plan 10.2): classification rules, CSV validation, and the launch gate."""

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from qarib_ingest.cli import main as cli_main
from qarib_ingest.config import Settings
from qarib_ingest.db import Conn
from qarib_ingest.qa import (
    AuditInputError,
    AuditReport,
    Observation,
    audit,
    classify,
    read_observations,
)

from .conftest import make_source
from .test_pipeline_db import run_csv, write_csv

DAY = date(2026, 9, 30)


def obs(price: str = "6.50", sku: str = "A1", retailer: str = "r1") -> Observation:
    return Observation(retailer, sku, Decimal(price), DAY)


def test_classification_rules() -> None:
    assert classify(obs("6.50"), Decimal("6.50"), DAY).verdict == "exact"
    assert classify(obs("6.50"), Decimal("6.60"), DAY).verdict == "close"  # +1.5 %
    assert classify(obs("6.50"), Decimal("7.50"), DAY).verdict == "wrong"  # +15 %
    assert classify(obs("6.50"), None, None).verdict == "missing"
    # we last confirmed the price 5 days before the observation: a freshness problem, not accuracy
    assert classify(obs("6.50"), Decimal("9.99"), date(2026, 9, 25)).verdict == "stale"
    # tolerance is configurable
    assert (
        classify(obs("6.50"), Decimal("6.60"), DAY, tolerance=Decimal("0.001")).verdict == "wrong"
    )


def test_accuracy_excludes_stale_and_counts_missing_against_us() -> None:
    r = AuditReport(
        [
            classify(obs("1.00", "a"), Decimal("1.00"), DAY),
            classify(obs("1.00", "b"), Decimal("1.02"), DAY),
            classify(obs("1.00", "c"), Decimal("2.00"), DAY),
            classify(obs("1.00", "d"), None, None),
            classify(obs("1.00", "e"), Decimal("9"), date(2026, 9, 1)),
        ]
    )
    assert r.counts() == {"exact": 1, "close": 1, "wrong": 1, "stale": 1, "missing": 1}
    assert r.accuracy == Decimal("0.5")  # 2 of 4 (stale excluded)
    assert not r.passes_gate


def test_gate_needs_enough_rows_and_retailers_not_just_accuracy() -> None:
    def rows(n: int, shops: int) -> AuditReport:
        return AuditReport(
            [classify(obs("1.00", str(i), f"r{i % shops}"), Decimal("1.00"), DAY) for i in range(n)]
        )

    assert rows(50, 3).accuracy == 1 and not rows(50, 3).passes_gate  # tiny sample proves nothing
    assert not rows(300, 1).passes_gate  # one shop proves nothing
    assert rows(300, 3).passes_gate


def test_csv_validation_is_strict(tmp_path: Path) -> None:
    def write(text: str) -> Path:
        p = tmp_path / "a.csv"
        p.write_text(text, encoding="utf-8")
        return p

    head = "retailer_slug,sku,observed_price,observed_on\n"
    with pytest.raises(AuditInputError, match="missing columns"):
        read_observations(write("retailer_slug,sku\nx,1\n"))
    with pytest.raises(AuditInputError, match="row 2"):
        read_observations(write(head + "x,1,abc,2026-09-30\n"))
    with pytest.raises(AuditInputError, match="row 2"):
        read_observations(write(head + "x,1,0,2026-09-30\n"))
    with pytest.raises(AuditInputError, match="row 2"):
        read_observations(write(head + "x,1,5,30/09/2026\n"))
    with pytest.raises(AuditInputError, match="no rows"):
        read_observations(write(head))
    good = read_observations(
        write("retailer_slug,sku,observed_price,observed_on,observer\nx,1,5.25,2026-09-30,me\n")
    )
    assert good[0].observed_price == Decimal("5.25") and good[0].observer == "me"


def test_audit_against_the_real_database_and_cli(
    pg_url: str,
    conn: Conn,
    settings: Settings,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DATABASE_URL", pg_url)
    monkeypatch.setenv("INGEST_ARTEFACT_DIR", str(tmp_path / "a"))
    monkeypatch.delenv("AZURE_STORAGE_CONNECTION_STRING", raising=False)
    s = make_source(conn)
    row = conn.execute("select slug from retailers where id = %s", (s.retailer_id,)).fetchone()
    assert row is not None
    slug = row["slug"]
    run_csv(
        conn,
        s,
        write_csv(tmp_path, ["A1,Fresh Milk,6.50,1L,,,", "A2,Basmati Rice,32.00,5kg,,,"]),
        settings,
        tmp_path,
    )
    today = date.today()
    rows = [
        Observation(slug, "A1", Decimal("6.50"), today),  # exact
        Observation(slug, "A2", Decimal("40.00"), today),  # wrong (-20 %)
        Observation(slug, "NOPE", Decimal("1.00"), today),  # missing
    ]
    report = audit(conn, rows)
    assert [f.verdict for f in report.findings] == ["exact", "wrong", "missing"]
    assert "Discrepancies" in report.markdown() and "NOPE" in report.markdown()

    csv_path = tmp_path / "field.csv"
    csv_path.write_text(
        "retailer_slug,sku,observed_price,observed_on\n" + f"{slug},A1,6.50,{today}\n",
        encoding="utf-8",
    )
    # 100 % accurate but far below the sample-size gate: the command must exit non-zero
    assert cli_main(["qa-audit", "--file", str(csv_path)]) == 1
    assert "launch gate: **NOT MET**" in capsys.readouterr().out
    bad = tmp_path / "bad.csv"
    bad.write_text("nonsense\n", encoding="utf-8")
    assert cli_main(["qa-audit", "--file", str(bad)]) == 2

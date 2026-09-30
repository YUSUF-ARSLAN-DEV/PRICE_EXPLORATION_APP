from datetime import date
from decimal import Decimal

import pytest

from qarib_ingest.batch import SourceNotApproved
from qarib_ingest.db import Conn
from qarib_ingest.flyer import parse_flyer_text, stage_flyer

from .conftest import make_source

FLYER = """
WEEKLY OFFERS  -  page 3
DemoFarm Fresh Milk 1L ........ QR 6.50   was QR 7.25
Basmati Rice 5kg  QAR 32   Buy 2 get 1
حليب ديمو فارم 1 لتر ... 5,90 ر.ق
Mineral Water 6 x 1.5L   9.00 QR
QR 12
Terms and conditions apply
"""


def test_parse_flyer_text_extracts_names_prices_was_and_promos() -> None:
    lines = parse_flyer_text(FLYER)
    by = {ln.name: ln for ln in lines}
    milk = by["DemoFarm Fresh Milk 1L"]
    assert milk.price == Decimal("6.50") and milk.was_price == Decimal("7.25")
    rice = by["Basmati Rice 5kg"]
    assert rice.price == Decimal("32.00") and rice.promo is not None and "Buy 2 get 1" in rice.promo
    assert by["حليب ديمو فارم 1 لتر"].price == Decimal("5.90")
    assert by["Mineral Water 6 x 1.5L"].price == Decimal("9.00")
    assert len(lines) == 4, "a bare price and footer text are not offers"


def test_was_price_not_invented_from_a_single_price() -> None:
    (ln,) = parse_flyer_text("Tea Bags 100pcs QR 12.50")
    assert ln.was_price is None and ln.price == Decimal("12.50")


def test_staged_offers_wait_for_a_human_then_publish_through_the_gate(conn: Conn) -> None:
    s = make_source(conn, method="flyer", approval="written-permission-2026-10-01")
    n = stage_flyer(
        conn, s.source_id, parse_flyer_text(FLYER), date(2026, 10, 1), date(2026, 10, 7), "p3"
    )
    assert n == 4
    cnt = conn.execute(
        "select count(*) as c from prices where source_id = %s", (s.source_id,)
    ).fetchone()
    assert cnt is not None and cnt["c"] == 0
    rows = conn.execute(
        "select id, raw_name from staged_offers where source_id = %s", (s.source_id,)
    ).fetchall()
    milk = next(r for r in rows if r["raw_name"].startswith("DemoFarm"))
    other = next(r for r in rows if r["raw_name"].startswith("Basmati"))

    conn.execute("select release_staged_offer(%s, 'reviewer@example.qa')", (milk["id"],))
    conn.execute("select reject_staged_offer(%s, 'reviewer@example.qa')", (other["id"],))
    conn.commit()
    cp = conn.execute(
        "select cp.price_qar, cp.was_price_qar, cp.promo_type, rp.match_status from current_prices cp "
        "join retailer_products rp on rp.id = cp.retailer_product_id where cp.source_id = %s",
        (s.source_id,),
    ).fetchall()
    assert (
        len(cp) == 1 and cp[0]["price_qar"] == Decimal("6.50") and cp[0]["promo_type"] == "discount"
    )
    assert cp[0]["match_status"] == "review"  # matching is a separate step
    with pytest.raises(Exception, match="already approved"):
        conn.execute("select release_staged_offer(%s, 'x')", (milk["id"],))
    conn.rollback()
    with pytest.raises(Exception, match="not pending"):
        conn.execute("select reject_staged_offer(%s, 'x')", (milk["id"],))
    conn.rollback()


def test_unapproved_source_cannot_stage(conn: Conn) -> None:
    s = make_source(conn, method="flyer", status="red", approval=None)
    with pytest.raises(SourceNotApproved):
        stage_flyer(conn, s.source_id, parse_flyer_text(FLYER))

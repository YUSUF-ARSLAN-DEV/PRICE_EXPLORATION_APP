"""Matching cascade against a real database."""

import uuid
from typing import Any

import pytest
from qarib_ingest.db import Conn

from qarib_matcher.embed import (
    DIM,
    AnthropicAdjudicator,
    NgramHashEmbedder,
    Verdict,
    cosine,
)
from qarib_matcher.engine import (
    backfill_embeddings,
    build_context,
    run_matching,
    sync_brand_dictionary,
)

CATS = ["fresh-milk", "milk", "rice", "juice", "soft-drinks"]


@pytest.fixture(autouse=True)
def base_data(conn: Conn) -> None:
    # each test starts from an empty catalogue (retailers/sources/categories are kept)
    conn.execute("truncate products, retailer_products, brands, audit_log cascade")
    for slug in CATS:
        conn.execute(
            "insert into categories (slug, name_en, name_ar) values (%s, %s, %s) on conflict do nothing",
            (slug, slug, slug),
        )
    sync_brand_dictionary(conn)


def new_source(conn: Conn) -> tuple[str, str]:
    slug = "m-" + uuid.uuid4().hex[:8]
    r = conn.execute(
        "insert into retailers (slug, name_en, type) values (%s, %s, 'supermarket') returning id",
        (slug, slug),
    ).fetchone()
    assert r is not None
    s = conn.execute(
        "insert into sources (retailer_id, method, legal_status) values (%s, 'manual', 'green') returning id",
        (r["id"],),
    ).fetchone()
    assert s is not None
    conn.commit()
    return str(r["id"]), str(s["id"])


def listing(
    conn: Conn, src: tuple[str, str], name: str, size: str | None = None, barcode: str | None = None
) -> str:
    row = conn.execute(
        """insert into retailer_products (retailer_id, source_id, external_sku, raw_name, raw_size, barcode)
           values (%s, %s, %s, %s, %s, %s) returning id""",
        (src[0], src[1], uuid.uuid4().hex, name, size, barcode),
    ).fetchone()
    assert row is not None
    conn.commit()
    return str(row["id"])


def get(conn: Conn, lid: str) -> dict[str, Any]:
    row = conn.execute("select * from retailer_products where id = %s", (lid,)).fetchone()
    assert row is not None
    return row


def count_products(conn: Conn) -> int:
    row = conn.execute("select count(*) as n from products").fetchone()
    assert row is not None
    return int(row["n"])


def product(conn: Conn, pid: Any) -> dict[str, Any]:
    row = conn.execute(
        "select p.*, b.name_en::text as brand, c.slug as category from products p "
        "left join brands b on b.id = p.brand_id join categories c on c.id = p.category_id where p.id = %s",
        (pid,),
    ).fetchone()
    assert row is not None
    return row


# ---- cascade ----------------------------------------------------------------------------------
def test_unknown_item_becomes_a_new_product_with_extracted_attributes(conn: Conn) -> None:
    src = new_source(conn)
    lid = listing(conn, src, "Almarai Fresh Milk Full Fat", "1L")
    stats = run_matching(conn, retailer_id=src[0])
    assert (stats.new, stats.errors) == (1, 0)
    lr = get(conn, lid)
    assert lr["match_status"] == "auto" and lr["product_id"] is not None
    p = product(conn, lr["product_id"])
    assert p["brand"] == "Almarai" and p["category"] == "fresh-milk"
    assert (float(p["size_value"]), p["size_unit"], p["pack_count"]) == (1.0, "l", 1)
    assert p["attributes"]["created_from"] == "auto-match"
    assert "fat:full" in p["attributes"]["variants"]


def test_same_item_from_another_retailer_auto_matches_the_existing_product(conn: Conn) -> None:
    a, b = new_source(conn), new_source(conn)
    la = listing(conn, a, "Almarai Fresh Milk Full Fat", "1L")
    run_matching(conn, retailer_id=a[0])
    lb = listing(conn, b, "ALMARAI FRESH MILK FULL FAT 1 Ltr")
    stats = run_matching(conn, retailer_id=b[0])
    assert stats.auto == 1 and stats.new == 0
    assert get(conn, la)["product_id"] == get(conn, lb)["product_id"]
    assert float(get(conn, lb)["match_score"]) >= 0.93


def test_different_size_or_brand_never_merge(conn: Conn) -> None:
    src = new_source(conn)
    ids = [
        listing(conn, src, "Almarai Fresh Milk Full Fat", "1L"),
        listing(conn, src, "Almarai Fresh Milk Full Fat", "2L"),
        listing(conn, src, "Baladna Fresh Milk Full Fat", "1L"),
    ]
    run_matching(conn, retailer_id=src[0])
    pids = {get(conn, i)["product_id"] for i in ids}
    assert len(pids) == 3


def test_gtin_match_beats_everything_and_new_products_keep_their_gtin(conn: Conn) -> None:
    a, b = new_source(conn), new_source(conn)
    la = listing(conn, a, "Completely Different Name", "5kg", barcode="6281007000017")
    run_matching(conn, retailer_id=a[0])
    p = product(conn, get(conn, la)["product_id"])
    assert p["gtin"] == "6281007000017"
    lb = listing(conn, b, "Basmati Rice Premium", "5 kg", barcode="6281007000017")
    stats = run_matching(conn, retailer_id=b[0])
    assert stats.gtin == 1
    assert get(conn, lb)["product_id"] == p["id"] and float(get(conn, lb)["match_score"]) == 1.0


def test_borderline_goes_to_review_queue_with_candidates(conn: Conn) -> None:
    a, b = new_source(conn), new_source(conn)
    la = listing(conn, a, "Almarai Fresh Milk", "1L")
    run_matching(conn, retailer_id=a[0])
    lb = listing(conn, b, "Almarai Fresh Milk Full Fat", "1L")  # one-sided fat => review
    stats = run_matching(conn, retailer_id=b[0])
    assert stats.review == 1
    lr = get(conn, lb)
    assert lr["match_status"] == "review" and lr["product_id"] is None
    cands = conn.execute(
        "select * from match_candidates where retailer_product_id = %s", (lb,)
    ).fetchall()
    assert len(cands) == 1 and cands[0]["product_id"] == get(conn, la)["product_id"]
    assert 0.80 <= float(cands[0]["score"]) < 0.93 and "name" in cands[0]["reasons"]

    # a human accepts it
    conn.execute("select decide_match(%s, %s, 'reviewer@example.qa')", (lb, cands[0]["product_id"]))
    conn.commit()
    lr = get(conn, lb)
    assert lr["match_status"] == "manual" and lr["product_id"] == cands[0]["product_id"]
    assert (
        conn.execute(
            "select 1 from match_candidates where retailer_product_id = %s", (lb,)
        ).fetchone()
        is None
    )
    audit = conn.execute(
        "select actor from audit_log where entity_id = %s and action = 'match.decided'", (lb,)
    ).fetchone()
    assert audit is not None and audit["actor"] == "reviewer@example.qa"


def test_review_items_are_not_rematched_into_duplicates_and_are_stable(conn: Conn) -> None:
    a, b = new_source(conn), new_source(conn)
    listing(conn, a, "Almarai Fresh Milk", "1L")
    run_matching(conn, retailer_id=a[0])
    listing(conn, b, "Almarai Fresh Milk Full Fat", "1L")
    run_matching(conn, retailer_id=b[0])
    before = count_products(conn)
    run_matching(conn, retailer_id=b[0])
    assert count_products(conn) == before, "a review item stays in review; no duplicate product"


def test_arabic_listing_lands_in_review_against_english_product(conn: Conn) -> None:
    a, b = new_source(conn), new_source(conn)
    listing(conn, a, "Almarai Fresh Milk Full Fat", "1L")
    run_matching(conn, retailer_id=a[0])
    lb = listing(conn, b, "حليب المراعي طازج كامل الدسم", "1 لتر")
    stats = run_matching(conn, retailer_id=b[0])
    assert stats.review == 1 and get(conn, lb)["match_status"] == "review"


# ---- restricted products ----------------------------------------------------------------------
@pytest.mark.parametrize(
    "name, slug",
    [
        ("Heineken Beer", "restricted-alcohol-tobacco"),
        ("Marlboro Cigarettes", "restricted-alcohol-tobacco"),
        ("Pork Sausages", "restricted-pork"),
    ],
)
def test_restricted_items_are_flagged_and_never_public(conn: Conn, name: str, slug: str) -> None:
    src = new_source(conn)
    lid = listing(conn, src, name, "330ml")
    run_matching(conn, retailer_id=src[0])
    p = product(conn, get(conn, lid)["product_id"])
    assert p["category"] == slug and p["restricted"] is True
    assert (
        conn.execute("select 1 from public_products where id = %s", (p["id"],)).fetchone() is None
    )


# ---- LLM tie-break ----------------------------------------------------------------------------
class FakeAdjudicator:
    def __init__(self, verdict: Verdict) -> None:
        self.verdict = verdict
        self.calls: list[tuple[str, str]] = []

    def adjudicate(self, listing: str, product: str) -> Verdict:
        self.calls.append((listing, product))
        return self.verdict


@pytest.mark.parametrize(
    "verdict, expect", [("same", "llm"), ("different", "new"), ("unsure", "review")]
)
def test_llm_adjudicator_only_sees_names_and_resolves_borderline(
    conn: Conn, verdict: Verdict, expect: str
) -> None:
    a, b = new_source(conn), new_source(conn)
    listing(conn, a, "Almarai Fresh Milk", "1L")
    run_matching(conn, retailer_id=a[0])
    listing(conn, b, "Almarai Fresh Milk Full Fat", "1L")
    adj = FakeAdjudicator(verdict)
    stats = run_matching(conn, build_context(conn, adjudicator=adj), retailer_id=b[0])
    assert getattr(stats, expect) == 1
    assert len(adj.calls) == 1 and all(isinstance(x, str) for x in adj.calls[0])


# ---- human tools ------------------------------------------------------------------------------
def test_reject_split_and_merge(conn: Conn) -> None:
    src = new_source(conn)
    l1 = listing(conn, src, "Almarai Fresh Milk Full Fat", "1L")
    l2 = listing(conn, src, "Baladna Fresh Milk Full Fat", "1L")
    run_matching(conn, retailer_id=src[0])
    p1, p2 = get(conn, l1)["product_id"], get(conn, l2)["product_id"]

    conn.execute("select split_match(%s, 'admin')", (l2,))
    conn.commit()
    assert get(conn, l2)["match_status"] == "review" and get(conn, l2)["product_id"] is None

    conn.execute("select reject_match(%s, 'admin')", (l2,))
    conn.commit()
    assert get(conn, l2)["match_status"] == "rejected"

    conn.execute(
        "update retailer_products set product_id = %s, match_status = 'manual' where id = %s",
        (p2, l2),
    )
    conn.execute("select merge_products(%s, %s, 'admin')", (p1, p2))
    conn.commit()
    assert get(conn, l2)["product_id"] == p1
    assert conn.execute("select 1 from products where id = %s", (p2,)).fetchone() is None
    acts = {
        r["action"]
        for r in conn.execute("select action from audit_log where actor = 'admin'").fetchall()
    }
    assert {"match.split", "match.rejected", "product.merged"} <= acts
    with pytest.raises(Exception, match="cannot merge"):
        conn.execute("select merge_products(%s, %s, 'admin')", (p1, p1))
    conn.rollback()


# ---- embeddings -------------------------------------------------------------------------------
def test_ngram_embedder_is_deterministic_normalised_and_spelling_tolerant() -> None:
    e = NgramHashEmbedder()
    v = e.embed("almarai fresh milk")
    assert len(v) == DIM and e.embed("almarai fresh milk") == v
    assert sum(x * x for x in v) == pytest.approx(1.0)
    assert cosine(v, e.embed("almarai fresh mlk")) > cosine(v, e.embed("basmati rice"))


def test_embeddings_are_stored_and_used_for_candidate_retrieval(conn: Conn) -> None:
    emb = NgramHashEmbedder()
    a, b = new_source(conn), new_source(conn)
    la = listing(conn, a, "Almarai Fresh Milk Full Fat", "1L")
    run_matching(conn, build_context(conn, embedder=emb), retailer_id=a[0])
    stored = conn.execute(
        "select embedding is not null as has from products where id = %s",
        (get(conn, la)["product_id"],),
    ).fetchone()
    assert stored is not None and stored["has"] is True
    conn.execute("update products set embedding = null")
    conn.commit()
    assert backfill_embeddings(conn, emb) >= 1
    listing(conn, b, "almarai fresh milk full fat", "1 Ltr")
    stats = run_matching(conn, build_context(conn, embedder=emb), retailer_id=b[0])
    assert stats.auto == 1


# ---- Anthropic adjudicator (fake client; never calls the live API) ----------------------------
class _Msg:
    def __init__(self, text: str) -> None:
        self.content = [type("B", (), {"text": text})()]


class _Client:
    def __init__(self, reply: str | Exception) -> None:
        self.reply = reply
        self.last: dict[str, Any] = {}
        self.messages = self

    def create(self, **kw: Any) -> _Msg:
        self.last = kw
        if isinstance(self.reply, Exception):
            raise self.reply
        return _Msg(self.reply)


@pytest.mark.parametrize(
    "reply, expected",
    [
        ('{"verdict": "same"}', "same"),
        ('Sure! {"verdict": "different"} done', "different"),
        ('{"verdict": "maybe"}', "unsure"),
        ("no json at all", "unsure"),
        ("", "unsure"),
    ],
)
def test_anthropic_adjudicator_parsing_is_strict(reply: str, expected: str) -> None:
    client = _Client(reply)
    adj = AnthropicAdjudicator(client)
    assert adj.adjudicate("Almarai Milk 1L", "Almarai Fresh Milk 1L") == expected
    prompt = client.last["messages"][0]["content"]
    assert "Almarai Milk 1L" in prompt and "@" not in prompt

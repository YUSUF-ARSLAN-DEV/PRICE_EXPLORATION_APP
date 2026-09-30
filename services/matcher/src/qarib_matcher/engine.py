"""Matching cascade (plan 4.1): GTIN -> brand+size+fuzzy -> embeddings -> optional LLM -> new product.

Safety: matching NEVER publishes anything by itself - public visibility is decided by the
`public_offers` view (matched + approved source + non-restricted). New products created from an
automatic match are flagged in `attributes.created_from` for audit.
"""

import json
import logging
from dataclasses import dataclass, field, replace
from typing import Any

from qarib_ingest.db import Conn
from qarib_ingest.normalize import normalize_search
from qarib_ingest.sizes import ParsedSize

from . import dictionaries as d
from .attributes import BrandIndex, ListingAttrs, extract
from .embed import Adjudicator, Embedder, cosine, to_pgvector
from .scoring import AUTO_THRESHOLD, REVIEW_THRESHOLD, PairScore, score_pair

log = logging.getLogger(__name__)


@dataclass
class MatchStats:
    gtin: int = 0
    auto: int = 0
    llm: int = 0
    review: int = 0
    new: int = 0
    errors: int = 0
    samples: list[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return self.gtin + self.auto + self.llm + self.review + self.new


@dataclass
class Context:
    brands: BrandIndex
    brand_name_by_id: dict[str, str]
    brand_id_by_name: dict[str, str]
    category_id_by_slug: dict[str, str]
    embedder: Embedder | None = None
    adjudicator: Adjudicator | None = None


def sync_brand_dictionary(conn: Conn, brands: dict[str, list[str]] | None = None) -> int:
    """Load the starter brand dictionary into brands + brand_aliases (idempotent)."""
    n = 0
    for canonical, aliases in (brands or d.BRANDS).items():
        row = conn.execute(
            "insert into brands (name_en) values (%s) "
            "on conflict (name_en) do update set name_en = excluded.name_en returning id",
            (canonical,),
        ).fetchone()
        assert row is not None
        for alias in {canonical, *aliases}:
            norm = normalize_search(alias)
            if norm:
                conn.execute(
                    "insert into brand_aliases (brand_id, alias) values (%s, %s) "
                    "on conflict (alias) do nothing",
                    (row["id"], norm),
                )
                n += 1
    conn.commit()
    return n


def build_context(
    conn: Conn, embedder: Embedder | None = None, adjudicator: Adjudicator | None = None
) -> Context:
    brands = conn.execute("select id, name_en::text as name from brands").fetchall()
    aliases: dict[str, list[str]] = {b["name"]: [] for b in brands}
    name_by_id = {str(b["id"]): b["name"] for b in brands}
    for a in conn.execute(
        "select b.name_en::text as name, ba.alias from brand_aliases ba join brands b on b.id = ba.brand_id"
    ).fetchall():
        aliases[a["name"]].append(a["alias"])
    cats = conn.execute("select id, slug from categories").fetchall()
    conn.commit()
    return Context(
        brands=BrandIndex(aliases),
        brand_name_by_id=name_by_id,
        brand_id_by_name={v: k for k, v in name_by_id.items()},
        category_id_by_slug={c["slug"]: str(c["id"]) for c in cats},
        embedder=embedder,
        adjudicator=adjudicator,
    )


def product_attrs(ctx: Context, p: dict[str, Any]) -> list[ListingAttrs]:
    """Attribute views of a canonical product (one per language) with size/brand from columns."""
    brand = ctx.brand_name_by_id.get(str(p["brand_id"])) if p["brand_id"] else None
    size: ParsedSize | None = None
    if p["size_value"] is not None and p["size_unit"] is not None:
        value, unit, pack = float(p["size_value"]), p["size_unit"], int(p["pack_count"])
        factor = 1000.0 if unit in ("g", "ml") else 1.0
        base = "kg" if unit in ("g", "kg") else "l" if unit in ("ml", "l") else "pc"
        size = ParsedSize(value, unit, pack, round(value * pack / factor, 4), base)  # type: ignore[arg-type]
    out: list[ListingAttrs] = []
    for name in (p["canonical_name_en"], p["canonical_name_ar"]):
        if name:
            a = extract(name, brands=ctx.brands, known_brand=brand)
            out.append(replace(a, size=size or a.size, brand=brand or a.brand))
    return out


def _candidates(conn: Conn, ctx: Context, attrs: ListingAttrs, query: str) -> list[dict[str, Any]]:
    brand_id = ctx.brand_id_by_name.get(attrs.brand) if attrs.brand else None
    params: dict[str, Any] = {"q": query, "brand": brand_id}
    sql = """
        select p.id, p.canonical_name_en, p.canonical_name_ar, p.brand_id, p.size_value, p.size_unit,
               p.pack_count, p.gtin, p.category_id, similarity(p.search_text, %(q)s) as sim
        from products p
        where p.search_text %% %(q)s or (%(brand)s::uuid is not null and p.brand_id = %(brand)s::uuid)
        order by sim desc limit 50"""
    rows = list(conn.execute(sql, params).fetchall())
    if ctx.embedder is not None:
        vec = to_pgvector(ctx.embedder.embed(query))
        seen = {r["id"] for r in rows}
        for r in conn.execute(
            """select p.id, p.canonical_name_en, p.canonical_name_ar, p.brand_id, p.size_value,
                      p.size_unit, p.pack_count, p.gtin, p.category_id, 0::float as sim
               from products p where p.embedding is not null
               order by p.embedding <=> %s::vector limit 15""",
            (vec,),
        ).fetchall():
            if r["id"] not in seen:
                rows.append(r)
    return rows


def _semantic(ctx: Context, query: str, product: dict[str, Any], conn: Conn) -> float | None:
    if ctx.embedder is None:
        return None
    row = conn.execute(
        "select embedding::text as e from products where id = %s", (product["id"],)
    ).fetchone()
    if not row or not row["e"]:
        return None
    other = [float(x) for x in row["e"].strip("[]").split(",")]
    return cosine(ctx.embedder.embed(query), other)


def _best_against_product(
    conn: Conn, ctx: Context, attrs: ListingAttrs, query: str, product: dict[str, Any]
) -> PairScore:
    sem = _semantic(ctx, query, product, conn)
    results = [score_pair(attrs, pa, sem) for pa in product_attrs(ctx, product)]
    ok = [r for r in results if r.ok]
    if ok:
        return max(ok, key=lambda r: r.score)
    return results[0] if results else PairScore(0.0, "no-views")


def _create_product(conn: Conn, ctx: Context, lr: dict[str, Any], attrs: ListingAttrs) -> str:
    name = lr["raw_name"].strip()
    is_ar = attrs.script == "ar"
    brand_id = ctx.brand_id_by_name.get(attrs.brand) if attrs.brand else None
    cat_id = (
        ctx.category_id_by_slug.get(attrs.category or "uncategorised")
        or ctx.category_id_by_slug["uncategorised"]
    )
    size = attrs.size
    search = normalize_search(" ".join(filter(None, [name, attrs.brand])))
    emb = to_pgvector(ctx.embedder.embed(search)) if ctx.embedder else None
    row = conn.execute(
        """insert into products (canonical_name_en, canonical_name_ar, brand_id, category_id, gtin,
                                 size_value, size_unit, pack_count, attributes, search_text, embedding)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::vector) returning id""",
        (
            name,
            name if is_ar else None,
            brand_id,
            cat_id,
            lr.get("barcode"),
            size.size_value if size else None,
            size.size_unit if size else None,
            size.pack_count if size else 1,
            json.dumps(
                {
                    "created_from": "auto-match",
                    "variants": sorted(f"{g}:{v}" for g, v in attrs.variants),
                    "source_listing": str(lr["id"]),
                },
                ensure_ascii=False,
            ),
            search,
            emb,
        ),
    ).fetchone()
    assert row is not None
    return str(row["id"])


def _link(conn: Conn, lr_id: str, product_id: str, status: str, score: float | None) -> None:
    conn.execute(
        "update retailer_products set product_id = %s, match_status = %s::match_status, match_score = %s "
        "where id = %s",
        (product_id, status, score, lr_id),
    )
    conn.execute("delete from match_candidates where retailer_product_id = %s", (lr_id,))


def match_listing(conn: Conn, ctx: Context, lr: dict[str, Any], stats: MatchStats) -> None:
    lr_id = str(lr["id"])
    # 1) exact GTIN
    if lr.get("barcode"):
        hit = conn.execute("select id from products where gtin = %s", (lr["barcode"],)).fetchone()
        if hit:
            _link(conn, lr_id, str(hit["id"]), "auto", 1.0)
            stats.gtin += 1
            return

    attrs = extract(lr["raw_name"], lr.get("raw_size"), ctx.brands)
    query = normalize_search(lr["raw_name"])

    # 2-3) candidates scored with hard constraints (+ optional embedding signal)
    scored: list[tuple[PairScore, dict[str, Any]]] = []
    for cand in _candidates(conn, ctx, attrs, query):
        s = _best_against_product(conn, ctx, attrs, query, cand)
        if s.ok and s.score >= 0.5:
            scored.append((s, cand))
    scored.sort(key=lambda t: -t[0].score)

    if scored and scored[0][0].score >= AUTO_THRESHOLD:
        s, cand = scored[0]
        _link(conn, lr_id, str(cand["id"]), "auto", s.score)
        stats.auto += 1
        return

    # 4) borderline -> optional LLM tie-break, otherwise human review
    border = [(s, c) for s, c in scored if s.score >= REVIEW_THRESHOLD]
    if border:
        if ctx.adjudicator is not None:
            s, cand = border[0]
            verdict = ctx.adjudicator.adjudicate(lr["raw_name"], cand["canonical_name_en"])
            if verdict == "same":
                _link(conn, lr_id, str(cand["id"]), "auto", s.score)
                stats.llm += 1
                return
            if verdict == "different":
                border = border[1:]
        if border:
            conn.execute("delete from match_candidates where retailer_product_id = %s", (lr_id,))
            for s, cand in border[:5]:
                conn.execute(
                    "insert into match_candidates (retailer_product_id, product_id, score, method, reasons) "
                    "values (%s, %s, %s, 'fuzzy', %s::jsonb)",
                    (lr_id, cand["id"], s.score, json.dumps(s.parts)),
                )
            stats.review += 1
            return

    # 5) nothing close enough -> new canonical product
    pid = _create_product(conn, ctx, lr, attrs)
    _link(conn, lr_id, pid, "auto", None)
    stats.new += 1


def run_matching(
    conn: Conn,
    ctx: Context | None = None,
    limit: int = 1000,
    retailer_id: str | None = None,
    embedder: Embedder | None = None,
    adjudicator: Adjudicator | None = None,
) -> MatchStats:
    """Match every unmatched listing (status 'review', no product)."""
    ctx = ctx or build_context(conn, embedder, adjudicator)
    stats = MatchStats()
    rows = conn.execute(
        """select id, retailer_id, raw_name, raw_size, barcode from retailer_products
           where match_status = 'review' and product_id is null
             and (%s::uuid is null or retailer_id = %s::uuid)
           order by created_at limit %s""",
        (retailer_id, retailer_id, limit),
    ).fetchall()
    conn.commit()
    for lr in rows:
        try:
            with conn.transaction():
                match_listing(conn, ctx, lr, stats)
        except Exception as exc:
            stats.errors += 1
            log.exception("matching failed for %s: %s", lr["id"], exc)
    conn.commit()
    log.info("matching done: %s", stats)
    return stats


def backfill_embeddings(conn: Conn, embedder: Embedder, batch: int = 500) -> int:
    rows = conn.execute(
        "select id, search_text from products where embedding is null limit %s", (batch,)
    ).fetchall()
    for r in rows:
        conn.execute(
            "update products set embedding = %s::vector where id = %s",
            (to_pgvector(embedder.embed(r["search_text"] or "")), r["id"]),
        )
    conn.commit()
    return len(rows)

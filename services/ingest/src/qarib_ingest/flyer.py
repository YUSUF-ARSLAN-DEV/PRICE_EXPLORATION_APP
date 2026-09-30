"""Flyer ingestion (plan 3.3 B): text of a weekly flyer -> STAGED offers awaiting human review.

Nothing from a flyer is published automatically: lines are written to `staged_offers` and a human
approves each one in the admin UI (`release_staged_offer`). Only FACTS are extracted (name, price,
promo) - never flyer artwork (policy P3).

PDF text extraction needs the optional `flyer` extra (pdfplumber). OCR for image-only flyers is NOT
implemented yet (plan 3.3 B remains partly open).
"""

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

from .batch import assert_runnable, load_source
from .db import Conn

_CUR = r"(?:QAR|QR|Q\.R\.?|ر\.?\s?ق\.?)"
_NUM = r"(\d{1,4}(?:[.,]\d{1,2})?)"
_PRICE = re.compile(rf"{_CUR}\s*{_NUM}|{_NUM}\s*{_CUR}", re.IGNORECASE)
_PROMO = re.compile(
    r"(buy\s*\d+\s*get\s*\d+|\d+\s*for\s*\d+|save\s*\d+%?|\d+\s*%\s*off|خصم\s*\d+%?)", re.I
)


@dataclass(frozen=True)
class FlyerLine:
    name: str
    price: Decimal
    was_price: Decimal | None
    promo: str | None
    raw: str


def _amount(text: str) -> Decimal:
    t = (
        text.replace(",", ".")
        if text.count(",") == 1 and "." not in text
        else text.replace(",", "")
    )
    return Decimal(t).quantize(Decimal("0.01"))


def parse_flyer_text(text: str) -> list[FlyerLine]:
    out: list[FlyerLine] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        prices = [_amount(m.group(1) or m.group(2)) for m in _PRICE.finditer(line)]
        prices = [p for p in prices if p > 0]
        if not prices:
            continue
        first = _PRICE.search(line)
        assert first is not None
        name = re.sub(r"[\s\-–—:.·•|]+$", "", line[: first.start()]).strip(" -–—:·•|")
        promo_m = _PROMO.search(line)
        name = _PROMO.sub("", name).strip(" -–—:·•|")
        if len(name) < 3:
            continue  # a price with no product name is noise (page numbers, footers, ...)
        price = min(prices)
        was = max(prices) if len(prices) > 1 and max(prices) > price else None
        out.append(FlyerLine(name, price, was, promo_m.group(1) if promo_m else None, line))
    return out


def extract_pdf_text(path: Path) -> str:
    try:
        import pdfplumber  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise RuntimeError(
            "PDF flyers need the optional extra: pip install 'qarib-ingest[flyer]'"
        ) from exc
    with pdfplumber.open(path) as pdf:
        return "\n".join((page.extract_text() or "") for page in pdf.pages)


def stage_flyer(
    conn: Conn,
    source_id: str,
    lines: list[FlyerLine],
    valid_from: date | None = None,
    valid_to: date | None = None,
    page_ref: str | None = None,
) -> int:
    """Stage parsed lines for human review. Refuses sources that are not approved (P2)."""
    source = load_source(conn, source_id)
    assert_runnable(source)
    for ln in lines:
        conn.execute(
            """insert into staged_offers (source_id, raw_name, price_qar, was_price_qar, promo_text,
                                          valid_from, valid_to, page_ref)
               values (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (source_id, ln.name, ln.price, ln.was_price, ln.promo, valid_from, valid_to, page_ref),
        )
    conn.commit()
    return len(lines)

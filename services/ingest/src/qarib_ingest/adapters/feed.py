"""Partner feed adapters (plan 3.3 A): CSV / JSON delivered as a file or from a feed URL.

Accepted columns (case-insensitive; aliases in COLUMN_ALIASES):
    sku, name, price  (required)
    size, was_price, promo, branch, url, barcode, observed_at, in_stock (optional)
observed_at defaults to the time of ingestion when the partner does not supply it.
"""

import csv
import io
import json
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ..fetcher import PoliteFetcher
from ..models import RawOffer
from .base import ParseResult, RawArtefact, SourceAdapter

COLUMN_ALIASES: dict[str, str] = {
    "sku": "external_sku",
    "external_sku": "external_sku",
    "item_code": "external_sku",
    "product_id": "external_sku",
    "name": "name",
    "product_name": "name",
    "title": "name",
    "size": "size_text",
    "size_text": "size_text",
    "pack_size": "size_text",
    "price": "price",
    "price_qar": "price",
    "was_price": "was_price",
    "old_price": "was_price",
    "was_price_qar": "was_price",
    "promo": "promo_text",
    "promo_text": "promo_text",
    "offer": "promo_text",
    "branch": "branch_hint",
    "branch_hint": "branch_hint",
    "store": "branch_hint",
    "url": "url",
    "link": "url",
    "barcode": "barcode",
    "gtin": "barcode",
    "ean": "barcode",
    "observed_at": "observed_at",
    "updated_at": "observed_at",
}


def _money(value: Any) -> Decimal | None:
    if value is None:
        return None
    text = str(value).strip().replace("QAR", "").replace("QR", "").strip()
    if not text:
        return None
    if "," in text and "." not in text:
        text = text.replace(",", ".")
    else:
        text = text.replace(",", "")
    try:
        return Decimal(text).quantize(Decimal("0.01"))
    except InvalidOperation as exc:
        raise ValueError(f"not a valid amount: {value!r}") from exc


def _timestamp(value: Any, default: datetime) -> datetime:
    if value is None or str(value).strip() == "":
        return default
    text = str(value).strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def row_to_offer(source_id: str, row: dict[str, Any], now: datetime) -> RawOffer:
    mapped: dict[str, Any] = {}
    for key, value in row.items():
        canon = COLUMN_ALIASES.get(str(key).strip().lower())
        if canon and value is not None and str(value).strip() != "":
            mapped[canon] = value
    for required in ("external_sku", "name", "price"):
        if required not in mapped:
            raise ValueError(f"missing required column/value: {required}")
    return RawOffer(
        source_id=source_id,
        external_sku=str(mapped["external_sku"]).strip(),
        name=str(mapped["name"]).strip(),
        size_text=str(mapped["size_text"]).strip() if "size_text" in mapped else None,
        price=_money(mapped["price"]),  # type: ignore[arg-type]
        was_price=_money(mapped.get("was_price")),
        promo_text=str(mapped["promo_text"]).strip() if "promo_text" in mapped else None,
        branch_hint=str(mapped["branch_hint"]).strip() if "branch_hint" in mapped else None,
        url=str(mapped["url"]).strip() if "url" in mapped else None,
        barcode=str(mapped["barcode"]).strip() if "barcode" in mapped else None,
        observed_at=_timestamp(mapped.get("observed_at"), now),
    )


def parse_rows(
    source_id: str, rows: list[dict[str, Any]], now: datetime | None = None
) -> ParseResult:
    now = now or datetime.now(UTC)
    result = ParseResult()
    for row in rows:
        try:
            result.offers.append(row_to_offer(source_id, row, now))
        except ValidationError as exc:
            detail = "; ".join(
                f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()
            )
            result.invalid.append((row, detail[:300]))
        except (ValueError, InvalidOperation) as exc:
            result.invalid.append((row, str(exc).splitlines()[0][:300]))
    return result


class _FeedAdapter(SourceAdapter):
    fmt = ""
    content_type = ""

    def __init__(
        self,
        source_id: str,
        *,
        path: Path | None = None,
        url: str | None = None,
        fetcher: PoliteFetcher | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(source_id)
        if (path is None) == (url is None):
            raise ValueError("give exactly one of path= or url=")
        if url is not None and fetcher is None:
            raise ValueError("url= feeds need a PoliteFetcher")
        self.path, self.url, self.fetcher, self.headers = path, url, fetcher, headers

    def fetch(self) -> list[RawArtefact]:
        if self.path is not None:
            return [RawArtefact(self.path.name, self.path.read_bytes(), self.content_type)]
        assert self.url is not None and self.fetcher is not None
        resp = self.fetcher.get(self.url, headers=self.headers)
        return [RawArtefact("feed." + self.fmt, resp.content, resp.content_type, resp.url)]


class CsvFeedAdapter(_FeedAdapter):
    name = "partner-feed-csv"
    fmt = "csv"
    content_type = "text/csv"

    def parse(self, artefacts: list[RawArtefact]) -> ParseResult:
        result = ParseResult()
        for art in artefacts:
            text = art.content.decode("utf-8-sig")
            rows = list(csv.DictReader(io.StringIO(text)))
            part = parse_rows(self.source_id, [dict(r) for r in rows])
            result.offers += part.offers
            result.invalid += part.invalid
        return result


class JsonFeedAdapter(_FeedAdapter):
    name = "partner-feed-json"
    fmt = "json"
    content_type = "application/json"

    def parse(self, artefacts: list[RawArtefact]) -> ParseResult:
        result = ParseResult()
        for art in artefacts:
            data = json.loads(art.content.decode("utf-8-sig"))
            items = data.get("items", data.get("products")) if isinstance(data, dict) else data
            if not isinstance(items, list):
                raise ValueError("JSON feed must be a list, or an object with 'items'/'products'")
            part = parse_rows(self.source_id, [i for i in items if isinstance(i, dict)])
            bad = [i for i in items if not isinstance(i, dict)]
            result.offers += part.offers
            result.invalid += part.invalid + [
                ({"value": repr(b)}, "row is not an object") for b in bad
            ]
        return result

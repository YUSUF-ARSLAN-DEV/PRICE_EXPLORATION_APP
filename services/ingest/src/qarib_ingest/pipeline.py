"""Normalise -> upsert listings -> outlier gate -> record prices (plan 3.1, 3.4, 3.6).

Product MATCHING is Phase 4: new listings are created with match_status='review' and no product.
Already-matched listings keep their product link when they are re-seen.
"""

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from .config import Settings
from .db import Conn
from .models import RawOffer
from .normalize import normalize_search

log = logging.getLogger(__name__)

_ZERO_UUID = "00000000-0000-0000-0000-000000000000"
_MULTIBUY = re.compile(r"\b(buy\s*\d+|\d+\s*for\b|\d+\s*x\s*\d+\s*offer|b\d+g\d+)", re.IGNORECASE)


@dataclass
class PublishStats:
    valid: int = 0
    invalid: int = 0
    published: int = 0
    held: int = 0
    was_price_dropped: int = 0
    unresolved_branches: int = 0
    new_listings: int = 0
    samples: list[str] = field(default_factory=list)

    def as_json(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "invalid": self.invalid,
            "published": self.published,
            "held": self.held,
            "was_price_dropped": self.was_price_dropped,
            "unresolved_branches": self.unresolved_branches,
            "new_listings": self.new_listings,
        }


def promo_type(offer: RawOffer, has_was_price: bool) -> str:
    if offer.promo_text and _MULTIBUY.search(offer.promo_text):
        return "multibuy"
    if has_was_price or offer.promo_text:
        return "discount"
    return "none"


def dead_letter(conn: Conn, batch_id: str, source_id: str, raw: dict[str, Any], error: str) -> None:
    conn.execute(
        "insert into dead_letters (batch_id, source_id, raw, error) values (%s, %s, %s::jsonb, %s)",
        (batch_id, source_id, json.dumps(raw, default=str, ensure_ascii=False), error[:500]),
    )


def _resolve_branch(conn: Conn, retailer_id: str, hint: str | None) -> str | None:
    """Plan 3.4: default price per retailer unless the feed names a known branch."""
    if not hint:
        return None
    row = conn.execute(
        "select id from branches where retailer_id = %s and lower(name) = lower(%s) limit 1",
        (retailer_id, hint.strip()),
    ).fetchone()
    return str(row["id"]) if row else None


def _median(conn: Conn, rp_id: str, branch_id: str | None) -> tuple[Decimal | None, int]:
    row = conn.execute(
        """select percentile_cont(0.5) within group (order by price_qar)::numeric(10,2) as med,
                  count(*) as n
           from prices
           where retailer_product_id = %s
             and coalesce(branch_id, %s::uuid) = coalesce(%s::uuid, %s::uuid)
             and observed_at >= now() - interval '30 days'""",
        (rp_id, _ZERO_UUID, branch_id, _ZERO_UUID),
    ).fetchone()
    assert row is not None
    return row["med"], int(row["n"])


def publish_offers(
    conn: Conn,
    source: dict[str, Any],
    batch_id: str,
    offers: list[RawOffer],
    settings: Settings,
    stats: PublishStats | None = None,
) -> PublishStats:
    """Publish valid offers. Each row runs in a savepoint; a bad row becomes a dead letter."""
    stats = stats or PublishStats()
    source_id, retailer_id = str(source["id"]), str(source["retailer_id"])
    now = datetime.now(UTC)

    for offer in offers:
        raw = offer.model_dump(mode="json")
        try:
            with conn.transaction():
                price = offer.price
                if price <= 0 or price > Decimal(str(settings.max_price_qar)):
                    raise ValueError(
                        f"price {price} outside sane range (0, {settings.max_price_qar}]"
                    )
                if (offer.observed_at - now).total_seconds() > 86400:
                    raise ValueError("observed_at is more than a day in the future")

                was = offer.was_price
                if was is not None and was <= price:
                    was = None  # common feed quirk; a "was" price must exceed the price
                    stats.was_price_dropped += 1

                listing = conn.execute(
                    """insert into retailer_products
                         (retailer_id, source_id, external_sku, raw_name, raw_name_normalised,
                          raw_size, raw_url, match_status)
                       values (%s, %s, %s, %s, %s, %s, %s, 'review')
                       on conflict (source_id, external_sku) do update set
                         raw_name = excluded.raw_name,
                         raw_name_normalised = excluded.raw_name_normalised,
                         raw_size = excluded.raw_size,
                         raw_url = coalesce(excluded.raw_url, retailer_products.raw_url)
                       returning id, (xmax = 0) as inserted""",
                    (
                        retailer_id,
                        source_id,
                        offer.external_sku,
                        offer.name,
                        normalize_search(offer.name),
                        offer.size_text,
                        offer.url,
                    ),
                ).fetchone()
                assert listing is not None
                rp_id = str(listing["id"])
                stats.new_listings += 1 if listing["inserted"] else 0

                branch_id = _resolve_branch(conn, retailer_id, offer.branch_hint)
                if offer.branch_hint and branch_id is None:
                    stats.unresolved_branches += 1

                median, history = _median(conn, rp_id, branch_id)
                ptype = promo_type(offer, was is not None)

                if (
                    median is not None
                    and median > 0
                    and history >= settings.outlier_min_history
                    and abs(price - median) / median > Decimal(str(settings.outlier_ratio))
                ):
                    conn.execute(
                        """insert into held_prices
                             (batch_id, source_id, retailer_product_id, branch_id, price_qar,
                              was_price_qar, promo_type, in_stock, observed_at, reason,
                              reference_median)
                           values (%s, %s, %s, %s, %s, %s, %s::promo_type, true, %s, %s, %s)""",
                        (
                            batch_id,
                            source_id,
                            rp_id,
                            branch_id,
                            price,
                            was,
                            ptype,
                            offer.observed_at,
                            f"price {price} differs >{int(settings.outlier_ratio * 100)}% "
                            f"from 30-day median {median}",
                            median,
                        ),
                    )
                    stats.held += 1
                    continue

                conn.execute(
                    "select record_price(%s, %s, %s, %s, %s::promo_type, null, true, %s, %s, %s)",
                    (rp_id, branch_id, price, was, ptype, offer.observed_at, source_id, batch_id),
                )
                stats.published += 1
        except Exception as exc:  # any row failure is isolated to a dead letter
            stats.invalid += 1
            log.warning("row rejected (%s): %s", offer.external_sku, exc)
            dead_letter(conn, batch_id, source_id, raw, f"publish failed: {exc}")
    return stats

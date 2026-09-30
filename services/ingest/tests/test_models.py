from datetime import UTC, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from qarib_ingest.models import RawOffer


def _offer(**kw: object) -> RawOffer:
    base: dict[str, object] = {
        "source_id": "s1",
        "external_sku": "123",
        "name": "Milk 1L",
        "price": Decimal("6.50"),
        "observed_at": datetime.now(UTC),
    }
    base.update(kw)
    return RawOffer(**base)  # type: ignore[arg-type]


def test_valid_offer() -> None:
    assert _offer().price == Decimal("6.50")


def test_negative_price_rejected() -> None:
    with pytest.raises(ValidationError):
        _offer(price=Decimal("-1"))

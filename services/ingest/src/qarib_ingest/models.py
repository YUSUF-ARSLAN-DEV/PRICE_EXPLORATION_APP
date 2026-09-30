"""RawOffer contract from plan 3.1. Adapters must emit only this shape."""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class RawOffer(BaseModel):
    source_id: str
    external_sku: str
    name: str = Field(min_length=1)
    size_text: str | None = None
    price: Decimal = Field(ge=0, decimal_places=2)
    was_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    promo_text: str | None = None
    branch_hint: str | None = None
    url: str | None = None
    barcode: str | None = None
    observed_at: datetime

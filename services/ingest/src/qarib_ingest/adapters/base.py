"""Adapter contract (plan 3.1).

    fetch()  -> raw artefacts (stored immutably by the batch runner before parsing)
    parse()  -> valid RawOffers + invalid rows (which become dead letters)

Adapters never touch the database and never decide whether they may run: the batch runner checks
the Source Registry (green + no kill switch) before calling fetch().
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from ..models import RawOffer


@dataclass(frozen=True)
class RawArtefact:
    name: str
    content: bytes
    content_type: str = "application/octet-stream"
    source_url: str | None = None


@dataclass
class ParseResult:
    offers: list[RawOffer] = field(default_factory=list)
    invalid: list[tuple[dict[str, Any], str]] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.offers) + len(self.invalid)


class SourceAdapter(ABC):
    name: str = "adapter"

    def __init__(self, source_id: str) -> None:
        self.source_id = source_id

    @abstractmethod
    def fetch(self) -> list[RawArtefact]: ...

    @abstractmethod
    def parse(self, artefacts: list[RawArtefact]) -> ParseResult: ...

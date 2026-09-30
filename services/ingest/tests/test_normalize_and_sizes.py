import json
from pathlib import Path
from typing import Any

import pytest

from qarib_ingest.normalize import normalize_search
from qarib_ingest.sizes import parse_size

FIXTURES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "fixtures"


def _load(name: str) -> list[dict[str, Any]]:
    data: list[dict[str, Any]] = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return data


@pytest.mark.parametrize("case", _load("arabic-cases.json"), ids=lambda c: repr(c["input"]))
def test_normalize_search_matches_shared_fixtures(case: dict[str, Any]) -> None:
    assert normalize_search(case["input"]) == case["expected"]


def test_size_fixture_count() -> None:
    assert len(_load("size-cases.json")) >= 200


@pytest.mark.parametrize("case", _load("size-cases.json"), ids=lambda c: repr(c["input"]))
def test_parse_size_matches_shared_fixtures(case: dict[str, Any]) -> None:
    got = parse_size(case["input"])
    exp = case["expected"]
    if exp is None:
        assert got is None
        return
    assert got is not None
    assert got.size_unit == exp["size_unit"]
    assert got.pack_count == exp["pack_count"]
    assert got.base_unit == exp["base_unit"]
    assert abs(got.size_value - exp["size_value"]) < 1e-6
    assert abs(got.base_quantity - exp["base_quantity"]) < 1e-6

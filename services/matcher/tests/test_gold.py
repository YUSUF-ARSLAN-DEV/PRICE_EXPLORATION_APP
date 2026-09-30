"""Plan 4.6: precision/recall on the gold set is computed on every change; regressions fail CI."""

import json
from typing import Any

import pytest

from qarib_matcher.gold import BASELINE, DEFAULT_GOLD, evaluate


@pytest.fixture(scope="module")
def metrics() -> dict[str, Any]:
    return evaluate()


def test_gold_set_has_at_least_1000_labelled_pairs(metrics: dict[str, Any]) -> None:
    assert metrics["pairs"] >= 1000
    assert metrics["negatives"] >= 100


def test_auto_match_precision_meets_the_97_percent_bar(metrics: dict[str, Any]) -> None:
    assert metrics["auto_precision"] >= 0.97, metrics["false_auto"]


def test_no_regression_against_baseline(metrics: dict[str, Any]) -> None:
    base = json.loads(BASELINE.read_text())
    for key in ("auto_precision", "auto_recall_same_language", "candidate_recall_all"):
        assert metrics[key] >= base[key] - 0.01, f"{key} regressed: {metrics[key]} < {base[key]}"


def test_gold_file_is_well_formed() -> None:
    pairs = json.loads(DEFAULT_GOLD.read_text(encoding="utf-8"))
    assert all({"a", "b", "same"} <= set(p) for p in pairs)
    assert len({json.dumps(p, sort_keys=True, ensure_ascii=False) for p in pairs}) > 900

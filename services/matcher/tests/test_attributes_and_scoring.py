from typing import Any

import pytest
from qarib_ingest.normalize import normalize_search

from qarib_matcher.attributes import ListingAttrs, classify, extract, extract_size
from qarib_matcher.scoring import (
    AUTO_THRESHOLD,
    REVIEW_THRESHOLD,
    band,
    score_pair,
    sizes_compatible,
)


# ---- size in names ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "name, unit, pack, base",
    [
        ("Almarai Fresh Milk Full Fat 1L", "l", 1, 1.0),
        ("Coca-Cola 6 x 330ml", "ml", 6, 1.98),
        ("Basmati Rice 5 kg", "kg", 1, 5.0),
        ("Tide Powder 1.5kg", "kg", 1, 1.5),
        ("حليب المراعي 1.5 لتر", "l", 1, 1.5),
        ("Eggs 12 pcs", "pc", 1, 12.0),
    ],
)
def test_extract_size_from_name(name: str, unit: str, pack: int, base: float) -> None:
    size, _ = extract_size(name)
    assert size is not None and size.size_unit == unit and size.pack_count == pack
    assert size.base_quantity == pytest.approx(base)


def test_no_false_size_in_words() -> None:
    assert extract_size("7up Free")[0] is None
    assert extract_size("Pepsi Max")[0] is None


def test_explicit_raw_size_wins_over_name() -> None:
    a = extract("Milk 2L", raw_size="1L")
    assert a.size is not None and a.size.base_quantity == 1.0


# ---- brand, variants, category ---------------------------------------------------------------
def test_brand_found_in_english_and_arabic_and_removed_from_core() -> None:
    assert extract("ALMARAI Fresh Milk").brand == "Almarai"
    assert extract("حليب المراعي طازج").brand == "Almarai"
    assert extract("Al Marai Fresh Milk").brand == "Almarai"
    a = extract("Almarai Fresh Milk Full Fat 1L")
    assert "almarai" not in a.core and a.core == ("milk",)


def test_variants_extracted_both_languages() -> None:
    assert extract("Almarai Milk Full Fat Fresh 1L").variant_map() == {
        "fat": "full",
        "shelf": "fresh",
    }
    assert extract("حليب قليل الدسم طازج").variant_map() == {"fat": "low", "shelf": "fresh"}
    assert extract("Coke Zero").variant_map() == {"sugar_free": "zero"}
    assert extract("Coke Diet").variant_map() == {"sugar_free": "diet"}
    assert extract("Whole Wheat Bread").variant_map() == {"grain": "whole_wheat"}
    assert ("flavour", "strawberry") in extract("Yogurt Strawberry").variants


@pytest.mark.parametrize(
    "name, slug",
    [
        ("Almarai Fresh Milk 1L", "fresh-milk"),
        ("Long Life Milk 1L", "long-life-milk"),
        ("Plain Milk 1L", "milk"),
        ("Basmati Rice 5kg", "rice"),
        ("أرز بسمتي", "rice"),
        ("Sugar Free Cola", "soft-drinks"),
        ("White Sugar 2kg", "sugar"),
        ("Baby Diapers Size 3", "baby"),
        ("Orange Juice", "juice"),
        ("Laundry Detergent", "household"),
        ("Mystery Item", None),
    ],
)
def test_classify(name: str, slug: str | None) -> None:
    assert classify(normalize_search(name)) == slug


@pytest.mark.parametrize(
    "name",
    [
        "Heineken Beer 330ml",
        "Red Wine 750ml",
        "Marlboro Cigarettes",
        "Vape Liquid",
        "Smirnoff Vodka",
        "سجائر مارلبورو",
    ],
)
def test_alcohol_and_tobacco_are_restricted(name: str) -> None:
    assert classify(normalize_search(name)) == "restricted-alcohol-tobacco"


@pytest.mark.parametrize(
    "name, restricted",
    [
        ("Pork Sausages 500g", True),
        ("Smoked Bacon 200g", True),
        ("لحم الخنزير", True),
        ("Beef Bacon 200g", False),
        ("Turkey Ham 150g", False),
        ("Non Alcoholic Beer 330ml", False),
        ("Root Beer 355ml", False),
        ("Ginger Beer", False),
    ],
)
def test_pork_heuristic_and_non_alcoholic_exceptions(name: str, restricted: bool) -> None:
    got = classify(normalize_search(name))
    assert (got in ("restricted-pork", "restricted-alcohol-tobacco")) is restricted


# ---- scoring ---------------------------------------------------------------------------------
def pair(a: str, b: str, sa: str | None = None, sb: str | None = None) -> Any:
    x: ListingAttrs = extract(a, sa)
    y: ListingAttrs = extract(b, sb)
    return score_pair(x, y)


def test_identical_items_with_different_formatting_auto_match() -> None:
    r = pair("Almarai Fresh Milk Full Fat 1L", "ALMARAI FRESH MILK FULL FAT", None, "1 Ltr")
    assert r.ok and r.score >= AUTO_THRESHOLD and band(r.score) == "auto"


def test_equivalent_units_are_the_same_size() -> None:
    assert sizes_compatible(extract("Milk 1L"), extract("Milk 1000ml")) is True
    assert sizes_compatible(extract("Milk 500g"), extract("Milk 0.5kg")) is True


@pytest.mark.parametrize(
    "a, b, reason",
    [
        ("Almarai Milk 1L", "Baladna Milk 1L", "brand"),
        ("Almarai Milk 1L", "Almarai Milk 2L", "size"),
        ("Coke 6 x 330ml", "Coke 330ml", "size"),  # multipack is a different product
        ("Almarai Milk Full Fat 1L", "Almarai Milk Low Fat 1L", "variant:fat"),
        ("Yogurt Strawberry 120g", "Yogurt Vanilla 120g", "variant:flavour"),
        ("Coke Zero 330ml", "Coke Diet 330ml", "variant:sugar_free"),
        ("Coffee 200g", "Decaf Coffee 200g", "variant:decaf(one-sided)"),
        ("Organic Eggs 12 pcs", "Eggs 12 pcs", "variant:organic(one-sided)"),
        ("Orange Juice 1L", "Laundry Detergent 1L", "category"),
    ],
)
def test_hard_constraints_reject(a: str, b: str, reason: str) -> None:
    r = pair(a, b)
    assert not r.ok and r.reject == reason and r.score == 0.0


def test_size_within_two_percent_tolerated_beyond_rejected() -> None:
    assert sizes_compatible(extract("Rice 1000g"), extract("Rice 1010g")) is True
    assert sizes_compatible(extract("Rice 1000g"), extract("Rice 1100g")) is False


def test_missing_size_on_one_side_never_auto_matches() -> None:
    r = pair("Almarai Fresh Milk 1L", "Almarai Fresh Milk")
    assert r.ok and r.score <= 0.85 and band(r.score) != "auto"


def test_one_sided_soft_variant_goes_to_review_not_auto() -> None:
    r = pair("Almarai Milk Full Fat 1L", "Almarai Milk 1L")
    assert r.ok and REVIEW_THRESHOLD <= r.score < AUTO_THRESHOLD


def test_cross_language_match_is_review_only() -> None:
    r = pair("Almarai Fresh Milk Full Fat 1L", "حليب المراعي طازج كامل الدسم 1 لتر")
    assert r.ok and REVIEW_THRESHOLD <= r.score < AUTO_THRESHOLD


def test_extra_words_reduce_similarity() -> None:
    r = pair("Milk Chocolate Bar 100g", "Milk Bar 100g")
    assert r.score < AUTO_THRESHOLD

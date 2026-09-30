"""Pair scoring with hard constraints (plan 4.1, 4.2).

Two listings are candidates for "the same product" only if they survive the hard constraints:
  * brand equality (when both brands are known)
  * identical size (within 2 %) AND identical pack count (when both sizes are known)
  * no conflicting variant (fat level, flavour, organic, sugar-free ...)
Survivors get a score in [0, 1]:
  score = 0.75 * name_similarity + 0.125 * brand_term + 0.125 * size_term - penalties

Thresholds (plan 4.1): >= AUTO_THRESHOLD auto-match, >= REVIEW_THRESHOLD human review,
below that the listing becomes a new product.
"""

from dataclasses import dataclass, field

from rapidfuzz import fuzz

from . import dictionaries as d
from .attributes import ListingAttrs

AUTO_THRESHOLD = 0.93
REVIEW_THRESHOLD = 0.80
SIZE_TOLERANCE = 0.02
# Scores are capped when evidence is incomplete, so such pairs can never be auto-matched.
CAP_MISSING_SIZE = 0.85
CAP_CROSS_SCRIPT = 0.88


@dataclass(frozen=True)
class PairScore:
    score: float
    reject: str | None = None
    parts: dict[str, float | str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.reject is None


# milk is the parent of its more specific classifications
_CATEGORY_PARENTS = {"fresh-milk": "milk", "long-life-milk": "milk"}


def categories_compatible(x: str, y: str) -> bool:
    return x == y or _CATEGORY_PARENTS.get(x) == y or _CATEGORY_PARENTS.get(y) == x


def _size_key(a: ListingAttrs) -> tuple[str, float, int] | None:
    if a.size is None:
        return None
    # size of ONE pack in base units so "500 g" == "0.5 kg"
    per_pack = a.size.base_quantity / a.size.pack_count
    return a.size.base_unit, per_pack, a.size.pack_count


def sizes_compatible(a: ListingAttrs, b: ListingAttrs) -> bool | None:
    """True/False when both sizes are known, None when either is missing."""
    ka, kb = _size_key(a), _size_key(b)
    if ka is None or kb is None:
        return None
    if ka[0] != kb[0] or ka[2] != kb[2]:
        return False
    hi = max(ka[1], kb[1])
    return hi == 0 or abs(ka[1] - kb[1]) / hi <= SIZE_TOLERANCE


def _variant_check(a: ListingAttrs, b: ListingAttrs) -> tuple[str | None, float]:
    """(reject reason | None, penalty)."""
    va: dict[str, set[str]] = {}
    vb: dict[str, set[str]] = {}
    for g, v in a.variants:
        va.setdefault(g, set()).add(v)
    for g, v in b.variants:
        vb.setdefault(g, set()).add(v)
    penalty = 0.0
    for group in set(va) | set(vb):
        x, y = va.get(group), vb.get(group)
        if x is not None and y is not None:
            if x != y:
                return f"variant:{group}", 0.0
        elif group in d.CRITICAL_GROUPS:
            return f"variant:{group}(one-sided)", 0.0
        else:
            penalty += 0.10  # soft group known on one side only (e.g. "fresh")
    return None, penalty


def name_similarity(a: ListingAttrs, b: ListingAttrs) -> tuple[float, str]:
    """Similarity of the core tokens; cross-script names cannot be compared lexically."""
    if a.script in ("ar", "en") and b.script in ("ar", "en") and a.script != b.script:
        same_category = (
            a.category is not None
            and b.category is not None
            and categories_compatible(a.category, b.category)
        )
        same_brand_and_size = (
            a.brand is not None and a.brand == b.brand and sizes_compatible(a, b) is True
        )
        return (0.80 if same_category or same_brand_and_size else 0.5), "cross_script"
    if not a.core and not b.core:
        return 1.0, "lexical"
    return fuzz.token_sort_ratio(a.core_text, b.core_text) / 100.0, "lexical"


def score_pair(a: ListingAttrs, b: ListingAttrs, semantic: float | None = None) -> PairScore:
    parts: dict[str, float | str] = {}
    if a.brand and b.brand and a.brand != b.brand:
        return PairScore(0.0, "brand", parts)
    if a.category and b.category and not categories_compatible(a.category, b.category):
        return PairScore(0.0, "category", parts)
    size_ok = sizes_compatible(a, b)
    if size_ok is False:
        return PairScore(0.0, "size", parts)
    reject, penalty = _variant_check(a, b)
    if reject:
        return PairScore(0.0, reject, parts)

    name, mode = name_similarity(a, b)
    if mode == "cross_script" and semantic is not None:
        name = max(name, min(1.0, semantic))  # embedding tier (plan 4.1 step 3)
    parts["name"] = round(name, 4)
    parts["name_mode"] = mode

    if a.brand and b.brand:
        brand_term = 1.0
    elif not a.brand and not b.brand:
        brand_term = 0.5
    else:
        brand_term = 0.2
    size_term = 1.0 if size_ok is True else 0.5 if (a.size is None and b.size is None) else 0.3

    score = 0.75 * name + 0.125 * brand_term + 0.125 * size_term - penalty
    if size_ok is None and (a.size is None) != (b.size is None):
        score = min(score, CAP_MISSING_SIZE)
    if mode == "cross_script":
        score = min(score, CAP_CROSS_SCRIPT)
    score = max(0.0, min(1.0, score))
    parts.update(brand=brand_term, size=size_term, penalty=round(penalty, 3))
    return PairScore(round(score, 4), None, parts)


def band(score: float) -> str:
    if score >= AUTO_THRESHOLD:
        return "auto"
    if score >= REVIEW_THRESHOLD:
        return "review"
    return "new"

"""Attribute extraction (plan 4.3): brand, size, variants, core tokens, category."""

import re
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache

from qarib_ingest.normalize import normalize_digits, normalize_search
from qarib_ingest.sizes import ParsedSize, parse_size

from . import dictionaries as d

_ARABIC = re.compile(r"[؀-ۿ]")
_LATIN = re.compile(r"[a-z]")
# a size-looking fragment inside a name: "2 x 500ml", "1.5l", "500 g", "6 x 1.5 ltr", "12 pcs"
_SIZE_FRAGMENT = re.compile(
    r"(?<![a-z0-9؀-ۿ])"
    r"(?:\d+\s*[x×*]\s*)?\d+(?:[.,]\d+)?\s*(?:[x×*]\s*\d+\s*)?[a-z؀-ۿ]+"
    r"(?![a-z0-9؀-ۿ])"
)


def _phrase_tokens(phrase: str) -> tuple[str, ...]:
    return tuple(normalize_search(phrase).split())


def _key(token: str) -> str:
    """Matching key: drops the Arabic definite article so 'الخنزير' matches 'خنزير'."""
    return token[2:] if token.startswith("ال") and len(token) > 4 else token


def _find_phrase(tokens: list[str], phrase: tuple[str, ...]) -> int:
    """Index of the first occurrence of `phrase` as a contiguous token run, else -1."""
    n = len(phrase)
    if n == 0:
        return -1
    want = tuple(_key(p) for p in phrase)
    keyed = [_key(t) for t in tokens]
    for i in range(len(keyed) - n + 1):
        if tuple(keyed[i : i + n]) == want:
            return i
    return -1


@dataclass(frozen=True)
class ListingAttrs:
    text: str  # original name
    norm: str  # search-normalised name
    brand: str | None  # canonical brand key
    size: ParsedSize | None
    variants: frozenset[tuple[str, str]]  # {(group, value)}
    core: tuple[str, ...]  # tokens left after removing brand/size/variant/stopwords
    script: str  # 'ar' | 'en' | 'mixed' | 'none'
    category: str | None = None
    extra: dict[str, str] = field(default_factory=dict, compare=False)

    @property
    def core_text(self) -> str:
        return " ".join(self.core)

    def variant_map(self) -> dict[str, str]:
        return dict(self.variants)


class BrandIndex:
    """alias (normalised token tuple) -> canonical brand key; longest alias wins."""

    def __init__(self, brands: dict[str, list[str]] | None = None) -> None:
        self.aliases: list[tuple[tuple[str, ...], str]] = []
        for brand, aliases in (brands if brands is not None else d.BRANDS).items():
            for alias in {brand, *aliases}:
                toks = _phrase_tokens(alias)
                if toks:
                    self.aliases.append((toks, brand))
        self.aliases.sort(key=lambda t: -len(t[0]))

    def find(self, tokens: list[str]) -> tuple[str, tuple[int, int]] | None:
        for toks, brand in self.aliases:
            i = _find_phrase(tokens, toks)
            if i >= 0:
                return brand, (i, i + len(toks))
        return None


@lru_cache(maxsize=1)
def default_brand_index() -> BrandIndex:
    return BrandIndex()


@lru_cache(maxsize=1)
def _variant_phrases() -> list[tuple[tuple[str, ...], tuple[str, str]]]:
    items = [(_phrase_tokens(p), gv) for p, gv in d.VARIANT_PHRASES.items()]
    return sorted(items, key=lambda t: -len(t[0]))  # longest first ("whole wheat" before "whole")


@lru_cache(maxsize=1)
def _flavours() -> list[tuple[tuple[str, ...], str]]:
    return [(_phrase_tokens(p), v) for p, v in d.FLAVOURS.items()]


@lru_cache(maxsize=1)
def _stopwords() -> frozenset[str]:
    return frozenset(normalize_search(w) for w in d.STOPWORDS)


def extract_size(text: str) -> tuple[ParsedSize | None, str]:
    """Find the LAST parsable size fragment in a name; returns (size, name_without_fragment)."""
    cleaned = normalize_digits(unicodedata.normalize("NFKC", text)).lower()
    best: tuple[ParsedSize, re.Match[str]] | None = None
    for m in _SIZE_FRAGMENT.finditer(cleaned):
        parsed = parse_size(m.group(0))
        if parsed is not None:
            best = (parsed, m)
    if best is None:
        return None, cleaned
    m = best[1]
    return best[0], (cleaned[: m.start()] + " " + cleaned[m.end() :])


def script_of(text: str) -> str:
    ar, la = bool(_ARABIC.search(text)), bool(_LATIN.search(text.lower()))
    if ar and la:
        return "mixed"
    return "ar" if ar else "en" if la else "none"


def classify(norm: str) -> str | None:
    tokens = norm.split()
    for slug, any_of, excluded in d.CATEGORY_RULES:
        if any(_find_phrase(tokens, _phrase_tokens(x)) >= 0 for x in excluded):
            continue
        if any(_find_phrase(tokens, _phrase_tokens(x)) >= 0 for x in any_of):
            return slug
    return None


def extract(
    name: str,
    raw_size: str | None = None,
    brands: BrandIndex | None = None,
    known_brand: str | None = None,
) -> ListingAttrs:
    size = parse_size(raw_size) if raw_size else None
    name_wo_size = name
    in_name, stripped = extract_size(name)
    if size is None:
        size = in_name
    if in_name is not None:
        name_wo_size = stripped
    norm = normalize_search(name_wo_size)
    tokens = norm.split()
    full_norm = normalize_search(name)

    # brand
    brand = known_brand
    consumed: set[int] = set()
    found = (brands or default_brand_index()).find(tokens)
    if found:
        b, (i, j) = found
        brand = brand or b
        consumed.update(range(i, j))

    # variants (longest phrases first, tokens may only be claimed once)
    variants: set[tuple[str, str]] = set()
    for phrase, gv in _variant_phrases():
        i = _find_phrase([t if k not in consumed else "\0" for k, t in enumerate(tokens)], phrase)
        if i >= 0:
            variants.add(gv)
            consumed.update(range(i, i + len(phrase)))
    for phrase, flavour in _flavours():
        i = _find_phrase([t if k not in consumed else "\0" for k, t in enumerate(tokens)], phrase)
        if i >= 0:
            variants.add(("flavour", flavour))
            consumed.update(range(i, i + len(phrase)))

    stop = _stopwords()
    core = tuple(t for k, t in enumerate(tokens) if k not in consumed and t not in stop)
    return ListingAttrs(
        text=name,
        norm=norm,
        brand=brand,
        size=size,
        variants=frozenset(variants),
        core=core,
        script=script_of(full_norm),
        category=classify(full_norm),
    )

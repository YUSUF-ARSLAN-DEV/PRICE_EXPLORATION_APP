"""Size-string parser (plan 2.2).

Port of packages/shared/src/size.ts - both are tested against
packages/shared/fixtures/size-cases.json. Change them together.
"""

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

from .normalize import normalize_digits

SizeUnit = Literal["g", "kg", "ml", "l", "pc"]
BaseUnit = Literal["kg", "l", "pc"]


@dataclass(frozen=True)
class ParsedSize:
    size_value: float  # size of ONE pack, in size_unit
    size_unit: SizeUnit
    pack_count: int
    base_quantity: float  # total in kg / L / piece
    base_unit: BaseUnit


@dataclass(frozen=True)
class _UnitDef:
    unit: SizeUnit
    factor: float = 1.0


_UNITS: dict[str, _UnitDef] = {}


def _add(d: _UnitDef, *names: str) -> None:
    for n in names:
        _UNITS[n] = d


_add(_UnitDef("g"), "g", "gm", "gms", "gr", "gram", "grams", "غ", "غم", "جم", "جرام", "غرام")
_add(
    _UnitDef("kg"),
    "kg", "kgs", "kilo", "kilos", "kilogram", "kilograms",
    "كجم", "كغ", "كغم", "كيلو", "كيلوجرام", "كيلوغرام",
)  # fmt: skip
_add(
    _UnitDef("ml"),
    "ml",
    "mls",
    "milliliter",
    "milliliters",
    "millilitre",
    "millilitres",
    "مل",
    "ملل",
)
_add(_UnitDef("ml", 10), "cl")
_add(_UnitDef("l"), "l", "lt", "ltr", "ltrs", "liter", "liters", "litre", "litres", "ل", "لتر")
_add(
    _UnitDef("pc"),
    "pc", "pcs", "pce", "piece", "pieces", "pack", "packs", "ct", "count",
    "قطعة", "قطع", "حبة", "حبات",
)  # fmt: skip
_add(_UnitDef("g", 28.3495), "oz", "ounce", "ounces")
_add(_UnitDef("g", 453.592), "lb", "lbs", "pound", "pounds")
_DOZEN = {"dozen", "doz", "دزينة"}

_NUM = r"(\d+(?:[.,]\d+)*)"
_WORD = r"([a-z؀-ۿ]+)"
_PACK_X_SIZE = re.compile(rf"^(\d+)\s*x\s*{_NUM}\s*{_WORD}$")
_SIZE_X_PACK = re.compile(rf"^{_NUM}\s*{_WORD}\s*x\s*(\d+)$")
_SIZE_ONLY = re.compile(rf"^{_NUM}\s*{_WORD}$")
_UNIT_ONLY = re.compile(rf"^(?:per\s+)?{_WORD}$")
_PACK_OF = re.compile(r"^pack\s+of\s+(\d+)$")
_TASHKEEL = re.compile("[ً-ٰٟـ]")


def _round4(n: float) -> float:
    # Match JS Math.round(n * 10000) / 10000 (round half up) rather than banker's rounding.
    import math

    return math.floor(n * 10000 + 0.5) / 10000


def _parse_number(raw: str) -> float | None:
    s = raw
    if "," in s and "." in s:
        s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", "") if re.fullmatch(r"\d{1,3}(,\d{3})+", s) else s.replace(",", ".", 1)
    try:
        return float(s)
    except ValueError:
        return None


def _build(value: float, d: _UnitDef, pack_count: int) -> ParsedSize | None:
    if not value > 0 or pack_count < 1:
        return None
    size_value = _round4(value * d.factor)
    base_unit: BaseUnit = "kg" if d.unit in ("g", "kg") else "pc" if d.unit == "pc" else "l"
    per_base = 1000 if d.unit in ("g", "ml") else 1
    return ParsedSize(
        size_value=size_value,
        size_unit=d.unit,
        pack_count=pack_count,
        base_quantity=_round4(size_value * pack_count / per_base),
        base_unit=base_unit,
    )


def _lookup(word: str) -> tuple[_UnitDef, int] | None:
    if word in _DOZEN:
        return _UNITS["pc"], 12
    d = _UNITS.get(word)
    return (d, 1) if d else None


def parse_size(text: str) -> ParsedSize | None:
    """Parse a retailer size string; None when it cannot be understood."""
    s = normalize_digits(unicodedata.normalize("NFKC", text)).lower()
    s = re.sub(r"[×✕✖*]", "x", s)
    s = _TASHKEEL.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        return None

    if m := _PACK_OF.match(s):
        return _build(1, _UNITS["pc"], int(m[1]))

    if m := _PACK_X_SIZE.match(s):
        hit, v = _lookup(m[3]), _parse_number(m[2])
        return _build(v, hit[0], int(m[1]) * hit[1]) if hit and v is not None else None

    if m := _SIZE_X_PACK.match(s):
        hit, v = _lookup(m[2]), _parse_number(m[1])
        return _build(v, hit[0], int(m[3]) * hit[1]) if hit and v is not None else None

    if m := _SIZE_ONLY.match(s):
        hit, v = _lookup(m[2]), _parse_number(m[1])
        return _build(v, hit[0], hit[1]) if hit and v is not None else None

    if m := _UNIT_ONLY.match(s):
        hit = _lookup(m[1])
        # A bare unit means "per 1 <unit>"; only meaningful for kg / l / pc.
        if hit and hit[0].unit in ("kg", "l", "pc") and hit[0].factor == 1:
            return _build(1, hit[0], hit[1])
    return None

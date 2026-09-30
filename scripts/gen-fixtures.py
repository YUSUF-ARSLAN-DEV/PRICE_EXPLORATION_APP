"""Generates packages/shared/fixtures/*.json (plan 2.2 / 2.4).

Expected values are derived BY CONSTRUCTION from the (value, unit, pack) we render into the
string - never by calling either parser - so the fixtures are an independent oracle for both the
TypeScript (packages/shared) and Python (services/ingest) implementations.

Run:  python scripts/gen-fixtures.py
Re-running is deterministic (seeded). Commit the regenerated JSON.
"""

import json
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "packages" / "shared" / "fixtures"
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(20260930)

ARABIC_DIGITS = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")

# unit_type -> (size_unit, base_unit, divisor_to_base, names, values)
UNIT_TYPES = {
    "g": ("g", "kg", 1000, ["g", "gm", "gram", "غم", "جرام"], [50, 100, 250, 500, 750]),
    "kg": ("kg", "kg", 1, ["kg", "kilo", "كجم", "كيلو"], [1, 2, 2.5, 5, 10]),
    "ml": ("ml", "l", 1000, ["ml", "مل"], [200, 330, 500, 750]),
    "l": ("l", "l", 1, ["l", "ltr", "liter", "لتر"], [1, 1.5, 2, 4]),
    "pc": ("pc", "pc", 1, ["pc", "pcs", "piece", "قطعة"], [6, 12, 24]),
}
SINGLE = ["{v}{u}", "{v} {u}"]
MULTI = ["{p} x {v}{u}", "{p}x{v} {u}", "{v}{u} x {p}", "{p} × {v} {u}"]


def num(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else str(v)


def rnd4(x: float) -> float:
    return round(x + 1e-12, 4)


cases: list[dict] = []
seen: set[str] = set()


def add(text: str, expected: dict | None) -> None:
    if text in seen:
        return
    seen.add(text)
    cases.append({"input": text, "expected": expected})


def expected_for(utype: str, v: float, pack: int) -> dict:
    size_unit, base_unit, div, _, _ = UNIT_TYPES[utype]
    return {
        "size_value": v,
        "size_unit": size_unit,
        "pack_count": pack,
        "base_quantity": rnd4(v * pack / div),
        "base_unit": base_unit,
    }


# 1) constructed cases
for _ in range(400):
    utype = rng.choice(list(UNIT_TYPES))
    _, _, _, names, values = UNIT_TYPES[utype]
    v = rng.choice(values)
    name = rng.choice(names)
    pack = rng.choice([1, 1, 1, 2, 3, 6, 12])
    tpl = rng.choice(SINGLE if pack == 1 else MULTI)
    text = tpl.format(v=num(v), u=name, p=pack)
    if name.isascii() and rng.random() < 0.15:
        text = text.upper()
    if rng.random() < 0.15:
        text = text.translate(ARABIC_DIGITS)
    if rng.random() < 0.05:
        text = f"  {text}  "
    add(text, expected_for(utype, v, pack))

# 2) hand-written edge cases (expected values computed by hand)
hand = [
    ("1,5L", {"size_value": 1.5, "size_unit": "l", "pack_count": 1, "base_quantity": 1.5, "base_unit": "l"}),
    ("1,000g", {"size_value": 1000, "size_unit": "g", "pack_count": 1, "base_quantity": 1, "base_unit": "kg"}),
    ("2,5 kg", {"size_value": 2.5, "size_unit": "kg", "pack_count": 1, "base_quantity": 2.5, "base_unit": "kg"}),
    ("75cl", {"size_value": 750, "size_unit": "ml", "pack_count": 1, "base_quantity": 0.75, "base_unit": "l"}),
    ("33 CL", {"size_value": 330, "size_unit": "ml", "pack_count": 1, "base_quantity": 0.33, "base_unit": "l"}),
    ("12 oz", {"size_value": 340.194, "size_unit": "g", "pack_count": 1, "base_quantity": 0.3402, "base_unit": "kg"}),
    ("1 lb", {"size_value": 453.592, "size_unit": "g", "pack_count": 1, "base_quantity": 0.4536, "base_unit": "kg"}),
    ("1 dozen", {"size_value": 1, "size_unit": "pc", "pack_count": 12, "base_quantity": 12, "base_unit": "pc"}),
    ("2 dozen", {"size_value": 2, "size_unit": "pc", "pack_count": 12, "base_quantity": 24, "base_unit": "pc"}),
    ("دزينة", {"size_value": 1, "size_unit": "pc", "pack_count": 12, "base_quantity": 12, "base_unit": "pc"}),
    ("pack of 6", {"size_value": 1, "size_unit": "pc", "pack_count": 6, "base_quantity": 6, "base_unit": "pc"}),
    ("6 pack", {"size_value": 6, "size_unit": "pc", "pack_count": 1, "base_quantity": 6, "base_unit": "pc"}),
    ("per kg", {"size_value": 1, "size_unit": "kg", "pack_count": 1, "base_quantity": 1, "base_unit": "kg"}),
    ("KG", {"size_value": 1, "size_unit": "kg", "pack_count": 1, "base_quantity": 1, "base_unit": "kg"}),
    ("كيلو", {"size_value": 1, "size_unit": "kg", "pack_count": 1, "base_quantity": 1, "base_unit": "kg"}),
    ("٥٠٠ جرام", {"size_value": 500, "size_unit": "g", "pack_count": 1, "base_quantity": 0.5, "base_unit": "kg"}),
    ("1.5 لتر", {"size_value": 1.5, "size_unit": "l", "pack_count": 1, "base_quantity": 1.5, "base_unit": "l"}),
    ("6 * 330ml", {"size_value": 330, "size_unit": "ml", "pack_count": 6, "base_quantity": 1.98, "base_unit": "l"}),
    ("24 x 200 ML", {"size_value": 200, "size_unit": "ml", "pack_count": 24, "base_quantity": 4.8, "base_unit": "l"}),
    ("1.000 kg", {"size_value": 1, "size_unit": "kg", "pack_count": 1, "base_quantity": 1, "base_unit": "kg"}),
    ("0.5kg", {"size_value": 0.5, "size_unit": "kg", "pack_count": 1, "base_quantity": 0.5, "base_unit": "kg"}),
    ("250 GM", {"size_value": 250, "size_unit": "g", "pack_count": 1, "base_quantity": 0.25, "base_unit": "kg"}),
    ("12 قطعة", {"size_value": 12, "size_unit": "pc", "pack_count": 1, "base_quantity": 12, "base_unit": "pc"}),
    ("3 x 1.5 ltr", {"size_value": 1.5, "size_unit": "l", "pack_count": 3, "base_quantity": 4.5, "base_unit": "l"}),
]
for text, exp in hand:
    add(text, exp)

# 3) strings that must NOT parse
for bad in [
    "", "   ", "Family Pack", "large", "1 bottle", "abc", "0g", "0 x 500g", "g", "500",
    "x2", "2 x", "-5kg", "5 kg kg", "Assorted", "N/A", "١٢٣", "1/2 kg", "500 grams approx",
]:
    add(bad, None)

assert len(cases) >= 200, len(cases)
(OUT / "size-cases.json").write_text(json.dumps(cases, ensure_ascii=False, indent=1) + "\n", "utf-8")

# ---- Arabic / search normalisation (hand-written) ----
arabic = [
    ("المَرَاعِي", "المراعي"),
    ("حليب", "حليب"),
    ("أرز", "ارز"),
    ("إناء", "اناء"),
    ("آمن", "امن"),
    ("ٱلله", "الله"),
    ("مدرسة", "مدرسه"),
    ("على", "علي"),
    ("مؤمن", "مومن"),
    ("شائع", "شايع"),
    ("١٢٣ جرام", "123 جرام"),
    ("٤٥٦", "456"),
    ("۷۸۹", "789"),
    ("كـــريم", "كريم"),
    ("Al-Marai Milk 1L", "al marai milk 1l"),
    ("  ALMARAI   Fresh ", "almarai fresh"),
    ("Coca‑Cola", "coca cola"),
    ("ＡＢＣ１２３", "abc123"),
    ("لبن ٢٥٠ مل", "لبن 250 مل"),
    ("Nestlé", "nestlé"),
    ("", ""),
    ("!!!", ""),
    ("رز بسمتي 5كجم", "رز بسمتي 5كجم"),
    ("حليب، طازج؟", "حليب طازج"),
    ("Rice_Basmati", "rice basmati"),
    ("زُبْدَة", "زبده"),
    ("أَلْبَان", "البان"),
    ("Mineral   Water\t500ml", "mineral water 500ml"),
    ("7UP", "7up"),
    ("مَاء", "ماء"),
]
(OUT / "arabic-cases.json").write_text(
    json.dumps([{"input": i, "expected": e} for i, e in arabic], ensure_ascii=False, indent=1) + "\n",
    "utf-8",
)
print(f"size cases: {len(cases)}, arabic cases: {len(arabic)}")

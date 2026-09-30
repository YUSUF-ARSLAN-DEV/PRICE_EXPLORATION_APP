"""Generate tests/gold/pairs.json (synthetic gold set) and baseline.json.

Labels are true BY CONSTRUCTION (same catalogue item vs different item); the matcher is never
called here. Run:  python scripts/gen_gold.py   (deterministic, seeded)
"""

import itertools
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "gold"
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(20260930)

# (brand_en, brand_ar, name_en, name_ar, variants[(en, ar)], sizes[(canonical, [en renderings], ar)])
S = lambda key, en, ar: (key, en, ar)  # noqa: E731
CATALOGUE = [
    (
        "Almarai",
        "المراعي",
        "Fresh Milk",
        "حليب طازج",
        [("Full Fat", "كامل الدسم"), ("Low Fat", "قليل الدسم"), ("Skimmed", "خالي الدسم")],
        [
            S("1l", ["1L", "1 L", "1 Ltr", "1 liter", "1000ml"], "1 لتر"),
            S("2l", ["2L", "2 Ltr", "2 liter"], "2 لتر"),
            S("500ml", ["500ml", "500 ML", "0.5L"], "500 مل"),
        ],
    ),
    (
        "Baladna",
        "بلدنا",
        "Fresh Milk",
        "حليب طازج",
        [("Full Fat", "كامل الدسم"), ("Low Fat", "قليل الدسم")],
        [S("1l", ["1L", "1 Ltr"], "1 لتر"), S("1.5l", ["1.5L", "1.5 Ltr", "1500ml"], "1.5 لتر")],
    ),
    (
        "Nadec",
        "نادك",
        "Laban",
        "لبن",
        [],
        [
            S("500ml", ["500ml", "500 ML"], "500 مل"),
            S("1l", ["1L", "1 Ltr"], "1 لتر"),
            S("2l", ["2L", "2 Ltr"], "2 لتر"),
        ],
    ),
    (
        "Lipton",
        "ليبتون",
        "Yellow Label Tea Bags",
        "شاي اكياس اصفر",
        [],
        [
            S("25pc", ["25 pcs", "25pcs", "25 pc"], "25 قطعة"),
            S("100pc", ["100 pcs", "100pcs"], "100 قطعة"),
            S("50pc", ["50 pcs", "50pcs"], "50 قطعة"),
        ],
    ),
    (
        "Nescafe",
        "نسكافيه",
        "Classic Instant Coffee",
        "قهوة فورية كلاسيك",
        [],
        [
            S("100g", ["100g", "100 gm", "100 g"], "100 غم"),
            S("200g", ["200g", "200 gm", "0.2kg"], "200 غم"),
            S("50g", ["50g", "50 gm"], "50 غم"),
        ],
    ),
    (
        "Coca-Cola",
        "كوكاكولا",
        "Soft Drink",
        "مشروب غازي",
        [("Zero", "زيرو"), ("Diet", "دايت")],
        [
            S("330ml", ["330ml", "330 ML"], "330 مل"),
            S("1.5l", ["1.5L", "1.5 Ltr"], "1.5 لتر"),
            S("6x330ml", ["6 x 330ml", "6x330ml", "6 x 330 ML"], "6 × 330 مل"),
        ],
    ),
    (
        "Pepsi",
        "بيبسي",
        "Soft Drink",
        "مشروب غازي",
        [("Diet", "دايت")],
        [S("330ml", ["330ml", "330 ML"], "330 مل"), S("2.25l", ["2.25L", "2.25 Ltr"], "2.25 لتر")],
    ),
    (
        "Indomie",
        "اندومي",
        "Chicken Noodles",
        "نودلز دجاج",
        [],
        [
            S("70g", ["70g", "70 gm"], "70 غم"),
            S("5x70g", ["5 x 70g", "5x70g"], "5 × 70 غم"),
            S("40x70g", ["40 x 70g", "40x70g"], "40 × 70 غم"),
        ],
    ),
    (
        "Tide",
        "تايد",
        "Laundry Detergent Powder",
        "مسحوق غسيل",
        [],
        [
            S("3kg", ["3kg", "3 kg", "3000g"], "3 كجم"),
            S("1.5kg", ["1.5kg", "1.5 kg", "1500g"], "1.5 كجم"),
            S("6kg", ["6kg", "6 kg"], "6 كجم"),
        ],
    ),
    (
        "Lurpak",
        "لورباك",
        "Butter",
        "زبدة",
        [("Salted", "مملحة"), ("Unsalted", "غير مملحة")],
        [S("200g", ["200g", "200 gm"], "200 غم"), S("400g", ["400g", "400 gm", "0.4kg"], "400 غم")],
    ),
    (
        "Kelloggs",
        "كيلوجز",
        "Corn Flakes",
        "رقائق الذرة",
        [],
        [S("375g", ["375g", "375 gm"], "375 غم"), S("750g", ["750g", "750 gm"], "750 غم")],
    ),
    (
        "Danone",
        "دانون",
        "Yogurt",
        "زبادي",
        [("Low Fat", "قليل الدسم"), ("Strawberry", "فراولة"), ("Vanilla", "فانيلا")],
        [
            S("120g", ["120g", "120 gm"], "120 غم"),
            S("4x120g", ["4 x 120g", "4x120g"], "4 × 120 غم"),
        ],
    ),
    (
        "Dettol",
        "ديتول",
        "Laundry Sanitiser",
        "معقم غسيل",
        [],
        [S("1l", ["1L", "1 Ltr"], "1 لتر"), S("2l", ["2L", "2 Ltr"], "2 لتر")],
    ),
    (
        "Baladna",
        "بلدنا",
        "Laban",
        "لبن",
        [],
        [S("1l", ["1L", "1 Ltr"], "1 لتر"), S("2l", ["2L", "2 Ltr"], "2 لتر")],
    ),
    (
        "Lipton",
        "ليبتون",
        "Green Tea Bags",
        "شاي اخضر اكياس",
        [("Lemon", "ليمون"), ("Mint", "نعناع")],
        [S("25pc", ["25 pcs", "25pcs"], "25 قطعة"), S("100pc", ["100 pcs", "100pcs"], "100 قطعة")],
    ),
    (
        "Nadec",
        "نادك",
        "Fresh Milk",
        "حليب طازج",
        [("Full Fat", "كامل الدسم"), ("Low Fat", "قليل الدسم")],
        [S("1l", ["1L", "1 Ltr"], "1 لتر"), S("2l", ["2L", "2 Ltr"], "2 لتر")],
    ),
    (
        "Fairy",
        "فيري",
        "Dishwashing Liquid",
        "سائل جلي",
        [("Lemon", "ليمون")],
        [
            S("400ml", ["400ml", "400 ML"], "400 مل"),
            S("750ml", ["750ml", "750 ML", "0.75L"], "750 مل"),
        ],
    ),
    (
        "Pampers",
        "بامبرز",
        "Baby Diapers",
        "حفاضات اطفال",
        [],
        [S("58pc", ["58 pcs", "58pcs"], "58 قطعة"), S("44pc", ["44 pcs", "44pcs"], "44 قطعة")],
    ),
    (
        "Kiri",
        "كيري",
        "Cheese Portions",
        "جبنة مثلثات",
        [("Low Fat", "قليل الدسم")],
        [S("8pc", ["8 pcs", "8pcs"], "8 قطع"), S("24pc", ["24 pcs", "24pcs"], "24 قطعة")],
    ),
    (
        "Almarai",
        "المراعي",
        "Juice",
        "عصير",
        [("Orange", "برتقال"), ("Apple", "تفاح"), ("Mango", "مانجو")],
        [
            S("1l", ["1L", "1 Ltr"], "1 لتر"),
            S("200ml", ["200ml", "200 ML"], "200 مل"),
            S("2l", ["2L", "2 Ltr"], "2 لتر"),
        ],
    ),
]


# item = (brand index, variant idx | None, size idx)
def items():
    for ci, (_, _, _, _, variants, sizes) in enumerate(CATALOGUE):
        for vi in [None] if not variants else range(len(variants)):
            for si in range(len(sizes)):
                yield ci, vi, si


def render_en(ci, vi, si, style, size_fmt):
    brand, _, name, _, variants, sizes = CATALOGUE[ci]
    variant = variants[vi][0] if vi is not None else ""
    size = sizes[si][1][size_fmt % len(sizes[si][1])]
    if style == 0:
        return {"name": f"{brand} {name} {variant} {size}".replace("  ", " ").strip()}
    if style == 1:
        return {"name": f"{name} {variant} - {brand} ({size})".replace("  ", " ")}
    if style == 2:
        return {
            "name": f"{brand} {name} {variant}".upper().replace("  ", " ").strip(),
            "size": size,
        }
    return {"name": f"{name} {brand} {variant}".lower().replace("  ", " ").strip(), "size": size}


def render_ar(ci, vi, si, style):
    _, brand_ar, _, name_ar, variants, sizes = CATALOGUE[ci]
    variant = variants[vi][1] if vi is not None else ""
    size = sizes[si][2]
    if style == 0:
        return {"name": f"{name_ar} {brand_ar} {variant} {size}".replace("  ", " ").strip()}
    return {"name": f"{brand_ar} {name_ar} {variant}".replace("  ", " ").strip(), "size": size}


all_items = list(items())
pairs = []

# positives: same item, different renderings
for it in all_items:
    ci, vi, si = it
    en_renders = [render_en(ci, vi, si, st, st + si) for st in range(4)]
    ar_renders = [render_ar(ci, vi, si, st) for st in range(2)]
    for a, b in itertools.combinations(en_renders, 2):
        pairs.append(
            {"a": a, "b": b, "same": True, "kind": "same-item/en-en", "cross_language": False}
        )
    for a, b in itertools.combinations(ar_renders, 2):
        pairs.append(
            {"a": a, "b": b, "same": True, "kind": "same-item/ar-ar", "cross_language": False}
        )
    for a in en_renders[:2]:
        for b in ar_renders:
            pairs.append(
                {"a": a, "b": b, "same": True, "kind": "same-item/en-ar", "cross_language": True}
            )

# hard negatives
for x, y in itertools.combinations(all_items, 2):
    (c1, v1, s1), (c2, v2, s2) = x, y
    b1, b2 = CATALOGUE[c1], CATALOGUE[c2]
    same_product = b1[2] == b2[2]
    if c1 == c2 and v1 == v2 and s1 != s2:
        kind = "diff-size"
    elif c1 == c2 and v1 != v2 and s1 == s2:
        kind = "diff-variant"
    elif c1 != c2 and same_product and b1[0] != b2[0] and v1 == v2 and b1[5][s1][0] == b2[5][s2][0]:
        kind = "diff-brand"
    elif c1 != c2 and b1[0] == b2[0] and b1[2] != b2[2] and rng.random() < 0.25:
        kind = "diff-product"
    else:
        continue
    st1, st2 = rng.randrange(4), rng.randrange(4)
    a = render_en(c1, v1, s1, st1, rng.randrange(5))
    b = render_en(c2, v2, s2, st2, rng.randrange(5))
    pairs.append({"a": a, "b": b, "same": False, "kind": kind, "cross_language": False})
    if rng.random() < 0.5:
        pairs.append(
            {
                "a": render_en(c1, v1, s1, st1, 0),
                "b": render_ar(c2, v2, s2, rng.randrange(2)),
                "same": False,
                "kind": kind + "/en-ar",
                "cross_language": True,
            }
        )

rng.shuffle(pairs)
(OUT / "pairs.json").write_text(json.dumps(pairs, ensure_ascii=False, indent=0) + "\n", "utf-8")
print(
    f"{len(pairs)} pairs ({sum(p['same'] for p in pairs)} same, {sum(not p['same'] for p in pairs)} different)"
)

if "--baseline" in sys.argv:
    sys.path.insert(0, str(ROOT / "src"))
    from qarib_matcher.gold import BASELINE, evaluate

    m = evaluate(OUT / "pairs.json")
    BASELINE.write_text(
        json.dumps({k: m[k] for k in m if not k.startswith(("false_", "missed_"))}, indent=2) + "\n"
    )
    print(json.dumps({k: m[k] for k in m if not k.startswith(("false_", "missed_"))}, indent=2))
    for k in ("false_auto", "missed_candidates"):
        for row in m[k][:8]:
            print(k, json.dumps(row, ensure_ascii=False))

"""Starter dictionaries (plan 4.3). EXTEND WITH REAL DATA once sources are approved.

All phrases are written in *search-normalised* form (see qarib_ingest.normalize.normalize_search):
lower-case, no diacritics, alef/ya/ta-marbuta unified (e.g. أ->ا, ة->ه, ى->ي), punctuation removed.
"""

# canonical brand name -> aliases (EN + AR spellings), normalised at load time.
BRANDS: dict[str, list[str]] = {
    "Almarai": ["almarai", "al marai", "المراعي"],
    "Baladna": ["baladna", "بلدنا"],
    "Nadec": ["nadec", "نادك"],
    "Nestle": ["nestle", "nestlé", "نستله"],
    "Nescafe": ["nescafe", "نسكافيه"],
    "Kelloggs": ["kelloggs", "kellogg s", "kellogg's", "كيلوجز", "كيلوغز"],
    "Lipton": ["lipton", "ليبتون"],
    "Tetley": ["tetley", "تيتلي"],
    "Coca-Cola": ["coca cola", "cocacola", "كوكاكولا", "كوكا كولا"],
    "Pepsi": ["pepsi", "بيبسي"],
    "Sprite": ["sprite", "سبرايت"],
    "Fanta": ["fanta", "فانتا"],
    "Indomie": ["indomie", "اندومي"],
    "Tide": ["tide", "تايد"],
    "Ariel": ["ariel", "اريال"],
    "Dettol": ["dettol", "ديتول"],
    "Fairy": ["fairy", "فيري"],
    "Pampers": ["pampers", "بامبرز"],
    "Huggies": ["huggies", "هاقيز"],
    "Danone": ["danone", "دانون"],
    "Lurpak": ["lurpak", "لورباك"],
    "Kiri": ["kiri", "كيري"],
    "Americana": ["americana", "امريكانا"],
    "Saudia": ["saudia", "السعودية"],
    "Rabea": ["rabea", "ربيع"],
    "Lulu": ["lulu", "لولو"],
}

STOPWORDS: frozenset[str] = frozenset(
    {"the", "of", "and", "with", "for", "in", "pack", "من", "و", "مع", "في", "عبوه"}
)

# Variant groups. Each phrase maps to (group, value). Groups in EXCLUSIVE_GROUPS cannot differ.
VARIANT_PHRASES: dict[str, tuple[str, str]] = {
    # fat level
    "full fat": ("fat", "full"),
    "whole": ("fat", "full"),
    "كامل الدسم": ("fat", "full"),
    "low fat": ("fat", "low"),
    "light": ("fat", "low"),
    "قليل الدسم": ("fat", "low"),
    "skimmed": ("fat", "none"),
    "skim": ("fat", "none"),
    "fat free": ("fat", "none"),
    "خالي الدسم": ("fat", "none"),
    # shelf life
    "long life": ("shelf", "long_life"),
    "uht": ("shelf", "long_life"),
    "طويل الاجل": ("shelf", "long_life"),
    "fresh": ("shelf", "fresh"),
    "طازج": ("shelf", "fresh"),
    # critical one-sided flags
    "organic": ("organic", "yes"),
    "عضوي": ("organic", "yes"),
    "lactose free": ("lactose_free", "yes"),
    "خالي من اللاكتوز": ("lactose_free", "yes"),
    "sugar free": ("sugar_free", "yes"),
    "no sugar": ("sugar_free", "yes"),
    "zero": ("sugar_free", "zero"),  # Coke Zero and Diet Coke are different products
    "diet": ("sugar_free", "diet"),
    "بدون سكر": ("sugar_free", "yes"),
    "خالي من السكر": ("sugar_free", "yes"),
    "زيرو": ("sugar_free", "zero"),
    "دايت": ("sugar_free", "diet"),
    "decaf": ("decaf", "yes"),
    "gluten free": ("gluten_free", "yes"),
    "خالي من الغلوتين": ("gluten_free", "yes"),
    "unsalted": ("salt", "unsalted"),
    "غير مملح": ("salt", "unsalted"),
    "غير مملحة": ("salt", "unsalted"),
    "salted": ("salt", "salted"),
    "مملح": ("salt", "salted"),
    "مملحة": ("salt", "salted"),
    "whole wheat": ("grain", "whole_wheat"),
    "قمح كامل": ("grain", "whole_wheat"),
}
# Groups where a value that is present on only ONE side means "different product".
CRITICAL_GROUPS: frozenset[str] = frozenset(
    {"organic", "lactose_free", "sugar_free", "decaf", "gluten_free", "salt", "grain", "flavour"}
)

FLAVOURS: dict[str, str] = {
    "chocolate": "chocolate", "شوكولاته": "chocolate", "شوكولا": "chocolate",
    "vanilla": "vanilla", "فانيلا": "vanilla",
    "strawberry": "strawberry", "فراوله": "strawberry",
    "banana": "banana", "موز": "banana",
    "mango": "mango", "مانجو": "mango",
    "orange": "orange", "برتقال": "orange",
    "apple": "apple", "تفاح": "apple",
    "lemon": "lemon", "ليمون": "lemon",
    "mint": "mint", "نعناع": "mint",
    "caramel": "caramel", "كراميل": "caramel",
    "coffee": "coffee", "قهوه": "coffee",
    "peach": "peach", "خوخ": "peach",
    "pineapple": "pineapple", "اناناس": "pineapple",
    "cherry": "cherry", "كرز": "cherry",
    "berry": "berry", "توت": "berry",
}  # fmt: skip

# Category rules: (slug, any-of phrases, excluded phrases). First match wins.
_BEEF_ETC = ["beef", "turkey", "chicken", "veal", "halal", "بقري", "ديك رومي", "دجاج", "حلال"]
CATEGORY_RULES: list[tuple[str, list[str], list[str]]] = [
    (
        "restricted-alcohol-tobacco",
        ["beer", "wine", "vodka", "whisky", "whiskey", "gin", "rum", "brandy", "champagne", "cigarette",
         "cigarettes", "cigar", "tobacco", "vape", "nicotine", "بيره", "نبيذ", "فودكا", "ويسكي", "سجائر",
         "سجاره", "تبغ", "سيجار", "معسل"],
        ["non alcoholic", "alcohol free", "0 alcohol", "root beer", "ginger beer", "بدون كحول"],
    ),
    ("restricted-pork", ["pork", "خنزير"], []),
    ("restricted-pork", ["bacon", "ham", "بيكون", "هام"], _BEEF_ETC),
    ("baby", ["diaper", "diapers", "nappies", "nappy", "infant formula", "baby", "حفاضات", "حليب اطفال"], []),
    ("frozen", ["frozen", "مجمد", "مجمده"], []),
    ("juice", ["juice", "nectar", "عصير"], []),
    ("soft-drinks", ["cola", "pepsi", "sprite", "fanta", "soda", "soft drink", "energy drink", "مشروب غازي", "كولا"], []),
    ("water", ["mineral water", "drinking water", "spring water", "water", "مياه", "ماء"], ["rose water", "ماء ورد"]),
    ("tea-coffee", ["tea", "coffee", "nescafe", "شاي", "قهوه", "نسكافيه"], []),
    ("long-life-milk", ["long life milk", "uht milk", "حليب طويل الاجل"], []),
    ("fresh-milk", ["fresh milk", "حليب طازج"], []),
    ("milk", ["milk", "حليب"], []),
    ("yogurt-laban", ["yogurt", "yoghurt", "laban", "لبن", "زبادي"], []),
    ("cheese", ["cheese", "جبن", "جبنه"], []),
    ("eggs", ["egg", "eggs", "بيض"], []),
    ("butter-cream", ["butter", "cream", "زبده", "قشطه", "كريمه"], []),
    ("rice", ["rice", "ارز", "رز"], []),
    ("pasta", ["pasta", "spaghetti", "macaroni", "noodles", "معكرونه", "سباغيتي", "نودلز"], []),
    ("flour", ["flour", "دقيق", "طحين"], []),
    ("oils", ["oil", "زيت"], []),
    ("sugar", ["sugar", "سكر"], ["sugar free", "no sugar", "بدون سكر", "خالي من السكر"]),
    ("spices", ["spice", "spices", "pepper", "cumin", "turmeric", "بهارات", "كمون", "كركم", "فلفل"], []),
    ("canned-food", ["canned", "tinned", "tin", "معلب", "معلبات"], []),
    ("chicken", ["chicken", "دجاج", "فراخ"], []),
    ("beef-lamb", ["beef", "lamb", "mutton", "veal", "لحم بقري", "لحم غنم", "ضان", "لحم"], []),
    ("fish-seafood", ["fish", "shrimp", "salmon", "prawns", "سمك", "روبيان", "جمبري"], []),
    ("bread", ["bread", "toast", "خبز", "توست"], []),
    ("cakes-sweets", ["cake", "cakes", "كعك", "كيك"], []),
    ("snacks", ["chips", "crisps", "biscuit", "biscuits", "popcorn", "شيبس", "بسكويت"], []),
    ("household", ["detergent", "cleaner", "bleach", "tissue", "dishwashing", "laundry", "منظف", "مناديل", "غسيل"], []),
    ("herbs", ["parsley", "coriander", "بقدونس", "كزبره"], []),
    ("vegetables", ["tomato", "tomatoes", "potato", "potatoes", "onion", "cucumber", "carrot", "طماطم", "بصل", "خيار", "جزر", "بطاطس"], []),
    ("fruit", ["apple", "banana", "grapes", "mango", "موز", "عنب", "مانجو", "تفاح"], []),
]  # fmt: skip

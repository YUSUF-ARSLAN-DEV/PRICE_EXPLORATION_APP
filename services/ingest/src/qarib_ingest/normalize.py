"""Text normalisation (plan 2.4).

Port of packages/shared/src/normalize.ts - both are tested against
packages/shared/fixtures/arabic-cases.json. Change them together.
"""

import re
import unicodedata

_TASHKEEL = re.compile("[ً-ٰٟـ]")
_ARABIC_INDIC = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_EASTERN_ARABIC_INDIC = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")
_LETTER_MAP = str.maketrans(
    {
        "آ": "ا",  # آ -> ا
        "أ": "ا",  # أ -> ا
        "إ": "ا",  # إ -> ا
        "ٱ": "ا",  # ٱ -> ا
        "ى": "ي",  # ى -> ي
        "ة": "ه",  # ة -> ه
        "ؤ": "و",  # ؤ -> و
        "ئ": "ي",  # ئ -> ي
    }
)
_NON_WORD = re.compile(r"[\W_]+")


def to_nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def normalize_digits(text: str) -> str:
    return text.translate(_ARABIC_INDIC).translate(_EASTERN_ARABIC_INDIC)


def normalize_search(text: str) -> str:
    """Search-normalised form; identical behaviour to the TypeScript implementation."""
    s = normalize_digits(unicodedata.normalize("NFKC", text)).lower()
    s = _TASHKEEL.sub("", s).translate(_LETTER_MAP)
    return _NON_WORD.sub(" ", s).strip()

import re
import unicodedata


CYRILLIC_TRANSLIT_MAP = {
    "а": "a",
    "б": "b",
    "в": "v",
    "г": "g",
    "д": "d",
    "е": "e",
    "ё": "yo",
    "ж": "zh",
    "з": "z",
    "и": "i",
    "й": "y",
    "к": "k",
    "л": "l",
    "м": "m",
    "н": "n",
    "о": "o",
    "п": "p",
    "р": "r",
    "с": "s",
    "т": "t",
    "у": "u",
    "ф": "f",
    "х": "kh",
    "ц": "ts",
    "ч": "ch",
    "ш": "sh",
    "щ": "shch",
    "ъ": "",
    "ы": "y",
    "ь": "",
    "э": "e",
    "ю": "yu",
    "я": "ya",
}


def _transliterate_cyrillic(value: str) -> str:
    return "".join(CYRILLIC_TRANSLIT_MAP.get(char, char) for char in value)


def generate_id(article: str) -> str:
    result = unicodedata.normalize("NFKC", article.strip())
    result = result.lower()
    result = _transliterate_cyrillic(result)
    result = result.replace(",", ".")
    result = re.sub(r"[^a-z0-9.-]", "-", result)
    result = re.sub(r"-{2,}", "-", result)
    result = result.strip(".-")

    if not result:
        raise ValueError("invalid article")

    return result

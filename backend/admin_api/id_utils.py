import re
import unicodedata
from typing import Optional

_POSE_KEY_RE = re.compile(r"^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$")

_CYRILLIC_TO_LATIN = {
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


def generate_id(article: str) -> str:
    result = article.strip()
    result = unicodedata.normalize("NFKC", result)
    result = result.lower()
    result = "".join(_CYRILLIC_TO_LATIN.get(ch, ch) for ch in result)
    result = result.replace(",", ".")
    result = re.sub(r"[^a-z0-9.-]", "-", result)
    result = re.sub(r"-{2,}", "-", result)
    result = result.strip(".-")

    if not result:
        raise ValueError("invalid article")

    return result


def normalize_pose_key(pose_key: Optional[str]) -> Optional[str]:
    if pose_key is None:
        return None

    normalized = pose_key.strip().lower()
    if not normalized:
        return None
    if normalized == "default":
        raise ValueError("poseKey 'default' is reserved for the base variant")
    if not _POSE_KEY_RE.fullmatch(normalized):
        raise ValueError("poseKey must match ^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$")
    return normalized


def generate_item_id(article: str, pose_key: Optional[str] = None) -> str:
    article_id = generate_id(article)
    normalized_pose_key = normalize_pose_key(pose_key)
    if normalized_pose_key is None:
        return article_id
    return f"{article_id}__{normalized_pose_key}"

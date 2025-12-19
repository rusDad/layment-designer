import re

def generate_id(article: str) -> str:
    result = article.lower()
    result = result.replace(",", ".")
    result = re.sub(r"[^a-z0-9.-]", "-", result)
    result = re.sub(r"-{2,}", "-", result)
    result = result.strip("-")

    if not result:
        raise ValueError("invalid article")

    return result

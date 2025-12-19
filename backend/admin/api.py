# admin/api.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import re

admin_app = FastAPI()


def generate_id(article: str) -> str:
    result = article.lower()
    result = result.replace(",", ".")
    result = re.sub(r"[^a-z0-9.-]", "-", result)
    result = re.sub(r"-{2,}", "-", result)
    result = result.strip("-")

    if not result:
        raise ValueError("invalid article")

    return result


class PreviewIdRequest(BaseModel):
    article: str


@admin_app.post("/api/preview-id")
def preview_id(data: PreviewIdRequest):
    try:
        return {"id": generate_id(data.article)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

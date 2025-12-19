# admin/api.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import re
from admin.manifest_service import load_manifest, save_manifest_atomic
from admin.id_utils import generate_id


admin_app = FastAPI()



class PreviewIdRequest(BaseModel):
    article: str


@admin_app.post("/api/preview-id")
def preview_id(data: PreviewIdRequest):
    try:
        return {"id": generate_id(data.article)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

class CreateItemRequest(BaseModel):
    article: str = Field(..., min_length=1)
    name: str
    brand: str
    category: str
    scaleOverride: Optional[float] = 1.0
    cuttingLengthMeters: float
    enabled: bool = True

@admin_app.post("/api/items")
def create_item(data: CreateItemRequest):
    item_id = generate_id(data.article)

    manifest = load_manifest()

    # Проверка уникальности id
    if any(item["id"] == item_id for item in manifest["items"]):
        raise HTTPException(
            status_code=400,
            detail=f"id '{item_id}' already exists"
        )

    new_item = {
        "id": item_id,
        "article": data.article,
        "name": data.name,
        "brand": data.brand,
        "category": data.category,
        "svg": None,
        "nc": None,
        "scaleOverride": data.scaleOverride,
        "cuttingLengthMeters": data.cuttingLengthMeters,
        "enabled": data.enabled
    }

    manifest["items"].append(new_item)
    manifest["version"] = manifest.get("version", 1) + 1

    save_manifest_atomic(manifest)

    return {"id": item_id}

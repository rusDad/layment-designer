# admin/api.py
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field
from typing import Optional
from admin_api.manifest_service import load_manifest, save_manifest_atomic
from admin_api.id_utils import generate_id
from admin_api.file_service import save_file, DIRS
from admin_api.file_validation import (
    validate_svg,
    validate_nc,
    validate_preview
)

router = APIRouter()



class PreviewIdRequest(BaseModel):
    article: str


@router.post("/preview-id")
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

@router.post("/items")
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
        "scaleOverride": data.scaleOverride,
        "cuttingLengthMeters": data.cuttingLengthMeters,
        "enabled": data.enabled
    }

    manifest["items"].append(new_item)
    manifest["version"] = manifest.get("version", 1) + 1

    save_manifest_atomic(manifest)

    return {"id": item_id}

@router.post("/items/{item_id}/files")
def upload_files(
    item_id: str,
    svg: UploadFile = File(...),
    nc: UploadFile = File(...),
    preview: Optional[UploadFile] = File(None),
    force: bool = Form(False)
):
    manifest = load_manifest()

    item = next(
        (i for i in manifest["items"] if i["id"] == item_id),
        None
    )
    if not item:
        raise HTTPException(404, "Item not found")

    validate_svg(svg)
    validate_nc(nc)
    if preview:
        validate_preview(preview)

    svg_path = save_file(
        svg,
        DIRS["svg"],
        f"{item_id}.svg",
        force
    )

    nc_path = save_file(
        nc,
        DIRS["nc"],
        f"{item_id}.nc",
        force
    )

    preview_path = None
    if preview:
        ext = preview.filename.split(".")[-1].lower()
        preview_path = save_file(
            preview,
            DIRS["preview"],
            f"{item_id}.{ext}",
            force
        )

    item["assets"] = {
        "svg": f"svg/{item_id}.svg",
        "nc": f"nc/{item_id}.nc",
        "preview": (
            f"preview/{preview_path.name}"
            if preview_path else None
        )
    }

    manifest["version"] += 1
    save_manifest_atomic(manifest)

    return {"status": "ok"}

@router.get("/items")
def list_items():
    manifest = load_manifest()
    return {
        "version": manifest.get("version"),
        "items": [
            {
                "id": i["id"],
                "article": i["article"],
                "name": i["name"],
                "enabled": i.get("enabled", True),
                "assets": i.get("assets")
            }
            for i in manifest["items"]
        ]
    }

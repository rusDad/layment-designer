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
from gcode_rotator import rotate_gcode_for_contour
from domain_store import CONTOURS_DIR
from pathlib import Path
import shutil

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

    existing_item = next(
        (item for item in manifest["items"] if item["id"] == item_id),
        None
    )

    if existing_item:
        existing_item["name"] = data.name
        existing_item["brand"] = data.brand
        existing_item["category"] = data.category
        existing_item["scaleOverride"] = data.scaleOverride
        existing_item["cuttingLengthMeters"] = data.cuttingLengthMeters
        existing_item["enabled"] = data.enabled
        mode = "updated"
    else:
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
        mode = "created"

    manifest["version"] = manifest.get("version", 1) + 1
    save_manifest_atomic(manifest)

    return {"id": item_id, "mode": mode}

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

    try:
        rotate_gcode_for_contour(item_id)
    except Exception as exc:
        svg_path.unlink(missing_ok=True)
        nc_path.unlink(missing_ok=True)
        if preview_path:
            preview_path.unlink(missing_ok=True)
        rotated_dir = CONTOURS_DIR / "nc" / item_id
        shutil.rmtree(rotated_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=str(exc))

    item["assets"] = {
        "svg": f"svg/{item_id}.svg",
        "nc": f"nc/{item_id}.nc",
        "preview": (
            f"preview/{preview_path.name}"
            if preview_path else None
        )
    }

    manifest["version"] = manifest.get("version", 1) + 1
    save_manifest_atomic(manifest)

    return {"status": "ok"}

@router.get("/items")
def list_items():
    manifest = load_manifest()
    preview_dir = CONTOURS_DIR / "preview"
    return {
        "version": manifest.get("version"),
        "items": [
            {
                "id": i["id"],
                "article": i["article"],
                "name": i["name"],
                "brand": i.get("brand", ""),
                "category": i.get("category", ""),
                "scaleOverride": i.get("scaleOverride", 1.0),
                "cuttingLengthMeters": i.get("cuttingLengthMeters", 0),
                "enabled": i.get("enabled", True),
                "assets": i.get("assets"),
                "files": _item_files_status(i, preview_dir),
                "previewUrl": _item_preview_url(i, preview_dir)
            }
            for i in manifest["items"]
        ]
    }


def _item_files_status(item: dict, preview_dir: Path) -> dict:
    item_id = item["id"]
    assets = item.get("assets") or {}
    svg_exists = (CONTOURS_DIR / "svg" / f"{item_id}.svg").exists()
    nc_exists = (CONTOURS_DIR / "nc" / f"{item_id}.nc").exists()
    preview_exists = _preview_file_path(item_id, assets, preview_dir) is not None
    return {
        "svg": svg_exists,
        "nc": nc_exists,
        "preview": preview_exists
    }


def _item_preview_url(item: dict, preview_dir: Path) -> Optional[str]:
    assets = item.get("assets") or {}
    preview_path = _preview_file_path(item["id"], assets, preview_dir)
    if not preview_path:
        return None
    relative = _preview_relative_path(preview_path, assets)
    return f"/contours/{relative}"


def _preview_file_path(item_id: str, assets: dict, preview_dir: Path) -> Optional[Path]:
    preview_asset = assets.get("preview")
    if preview_asset:
        normalized = preview_asset.lstrip("/")
        preview_path = CONTOURS_DIR / normalized
        if preview_path.exists():
            return preview_path
    for candidate in sorted(preview_dir.glob(f"{item_id}.*")):
        if candidate.is_file():
            return candidate
    return None


def _preview_relative_path(preview_path: Path, assets: dict) -> str:
    preview_asset = assets.get("preview")
    if preview_asset:
        normalized = preview_asset.lstrip("/")
        expected = CONTOURS_DIR / normalized
        if preview_path == expected:
            return normalized
    return preview_path.relative_to(CONTOURS_DIR).as_posix()

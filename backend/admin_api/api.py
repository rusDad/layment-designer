# admin/api.py
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field
from typing import Optional
import re
from admin_api.manifest_service import load_manifest, save_manifest_atomic
from admin_api.id_utils import generate_id
from admin_api.file_service import save_upload_file, DIRS
from admin_api.file_validation import (
    validate_svg,
    validate_nc,
    validate_preview
)
from admin_api.dxf_to_svg import convert as convert_dxf_to_svg
from gcode_rotator import rotate_gcode_for_contour
from domain_store import CONTOURS_DIR
from pathlib import Path
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
import logging
import os
import shutil
import uuid

router = APIRouter()
logger = logging.getLogger(__name__)

CATEGORY_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _sorted_categories(categories: dict) -> list[dict]:
    return sorted(
        [
            {
                "slug": slug,
                "label": (meta or {}).get("label", slug)
            }
            for slug, meta in categories.items()
            if isinstance(slug, str)
        ],
        key=lambda item: ((item["label"] or "").lower(), item["slug"])
    )


def _validate_category_slug(slug: str) -> str:
    normalized = (slug or "").strip()
    if not CATEGORY_SLUG_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid category slug. Use lowercase latin letters, digits, "
                "and dashes only (regex: ^[a-z0-9]+(?:-[a-z0-9]+)*$)."
            )
        )
    return normalized


def _validate_category_label(label: str) -> str:
    normalized = (label or "").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="Category label must not be empty")
    return normalized


def _normalize_asset_path(asset_path: Optional[str]) -> Optional[str]:
    if not isinstance(asset_path, str):
        return asset_path
    return asset_path.lstrip("/")


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


class UpsertCategoryRequest(BaseModel):
    slug: str
    label: str
    force: bool = False


@router.get("/categories")
def list_categories():
    manifest = load_manifest()
    categories = manifest.get("categories") or {}
    return {
        "version": manifest.get("version"),
        "categories": _sorted_categories(categories)
    }


@router.post("/categories")
def upsert_category(data: UpsertCategoryRequest):
    slug = _validate_category_slug(data.slug)
    label = _validate_category_label(data.label)

    manifest = load_manifest()
    categories = manifest.get("categories")
    if not isinstance(categories, dict):
        categories = {}

    mode = "created"
    if slug in categories:
        if not data.force:
            raise HTTPException(status_code=409, detail=f"Category '{slug}' already exists")
        mode = "updated"

    categories[slug] = {"label": label}
    manifest["categories"] = categories
    manifest["version"] = manifest.get("version", 1) + 1
    save_manifest_atomic(manifest)

    return {"slug": slug, "label": label, "mode": mode}


@router.post("/items")
def create_item(data: CreateItemRequest):
    item_id = generate_id(data.article)

    manifest = load_manifest()
    category_slug = (data.category or "").strip()
    categories = manifest.get("categories") or {}
    if category_slug and category_slug not in categories:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown category '{category_slug}'. "
                "Создайте категорию через /admin/api/categories"
            )
        )

    existing_item = next(
        (item for item in manifest["items"] if item["id"] == item_id),
        None
    )

    if existing_item:
        existing_item["name"] = data.name
        existing_item["brand"] = data.brand
        existing_item["category"] = category_slug
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
            "category": category_slug,
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

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    staging_token = f"{timestamp}_{uuid.uuid4().hex[:8]}"
    staging_root = CONTOURS_DIR / ".staging" / f"{item_id}_{staging_token}"
    staging_svg = staging_root / "svg" / f"{item_id}.svg"
    staging_nc = staging_root / "nc" / f"{item_id}.nc"
    staging_preview = None
    preview_ext = None
    if preview:
        preview_ext = preview.filename.split(".")[-1].lower()
        staging_preview = staging_root / "preview" / f"{item_id}.{preview_ext}"

    staging_root.mkdir(parents=True, exist_ok=True)
    (staging_root / "nc" / item_id).mkdir(parents=True, exist_ok=True)

    logger.info("Uploading files to staging %s", staging_root)
    save_upload_file(svg, staging_svg)
    save_upload_file(nc, staging_nc)
    if preview and staging_preview:
        save_upload_file(preview, staging_preview)

    svg_final = DIRS["svg"] / f"{item_id}.svg"
    nc_final = DIRS["nc"] / f"{item_id}.nc"
    preview_final = (
        (DIRS["preview"] / f"{item_id}.{preview_ext}")
        if preview_ext else None
    )

    if not force:
        conflict_path = None
        if svg_final.exists():
            conflict_path = svg_final
        elif nc_final.exists():
            conflict_path = nc_final
        elif preview_final and preview_final.exists():
            conflict_path = preview_final

        if conflict_path:
            shutil.rmtree(staging_root, ignore_errors=True)
            raise HTTPException(
                status_code=409,
                detail=f"File {conflict_path.name} already exists"
            )

    backup_dir = staging_root / "backup"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backups = {}
    new_files = []

    def backup_and_replace(staging_path: Path, final_path: Path):
        if final_path.exists():
            backup_path = backup_dir / f"{final_path.name}.bak_{staging_token}"
            os.replace(final_path, backup_path)
            backups[final_path] = backup_path
            logger.info("Backed up %s to %s", final_path, backup_path)
        else:
            new_files.append(final_path)
        os.replace(staging_path, final_path)
        logger.info("Replaced %s from staging", final_path)

    rotated_dir = CONTOURS_DIR / "nc" / item_id
    rotated_backup = None
    rotated_existed = rotated_dir.exists()
    if rotated_existed:
        rotated_backup = backup_dir / f"{item_id}.rotated.bak_{staging_token}"
        os.replace(rotated_dir, rotated_backup)
        logger.info("Backed up rotated dir %s to %s", rotated_dir, rotated_backup)

    swap_started = False
    try:
        swap_started = True
        backup_and_replace(staging_svg, svg_final)
        backup_and_replace(staging_nc, nc_final)
        if staging_preview and preview_final:
            backup_and_replace(staging_preview, preview_final)
        swap_started = True
        rotate_gcode_for_contour(item_id)
    except Exception as exc:
        if swap_started:
            logger.warning("Upload failed, rolling back files for %s", item_id, exc_info=True)
            if rotated_dir.exists():
                shutil.rmtree(rotated_dir, ignore_errors=True)
            if rotated_backup and rotated_backup.exists():
                os.replace(rotated_backup, rotated_dir)
                logger.info("Restored rotated dir from backup %s", rotated_backup)
            for final_path, backup_path in backups.items():
                if backup_path.exists():
                    os.replace(backup_path, final_path)
                    logger.info("Restored %s from backup", final_path)
            for final_path in new_files:
                if final_path.exists():
                    rollback_path = backup_dir / f"{final_path.name}.rollback_{staging_token}"
                    os.replace(final_path, rollback_path)
                    logger.info("Moved new file %s to rollback stash", final_path)
        shutil.rmtree(staging_root, ignore_errors=True)
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=400, detail=str(exc))
    else:
        logger.info("Upload committed for %s, cleaning backups", item_id)
        shutil.rmtree(backup_dir, ignore_errors=True)
        shutil.rmtree(staging_root, ignore_errors=True)

    item["assets"] = {
        "svg": f"svg/{item_id}.svg",
        "nc": f"nc/{item_id}.nc",
        "preview": (
            f"preview/{preview_final.name}"
            if preview_final else None
        )
    }

    manifest["version"] = manifest.get("version", 1) + 1
    save_manifest_atomic(manifest)

    return {"status": "ok"}


@router.post("/items/{item_id}/dxf-to-svg")
def upload_dxf_convert_to_svg(
    item_id: str,
    dxf: UploadFile = File(...),
    force: bool = Form(False)
):
    manifest = load_manifest()

    item = next(
        (i for i in manifest["items"] if i["id"] == item_id),
        None
    )
    if not item:
        raise HTTPException(404, "Item not found")

    if not dxf.filename or not dxf.filename.lower().endswith(".dxf"):
        raise HTTPException(status_code=400, detail="DXF file is required")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    staging_token = f"{timestamp}_{uuid.uuid4().hex[:8]}"
    staging_root = CONTOURS_DIR / ".staging" / f"{item_id}_{staging_token}"
    staging_dxf = staging_root / "input" / f"{item_id}.dxf"
    staging_svg = staging_root / "svg" / f"{item_id}.svg"

    staging_root.mkdir(parents=True, exist_ok=True)
    staging_svg.parent.mkdir(parents=True, exist_ok=True)

    logger.info("Uploading DXF to staging %s", staging_root)
    save_upload_file(dxf, staging_dxf)

    try:
        convert_dxf_to_svg(staging_dxf, staging_svg)
    except Exception as exc:
        shutil.rmtree(staging_root, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"DXF conversion failed: {exc}")

    try:
        with staging_svg.open("rb") as svg_fp:
            ET.parse(svg_fp)
    except Exception:
        shutil.rmtree(staging_root, ignore_errors=True)
        raise HTTPException(status_code=400, detail="DXF conversion failed: invalid SVG output")

    svg_final = DIRS["svg"] / f"{item_id}.svg"

    if not force and svg_final.exists():
        shutil.rmtree(staging_root, ignore_errors=True)
        raise HTTPException(
            status_code=409,
            detail=f"File {svg_final.name} already exists"
        )

    backup_dir = staging_root / "backup"
    backup_dir.mkdir(parents=True, exist_ok=True)
    svg_backup = None
    created_new = False

    try:
        if svg_final.exists():
            svg_backup = backup_dir / f"{svg_final.name}.bak_{staging_token}"
            os.replace(svg_final, svg_backup)
            logger.info("Backed up %s to %s", svg_final, svg_backup)
        else:
            created_new = True

        os.replace(staging_svg, svg_final)
        logger.info("Replaced %s from staged DXF conversion", svg_final)
    except Exception as exc:
        logger.warning("DXF upload failed, rolling back files for %s", item_id, exc_info=True)
        if svg_backup and svg_backup.exists():
            if svg_final.exists():
                rollback_path = backup_dir / f"{svg_final.name}.rollback_{staging_token}"
                os.replace(svg_final, rollback_path)
            os.replace(svg_backup, svg_final)
            logger.info("Restored %s from backup", svg_final)
        elif created_new and svg_final.exists():
            rollback_path = backup_dir / f"{svg_final.name}.rollback_{staging_token}"
            os.replace(svg_final, rollback_path)
            logger.info("Moved new file %s to rollback stash", svg_final)
        shutil.rmtree(staging_root, ignore_errors=True)
        raise HTTPException(status_code=400, detail=str(exc))
    else:
        logger.info("DXF conversion committed for %s, cleaning backups", item_id)
        shutil.rmtree(backup_dir, ignore_errors=True)
        shutil.rmtree(staging_root, ignore_errors=True)

    assets = item.get("assets") or {}
    item["assets"] = {
        "svg": f"svg/{item_id}.svg",
        "nc": _normalize_asset_path(assets.get("nc")),
        "preview": _normalize_asset_path(assets.get("preview"))
    }

    manifest["version"] = manifest.get("version", 1) + 1
    save_manifest_atomic(manifest)

    return {"status": "ok", "svg": f"svg/{item_id}.svg"}

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
        normalized = _normalize_asset_path(preview_asset)
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
        normalized = _normalize_asset_path(preview_asset)
        expected = CONTOURS_DIR / normalized
        if preview_path == expected:
            return normalized
    return preview_path.relative_to(CONTOURS_DIR).as_posix()

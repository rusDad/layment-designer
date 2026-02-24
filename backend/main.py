from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from admin_api.api import router as admin_router
from domain_store import BASE_DIR, CONTOURS_DIR, MANIFEST_PATH
from pydantic import BaseModel
from typing import Any, List, Optional, Dict
from datetime import datetime, timezone
from uuid import uuid4
from pathlib import Path
import logging
import base64
import binascii
import shutil
import os
import json
from services.gcode_engine import GCodeEngineError, build_final_gcode
from services.order_dxf import generate_order_layout_dxf, generate_order_layout_dxf_cad
from services.pricing import calculate_price_preview


app = FastAPI()

public_router = APIRouter()
admin_orders_router = APIRouter()
logger = logging.getLogger(__name__)




class OrderMeta(BaseModel):
    width: float
    height: float
    units: str
    coordinateSystem: Optional[str] = None
    baseMaterialColor: Optional[str] = None
    laymentType: Optional[str] = None
    pricePreview: Optional[Dict[str, Any]] = None
    workspaceSnapshot: Optional[Dict[str, Any]] = None
    canvasPng: Optional[str] = None


class CustomerInfo(BaseModel):
    name: str
    contact: str


class ContourPlacement(BaseModel):
    id: str
    x: float
    y: float
    angle: float
    scaleOverride: Optional[float] = None


class LabelPlacement(BaseModel):
    contourId: str
    text: str
    x: float
    y: float
    fontSizeMm: Optional[float] = None


class ExportRequest(BaseModel):
    orderMeta: OrderMeta
    contours: List[ContourPlacement]
    primitives: Optional[List[Dict[str, Any]]] = None
    labels: Optional[List[LabelPlacement]] = None
    customer: Optional[CustomerInfo] = None


def _orders_dir() -> Path:
    return BASE_DIR / "orders"


def _order_dir(order_id: str) -> Path:
    if not order_id or "/" in order_id or "\\" in order_id:
        raise HTTPException(status_code=404, detail="Order not found")
    order_dir = _orders_dir() / order_id
    if not order_dir.exists() or not order_dir.is_dir():
        raise HTTPException(status_code=404, detail="Order not found")
    return order_dir


def _read_json_if_exists(file_path: Path) -> Optional[Dict[str, Any]]:
    if not file_path.exists() or not file_path.is_file():
        return None
    with file_path.open("r", encoding="utf-8") as file:
        return json.load(file)


def _write_json(file_path: Path, data: Dict[str, Any]) -> None:
    with file_path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def _load_order_status(order_dir: Path) -> Dict[str, Any]:
    return _read_json_if_exists(order_dir / "status.json") or {}


def _extract_order_number_value(value: Any) -> Optional[int]:
    if not isinstance(value, str) or not value.startswith("K-"):
        return None
    number_part = value[2:]
    if not number_part.isdigit():
        return None
    return int(number_part)


def _read_order_number(order_dir: Path) -> Optional[str]:
    meta = _read_json_if_exists(order_dir / "meta.json") or {}
    order_number = meta.get("orderNumber")
    if isinstance(order_number, str) and order_number:
        return order_number

    order_payload = _read_json_if_exists(order_dir / "order.json") or {}
    payload_order_number = order_payload.get("orderNumber")
    if isinstance(payload_order_number, str) and payload_order_number:
        return payload_order_number

    return None


def _next_order_number(orders_dir: Path) -> str:
    max_number = 0
    if orders_dir.exists():
        for order_dir in orders_dir.iterdir():
            if not order_dir.is_dir() or order_dir.name.startswith("."):
                continue
            existing_order_number = _read_order_number(order_dir)
            numeric_value = _extract_order_number_value(existing_order_number)
            if numeric_value is not None and numeric_value > max_number:
                max_number = numeric_value
    return f"K-{max_number + 1:05d}"


def _require_order_number(order_dir: Path) -> str:
    order_number = _read_order_number(order_dir)
    if not order_number:
        raise HTTPException(status_code=500, detail="Order is missing orderNumber")
    return order_number


def _artifact_path(order_dir: Path, order_number: str, ext: str) -> Path:
    return order_dir / f"{order_number}.{ext}"


def _update_order_status(order_id: str, *, field: str, timestamp_field: str) -> Dict[str, Any]:
    order_dir = _order_dir(order_id)
    status_path = order_dir / "status.json"
    status = _load_order_status(order_dir)

    if status.get(field) is True:
        return status

    status[field] = True
    status[timestamp_field] = datetime.now(timezone.utc).isoformat()
    _write_json(status_path, status)
    return status


def _notify_production(order_id: str) -> None:
    # TODO: notify_production(order_id) integration (email/Jira/1C).
    _ = order_id


def _order_meta_from_order_json(order_payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(order_payload, dict):
        return {}
    direct_meta = order_payload.get("orderMeta")
    if isinstance(direct_meta, dict):
        return direct_meta
    nested_meta = (order_payload.get("payload") or {}).get("orderMeta")
    return nested_meta if isinstance(nested_meta, dict) else {}


def _derive_order_state(status_data: Dict[str, Any]) -> str:
    if status_data.get("produced") is True:
        return "produced"
    if status_data.get("confirmed") is True:
        return "confirmed"
    return "created"


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _max_iso_timestamp(*values: Any) -> Optional[str]:
    timestamps = [candidate for candidate in (_parse_iso_datetime(value) for value in values) if candidate is not None]
    if not timestamps:
        return None
    return max(timestamps).isoformat()


def _order_preview_png_path(order_dir: Path, order_number: Optional[str]) -> Optional[Path]:
    if order_number:
        numbered_preview = order_dir / f"{order_number}.png"
        if numbered_preview.exists() and numbered_preview.is_file():
            return numbered_preview

    legacy_preview = order_dir / "layout.png"
    if legacy_preview.exists() and legacy_preview.is_file():
        return legacy_preview

    return None


def _build_order_contents(order_payload: Dict[str, Any]) -> List[Dict[str, str]]:
    contours = order_payload.get("contours") if isinstance(order_payload, dict) else None
    if not isinstance(contours, list) or not contours:
        return []

    manifest_items_by_id: Dict[str, Dict[str, Any]] = {}
    if MANIFEST_PATH.exists():
        try:
            with MANIFEST_PATH.open("r", encoding="utf-8") as manifest_file:
                manifest = json.load(manifest_file)
            items = manifest.get("items")
            if isinstance(items, list):
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    item_id = item.get("id")
                    if isinstance(item_id, str) and item_id:
                        manifest_items_by_id[item_id] = item
        except (OSError, json.JSONDecodeError):
            logger.warning("Failed to read manifest for order contents", exc_info=True)

    composition: List[Dict[str, str]] = []
    for contour in contours:
        if not isinstance(contour, dict):
            continue

        contour_id = contour.get("id")
        if not isinstance(contour_id, str) or not contour_id:
            continue

        manifest_item = manifest_items_by_id.get(contour_id)
        if manifest_item:
            article = manifest_item.get("article")
            name = manifest_item.get("name")
        else:
            article = contour.get("article")
            name = "(не найдено в каталоге)"

        composition.append({
            "article": article if isinstance(article, str) and article else contour_id,
            "name": name if isinstance(name, str) and name else "(не найдено в каталоге)",
        })

    return composition


@public_router.get("/contours/manifest")
def get_contours_manifest():
    if not MANIFEST_PATH.exists():
        return {"error": "manifest.json not found"}

    with MANIFEST_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


@public_router.post("/export-layment")
async def export_layment(payload: Dict[str, Any]):
    try:
        order_data = ExportRequest.model_validate(payload)
        price_preview = calculate_price_preview(order_data)
        final_gcode = build_final_gcode(order_data)

        manifest_version = None
        if MANIFEST_PATH.exists():
            with MANIFEST_PATH.open('r', encoding='utf-8') as manifest_file:
                manifest_version = json.load(manifest_file).get('version')

        order_id = uuid4().hex[:12]
        orders_dir = _orders_dir()
        orders_dir.mkdir(parents=True, exist_ok=True)
        order_number = _next_order_number(orders_dir)

        while (orders_dir / order_id).exists():
            order_id = uuid4().hex[:12]

        staging_dir = orders_dir / f".{order_id}.staging"
        if staging_dir.exists():
            shutil.rmtree(staging_dir)

        final_order_dir = orders_dir / order_id

        try:
            staging_dir.mkdir(parents=True, exist_ok=False)

            created_at = datetime.now(timezone.utc).isoformat()

            stored_payload = dict(payload)
            stored_payload["orderNumber"] = order_number
            stored_payload_order_meta = stored_payload.get("orderMeta")
            if isinstance(stored_payload_order_meta, dict):
                stored_payload_order_meta["pricePreview"] = price_preview

            with (staging_dir / "order.json").open('w', encoding='utf-8') as order_file:
                json.dump(stored_payload, order_file, ensure_ascii=False, indent=2)

            meta = {
                "timestamp": created_at,
                "manifest": {
                    "version": manifest_version,
                },
                "orderNumber": order_number,
            }
            meta["pricePreview"] = price_preview

            with (staging_dir / "meta.json").open('w', encoding='utf-8') as meta_file:
                json.dump(meta, meta_file, ensure_ascii=False, indent=2)

            status = {
                "createdAt": created_at,
                "confirmed": False,
                "confirmedAt": None,
                "produced": False,
                "producedAt": None,
            }

            with (staging_dir / "status.json").open('w', encoding='utf-8') as status_file:
                json.dump(status, status_file, ensure_ascii=False, indent=2)

            with (staging_dir / f"{order_number}.nc").open('w', encoding='utf-8') as output_file:
                output_file.write('\n'.join(final_gcode))

            dxf_content, missing_contours = generate_order_layout_dxf(order_data)
            dxf_cad_content, missing_contours_cad = generate_order_layout_dxf_cad(order_data, include_labels=True)
            with (staging_dir / f"{order_number}_minimal.dxf").open('w', encoding='utf-8') as dxf_file:
                dxf_file.write(dxf_content)
            with (staging_dir / f"{order_number}.dxf").open('w', encoding='utf-8') as dxf_labels_file:
                dxf_labels_file.write(dxf_cad_content)
            meta["dxf"] = {
                "generated": len(missing_contours) == 0,
                "missingContours": missing_contours,
                "minimalFile": f"{order_number}_minimal.dxf",
                "cadFile": f"{order_number}.dxf",
                "cadGenerated": len(missing_contours_cad) == 0,
                "cadMissingContours": missing_contours_cad,
            }
            with (staging_dir / "meta.json").open('w', encoding='utf-8') as meta_file:
                json.dump(meta, meta_file, ensure_ascii=False, indent=2)

            raw_payload = payload

            layout_svg = raw_payload.get("layoutSvg") or raw_payload.get("layout_svg")
            if isinstance(layout_svg, str) and layout_svg.strip():
                with (staging_dir / f"{order_number}.svg").open('w', encoding='utf-8') as svg_file:
                    svg_file.write(layout_svg)

            layout_png = raw_payload.get("layoutPng") or raw_payload.get("layout_png")
            if isinstance(layout_png, str) and layout_png.strip():
                raw_png = layout_png.strip()
                encoded_png = raw_png
                if raw_png.startswith("data:image/png;base64,"):
                    encoded_png = raw_png.split(",", 1)[1]
                try:
                    png_bytes = base64.b64decode(encoded_png, validate=True)
                    with (staging_dir / f"{order_number}.png").open('wb') as png_file:
                        png_file.write(png_bytes)
                except (ValueError, binascii.Error):
                    logger.warning("Failed to decode layoutPng as base64 for order %s", order_id)
                    with (staging_dir / f"{order_number}.png").open('w', encoding='utf-8') as png_file:
                        png_file.write(layout_png)

            os.replace(staging_dir, final_order_dir)
        except Exception:
            if staging_dir.exists():
                shutil.rmtree(staging_dir)
            raise

        response: Dict[str, Any] = {
            "orderId": order_id,
            "orderNumber": order_number,
            "createdAt": created_at,
            "status": status,
        }
        response["pricePreview"] = price_preview
        return response
    except HTTPException:
        raise
    except GCodeEngineError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@public_router.get("/orders/{order_id}")
def get_order_status(order_id: str):
    order_dir = _order_dir(order_id)
    status_data = _load_order_status(order_dir)
    order_number = _read_order_number(order_dir)
    meta = _read_json_if_exists(order_dir / "meta.json") or {}
    order_payload = _read_json_if_exists(order_dir / "order.json") or {}
    order_meta = _order_meta_from_order_json(order_payload)
    customer = order_payload.get("customer") if isinstance(order_payload.get("customer"), dict) else None

    created_at = status_data.get("createdAt")
    if not isinstance(created_at, str) or not created_at:
        created_at = datetime.fromtimestamp(order_dir.stat().st_mtime, timezone.utc).isoformat()

    confirmed_at = status_data.get("confirmedAt") if isinstance(status_data.get("confirmedAt"), str) else None
    produced_at = status_data.get("producedAt") if isinstance(status_data.get("producedAt"), str) else None
    updated_at = _max_iso_timestamp(created_at, confirmed_at, produced_at)

    response: Dict[str, Any] = {
        "orderId": order_id,
        "orderNumber": order_number,
        "state": _derive_order_state(status_data),
        "createdAt": created_at,
        "confirmedAt": confirmed_at,
        "producedAt": produced_at,
        "updatedAt": updated_at,
        "contents": _build_order_contents(order_payload),
        "customer": customer,
        "baseMaterialColor": order_meta.get("baseMaterialColor"),
    }

    preview_path = _order_preview_png_path(order_dir, order_number)
    response["previewPngUrl"] = f"/api/orders/{order_id}/preview.png" if preview_path else None

    price_preview = meta.get("pricePreview")
    if isinstance(price_preview, dict):
        response["price"] = {
            "material": price_preview.get("material"),
            "cutting": price_preview.get("cutting"),
            "total": price_preview.get("total"),
        }

    return response


@public_router.get("/orders/{order_id}/preview.png")
def get_order_preview_png(order_id: str):
    order_dir = _order_dir(order_id)
    order_number = _read_order_number(order_dir)
    preview_path = _order_preview_png_path(order_dir, order_number)
    if preview_path is None:
        raise HTTPException(status_code=404, detail="preview.png not found")
    return FileResponse(preview_path, media_type="image/png", filename="preview.png")


@admin_orders_router.get("/orders")
def list_orders():
    orders_dir = _orders_dir()
    if not orders_dir.exists():
        return []

    orders = []
    for order_dir in orders_dir.iterdir():
        if not order_dir.is_dir() or order_dir.name.startswith("."):
            continue

        status_data = _read_json_if_exists(order_dir / "status.json") or {}
        order_number = _read_order_number(order_dir)
        order_payload = _read_json_if_exists(order_dir / "order.json") or {}
        order_meta = _order_meta_from_order_json(order_payload)
        created_at = status_data.get("createdAt")
        if not isinstance(created_at, str) or not created_at:
            created_at = datetime.fromtimestamp(order_dir.stat().st_mtime, timezone.utc).isoformat()

        orders.append({
            "orderId": order_dir.name,
            "orderNumber": order_number,
            "createdAt": created_at,
            "confirmed": bool(status_data.get("confirmed", False)),
            "produced": bool(status_data.get("produced", False)),
            "width": order_meta.get("width"),
            "height": order_meta.get("height"),
            "hasLayoutPng": (order_dir / f"{order_number}.png").exists() if order_number else False,
        })

    def sort_key(item: Dict[str, Any]) -> datetime:
        created = item.get("createdAt")
        if isinstance(created, str):
            normalized = created.replace("Z", "+00:00")
            try:
                return datetime.fromisoformat(normalized)
            except ValueError:
                pass
        return datetime.fromtimestamp(0, timezone.utc)

    orders.sort(key=sort_key, reverse=True)
    return orders


@admin_orders_router.get("/orders/{order_id}")
def get_order_details(order_id: str):
    order_dir = _order_dir(order_id)
    status_data = _read_json_if_exists(order_dir / "status.json") or {}
    order_payload = _read_json_if_exists(order_dir / "order.json") or {}
    order_number = _require_order_number(order_dir)
    order_meta = _order_meta_from_order_json(order_payload)

    return {
        "orderId": order_id,
        "orderNumber": order_number,
        "status": status_data,
        "orderMeta": order_meta,
        "customer": order_payload.get("customer") if isinstance(order_payload.get("customer"), dict) else None,
        "contours": order_payload.get("contours") or [],
        "primitives": order_payload.get("primitives") or [],
        "files": {
            "gcodeNc": f"/admin/api/orders/{order_id}/artifacts/cnc.nc",
            "previewPng": f"/admin/api/orders/{order_id}/artifacts/preview.png" if (order_dir / f"{order_number}.png").exists() else None,
            "previewSvg": f"/admin/api/orders/{order_id}/artifacts/preview.svg" if (order_dir / f"{order_number}.svg").exists() else None,
            "laserDxf": f"/admin/api/orders/{order_id}/artifacts/laser.dxf" if (order_dir / f"{order_number}.dxf").exists() else None,
        },
    }




def _write_status(order_dir: Path, status_data: Dict[str, Any]) -> None:
    with (order_dir / "status.json").open("w", encoding="utf-8") as status_file:
        json.dump(status_data, status_file, ensure_ascii=False, indent=2)


def _mark_order_status(order_id: str, status_field: str, time_field: str):
    order_dir = _order_dir(order_id)
    status_data = _read_json_if_exists(order_dir / "status.json") or {}

    if status_data.get(status_field):
        return {"orderId": order_id, "status": status_data}

    status_data[status_field] = True
    status_data[time_field] = datetime.now(timezone.utc).isoformat()
    if not status_data.get("createdAt"):
        status_data["createdAt"] = datetime.fromtimestamp(order_dir.stat().st_mtime, timezone.utc).isoformat()

    _write_status(order_dir, status_data)
    return {"orderId": order_id, "status": status_data}

def _serve_order_file(order_id: str, filename: str, media_type: Optional[str] = None, download_name: Optional[str] = None) -> FileResponse:
    order_dir = _order_dir(order_id)
    file_path = order_dir / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"{filename} not found")
    return FileResponse(file_path, filename=download_name or filename, media_type=media_type)


def _serve_order_number_artifact(order_id: str, ext: str, media_type: str, download_name_ext: Optional[str] = None) -> FileResponse:
    order_dir = _order_dir(order_id)
    order_number = _require_order_number(order_dir)
    artifact_path = _artifact_path(order_dir, order_number, ext)
    if not artifact_path.exists() or not artifact_path.is_file():
        raise HTTPException(status_code=404, detail=f"{order_number}.{ext} not found")
    filename_ext = download_name_ext or ext
    return FileResponse(artifact_path, filename=f"{order_number}.{filename_ext}", media_type=media_type)


@admin_orders_router.get("/orders/{order_id}/artifacts/cnc.nc")
def download_gcode_nc(order_id: str):
    return _serve_order_number_artifact(order_id, "nc", media_type="text/plain")


@admin_orders_router.get("/orders/{order_id}/artifacts/preview.png")
def download_preview_png(order_id: str):
    return _serve_order_number_artifact(order_id, "png", media_type="image/png")


@admin_orders_router.get("/orders/{order_id}/artifacts/preview.svg")
def download_preview_svg(order_id: str):
    return _serve_order_number_artifact(order_id, "svg", media_type="image/svg+xml")


@admin_orders_router.get("/orders/{order_id}/artifacts/laser.dxf")
def download_laser_dxf(order_id: str):
    return _serve_order_number_artifact(order_id, "dxf", media_type="application/dxf")


@admin_orders_router.get("/orders/{order_id}/order.json")
def download_order_json(order_id: str):
    return _serve_order_file(order_id, "order.json", media_type="application/json")


@admin_orders_router.get("/orders/{order_id}/meta.json")
def download_meta_json(order_id: str):
    return _serve_order_file(order_id, "meta.json", media_type="application/json")


@admin_orders_router.get("/orders/{order_id}/status.json")
def download_status_json(order_id: str):
    return _serve_order_file(order_id, "status.json", media_type="application/json")



@admin_orders_router.post("/orders/{order_id}/confirm")
def mark_order_confirmed(order_id: str):
    return _mark_order_status(order_id, "confirmed", "confirmedAt")


@admin_orders_router.post("/orders/{order_id}/produced")
def mark_order_produced(order_id: str):
    return _mark_order_status(order_id, "produced", "producedAt")

app.include_router(public_router, prefix="/api")
app.include_router(admin_router, prefix="/admin/api")
app.include_router(admin_orders_router, prefix="/admin/api")

app.mount("/contours", StaticFiles(directory=str(CONTOURS_DIR)), name="contours")
app.mount("/admin", StaticFiles(directory=str(BASE_DIR / "admin"), html=True), name="admin")

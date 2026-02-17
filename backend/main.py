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


app = FastAPI()

public_router = APIRouter()
admin_orders_router = APIRouter()
logger = logging.getLogger(__name__)




class OrderMeta(BaseModel):
    width: float
    height: float
    units: str
    coordinateSystem: Optional[str] = None
    pricePreview: Optional[Dict[str, Any]] = None
    workspaceSnapshot: Optional[Dict[str, Any]] = None
    canvasPng: Optional[str] = None


class ContourPlacement(BaseModel):
    id: str
    x: float
    y: float
    angle: float
    scaleOverride: Optional[float] = None


class ExportRequest(BaseModel):
    orderMeta: OrderMeta
    contours: List[ContourPlacement]
    primitives: Optional[List[Dict[str, Any]]] = None


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


def _order_meta_from_order_json(order_payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(order_payload, dict):
        return {}
    direct_meta = order_payload.get("orderMeta")
    if isinstance(direct_meta, dict):
        return direct_meta
    nested_meta = (order_payload.get("payload") or {}).get("orderMeta")
    return nested_meta if isinstance(nested_meta, dict) else {}


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
        final_gcode = build_final_gcode(order_data)

        manifest_version = None
        if MANIFEST_PATH.exists():
            with MANIFEST_PATH.open('r', encoding='utf-8') as manifest_file:
                manifest_version = json.load(manifest_file).get('version')

        order_id = uuid4().hex[:12]
        orders_dir = _orders_dir()
        orders_dir.mkdir(parents=True, exist_ok=True)

        while (orders_dir / order_id).exists():
            order_id = uuid4().hex[:12]

        staging_dir = orders_dir / f".{order_id}.staging"
        if staging_dir.exists():
            shutil.rmtree(staging_dir)

        final_order_dir = orders_dir / order_id

        try:
            staging_dir.mkdir(parents=True, exist_ok=False)

            created_at = datetime.now(timezone.utc).isoformat()

            with (staging_dir / "order.json").open('w', encoding='utf-8') as order_file:
                json.dump(payload, order_file, ensure_ascii=False, indent=2)

            meta = {
                "timestamp": created_at,
                "manifest": {
                    "version": manifest_version,
                },
            }
            if order_data.orderMeta.pricePreview is not None:
                meta["pricePreview"] = order_data.orderMeta.pricePreview

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

            with (staging_dir / "final.nc").open('w', encoding='utf-8') as output_file:
                output_file.write('\n'.join(final_gcode))

            raw_payload = payload

            layout_svg = raw_payload.get("layoutSvg") or raw_payload.get("layout_svg")
            if isinstance(layout_svg, str) and layout_svg.strip():
                with (staging_dir / "layout.svg").open('w', encoding='utf-8') as svg_file:
                    svg_file.write(layout_svg)

            layout_png = raw_payload.get("layoutPng") or raw_payload.get("layout_png")
            if isinstance(layout_png, str) and layout_png.strip():
                raw_png = layout_png.strip()
                encoded_png = raw_png
                if raw_png.startswith("data:image/png;base64,"):
                    encoded_png = raw_png.split(",", 1)[1]
                try:
                    png_bytes = base64.b64decode(encoded_png, validate=True)
                    with (staging_dir / "layout.png").open('wb') as png_file:
                        png_file.write(png_bytes)
                except (ValueError, binascii.Error):
                    logger.warning("Failed to decode layoutPng as base64 for order %s", order_id)
                    with (staging_dir / "layout.png").open('w', encoding='utf-8') as png_file:
                        png_file.write(layout_png)

            os.replace(staging_dir, final_order_dir)
        except Exception:
            if staging_dir.exists():
                shutil.rmtree(staging_dir)
            raise

        response: Dict[str, Any] = {
            "orderId": order_id,
            "createdAt": created_at,
            "status": status,
        }
        if order_data.orderMeta.pricePreview is not None:
            response["pricePreview"] = order_data.orderMeta.pricePreview
        return response
    except HTTPException:
        raise
    except GCodeEngineError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


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
        order_payload = _read_json_if_exists(order_dir / "order.json") or {}
        order_meta = _order_meta_from_order_json(order_payload)
        created_at = status_data.get("createdAt")
        if not isinstance(created_at, str) or not created_at:
            created_at = datetime.fromtimestamp(order_dir.stat().st_mtime, timezone.utc).isoformat()

        orders.append({
            "orderId": order_dir.name,
            "createdAt": created_at,
            "confirmed": bool(status_data.get("confirmed", False)),
            "produced": bool(status_data.get("produced", False)),
            "width": order_meta.get("width"),
            "height": order_meta.get("height"),
            "hasLayoutPng": (order_dir / "layout.png").exists(),
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
    order_meta = _order_meta_from_order_json(order_payload)

    return {
        "orderId": order_id,
        "status": status_data,
        "orderMeta": order_meta,
        "contours": order_payload.get("contours") or [],
        "primitives": order_payload.get("primitives") or [],
        "files": {
            "finalNc": f"/admin/api/orders/{order_id}/final.nc",
            "layoutPng": f"/admin/api/orders/{order_id}/layout.png" if (order_dir / "layout.png").exists() else None,
            "layoutSvg": f"/admin/api/orders/{order_id}/layout.svg" if (order_dir / "layout.svg").exists() else None,
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

def _serve_order_file(order_id: str, filename: str, media_type: Optional[str] = None) -> FileResponse:
    order_dir = _order_dir(order_id)
    file_path = order_dir / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"{filename} not found")
    return FileResponse(file_path, filename=filename, media_type=media_type)


@admin_orders_router.get("/orders/{order_id}/final.nc")
def download_final_nc(order_id: str):
    return _serve_order_file(order_id, "final.nc", media_type="text/plain")


@admin_orders_router.get("/orders/{order_id}/layout.png")
def download_layout_png(order_id: str):
    return _serve_order_file(order_id, "layout.png", media_type="image/png")


@admin_orders_router.get("/orders/{order_id}/layout.svg")
def download_layout_svg(order_id: str):
    return _serve_order_file(order_id, "layout.svg", media_type="image/svg+xml")


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

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from admin_api.api import router as admin_router
from domain_store import BASE_DIR, CONTOURS_DIR, MANIFEST_PATH
from pydantic import BaseModel
from typing import Any, List, Optional, Dict
from datetime import datetime, timezone
from uuid import uuid4
import shutil
import os
import json
from services.gcode_engine import GCodeEngineError, build_final_gcode


app = FastAPI()

public_router = APIRouter()




class OrderMeta(BaseModel):
    width: float
    height: float
    units: str
    coordinateSystem: Optional[str] = None
    pricePreview: Optional[Dict[str, Any]] = None
    workspaceSnapshot: Optional[Dict[str, Any]] = None


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
        orders_dir = BASE_DIR / "orders"
        orders_dir.mkdir(parents=True, exist_ok=True)

        while (orders_dir / order_id).exists():
            order_id = uuid4().hex[:12]

        staging_dir = orders_dir / f".{order_id}.staging"
        if staging_dir.exists():
            shutil.rmtree(staging_dir)

        final_order_dir = orders_dir / order_id

        try:
            staging_dir.mkdir(parents=True, exist_ok=False)

            with (staging_dir / "order.json").open('w', encoding='utf-8') as order_file:
                json.dump(payload, order_file, ensure_ascii=False, indent=2)

            meta = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "manifest": {
                    "version": manifest_version,
                },
            }
            if order_data.orderMeta.pricePreview is not None:
                meta["pricePreview"] = order_data.orderMeta.pricePreview

            with (staging_dir / "meta.json").open('w', encoding='utf-8') as meta_file:
                json.dump(meta, meta_file, ensure_ascii=False, indent=2)

            with (staging_dir / "final.nc").open('w', encoding='utf-8') as output_file:
                output_file.write('\n'.join(final_gcode))

            raw_payload = payload

            layout_svg = raw_payload.get("layoutSvg") or raw_payload.get("layout_svg")
            if isinstance(layout_svg, str) and layout_svg.strip():
                with (staging_dir / "layout.svg").open('w', encoding='utf-8') as svg_file:
                    svg_file.write(layout_svg)

            layout_png = raw_payload.get("layoutPng") or raw_payload.get("layout_png")
            if isinstance(layout_png, str) and layout_png.strip():
                with (staging_dir / "layout.png").open('w', encoding='utf-8') as png_file:
                    png_file.write(layout_png)

            os.replace(staging_dir, final_order_dir)
        except Exception:
            if staging_dir.exists():
                shutil.rmtree(staging_dir)
            raise

        output_path = final_order_dir / "final.nc"

        return FileResponse(output_path, filename='final_layment.nc')
    except HTTPException:
        raise
    except GCodeEngineError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

app.include_router(public_router, prefix="/api")
app.include_router(admin_router, prefix="/admin/api")

app.mount("/contours", StaticFiles(directory=str(CONTOURS_DIR)), name="contours")
app.mount("/admin", StaticFiles(directory=str(BASE_DIR / "admin"), html=True), name="admin")

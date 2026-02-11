from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from admin_api.api import router as admin_router
from domain_store import BASE_DIR, CONTOURS_DIR, MANIFEST_PATH
from pydantic import BaseModel
from typing import Any, List, Optional, Dict
import json
from services.gcode_engine import GCodeProcessingError, build_final_gcode


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
async def export_layment(order_data: ExportRequest):
    try:
        final_gcode = build_final_gcode(order_data)

        orders_dir = BASE_DIR / "orders"
        orders_dir.mkdir(parents=True, exist_ok=True)
        output_path = orders_dir / "final_layment.nc"
        with output_path.open("w", encoding="utf-8") as file_obj:
            file_obj.write("\n".join(final_gcode))

        return FileResponse(output_path, filename="final_layment.nc")
    except GCodeProcessingError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

app.include_router(public_router, prefix="/api")
app.include_router(admin_router, prefix="/admin/api")

app.mount("/contours", StaticFiles(directory=str(CONTOURS_DIR)), name="contours")
app.mount("/admin", StaticFiles(directory=str(BASE_DIR / "admin"), html=True), name="admin")

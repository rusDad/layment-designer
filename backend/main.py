from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from admin_api.api import router as admin_router
from domain_store import BASE_DIR, CONTOURS_DIR, MANIFEST_PATH, contour_rotated_nc_path
from pydantic import BaseModel
from typing import Any, List, Optional, Dict
import json
from gcode_rotator import offset_gcode, generate_rectangle_gcode 


app = FastAPI()

public_router = APIRouter()




class OrderMeta(BaseModel):
    width: float
    height: float
    units: str
    coordinateSystem: Optional[str] = None
    pricePreview: Optional[Dict[str, Any]] = None


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
        final_gcode = [
            'G0 G17 G90',
            'G0 G40 G49 G80',  
            'G21',
	        'T1',
	        'S15000 M3',
	        'G54'
        ]
        width = order_data.orderMeta.width
        height = order_data.orderMeta.height
        # Хардкод параметров   
        z_depth = -30.0  
        tool_dia = 6.0  
        feed_rate = 1000  
        rectangle_gcode = generate_rectangle_gcode(0, 0, width, height, z_depth, tool_dia, feed_rate)  
        final_gcode.extend(rectangle_gcode)  
        final_gcode.append('G0 Z20')  

        for contour in order_data.contours:
            rot_value = int(contour.angle) if float(contour.angle).is_integer() else contour.angle
            rot = str(rot_value)
            nc_path = contour_rotated_nc_path(contour.id, rot)
            if not nc_path.exists():
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Rotated contour is not prepared for the requested angle. "
                        "Please upload the contour in admin to generate rotated NC files."
                    ),
                )
            
            with nc_path.open('r') as f:
                contour_lines = f.read().splitlines()
            
	         # Применяем смещение вместо G92
            offset_contour_gcode = offset_gcode(contour_lines, contour.x, contour.y)
            final_gcode.append('G0 Z20')
            final_gcode.append(f"G0 X{contour.x} Y{contour.y}")
            final_gcode.extend(offset_contour_gcode)
            final_gcode.append('G0 Z20')
        
        
        
        final_gcode.append('M5')
        final_gcode.append('G49')
        final_gcode.append('M30')
        
        orders_dir = BASE_DIR / "orders"
        orders_dir.mkdir(parents=True, exist_ok=True)
        output_path = orders_dir / "final_layment.nc"
        with output_path.open('w') as f:
            f.write('\n'.join(final_gcode))
        
        return FileResponse(output_path, filename='final_layment.nc')
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

app.include_router(public_router, prefix="/api")
app.include_router(admin_router, prefix="/admin/api")

app.mount("/contours", StaticFiles(directory=str(CONTOURS_DIR)), name="contours")
app.mount("/admin", StaticFiles(directory=str(BASE_DIR / "admin"), html=True), name="admin")

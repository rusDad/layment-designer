from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
import os
from gcode_rotator import rotate_gcode_for_contour  # Импорт для админки, если нужно

app = FastAPI()

@app.post("/export-layment")
async def export_layment(order_data: dict):
    try:
        final_gcode = [
            'G90 G21 G17',
            'M3 S12000',  # Подкорректируй S
            'M8'
        ]
        
        for contour in order_data['contours']:
            rot = str(contour['angle'])
            nc_path = f"./contours/nc/{contour['id']}/rotated_{rot}.nc"
            if not os.path.exists(nc_path):
                # Автоматическая ротация, если не сгенерировано (fallback)
                rotate_gcode_for_contour(contour['id'])
            
            with open(nc_path, 'r') as f:
                contour_gcode = f.read().splitlines()
            
            final_gcode.append('G0 Z20')
            final_gcode.append(f"G0 X{contour['x']} Y{contour['y']}")
            final_gcode.append('G92 X0 Y0')
            final_gcode.extend(contour_gcode)
            final_gcode.append('G0 Z20')
            final_gcode.append('G92.1')
        
        final_gcode.append('G28 Z0')
        final_gcode.append('G28 X0 Y0')
        final_gcode.append('M9')
        final_gcode.append('M5')
        final_gcode.append('M30')
        
        os.makedirs("./orders", exist_ok=True)
        output_path = './orders/final_layment.nc'
        with open(output_path, 'w') as f:
            f.write('\n'.join(final_gcode))
        
        return FileResponse(output_path, filename='final_layment.nc')
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
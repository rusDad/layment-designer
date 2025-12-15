from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
import os
from gcode_rotator import rotate_gcode_for_contour, offset_gcode, generate_rectangle_gcode 

app = FastAPI()

@app.post("/export-layment")
async def export_layment(order_data: dict):
    try:
        final_gcode = [
            'G0 G17 G90',
            'G0 G40 G49 G80',  
            'G21',
	        'T1',
	        'S15000 M3',
	        'G54'
        ]
        width = order_data.get('width', 565)  # Default если не передан  
        height = order_data.get('height', 375)  
        # Хардкод параметров (замените на ваши)  
        z_depth = -30.0  
        tool_dia = 6.0  
        feed_rate = 1000  
        rectangle_gcode = generate_rectangle_gcode(0, 0, width, height, z_depth, tool_dia, feed_rate)  
        final_gcode.extend(rectangle_gcode)  
        final_gcode.append('G0 Z20')  

        for contour in order_data['contours']:
            rot = str(contour['angle'])
            nc_path = f"./contours/nc/{contour['id']}/rotated_{rot}.nc"
            if not os.path.exists(nc_path):
                # Автоматическая ротация, если не сгенерировано (fallback)
                rotate_gcode_for_contour(contour['id'])
            
            with open(nc_path, 'r') as f:
                contour_lines = f.read().splitlines()
            
	         # Применяем смещение вместо G92
            offset_contour_gcode = offset_gcode(contour_lines, contour['x'], contour['y'])
            final_gcode.append('G0 Z20')
            final_gcode.append(f"G0 X{contour['x']} Y{contour['y']}")
            final_gcode.extend(offset_contour_gcode)
            final_gcode.append('G0 Z20')
        
        
        
        final_gcode.append('M5')
        final_gcode.append('G49')
        final_gcode.append('M30')
        
        os.makedirs("./orders", exist_ok=True)
        output_path = './orders/final_layment.nc'
        with open(output_path, 'w') as f:
            f.write('\n'.join(final_gcode))
        
        return FileResponse(output_path, filename='final_layment.nc')
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
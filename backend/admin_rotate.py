import sys
from gcode_rotator import rotate_gcode_for_contour

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python admin_rotate.py <contour_id>")
        sys.exit(1)
    
    contour_id = sys.argv[1]
    rotate_gcode_for_contour(contour_id)
    # Здесь же обнови manifest.json (добавь код для JSON-обновления)
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
CONTOURS_DIR = BASE_DIR / "domain" / "contours"
CONTOURS_GEOMETRY_DIR = CONTOURS_DIR / "geometry"
GCODE_DIR = BASE_DIR / "domain" / "gcode"
MANIFEST_PATH = CONTOURS_DIR / "manifest.json"
START_GCODE_PATH = GCODE_DIR / "start_gcode.nc"
END_GCODE_PATH = GCODE_DIR / "end_gcode.nc"


def contour_svg_path(contour_id: str) -> Path:
    return CONTOURS_DIR / "svg" / f"{contour_id}.svg"


def contour_nc_path(contour_id: str) -> Path:
    return CONTOURS_DIR / "nc" / f"{contour_id}.nc"


def contour_geometry_path(contour_id: str) -> Path:
    return CONTOURS_GEOMETRY_DIR / f"{contour_id}.json"


def contour_rotated_nc_path(contour_id: str, rotation: str) -> Path:
    return CONTOURS_DIR / "nc" / contour_id / f"rotated_{rotation}.nc"


def contour_geometry_path(contour_id: str) -> Path:
    return CONTOURS_DIR / "geometry" / f"{contour_id}.json"


def start_gcode_path() -> Path:
    return START_GCODE_PATH


def end_gcode_path() -> Path:
    return END_GCODE_PATH

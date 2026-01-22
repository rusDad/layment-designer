from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
CONTOURS_DIR = BASE_DIR / "domain" / "contours"
MANIFEST_PATH = CONTOURS_DIR / "manifest.json"


def contour_svg_path(contour_id: str) -> Path:
    return CONTOURS_DIR / "svg" / f"{contour_id}.svg"


def contour_nc_path(contour_id: str) -> Path:
    return CONTOURS_DIR / "nc" / f"{contour_id}.nc"


def contour_rotated_nc_path(contour_id: str, rotation: str) -> Path:
    return CONTOURS_DIR / "nc" / contour_id / f"rotated_{rotation}.nc"

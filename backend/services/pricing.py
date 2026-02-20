import json
import math
import os
from typing import Any, Dict, List, TYPE_CHECKING

from fastapi import HTTPException

from domain_store import BASE_DIR, MANIFEST_PATH

if TYPE_CHECKING:
    from main import ExportRequest


DEFAULT_PRICING_CONFIG_PATH = BASE_DIR / "pricing.local.json"
TOOL_DIAMETER_MM = 6.0


def load_pricing_config() -> Dict[str, Any]:
    config_path = os.getenv("PRICING_CONFIG_PATH")
    resolved_path = DEFAULT_PRICING_CONFIG_PATH if not config_path else BASE_DIR / config_path

    if not resolved_path.exists() or not resolved_path.is_file():
        raise HTTPException(
            status_code=500,
            detail=(
                f"Pricing config not found: {resolved_path}. "
                "Create pricing.local.json or set PRICING_CONFIG_PATH."
            ),
        )

    with resolved_path.open("r", encoding="utf-8") as config_file:
        return json.load(config_file)


def _manifest_cutting_lengths() -> Dict[str, float]:
    if not MANIFEST_PATH.exists() or not MANIFEST_PATH.is_file():
        return {}

    with MANIFEST_PATH.open("r", encoding="utf-8") as manifest_file:
        manifest = json.load(manifest_file)

    result: Dict[str, float] = {}
    for item in manifest.get("items", []):
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id:
            continue
        try:
            result[item_id] = float(item.get("cuttingLengthMeters", 0) or 0)
        except (TypeError, ValueError):
            result[item_id] = 0.0
    return result


def _rect_primitive_meters(primitive: Dict[str, Any]) -> float:
    try:
        width = float(primitive.get("width"))
        height = float(primitive.get("height"))
    except (TypeError, ValueError):
        return 0.0

    if width <= 0 or height <= 0:
        return 0.0

    half_tool = TOOL_DIAMETER_MM / 2
    rough_offset = half_tool + 1
    step = half_tool

    total_meters = 0.0

    current_min_x = rough_offset
    current_min_y = rough_offset
    current_max_x = width - rough_offset
    current_max_y = height - rough_offset

    while current_min_x < current_max_x and current_min_y < current_max_y:
        loop_width = current_max_x - current_min_x
        loop_height = current_max_y - current_min_y
        total_meters += (2 * (loop_width + loop_height)) / 1000

        current_min_x += step
        current_min_y += step
        current_max_x -= step
        current_max_y -= step

    finish_width = width - (2 * half_tool)
    finish_height = height - (2 * half_tool)
    if finish_width > 0 and finish_height > 0:
        total_meters += (2 * (finish_width + finish_height)) / 1000

    return total_meters


def _circle_primitive_meters(primitive: Dict[str, Any]) -> float:
    try:
        radius = float(primitive.get("radius"))
    except (TypeError, ValueError):
        return 0.0

    if radius <= 0:
        return 0.0

    half_tool = TOOL_DIAMETER_MM / 2
    finish_radius = radius - half_tool
    if finish_radius <= 0:
        return 0.0

    total_meters = 0.0
    rough_limit = radius - 3
    rough_radius = half_tool

    while rough_radius <= rough_limit and rough_radius <= finish_radius:
        total_meters += (2 * math.pi * rough_radius) / 1000
        rough_radius += half_tool

    total_meters += (2 * math.pi * finish_radius) / 1000
    return total_meters


def _primitive_cutting_meters(primitives: List[Dict[str, Any]]) -> float:
    total_meters = 0.0
    for primitive in primitives:
        primitive_type = primitive.get("type")
        if primitive_type == "rect":
            total_meters += _rect_primitive_meters(primitive)
        elif primitive_type == "circle":
            total_meters += _circle_primitive_meters(primitive)
    return total_meters


def calculate_price_preview(order_data: "ExportRequest") -> Dict[str, Any]:
    config = load_pricing_config()

    width = order_data.orderMeta.width
    height = order_data.orderMeta.height

    area_m2 = (width * height) / 1_000_000
    material_cost = round(area_m2 * float(config.get("wasteK", 0)) * float(config.get("materialPricePerM2", 0)))

    perimeter_m = (2 * (width + height)) / 1000

    manifest_lengths = _manifest_cutting_lengths()
    missing_contour_ids: List[str] = []
    contour_meters = 0.0
    for contour in order_data.contours:
        contour_length = manifest_lengths.get(contour.id)
        if contour_length is None:
            missing_contour_ids.append(contour.id)
            continue
        contour_meters += contour_length

    primitives = order_data.primitives or []
    primitive_meters = _primitive_cutting_meters(primitives)

    cutting_m = (
        float(config.get("laymentPasses", 0)) * perimeter_m
        + contour_meters
        + primitive_meters
    )
    cutting_cost = round(cutting_m * float(config.get("cuttingPricePerMeter", 0)))

    total = round((material_cost + cutting_cost) * float(config.get("rrcMultiplier", 0)))

    return {
        "material": material_cost,
        "cutting": cutting_cost,
        "total": total,
        "cuttingMeters": cutting_m,
        "areaM2": area_m2,
        "missingContourIds": missing_contour_ids,
    }

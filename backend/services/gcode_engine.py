from __future__ import annotations

from dataclasses import dataclass
from typing import List

from domain_store import contour_rotated_nc_path
from gcode_rotator import generate_rectangle_gcode, offset_gcode


@dataclass
class GCodeProcessingError(Exception):
    message: str
    status_code: int = 422

    def __str__(self) -> str:
        return self.message


def load_rotated_fragment(contour_id: str, angle: float) -> List[str]:
    rot_value = int(angle) if float(angle).is_integer() else angle
    rot = str(rot_value)
    nc_path = contour_rotated_nc_path(contour_id, rot)
    if not nc_path.exists():
        raise GCodeProcessingError(
            message=(
                "Rotated contour is not prepared for the requested angle. "
                "Please upload the contour in admin to generate rotated NC files."
            ),
            status_code=400,
        )

    try:
        with nc_path.open("r", encoding="utf-8") as file_obj:
            return file_obj.read().splitlines()
    except OSError as exc:
        raise GCodeProcessingError(
            message=f"Failed to read rotated NC file for contour '{contour_id}': {exc}",
            status_code=400,
        ) from exc


def apply_offset(lines: List[str], x: float, y: float) -> List[str]:
    try:
        return offset_gcode(lines, x, y)
    except ValueError as exc:
        raise GCodeProcessingError(
            message=f"Invalid contour NC data: {exc}",
            status_code=422,
        ) from exc


def build_final_gcode(order_data) -> List[str]:
    final_gcode = [
        "G0 G17 G90",
        "G0 G40 G49 G80",
        "G21",
        "T1",
        "S15000 M3",
        "G54",
    ]

    width = order_data.orderMeta.width
    height = order_data.orderMeta.height

    z_depth = -30.0
    tool_dia = 6.0
    feed_rate = 1000

    rectangle_gcode = generate_rectangle_gcode(0, 0, width, height, z_depth, tool_dia, feed_rate)
    final_gcode.extend(rectangle_gcode)
    final_gcode.append("G0 Z20")

    for contour in order_data.contours:
        contour_lines = load_rotated_fragment(contour.id, contour.angle)
        offset_contour_gcode = apply_offset(contour_lines, contour.x, contour.y)
        final_gcode.append("G0 Z20")
        final_gcode.append(f"G0 X{contour.x} Y{contour.y}")
        final_gcode.extend(offset_contour_gcode)
        final_gcode.append("G0 Z20")

    final_gcode.append("M5")
    final_gcode.append("G49")
    final_gcode.append("M30")
    return final_gcode

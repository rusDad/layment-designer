from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List

from domain_store import contour_rotated_nc_path, end_gcode_path, start_gcode_path
from gcode_rotator import generate_rectangle_gcode, offset_gcode


@dataclass
class GCodeEngineError(Exception):
    message: str
    status_code: int = 422

    def __str__(self) -> str:
        return self.message

DEFAULT_START_GCODE = [
    "G0 G17 G90",
    "G0 G40 G49 G80",
    "G21",
    "T1",
    "S15000 M3",
    "G54",
]

DEFAULT_END_GCODE = [
    "M5",
    "G49",
    "M30",
]


def _load_gcode_template(path_getter, fallback: List[str]) -> List[str]:
    template_path = path_getter()
    if template_path.exists():
        with template_path.open("r", encoding="utf-8") as source:
            return source.read().splitlines()
    return fallback.copy()


def _format_contour_comment(contour_id: str, angle: float) -> str:
    return f"' CONTOUR id={contour_id} angle={angle}"


def _format_primitive_comment(primitive_index: int, primitive: dict[str, Any]) -> str:
    primitive_type = primitive.get("type")

    if primitive_type == "rect":
        return (
            f"' PRIMITIVE #{primitive_index} type=rect "
            f"x={primitive.get('x')} y={primitive.get('y')} "
            f"width={primitive.get('width')} height={primitive.get('height')}"
        )

    if primitive_type == "circle":
        return (
            f"' PRIMITIVE #{primitive_index} type=circle "
            f"x={primitive.get('x')} y={primitive.get('y')} radius={primitive.get('radius')}"
        )

    return f"' PRIMITIVE #{primitive_index} type={primitive_type}"


def load_rotated_fragment(contour_id: str, angle: float) -> List[str]:
    rot_value = int(angle) if float(angle).is_integer() else angle
    rot = str(rot_value)
    nc_path = contour_rotated_nc_path(contour_id, rot)

    if not nc_path.exists():
        raise GCodeEngineError(
            status_code=400,
            message=(
                "Rotated contour is not prepared for the requested angle. "
                "Please upload the contour in admin to generate rotated NC files."
            ),
        )

    with nc_path.open("r", encoding="utf-8") as source:
        return source.read().splitlines()


def apply_offset(lines: List[str], x: float, y: float) -> List[str]:
    try:
        return offset_gcode(lines, x, y)
    except ValueError as exc:
        raise GCodeEngineError(status_code=422, message=f"Invalid .nc fragment: {exc}") from exc


def _to_float(value: Any, field_name: str, primitive_index: int) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise GCodeEngineError(
            status_code=422,
            message=f"Primitive #{primitive_index}: invalid {field_name} value '{value}'",
        ) from exc


def generate_rect_pocket_gcode(
    x0: float,
    y0: float,
    width: float,
    height: float,
    z_depth: float = -20,
    tool_dia: float = 6,
    feed: int = 1000,
    plunge: int = 500,
) -> List[str]:
    if width <= 0 or height <= 0:
        return []

    half_tool = tool_dia / 2
    rough_offset = half_tool + 1
    step = half_tool
    lines: List[str] = []

    current_min_x = x0 + rough_offset
    current_min_y = y0 + rough_offset
    current_max_x = x0 + width - rough_offset
    current_max_y = y0 + height - rough_offset

    while current_min_x < current_max_x and current_min_y < current_max_y:
        lines.append("G0 Z20")
        lines.append(f"G0 X{current_min_x:.3f} Y{current_min_y:.3f}")
        lines.append(f"G1 Z{z_depth:.3f} F{plunge}")
        # Черновые проходы CCW
        lines.append(f"G1 X{current_min_x:.3f} Y{current_max_y:.3f} F{feed}")
        lines.append(f"G1 X{current_max_x:.3f} Y{current_max_y:.3f} F{feed}")
        lines.append(f"G1 X{current_max_x:.3f} Y{current_min_y:.3f} F{feed}")
        lines.append(f"G1 X{current_min_x:.3f} Y{current_min_y:.3f} F{feed}")
        lines.append("G0 Z20")

        current_min_x += step
        current_min_y += step
        current_max_x -= step
        current_max_y -= step

    finish_min_x = x0 + half_tool
    finish_min_y = y0 + half_tool
    finish_max_x = x0 + width - half_tool
    finish_max_y = y0 + height - half_tool

    if finish_min_x >= finish_max_x or finish_min_y >= finish_max_y:
        return lines

    lines.append("G0 Z20")
    lines.append(f"G0 X{finish_min_x:.3f} Y{finish_min_y:.3f}")
    lines.append(f"G1 Z{z_depth:.3f} F{plunge}")
    # Чистовой проход CW
    lines.append(f"G1 X{finish_max_x:.3f} Y{finish_min_y:.3f} F{feed}")
    lines.append(f"G1 X{finish_max_x:.3f} Y{finish_max_y:.3f} F{feed}")
    lines.append(f"G1 X{finish_min_x:.3f} Y{finish_max_y:.3f} F{feed}")
    lines.append(f"G1 X{finish_min_x:.3f} Y{finish_min_y:.3f} F{feed}")
    lines.append("G0 Z20")

    return lines


def generate_circle_pocket_gcode(
    cx: float,
    cy: float,
    radius: float,
    z_depth: float = -20,
    tool_dia: float = 6,
    feed: int = 1000,
    plunge: int = 500,
) -> List[str]:
    if radius <= 0:
        return []

    half_tool = tool_dia / 2
    finish_radius = radius - half_tool
    if finish_radius <= 0:
        return []

    lines: List[str] = []
    start_radius = half_tool
    rough_limit = radius - 3
    rough_radius = start_radius

    lines.append("G0 Z20")
    lines.append(f"G0 X{cx:.3f} Y{cy:.3f}")
    lines.append(f"G1 Z{z_depth:.3f} F{plunge}")

    while rough_radius <= rough_limit and rough_radius <= finish_radius:
        start_x = cx + rough_radius
        start_y = cy
        lines.append(f"G1 X{start_x:.3f} Y{start_y:.3f} F{feed}")
        # Черновые проходы CCW (две полуокружности через R)
        lines.append(f"G3 X{(cx - rough_radius):.3f} Y{cy:.3f} R{rough_radius:.3f} F{feed}")
        lines.append(f"G3 X{start_x:.3f} Y{start_y:.3f} R{rough_radius:.3f} F{feed}")
        rough_radius += half_tool

    finish_x = cx + finish_radius
    finish_y = cy
    lines.append(f"G0 Z20")
    lines.append(f"G0 X{finish_x:.3f} Y{finish_y:.3f}")
    lines.append(f"G1 Z{z_depth:.3f} F{plunge}")
    # Чистовой проход CW
    lines.append(f"G2 X{(cx - finish_radius):.3f} Y{cy:.3f} R{finish_radius:.3f} F{feed}")
    lines.append(f"G2 X{finish_x:.3f} Y{finish_y:.3f} R{finish_radius:.3f} F{feed}")
    lines.append("G0 Z20")

    return lines


def build_final_gcode(order_data) -> List[str]:
    final_gcode = _load_gcode_template(start_gcode_path, DEFAULT_START_GCODE)

    width = order_data.orderMeta.width
    height = order_data.orderMeta.height

    z_depth = -18.0
    tool_dia = 6.0
    feed_rate = 2000

    final_gcode.extend(generate_rectangle_gcode(-3, -3, height + 3, width + 3, z_depth, tool_dia, feed_rate))
    final_gcode.extend(generate_rectangle_gcode(0, 0, height, width, z_depth, tool_dia, feed_rate))
    final_gcode.append("G0 Z20")

    for contour in order_data.contours:
        final_gcode.append(_format_contour_comment(contour.id, contour.angle))
        contour_lines = load_rotated_fragment(contour.id, contour.angle)
        cnc_x, cnc_y = contour.y, contour.x  # приведение системы координат фронтенда к координатам станка
        offset_contour_gcode = apply_offset(contour_lines, cnc_x, cnc_y)

        final_gcode.append("G0 Z20")
        final_gcode.append(f"G0 X{cnc_x} Y{cnc_y}")
        final_gcode.extend(offset_contour_gcode)
        final_gcode.append("G0 Z20")

    primitives = order_data.primitives or []
    if primitives:
        final_gcode.append("' PRIMITIVES START")

    for primitive_index, primitive in enumerate(primitives, start=1):
        final_gcode.append(_format_primitive_comment(primitive_index, primitive))
        primitive_type = primitive.get("type")

        if primitive_type == "rect":
            x = _to_float(primitive.get("x"), "x", primitive_index)
            y = _to_float(primitive.get("y"), "y", primitive_index)
            width = _to_float(primitive.get("width"), "width", primitive_index)
            height = _to_float(primitive.get("height"), "height", primitive_index)

            cnc_x = y
            cnc_y = x
            cnc_width = height
            cnc_height = width

            final_gcode.extend(
                generate_rect_pocket_gcode(
                    cnc_x,
                    cnc_y,
                    cnc_width,
                    cnc_height,
                    z_depth=-20,
                    tool_dia=tool_dia,
                    feed=feed_rate,
                )
            )
            continue

        if primitive_type == "circle":
            x = _to_float(primitive.get("x"), "x", primitive_index)
            y = _to_float(primitive.get("y"), "y", primitive_index)
            radius = _to_float(primitive.get("radius"), "radius", primitive_index)

            cnc_cx = y
            cnc_cy = x
            final_gcode.extend(
                generate_circle_pocket_gcode(
                    cnc_cx,
                    cnc_cy,
                    radius,
                    z_depth=-20,
                    tool_dia=tool_dia,
                    feed=feed_rate,
                )
            )
            continue

        raise GCodeEngineError(
            status_code=422,
            message=f"Primitive #{primitive_index}: unsupported type '{primitive_type}'",
        )

    if primitives:
        final_gcode.append("' PRIMITIVES END")

    width = order_data.orderMeta.width 
    height = order_data.orderMeta.height
    z_depth = -35.0
    deep_rect = generate_rectangle_gcode(0, 0, height, width, z_depth, tool_dia, feed_rate)

    final_gcode.extend(deep_rect)
    final_gcode.extend(deep_rect)
    final_gcode.append("G0 Z20")
    
    final_gcode.extend(_load_gcode_template(end_gcode_path, DEFAULT_END_GCODE))

    return final_gcode

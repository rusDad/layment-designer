from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List, Tuple
import math

from domain_store import contour_geometry_path


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _format_number(value: float) -> str:
    text = f"{value:.6f}".rstrip("0").rstrip(".")
    return text if text else "0"


def _parse_vertices(raw_vertices: Any) -> List[Dict[str, float]]:
    vertices: List[Dict[str, float]] = []
    if not isinstance(raw_vertices, list):
        return vertices

    for vertex in raw_vertices:
        if isinstance(vertex, dict):
            x = _to_float(vertex.get("x"))
            y = _to_float(vertex.get("y"))
            bulge = _to_float(vertex.get("bulge"), 0.0)
        elif isinstance(vertex, (list, tuple)) and len(vertex) >= 2:
            x = _to_float(vertex[0])
            y = _to_float(vertex[1])
            bulge = _to_float(vertex[2], 0.0) if len(vertex) > 2 else 0.0
        else:
            continue

        vertices.append({"x": x, "y": y, "bulge": bulge})

    return vertices


def _rotate_vertices(vertices: List[Dict[str, float]], width: float, height: float, angle_deg: float) -> List[Dict[str, float]]:
    cx = width / 2.0
    cy = height / 2.0
    angle_rad = math.radians(angle_deg)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)

    rotated: List[Dict[str, float]] = []
    for vertex in vertices:
        dx = vertex["x"] - cx
        dy = vertex["y"] - cy
        rotated_x = cx + dx * cos_a - dy * sin_a
        rotated_y = cy + dx * sin_a + dy * cos_a
        rotated.append({"x": rotated_x, "y": rotated_y, "bulge": vertex["bulge"]})

    return rotated

def _rotate_point(x: float, y: float, width: float, height: float, angle_deg: float) -> tuple[float, float]:
    cx = width / 2.0
    cy = height / 2.0
    angle_rad = math.radians(angle_deg)
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)

    dx = x - cx
    dy = y - cy

    rx = cx + dx * cos_a - dy * sin_a
    ry = cy + dx * sin_a + dy * cos_a
    return rx, ry

def _write_lwpolyline(
    lines: List[str],
    layer: str,
    vertices: Iterable[Dict[str, float]],
    *,
    closed: bool = True,
    order_height: float,
    handle: str | None = None,
    cad_like: bool = False,
) -> None:
    points = list(vertices)
    if len(points) < 2:
        return

    lines.extend(["0", "LWPOLYLINE"])
    if cad_like:
        if handle:
            lines.extend(["5", handle])
        lines.extend(["100", "AcDbEntity", "8", layer, "100", "AcDbPolyline"])
    else:
        lines.extend(["8", layer])
    lines.extend(["90", str(len(points)), "70", "1" if closed else "0"])

    for vertex in points:
        lines.extend([
            "10",
            _format_number(vertex["x"]),
            "20",
            _format_number(order_height - vertex["y"]),
        ])
        bulge = -vertex.get("bulge", 0.0)
        if abs(bulge) > 1e-12:
            lines.extend(["42", _format_number(bulge)])


def _write_circle(
    lines: List[str],
    layer: str,
    *,
    x: float,
    y: float,
    radius: float,
    order_height: float,
    handle: str | None = None,
    cad_like: bool = False,
) -> None:
    if radius <= 0:
        return
    lines.extend(["0", "CIRCLE"])
    if cad_like:
        if handle:
            lines.extend(["5", handle])
        lines.extend(["100", "AcDbEntity", "8", layer, "100", "AcDbCircle"])
    else:
        lines.extend(["8", layer])
    lines.extend([
        "10",
        _format_number(x),
        "20",
        _format_number(order_height - y),
        "30",
        "0",
        "40",
        _format_number(radius),
    ])
    if cad_like:
        lines.extend(["210", "0", "220", "0", "230", "1"])


def _sanitize_text(text: Any) -> str:
    normalized = str(text or "")
    sanitized = normalized.replace("\r\n", " ").replace("\n", " ").replace("\t", " ").strip()
    return sanitized


def _write_text(
    lines: List[str],
    layer: str,
    *,
    x: float,
    y: float,
    text: str,
    height: float,
    order_height: float,
    handle: str | None = None,
    cad_like: bool = False,
) -> None:
    if not text or height <= 0:
        return

    y_dxf = order_height - y - height
    lines.extend(["0", "TEXT"])
    if cad_like:
        if handle:
            lines.extend(["5", handle])
        lines.extend(["100", "AcDbEntity", "8", layer, "100", "AcDbText"])
    else:
        lines.extend(["8", layer])
    lines.extend([
        "10",
        _format_number(x),
        "20",
        _format_number(y_dxf),
        "30",
        "0",
        "40",
        _format_number(height),
        "50",
        "0",
        "7",
        "STANDARD",
        "1",
        text,
    ])


def _emit_entities(
    lines: List[str],
    order_data: Any,
    order_width: float,
    order_height: float,
    *,
    include_labels: bool,
    cad_like: bool = False,
    next_handle: Callable[[], str] | None = None,
) -> List[str]:
    def _entity_handle() -> str | None:
        return next_handle() if (cad_like and next_handle is not None) else None

    _write_lwpolyline(
        lines,
        "LAYMENT",
        [
            {"x": 0.0, "y": 0.0, "bulge": 0.0},
            {"x": order_width, "y": 0.0, "bulge": 0.0},
            {"x": order_width, "y": order_height, "bulge": 0.0},
            {"x": 0.0, "y": order_height, "bulge": 0.0},
        ],
        order_height=order_height,
        handle=_entity_handle(),
        cad_like=cad_like,
    )

    missing_contours: List[str] = []
    for contour in order_data.contours:
        geometry = _load_contour_geometry(contour.id)
        if geometry is None:
            missing_contours.append(contour.id)
            continue

        width, height, vertices = geometry
        rotated = _rotate_vertices(vertices, width, height, float(contour.angle))

        ref_x, ref_y = _rotate_point(0.0, 0.0, width, height, float(contour.angle)) if float(contour.angle) else (0.0, 0.0)

        dx = float(contour.x) - ref_x
        dy = float(contour.y) - ref_y

        placed = [
            {
                "x": point["x"] + dx,
                "y": point["y"] + dy,
                "bulge": point.get("bulge", 0.0),
            }
            for point in rotated
        ]
        _write_lwpolyline(lines, "CONTOURS", placed, order_height=order_height, handle=_entity_handle(), cad_like=cad_like)

    for primitive in (order_data.primitives or []):
        primitive_type = primitive.get("type") if isinstance(primitive, dict) else None
        if primitive_type == "rect":
            x = _to_float(primitive.get("x"))
            y = _to_float(primitive.get("y"))
            width = _to_float(primitive.get("width"))
            height = _to_float(primitive.get("height"))
            if width <= 0 or height <= 0:
                continue
            rect_vertices = [
                {"x": x, "y": y, "bulge": 0.0},
                {"x": x + width, "y": y, "bulge": 0.0},
                {"x": x + width, "y": y + height, "bulge": 0.0},
                {"x": x, "y": y + height, "bulge": 0.0},
            ]
            _write_lwpolyline(lines, "PRIMITIVES", rect_vertices, order_height=order_height, handle=_entity_handle(), cad_like=cad_like)
        elif primitive_type == "circle":
            _write_circle(
                lines,
                "PRIMITIVES",
                x=_to_float(primitive.get("x")),
                y=_to_float(primitive.get("y")),
                radius=_to_float(primitive.get("radius")),
                order_height=order_height,
                handle=_entity_handle(),
                cad_like=cad_like,
            )

    if include_labels:
        for label in (getattr(order_data, "labels", None) or []):
            text = _sanitize_text(_value_from_obj_or_dict(label, "text", ""))
            if not text:
                continue

            x = _to_float(_value_from_obj_or_dict(label, "x"))
            y = _to_float(_value_from_obj_or_dict(label, "y"))
            font_size = _to_float(_value_from_obj_or_dict(label, "fontSizeMm", 4.0), 4.0)
            height = font_size if font_size > 0 else 4.0

            _write_text(
                lines,
                "LABELS",
                x=x,
                y=y,
                text=text,
                height=height,
                order_height=order_height,
                handle=_entity_handle(),
                cad_like=cad_like,
            )

    return missing_contours


def _emit_header_cad(lines: List[str]) -> None:
    lines.extend([
        "0", "SECTION", "2", "HEADER",
        "9", "$INSUNITS", "70", "4",
        "9", "$ACADVER", "1", "AC1014",
        "9", "$HANDSEED", "5", "FFFF",
        "0", "ENDSEC",
    ])


def _emit_tables_cad(lines: List[str]) -> None:
    lines.extend([
        "0", "SECTION", "2", "TABLES",
        "0", "TABLE", "2", "VPORT", "70", "1",
        "0", "VPORT", "2", "*ACTIVE", "70", "0",
        "0", "ENDTAB",
        "0", "TABLE", "2", "LTYPE", "70", "3",
        "0", "LTYPE", "2", "BYBLOCK", "70", "0", "3", "", "72", "65", "73", "0", "40", "0",
        "0", "LTYPE", "2", "BYLAYER", "70", "0", "3", "", "72", "65", "73", "0", "40", "0",
        "0", "LTYPE", "2", "CONTINUOUS", "70", "0", "3", "Solid line", "72", "65", "73", "0", "40", "0",
        "0", "ENDTAB",
        "0", "TABLE", "2", "LAYER", "70", "5",
        "0", "LAYER", "100", "AcDbSymbolTableRecord", "100", "AcDbLayerTableRecord", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS",
        "0", "LAYER", "100", "AcDbSymbolTableRecord", "100", "AcDbLayerTableRecord", "2", "LAYMENT", "70", "0", "62", "7", "6", "CONTINUOUS",
        "0", "LAYER", "100", "AcDbSymbolTableRecord", "100", "AcDbLayerTableRecord", "2", "CONTOURS", "70", "0", "62", "2", "6", "CONTINUOUS",
        "0", "LAYER", "100", "AcDbSymbolTableRecord", "100", "AcDbLayerTableRecord", "2", "PRIMITIVES", "70", "0", "62", "4", "6", "CONTINUOUS",
        "0", "LAYER", "100", "AcDbSymbolTableRecord", "100", "AcDbLayerTableRecord", "2", "LABELS", "70", "0", "62", "7", "6", "CONTINUOUS",
        "0", "ENDTAB",
        "0", "TABLE", "2", "STYLE", "70", "1",
        "0", "STYLE", "100", "AcDbSymbolTableRecord", "100", "AcDbTextStyleTableRecord", "2", "STANDARD", "70", "0", "40", "0", "41", "1", "50", "0", "71", "0", "42", "2.5", "3", "Arial.ttf", "4", "",
        "0", "ENDTAB",
        "0", "TABLE", "2", "VIEW", "70", "0", "0", "ENDTAB",
        "0", "TABLE", "2", "UCS", "70", "0", "0", "ENDTAB",
        "0", "TABLE", "2", "APPID", "70", "1",
        "0", "APPID", "100", "AcDbSymbolTableRecord", "100", "AcDbRegAppTableRecord", "2", "ACAD", "70", "0",
        "0", "ENDTAB",
        "0", "TABLE", "2", "DIMSTYLE", "70", "0", "0", "ENDTAB",
        "0", "TABLE", "2", "BLOCK_RECORD", "70", "2",
        "0", "BLOCK_RECORD", "100", "AcDbSymbolTableRecord", "100", "AcDbBlockTableRecord", "2", "*MODEL_SPACE", "70", "0",
        "0", "BLOCK_RECORD", "100", "AcDbSymbolTableRecord", "100", "AcDbBlockTableRecord", "2", "*PAPER_SPACE", "70", "0",
        "0", "ENDTAB",
        "0", "ENDSEC",
    ])


def _emit_blocks_cad(lines: List[str]) -> None:
    lines.extend([
        "0", "SECTION", "2", "BLOCKS",
        "0", "BLOCK", "8", "0", "2", "*MODEL_SPACE", "70", "0", "10", "0", "20", "0", "30", "0", "3", "*MODEL_SPACE", "1", "",
        "0", "ENDBLK", "8", "0",
        "0", "BLOCK", "8", "0", "2", "*PAPER_SPACE", "70", "0", "10", "0", "20", "0", "30", "0", "3", "*PAPER_SPACE", "1", "",
        "0", "ENDBLK", "8", "0",
        "0", "ENDSEC",
    ])


def _emit_objects_cad(lines: List[str]) -> None:
    lines.extend([
        "0", "SECTION", "2", "OBJECTS",
        "0", "DICTIONARY", "5", "C", "100", "AcDbDictionary", "281", "1", "3", "ACAD_GROUP", "350", "D", "3", "ACAD_MLINESTYLE", "350", "E",
        "0", "DICTIONARY", "5", "D", "100", "AcDbDictionary", "281", "1",
        "0", "DICTIONARY", "5", "E", "100", "AcDbDictionary", "281", "1",
        "0", "ENDSEC",
    ])


def generate_order_layout_dxf_minimal(order_data: Any) -> Tuple[str, List[str]]:
    order_width = float(order_data.orderMeta.width)
    order_height = float(order_data.orderMeta.height)

    lines: List[str] = [
        "0", "SECTION", "2", "HEADER", "0", "ENDSEC",
        "0", "SECTION", "2", "TABLES", "0", "ENDSEC",
        "0", "SECTION", "2", "ENTITIES",
    ]
    missing_contours = _emit_entities(lines, order_data, order_width, order_height, include_labels=False)
    lines.extend(["0", "ENDSEC", "0", "EOF"])
    return "\n".join(lines) + "\n", sorted(set(missing_contours))


def generate_order_layout_dxf_cad(order_data: Any, include_labels: bool = True) -> Tuple[str, List[str]]:
    order_width = float(order_data.orderMeta.width)
    order_height = float(order_data.orderMeta.height)

    lines: List[str] = []
    _emit_header_cad(lines)
    _emit_tables_cad(lines)
    _emit_blocks_cad(lines)
    lines.extend(["0", "SECTION", "2", "ENTITIES"])

    handle = 0x100

    def next_handle() -> str:
        nonlocal handle
        value = f"{handle:X}"
        handle += 1
        return value

    missing_contours = _emit_entities(
        lines,
        order_data,
        order_width,
        order_height,
        include_labels=include_labels,
        cad_like=True,
        next_handle=next_handle,
    )

    lines.extend(["0", "ENDSEC"])
    _emit_objects_cad(lines)
    lines.extend(["0", "EOF"])
    return "\n".join(lines) + "\n", sorted(set(missing_contours))


def _value_from_obj_or_dict(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)


def _load_contour_geometry(contour_id: str) -> Tuple[float, float, List[Dict[str, float]]] | None:
    geometry_path = contour_geometry_path(contour_id)
    if not geometry_path.exists() or not geometry_path.is_file():
        return None

    import json

    with geometry_path.open("r", encoding="utf-8") as geometry_file:
        geometry_data = json.load(geometry_file)

    vertices = _parse_vertices(geometry_data.get("vertices"))
    bbox = geometry_data.get("bbox") if isinstance(geometry_data, dict) else None
    width = _to_float((bbox or {}).get("width"), 0.0)
    height = _to_float((bbox or {}).get("height"), 0.0)

    if not vertices:
        return None

    if width <= 0:
        width = max(point["x"] for point in vertices) - min(point["x"] for point in vertices)
    if height <= 0:
        height = max(point["y"] for point in vertices) - min(point["y"] for point in vertices)

    return width, height, vertices


def generate_order_layout_dxf(order_data: Any) -> Tuple[str, List[str]]:
    return generate_order_layout_dxf_minimal(order_data)

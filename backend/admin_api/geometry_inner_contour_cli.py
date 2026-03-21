from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

EPS = 1e-9
COORD_EPS = 1e-6
MAX_ARC_SEGMENT_LENGTH_MM = 1.0
MAX_ARC_SEGMENT_ANGLE_DEG = 10.0
SAFE_Z_MM = 5.0
MIN_EDGE_LENGTH_MM = 1e-4
COMMENT_PREFIX = ";"


@dataclass(frozen=True)
class Point:
    x: float
    y: float

    def __add__(self, other: "Point") -> "Point":
        return Point(self.x + other.x, self.y + other.y)

    def __sub__(self, other: "Point") -> "Point":
        return Point(self.x - other.x, self.y - other.y)

    def scale(self, value: float) -> "Point":
        return Point(self.x * value, self.y * value)


@dataclass
class GeometryInnerContourError(Exception):
    message: str
    details: str | None = None

    def __str__(self) -> str:
        return self.message if not self.details else f"{self.message}: {self.details}"


@dataclass(frozen=True)
class CliConfig:
    input_path: Path
    output_path: Path
    z_depth: float
    feed: float
    tool_diameter: float

    @property
    def tool_radius(self) -> float:
        return self.tool_diameter / 2.0


@dataclass(frozen=True)
class PreparedGeometry:
    source_vertices_count: int
    flattened_points_top_left: list[Point]
    flattened_points_math: list[Point]


@dataclass(frozen=True)
class ToolpathResult:
    offset_points_top_left: list[Point]
    offset_points_math: list[Point]


def _format_number(value: float) -> str:
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return text if text and text != "-0" else "0"


def _comment(text: str) -> str:
    return f"{COMMENT_PREFIX} {text}"


def _distance(a: Point, b: Point) -> float:
    return math.hypot(b.x - a.x, b.y - a.y)


def _cross(a: Point, b: Point) -> float:
    return a.x * b.y - a.y * b.x


def _dot(a: Point, b: Point) -> float:
    return a.x * b.x + a.y * b.y


def _normalize(vector: Point) -> Point:
    length = math.hypot(vector.x, vector.y)
    if length <= EPS:
        raise GeometryInnerContourError("Degenerate segment detected", f"zero-length vector {vector}")
    return Point(vector.x / length, vector.y / length)


def _left_normal(unit_direction: Point) -> Point:
    return Point(-unit_direction.y, unit_direction.x)


def _signed_area(points: Sequence[Point]) -> float:
    area = 0.0
    for index, current in enumerate(points):
        nxt = points[(index + 1) % len(points)]
        area += current.x * nxt.y - nxt.x * current.y
    return area * 0.5


def _is_close_point(a: Point, b: Point, tol: float = COORD_EPS) -> bool:
    return abs(a.x - b.x) <= tol and abs(a.y - b.y) <= tol


def _remove_consecutive_duplicates(points: Iterable[Point], tol: float = COORD_EPS) -> list[Point]:
    cleaned: list[Point] = []
    for point in points:
        if not cleaned or not _is_close_point(cleaned[-1], point, tol):
            cleaned.append(point)

    if len(cleaned) > 1 and _is_close_point(cleaned[0], cleaned[-1], tol):
        cleaned.pop()

    return cleaned


def _point_to_math(vertex: dict[str, float]) -> tuple[Point, float]:
    return Point(float(vertex["x"]), -float(vertex["y"])), -float(vertex.get("bulge", 0.0))


def _bulge_arc_points(start: Point, end: Point, bulge: float) -> list[Point]:
    if abs(bulge) <= EPS:
        return [end]

    chord = end - start
    chord_length = math.hypot(chord.x, chord.y)
    if chord_length <= EPS:
        raise GeometryInnerContourError("Invalid arc segment", "bulge specified for zero-length chord")

    theta = 4.0 * math.atan(bulge)
    if abs(theta) <= EPS:
        return [end]

    radius = chord_length / (2.0 * math.sin(abs(theta) / 2.0))
    midpoint = Point((start.x + end.x) * 0.5, (start.y + end.y) * 0.5)
    unit_normal = _left_normal(_normalize(chord))
    offset_to_center = math.sqrt(max(radius * radius - (chord_length * 0.5) ** 2, 0.0))
    center = midpoint + unit_normal.scale(math.copysign(offset_to_center, bulge))

    start_angle = math.atan2(start.y - center.y, start.x - center.x)
    end_angle = start_angle + theta
    arc_length = abs(theta) * abs(radius)
    step_count = max(
        1,
        math.ceil(abs(math.degrees(theta)) / MAX_ARC_SEGMENT_ANGLE_DEG),
        math.ceil(arc_length / MAX_ARC_SEGMENT_LENGTH_MM),
    )

    points: list[Point] = []
    for step in range(1, step_count + 1):
        t = step / step_count
        angle = start_angle + theta * t
        points.append(Point(center.x + abs(radius) * math.cos(angle), center.y + abs(radius) * math.sin(angle)))

    points[-1] = end
    return points


def _parse_geometry_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as source:
            payload = json.load(source)
    except FileNotFoundError as exc:
        raise GeometryInnerContourError("Input geometry JSON does not exist", str(path)) from exc
    except json.JSONDecodeError as exc:
        raise GeometryInnerContourError("Input geometry JSON is not valid JSON", str(exc)) from exc

    if not isinstance(payload, dict):
        raise GeometryInnerContourError("Geometry payload must be a JSON object")

    if payload.get("version") != 1:
        raise GeometryInnerContourError("Unsupported geometry JSON version", f"expected 1, got {payload.get('version')}")

    if payload.get("units") != "mm":
        raise GeometryInnerContourError("Unsupported geometry units", f"expected 'mm', got {payload.get('units')!r}")

    if payload.get("coordinateSystem") != "origin-top-left":
        raise GeometryInnerContourError(
            "Unsupported coordinate system",
            f"expected 'origin-top-left', got {payload.get('coordinateSystem')!r}",
        )

    vertices = payload.get("vertices")
    if not isinstance(vertices, list) or len(vertices) < 3:
        raise GeometryInnerContourError("Geometry JSON must contain at least 3 vertices")

    bbox = payload.get("bbox")
    if not isinstance(bbox, dict):
        raise GeometryInnerContourError("Geometry JSON must contain bbox metadata")

    return payload


def _prepare_geometry(path: Path) -> PreparedGeometry:
    payload = _parse_geometry_json(path)
    raw_vertices = payload["vertices"]

    math_points: list[Point] = []
    for index, raw_vertex in enumerate(raw_vertices):
        if not isinstance(raw_vertex, dict):
            raise GeometryInnerContourError("Invalid vertex entry", f"vertex #{index + 1} must be an object")
        if "x" not in raw_vertex or "y" not in raw_vertex:
            raise GeometryInnerContourError("Invalid vertex entry", f"vertex #{index + 1} must contain x and y")
        point_math, bulge_math = _point_to_math(raw_vertex)
        if not math.isfinite(point_math.x) or not math.isfinite(point_math.y) or not math.isfinite(bulge_math):
            raise GeometryInnerContourError("Invalid numeric value in geometry", f"vertex #{index + 1}")
        math_points.append(point_math)

    if len(math_points) >= 2 and _is_close_point(math_points[0], math_points[-1]):
        raw_vertices = raw_vertices[:-1]
        math_points = math_points[:-1]

    if len(math_points) < 3:
        raise GeometryInnerContourError("Closed contour requires at least 3 distinct vertices")

    flattened_math: list[Point] = [math_points[0]]
    for index, raw_vertex in enumerate(raw_vertices):
        start, bulge_math = _point_to_math(raw_vertex)
        end = math_points[(index + 1) % len(math_points)]
        if _distance(start, end) <= EPS:
            raise GeometryInnerContourError(
                "Degenerate input contour",
                f"edge #{index + 1} has zero length before flattening",
            )
        flattened_math.extend(_bulge_arc_points(start, end, bulge_math))

    flattened_math = _remove_consecutive_duplicates(flattened_math)
    if len(flattened_math) < 3:
        raise GeometryInnerContourError("Flattened contour has fewer than 3 distinct points")

    if abs(_signed_area(flattened_math)) <= EPS:
        raise GeometryInnerContourError("Flattened contour area is zero or numerically unstable")

    for index, point in enumerate(flattened_math):
        next_point = flattened_math[(index + 1) % len(flattened_math)]
        if _distance(point, next_point) < MIN_EDGE_LENGTH_MM:
            raise GeometryInnerContourError(
                "Flattened contour contains too-short segments",
                f"segment #{index + 1} is shorter than {MIN_EDGE_LENGTH_MM} mm",
            )

    _assert_simple_polygon(flattened_math, "Input contour is self-intersecting after bulge flattening")

    flattened_top_left = [Point(point.x, -point.y) for point in flattened_math]
    return PreparedGeometry(
        source_vertices_count=len(raw_vertices),
        flattened_points_top_left=flattened_top_left,
        flattened_points_math=flattened_math,
    )


def _line_intersection(point_a: Point, direction_a: Point, point_b: Point, direction_b: Point) -> Point | None:
    denominator = _cross(direction_a, direction_b)
    if abs(denominator) <= EPS:
        return None
    delta = point_b - point_a
    t = _cross(delta, direction_b) / denominator
    return point_a + direction_a.scale(t)


def _segments_intersect(a1: Point, a2: Point, b1: Point, b2: Point) -> bool:
    def orient(p: Point, q: Point, r: Point) -> float:
        return _cross(q - p, r - p)

    def on_segment(p: Point, q: Point, r: Point) -> bool:
        return (
            min(p.x, r.x) - COORD_EPS <= q.x <= max(p.x, r.x) + COORD_EPS
            and min(p.y, r.y) - COORD_EPS <= q.y <= max(p.y, r.y) + COORD_EPS
        )

    o1 = orient(a1, a2, b1)
    o2 = orient(a1, a2, b2)
    o3 = orient(b1, b2, a1)
    o4 = orient(b1, b2, a2)

    if (o1 > COORD_EPS and o2 < -COORD_EPS or o1 < -COORD_EPS and o2 > COORD_EPS) and (
        o3 > COORD_EPS and o4 < -COORD_EPS or o3 < -COORD_EPS and o4 > COORD_EPS
    ):
        return True

    if abs(o1) <= COORD_EPS and on_segment(a1, b1, a2):
        return True
    if abs(o2) <= COORD_EPS and on_segment(a1, b2, a2):
        return True
    if abs(o3) <= COORD_EPS and on_segment(b1, a1, b2):
        return True
    if abs(o4) <= COORD_EPS and on_segment(b1, a2, b2):
        return True

    return False


def _assert_simple_polygon(points: Sequence[Point], message: str) -> None:
    edge_count = len(points)
    for index in range(edge_count):
        a1 = points[index]
        a2 = points[(index + 1) % edge_count]
        for other_index in range(index + 1, edge_count):
            if other_index == index:
                continue
            if (other_index + 1) % edge_count == index or (index + 1) % edge_count == other_index:
                continue
            if index == 0 and other_index == edge_count - 1:
                continue
            b1 = points[other_index]
            b2 = points[(other_index + 1) % edge_count]
            if _segments_intersect(a1, a2, b1, b2):
                raise GeometryInnerContourError(message, f"segments #{index + 1} and #{other_index + 1} intersect")


def _point_in_polygon(point: Point, polygon: Sequence[Point]) -> bool:
    inside = False
    for index, current in enumerate(polygon):
        nxt = polygon[(index + 1) % len(polygon)]
        if abs(_cross(nxt - current, point - current)) <= COORD_EPS and (
            min(current.x, nxt.x) - COORD_EPS <= point.x <= max(current.x, nxt.x) + COORD_EPS
            and min(current.y, nxt.y) - COORD_EPS <= point.y <= max(current.y, nxt.y) + COORD_EPS
        ):
            return True

        intersects = ((current.y > point.y) != (nxt.y > point.y)) and (
            point.x < (nxt.x - current.x) * (point.y - current.y) / (nxt.y - current.y + EPS) + current.x
        )
        if intersects:
            inside = not inside
    return inside


def _distance_point_to_segment(point: Point, start: Point, end: Point) -> float:
    segment = end - start
    length_sq = _dot(segment, segment)
    if length_sq <= EPS:
        return _distance(point, start)
    t = max(0.0, min(1.0, _dot(point - start, segment) / length_sq))
    projection = start + segment.scale(t)
    return _distance(point, projection)


def _minimum_distance_to_polygon(point: Point, polygon: Sequence[Point]) -> float:
    return min(
        _distance_point_to_segment(point, polygon[index], polygon[(index + 1) % len(polygon)])
        for index in range(len(polygon))
    )


def _build_inward_offset(points_math: Sequence[Point], tool_radius: float) -> ToolpathResult:
    if tool_radius <= 0:
        raise GeometryInnerContourError("Tool radius must be greater than zero")

    working_points = list(points_math)
    if _signed_area(working_points) < 0:
        working_points.reverse()

    offset_points: list[Point] = []
    edge_count = len(working_points)
    for index in range(edge_count):
        prev_point = working_points[(index - 1) % edge_count]
        current = working_points[index]
        next_point = working_points[(index + 1) % edge_count]

        prev_direction = _normalize(current - prev_point)
        next_direction = _normalize(next_point - current)
        prev_normal = _left_normal(prev_direction)
        next_normal = _left_normal(next_direction)

        shifted_prev_point = current + prev_normal.scale(tool_radius)
        shifted_next_point = current + next_normal.scale(tool_radius)
        candidate = _line_intersection(shifted_prev_point, prev_direction, shifted_next_point, next_direction)

        if candidate is None:
            normal_sum = prev_normal + next_normal
            if math.hypot(normal_sum.x, normal_sum.y) <= EPS:
                raise GeometryInnerContourError(
                    "Cannot build inward offset",
                    f"parallel/opposite edges near vertex #{index + 1}",
                )
            candidate = current + _normalize(normal_sum).scale(tool_radius)

        if not math.isfinite(candidate.x) or not math.isfinite(candidate.y):
            raise GeometryInnerContourError("Cannot build inward offset", f"invalid vertex near input vertex #{index + 1}")

        offset_points.append(candidate)

    offset_points = _remove_consecutive_duplicates(offset_points)
    if len(offset_points) < 3:
        raise GeometryInnerContourError(
            "Inward offset contour collapsed",
            "fewer than 3 vertices remain after offset construction",
        )

    if abs(_signed_area(offset_points)) <= EPS:
        raise GeometryInnerContourError("Inward offset contour area collapsed to zero")

    for index, point in enumerate(offset_points):
        next_point = offset_points[(index + 1) % len(offset_points)]
        if _distance(point, next_point) < MIN_EDGE_LENGTH_MM:
            raise GeometryInnerContourError(
                "Inward offset contour contains too-short segments",
                f"segment #{index + 1} is shorter than {MIN_EDGE_LENGTH_MM} mm",
            )
        if not _point_in_polygon(point, working_points):
            raise GeometryInnerContourError(
                "Computed inward offset leaves the source contour",
                f"offset vertex #{index + 1} is outside the source polygon",
            )
        boundary_distance = _minimum_distance_to_polygon(point, working_points)
        if boundary_distance + 1e-5 < tool_radius:
            raise GeometryInnerContourError(
                "Computed inward offset is too close to the source contour",
                f"offset vertex #{index + 1} has only {boundary_distance:.4f} mm clearance for radius {tool_radius:.4f} mm",
            )

    _assert_simple_polygon(offset_points, "Inward offset contour self-intersects")

    offset_top_left = [Point(point.x, -point.y) for point in offset_points]
    return ToolpathResult(offset_points_top_left=offset_top_left, offset_points_math=offset_points)


def _build_success_nc(config: CliConfig, prepared: PreparedGeometry, result: ToolpathResult) -> str:
    lines = [
        _comment("geometry_inner_contour_cli"),
        _comment(f"input_path={config.input_path}"),
        _comment(f"z_depth={_format_number(config.z_depth)}"),
        _comment(f"feed={_format_number(config.feed)}"),
        _comment(f"tool_diameter={_format_number(config.tool_diameter)}"),
        _comment(f"tool_radius={_format_number(config.tool_radius)}"),
        _comment(f"source_vertices={prepared.source_vertices_count}"),
        _comment(f"flattened_vertices={len(prepared.flattened_points_top_left)}"),
        _comment(f"offset_vertices={len(result.offset_points_top_left)}"),
        "G21",
        "G17",
        "G90",
        f"G0 Z{_format_number(SAFE_Z_MM)}",
    ]

    start_point = result.offset_points_top_left[0]
    lines.append(f"G0 X{_format_number(start_point.x)} Y{_format_number(start_point.y)}")
    lines.append(f"G1 Z{_format_number(config.z_depth)} F{_format_number(config.feed)}")

    for point in result.offset_points_top_left[1:]:
        lines.append(f"G1 X{_format_number(point.x)} Y{_format_number(point.y)} F{_format_number(config.feed)}")

    lines.append(f"G1 X{_format_number(start_point.x)} Y{_format_number(start_point.y)} F{_format_number(config.feed)}")
    lines.append(f"G0 Z{_format_number(SAFE_Z_MM)}")
    lines.append("M30")
    return "\n".join(lines) + "\n"


def _build_error_nc(config: CliConfig | None, message: str, details: str | None = None) -> str:
    lines = [_comment("geometry_inner_contour_cli ERROR")]
    if config is not None:
        lines.append(_comment(f"input_path={config.input_path}"))
        lines.append(_comment(f"output_path={config.output_path}"))
        lines.append(_comment(f"z_depth={_format_number(config.z_depth)}"))
        lines.append(_comment(f"feed={_format_number(config.feed)}"))
        lines.append(_comment(f"tool_diameter={_format_number(config.tool_diameter)}"))
    lines.append(_comment(f"ERROR: {message}"))
    if details:
        lines.append(_comment(f"DETAILS: {details}"))
    lines.extend(["G21", "G17", "G90", f"G0 Z{_format_number(SAFE_Z_MM)}", "M30"])
    return "\n".join(lines) + "\n"


def _write_output(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _parse_args(argv: Sequence[str]) -> CliConfig:
    parser = argparse.ArgumentParser(
        description="Generate a simple single-pass inner contour NC file from geometry JSON.",
    )
    parser.add_argument("--input", required=True, dest="input_path", help="Path to geometry JSON")
    parser.add_argument("--output", required=True, dest="output_path", help="Path to output .nc file")
    parser.add_argument("--z-depth", required=True, type=float, dest="z_depth", help="Target cutting depth in mm")
    parser.add_argument("--feed", required=True, type=float, dest="feed", help="Feed rate in mm/min")
    parser.add_argument("--tool-diameter", required=True, type=float, dest="tool_diameter", help="Tool diameter in mm")
    args = parser.parse_args(argv)

    input_path = Path(args.input_path)
    if not input_path.exists() or not input_path.is_file():
        raise GeometryInnerContourError("--input must point to an existing file", str(input_path))

    output_path = Path(args.output_path)
    if output_path.exists() and output_path.is_dir():
        raise GeometryInnerContourError("--output must be a file path", str(output_path))

    if args.feed <= 0:
        raise GeometryInnerContourError("--feed must be > 0")

    if args.tool_diameter <= 0:
        raise GeometryInnerContourError("--tool-diameter must be > 0")

    if not math.isfinite(args.z_depth):
        raise GeometryInnerContourError("--z-depth must be a finite number")

    return CliConfig(
        input_path=input_path,
        output_path=output_path,
        z_depth=float(args.z_depth),
        feed=float(args.feed),
        tool_diameter=float(args.tool_diameter),
    )


def run_cli(argv: Sequence[str]) -> int:
    config: CliConfig | None = None
    try:
        config = _parse_args(argv)
        prepared = _prepare_geometry(config.input_path)
        result = _build_inward_offset(prepared.flattened_points_math, config.tool_radius)
        nc_text = _build_success_nc(config, prepared, result)
        _write_output(config.output_path, nc_text)
        print(
            "OK: generated inner contour NC",
            f"input={config.input_path}",
            f"output={config.output_path}",
            f"flattened_vertices={len(prepared.flattened_points_top_left)}",
            f"offset_vertices={len(result.offset_points_top_left)}",
            sep="\n",
        )
        return 0
    except GeometryInnerContourError as exc:
        if config is not None:
            _write_output(config.output_path, _build_error_nc(config, exc.message, exc.details))
            print(f"ERROR: {exc.message}", file=sys.stderr)
            if exc.details:
                print(f"DETAILS: {exc.details}", file=sys.stderr)
            print(f"Diagnostic NC written to: {config.output_path}", file=sys.stderr)
        else:
            print(f"ERROR: {exc.message}", file=sys.stderr)
            if exc.details:
                print(f"DETAILS: {exc.details}", file=sys.stderr)
        return 1


def main() -> None:
    raise SystemExit(run_cli(sys.argv[1:]))


if __name__ == "__main__":
    main()

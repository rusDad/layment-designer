# ---------------------------
# DXF (Fusion 360, ASCII) -> SVG
# Поддержка:
# - ENTITIES / LWPOLYLINE
# - один замкнутый контур
# - LINE + ARC через bulge
# - 1 unit = 1 mm
# ---------------------------

import math
import os
import sys
from pathlib import Path

EPS = 1e-9


# ---------------------------
# DXF PARSER (LWPOLYLINE)
# ---------------------------

def read_lwpolyline(path: Path):
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()

    verts = []
    closed = False
    in_poly = False
    i = 0

    while i < len(lines) - 1:
        if lines[i] == "0" and lines[i + 1] == "LWPOLYLINE":
            in_poly = True
            i += 2
            continue

        if in_poly:
            code = lines[i]
            val = lines[i + 1]

            if code == "70":  # flags
                closed = (int(val) & 1) == 1

            elif code == "10":  # X
                x = float(val)
                y = float(lines[i + 3])
                verts.append({"x": x, "y": y, "bulge": 0.0})
                i += 4
                continue

            elif code == "42":  # bulge
                if not verts:
                    raise ValueError("bulge without vertex")
                verts[-1]["bulge"] = float(val)

            elif code == "0":  # end of entity
                break

        i += 2

    if not verts:
        raise ValueError("No LWPOLYLINE found in DXF")

    if not closed:
        raise ValueError("LWPOLYLINE is not closed")

    return verts


def read_circle(path: Path):
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()

    i = 0
    while i < len(lines) - 1:
        if lines[i] == "0" and lines[i + 1] == "CIRCLE":
            i += 2
            cx = None
            cy = None
            r = None

            while i < len(lines) - 1:
                code = lines[i]
                val = lines[i + 1]

                if code == "0":
                    break
                if code == "10":
                    cx = float(val)
                elif code == "20":
                    cy = float(val)
                elif code == "40":
                    r = float(val)

                i += 2

            if cx is None or cy is None or r is None:
                raise ValueError("Invalid CIRCLE entity")
            if r <= 0:
                raise ValueError("CIRCLE radius must be > 0")

            return {"cx": cx, "cy": cy, "r": r}

        i += 2

    raise ValueError("No CIRCLE found in DXF")


def circle_to_lwpolyline_vertices(cx, cy, r):
    b = math.sqrt(2.0) - 1.0
    return [
        {"x": cx + r, "y": cy, "bulge": b},
        {"x": cx, "y": cy + r, "bulge": b},
        {"x": cx - r, "y": cy, "bulge": b},
        {"x": cx, "y": cy - r, "bulge": b},
    ]


def read_supported_geometry(path: Path):
    try:
        return read_lwpolyline(path)
    except ValueError:
        pass

    try:
        circle = read_circle(path)
        return circle_to_lwpolyline_vertices(circle["cx"], circle["cy"], circle["r"])
    except ValueError as exc:
        raise ValueError("No supported geometry found (LWPOLYLINE or CIRCLE)") from exc


# ---------------------------
# GEOMETRY
# ---------------------------

def invert_y(vertices):
    for v in vertices:
        v["y"] = -v["y"]
        v["bulge"] = -v["bulge"]
    return vertices


def bulge_to_arc(p1, p2, bulge):
    # ---------------------------
    # Возвращает параметры SVG ARC
    # ---------------------------
    x1, y1 = p1
    x2, y2 = p2

    theta = 4.0 * math.atan(bulge)
    chord = math.hypot(x2 - x1, y2 - y1)

    if chord < EPS:
        raise ValueError("Zero-length arc")

    r = chord / (2.0 * math.sin(abs(theta) / 2.0))

    # midpoint of chord
    mx = (x1 + x2) * 0.5
    my = (y1 + y2) * 0.5

    # perpendicular vector
    dx = x2 - x1
    dy = y2 - y1
    nx = -dy
    ny = dx

    norm = math.hypot(nx, ny)
    nx /= norm
    ny /= norm

    h_sq = r * r - (chord * 0.5) ** 2
    h = math.sqrt(max(h_sq, 0.0))

    if bulge < 0:
        h = -h

    cx = mx + nx * h
    cy = my + ny * h

    large_arc = 1 if abs(theta) > math.pi else 0
    sweep = 1 if bulge > 0 else 0

    return {
        "r": abs(r),
        "large": large_arc,
        "sweep": sweep,
        "end": (x2, y2),
        "center": (cx, cy),
    }


# ---------------------------
# SVG
# ---------------------------

def polyline_to_svg_path(verts):
    cmds = []

    x0, y0 = verts[0]["x"], verts[0]["y"]
    cmds.append(f"M {x0:.6f} {y0:.6f}")

    n = len(verts)

    for i in range(n):
        v1 = verts[i]
        v2 = verts[(i + 1) % n]

        if abs(v1["bulge"]) < EPS:
            cmds.append(f"L {v2['x']:.6f} {v2['y']:.6f}")
        else:
            arc = bulge_to_arc(
                (v1["x"], v1["y"]),
                (v2["x"], v2["y"]),
                v1["bulge"],
            )
            cmds.append(
                f"A {arc['r']:.6f} {arc['r']:.6f} 0 "
                f"{arc['large']} {arc['sweep']} "
                f"{arc['end'][0]:.6f} {arc['end'][1]:.6f}"
            )

    cmds.append("Z")
    return " ".join(cmds)


def compute_bbox(verts):
    xs = [v["x"] for v in verts]
    ys = [v["y"] for v in verts]
    return min(xs), min(ys), max(xs), max(ys)


def normalize_vertices_to_bbox(verts, bbox):
    min_x, min_y, _, _ = bbox
    normalized = []
    for v in verts:
        normalized.append({
            "x": v["x"] - min_x,
            "y": v["y"] - min_y,
            "bulge": v["bulge"],
        })
    return normalized


def build_geometry_payload(verts, bbox):
    min_x, min_y, max_x, max_y = bbox
    normalized_vertices = normalize_vertices_to_bbox(verts, bbox)
    return {
        "version": 1,
        "units": "mm",
        "coordinateSystem": "origin-top-left",
        "bbox": {
            "width": max_x - min_x,
            "height": max_y - min_y,
        },
        "vertices": normalized_vertices,
    }


def write_svg(path_d, bbox, out_path: Path):
    min_x, min_y, max_x, max_y = bbox
    w = max_x - min_x
    h = max_y - min_y

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="{min_x:.6f} {min_y:.6f} {w:.6f} {h:.6f}">
  <path d="{path_d}" fill="none" stroke="black"/>
</svg>
"""

    out_path.write_text(svg, encoding="utf-8")


# ---------------------------
# PIPELINE
# ---------------------------

def convert(dxf_path: Path, svg_path: Path):
    verts = read_supported_geometry(dxf_path)
    verts = invert_y(verts)
    path_d = polyline_to_svg_path(verts)
    bbox = compute_bbox(verts)
    write_svg(path_d, bbox, svg_path)
    return build_geometry_payload(verts, bbox)


def _selftest_arc_direction():
    # Контур: нижняя кромка как дуга и 2 прямых до замыкания.
    # До фикса инверсии bulge sweep был 1, после фикса должен быть 0.
    verts = [
        {"x": 0.0, "y": 0.0, "bulge": 1.0},
        {"x": 10.0, "y": 0.0, "bulge": 0.0},
        {"x": 10.0, "y": 10.0, "bulge": 0.0},
        {"x": 0.0, "y": 10.0, "bulge": 0.0},
    ]

    path_d = polyline_to_svg_path(invert_y(verts))

    assert "A " in path_d, f"Expected arc command in path, got: {path_d}"
    assert " 0 0 " in path_d, (
        "Expected arc flags 'large=0 sweep=0' after Y inversion; "
        f"got path: {path_d}"
    )


def _selftest_circle_as_arcs():
    verts = circle_to_lwpolyline_vertices(cx=0.0, cy=0.0, r=10.0)
    path_d = polyline_to_svg_path(invert_y(verts))
    assert path_d.count("A ") == 4, f"Expected 4 arc commands, got: {path_d}"


# ---------------------------
# CLI
# ---------------------------

def main():
    if os.getenv("DXF_TO_SVG_SELFTEST") == "1":
        _selftest_arc_direction()
        _selftest_circle_as_arcs()

    if len(sys.argv) != 3:
        print("Usage: dxf_to_svg.py input.dxf output.svg")
        sys.exit(1)

    dxf = Path(sys.argv[1])
    svg = Path(sys.argv[2])

    if not dxf.exists():
        raise FileNotFoundError(dxf)

    convert(dxf, svg)
    print(f"OK: {svg}")


if __name__ == "__main__":
    main()

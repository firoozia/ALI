"""
FIROO CAM — Line Door Pattern Generator
========================================
Python implementation of Grasshopper line_door.ghx algorithm.

Algorithm (reverse-engineered from GHX):
  1. Center Box width×height at origin → Rectangle
  2. Explode → top + bottom edges
  3. N = ceil(width / spacing)           ← Length / slider1 → Round Ceiling
  4. Divide top edge into N equal pts    ← Divide Curve (top)
  5. Divide bottom edge into N pts       ← Divide Curve (bottom)
  6. Extend each line by `extend` mm     ← Extend Curve (both ends)
  7. ratio → Amplify shift (first line   ← Amp + Move
     starts at ratio*spacing from edge)

GHX slider defaults:
  spacing = 25.2 mm   (slider 1)
  extend  = 26    mm  (slider 2 — extension beyond top/bottom)
  ratio   = 0.66      (slider 3 — start offset fraction)
  width   = 456   mm  (slider 8)
  height  = 799   mm  (slider 9)
"""
from __future__ import annotations
import math
from typing import List

from pattern_clip_engine import Entity, Point, write_dxf


def generate_line_door(
    width:   float = 456.0,
    height:  float = 799.0,
    spacing: float = 25.2,
    extend:  float = 26.0,
    ratio:   float = 0.66,
    origin_x: float = 0.0,
    origin_y: float = 0.0,
    layer:   str   = "LINE_DOOR",
) -> List[Entity]:
    """
    Generate vertical line door pattern as a list of Entity objects.

    The rectangle is centered at (origin_x, origin_y).
    Lines run from y = origin_y - height/2 - extend
              to   y = origin_y + height/2 + extend
    X positions: N+1 lines from left edge to right edge of the rectangle,
                 shifted by ratio*actual_spacing from the left edge.

    Returns entities ready for use with PatternClipper.
    """
    if spacing <= 0 or width <= 0 or height <= 0:
        return []

    # ── geometry bounds ────────────────────────────────────────────────────
    x_left  = origin_x - width  / 2.0
    x_right = origin_x + width  / 2.0
    y_bot   = origin_y - height / 2.0 - extend
    y_top   = origin_y + height / 2.0 + extend

    # ── N = ceil(width / spacing), same as GHX Ceiling output ─────────────
    n = math.ceil(width / spacing)
    if n < 1:
        return []

    actual_spacing = width / n          # Divide Curve distributes evenly

    # ── ratio: start offset (Amp + Move in GHX) ───────────────────────────
    # ratio=0 → first line on left edge
    # ratio=0.66 → first line shifted 0.66*actual_spacing inward
    start_x = x_left + ratio * actual_spacing

    # ── generate N+1 vertical lines ───────────────────────────────────────
    entities: List[Entity] = []
    for i in range(n + 1):
        x = start_x + i * actual_spacing
        # wrap: if x > x_right, still draw (clipping handled by PatternClipper)
        entities.append(Entity(
            points=[(x, y_bot), (x, y_top)],
            closed=False,
            layer=layer,
        ))

    return entities


def generate_line_door_dxf(
    out_path: str,
    width:   float = 456.0,
    height:  float = 799.0,
    spacing: float = 25.2,
    extend:  float = 26.0,
    ratio:   float = 0.66,
    origin_x: float = 0.0,
    origin_y: float = 0.0,
    layer:   str   = "LINE_DOOR",
) -> int:
    """Generate and save to DXF. Returns entity count."""
    entities = generate_line_door(
        width=width, height=height, spacing=spacing,
        extend=extend, ratio=ratio,
        origin_x=origin_x, origin_y=origin_y,
        layer=layer,
    )
    write_dxf(entities, out_path)
    return len(entities)


# ── quick test ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    # ── defaults matching GHX sliders ─────────────────────────────────────
    W, H = 456.0, 799.0
    SP   = 25.2
    EXT  = 26.0
    R    = 0.66

    ents = generate_line_door(W, H, SP, EXT, R)
    n    = math.ceil(W / SP)
    print(f"width={W}  spacing={SP}  N=ceil({W}/{SP})={n}")
    print(f"actual_spacing = {W/n:.4f} mm")
    print(f"start_x offset = {R * (W/n):.4f} mm  (ratio={R})")
    print(f"Lines generated: {len(ents)}")
    print(f"X range: {ents[0].points[0][0]:.2f} … {ents[-1].points[0][0]:.2f}")
    print(f"Y range: {ents[0].points[0][1]:.2f} → {ents[0].points[1][1]:.2f}")

    out = "/tmp/line_door_test.dxf"
    generate_line_door_dxf(out, W, H, SP, EXT, R)
    print(f"\nSaved → {out}")

    # ── SVG preview ───────────────────────────────────────────────────────
    svg_out = "/tmp/line_door_test.svg"
    pad = 40
    scale = 0.5
    svg_w = int((W + 2 * pad) * scale)
    svg_h = int((H + 2 * pad + 2 * EXT) * scale)

    def sx(x): return (x + W / 2 + pad) * scale
    def sy(y): return (H / 2 + EXT + pad - y) * scale

    lines_svg = []
    for e in ents:
        x0, y0 = e.points[0]
        x1, y1 = e.points[1]
        lines_svg.append(
            f'<line x1="{sx(x0):.1f}" y1="{sy(y0):.1f}" '
            f'x2="{sx(x1):.1f}" y2="{sy(y1):.1f}" '
            f'stroke="#ff5722" stroke-width="0.8"/>'
        )

    # draw rectangle boundary
    rx = sx(-W / 2);  ry = sy(H / 2)
    rw = W * scale;   rh = H * scale
    lines_svg.insert(0,
        f'<rect x="{rx:.1f}" y="{ry:.1f}" '
        f'width="{rw:.1f}" height="{rh:.1f}" '
        f'fill="none" stroke="#58a6ff" stroke-width="1" stroke-dasharray="4,3"/>'
    )

    svg = (
        f'<?xml version="1.0"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{svg_w}" height="{svg_h}" '
        f'style="background:#0d1117">\n'
        + "\n".join(lines_svg)
        + "\n</svg>"
    )
    with open(svg_out, "w") as f:
        f.write(svg)
    print(f"SVG  → {svg_out}")

"""
FIROO CAM — Line Door Pattern Generator
========================================
Python implementation of Grasshopper line_door.ghx algorithm.

GHX Algorithm (exact):
  1. Center Box width×height at origin
  2. Explode rectangle → 4 edges
  3. Extract top + bottom edges  (Split Tree {*;(1)})
  4. N = ceil(edge_length / spacing)   ← Length → A/B → Round Ceiling
  5. Divide top  edge into N equal pts  (N+1 points, symmetric left→right)
  6. Divide bottom edge into N equal pts
  7. Extend each segment by `extend` mm beyond boundary
  8. Weave top+bottom points alternately → PLine → serpentine path
     • Even lines: top → bottom  (joint at bottom with next line)
     • Odd  lines: bottom → top  (joint at top with next line)

GHX slider defaults:
  spacing = 25.2 mm   (slider 1 — distance between grooves)
  extend  = 26    mm  (slider 2 — extension beyond top/bottom boundary)
  ratio   = 0.66      (slider 3 — depth/scale, used externally)
  width   = 456   mm  (slider 8)
  height  = 799   mm  (slider 9)
"""
from __future__ import annotations
import math
from typing import List

from pattern_clip_engine import Entity, write_dxf


def generate_line_door(
    width:    float = 456.0,
    height:   float = 799.0,
    spacing:  float = 25.2,
    extend:   float = 26.0,
    ratio:    float = 0.66,   # kept for API compatibility; controls external depth
    origin_x: float = 0.0,
    origin_y: float = 0.0,
    layer:    str   = "LINE_DOOR",
) -> List[Entity]:
    """
    Generate a serpentine vertical-line door pattern.

    X positions: symmetric, N+1 points from x_left to x_right
                 (matches GHX Divide Curve on top/bottom edges).
    Serpentine: consecutive lines are joined at alternating top/bottom ends:
        line 0 top→bot, bridge at bot, line 1 bot→top, bridge at top, ...
    Returns a single Entity (polyline) — clip with PatternClipper after.
    """
    if spacing <= 0 or width <= 0 or height <= 0:
        return []

    # ── N = ceil(width / spacing)  [GHX: Length / spacing → Round Ceiling] ──
    n = math.ceil(width / spacing)
    if n < 1:
        return []

    actual_spacing = width / n        # GHX Divide Curve distributes evenly

    # ── symmetric X positions: left edge → right edge ─────────────────────
    x_left = origin_x - width  / 2.0
    xs = [x_left + i * actual_spacing for i in range(n + 1)]

    # ── Y extents (GHX Extend Curve) ──────────────────────────────────────
    y_bot = origin_y - height / 2.0 - extend
    y_top = origin_y + height / 2.0 + extend

    # ── serpentine polyline ────────────────────────────────────────────────
    # Even index i: start at TOP, end at BOTTOM → next bridge at bottom
    # Odd  index i: start at BOTTOM, end at TOP → next bridge at top
    #
    # Resulting point sequence:
    #   (x0,top),(x0,bot),(x1,bot),(x1,top),(x2,top),(x2,bot),(x3,bot),...
    #             ↑               ↑               ↑
    #          joint@bot       joint@top       joint@bot
    pts = []
    for i, x in enumerate(xs):
        if i % 2 == 0:
            pts.append((x, y_top))
            pts.append((x, y_bot))
        else:
            pts.append((x, y_bot))
            pts.append((x, y_top))

    return [Entity(pts, closed=False, layer=layer)]


def generate_line_door_dxf(
    out_path: str,
    width:    float = 456.0,
    height:   float = 799.0,
    spacing:  float = 25.2,
    extend:   float = 26.0,
    ratio:    float = 0.66,
    origin_x: float = 0.0,
    origin_y: float = 0.0,
    layer:    str   = "LINE_DOOR",
) -> int:
    """Generate serpentine line door and save to DXF. Returns entity count."""
    entities = generate_line_door(
        width=width, height=height, spacing=spacing,
        extend=extend, ratio=ratio,
        origin_x=origin_x, origin_y=origin_y,
        layer=layer,
    )
    write_dxf(entities, out_path)
    return len(entities)


# ── quick test + SVG preview ───────────────────────────────────────────────

if __name__ == "__main__":
    W, H = 456.0, 799.0
    SP   = 25.2
    EXT  = 26.0

    ents = generate_line_door(W, H, SP, EXT)
    n    = math.ceil(W / SP)
    sp   = W / n
    print(f"width={W}  spacing={SP}  N=ceil({W}/{SP})={n}")
    print(f"actual_spacing = {sp:.4f} mm  (symmetric, Divide Curve)")
    print(f"X range: {-W/2:.2f} … {+W/2:.2f}  (left edge → right edge)")
    print(f"Y range: {-H/2-EXT:.2f} → {H/2+EXT:.2f}  (with extend={EXT}mm)")
    print(f"Serpentine pts: {len(ents[0].points)}  ({n+1} lines × 2 pts)")
    print(f"Joints: {n} total  (alternating top/bottom)")

    generate_line_door_dxf("/tmp/line_door_test.dxf", W, H, SP, EXT)
    print("\nDXF → /tmp/line_door_test.dxf")

    # ── SVG with colour-coded joints ──────────────────────────────────────
    svg_out = "/tmp/line_door_test.svg"
    pad   = 50
    scale = 0.55
    svg_w = int((W + 2 * pad) * scale)
    svg_h = int((H + 2 * EXT + 2 * pad) * scale)

    def sx(x): return (x + W/2 + pad) * scale
    def sy(y): return (H/2 + EXT + pad - y) * scale

    segs = []
    # rectangle boundary
    segs.append(
        f'<rect x="{sx(-W/2):.1f}" y="{sy(H/2):.1f}" '
        f'width="{W*scale:.1f}" height="{H*scale:.1f}" '
        f'fill="none" stroke="#58a6ff" stroke-width="1.2" stroke-dasharray="5,3"/>'
    )
    # extend zone lines
    segs.append(
        f'<line x1="{sx(-W/2):.1f}" y1="{sy(H/2+EXT):.1f}" '
        f'x2="{sx(W/2):.1f}" y2="{sy(H/2+EXT):.1f}" '
        f'stroke="#30363d" stroke-width="0.8" stroke-dasharray="2,4"/>'
    )
    segs.append(
        f'<line x1="{sx(-W/2):.1f}" y1="{sy(-H/2-EXT):.1f}" '
        f'x2="{sx(W/2):.1f}" y2="{sy(-H/2-EXT):.1f}" '
        f'stroke="#30363d" stroke-width="0.8" stroke-dasharray="2,4"/>'
    )

    pts = ents[0].points
    for k in range(len(pts) - 1):
        ax, ay = pts[k]
        bx, by = pts[k + 1]
        is_bridge = (abs(ax - bx) > 0.01)  # horizontal segment = bridge/joint
        color  = "#e3b341" if is_bridge else "#ff5722"
        width_ = "1.5"     if is_bridge else "0.9"
        segs.append(
            f'<line x1="{sx(ax):.1f}" y1="{sy(ay):.1f}" '
            f'x2="{sx(bx):.1f}" y2="{sy(by):.1f}" '
            f'stroke="{color}" stroke-width="{width_}"/>'
        )

    svg = (
        '<?xml version="1.0"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{svg_w}" height="{svg_h}" style="background:#0d1117">\n'
        + "\n".join(segs)
        + "\n</svg>"
    )
    with open(svg_out, "w") as f:
        f.write(svg)
    print(f"SVG  → {svg_out}")

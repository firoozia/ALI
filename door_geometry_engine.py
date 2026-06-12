"""
FIROO CAM — Door Geometry Engine (Stage 2)

Converts parametric door rules (from GHX analysis) into pure Python geometry.
Implements the cumulative offset frame + groove pattern logic reverse-engineered
from the Grasshopper Cluster's internal wiring:

  Rec → Neg(-15) → Offset → Dispatch → Explode ×2
       → DivLength(15) ×2 → CullI([0,10,25]) ×2
       → Short → Item → A-B → Avr → Move → PLine → Join

Usage:
    from door_geometry_engine import build_door_geometry, DoorParams
    params = DoorParams(width=500, height=900, offsets=[50,15,5,5,11,17,0,0,0,0])
    geom = build_door_geometry(params)
"""

import math
from dataclasses import dataclass, field
from typing import List, Tuple, Optional

Point2D = Tuple[float, float]
Line2D  = Tuple[Point2D, Point2D]
Poly    = List[Point2D]


# ── vector helpers ────────────────────────────────────────────────────────────

def _dist(a: Point2D, b: Point2D) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])

def _lerp(a: Point2D, b: Point2D, t: float) -> Point2D:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

def _midpoint(a: Point2D, b: Point2D) -> Point2D:
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)

def _move(p: Point2D, dx: float, dy: float) -> Point2D:
    return (p[0] + dx, p[1] + dy)


# ── Rect ──────────────────────────────────────────────────────────────────────

@dataclass
class Rect:
    x: float   # left edge
    y: float   # bottom edge
    w: float   # width
    h: float   # height

    # ── derived ─────────────────────────────────────────────────────────────

    @property
    def left(self)   -> float: return self.x
    @property
    def right(self)  -> float: return self.x + self.w
    @property
    def bottom(self) -> float: return self.y
    @property
    def top(self)    -> float: return self.y + self.h
    @property
    def cx(self)     -> float: return self.x + self.w / 2
    @property
    def cy(self)     -> float: return self.y + self.h / 2
    @property
    def valid(self)  -> bool:  return self.w > 0 and self.h > 0
    @property
    def perimeter(self) -> float: return 2 * (self.w + self.h)

    def corners(self) -> Poly:
        """BL → BR → TR → TL"""
        return [
            (self.x,       self.y),
            (self.x+self.w, self.y),
            (self.x+self.w, self.y+self.h),
            (self.x,        self.y+self.h),
        ]

    def offset(self, amount: float) -> "Rect":
        """Positive = expand outward; negative = shrink inward."""
        return Rect(
            self.x - amount,
            self.y - amount,
            self.w + 2 * amount,
            self.h + 2 * amount,
        )

    def as_lines(self) -> List[Line2D]:
        """4 boundary segments."""
        c = self.corners()
        return [(c[i], c[(i+1) % 4]) for i in range(4)]


# ── divide by length ──────────────────────────────────────────────────────────

def divide_rect_by_length(rect: Rect, seg_length: float) -> List[Point2D]:
    """
    Walk the rectangle perimeter (BL→BR→TR→TL→BL) and emit a point
    every `seg_length` mm. Mirrors Grasshopper's Divide Length component.
    """
    if seg_length <= 0:
        return []
    pts: List[Point2D] = []
    corners = rect.corners()
    sides   = [(corners[i], corners[(i+1) % 4]) for i in range(4)]
    carry   = 0.0          # distance into the current side already consumed
    for (p0, p1) in sides:
        side_len = _dist(p0, p1)
        d = carry
        while d < side_len:
            t = d / side_len
            pts.append(_lerp(p0, p1, t))
            d += seg_length
        carry = d - side_len
    return pts


def cull_index(items: list, indices: List[int]) -> list:
    """Remove items at the given indices (wrap-safe). Mirrors Grasshopper CullI."""
    n = len(items)
    if n == 0:
        return []
    bad = {i % n for i in indices}
    return [v for i, v in enumerate(items) if i not in bad]


# ── groove line generator ─────────────────────────────────────────────────────

def generate_groove_lines(
    rect: Rect,
    groove_inset:    float     = 15.0,
    div_length:      float     = 15.0,
    cull_indices:    List[int] = None,
    move_amount:     float     = 0.0,
) -> List[Line2D]:
    """
    Reverse-engineered from the Cluster wiring screenshot.

    Steps:
      1. Offset inward by groove_inset  (Neg → Offset step)
      2. Divide perimeter every div_length mm  (DivLength)
      3. Remove corner-proximity points  (CullI with [0,10,25])
      4. Split into two half-lists representing opposing sides
         (Dispatch → 2× Explode → 2× DivLength paths)
      5. Reverse one half so points face each other  (Shortest List)
      6. Optional midpoint shift  (Move)
      7. Pair and emit lines  (PLine → Join)

    Returns list of (p_start, p_end) tuples.
    """
    if cull_indices is None:
        cull_indices = [0, 1, 2]   # skip first 3 points near each corner

    inner = rect.offset(-groove_inset)
    if not inner.valid:
        return []

    pts = divide_rect_by_length(inner, div_length)
    if len(pts) < 4:
        return []

    pts = cull_index(pts, cull_indices)
    if not pts:
        return []

    n    = len(pts)
    half = n // 2

    group_a = pts[:half]
    group_b = list(reversed(pts[half : half * 2]))   # flip so they "face" each other

    count = min(len(group_a), len(group_b))
    lines: List[Line2D] = []
    for i in range(count):
        pa = group_a[i]
        pb = group_b[i]
        if move_amount:
            mid = _midpoint(pa, pb)
            pa  = _move(pa, 0, move_amount)
            pb  = _move(pb, 0, move_amount)
        lines.append((pa, pb))

    return lines


# ── offset ring dataclass ─────────────────────────────────────────────────────

RING_COLORS = [
    "#E74C3C",  # OF1
    "#E67E22",  # OF2
    "#F1C40F",  # OF3
    "#2ECC71",  # OF4
    "#1ABC9C",  # OF5
    "#3498DB",  # OF6
    "#9B59B6",  # OF7
    "#EC407A",  # OF8
    "#78909C",  # OF9
    "#8D6E63",  # OF10
]


@dataclass
class OffsetRing:
    index:          int        # 1-based
    step_mm:        float      # this step's contribution
    cumulative_mm:  float      # total distance from outer edge
    rect:           Rect       # boundary of this ring
    groove_lines:   List[Line2D] = field(default_factory=list)
    color:          str        = "#888888"


# ── DoorParams ────────────────────────────────────────────────────────────────

@dataclass
class DoorParams:
    """
    Mirrors the slider values found in the .ghx analysis.

    offsets:          [OF1..OF10] step values in mm (zero = inactive)
    width / height:   door dimensions in mm
    div_length:       Divide Length slider (default 15 mm)
    groove_inset:     how far inside each ring boundary the grooves sit
                      (mirrors the Neg→Offset inside the Cluster; 0 = at boundary)
    cull_corner_pts:  how many points to skip near each corner
    """
    width:           float
    height:          float
    offsets:         List[float]
    div_length:      float = 15.0
    groove_inset:    float = 0.0
    cull_corner_pts: int   = 3


# ── main builder ─────────────────────────────────────────────────────────────

@dataclass
class DoorGeometry:
    params:    DoorParams
    base_rect: Rect
    rings:     List[OffsetRing] = field(default_factory=list)

    @property
    def total_offset(self) -> float:
        return self.rings[-1].cumulative_mm if self.rings else 0.0

    @property
    def inner_rect(self) -> Rect:
        return self.rings[-1].rect if self.rings else self.base_rect

    @property
    def all_groove_lines(self) -> List[Line2D]:
        lines: List[Line2D] = []
        for r in self.rings:
            lines.extend(r.groove_lines)
        return lines


def build_door_geometry(params: DoorParams) -> DoorGeometry:
    """
    Build a complete door geometry from DoorParams.

    Implements:
      1. Outer rectangle (W × H)
      2. Cumulative inward offset rings (OF1 + OF2 + ... = next ring edge)
      3. Groove lines on each ring boundary
    """
    base = Rect(0.0, 0.0, params.width, params.height)
    geom = DoorGeometry(params=params, base_rect=base)

    cull_idx = list(range(params.cull_corner_pts))   # e.g. [0,1,2]

    cumulative = 0.0
    for idx, step in enumerate(params.offsets):
        if step <= 0:
            continue

        cumulative += step
        ring_rect = base.offset(-cumulative)
        if not ring_rect.valid:
            break

        grooves = generate_groove_lines(
            rect         = ring_rect,
            groove_inset = params.groove_inset,
            div_length   = params.div_length,
            cull_indices = cull_idx,
        )

        ring = OffsetRing(
            index         = idx + 1,
            step_mm       = step,
            cumulative_mm = cumulative,
            rect          = ring_rect,
            groove_lines  = grooves,
            color         = RING_COLORS[idx % len(RING_COLORS)],
        )
        geom.rings.append(ring)

    return geom


# ── preview (matplotlib) ──────────────────────────────────────────────────────

def preview(geom: DoorGeometry, save_path: Optional[str] = None, show: bool = False):
    """Render the door geometry with matplotlib. Saves PNG if save_path given."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.patches as patches
    except ImportError:
        print("[preview] matplotlib not installed — skipping")
        return

    fig, ax = plt.subplots(figsize=(8, 12))
    ax.set_aspect("equal")
    ax.set_facecolor("#1a1a2e")
    fig.patch.set_facecolor("#1a1a2e")

    # outer door
    r = geom.base_rect
    rect_patch = patches.Rectangle(
        (r.x, r.y), r.w, r.h,
        linewidth=2, edgecolor="#ffffff", facecolor="#2d2d44"
    )
    ax.add_patch(rect_patch)

    # offset rings
    for ring in geom.rings:
        rr = ring.rect
        rp = patches.Rectangle(
            (rr.x, rr.y), rr.w, rr.h,
            linewidth=1.5, edgecolor=ring.color, facecolor="none"
        )
        ax.add_patch(rp)
        # label
        ax.text(rr.x + 2, rr.y + 2,
                f"OF{ring.index}  Σ{ring.cumulative_mm:.0f}mm",
                color=ring.color, fontsize=6, va="bottom")

    # groove lines
    for ring in geom.rings:
        for (p0, p1) in ring.groove_lines:
            ax.plot([p0[0], p1[0]], [p0[1], p1[1]],
                    color=ring.color, linewidth=0.5, alpha=0.6)

    # info box
    p = geom.params
    info = (f"W={p.width:.0f}  H={p.height:.0f}\n"
            f"Rings: {len(geom.rings)}   Total offset: {geom.total_offset:.0f}mm\n"
            f"DivLength={p.div_length}   GrooveInset={p.groove_inset}")
    ax.text(0.02, 0.98, info, transform=ax.transAxes,
            color="white", fontsize=8, va="top",
            bbox=dict(boxstyle="round", fc="#333", ec="none", alpha=0.7))

    ax.set_xlim(-20, geom.params.width  + 20)
    ax.set_ylim(-20, geom.params.height + 20)
    ax.axis("off")
    ax.set_title("FIROO CAM — Door Geometry Preview", color="white", fontsize=10)

    if save_path:
        fig.savefig(save_path, dpi=150, bbox_inches="tight",
                    facecolor=fig.get_facecolor())
        print(f"[preview] saved → {save_path}")
    if show:
        plt.show()
    plt.close(fig)


# ── CLI entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse, json, sys

    ap = argparse.ArgumentParser(description="FIROO CAM Door Geometry Engine")
    ap.add_argument("--width",    type=float, default=500,  help="Door width  (mm)")
    ap.add_argument("--height",   type=float, default=900,  help="Door height (mm)")
    ap.add_argument("--offsets",  type=str,
                    default="50,15,5,5,11,17,0,0,0,0",
                    help="Comma-separated OF1..OF10 step values")
    ap.add_argument("--div",      type=float, default=15.0, help="DivLength (mm)")
    ap.add_argument("--inset",    type=float, default=0.0,  help="Groove inset (mm)")
    ap.add_argument("--preview",  type=str,   default="",   help="Save preview PNG to path")
    ap.add_argument("--json",     type=str,   default="",   help="Save JSON output to path")
    args = ap.parse_args()

    offsets = [float(x) for x in args.offsets.split(",")]
    params  = DoorParams(
        width           = args.width,
        height          = args.height,
        offsets         = offsets,
        div_length      = args.div,
        groove_inset    = args.inset,
    )
    geom = build_door_geometry(params)

    print(f"Door: {params.width:.0f} × {params.height:.0f} mm")
    print(f"Active rings: {len(geom.rings)}")
    for ring in geom.rings:
        print(f"  OF{ring.index}: step={ring.step_mm:.1f}  Σ={ring.cumulative_mm:.1f}mm"
              f"  rect=({ring.rect.w:.0f}×{ring.rect.h:.0f})"
              f"  grooves={len(ring.groove_lines)}")

    total_grooves = sum(len(r.groove_lines) for r in geom.rings)
    print(f"Total groove lines: {total_grooves}")

    if args.json:
        out = {
            "params": {
                "width": params.width, "height": params.height,
                "offsets": params.offsets, "div_length": params.div_length,
                "groove_inset": params.groove_inset,
            },
            "rings": [
                {
                    "index": r.index,
                    "step_mm": r.step_mm,
                    "cumulative_mm": r.cumulative_mm,
                    "rect": {"x": r.rect.x, "y": r.rect.y,
                             "w": r.rect.w, "h": r.rect.h},
                    "groove_count": len(r.groove_lines),
                    "groove_lines": [
                        {"x0": p0[0], "y0": p0[1], "x1": p1[0], "y1": p1[1]}
                        for (p0, p1) in r.groove_lines
                    ],
                }
                for r in geom.rings
            ],
        }
        path = args.json
        with open(path, "w") as f:
            json.dump(out, f, indent=2)
        print(f"JSON saved → {path}")

    if args.preview:
        preview(geom, save_path=args.preview)

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


# ── groove line generators ────────────────────────────────────────────────────

def _edge_points(p0: Point2D, p1: Point2D, div_length: float,
                 skip_first: int = 1, skip_last: int = 1) -> List[Point2D]:
    """Divide one edge segment and skip corner-proximity points."""
    n_segs = max(1, int(_dist(p0, p1) / div_length))
    pts = [_lerp(p0, p1, i / n_segs) for i in range(n_segs + 1)]
    lo = skip_first
    hi = len(pts) - skip_last
    return pts[lo:hi] if hi > lo else []


def generate_groove_lines(
    rect:          Rect,
    groove_inset:  float     = 0.0,
    div_length:    float     = 15.0,
    cull_indices:  List[int] = None,
    pattern:       str       = "cross_connect",
    move_amount:   float     = 0.0,
) -> List[Line2D]:
    """
    Groove line generator — supports three pattern modes.

    pattern = "cross_connect"  (default)
        Reverse-engineered from Cluster wiring:
        Divide perimeter, split into two halves, CROSS-connect with
        Avr(0.5) midpoint shift.  Creates diagonal X-crossing lines
        on each ring face.  Mirrors the GH: CullI → Short → Avr → Move → PLine.

    pattern = "parallel_grid"
        Vertical lines connecting top ↔ bottom, horizontal lines
        connecting left ↔ right.  Classic grid groove pattern.

    pattern = "fan_mirror"
        Two fans of lines from top-left to bottom-right, mirrored on
        the vertical center axis.  Matches the 'Mirror' component at the
        end of the Cluster and the two parallel DivLength paths.

    Args:
        rect:         ring boundary rectangle
        groove_inset: extra inward offset before drawing (Neg→Offset in Cluster)
        div_length:   DivLength slider value (mm per segment, default 15)
        cull_indices: explicit list of indices to remove; default = [0, 1, last]
        pattern:      one of "cross_connect" | "parallel_grid" | "fan_mirror"
        move_amount:  perpendicular shift applied to endpoints (Move component)
    """
    if cull_indices is None:
        cull_indices = [0, 1]   # matches {0}: 0 0 / first row from screenshot

    inner = rect.offset(-groove_inset)
    if not inner.valid:
        return []

    lines: List[Line2D] = []

    # ── pattern: parallel_grid ────────────────────────────────────────────────
    if pattern == "parallel_grid":
        # Vertical lines: top ↔ bottom
        top_pts = _edge_points((inner.left, inner.top),    (inner.right, inner.top),    div_length)
        bot_pts = _edge_points((inner.left, inner.bottom), (inner.right, inner.bottom), div_length)
        for tp, bp in zip(top_pts, bot_pts):
            lines.append((tp, bp))
        # Horizontal lines: left ↔ right
        lft_pts = _edge_points((inner.left,  inner.bottom), (inner.left,  inner.top), div_length)
        rgt_pts = _edge_points((inner.right, inner.bottom), (inner.right, inner.top), div_length)
        for lp, rp in zip(lft_pts, rgt_pts):
            lines.append((lp, rp))
        return lines

    # ── pattern: fan_mirror ───────────────────────────────────────────────────
    if pattern == "fan_mirror":
        cx = inner.cx
        # Left half: divide top-left and bottom-left edges
        n_top = max(2, int(inner.w / 2 / div_length))
        n_lft = max(2, int(inner.h / div_length))
        top_half  = [_lerp((inner.left, inner.top),    (cx, inner.top),    i/n_top) for i in range(1, n_top)]
        bot_half  = [_lerp((inner.left, inner.bottom), (cx, inner.bottom), i/n_top) for i in range(1, n_top)]
        lft_half  = [_lerp((inner.left, inner.bottom), (inner.left, inner.top), i/n_lft) for i in range(1, n_lft)]
        # Fan: each top point → each left point
        for i, tp in enumerate(top_half):
            lp = lft_half[i % len(lft_half)] if lft_half else (inner.left, inner.cy)
            lines.append((tp, lp))
        for i, bp in enumerate(bot_half):
            lp = lft_half[i % len(lft_half)] if lft_half else (inner.left, inner.cy)
            lines.append((bp, lp))
        # Mirror on vertical axis
        mirrored = [
            ((_move(p0, 2*(cx - p0[0]), 0)), (_move(p1, 2*(cx - p1[0]), 0)))
            for (p0, p1) in lines
        ]
        lines += mirrored
        return lines

    # ── pattern: cross_connect (default) ────────────────────────────────────
    # Matches: Neg→Offset, DivLength×2, CullI([0,1]+[0,-1]), Short, Avr(0.5),
    #          A-B, Move, PLine, Mirror
    # Path A: top+bottom edges (horizontal runs)
    # Path B: left+right edges  (vertical runs)
    # Points from each path are paired CROSSED: top[i] ↔ bot[reversed(i)]
    # → Avr(0.5) gives midpoint, A-B gives direction, Move shifts slightly

    skip = len(cull_indices)   # how many corner points to skip

    # Horizontal crossing: top ↔ bottom (reversed)
    top_pts = _edge_points((inner.left, inner.top),    (inner.right, inner.top),    div_length, skip, skip)
    bot_pts = _edge_points((inner.left, inner.bottom), (inner.right, inner.bottom), div_length, skip, skip)
    top_pts = cull_index(top_pts, cull_indices)
    bot_pts = cull_index(bot_pts, cull_indices)
    bot_rev = list(reversed(bot_pts))
    for i in range(min(len(top_pts), len(bot_rev))):
        pa = top_pts[i]
        pb = bot_rev[i]
        if move_amount:
            mid = _midpoint(pa, pb)
            pa  = _move(pa, 0,  move_amount)
            pb  = _move(pb, 0, -move_amount)
        lines.append((pa, pb))

    # Vertical crossing: left ↔ right (reversed)
    lft_pts = _edge_points((inner.left,  inner.bottom), (inner.left,  inner.top), div_length, skip, skip)
    rgt_pts = _edge_points((inner.right, inner.bottom), (inner.right, inner.top), div_length, skip, skip)
    lft_pts = cull_index(lft_pts, cull_indices)
    rgt_pts = cull_index(rgt_pts, cull_indices)
    rgt_rev = list(reversed(rgt_pts))
    for i in range(min(len(lft_pts), len(rgt_rev))):
        pa = lft_pts[i]
        pb = rgt_rev[i]
        if move_amount:
            pa = _move(pa,  move_amount, 0)
            pb = _move(pb, -move_amount, 0)
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
    cull_corner_pts: int   = 2
    pattern:         str   = "cross_connect"   # cross_connect | parallel_grid | fan_mirror


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
            pattern      = params.pattern,
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

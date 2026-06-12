"""
FIROO CAM — Door Geometry Engine (Stage 2)

KEY PRINCIPLE (confirmed by user):
  Pattern lines are drawn BETWEEN two consecutive offset boundaries —
  from the outer edge of a section to its inner edge.

  Example for a 500×900 door with offsets [50, 15, 5, 5, 11, 17]:
    Section 0: outer(500×900)  → OF1 ring(400×800)   width=50mm
    Section 1: OF1(400×800)    → OF2 ring(370×770)   width=15mm
    Section 2: OF2(370×770)    → OF3 ring(360×760)   width=5mm
    ...

  Within each section, lines connect points on the OUTER boundary
  to corresponding points on the INNER boundary (DivLength×2 paths),
  with a crossing pattern (reversed pairing) and optional Mirror.

GH Cluster wiring decoded:
  Crv(outer) + Crv(inner)
    → DivLength(15) ×2
    → CullI([0,1] and [0,-1])  — skip corner-proximity points
    → Short (match counts)
    → CROSS-connect: outer[i] ↔ inner[reversed(i)]
    → Avr(0.5) midpoint, A-B vector, Move, PLine, Fillet, Mirror, Join

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

def _mirror_x(p: Point2D, cx: float) -> Point2D:
    return (2 * cx - p[0], p[1])


# ── Rect ──────────────────────────────────────────────────────────────────────

@dataclass
class Rect:
    x: float   # left
    y: float   # bottom
    w: float   # width
    h: float   # height

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
            (self.x,        self.y),
            (self.x+self.w, self.y),
            (self.x+self.w, self.y+self.h),
            (self.x,        self.y+self.h),
        ]

    def offset(self, amount: float) -> "Rect":
        """Positive = expand; negative = shrink inward."""
        return Rect(self.x - amount, self.y - amount,
                    self.w + 2*amount, self.h + 2*amount)

    def as_lines(self) -> List[Line2D]:
        c = self.corners()
        return [(c[i], c[(i+1) % 4]) for i in range(4)]


# ── edge sampling ─────────────────────────────────────────────────────────────

def sample_edge(p0: Point2D, p1: Point2D,
                div_length: float,
                skip_first: int = 1,
                skip_last:  int = 1) -> List[Point2D]:
    """
    Divide one edge into segments of `div_length` mm and return the
    division points, skipping `skip_first` points near p0 and
    `skip_last` points near p1.
    Mirrors Grasshopper's DivLength + CullI pattern.
    """
    total = _dist(p0, p1)
    if total <= 0 or div_length <= 0:
        return []
    n = max(1, int(total / div_length))
    pts = [_lerp(p0, p1, i / n) for i in range(n + 1)]
    lo  = skip_first
    hi  = len(pts) - skip_last
    return pts[lo:hi] if hi > lo else []


def sample_rect_edges(rect: Rect,
                      div_length: float,
                      skip: int = 1) -> dict:
    """
    Sample all 4 edges of a rectangle.
    Returns dict with keys 'top', 'bottom', 'left', 'right'.
    """
    return {
        "bottom": sample_edge((rect.left, rect.bottom), (rect.right, rect.bottom), div_length, skip, skip),
        "right":  sample_edge((rect.right, rect.bottom),(rect.right, rect.top),    div_length, skip, skip),
        "top":    sample_edge((rect.right, rect.top),   (rect.left, rect.top),     div_length, skip, skip),
        "left":   sample_edge((rect.left, rect.top),    (rect.left, rect.bottom),  div_length, skip, skip),
    }


# ── section pattern generator ─────────────────────────────────────────────────

def generate_section_lines(
    outer: Rect,
    inner: Rect,
    div_length: float = 15.0,
    skip:       int   = 1,
    crossing:   bool  = True,
) -> List[Line2D]:
    """
    Generate pattern lines for ONE section (between outer and inner rect).

    This is the core of the Cluster's algorithm:
      - Divide corresponding edges of outer and inner rects by div_length
      - CullI: skip corner-proximity points (skip=1 means remove first & last)
      - Pair outer[i] with inner[i] (straight) or inner[reversed(i)] (crossing)
      - Use Shortest List to match unequal counts
      - Mirror on vertical center axis (as GH Mirror component does)

    crossing=True  → diagonal X-lines (outer top-left → inner bottom-right)
    crossing=False → straight lines perpendicular to each section face
    """
    lines: List[Line2D] = []

    # The 4 face-pairs of the section ring:
    #   Top face:    outer.top    ↔ inner.top    (both horizontal edges)
    #   Bottom face: outer.bottom ↔ inner.bottom
    #   Left face:   outer.left   ↔ inner.left
    #   Right face:  outer.right  ↔ inner.right

    def connect_face(o_edge: List[Point2D], i_edge: List[Point2D]) -> List[Line2D]:
        if not o_edge or not i_edge:
            return []
        # Shortest List
        count = min(len(o_edge), len(i_edge))
        o_pts = o_edge[:count]
        i_pts = i_edge[:count]
        if crossing:
            i_pts = list(reversed(i_pts))
        return list(zip(o_pts, i_pts))

    # Top face: outer top edge → inner top edge (both run left→right)
    o_top = sample_edge((outer.left, outer.top),  (outer.right, outer.top),  div_length, skip, skip)
    i_top = sample_edge((inner.left, inner.top),  (inner.right, inner.top),  div_length, skip, skip)
    lines += connect_face(o_top, i_top)

    # Bottom face: outer bottom → inner bottom
    o_bot = sample_edge((outer.left, outer.bottom),(outer.right, outer.bottom),div_length, skip, skip)
    i_bot = sample_edge((inner.left, inner.bottom),(inner.right, inner.bottom),div_length, skip, skip)
    lines += connect_face(o_bot, i_bot)

    # Left face: outer left → inner left (both run bottom→top)
    o_lft = sample_edge((outer.left, outer.bottom),(outer.left, outer.top),   div_length, skip, skip)
    i_lft = sample_edge((inner.left, inner.bottom),(inner.left, inner.top),   div_length, skip, skip)
    lines += connect_face(o_lft, i_lft)

    # Right face: outer right → inner right
    o_rgt = sample_edge((outer.right,outer.bottom),(outer.right,outer.top),   div_length, skip, skip)
    i_rgt = sample_edge((inner.right,inner.bottom),(inner.right,inner.top),   div_length, skip, skip)
    lines += connect_face(o_rgt, i_rgt)

    return lines


# ── data classes ──────────────────────────────────────────────────────────────

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
    index:          int
    step_mm:        float
    cumulative_mm:  float
    rect:           Rect
    color:          str = "#888888"


@dataclass
class Section:
    """One 'frame section' between two consecutive offset rings."""
    index:        int           # 0 = outer-door → OF1, 1 = OF1→OF2, ...
    outer_rect:   Rect
    inner_rect:   Rect
    outer_offset: float         # cumulative mm of outer boundary
    inner_offset: float         # cumulative mm of inner boundary
    width_mm:     float         # = inner_offset - outer_offset
    pattern_lines: List[Line2D] = field(default_factory=list)
    color:         str          = "#888888"


@dataclass
class DoorParams:
    """
    Slider values from the .ghx analysis.

    offsets:      [OF1..OF10] step values in mm  (zero = inactive)
    width/height: door outer dimensions in mm
    div_length:   DivLength slider value (default 15 mm)
    skip:         corner-proximity points to skip from each edge (CullI depth)
    crossing:     True = cross-connect for diagonal X-pattern (GH default)
    """
    width:      float
    height:     float
    offsets:    List[float]
    div_length: float = 15.0
    skip:       int   = 1
    crossing:   bool  = True


@dataclass
class DoorGeometry:
    params:    DoorParams
    base_rect: Rect
    rings:     List[OffsetRing] = field(default_factory=list)
    sections:  List[Section]    = field(default_factory=list)

    @property
    def total_offset(self) -> float:
        return self.rings[-1].cumulative_mm if self.rings else 0.0

    @property
    def inner_rect(self) -> Rect:
        return self.rings[-1].rect if self.rings else self.base_rect

    @property
    def all_pattern_lines(self) -> List[Line2D]:
        lines: List[Line2D] = []
        for s in self.sections:
            lines.extend(s.pattern_lines)
        return lines


# ── main builder ─────────────────────────────────────────────────────────────

def build_door_geometry(params: DoorParams) -> DoorGeometry:
    """
    Build the full door geometry.

    1. Create offset rings from cumulative OF values
    2. For each consecutive pair of boundaries, generate a Section
    3. In each Section, generate pattern lines between the two boundaries
    """
    base = Rect(0.0, 0.0, params.width, params.height)
    geom = DoorGeometry(params=params, base_rect=base)

    # ── build rings ────────────────────────────────────────────────────────
    cumulative = 0.0
    for idx, step in enumerate(params.offsets):
        if step <= 0:
            continue
        cumulative += step
        ring_rect = base.offset(-cumulative)
        if not ring_rect.valid:
            break
        geom.rings.append(OffsetRing(
            index         = idx + 1,
            step_mm       = step,
            cumulative_mm = cumulative,
            rect          = ring_rect,
            color         = RING_COLORS[idx % len(RING_COLORS)],
        ))

    # ── build sections (between consecutive boundaries) ────────────────────
    # Boundaries: outer door + each ring
    boundaries: List[Tuple[float, Rect]] = [(0.0, base)]
    for ring in geom.rings:
        boundaries.append((ring.cumulative_mm, ring.rect))

    for i in range(len(boundaries) - 1):
        o_off, o_rect = boundaries[i]
        i_off, i_rect = boundaries[i + 1]
        width = i_off - o_off

        lines = generate_section_lines(
            outer      = o_rect,
            inner      = i_rect,
            div_length = params.div_length,
            skip       = params.skip,
            crossing   = params.crossing,
        )

        sec = Section(
            index         = i,
            outer_rect    = o_rect,
            inner_rect    = i_rect,
            outer_offset  = o_off,
            inner_offset  = i_off,
            width_mm      = width,
            pattern_lines = lines,
            color         = RING_COLORS[i % len(RING_COLORS)],
        )
        geom.sections.append(sec)

    return geom


# ── preview ───────────────────────────────────────────────────────────────────

def preview(geom: DoorGeometry, save_path: Optional[str] = None,
            show: bool = False, title: str = ""):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.patches as patches
    except ImportError:
        print("[preview] matplotlib not installed")
        return

    fig, ax = plt.subplots(figsize=(6, 10))
    ax.set_aspect("equal")
    ax.set_facecolor("#1a1a2e")
    fig.patch.set_facecolor("#1a1a2e")

    # outer door fill
    r = geom.base_rect
    ax.add_patch(patches.Rectangle((r.x, r.y), r.w, r.h,
                                   lw=2, ec="#ffffff", fc="#2a2a3e"))

    # section fills + boundaries
    for sec in geom.sections:
        rr = sec.inner_rect
        ax.add_patch(patches.Rectangle((rr.x, rr.y), rr.w, rr.h,
                                       lw=1, ec=sec.color, fc="#1a1a2e",
                                       linestyle="--"))
        # label
        ax.text(rr.x+2, rr.top-6,
                f"OF{sec.index+1}  Σ{sec.inner_offset:.0f}mm",
                color=sec.color, fontsize=5.5, va="top")

    # pattern lines per section
    for sec in geom.sections:
        for (p0, p1) in sec.pattern_lines:
            ax.plot([p0[0], p1[0]], [p0[1], p1[1]],
                    color=sec.color, lw=0.6, alpha=0.75)

    # stats
    p = geom.params
    total = sum(len(s.pattern_lines) for s in geom.sections)
    info = (f"W={p.width:.0f}  H={p.height:.0f}\n"
            f"Sections: {len(geom.sections)}   Σoffset={geom.total_offset:.0f}mm\n"
            f"DivLen={p.div_length}  skip={p.skip}  "
            f"crossing={'✓' if p.crossing else '✗'}\n"
            f"Total lines: {total}")
    ax.text(0.02, 0.98, info, transform=ax.transAxes,
            color="white", fontsize=7.5, va="top", family="monospace",
            bbox=dict(boxstyle="round", fc="#222", ec="none", alpha=0.8))

    ax.set_xlim(-15, p.width+15)
    ax.set_ylim(-15, p.height+15)
    ax.axis("off")
    t = title or ("Crossing pattern" if p.crossing else "Straight pattern")
    ax.set_title(f"FIROO CAM — {t}", color="white", fontsize=9)

    if save_path:
        fig.savefig(save_path, dpi=150, bbox_inches="tight",
                    facecolor=fig.get_facecolor())
        print(f"[preview] → {save_path}")
    if show:
        plt.show()
    plt.close(fig)


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse, json

    ap = argparse.ArgumentParser()
    ap.add_argument("--width",    type=float, default=500)
    ap.add_argument("--height",   type=float, default=900)
    ap.add_argument("--offsets",  type=str,   default="50,15,5,5,11,17,0,0,0,0")
    ap.add_argument("--div",      type=float, default=15.0)
    ap.add_argument("--skip",     type=int,   default=1)
    ap.add_argument("--no-cross", action="store_true")
    ap.add_argument("--preview",  type=str,   default="")
    ap.add_argument("--json",     type=str,   default="")
    args = ap.parse_args()

    offsets = [float(x) for x in args.offsets.split(",")]
    params  = DoorParams(
        width=args.width, height=args.height, offsets=offsets,
        div_length=args.div, skip=args.skip, crossing=not args.no_cross,
    )
    geom = build_door_geometry(params)

    print(f"Door: {params.width:.0f} × {params.height:.0f} mm")
    print(f"Rings:    {len(geom.rings)}")
    print(f"Sections: {len(geom.sections)}")
    for sec in geom.sections:
        print(f"  Section {sec.index}: Σ{sec.outer_offset:.0f}→{sec.inner_offset:.0f}mm"
              f"  (width={sec.width_mm:.0f}mm)"
              f"  {len(sec.pattern_lines)} lines")

    if args.json:
        out = {
            "params": vars(params),
            "sections": [
                {
                    "index": s.index,
                    "outer_offset": s.outer_offset,
                    "inner_offset": s.inner_offset,
                    "width_mm": s.width_mm,
                    "outer_rect": {"x": s.outer_rect.x, "y": s.outer_rect.y,
                                   "w": s.outer_rect.w, "h": s.outer_rect.h},
                    "inner_rect": {"x": s.inner_rect.x, "y": s.inner_rect.y,
                                   "w": s.inner_rect.w, "h": s.inner_rect.h},
                    "line_count": len(s.pattern_lines),
                    "lines": [{"x0": p0[0], "y0": p0[1], "x1": p1[0], "y1": p1[1]}
                              for (p0, p1) in s.pattern_lines],
                }
                for s in geom.sections
            ],
        }
        with open(args.json, "w") as f:
            json.dump(out, f, indent=2)
        print(f"JSON → {args.json}")

    if args.preview:
        preview(geom, save_path=args.preview)

"""
FIROO CAM — Pattern Clip Engine  (V3)
======================================
DXF pattern  →  Scale / Rotate / Center  →  Clip to offset rect  →  DXF output

Key operations
  • Liang-Barsky segment clipping against any rect
  • Boundary Shortest Path closing for trimmed closed curves
  • Parse: LINE, LWPOLYLINE, POLYLINE+VERTEX
  • Write: LWPOLYLINE (one entity per clipped chain)
"""

from __future__ import annotations
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Tuple, Optional

Point    = Tuple[float, float]
Segments = List[Tuple[Point, Point]]


# ──────────────────────────────────────────── geometry helpers ─────────────────

def _lerp(a: Point, b: Point, t: float) -> Point:
    return (a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t)

def _close(a: Point, b: Point, tol: float = 1e-6) -> bool:
    return abs(a[0]-b[0]) < tol and abs(a[1]-b[1]) < tol

def _rotate(p: Point, cx: float, cy: float, angle_deg: float) -> Point:
    a = math.radians(angle_deg)
    dx, dy = p[0]-cx, p[1]-cy
    return (cx + dx*math.cos(a) - dy*math.sin(a),
            cy + dx*math.sin(a) + dy*math.cos(a))


# ──────────────────────────────────────────── ClipRect ────────────────────────

@dataclass
class ClipRect:
    xmin: float
    ymin: float
    xmax: float
    ymax: float

    @property
    def W(self)         -> float: return self.xmax - self.xmin
    @property
    def H(self)         -> float: return self.ymax - self.ymin
    @property
    def perimeter(self) -> float: return 2*(self.W + self.H)
    @property
    def cx(self)        -> float: return (self.xmin + self.xmax) / 2
    @property
    def cy(self)        -> float: return (self.ymin + self.ymax) / 2

    def contains(self, p: Point) -> bool:
        return self.xmin <= p[0] <= self.xmax and self.ymin <= p[1] <= self.ymax

    # ── boundary parameterization (clockwise from bottom-left) ────────────────
    def to_param(self, p: Point) -> float:
        x, y = p
        W, H = self.W, self.H
        candidates = [
            (abs(y - self.ymin), x - self.xmin),           # bottom
            (abs(x - self.xmax), W + (y - self.ymin)),     # right
            (abs(y - self.ymax), W + H + (self.xmax - x)), # top
            (abs(x - self.xmin), 2*W + H + (self.ymax - y)),# left
        ]
        return min(candidates, key=lambda c: c[0])[1]

    def from_param(self, t: float) -> Point:
        W, H = self.W, self.H
        t = t % self.perimeter
        if t <= W:     return (self.xmin + t, self.ymin)
        t -= W
        if t <= H:     return (self.xmax, self.ymin + t)
        t -= H
        if t <= W:     return (self.xmax - t, self.ymax)
        t -= W
        return (self.xmin, self.ymax - t)

    def boundary_path(self, p1: Point, p2: Point) -> List[Point]:
        """Shorter path along boundary from p1 to p2, turning at corners."""
        W, H = self.W, self.H
        P = self.perimeter
        t1 = self.to_param(p1)
        t2 = self.to_param(p2)

        cw   = (t2 - t1) % P
        ccw  = P - cw

        corner_params = [0.0, W, W+H, 2*W+H]

        if cw <= ccw:
            path = [p1]
            for c in corner_params:
                d = (c - t1) % P
                if 1e-6 < d < cw - 1e-6:
                    path.append(self.from_param(c))
            path.append(p2)
        else:
            path = [p1]
            for c in reversed(corner_params):
                d = (t1 - c) % P
                if 1e-6 < d < ccw - 1e-6:
                    path.append(self.from_param(c))
            path.append(p2)

        return path


# ──────────────────────────────────────────── Liang-Barsky ────────────────────

def _clip_segment(p1: Point, p2: Point,
                  r: ClipRect) -> Optional[Tuple[Point, Point]]:
    x1, y1 = p1
    dx, dy = p2[0]-x1, p2[1]-y1
    p = [-dx,  dx, -dy,  dy]
    q = [x1-r.xmin, r.xmax-x1, y1-r.ymin, r.ymax-y1]
    t0, t1 = 0.0, 1.0
    for pi, qi in zip(p, q):
        if abs(pi) < 1e-12:
            if qi < 0: return None
        elif pi < 0:
            t0 = max(t0, qi/pi)
        else:
            t1 = min(t1, qi/pi)
        if t0 > t1: return None
    return _lerp(p1, p2, t0), _lerp(p1, p2, t1)


# ──────────────────────────────────────────── Entity + clipping ───────────────

@dataclass
class Entity:
    points: List[Point]
    closed: bool  = False
    layer:  str   = "0"

    def transform(self, sx: float, sy: float,
                  angle: float,
                  tx: float, ty: float) -> "Entity":
        """Scale → rotate around origin → translate."""
        pts = [(p[0]*sx, p[1]*sy) for p in self.points]
        if angle:
            pts = [_rotate(p, 0, 0, angle) for p in pts]
        pts = [(p[0]+tx, p[1]+ty) for p in pts]
        return Entity(pts, self.closed, self.layer)

    def clip(self, rect: ClipRect,
             close_trimmed: bool = False) -> List["Entity"]:
        """
        Clip this entity to rect.
        If close_trimmed and the original is closed, reconnect cut ends
        along the boundary shortest path.
        """
        pts = self.points
        if len(pts) < 2:
            return []

        segs = list(zip(pts, pts[1:]))
        if self.closed:
            segs.append((pts[-1], pts[0]))

        # ── clip each segment ────────────────────────────────────────────────
        chains: List[List[Point]] = []
        cur:    List[Point]       = []

        for p1, p2 in segs:
            clipped = _clip_segment(p1, p2, rect)
            if clipped is None:
                if cur:
                    chains.append(cur)
                    cur = []
            else:
                ca, cb = clipped
                if not cur:
                    cur = [ca, cb]
                elif _close(cur[-1], ca):
                    cur.append(cb)
                else:
                    chains.append(cur)
                    cur = [ca, cb]

        if cur:
            chains.append(cur)

        if not chains:
            return []

        # ── optional: close trimmed closed curves along boundary ─────────────
        if close_trimmed and self.closed and len(chains) == 1:
            chain = chains[0]
            start, end = chain[0], chain[-1]
            if not _close(start, end):
                bridge = rect.boundary_path(end, start)
                chain = chain + bridge[1:]   # bridge already starts at 'end'
                chains = [chain]

        return [Entity(c, False, self.layer) for c in chains]


# ──────────────────────────────────────────── DXF parser ──────────────────────

_LIST_CODES = {10, 20, 11, 21, 12, 22}   # coordinate codes that repeat in LWPOLYLINE

def _iter_entities(text: str):
    """Yield (entity_type, props) for each entity block.

    For codes in _LIST_CODES, props[code] is a list (supports repeated coords
    in LWPOLYLINE).  All other codes store the last value as a plain string.
    """
    lines = text.splitlines()
    i = 0
    def _next():
        nonlocal i
        while i < len(lines) - 1:
            raw_code = lines[i].strip()
            raw_val  = lines[i+1].strip()
            i += 2
            try:
                return int(raw_code), raw_val
            except ValueError:
                continue
        return None, None

    while i < len(lines):
        code, val = _next()
        if code != 0:
            continue
        etype = val
        if etype == "EOF":
            break
        if etype in ("ENDSEC", "ENDBLK", "ENDTAB", "SECTION",
                     "TABLE", "BLOCK", "APPID", "LAYER"):
            continue

        props: dict = {}
        vertex_stack: list = []
        is_poly = etype == "POLYLINE"

        while True:
            code, val = _next()
            if code is None or (code == 0 and val not in ("VERTEX", "SEQEND")):
                if code == 0:
                    i -= 2
                break
            if code == 0 and val == "SEQEND":
                break
            if code == 0 and val == "VERTEX":
                vx, vy = 0.0, 0.0
                while True:
                    vc, vv = _next()
                    if vc is None or vc == 0:
                        if vc == 0:
                            i -= 2
                        break
                    if vc == 10: vx = float(vv)
                    if vc == 20: vy = float(vv)
                vertex_stack.append((vx, vy))
                continue
            if isinstance(code, int):
                if code in _LIST_CODES:
                    props.setdefault(code, []).append(val)
                else:
                    props[code] = val

        if is_poly:
            props["_vertices"] = vertex_stack

        yield etype, props


def parse_dxf(path: str) -> List[Entity]:
    text = Path(path).read_text(encoding="utf-8", errors="ignore")
    entities: List[Entity] = []

    for etype, props in _iter_entities(text):
        layer = props.get(8, "0")

        if etype == "LINE":
            try:
                x10 = props[10]; y20 = props[20]
                x11 = props[11]; y21 = props[21]
                p1 = (float(x10[0] if isinstance(x10, list) else x10),
                      float(y20[0] if isinstance(y20, list) else y20))
                p2 = (float(x11[0] if isinstance(x11, list) else x11),
                      float(y21[0] if isinstance(y21, list) else y21))
                entities.append(Entity([p1, p2], False, layer))
            except (KeyError, ValueError, IndexError):
                pass

        elif etype == "ARC":
            try:
                x10 = props[10]; y20 = props[20]
                cx  = float(x10[0] if isinstance(x10, list) else x10)
                cy  = float(y20[0] if isinstance(y20, list) else y20)
                r    = float(props[40])
                a0   = float(props[50])   # start angle degrees
                a1   = float(props[51])   # end angle degrees
                if a1 <= a0:
                    a1 += 360.0
                span = a1 - a0
                n    = max(4, int(span / 5))   # one point per 5°
                pts  = [
                    (cx + r * math.cos(math.radians(a0 + span * t / n)),
                     cy + r * math.sin(math.radians(a0 + span * t / n)))
                    for t in range(n + 1)
                ]
                entities.append(Entity(pts, False, layer))
            except (KeyError, ValueError):
                pass

        elif etype == "LWPOLYLINE":
            try:
                xs = [float(v) for v in props.get(10, [])]
                ys = [float(v) for v in props.get(20, [])]
                pts = list(zip(xs, ys))
                if pts:
                    closed = int(props.get(70, 0)) & 1
                    entities.append(Entity(pts, bool(closed), layer))
            except (ValueError, TypeError):
                pass

        elif etype == "POLYLINE":
            verts = props.get("_vertices", [])
            if len(verts) >= 2:
                closed = int(props.get(70, 0)) & 1
                entities.append(Entity(verts, bool(closed), layer))

    return entities



# ──────────────────────────────────────────── DXF writer ──────────────────────

def _dxf_header(layers: list) -> List[str]:
    out = ["0","SECTION","2","HEADER",
           "9","$ACADVER","1","AC1015",
           "9","$INSUNITS","70","4",
           "0","ENDSEC",
           "0","SECTION","2","TABLES",
           "0","TABLE","2","LAYER","70",str(len(layers)+1)]
    out += ["0","LAYER","2","0","70","0","62","7","6","CONTINUOUS"]
    for lyr in layers:
        out += ["0","LAYER","2",lyr,"70","0","62","7","6","CONTINUOUS"]
    out += ["0","ENDTAB","0","ENDSEC","0","SECTION","2","ENTITIES"]
    return out


def write_dxf(entities: List[Entity], path: str) -> None:
    layers = sorted({e.layer for e in entities} - {"0"})
    out = _dxf_header(layers)
    for e in entities:
        if len(e.points) < 2:
            continue
        pts = list(e.points)
        if e.closed and pts[0] != pts[-1]:
            pts.append(pts[0])
        flags = 1 if e.closed else 0
        out += ["0","LWPOLYLINE",
                "8", e.layer,
                "90", str(len(pts)),
                "70", str(flags)]
        for x, y in pts:
            out += ["10", f"{x:.6f}", "20", f"{y:.6f}"]
    out += ["0","ENDSEC","0","EOF"]
    Path(path).write_text("\n".join(out), encoding="utf-8")


# ──────────────────────────────────────────── PatternClipper ──────────────────

@dataclass
class ClipParams:
    clip_rect:     ClipRect
    door_w:        float
    door_h:        float
    scale_x:       float = 1.0
    scale_y:       float = 1.0
    rotation:      float = 0.0
    offset_x:      float = 0.0   # user-controlled X shift (mm)
    offset_y:      float = 0.0   # user-controlled Y shift (mm)
    close_trimmed: bool  = True
    layer_id:      str   = "PATTERN_CLIP"
    save_with_door: bool = True


class PatternClipper:
    def __init__(self, entities: List[Entity], params: ClipParams):
        self.entities = entities
        self.p        = params

    @classmethod
    def from_dxf(cls, dxf_path: str, params: ClipParams) -> "PatternClipper":
        return cls(parse_dxf(dxf_path), params)

    @classmethod
    def from_entities(cls, entities: List[Entity],
                      params: ClipParams) -> "PatternClipper":
        return cls(entities, params)

    def run(self) -> List[Entity]:
        p = self.p
        r = p.clip_rect

        # pattern bbox — for rotation pivot only, NO auto-centering
        all_pts = [pt for e in self.entities for pt in e.points]
        if not all_pts:
            return []
        xs = [pt[0] for pt in all_pts]
        ys = [pt[1] for pt in all_pts]
        pat_cx = (min(xs) + max(xs)) / 2
        pat_cy = (min(ys) + max(ys)) / 2

        # user offset: door center + user_offset_x/y
        tx = p.door_w / 2 + p.offset_x
        ty = p.door_h / 2 + p.offset_y

        result: List[Entity] = []
        for e in self.entities:
            # 1. scale around pattern bbox center
            pts = [(pat_cx + (pt[0]-pat_cx)*p.scale_x,
                    pat_cy + (pt[1]-pat_cy)*p.scale_y)
                   for pt in e.points]
            # 2. rotate around pattern bbox center
            if p.rotation:
                pts = [_rotate(pt, pat_cx, pat_cy, p.rotation) for pt in pts]
            # 3. place pattern-center at door-center + user offset
            pts = [(pt[0] - pat_cx + tx,
                    pt[1] - pat_cy + ty)
                   for pt in pts]
            ent = Entity(pts, e.closed, p.layer_id)
            result.extend(ent.clip(r, close_trimmed=p.close_trimmed))

        return result

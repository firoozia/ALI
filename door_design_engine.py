"""
FIROO CAM - Parametric Door Design Engine
Pure-logic module (no PySide6). Used by Design Editor, DXF export, G-code.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict, field
from typing import List, Tuple, Dict, Optional
import json, math
from pathlib import Path

Point = Tuple[float, float]

@dataclass
class ToolRef:
    tool_id: str
    name: str

@dataclass
class OffsetStep:
    """One cumulative offset row."""
    enabled: bool
    step_mm: float          # amount added to previous total (symmetric when link=True)
    tool_id: str
    operation: str
    depth_mm: float
    note: str = ""
    link: bool = True       # True = symmetric, False = use top/right/bottom/left
    step_top: float = 0.0
    step_right: float = 0.0
    step_bottom: float = 0.0
    step_left: float = 0.0

@dataclass
class PatternRule:
    """Pattern generated between two offset indices."""
    enabled: bool
    name: str
    pattern_type: str        # stepped_border | cross_grid | diagonal | horizontal | vertical | dots | wave | zigzag
    outer_idx: int           # index into enabled offset list (0-based)
    inner_idx: int
    tool_id: str
    depth_mm: float
    # stepped_border params
    pitch_mm: float = 50.0
    step_width_mm: float = 25.0
    start_lead_mm: float = 37.5
    # grid / line params
    spacing_mm: float = 30.0
    spacing_y_mm: float = 30.0
    angle_deg: float = 45.0
    # wave params
    amplitude_mm: float = 5.0
    wavelength_mm: float = 40.0
    passes: int = 1
    # general
    margin_mm: float = 0.0

@dataclass
class DoorDesign:
    code: str
    name: str
    default_width: float
    default_height: float
    offset_mode: str = "cumulative"
    offset_steps: List[OffsetStep] = field(default_factory=list)
    patterns: List[PatternRule] = field(default_factory=list)

@dataclass
class GeometryEntity:
    layer_name: str
    tool_id: str
    operation: str
    depth_mm: float
    points: List[Point]
    closed: bool = True

# ── Cumulative math ────────────────────────────────────────────────────────────

def cumulative_totals(steps: List[OffsetStep]) -> List[Tuple[float,float,float,float]]:
    """Returns list of (top, right, bottom, left) cumulative totals per enabled step."""
    results = []
    tt = tr = tb = tl = 0.0
    for s in steps:
        if not s.enabled or (s.step_mm <= 0 and s.link):
            continue
        if s.link:
            tt += s.step_mm; tr += s.step_mm
            tb += s.step_mm; tl += s.step_mm
        else:
            tt += s.step_top;    tr += s.step_right
            tb += s.step_bottom; tl += s.step_left
        results.append((round(tt,4), round(tr,4), round(tb,4), round(tl,4)))
    return results

def rect_from_totals(W: float, H: float, top: float, right: float, bottom: float, left: float) -> Optional[List[Point]]:
    x1, y1 = left, bottom
    x2, y2 = W - right, H - top
    if x2 <= x1 or y2 <= y1:
        return None
    return [(x1,y1),(x2,y1),(x2,y2),(x1,y2),(x1,y1)]

def safe_layer_name(*parts: str) -> str:
    raw = "_".join(str(p) for p in parts if str(p).strip())
    for ch in " /\\:*?\"<>|()[]{}":
        raw = raw.replace(ch, "_")
    while "__" in raw:
        raw = raw.replace("__", "_")
    return raw.strip("_")

# ── Pattern generators ─────────────────────────────────────────────────────────

def _band(W,H,outer_t,outer_r,outer_b,outer_l, inner_t,inner_r,inner_b,inner_l):
    """Returns (ox1,oy1,ox2,oy2, ix1,iy1,ix2,iy2) or None if invalid."""
    ox1=outer_l; oy1=outer_b; ox2=W-outer_r; oy2=H-outer_t
    ix1=inner_l; iy1=inner_b; ix2=W-inner_r; iy2=H-inner_t
    if ox2<=ox1 or oy2<=oy1 or ix2<=ix1 or iy2<=iy1:
        return None
    return ox1,oy1,ox2,oy2, ix1,iy1,ix2,iy2

def stepped_border_pattern(W,H, o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left,
                            pitch_mm=50, step_width_mm=25, start_lead_mm=37.5) -> List[List[Point]]:
    b = _band(W,H,o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left)
    if b is None: return []
    ox1,oy1,ox2,oy2,ix1,iy1,ix2,iy2 = b
    paths: List[List[Point]] = []
    pitch, sw, lead = pitch_mm, step_width_mm, start_lead_mm

    def bottom_side():
        pts=[(ox1,oy1)]; x=ox1+lead; pts.append((x,oy1))
        while x+sw*2<=ox2-lead:
            pts+=[(x,iy1),(x+sw,iy1),(x+sw,oy1),(x+pitch,oy1)]; x+=pitch
        pts.append((ox2,oy1)); return pts
    def top_side():
        pts=[(ox2,oy2)]; x=ox2-lead; pts.append((x,oy2))
        while x-sw*2>=ox1+lead:
            pts+=[(x,iy2),(x-sw,iy2),(x-sw,oy2),(x-pitch,oy2)]; x-=pitch
        pts.append((ox1,oy2)); return pts
    def left_side():
        pts=[(ox1,oy2)]; y=oy2-lead; pts.append((ox1,y))
        while y-sw*2>=oy1+lead:
            pts+=[(ix1,y),(ix1,y-sw),(ox1,y-sw),(ox1,y-pitch)]; y-=pitch
        pts.append((ox1,oy1)); return pts
    def right_side():
        pts=[(ox2,oy1)]; y=oy1+lead; pts.append((ox2,y))
        while y+sw*2<=oy2-lead:
            pts+=[(ix2,y),(ix2,y+sw),(ox2,y+sw),(ox2,y+pitch)]; y+=pitch
        pts.append((ox2,oy2)); return pts

    for fn in (bottom_side,right_side,top_side,left_side):
        path=fn()
        if len(path)>=2: paths.append(path)
    return paths

def cross_grid_pattern(W,H, o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left,
                        spacing_mm=30, spacing_y_mm=30, margin_mm=0, angle_deg=0) -> List[List[Point]]:
    b = _band(W,H,o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left)
    if b is None: return []
    ox1,oy1,ox2,oy2,ix1,iy1,ix2,iy2 = b
    x1=ix1+margin_mm; y1=iy1+margin_mm; x2=ix2-margin_mm; y2=iy2-margin_mm
    if x2<=x1 or y2<=y1: return []
    paths=[]
    if angle_deg == 0:
        sy = spacing_y_mm if spacing_y_mm>0 else spacing_mm
        y=y1
        while y<=y2:
            paths.append([(x1,y),(x2,y)]); y+=sy
        x=x1
        while x<=x2:
            paths.append([(x,y1),(x,y2)]); x+=spacing_mm
    else:
        rad=math.radians(angle_deg)
        diag=math.hypot(x2-x1,y2-y1)+spacing_mm
        cx,cy=(x1+x2)/2,(y1+y2)/2
        n=int(diag/spacing_mm)+2
        for i in range(-n,n+1):
            d=i*spacing_mm
            px1=cx+d*math.cos(rad+math.pi/2)-diag*math.cos(rad)
            py1=cy+d*math.sin(rad+math.pi/2)-diag*math.sin(rad)
            px2=cx+d*math.cos(rad+math.pi/2)+diag*math.cos(rad)
            py2=cy+d*math.sin(rad+math.pi/2)+diag*math.sin(rad)
            paths.append([(px1,py1),(px2,py2)])
    return paths

def diagonal_pattern(W,H, o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left,
                     spacing_mm=30, angle_deg=45, margin_mm=0) -> List[List[Point]]:
    return cross_grid_pattern(W,H,o_top,o_right,o_bottom,o_left,i_top,i_right,i_bottom,i_left,
                               spacing_mm=spacing_mm,spacing_y_mm=spacing_mm,margin_mm=margin_mm,angle_deg=angle_deg)

def horizontal_pattern(W,H, o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left,
                       spacing_mm=30, margin_mm=0) -> List[List[Point]]:
    b = _band(W,H,o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left)
    if b is None: return []
    ox1,oy1,ox2,oy2,ix1,iy1,ix2,iy2 = b
    x1=ix1+margin_mm; y1=iy1+margin_mm; x2=ix2-margin_mm; y2=iy2-margin_mm
    if x2<=x1 or y2<=y1: return []
    paths=[]; y=y1
    while y<=y2:
        paths.append([(x1,y),(x2,y)]); y+=spacing_mm
    return paths

def vertical_pattern(W,H, o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left,
                     spacing_mm=30, margin_mm=0) -> List[List[Point]]:
    b = _band(W,H,o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left)
    if b is None: return []
    ox1,oy1,ox2,oy2,ix1,iy1,ix2,iy2 = b
    x1=ix1+margin_mm; y1=iy1+margin_mm; x2=ix2-margin_mm; y2=iy2-margin_mm
    if x2<=x1 or y2<=y1: return []
    paths=[]; x=x1
    while x<=x2:
        paths.append([(x,y1),(x,y2)]); x+=spacing_mm
    return paths

def dots_pattern(W,H, o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left,
                 spacing_mm=30, spacing_y_mm=30, margin_mm=0) -> List[List[Point]]:
    b = _band(W,H,o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left)
    if b is None: return []
    ox1,oy1,ox2,oy2,ix1,iy1,ix2,iy2 = b
    x1=ix1+margin_mm; y1=iy1+margin_mm; x2=ix2-margin_mm; y2=iy2-margin_mm
    if x2<=x1 or y2<=y1: return []
    sy = spacing_y_mm if spacing_y_mm>0 else spacing_mm
    paths=[]; r=2.0
    y=y1
    while y<=y2:
        x=x1
        while x<=x2:
            paths.append([(x-r,y),(x+r,y),(x,y),(x,y-r),(x,y+r)])
            x+=spacing_mm
        y+=sy
    return paths

def wave_pattern(W,H, o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left,
                 spacing_mm=30, amplitude_mm=5, wavelength_mm=40, passes=1, margin_mm=0) -> List[List[Point]]:
    b = _band(W,H,o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left)
    if b is None: return []
    ox1,oy1,ox2,oy2,ix1,iy1,ix2,iy2 = b
    x1=ix1+margin_mm; y1=iy1+margin_mm; x2=ix2-margin_mm; y2=iy2-margin_mm
    if x2<=x1 or y2<=y1: return []
    paths=[]
    for p in range(passes):
        cy=y1+p*spacing_mm
        if cy>y2: break
        pts=[]; n=int((x2-x1)/4)+1
        for i in range(n+1):
            fx=(x2-x1)*i/n
            fy=amplitude_mm*math.sin(2*math.pi*fx/max(wavelength_mm,1))
            pts.append((x1+fx, cy+fy))
        paths.append(pts)
    return paths

def zigzag_pattern(W,H, o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left,
                   pitch_mm=40, height_mm=10, margin_mm=0) -> List[List[Point]]:
    b = _band(W,H,o_top,o_right,o_bottom,o_left, i_top,i_right,i_bottom,i_left)
    if b is None: return []
    ox1,oy1,ox2,oy2,ix1,iy1,ix2,iy2 = b
    x1=ix1+margin_mm; y1=iy1+margin_mm; x2=ix2-margin_mm; y2=iy2-margin_mm
    if x2<=x1 or y2<=y1: return []
    paths=[]; half=pitch_mm/2
    cy=y1+height_mm/2
    while cy<=y2-height_mm/2:
        pts=[]; x=x1; up=True
        while x<=x2:
            pts.append((x, cy+(height_mm/2 if up else -height_mm/2)))
            x+=half; up=not up
        if len(pts)>=2: paths.append(pts)
        cy+=height_mm+pitch_mm
    return paths


PATTERN_GENERATORS = {
    "stepped_border": stepped_border_pattern,
    "cross_grid":     cross_grid_pattern,
    "diagonal":       diagonal_pattern,
    "horizontal":     horizontal_pattern,
    "vertical":       vertical_pattern,
    "dots":           dots_pattern,
    "wave":           wave_pattern,
    "zigzag":         zigzag_pattern,
}

PATTERN_PARAMS = {
    "stepped_border": [
        ("pitch_mm",       "Pitch",       "mm", 1.0, 500.0, 50.0),
        ("step_width_mm",  "Step Width",  "mm", 1.0, 200.0, 25.0),
        ("start_lead_mm",  "Start Lead",  "mm", 0.0, 200.0, 37.5),
    ],
    "cross_grid": [
        ("spacing_mm",   "Spacing X",  "mm", 1.0, 500.0, 30.0),
        ("spacing_y_mm", "Spacing Y",  "mm", 1.0, 500.0, 30.0),
        ("angle_deg",    "Angle",      "°",  0.0,  90.0,  0.0),
        ("margin_mm",    "Margin",     "mm", 0.0, 100.0,  0.0),
    ],
    "diagonal": [
        ("spacing_mm",  "Spacing", "mm", 1.0, 500.0, 30.0),
        ("angle_deg",   "Angle",   "°",  0.0,  90.0, 45.0),
        ("margin_mm",   "Margin",  "mm", 0.0, 100.0,  0.0),
    ],
    "horizontal": [
        ("spacing_mm", "Spacing", "mm", 1.0, 500.0, 30.0),
        ("margin_mm",  "Margin",  "mm", 0.0, 100.0,  0.0),
    ],
    "vertical": [
        ("spacing_mm", "Spacing", "mm", 1.0, 500.0, 30.0),
        ("margin_mm",  "Margin",  "mm", 0.0, 100.0,  0.0),
    ],
    "dots": [
        ("spacing_mm",   "Pitch X", "mm", 1.0, 500.0, 30.0),
        ("spacing_y_mm", "Pitch Y", "mm", 1.0, 500.0, 30.0),
        ("margin_mm",    "Margin",  "mm", 0.0, 100.0,  0.0),
    ],
    "wave": [
        ("spacing_mm",    "Row Spacing",  "mm", 1.0, 500.0, 30.0),
        ("amplitude_mm",  "Amplitude",    "mm", 0.5, 100.0,  5.0),
        ("wavelength_mm", "Wavelength",   "mm", 1.0, 500.0, 40.0),
        ("passes",        "Rows",         "",   1,    50,     1  ),
        ("margin_mm",     "Margin",       "mm", 0.0, 100.0,  0.0),
    ],
    "zigzag": [
        ("pitch_mm",  "Pitch",  "mm", 1.0, 500.0, 40.0),
        ("height_mm", "Height", "mm", 1.0, 100.0, 10.0),
        ("margin_mm", "Margin", "mm", 0.0, 100.0,  0.0),
    ],
}

ALL_PATTERN_TYPES = list(PATTERN_GENERATORS.keys())


def generate_pattern_geometry(pr: PatternRule, W: float, H: float,
                               totals: List[Tuple[float,float,float,float]]) -> List[List[Point]]:
    """Call the right generator for a PatternRule given computed totals list."""
    ai = pr.outer_idx; bi = pr.inner_idx
    if ai >= len(totals) or bi >= len(totals):
        return []
    at = totals[ai]; bt = totals[bi]
    o_top,o_right,o_bottom,o_left = (min(at[k],bt[k]) for k in range(4))
    i_top,i_right,i_bottom,i_left = (max(at[k],bt[k]) for k in range(4))
    fn = PATTERN_GENERATORS.get(pr.pattern_type)
    if fn is None:
        return []
    kwargs = dict(
        pitch_mm=pr.pitch_mm, step_width_mm=pr.step_width_mm, start_lead_mm=pr.start_lead_mm,
        spacing_mm=pr.spacing_mm, spacing_y_mm=pr.spacing_y_mm, angle_deg=pr.angle_deg,
        amplitude_mm=pr.amplitude_mm, wavelength_mm=pr.wavelength_mm, passes=pr.passes,
        margin_mm=pr.margin_mm,
    )
    import inspect
    sig = inspect.signature(fn)
    filtered = {k:v for k,v in kwargs.items() if k in sig.parameters}
    try:
        return fn(W,H,o_top,o_right,o_bottom,o_left,i_top,i_right,i_bottom,i_left,**filtered)
    except Exception:
        return []


def design_to_dict(d: "DoorDesign") -> dict:
    return asdict(d)

def design_from_dict(data: dict) -> "DoorDesign":
    steps=[]
    for s in data.get("offset_steps",[]):
        steps.append(OffsetStep(
            enabled=bool(s.get("enabled",True)),
            step_mm=float(s.get("step_mm",0)),
            tool_id=s.get("tool_id","T1"),
            operation=s.get("operation","groove"),
            depth_mm=float(s.get("depth_mm",0)),
            note=s.get("note",""),
            link=bool(s.get("link",True)),
            step_top=float(s.get("step_top",s.get("step_mm",0))),
            step_right=float(s.get("step_right",s.get("step_mm",0))),
            step_bottom=float(s.get("step_bottom",s.get("step_mm",0))),
            step_left=float(s.get("step_left",s.get("step_mm",0))),
        ))
    pats=[]
    for p in data.get("patterns",[]):
        pats.append(PatternRule(
            enabled=bool(p.get("enabled",True)),
            name=p.get("name","Pattern"),
            pattern_type=p.get("pattern_type","stepped_border"),
            outer_idx=int(p.get("outer_idx",0)),
            inner_idx=int(p.get("inner_idx",1)),
            tool_id=p.get("tool_id","T1"),
            depth_mm=float(p.get("depth_mm",2)),
            pitch_mm=float(p.get("pitch_mm",50)),
            step_width_mm=float(p.get("step_width_mm",25)),
            start_lead_mm=float(p.get("start_lead_mm",37.5)),
            spacing_mm=float(p.get("spacing_mm",30)),
            spacing_y_mm=float(p.get("spacing_y_mm",30)),
            angle_deg=float(p.get("angle_deg",45)),
            amplitude_mm=float(p.get("amplitude_mm",5)),
            wavelength_mm=float(p.get("wavelength_mm",40)),
            passes=int(p.get("passes",1)),
            margin_mm=float(p.get("margin_mm",0)),
        ))
    return DoorDesign(
        code=data.get("code","F000"),
        name=data.get("name","Door"),
        default_width=float(data.get("default_width",900)),
        default_height=float(data.get("default_height",500)),
        offset_mode=data.get("offset_mode","cumulative"),
        offset_steps=steps,
        patterns=pats,
    )

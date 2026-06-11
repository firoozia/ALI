"""
FIROO CAM - Pattern Engine
موتور طراحی هندسی درها با لایه‌بندی
"""
from dataclasses import dataclass, field
from typing import List, Optional
from shapely.geometry import Polygon, LineString
import math

LAYER_OUTER   = "OUTER_BOUNDARY"
LAYER_OFFSET  = "OFFSET_{}"
LAYER_PATTERN = "PATTERN"
LAYER_CUT     = "CUT_OUTER"
LAYER_COLORS  = {
    "OUTER_BOUNDARY":7,"OFFSET_1":1,"OFFSET_2":5,"OFFSET_3":3,
    "OFFSET_4":2,"OFFSET_5":6,"OFFSET_6":4,"OFFSET_7":1,
    "OFFSET_8":5,"OFFSET_9":3,"OFFSET_10":2,"PATTERN":6,"CUT_OUTER":7,
}

@dataclass
class OffsetDef:
    index:    int   = 1
    value:    float = 0.0
    depth:    float = 1.0
    tool_id:  str   = "T1"
    strategy: str   = "along_vector"
    enabled:  bool  = True

    def is_active(self) -> bool:
        return self.enabled and self.value > 0

    @property
    def layer_name(self) -> str:
        return LAYER_OFFSET.format(self.index)

@dataclass
class PatternDef:
    enabled:   bool  = False
    ptype:     str   = "cross_grid"
    spacing_x: float = 50.0
    spacing_y: float = 50.0
    angle:     float = 45.0
    depth:     float = 2.0
    tool_id:   str   = "T1"
    boundary:  int   = 5
    strategy:  str   = "along_vector"

@dataclass
class LayerGeometry:
    layer_name: str
    color:      int
    geometry:   object
    depth:      float = 1.0
    tool_id:    str   = "T1"
    strategy:   str   = "along_vector"
    is_pattern: bool  = False

@dataclass
class DesignConfig:
    design_code: str       = "101"
    name:        str       = "Simple Frame"
    width:       float     = 900.0
    height:      float     = 500.0
    offsets:     List[OffsetDef]  = field(default_factory=list)
    pattern:     PatternDef = field(default_factory=PatternDef)

    def __post_init__(self):
        if not self.offsets:
            self.offsets = [OffsetDef(index=i) for i in range(1,11)]

class PatternEngine:
    def __init__(self, config: DesignConfig):
        self.cfg      = config
        self.errors   = []
        self.warnings = []
        self.layers: List[LayerGeometry] = []

    def generate(self) -> bool:
        self.errors = []; self.warnings = []; self.layers = []
        w, h = self.cfg.width, self.cfg.height
        outer = Polygon([(0,0),(w,0),(w,h),(0,h)])
        self.layers.append(LayerGeometry(
            layer_name=LAYER_OUTER, color=LAYER_COLORS[LAYER_OUTER],
            geometry=outer, depth=0, tool_id=""))
        current_poly = outer
        total_offset = 0.0
        active = [o for o in self.cfg.offsets if o.is_active()]
        if not active:
            self.warnings.append("⚠️ هیچ آفست فعالی تعریف نشده")
        for off in active:
            total_offset += off.value
            max_allowed   = min(w, h) / 2.0
            if total_offset >= max_allowed:
                self.errors.append(
                    f"❌ آفست {off.index} ({off.value}mm): مجموع {total_offset:.1f}mm "
                    f"از حداکثر مجاز {max_allowed:.1f}mm بیشتر است.")
                return False
            new_poly = current_poly.buffer(-off.value, join_style=2)
            if new_poly.is_empty or not new_poly.is_valid:
                self.errors.append(f"❌ آفست {off.index}: geometry معتبر تولید نشد.")
                return False
            if new_poly.area < 50:
                self.warnings.append(f"⚠️ آفست {off.index}: فضای باقیمانده بسیار کم.")
            lname = off.layer_name
            self.layers.append(LayerGeometry(
                layer_name=lname, color=LAYER_COLORS.get(lname,7),
                geometry=new_poly, depth=off.depth,
                tool_id=off.tool_id, strategy=off.strategy))
            current_poly = new_poly
        if self.cfg.pattern.enabled:
            pat = self.cfg.pattern
            idx = min(pat.boundary-1, len(self.layers)-2)
            boundary = self.layers[idx+1].geometry if len(self.layers)>1 else self.layers[0].geometry
            lines = self._generate_pattern(boundary, pat)
            self.layers.append(LayerGeometry(
                layer_name=LAYER_PATTERN, color=LAYER_COLORS[LAYER_PATTERN],
                geometry=lines, depth=pat.depth, tool_id=pat.tool_id,
                strategy=pat.strategy, is_pattern=True))
        self.layers.append(LayerGeometry(
            layer_name=LAYER_CUT, color=LAYER_COLORS[LAYER_CUT],
            geometry=outer, depth=self.cfg.offsets[0].depth if self.cfg.offsets else 18,
            tool_id="T1", strategy="outside_vector"))
        return True

    def _generate_pattern(self, boundary, pat):
        lines = []
        minx,miny,maxx,maxy = boundary.bounds
        diag = math.sqrt((maxx-minx)**2+(maxy-miny)**2)
        cx,cy = (minx+maxx)/2, (miny+maxy)/2
        angles = []
        if pat.ptype in ("cross_grid","diamond"): angles=[pat.angle,-pat.angle]
        elif pat.ptype=="vertical": angles=[90]
        elif pat.ptype=="horizontal": angles=[0]
        for angle_deg in angles:
            rad=math.radians(angle_deg); dx=math.cos(rad); dy=math.sin(rad)
            pdx=-dy; pdy=dx; steps=int(diag/pat.spacing_x)+2
            for i in range(-steps,steps+1):
                ox=cx+pdx*i*pat.spacing_x; oy=cy+pdy*i*pat.spacing_x
                line=LineString([(ox-dx*diag,oy-dy*diag),(ox+dx*diag,oy+dy*diag)])
                clipped=line.intersection(boundary)
                if not clipped.is_empty: lines.append(clipped)
        return lines

    def summary(self):
        print(f"\nطرح: {self.cfg.design_code} — {self.cfg.name}")
        print(f"سایز: {self.cfg.width}×{self.cfg.height} mm  |  لایه‌ها:")
        for layer in self.layers:
            if layer.is_pattern:
                count = len(layer.geometry) if isinstance(layer.geometry,list) else 1
                print(f"  [{layer.layer_name:20}] رنگ:{layer.color}  خطوط:{count}  عمق:{layer.depth}mm")
            else:
                area = layer.geometry.area if hasattr(layer.geometry,'area') else 0
                print(f"  [{layer.layer_name:20}] رنگ:{layer.color}  مساحت:{area:.0f}mm²  عمق:{layer.depth}mm")

if __name__ == "__main__":
    print("="*50)
    print("FIROO CAM - Pattern Engine")
    print("="*50)
    cfg = DesignConfig(
        design_code="101", name="Simple Frame", width=900, height=500,
        offsets=[
            OffsetDef(1,50,11,"T2"), OffsetDef(2,12,1,"T2"),
            OffsetDef(3,7,7,"T3"),   OffsetDef(4,18,1,"T2"),
            OffsetDef(5,8,2,"T1"),   OffsetDef(6,0),OffsetDef(7,0),
            OffsetDef(8,0),OffsetDef(9,0),OffsetDef(10,0),
        ],
        pattern=PatternDef(enabled=True,ptype="cross_grid",spacing_x=50,angle=45,depth=2,tool_id="T4",boundary=5)
    )
    engine = PatternEngine(cfg)
    ok = engine.generate()
    if ok: engine.summary()
    else:
        for e in engine.errors: print(e)
    print("\n✅ Pattern Engine OK")

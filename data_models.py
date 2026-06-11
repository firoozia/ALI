"""
FIROO CAM - Data Models
"""
from dataclasses import dataclass, field
from typing import List, Optional
from enum import Enum
import uuid

class PartStatus(Enum):
    PENDING = "pending"
    NESTED  = "nested"
    LOCKED  = "locked"
    ERROR   = "error"

class ToolType(Enum):
    ENDMILL  = "endmill"
    VBIT     = "vbit"
    BALLNOSE = "ballnose"
    DRILL    = "drill"
    FORM     = "form"

@dataclass
class Tool:
    tool_id:       str   = "T1"
    name:          str   = "Endmill 6mm"
    tool_type:     str   = "endmill"
    diameter:      float = 6.0
    angle:         float = 0.0
    cutting_length:float = 35.0
    feed_rate:     float = 3000.0
    plunge_rate:   float = 800.0
    spindle_rpm:   int   = 18000
    pass_depth:    float = 6.0
    safe_z:        float = 15.0
    enabled:       bool  = True

    def is_valid(self) -> bool:
        return self.diameter > 0 and self.feed_rate > 0 and self.pass_depth > 0

@dataclass
class Offset:
    enabled:  bool  = True
    name:     str   = "offset_1"
    value:    float = 60.0
    offset_x: float = 0.0
    offset_y: float = 0.0
    depth:    float = 1.0
    tool_id:  str   = "T1"
    strategy: str   = "along_vector"

@dataclass
class Pattern:
    enabled:      bool  = True
    pattern_type: str   = "cross_grid"
    boundary:     str   = "offset_5"
    spacing_x:    float = 50.0
    spacing_y:    float = 50.0
    angle:        float = 45.0
    depth:        float = 2.0
    tool_id:      str   = "T1"
    strategy:     str   = "along_vector"

@dataclass
class Part:
    part_id:     str   = field(default_factory=lambda: str(uuid.uuid4())[:8])
    part_code:   str   = ""
    width:       float = 900.0
    height:      float = 500.0
    thickness:   float = 18.0
    design_code: str   = "101"
    customer:    str   = ""
    material:    str   = "MDF"
    label:       str   = ""
    sheet_id:    int   = -1
    x:           float = 0.0
    y:           float = 0.0
    rotated:     bool  = False
    locked:      bool  = False
    status:      str   = "pending"

    def actual_width(self) -> float:
        return self.height if self.rotated else self.width

    def actual_height(self) -> float:
        return self.width if self.rotated else self.height

    def is_valid(self) -> bool:
        return self.width > 0 and self.height > 0

    def __str__(self):
        return f"{self.part_code} ({self.width}x{self.height}) D{self.design_code}"

@dataclass
class Sheet:
    sheet_id:  int   = 1
    width:     float = 2800.0
    height:    float = 1220.0
    thickness: float = 18.0
    material:  str   = "MDF"
    parts:     List[Part] = field(default_factory=list)

    def utilization(self) -> float:
        used  = sum(p.actual_width() * p.actual_height() for p in self.parts)
        total = self.width * self.height
        return round((used / total) * 100, 1) if total > 0 else 0.0

    def part_count(self) -> int:
        return len(self.parts)

@dataclass
class Order:
    order_id: str        = field(default_factory=lambda: str(uuid.uuid4())[:8])
    customer: str        = ""
    date:     str        = ""
    parts:    List[Part] = field(default_factory=list)
    sheets:   List[Sheet]= field(default_factory=list)

    def total_parts(self)  -> int: return len(self.parts)
    def total_sheets(self) -> int: return len(self.sheets)
    def add_part(self, part: Part): self.parts.append(part)
    def clear(self): self.parts.clear(); self.sheets.clear()

if __name__ == "__main__":
    print("✅ Data Models OK")

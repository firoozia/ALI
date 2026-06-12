"""
FIROO CAM — Line Door Pattern  (PatternClipper interface)
==========================================================
File 1 of 2: pattern entities generator.

Usage with PatternClipper:
    from line_door_pattern import LineDoorPattern
    from pattern_clip_engine import ClipRect, ClipParams, PatternClipper

    pat = LineDoorPattern(spacing=25.2, extend=26.0)
    clip_params = ClipParams(
        clip_rect = ClipRect(40, 40, 860, 2060),
        door_w=900, door_h=2100,
        close_trimmed=False,
        layer_id="LINE_DOOR",
    )
    result = PatternClipper(pat.entities(900, 2100), clip_params).run()
"""
from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import List

from pattern_clip_engine import Entity, ClipRect, ClipParams, PatternClipper


# ── core generator (shared with line_door_generator.py) ───────────────────

def _serpentine(
    width: float,
    height: float,
    spacing: float,
    extend: float,
    origin_x: float,
    origin_y: float,
    layer: str,
) -> List[Entity]:
    """
    Serpentine vertical lines centered at (origin_x, origin_y).

    GHX equivalence:
      N = ceil(width / spacing)           → Round Ceiling
      xs[i] = x_left + i*(width/N)        → Divide Curve (symmetric)
      even i: top → bot, odd i: bot → top → Weave {0,1} + PLine
      extend mm beyond top/bottom edges   → Extend Curve
    """
    if spacing <= 0 or width <= 0 or height <= 0:
        return []
    n = math.ceil(width / spacing)
    if n < 1:
        return []
    actual = width / n
    x_left = origin_x - width  / 2.0
    y_bot  = origin_y - height / 2.0 - extend
    y_top  = origin_y + height / 2.0 + extend

    pts: List = []
    for i in range(n + 1):
        x = x_left + i * actual
        if i % 2 == 0:
            pts.append((x, y_top))
            pts.append((x, y_bot))
        else:
            pts.append((x, y_bot))
            pts.append((x, y_top))

    return [Entity(pts, closed=False, layer=layer)]


# ── LineDoorPattern ────────────────────────────────────────────────────────

@dataclass
class LineDoorPattern:
    """
    Line door pattern — connects to PatternClipper.

    Attributes mirror the 5 GHX sliders:
      spacing  = 25.2 mm  (slider 1)
      extend   = 26   mm  (slider 2)
      ratio    = 0.66     (slider 3 — external depth/scale, not used here)
      width    = 0    mm  (0 = auto: use clip_rect width)
      height   = 0    mm  (0 = auto: use clip_rect height)
    """
    spacing:  float = 25.2
    extend:   float = 26.0
    ratio:    float = 0.66
    width:    float = 0.0    # 0 → auto from clip rect
    height:   float = 0.0    # 0 → auto from clip rect
    layer:    str   = "LINE_DOOR"

    def entities(self,
                 door_w: float,
                 door_h: float,
                 clip_rect: ClipRect | None = None) -> List[Entity]:
        """
        Return raw (unclipped) serpentine entities.
        If width/height are 0, infers them from clip_rect or door dimensions.
        """
        if clip_rect is not None:
            eff_w = self.width  if self.width  > 0 else clip_rect.W
            eff_h = self.height if self.height > 0 else clip_rect.H
            ox    = clip_rect.cx
            oy    = clip_rect.cy
        else:
            eff_w = self.width  if self.width  > 0 else door_w
            eff_h = self.height if self.height > 0 else door_h
            ox    = door_w / 2
            oy    = door_h / 2
        return _serpentine(eff_w, eff_h, self.spacing, self.extend,
                           ox, oy, self.layer)

    def clipped(self,
                door_w: float,
                door_h: float,
                clip_rect: ClipRect,
                close_trimmed: bool = False) -> List[Entity]:
        """Return clipped entities ready for DXF output."""
        ents = self.entities(door_w, door_h, clip_rect)
        params = ClipParams(
            clip_rect     = clip_rect,
            door_w        = door_w,
            door_h        = door_h,
            close_trimmed = close_trimmed,
            layer_id      = self.layer,
        )
        return PatternClipper(ents, params).run()

    def clipper(self,
                door_w: float,
                door_h: float,
                clip_rect: ClipRect,
                **kwargs) -> PatternClipper:
        """Return a ready-to-run PatternClipper instance."""
        ents = self.entities(door_w, door_h, clip_rect)
        params = ClipParams(
            clip_rect = clip_rect,
            door_w    = door_w,
            door_h    = door_h,
            layer_id  = self.layer,
            **kwargs,
        )
        return PatternClipper(ents, params)


# ── standalone test ────────────────────────────────────────────────────────

if __name__ == "__main__":
    from pattern_clip_engine import write_dxf

    pat = LineDoorPattern(spacing=25.2, extend=26.0)

    # clip to offset ring 40mm on a 900×2100 door
    door_w, door_h = 900.0, 2100.0
    off = 40.0
    rect = ClipRect(off, off, door_w - off, door_h - off)

    result = pat.clipped(door_w, door_h, rect)
    write_dxf(result, "/tmp/line_door_pattern_test.dxf")
    print(f"Clipped entities: {len(result)}")
    print("DXF → /tmp/line_door_pattern_test.dxf")

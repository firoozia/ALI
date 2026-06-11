"""
FIROO CAM - G-code Generator  (v2)

Changes from v1:
  - Reads .fdr designs via design_resolver (not DesignConfig/DesignConfig)
  - Loads tools from tool_library.json (not DEFAULT_TOOLS)
  - Uses post_processor_manager for header/footer/toolchange
  - Supports ATC (single file) and non-ATC (one file per tool)
  - Layer comments: ; === L2 - Outer Bevel ===
  - Full validation before export
"""
from __future__ import annotations
import math
from pathlib import Path
from typing import List, Dict, Optional, Tuple

from data_models import Part, Sheet, Tool
from config import config

# ── Tool fallback ─────────────────────────────────────────────
DEFAULT_TOOLS = {
    "T1":  Tool("T1",  "Endmill 6mm",   "endmill",  6,   0,   35, 3000, 800,  18000, 6,  15),
    "T2":  Tool("T2",  "Vbit 140",      "vbit",     0,   140, 35, 3000, 800,  18000, 11, 15),
    "T3":  Tool("T3",  "Form Tool 50",  "form",     50,  0,   35, 2000, 600,  18000, 7,  15),
    "T4":  Tool("T4",  "Ballnose 8mm",  "ballnose", 8,   0,   35, 2500, 700,  18000, 2,  15),
    "T5":  Tool("T5",  "Endmill 12mm",  "endmill",  12,  0,   35, 4000, 1000, 18000, 8,  15),
}


_tools_cache: Dict[str, Tool] = {}

def _load_tools() -> Dict[str, Tool]:
    """Load tools from tool_library.json. Fall back to defaults if unavailable."""
    global _tools_cache
    if _tools_cache:
        return _tools_cache
    try:
        from tool_library import ToolLibraryManager
        mgr   = ToolLibraryManager()
        tools = {}
        for t in mgr.all_tools():
            dm = t.to_datamodel()
            # Support both T1 and T01 keys
            key1 = f"T{t.tool_id}"   if not str(t.tool_id).startswith("T") else t.tool_id
            key2 = f"T0{t.tool_id}"  if not str(t.tool_id).startswith("T") else None
            tools[key1] = dm
            if key2:
                tools[key2] = dm
        if tools:
            # Also keep T01→T1 mapping
            for key in list(tools.keys()):
                short = key.lstrip("T0") or "0"
                tools[f"T{short}"] = tools[key]
            print(f"[GCode] Loaded {len(mgr.all_tools())} tools from tool_library.json")
            _tools_cache = tools
            return tools
    except Exception as e:
        print(f"[GCode] tool_library load error: {e} — using defaults")
    _tools_cache = dict(DEFAULT_TOOLS)
    return _tools_cache


def _normalize_tool_id(tid: str) -> str:
    """T01 → T1, T1 → T1, 1 → T1"""
    tid = str(tid).strip()
    if not tid.startswith("T"):
        tid = "T" + tid
    # Remove leading zeros after T: T01 → T1
    num = tid[1:].lstrip("0") or "1"
    return f"T{num}"


class DesignApplier:
    """
    Connects Part.design_code → .fdr file → DesignConfig for GCodeGenerator.
    Also handles rotation when part.rotated == True.
    """

    def __init__(self):
        from design_resolver import get_resolver
        self._resolver = get_resolver()   # singleton — no re-scan

    def get_design_config(self, part: Part):
        """
        Returns a dict of layer info ready for gcode generation.
        Format: { layer_name: {"depth": float, "offset": float, "tool": str, "enabled": bool} }
        Returns None if design not found.
        """
        design = self._resolver.load(
            part.design_code,
            width  = part.actual_width(),
            height = part.actual_height()
        )
        if design is None:
            return None

        layers = []
        for layer in design.layers:
            if not layer.get("enabled", True):
                continue
            layers.append({
                "id":        layer.get("id", 0),
                "name":      layer.get("name", f"L{layer.get('id',0)}"),
                "type":      layer.get("type", "groove"),
                "tool":      _normalize_tool_id(layer.get("tool", "T1")),
                "depth_mm":  float(layer.get("depth_mm", 0) or 0),
                "offset_mm": float(layer.get("offset_mm", 0) or 0),
                "pass_count":int(layer.get("pass_count", 1) or 1),
            })
        return layers

    def validate(self, parts: List[Part]) -> List[str]:
        """Return list of warning strings."""
        warnings = []
        for part in parts:
            ok = self._resolver.exists(part.design_code)
            if not ok:
                warnings.append(
                    f"Part '{part.part_code}': design '{part.design_code}' not found")
        return warnings


class GCodeGenerator:
    """
    Main G-code generator.
    Reads .fdr designs, generates toolpaths, outputs per post-processor rules.
    """

    def __init__(self, post_processor_id: str = None, tools: Dict = None):
        self.tools          = tools or _load_tools()
        self.safe_z         = config.safe_z
        self.home_z         = config.get("machine", "home_z")
        self.feed_rate      = config.get("machine", "feed_rate")
        self.plunge_rate    = config.get("machine", "plunge_rate")
        self.rpm            = config.get("machine", "spindle_rpm")
        self.origin         = config.get("gcode", "origin")
        self.output_dir     = Path(config.output_folder)
        self._pp_id         = post_processor_id or "gcode_mm"
        self._pp            = self._load_pp(self._pp_id)
        self._applier       = DesignApplier()

    def _load_pp(self, pp_id: str):
        try:
            from post_processor_manager import PostProcessorManager
            pp = PostProcessorManager().get(pp_id)
            if pp:
                print(f"[GCode] Post processor: {pp.name} (.{pp.file_extension})")
                return pp
        except Exception as e:
            print(f"[GCode] PP load error: {e}")
        return None

    @property
    def file_ext(self) -> str:
        return self._pp.file_extension if self._pp else "tap"

    @property
    def is_atc(self) -> bool:
        return self._pp.has_atc if self._pp else False

    def _render_header(self, tool: Tool = None) -> str:
        rpm = tool.spindle_rpm if tool else self.rpm
        if self._pp:
            params = {
                "safe_z":  self.safe_z,
                "home_z":  self.home_z,
                "home_x":  0.0,
                "home_y":  0.0,
                "rpm":     rpm,
                "feed":    self.feed_rate,
                "plunge":  self.plunge_rate,
            }
            try:
                return self._pp.render_header(params)
            except Exception:
                pass
        return (f"G21\nG90\nG17\n"
                f"G0 Z{self.safe_z:.3f}\n"
                f"M3 S{rpm}\n")

    def _render_footer(self) -> str:
        if self._pp:
            params = {
                "home_z": self.home_z,
                "safe_z": self.safe_z,
                "home_x": 0.0,
                "home_y": 0.0,
            }
            try:
                return self._pp.render_footer(params)
            except Exception:
                pass
        return f"G0 Z{self.home_z:.3f}\nM5\nG0 X0 Y0\nM30\n"

    def _render_toolchange(self, tool: Tool, tool_num: int) -> str:
        if self._pp:
            params = {"t": tool_num, "rpm": tool.spindle_rpm}
            try:
                return self._pp.render_toolchange(tool_num, tool.spindle_rpm, params)
            except Exception:
                pass
        return f"T{tool_num} M6\nM3 S{tool.spindle_rpm}\n"

    def _transform(self, x: float, y: float, px: float, py: float,
                   sw: float, sh: float) -> Tuple[float, float]:
        ax, ay = px + x, py + y
        if   self.origin == "(0,0)": return ax, ay
        elif self.origin == "(X,Y)": return sw - ax, sh - ay
        elif self.origin == "(0,Y)": return ax, sh - ay
        elif self.origin == "(X,0)": return sw - ax, ay
        return ax, ay

    def _layer_to_gcode(self, layer_info: dict, part: Part,
                        sw: float, sh: float, tool: Tool) -> List[str]:
        """
        Generate G-code for one layer of one part.
        Layer is defined by offset_mm (rectangle inset from part boundary).
        """
        lines = []
        depth      = layer_info["depth_mm"]
        offset     = layer_info["offset_mm"]
        pass_count = layer_info["pass_count"]
        layer_name = layer_info["name"]
        layer_type = layer_info["type"]

        if depth <= 0 or not tool.is_valid():
            return lines

        # Part actual dimensions (considering rotation)
        pw = part.actual_width()
        ph = part.actual_height()

        # Boundary rectangle (inset by offset)
        x0 = offset;     y0 = offset
        x1 = pw - offset; y1 = ph - offset

        if x1 <= x0 or y1 <= y0:
            lines.append(f"; Skipped {layer_name}: offset too large")
            return lines

        pass_depth = tool.pass_depth
        passes     = max(1, math.ceil(depth / pass_depth))
        feed       = tool.feed_rate
        plunge     = tool.plunge_rate

        # Transform helper
        def tx(x, y):
            cx, cy = self._transform(x, y, part.x, part.y, sw, sh)
            return f"X{cx:.3f} Y{cy:.3f}"

        # Layer comment
        lines.append(f"\n; === {layer_name} (off={offset:.1f}mm dep={depth:.1f}mm) ===")
        lines.append(f"G0 Z{self.safe_z:.3f}")
        lines.append(f"G0 {tx(x0, y0)}")

        if layer_type == "profile":
            # Profile: cut outer boundary
            for p in range(passes):
                z = -min(pass_depth * (p + 1), depth)
                lines.append(f"G1 Z{z:.3f} F{plunge:.0f}")
                lines.append(f"G1 {tx(x1, y0)} F{feed:.0f}")
                lines.append(f"G1 {tx(x1, y1)} F{feed:.0f}")
                lines.append(f"G1 {tx(x0, y1)} F{feed:.0f}")
                lines.append(f"G1 {tx(x0, y0)} F{feed:.0f}")
        else:
            # Groove / bevel / etc: cut inner rectangle
            for p in range(passes):
                z = -min(pass_depth * (p + 1), depth)
                lines.append(f"G1 Z{z:.3f} F{plunge:.0f}")
                lines.append(f"G1 {tx(x1, y0)} F{feed:.0f}")
                lines.append(f"G1 {tx(x1, y1)} F{feed:.0f}")
                lines.append(f"G1 {tx(x0, y1)} F{feed:.0f}")
                lines.append(f"G1 {tx(x0, y0)} F{feed:.0f}")

        lines.append(f"G0 Z{self.safe_z:.3f}")
        return lines

    def generate_part(self, part: Part, sw: float, sh: float) -> Dict[str, List[str]]:
        """
        Generate G-code for one part.
        Returns dict: {tool_id: [gcode_lines]}
        """
        layers = self._applier.get_design_config(part)
        if layers is None:
            return {}

        tool_groups: Dict[str, List[str]] = {}
        for layer in layers:
            tid  = layer["tool"]
            tool = self.tools.get(tid) or self.tools.get(f"T1") or DEFAULT_TOOLS["T1"]
            glines = self._layer_to_gcode(layer, part, sw, sh, tool)
            if glines:
                tool_groups.setdefault(tid, []).extend(glines)

        return tool_groups

    def generate_sheet(self, sheet, customer: str = "ORDER",
                       sheet_idx: int = 1) -> List[Path]:
        """
        Generate G-code for all parts on one sheet.
        ATC:     one file per sheet  → Sheet1.nc
        Non-ATC: one file per tool   → Sheet1_T1.tap, Sheet1_T2.tap
        """
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Collect all G-code grouped by tool
        all_tools: Dict[str, List[str]] = {}
        warnings = []

        for part in sheet.parts:
            if not part.design_code or part.design_code in ("cd0", "0", ""):
                warnings.append(f"  ⚠ {part.part_code}: no design assigned")
                continue
            part_gcode = self.generate_part(part, sheet.width, sheet.height)
            if not part_gcode:
                warnings.append(f"  ⚠ {part.part_code}: design '{part.design_code}' not found or no layers")
                continue
            for tid, lines in part_gcode.items():
                all_tools.setdefault(tid, []).extend(lines)

        if warnings:
            for w in warnings:
                print(f"[GCode] {w}")

        if not all_tools:
            print(f"[GCode] Sheet {sheet_idx}: no tool paths generated")
            return []

        saved = []
        base  = f"{customer}_Sheet{sheet_idx}"

        if self.is_atc:
            # Single file — all tools with M6 tool changes
            filepath = self.output_dir / f"{base}.{self.file_ext}"
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(self._render_header())
                f.write(f"\n; === Sheet {sheet_idx} — {len(all_tools)} tools ===\n")
                for i, (tid, glines) in enumerate(sorted(all_tools.items())):
                    tool     = self.tools.get(tid) or DEFAULT_TOOLS["T1"]
                    tool_num = int(tid.lstrip("T") or "1")
                    f.write(f"\n; ─── {tid}: {tool.name} ───\n")
                    if i == 0:
                        f.write(f"T{tool_num} M6\nM3 S{tool.spindle_rpm}\n")
                    else:
                        f.write(self._render_toolchange(tool, tool_num))
                    f.write("\n".join(glines) + "\n")
                f.write(self._render_footer())
            saved.append(filepath)
            print(f"[GCode] ATC file: {filepath.name}")
        else:
            # Non-ATC: one file per tool
            for tid, glines in sorted(all_tools.items()):
                tool     = self.tools.get(tid) or DEFAULT_TOOLS["T1"]
                tool_num = int(tid.lstrip("T") or "1")
                filename = f"{base}_{tid}_{tool.name.replace(' ','_')}.{self.file_ext}"
                filepath = self.output_dir / filename
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(self._render_header(tool))
                    f.write(f"\n; === {tid}: {tool.name} ===\n")
                    f.write(f"T{tool_num} M6\nM3 S{tool.spindle_rpm}\n")
                    f.write("\n".join(glines) + "\n")
                    f.write(self._render_footer())
                saved.append(filepath)
                print(f"[GCode] Non-ATC: {filepath.name}")

        return saved

    def generate_all(self, sheets: List, customer: str = "ORDER") -> List[Path]:
        """Generate G-code for all sheets."""
        all_saved = []
        warnings  = self._applier.validate(
            [p for s in sheets for p in s.parts])
        if warnings:
            print(f"[GCode] Validation warnings:")
            for w in warnings:
                print(f"  {w}")
        for i, sheet in enumerate(sheets, 1):
            saved = self.generate_sheet(sheet, customer, i)
            all_saved.extend(saved)
        print(f"\n[GCode] Total: {len(all_saved)} file(s) saved to {self.output_dir}")
        return all_saved

    def validate_sheets(self, sheets: List) -> List[str]:
        """Pre-export validation. Returns list of warning strings."""
        warnings = []
        for i, sheet in enumerate(sheets, 1):
            for part in sheet.parts:
                ok, msg = self._applier._resolver.validate(part.design_code)
                if not ok:
                    warnings.append(f"Sheet {i} | {part.part_code}: {msg}")
                # Check tool exists
                layers = self._applier.get_design_config(part)
                if layers:
                    for layer in layers:
                        tid = layer["tool"]
                        if tid not in self.tools:
                            warnings.append(
                                f"Sheet {i} | {part.part_code}: tool '{tid}' not in library")
        return warnings
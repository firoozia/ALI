"""
FIROO CAM — AI Agent
====================
Claude-powered assistant that understands GHX files and builds door geometry.

Usage:
    python firoo_cam_agent.py                    # interactive chat
    python firoo_cam_agent.py --file door.ghx    # analyze a file directly
    python firoo_cam_agent.py --preview          # render SVG preview

Requirements:
    pip install anthropic

Environment:
    ANTHROPIC_API_KEY  (required)
"""

from __future__ import annotations

import json
import math
import os
import sys
import tempfile
import textwrap
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

import anthropic

# ── import local engines ─────────────────────────────────────────────────────

sys.path.insert(0, str(Path(__file__).parent))

from ghx_analyzer import (
    GHXParser, SliderAnalyzer, OffsetAnalyzer,
    ComponentInventory, ConnectionGraphBuilder,
    DesignTypeDetector, ConversionAdvisor,
    build_json_report,
)
from door_geometry_engine import DoorParams, build_door_geometry


# ─────────────────────────────────────────────────────────────────────────────
# TOOL IMPLEMENTATIONS
# ─────────────────────────────────────────────────────────────────────────────

def _tool_analyze_ghx(ghx_path: str) -> dict:
    """Parse a .ghx file and return structured parameters."""
    path = Path(ghx_path).resolve()
    if not path.exists():
        return {"error": f"File not found: {ghx_path}"}

    try:
        parser = GHXParser(path)
        parser.parse()

        sliders       = SliderAnalyzer(parser.raw_objects).analyze()
        offset_result = OffsetAnalyzer(sliders).analyze()
        inventory     = ComponentInventory(parser.raw_objects).analyze()
        nodes, edges  = ConnectionGraphBuilder(parser.raw_objects).build()
        design_result = DesignTypeDetector(sliders, inventory, offset_result).detect()
        advice        = ConversionAdvisor(
            design_result["detected_design_type"], inventory, sliders
        ).advise()

        report = build_json_report(
            path, parser, sliders, offset_result,
            inventory, nodes, edges, design_result, advice
        )

        # Extract the key facts Claude needs
        # parameters is a list of dicts
        door_params = [
            p for p in report.get("parameters", [])
            if p.get("category") in ("offset", "dimension", "pattern")
        ]

        # extract OF1..OF10 step values in order
        off_analysis = report.get("offset_analysis", {})
        computed     = off_analysis.get("computed_example", [])
        offsets_raw  = [0.0] * 10
        for item in computed:
            name = item.get("name", "")
            if name.startswith("OF") and name[2:].isdigit():
                idx = int(name[2:]) - 1
                if 0 <= idx < 10:
                    offsets_raw[idx] = item.get("step", 0.0)

        # inventory is a list of {type, count}
        comp_map     = {c["type"]: c["count"] for c in inventory}
        has_cluster  = comp_map.get("Cluster", 0) > 0

        # dimensions from parameters
        dims = {p["name"]: p["value"] for p in report.get("parameters", [])
                if p.get("category") == "dimension"}

        return {
            "status":        "ok",
            "design_type":   report.get("summary", {}).get("detected_design_type", "unknown"),
            "confidence":    report.get("summary", {}).get("confidence", 0),
            "door_params":   door_params,
            "offsets_mm":    offsets_raw,
            "dimensions":    dims,
            "total_objects": len(parser.raw_objects),
            "has_cluster":   has_cluster,
            "warnings":      [
                w for w in [
                    "Cluster found — internal pattern logic not exported in .ghx"
                    if has_cluster else None
                ] if w
            ],
        }
    except Exception as exc:
        return {"error": str(exc)}


def _tool_build_door_geometry(
    width: float,
    height: float,
    offsets: list[float],
    div_length: float = 15.0,
    crossing: bool = True,
) -> dict:
    """
    Build the door geometry and return a summary.
    Returns rings, section line counts, and bounding data — not raw coordinates
    (too large to send to Claude).
    """
    try:
        params = DoorParams(
            width=width,
            height=height,
            offsets=offsets,
            div_length=div_length,
            crossing=crossing,
        )
        geom = build_door_geometry(params)

        rings_summary = [
            {
                "index": r.index,
                "step_mm": r.step_mm,
                "cumulative_mm": r.cumulative_mm,
                "rect": {"w": round(r.rect.w, 2), "h": round(r.rect.h, 2)},
            }
            for r in geom.rings
        ]

        sections_summary = [
            {
                "index": s.index,
                "outer_w": round(s.outer_rect.w, 2),
                "outer_h": round(s.outer_rect.h, 2),
                "inner_w": round(s.inner_rect.w, 2),
                "inner_h": round(s.inner_rect.h, 2),
                "width_mm": round(s.width_mm, 2),
                "pattern_lines": len(s.pattern_lines),
            }
            for s in geom.sections
        ]

        total_lines = sum(len(s.pattern_lines) for s in geom.sections)

        return {
            "status": "ok",
            "base_rect": {"w": width, "h": height},
            "total_offset_mm": round(geom.total_offset, 2),
            "inner_rect": {
                "w": round(geom.inner_rect.w, 2),
                "h": round(geom.inner_rect.h, 2),
            },
            "rings": rings_summary,
            "sections": sections_summary,
            "total_pattern_lines": total_lines,
            "crossing_mode": crossing,
        }
    except Exception as exc:
        return {"error": str(exc)}


def _tool_render_svg(
    width: float,
    height: float,
    offsets: list[float],
    div_length: float = 15.0,
    crossing: bool = True,
    output_path: str | None = None,
) -> dict:
    """Render door geometry as SVG and save to disk."""
    try:
        params = DoorParams(
            width=width,
            height=height,
            offsets=offsets,
            div_length=div_length,
            crossing=crossing,
        )
        geom = build_door_geometry(params)

        # Build SVG
        margin = 40
        scale  = min(600 / width, 800 / height)
        sw     = width * scale
        sh     = height * scale

        def px(x: float) -> float: return margin + x * scale
        def py(y: float) -> float: return margin + (height - y) * scale

        lines_svg = []

        # offset rings in grey
        for ring in geom.rings:
            r = ring.rect
            pts = [
                f"{px(r.left):.1f},{py(r.bottom):.1f}",
                f"{px(r.right):.1f},{py(r.bottom):.1f}",
                f"{px(r.right):.1f},{py(r.top):.1f}",
                f"{px(r.left):.1f},{py(r.top):.1f}",
                f"{px(r.left):.1f},{py(r.bottom):.1f}",
            ]
            lines_svg.append(
                f'<polyline points="{" ".join(pts)}" '
                f'fill="none" stroke="#aaa" stroke-width="0.8"/>'
            )

        # outer door boundary
        b = geom.base_rect
        pts = [
            f"{px(b.left):.1f},{py(b.bottom):.1f}",
            f"{px(b.right):.1f},{py(b.bottom):.1f}",
            f"{px(b.right):.1f},{py(b.top):.1f}",
            f"{px(b.left):.1f},{py(b.top):.1f}",
            f"{px(b.left):.1f},{py(b.bottom):.1f}",
        ]
        lines_svg.append(
            f'<polyline points="{" ".join(pts)}" '
            f'fill="none" stroke="#333" stroke-width="1.5"/>'
        )

        # pattern lines — blue with low opacity
        colors = ["#1a6ef5", "#e05800", "#0a9e30", "#a000cc", "#cc8800", "#007799"]
        for sec in geom.sections:
            color = colors[sec.index % len(colors)]
            for (ax, ay), (bx, by) in sec.pattern_lines:
                lines_svg.append(
                    f'<line x1="{px(ax):.1f}" y1="{py(ay):.1f}" '
                    f'x2="{px(bx):.1f}" y2="{py(by):.1f}" '
                    f'stroke="{color}" stroke-width="0.6" opacity="0.7"/>'
                )

        total_w = int(sw + 2 * margin)
        total_h = int(sh + 2 * margin)

        active_offsets = [o for o in offsets if o > 0]
        total_lines = sum(len(s.pattern_lines) for s in geom.sections)

        svg = textwrap.dedent(f"""\
            <?xml version="1.0" encoding="utf-8"?>
            <svg xmlns="http://www.w3.org/2000/svg"
                 width="{total_w}" height="{total_h}"
                 viewBox="0 0 {total_w} {total_h}">
              <rect width="100%" height="100%" fill="white"/>
              <!-- door geometry — {width:.0f}×{height:.0f} mm -->
              <!-- offsets: {active_offsets} -->
              <!-- pattern lines: {total_lines} -->
              {"".join(chr(10)+"  "+l for l in lines_svg)}
              <!-- labels -->
              <text x="{margin}" y="{total_h - 10}"
                    font-family="monospace" font-size="11" fill="#555">
                {width:.0f}×{height:.0f} mm  |  offsets={active_offsets}  |  {'crossing' if crossing else 'straight'}  |  {total_lines} lines
              </text>
            </svg>
        """)

        if output_path is None:
            tmp = tempfile.NamedTemporaryFile(
                suffix=".svg", delete=False, prefix="firoo_cam_"
            )
            output_path = tmp.name
            tmp.close()

        Path(output_path).write_text(svg, encoding="utf-8")

        return {
            "status": "ok",
            "svg_path": output_path,
            "dimensions_px": f"{total_w}×{total_h}",
            "total_pattern_lines": total_lines,
            "sections": len(geom.sections),
        }

    except Exception as exc:
        return {"error": str(exc)}


def _tool_export_dxf(
    width: float,
    height: float,
    offsets: list[float],
    div_length: float = 15.0,
    crossing: bool = True,
    output_path: str | None = None,
) -> dict:
    """Export door geometry as DXF (millimetres, Model space)."""
    try:
        params = DoorParams(
            width=width,
            height=height,
            offsets=offsets,
            div_length=div_length,
            crossing=crossing,
        )
        geom = build_door_geometry(params)

        if output_path is None:
            tmp = tempfile.NamedTemporaryFile(
                suffix=".dxf", delete=False, prefix="firoo_cam_"
            )
            output_path = tmp.name
            tmp.close()

        lines = []

        def _ent(group: int, value: Any) -> None:
            lines.append(f"  {group}\n{value}")

        # DXF header (minimal R12 compatible)
        lines.extend([
            "  0\nSECTION",
            "  2\nHEADER",
            "  9\n$ACADVER", "  1\nAC1009",
            "  9\n$EXTMIN", " 10\n0.0", " 20\n0.0",
            "  9\n$EXTMAX",
            f" 10\n{width:.4f}", f" 20\n{height:.4f}",
            "  0\nENDSEC",
            "  0\nSECTION",
            "  2\nENTITIES",
        ])

        # outer boundary
        c = geom.base_rect.corners()
        for i in range(4):
            x0, y0 = c[i]
            x1, y1 = c[(i + 1) % 4]
            lines.extend([
                "  0\nLINE", "  8\nOUTER",
                f" 10\n{x0:.4f}", f" 20\n{y0:.4f}", " 30\n0.0",
                f" 11\n{x1:.4f}", f" 21\n{y1:.4f}", " 31\n0.0",
            ])

        # offset rings
        for ring in geom.rings:
            c = ring.rect.corners()
            for i in range(4):
                x0, y0 = c[i]
                x1, y1 = c[(i + 1) % 4]
                lines.extend([
                    "  0\nLINE", f"  8\nOF{ring.index + 1}",
                    f" 10\n{x0:.4f}", f" 20\n{y0:.4f}", " 30\n0.0",
                    f" 11\n{x1:.4f}", f" 21\n{y1:.4f}", " 31\n0.0",
                ])

        # pattern lines
        for sec in geom.sections:
            layer = f"PATTERN_{sec.index}"
            for (ax, ay), (bx, by) in sec.pattern_lines:
                lines.extend([
                    "  0\nLINE", f"  8\n{layer}",
                    f" 10\n{ax:.4f}", f" 20\n{ay:.4f}", " 30\n0.0",
                    f" 11\n{bx:.4f}", f" 21\n{by:.4f}", " 31\n0.0",
                ])

        lines.append("  0\nENDSEC\n  0\nEOF")

        Path(output_path).write_text("\n".join(lines) + "\n", encoding="utf-8")

        total_lines = sum(len(s.pattern_lines) for s in geom.sections)
        return {
            "status": "ok",
            "dxf_path": output_path,
            "layers": ["OUTER"] + [f"OF{i+1}" for i in range(len(geom.rings))]
                      + [f"PATTERN_{i}" for i in range(len(geom.sections))],
            "total_entities": total_lines + 4 + len(geom.rings) * 4,
        }

    except Exception as exc:
        return {"error": str(exc)}


# ── tool dispatcher ────────────────────────────────────────────────────────────

TOOL_FUNCTIONS = {
    "analyze_ghx":        _tool_analyze_ghx,
    "build_door_geometry": _tool_build_door_geometry,
    "render_svg":         _tool_render_svg,
    "export_dxf":         _tool_export_dxf,
}

def _dispatch(tool_name: str, tool_input: dict) -> str:
    fn = TOOL_FUNCTIONS.get(tool_name)
    if fn is None:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})
    result = fn(**tool_input)
    return json.dumps(result, ensure_ascii=False, default=str)


# ─────────────────────────────────────────────────────────────────────────────
# TOOL SCHEMAS  (JSON Schema passed to Claude)
# ─────────────────────────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "analyze_ghx",
        "description": (
            "Parse a Grasshopper .ghx file and extract door parameters: "
            "offset values (OF1–OF10), door dimensions, DivLength, design type, "
            "and component inventory. Returns structured JSON — no geometry yet."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "ghx_path": {
                    "type": "string",
                    "description": "Absolute or relative path to the .ghx file.",
                }
            },
            "required": ["ghx_path"],
        },
    },
    {
        "name": "build_door_geometry",
        "description": (
            "Compute the full door geometry from parameters: offset rings and "
            "pattern lines for each section. Returns a summary with ring dimensions "
            "and line counts. Does NOT produce a file — use render_svg or export_dxf "
            "to save output."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "width":      {"type": "number", "description": "Door width in mm."},
                "height":     {"type": "number", "description": "Door height in mm."},
                "offsets":    {
                    "type": "array",
                    "items": {"type": "number"},
                    "description": "List of OF1–OF10 step values in mm (0 = inactive).",
                },
                "div_length": {
                    "type": "number",
                    "default": 15.0,
                    "description": "DivLength slider — spacing between pattern points in mm.",
                },
                "crossing":   {
                    "type": "boolean",
                    "default": True,
                    "description": "True = cross-connect (X-pattern), False = straight lines.",
                },
            },
            "required": ["width", "height", "offsets"],
        },
    },
    {
        "name": "render_svg",
        "description": (
            "Build the door geometry and render it to an SVG file on disk. "
            "Returns the file path and line count. Use this to give the user "
            "a visual preview."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "width":       {"type": "number"},
                "height":      {"type": "number"},
                "offsets":     {"type": "array", "items": {"type": "number"}},
                "div_length":  {"type": "number", "default": 15.0},
                "crossing":    {"type": "boolean", "default": True},
                "output_path": {
                    "type": "string",
                    "description": "Where to save the SVG. Omit for auto-temp path.",
                },
            },
            "required": ["width", "height", "offsets"],
        },
    },
    {
        "name": "export_dxf",
        "description": (
            "Build the door geometry and export to a DXF file (R12 format, mm). "
            "Each offset ring and pattern section gets its own layer. "
            "Returns path and layer list."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "width":       {"type": "number"},
                "height":      {"type": "number"},
                "offsets":     {"type": "array", "items": {"type": "number"}},
                "div_length":  {"type": "number", "default": 15.0},
                "crossing":    {"type": "boolean", "default": True},
                "output_path": {
                    "type": "string",
                    "description": "Where to save the DXF. Omit for auto-temp path.",
                },
            },
            "required": ["width", "height", "offsets"],
        },
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPT
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are the FIROO CAM AI Agent.
You help CNC operators design door panels from Grasshopper parametric files.

Your expertise:
  • Parsing .ghx files to extract door parameters (offsets, dimensions)
  • Building door geometry: offset rings + groove pattern lines
  • Generating SVG previews and DXF exports for CNC machines

How to work:
  1. If the user gives you a .ghx file path, call analyze_ghx first.
  2. From the analysis, extract width, height, and offsets[OF1..OF10].
  3. Call build_door_geometry to verify the geometry makes sense.
  4. Offer to render_svg for a visual preview or export_dxf for CAM use.

Pattern conventions (FIROO CAM standard):
  • Offsets are CUMULATIVE steps (OF1=50 means 50mm band, OF2=15 means next 15mm band, etc.)
  • Lines connect outer boundary of each band to its inner boundary
  • Default: crossing=True (X-pattern, matching Grasshopper cluster)
  • DivLength default: 15 mm

Always summarize what you did. Report dimensions in mm. Be concise.
"""


# ─────────────────────────────────────────────────────────────────────────────
# AGENT LOOP
# ─────────────────────────────────────────────────────────────────────────────

class FirooCamAgent:
    def __init__(self, model: str = "claude-opus-4-8"):
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise EnvironmentError(
                "ANTHROPIC_API_KEY environment variable not set.\n"
                "  export ANTHROPIC_API_KEY=sk-ant-..."
            )
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model  = model
        self.history: list[dict] = []

    def chat(self, user_text: str) -> str:
        """Send a user message, run the agent loop, return final text."""
        self.history.append({"role": "user", "content": user_text})

        while True:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                tools=TOOLS,
                messages=self.history,
                thinking={"type": "adaptive"},
            )

            # Collect tool calls and text in this turn
            tool_uses  = []
            text_parts = []

            for block in response.content:
                if block.type == "tool_use":
                    tool_uses.append(block)
                elif block.type == "text":
                    text_parts.append(block.text)

            # Add assistant turn to history
            self.history.append({
                "role": "assistant",
                "content": response.content,
            })

            # If no tools called → done
            if not tool_uses:
                return "\n".join(text_parts)

            # Execute every tool call and feed results back
            tool_results = []
            for tu in tool_uses:
                print(f"  [tool] {tu.name}({_fmt_args(tu.input)})")
                result_str = _dispatch(tu.name, tu.input)
                result_obj = json.loads(result_str)
                # Print key results to terminal
                if "error" in result_obj:
                    print(f"    ERROR: {result_obj['error']}")
                elif tu.name == "render_svg":
                    print(f"    SVG saved: {result_obj.get('svg_path')}")
                elif tu.name == "export_dxf":
                    print(f"    DXF saved: {result_obj.get('dxf_path')}")

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu.id,
                    "content": result_str,
                })

            self.history.append({"role": "user", "content": tool_results})

            # stop_reason == "end_turn" with no tool → handled above
            # stop_reason == "tool_use" → loop continues

    def reset(self) -> None:
        self.history.clear()


def _fmt_args(args: dict) -> str:
    parts = []
    for k, v in args.items():
        if isinstance(v, list):
            parts.append(f"{k}=[{', '.join(str(x) for x in v[:4])}{'...' if len(v) > 4 else ''}]")
        else:
            parts.append(f"{k}={v!r}")
    return ", ".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="FIROO CAM AI Agent")
    ap.add_argument("--file",    help="Path to a .ghx file to analyze on startup")
    ap.add_argument("--preview", action="store_true",
                    help="After analyzing --file, immediately render SVG")
    ap.add_argument("--dxf",     action="store_true",
                    help="After analyzing --file, immediately export DXF")
    ap.add_argument("--model",   default="claude-opus-4-8",
                    help="Claude model to use (default: claude-opus-4-8)")
    args = ap.parse_args()

    try:
        agent = FirooCamAgent(model=args.model)
    except EnvironmentError as e:
        print(e, file=sys.stderr)
        sys.exit(1)

    print("FIROO CAM AI Agent")
    print(f"Model: {args.model}")
    print("Type 'exit' or Ctrl-C to quit.\n")

    # If a file was given on the CLI, process it first
    if args.file:
        starter = f"Please analyze this GHX file: {args.file}"
        if args.preview:
            starter += " Then render an SVG preview."
        if args.dxf:
            starter += " Then export a DXF file."
        print(f"You: {starter}")
        reply = agent.chat(starter)
        print(f"\nAgent: {reply}\n")

    # Interactive loop
    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye.")
            break

        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit", "bye"):
            print("Bye.")
            break
        if user_input.lower() == "reset":
            agent.reset()
            print("Conversation reset.\n")
            continue

        reply = agent.chat(user_input)
        print(f"\nAgent: {reply}\n")


if __name__ == "__main__":
    main()

"""
FIROO CAM — GHX Analyzer  (Stage 1)
====================================
Reads a Grasshopper .ghx file and produces:
  • ghx_analysis_report.json
  • ghx_analysis_report.md

Usage:
    python ghx_analyzer.py  path/to/file.ghx
    python ghx_analyzer.py  path/to/file.ghx  --out my_report

Requires only Python 3.8+ standard library.
"""

from __future__ import annotations
import sys
import re
import json
import math
import argparse
import xml.etree.ElementTree as ET
from pathlib import Path
from collections import defaultdict, Counter
from typing import Any, Dict, List, Optional, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# COMPONENT TYPE REGISTRY
# Maps known Grasshopper component GUIDs  →  human-readable family name.
# This is the most reliable way to identify components in a .ghx file because
# the component's "GUID" item (top-level, not InstanceGuid) is the type GUID.
# ─────────────────────────────────────────────────────────────────────────────
COMPONENT_GUID_MAP: Dict[str, str] = {
    # ── Params / Primitives ──────────────────────────────────────────────────
    "57da07bd-ecab-415d-9d86-af36d7073abc": "Number Slider",
    "a8b97322-2d53-47cd-905e-b932c3ccd74e": "Button",
    "d60527f5-b5af-4ef6-8970-5f96fe412429": "Panel",
    "2e78987b-9dfb-42a2-8b76-3923ac8bd91b": "Number Param",
    "f9a10b6e-f79e-40bf-98bf-6a9b01c4fd10": "Boolean Toggle",
    "c1296426-8e4d-46a8-9912-cf92dd803a1f": "Boolean Toggle",  # alt GUID seen in wild
    # ── Geometry — Curve ────────────────────────────────────────────────────
    "4b8fb87c-4b0e-4e3e-9096-2e23a8b27ab8": "Rectangle",
    "2f66d2c9-3c5b-40d1-a1cf-4b0d67e75f77": "Rectangle",
    "bc3cc33b-a08d-4b97-9a01-3fe80fdef2de": "Offset Curve",
    "13f57c1d-4b8d-46df-8174-c5a8c5b3f6bc": "Offset Curve",
    "4358d1c7-03d8-489c-8a26-a1d9e73e8da3": "Offset Surface",
    "63da88b8-c57e-4a61-ae35-c6eb3e8daf34": "Move",
    "8297d90e-f333-4b39-870e-8d4dc2fc748b": "Mirror",
    "5e9b3e62-5461-46e8-9b11-5a1b3ea76a48": "Rotate",
    "3d8f6f71-3b14-4d83-be03-1f9c020c0b07": "Scale",
    "2646825f-f279-4dda-9e18-d44ea93e2bd9": "Line",
    "3b46b84a-f0b1-4c95-8fcb-adabc5b2f97a": "Polyline",
    "ea3d99ac-d60a-4e1e-a07b-cac84d0b1d09": "Interpolate Curve",
    "fb60e937-9f56-4f6d-ab74-0bc7a11a4ed5": "Divide Curve",
    "be6bc3f9-a49a-4b22-bbff-27bf5ef56d14": "Arc",
    "d5967b9f-e8ee-436b-a8ad-29fdcecf32d5": "Arc 3Pt",
    "6858c2e0-7695-11e4-b4a9-0800200c9a66": "Fillet",
    "10bc86a3-1d9f-4bd2-9a96-b8bcea61c8e7": "Construct Point",
    "c8f0f5e8-f32f-4b3b-92b3-3b8e1b0e3c1d": "Point",
    # ── Geometry — Surface / Solid ───────────────────────────────────────────
    "a8f0d6f7-4f56-4b8e-bb9a-74d2a2b3c7de": "Boundary Surface",
    "c49e6fc5-8f23-47d0-853a-e7bbe2b8e94f": "Extrude",
    "28061aae-04fb-4cb5-ac45-16f3b66bc0a4": "Center Box",
    "7b3a0f1c-5b9a-4e7d-8c6f-2a3d4e5f6789": "Box",
    # ── Math ────────────────────────────────────────────────────────────────
    "59e0b89a-e487-49f8-bab8-b5bab16be14c": "Addition",
    "0f2521b5-2be5-46c4-b862-39a0f9b43c14": "Subtraction",
    "9bf70db8-1925-498e-b8ae-f4c5fa07a93c": "Multiplication",
    "4b4a5553-c18b-4e6c-9b35-bd62467e7e5c": "Division",
    "d60527f5-b5af-4ef6-8970-5f96fe412429": "Mass Addition",
    "2e3ab970-b545-40de-b2de-0a81df2f73e8": "Dispatch",
    "7a36a51c-d7e4-4d7c-8a9b-3c2d4e5f6d7e": "Evaluate",
    "cd075de6-7b3b-4e49-88a5-1e5a81d45078": "Series",
    "2e78987b-9dfb-42a2-8b76-3923ac8bd91b": "Range",
    "45bff836-1f79-4ad6-b2d5-56a32cef7c98": "List Item",
    "73849278-7e3c-4296-8b97-ea7d0b93f851": "Entwine",
    "ce523bc5-f11b-444d-bb5e-8e861f0a5b96": "Merge",
    "ad264a9f-de3c-4db4-93de-6a5e66c24fd9": "Cull Pattern",
    "2e4b1b2e-8b8b-4b8b-8b8b-8b8b8b8b8b8b": "Gate And",
    # ── Special ─────────────────────────────────────────────────────────────
    "f31d8d7a-7536-4ac8-9c96-fde6ecda4d0a": "Cluster",
    "c552a431-af5b-46a9-a8a4-0fcbc27ef596": "Group",
    "fe4a0b34-9e95-4ef8-b785-4c3d6e8b8e2f": "Graph Mapper",
}

# Patterns for slider name  →  door parameter category
SLIDER_CATEGORY_RULES: List[Tuple[re.Pattern, str]] = [
    (re.compile(r'^(W|Width|X|width)$',          re.I), "door_width"),
    (re.compile(r'^(H|Height|Y|height)$',         re.I), "door_height"),
    (re.compile(r'^(Z|Thick|Thickness|Depth)$',   re.I), "thickness"),
    (re.compile(r'^(OF|Offset)\s*(\d+)$',         re.I), "offset"),
    (re.compile(r'^(FrameOffset|Frame_Offset)$',  re.I), "offset"),
    (re.compile(r'^(R|Radius|radius)$',           re.I), "radius"),
    (re.compile(r'^(Rows|rows|Row)$',             re.I), "grid_rows"),
    (re.compile(r'^(Cols?|Columns?)$',            re.I), "grid_cols"),
    (re.compile(r'^(CircleDia|Dia|Diameter)$',    re.I), "circle_diameter"),
    (re.compile(r'^(FrameThick|Frame)$',          re.I), "frame_thickness"),
    (re.compile(r'^(Gap|Space|Spacing)$',         re.I), "spacing"),
    (re.compile(r'^(Dist|Distance|distance)$',    re.I), "spacing"),
    (re.compile(r'^(Angle|angle)$',               re.I), "angle"),
    (re.compile(r'^(Scale|scale)$',               re.I), "scale"),
    (re.compile(r'^(Pattern|Pat|pattern)$',       re.I), "pattern"),
    (re.compile(r'^(IF|if)$',                     re.I), "conditional"),
]

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _get_item(element: ET.Element, name: str, default: str = "") -> str:
    """Safely get a named <item> text value from an XML element."""
    item = element.find(f'.//item[@name="{name}"]')
    if item is not None and item.text:
        return item.text.strip()
    return default


def _safe_float(value: str, default: float = 0.0) -> float:
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def _natural_sort_key(s: str) -> List[Any]:
    """Sort key that handles 'OF1','OF2','OF10' correctly."""
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', s)]


def _categorize_slider(name: str, nick: str) -> str:
    label = nick or name
    for pattern, category in SLIDER_CATEGORY_RULES:
        if pattern.match(label):
            return category
    return "unknown"


def _offset_index(name: str) -> Optional[int]:
    """Return the numeric index if name looks like OF1, Offset2, etc. Else None."""
    m = re.match(r'^(?:OF|Offset|offset)\s*(\d+)$', name, re.I)
    return int(m.group(1)) if m else None

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 1 — XML PARSER
# ─────────────────────────────────────────────────────────────────────────────

class GHXParser:
    """
    Low-level XML reader for .ghx files.
    Produces a flat list of raw 'object dicts' without interpretation.
    """

    def __init__(self, filepath: str | Path):
        self.filepath = Path(filepath)
        self._tree: Optional[ET.ElementTree] = None
        self._root: Optional[ET.Element] = None
        self.raw_objects: List[Dict[str, Any]] = []

    def parse(self) -> "GHXParser":
        # GHX files may have a UTF-8 BOM; ElementTree handles that fine.
        self._tree = ET.parse(self.filepath)
        self._root = self._tree.getroot()
        self._extract_objects()
        return self

    def _extract_objects(self) -> None:
        """
        In a .ghx file all components live inside:
          Root > chunks > chunk[Definition] > chunks > chunk[DefinitionObjects]
                        > chunks > chunk[Object] × N
        """
        def_objs = self._root.find('.//chunk[@name="DefinitionObjects"]')
        if def_objs is None:
            return

        chunks = def_objs.find('chunks')
        if chunks is None:
            return

        for obj_chunk in chunks.findall('chunk[@name="Object"]'):
            self.raw_objects.append(self._parse_object(obj_chunk))

    def _parse_object(self, obj_chunk: ET.Element) -> Dict[str, Any]:
        """
        Parse one <chunk name="Object"> into a normalised dict.

        Key fields:
          type_guid      — the component CLASS guid (identifies what it is)
          instance_guid  — the instance id (unique per object on the canvas)
          name           — component type name (e.g. "Number Slider")
          nickname       — user-assigned label (e.g. "OF1", "Width")
          description    — component description string
          slider         — dict with value/min/max if this is a slider
          sources        — list of (source_instance_guid, source_param_name)
          inputs         — list of InputParam dicts
          outputs        — list of OutputParam dicts
          raw            — the raw XML element (for anything we missed)
        """
        result: Dict[str, Any] = {
            "type_guid": "",
            "instance_guid": "",
            "name": "",
            "nickname": "",
            "description": "",
            "slider": None,
            "sources": [],
            "inputs": [],
            "outputs": [],
            "position": {"x": 0.0, "y": 0.0},
        }

        # ── Type GUID lives directly in <Object><items><item name="GUID"> ──
        top_items = obj_chunk.find('items')
        if top_items is not None:
            result["type_guid"] = _get_item(top_items, "GUID")

        # ── Container chunk holds instance identity + metadata ──────────────
        container = obj_chunk.find('.//chunk[@name="Container"]')
        if container is not None:
            result["instance_guid"] = _get_item(container, "InstanceGuid")
            result["name"]          = _get_item(container, "Name")
            result["nickname"]      = _get_item(container, "NickName")
            result["description"]   = _get_item(container, "Description")

            # Position (canvas X/Y — useful for understanding flow direction)
            attrs = container.find('.//chunk[@name="Attributes"]')
            if attrs is not None:
                pivot = attrs.find('.//chunk[@name="Pivot"]')
                if pivot is not None:
                    result["position"]["x"] = _safe_float(_get_item(pivot, "X"))
                    result["position"]["y"] = _safe_float(_get_item(pivot, "Y"))

            # ── Slider-specific data ─────────────────────────────────────────
            slider_chunk = container.find('.//chunk[@name="Slider"]')
            if slider_chunk is not None:
                result["slider"] = {
                    "value":  _safe_float(_get_item(slider_chunk, "Value")),
                    "min":    _safe_float(_get_item(slider_chunk, "Min")),
                    "max":    _safe_float(_get_item(slider_chunk, "Max")),
                    "digits": int(_safe_float(_get_item(slider_chunk, "Digits"), 3)),
                }

            # Fallback: some older GHX versions store slider data flat in Container
            if result["slider"] is None and result["name"] == "Number Slider":
                val = _get_item(container, "Value")
                mn  = _get_item(container, "Min")
                mx  = _get_item(container, "Max")
                if val:
                    result["slider"] = {
                        "value":  _safe_float(val),
                        "min":    _safe_float(mn),
                        "max":    _safe_float(mx),
                        "digits": 3,
                    }

            # ── ParameterData — inputs and their sources ─────────────────────
            param_data = container.find('.//chunk[@name="ParameterData"]')
            if param_data is not None:
                for inp in param_data.findall('.//chunk[@name="InputParam"]'):
                    inp_dict = {
                        "id":       _get_item(inp, "InstanceGuid"),
                        "name":     _get_item(inp, "Name"),
                        "nickname": _get_item(inp, "NickName"),
                        "sources":  [],
                    }
                    # Multiple sources possible (wired connections)
                    for src in inp.findall('.//item[@name="Source"]'):
                        if src.text:
                            inp_dict["sources"].append(src.text.strip())
                    result["inputs"].append(inp_dict)
                    result["sources"].extend(inp_dict["sources"])

                for out in param_data.findall('.//chunk[@name="OutputParam"]'):
                    result["outputs"].append({
                        "id":       _get_item(out, "InstanceGuid"),
                        "name":     _get_item(out, "Name"),
                        "nickname": _get_item(out, "NickName"),
                    })

        # ── Fallback for objects that store Name outside Container ───────────
        # (seen in Group, Panel, older versions)
        if not result["name"]:
            result["name"] = _get_item(obj_chunk, "Name")
        if not result["nickname"]:
            result["nickname"] = _get_item(obj_chunk, "NickName")

        # ── Resolve component type name from GUID if name is empty ──────────
        if result["type_guid"] and not result["name"]:
            result["name"] = COMPONENT_GUID_MAP.get(result["type_guid"], "Unknown")

        return result


# ─────────────────────────────────────────────────────────────────────────────
# STAGE 2 — SEMANTIC ANALYZERS
# ─────────────────────────────────────────────────────────────────────────────

class SliderAnalyzer:
    """
    Classifies all Number Slider objects into door parameter categories.

    When a slider has no custom nickname (still called 'Number Slider'),
    we look at WHAT IT CONNECTS TO — if it feeds a Cluster input named 'OF1',
    we inherit that name. This covers files where the designer never renamed
    the sliders in Grasshopper.
    """

    def __init__(self, raw_objects: List[Dict]):
        self.raw_objects = raw_objects
        # Build: slider_instance_guid → list of (target_component_nick, input_pin_name)
        self._wire_targets: Dict[str, List[Tuple[str, str]]] = defaultdict(list)
        self._build_wire_map()

    def _build_wire_map(self) -> None:
        """
        For every component, look at its inputs and record
        slider_guid → [(component_nick, input_pin_name), ...]
        """
        slider_guids = {
            obj["instance_guid"]
            for obj in self.raw_objects
            if obj["name"] == "Number Slider"
        }
        for obj in self.raw_objects:
            for inp in obj["inputs"]:
                for src in inp["sources"]:
                    if src in slider_guids:
                        self._wire_targets[src].append(
                            (obj["nickname"] or obj["name"], inp["name"])
                        )

    def _infer_name_from_wiring(self, instance_guid: str) -> Optional[str]:
        """
        If slider connects to a recognisable pin (OF1, Width, H, etc.)
        return that pin name as the inferred label.
        """
        targets = self._wire_targets.get(instance_guid, [])
        for _comp_nick, pin_name in targets:
            if pin_name and pin_name not in ("", "x", "y", "z", "Number"):
                return pin_name
        return None

    def analyze(self) -> List[Dict]:
        results = []
        for obj in self.raw_objects:
            if obj["name"] != "Number Slider" or obj["slider"] is None:
                continue
            nick = obj["nickname"] or obj["name"]
            # If nickname is still the default, try to infer from wiring
            if nick in ("Number Slider", ""):
                inferred = self._infer_name_from_wiring(obj["instance_guid"])
                if inferred:
                    nick = inferred
            category = _categorize_slider(obj["name"], nick)
            s = obj["slider"]
            results.append({
                "instance_guid": obj["instance_guid"],
                "name": nick,
                "raw_name": obj["name"],
                "value": s["value"],
                "min": s["min"],
                "max": s["max"],
                "digits": s["digits"],
                "category": category,
                "unit_guess": self._guess_unit(nick, s),
                "is_door_param": category != "unknown",
                "position": obj["position"],
            })
        # Sort: door params first, then by canvas X position (left→right)
        results.sort(key=lambda x: (0 if x["is_door_param"] else 1, x["position"]["x"]))
        return results

    @staticmethod
    def _guess_unit(name: str, s: Dict) -> str:
        if re.search(r'angle|Angle|deg', name, re.I):
            return "degrees"
        if re.search(r'scale|Scale', name, re.I):
            return "factor"
        if s["max"] <= 360 and s["min"] >= -360 and re.search(r'rot|angle', name, re.I):
            return "degrees"
        return "mm"


class OffsetAnalyzer:
    """
    Detects OF1..OFN style sliders and guesses whether the design uses
    cumulative (additive) offsets or absolute offsets from the door edge.

    Heuristic:
      - If all values are small and roughly equal  → more likely STEP values
        (user thinks in increments: OF1=50, OF2=12, OF3=7)
      - If values are increasing monotonically       → more likely ABSOLUTE
        (user thinks in total distances from edge)
      - Confidence is low when we only have 1–2 sliders or values are ambiguous.
    """

    def __init__(self, sliders: List[Dict]):
        self.sliders = sliders

    def analyze(self) -> Dict:
        # Extract offset sliders, sorted naturally
        offsets = [s for s in self.sliders if s["category"] == "offset"]
        offsets.sort(key=lambda x: _natural_sort_key(x["name"]))

        if not offsets:
            return {"found_offsets": [], "offset_mode_guess": "none",
                    "confidence": 0.0, "computed_example": [], "reasoning": "No offset sliders found."}

        values = [o["value"] for o in offsets]
        names  = [o["name"]  for o in offsets]

        # Compute cumulative totals
        cumulative = []
        total = 0.0
        for v in values:
            total += v
            cumulative.append(round(total, 4))

        # Compute absolute totals (treat each value as-is from edge)
        absolute = list(values)

        # ── Decide: cumulative vs absolute ──────────────────────────────────
        # Evidence for CUMULATIVE:
        #   1. Values are NOT monotonically increasing (they fluctuate — they're steps)
        #   2. Max individual value << door width (they're increments, not totals)
        #   3. Multiple small-ish values

        is_monotone = all(a <= b for a, b in zip(values, values[1:]))
        max_val = max(values) if values else 0
        non_zero = [v for v in values if v > 0]

        if len(non_zero) <= 1:
            mode = "cumulative"
            confidence = 0.4
            reasoning = "Only one active offset — cannot distinguish cumulative from absolute."
        elif is_monotone and max_val > 100:
            mode = "absolute"
            confidence = 0.70
            reasoning = (
                "Values increase monotonically and are large — "
                "likely total distances from edge (absolute)."
            )
        else:
            mode = "cumulative"
            confidence = 0.80 if not is_monotone else 0.55
            reasoning = (
                "Values appear to be step increments (not strictly increasing). "
                "Likely cumulative addition model."
            )

        # Build the example table
        example = []
        cum = 0.0
        for o in offsets:
            cum += o["value"]
            example.append({
                "name":  o["name"],
                "step":  o["value"],
                "total": round(cum, 3),
                "min":   o["min"],
                "max":   o["max"],
            })

        return {
            "found_offsets":     names,
            "offset_mode_guess": mode,
            "confidence":        confidence,
            "computed_example":  example,
            "reasoning":         reasoning,
        }


class ComponentInventory:
    """Counts and classifies all components in the file."""

    def __init__(self, raw_objects: List[Dict]):
        self.raw_objects = raw_objects

    def analyze(self) -> List[Dict]:
        counter: Counter = Counter()
        for obj in self.raw_objects:
            # Resolve via GUID first, then fall back to Name
            resolved = COMPONENT_GUID_MAP.get(obj["type_guid"], obj["name"] or "Unknown")
            counter[resolved] += 1

        return [{"type": k, "count": v}
                for k, v in sorted(counter.items(), key=lambda x: -x[1])]


class ConnectionGraphBuilder:
    """
    Builds a node/edge graph from InstanceGuid cross-references.

    Each component outputs to (possibly many) InputParams on other components.
    The Source items inside InputParam chunks reference the InstanceGuid of the
    upstream component's OUTPUT parameter.

    Since GHX wires connect output-param-GUID → input-param-GUID, we need to:
    1. Build a map: output_param_guid → owner_instance_guid
    2. For each InputParam that has a Source, trace it back.
    """

    def __init__(self, raw_objects: List[Dict]):
        self.raw_objects = raw_objects

    def build(self) -> Tuple[List[Dict], List[Dict]]:
        # ── Build output-param GUID → component instance GUID ───────────────
        out_param_to_owner: Dict[str, str] = {}
        for obj in self.raw_objects:
            for out in obj["outputs"]:
                if out["id"]:
                    out_param_to_owner[out["id"]] = obj["instance_guid"]
            # Sliders have no explicit output param chunks but their
            # instance_guid IS what downstream components wire to directly.
            if obj["name"] == "Number Slider":
                out_param_to_owner[obj["instance_guid"]] = obj["instance_guid"]

        # ── Build instance GUID → component metadata ─────────────────────────
        inst_meta: Dict[str, Dict] = {}
        for obj in self.raw_objects:
            resolved_type = COMPONENT_GUID_MAP.get(obj["type_guid"], obj["name"] or "Unknown")
            inst_meta[obj["instance_guid"]] = {
                "nickname": obj["nickname"] or obj["name"],
                "type":     resolved_type,
            }

        # ── Build nodes ───────────────────────────────────────────────────────
        nodes: List[Dict] = []
        for obj in self.raw_objects:
            resolved_type = COMPONENT_GUID_MAP.get(obj["type_guid"], obj["name"] or "Unknown")
            node: Dict[str, Any] = {
                "id":             obj["instance_guid"],
                "nickname":       obj["nickname"] or obj["name"],
                "component_type": resolved_type,
                "position":       obj["position"],
                "parameters":     {},
            }
            if obj["slider"]:
                node["parameters"] = {
                    "value": obj["slider"]["value"],
                    "min":   obj["slider"]["min"],
                    "max":   obj["slider"]["max"],
                }
            nodes.append(node)

        # ── Build edges ───────────────────────────────────────────────────────
        edges: List[Dict] = []
        seen_edges: set = set()
        for obj in self.raw_objects:
            target_id = obj["instance_guid"]
            for inp in obj["inputs"]:
                for src_guid in inp["sources"]:
                    owner_id = out_param_to_owner.get(src_guid, src_guid)
                    edge_key = (owner_id, target_id, inp["name"])
                    if edge_key in seen_edges:
                        continue
                    seen_edges.add(edge_key)
                    src_meta = inst_meta.get(owner_id, {})
                    edges.append({
                        "source":        owner_id,
                        "source_nick":   src_meta.get("nickname", "?"),
                        "source_type":   src_meta.get("type", "?"),
                        "source_output": src_guid,
                        "target":        target_id,
                        "target_nick":   obj["nickname"] or obj["name"],
                        "target_input":  inp["name"],
                    })

        return nodes, edges


class DesignTypeDetector:
    """
    Guesses the door design type from sliders + components.

    Rules (in priority order):
      1. Offset sliders (OF1..OF10) + Rectangle             → frame_door_cumulative_offsets
      2. Rows + Columns + Rectangle                         → vitrine_grid
      3. Circle/Diameter slider + Rectangle                 → vitrine_circle_center
      4. Arc components + Frame/Radius sliders              → vitrine_arched
      5. Mirror/Bezier/Curve + no obvious grid              → curved_pattern
      6. Fallback                                           → unknown
    """

    def __init__(self, sliders: List[Dict], inventory: List[Dict], offset_result: Dict):
        self.sliders   = sliders
        self.inventory = inventory
        self.offset_r  = offset_result
        self._comp_types = {c["type"] for c in inventory}

    def detect(self) -> Dict:
        cats = Counter(s["category"] for s in self.sliders)
        scores: Dict[str, float] = defaultdict(float)

        # ── Evidence collection ───────────────────────────────────────────────
        n_offsets  = cats["offset"]
        has_rect   = "Rectangle" in self._comp_types
        has_arc    = "Arc" in self._comp_types or "Arc 3Pt" in self._comp_types
        has_circle = cats["circle_diameter"] > 0
        has_grid   = cats["grid_rows"] > 0 or cats["grid_cols"] > 0
        has_mirror = "Mirror" in self._comp_types
        has_curve  = "Interpolate Curve" in self._comp_types or "Polyline" in self._comp_types
        has_series = "Series" in self._comp_types
        has_cluster = "Cluster" in self._comp_types
        has_width  = cats["door_width"] > 0
        has_height = cats["door_height"] > 0

        # frame_door_cumulative_offsets
        if n_offsets >= 2:
            scores["frame_door_cumulative_offsets"] += 0.6
        if n_offsets >= 1 and has_rect:
            scores["frame_door_cumulative_offsets"] += 0.3
        if has_width and has_height:
            scores["frame_door_cumulative_offsets"] += 0.1

        # vitrine_grid
        if has_grid:
            scores["vitrine_grid"] += 0.5
        if has_series:
            scores["vitrine_grid"] += 0.2
        if has_grid and has_rect:
            scores["vitrine_grid"] += 0.3

        # vitrine_circle_center
        if has_circle:
            scores["vitrine_circle_center"] += 0.6
        if has_circle and has_rect:
            scores["vitrine_circle_center"] += 0.3

        # vitrine_arched
        if has_arc:
            scores["vitrine_arched"] += 0.5
        if has_arc and n_offsets >= 1:
            scores["vitrine_arched"] += 0.3

        # curved_pattern
        if has_mirror and has_curve:
            scores["curved_pattern"] += 0.5
        if has_cluster:
            scores["curved_pattern"] += 0.1
            scores["frame_door_cumulative_offsets"] += 0.1

        if not scores:
            best_type, best_score = "unknown", 0.0
        else:
            best_type  = max(scores, key=lambda k: scores[k])
            best_score = scores[best_type]
            # Normalise: cap at 1.0
            best_score = min(best_score, 1.0)

        return {
            "detected_design_type": best_type,
            "confidence":           round(best_score, 2),
            "all_scores":           {k: round(v, 2) for k, v in sorted(scores.items(), key=lambda x: -x[1])},
            "evidence": {
                "offset_sliders":   n_offsets,
                "has_rectangle":    has_rect,
                "has_arc":          has_arc,
                "has_circle":       has_circle,
                "has_grid":         has_grid,
                "has_mirror":       has_mirror,
                "has_cluster":      has_cluster,
                "has_series":       has_series,
            },
        }


class ConversionAdvisor:
    """
    Based on design type and component inventory, suggests Python functions
    and FIROO CAM rule types needed for Stage 2 conversion.
    """

    FUNCTION_MAP: Dict[str, List[str]] = {
        "frame_door_cumulative_offsets": [
            "create_door_rectangle(W, H)",
            "cumulative_offsets(steps: List[float])",
            "offset_rectangle(rect, amount)",
            "generate_offset_rings(rect, offsets)",
        ],
        "vitrine_grid": [
            "create_door_rectangle(W, H)",
            "create_grid_openings(rect, rows, cols, gap)",
            "subtract_openings(door_outline, openings)",
        ],
        "vitrine_circle_center": [
            "create_door_rectangle(W, H)",
            "create_circle(cx, cy, radius)",
            "offset_rectangle(rect, frame_thickness)",
        ],
        "vitrine_arched": [
            "create_door_rectangle(W, H)",
            "create_arch(cx, cy, radius, start_angle, end_angle)",
            "combine_rect_arch(rect, arch)",
            "offset_outline(shape, amount)",
        ],
        "curved_pattern": [
            "create_door_rectangle(W, H)",
            "create_curve(points)",
            "mirror_curve(curve, axis)",
            "offset_curve(curve, distance)",
        ],
        "unknown": [
            "create_door_rectangle(W, H)",
        ],
    }

    RULE_MAP: Dict[str, str] = {
        "frame_door_cumulative_offsets": "frame_door",
        "vitrine_grid":                 "vitrine_grid",
        "vitrine_circle_center":        "vitrine_circle",
        "vitrine_arched":               "vitrine_arch",
        "curved_pattern":               "curved_pattern",
        "unknown":                      "custom",
    }

    def __init__(self, design_type: str, inventory: List[Dict], sliders: List[Dict]):
        self.design_type = design_type
        self.inventory   = inventory
        self.sliders     = sliders

    def advise(self) -> Dict:
        funcs = self.FUNCTION_MAP.get(self.design_type,
                self.FUNCTION_MAP["unknown"])[:]

        warnings: List[str] = []
        comp_types = {c["type"] for c in self.inventory}

        # Add extra functions for detected components
        if "Mirror" in comp_types:
            funcs.append("mirror_geometry(shape, plane)")
        if "Move" in comp_types:
            funcs.append("translate_geometry(shape, vector)")
        if "Rotate" in comp_types:
            funcs.append("rotate_geometry(shape, angle, center)")
        if "Series" in comp_types:
            funcs.append("series(start, step, count)")
        if "Cluster" in comp_types:
            warnings.append(
                "File contains a Cluster. Internal logic is NOT exported in "
                ".ghx — you must open Grasshopper, Explode the Cluster, and "
                "screenshot the internal wiring to understand its logic."
            )
        if "Graph Mapper" in comp_types:
            warnings.append(
                "Graph Mapper found — curve shape function must be manually "
                "recorded from Grasshopper."
            )

        # Warn about unrecognised component GUIDs
        unknown_objs = [
            obj for obj in self.inventory if obj["type"] == "Unknown"
        ]
        if unknown_objs:
            warnings.append(
                f"{sum(o['count'] for o in unknown_objs)} component(s) have "
                "unrecognised GUIDs. They may be third-party plugins. "
                "Verify in Grasshopper."
            )

        return {
            "python_functions_needed":       list(dict.fromkeys(funcs)),  # dedupe
            "recommended_firoo_rule_type":   self.RULE_MAP.get(self.design_type, "custom"),
            "warnings":                      warnings,
            "manual_verification_required":  [
                "Confirm slider nicknames match the visual labels in Grasshopper",
                "Verify offset mode (cumulative vs absolute) by changing one slider and observing geometry",
                "Check any Cluster contents by Exploding in Grasshopper",
                "Confirm door dimensions match W/H slider values",
            ],
        }


# ─────────────────────────────────────────────────────────────────────────────
# STAGE 3 — REPORT GENERATORS
# ─────────────────────────────────────────────────────────────────────────────

def build_json_report(filepath: Path, parser: GHXParser,
                       sliders: List[Dict], offset_result: Dict,
                       inventory: List[Dict], nodes: List[Dict],
                       edges: List[Dict], design_result: Dict,
                       advice: Dict) -> Dict:

    total_sliders    = sum(1 for o in parser.raw_objects if o["name"] == "Number Slider")
    total_components = len(parser.raw_objects)

    # Parameters section: only the classified sliders
    parameters = []
    for s in sliders:
        parameters.append({
            "name":        s["name"],
            "value":       s["value"],
            "min":         s["min"],
            "max":         s["max"],
            "category":    s["category"],
            "unit_guess":  s["unit_guess"],
            "is_door_param": s["is_door_param"],
        })

    return {
        "file": filepath.name,
        "summary": {
            "total_objects":        total_components,
            "total_sliders":        total_sliders,
            "total_components":     total_components,
            "detected_design_type": design_result["detected_design_type"],
            "confidence":           design_result["confidence"],
        },
        "parameters":         parameters,
        "offset_analysis":    offset_result,
        "design_detection":   design_result,
        "components":         inventory,
        "nodes":              nodes,
        "edges":              edges,
        "conversion_suggestions": advice,
    }


def build_markdown_report(report: Dict) -> str:
    s   = report["summary"]
    off = report["offset_analysis"]
    det = report["design_detection"]
    adv = report["conversion_suggestions"]

    lines: List[str] = []

    def h(n: int, text: str):  lines.append(f"{'#' * n} {text}")
    def p(text: str = ""):     lines.append(text)
    def li(text: str):         lines.append(f"- {text}")
    def code(text: str):       lines.append(f"```\n{text}\n```")

    # ── Header ───────────────────────────────────────────────────────────────
    h(1, f"GHX Analysis Report — `{report['file']}`")
    p()

    # ── Summary ──────────────────────────────────────────────────────────────
    h(2, "Summary")
    p(f"| Field | Value |")
    p(f"|-------|-------|")
    p(f"| File | `{report['file']}` |")
    p(f"| Total objects | {s['total_objects']} |")
    p(f"| Number Sliders | {s['total_sliders']} |")
    p(f"| Detected design type | **{s['detected_design_type']}** |")
    p(f"| Detection confidence | {s['confidence']:.0%} |")
    p()

    # ── Sliders ──────────────────────────────────────────────────────────────
    h(2, "Detected Parameters (Sliders)")
    door_params = [x for x in report["parameters"] if x["is_door_param"]]
    other_params = [x for x in report["parameters"] if not x["is_door_param"]]

    if door_params:
        h(3, "Door Parameters")
        p("| Name | Value | Min | Max | Category | Unit |")
        p("|------|-------|-----|-----|----------|------|")
        for pr in door_params:
            p(f"| `{pr['name']}` | **{pr['value']}** | {pr['min']} | {pr['max']} "
              f"| {pr['category']} | {pr['unit_guess']} |")
        p()

    if other_params:
        h(3, "Other Sliders")
        p("| Name | Value | Min | Max |")
        p("|------|-------|-----|-----|")
        for pr in other_params:
            p(f"| `{pr['name']}` | {pr['value']} | {pr['min']} | {pr['max']} |")
        p()

    # ── Offset Analysis ───────────────────────────────────────────────────────
    h(2, "Offset Analysis")
    if off["found_offsets"]:
        p(f"**Found offsets:** {', '.join(f'`{n}`' for n in off['found_offsets'])}")
        p()
        p(f"**Mode guess:** `{off['offset_mode_guess']}` "
          f"(confidence: {off['confidence']:.0%})")
        p()
        p(f"**Reasoning:** {off['reasoning']}")
        p()
        if off["computed_example"]:
            h(3, "Computed Example (assuming cumulative)")
            p("| Slider | Step (mm) | Cumulative Total (mm) |")
            p("|--------|-----------|----------------------|")
            for ex in off["computed_example"]:
                p(f"| `{ex['name']}` | {ex['step']} | **{ex['total']}** |")
            p()
    else:
        p("No offset sliders detected.")
        p()

    # ── Component Inventory ───────────────────────────────────────────────────
    h(2, "Component Inventory")
    p("| Component Type | Count |")
    p("|----------------|-------|")
    for comp in report["components"]:
        p(f"| {comp['type']} | {comp['count']} |")
    p()

    # ── Design Detection ──────────────────────────────────────────────────────
    h(2, "Design Type Detection")
    p(f"**Best guess:** `{det['detected_design_type']}` — confidence {det['confidence']:.0%}")
    p()
    if det.get("all_scores"):
        h(3, "All scores")
        for dtype, score in det["all_scores"].items():
            bar = "█" * int(score * 10)
            p(f"- `{dtype}`: {score:.0%}  {bar}")
        p()
    ev = det.get("evidence", {})
    if ev:
        h(3, "Evidence found")
        for k, v in ev.items():
            p(f"- {k}: `{v}`")
        p()

    # ── Connection Graph (summary) ────────────────────────────────────────────
    h(2, "Connection Graph")
    p(f"- **Nodes:** {len(report['nodes'])}")
    p(f"- **Edges:** {len(report['edges'])}")
    p()
    if report["edges"]:
        h(3, "Wiring (first 30 connections)")
        p("| From | → | To | Input Pin |")
        p("|------|---|-----|-----------|")
        for edge in report["edges"][:30]:
            p(f"| `{edge['source_nick']}` ({edge['source_type']}) | → "
              f"| `{edge['target_nick']}` | `{edge['target_input']}` |")
        if len(report["edges"]) > 30:
            p(f"\n_...and {len(report['edges']) - 30} more edges — see JSON report._")
        p()

    # ── Conversion Suggestions ────────────────────────────────────────────────
    h(2, "Conversion Suggestions")
    p(f"**Recommended FIROO CAM rule type:** `{adv['recommended_firoo_rule_type']}`")
    p()
    h(3, "Python functions needed (Stage 2)")
    for fn in adv["python_functions_needed"]:
        li(f"`{fn}`")
    p()

    if adv["warnings"]:
        h(3, "⚠ Warnings")
        for w in adv["warnings"]:
            li(w)
        p()

    h(3, "Manual verification required")
    for v in adv["manual_verification_required"]:
        li(v)
    p()

    # ── Footer ────────────────────────────────────────────────────────────────
    h(2, "Notes")
    p("> **Stage 1 — Analysis only.** No geometry has been converted yet.")
    p("> The offset mode and design type are heuristic estimates.")
    p("> Cluster internal logic cannot be extracted from .ghx alone —")
    p("> you must Explode the Cluster in Grasshopper and provide screenshots.")
    p()
    p("_Generated by FIROO CAM GHX Analyzer v1.0_")

    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(
        description="FIROO CAM — GHX Analyzer (Stage 1)"
    )
    ap.add_argument("ghx_file", help="Path to the .ghx file")
    ap.add_argument("--out", default=None,
                    help="Base output name (default: ghx_analysis_report)")
    args = ap.parse_args()

    ghx_path = Path(args.ghx_file).resolve()
    if not ghx_path.exists():
        print(f"ERROR: file not found: {ghx_path}", file=sys.stderr)
        sys.exit(1)

    out_base = Path(args.out) if args.out else ghx_path.parent / "ghx_analysis_report"

    print(f"[GHX Analyzer]  Reading: {ghx_path.name}")

    # ── Parse ─────────────────────────────────────────────────────────────────
    parser = GHXParser(ghx_path)
    parser.parse()
    print(f"  Objects found: {len(parser.raw_objects)}")

    # ── Analyze ───────────────────────────────────────────────────────────────
    sliders       = SliderAnalyzer(parser.raw_objects).analyze()
    offset_result = OffsetAnalyzer(sliders).analyze()
    inventory     = ComponentInventory(parser.raw_objects).analyze()
    nodes, edges  = ConnectionGraphBuilder(parser.raw_objects).build()
    design_result = DesignTypeDetector(sliders, inventory, offset_result).detect()
    advice        = ConversionAdvisor(
        design_result["detected_design_type"], inventory, sliders
    ).advise()

    # ── Build reports ─────────────────────────────────────────────────────────
    json_report = build_json_report(
        ghx_path, parser, sliders, offset_result,
        inventory, nodes, edges, design_result, advice
    )
    md_report = build_markdown_report(json_report)

    # ── Write output ──────────────────────────────────────────────────────────
    json_path = out_base.with_suffix(".json")
    md_path   = out_base.with_suffix(".md")

    json_path.write_text(
        json.dumps(json_report, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )
    md_path.write_text(md_report, encoding="utf-8")

    # ── Console summary ───────────────────────────────────────────────────────
    print()
    print(f"  Design type : {design_result['detected_design_type']}  "
          f"(confidence: {design_result['confidence']:.0%})")
    print(f"  Sliders     : {len(sliders)}")
    print(f"  Offsets     : {len(offset_result['found_offsets'])}  "
          f"({offset_result['offset_mode_guess']})")
    print(f"  Edges (wires): {len(edges)}")
    print()
    print(f"  JSON report : {json_path}")
    print(f"  MD report   : {md_path}")

    if advice["warnings"]:
        print()
        print("  WARNINGS:")
        for w in advice["warnings"]:
            print(f"    ⚠  {w}")


if __name__ == "__main__":
    main()

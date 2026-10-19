"""Domain models for the unit -> parts flow.

A :class:`UnitTemplate` is a parametric model loaded from
``catalog/models/*.json``. A :class:`UnitInstance` is the user's filled-in copy
(dimensions, counts, chosen materials, build options). The generator turns an
instance into :class:`GeneratedPart` rows, which map one-to-one to the ZINAX
ORDER_CSV_V2 export.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Optional

__all__ = ["PartSpec", "UnitTemplate", "BuildConfig", "SlotMaterial",
           "UnitInstance", "GeneratedPart"]


@dataclass
class PartSpec:
    """One part definition inside a template. ``w``/``h``/``qty`` are formulas
    (strings) or numbers. ``slot`` picks which material (body/door/back).
    ``edges`` is "none" | "front" | "all" | dict(e1..e4)."""
    type: str
    name_fa: str = ""
    name_en: str = ""
    w: object = "0"          # -> width_mm
    h: object = "0"          # -> height_mm
    qty: object = "1"
    slot: str = "body"       # body | door | back
    grain: str = "L"         # L | W | none  (stored, does not lock rotation)
    edges: object = "none"
    groove_edge: object = "none"   # which edge holds the back groove in groove method
                                   # e.g. "edge_3"; applied only when back_method == "groove"
    product: str = "auto"    # auto | melamine | vacuum
                             # "vacuum" forces a vacuum_door row (no bands, uses design_code)


@dataclass
class UnitTemplate:
    id: str
    name_fa: str = ""
    name_en: str = ""
    category: str = "base"
    params: dict = field(default_factory=dict)      # default W/H/D/doors/shelves...
    parts: list = field(default_factory=list)       # list[PartSpec]

    @classmethod
    def from_dict(cls, d: dict) -> "UnitTemplate":
        name = d.get("name", {})
        parts = []
        for p in d.get("parts", []):
            pname = p.get("name", {})
            parts.append(PartSpec(
                type=p["type"],
                name_fa=pname.get("fa", "") if isinstance(pname, dict) else str(pname),
                name_en=pname.get("en", "") if isinstance(pname, dict) else str(pname),
                w=p.get("w", "0"),
                h=p.get("h", "0"),
                qty=p.get("qty", "1"),
                slot=p.get("slot", "body"),
                grain=p.get("grain", "L"),
                edges=p.get("edges", "none"),
                groove_edge=p.get("groove_edge", "none"),
                product=p.get("product", "auto"),
            ))
        return cls(
            id=d["id"],
            name_fa=name.get("fa", "") if isinstance(name, dict) else str(name),
            name_en=name.get("en", "") if isinstance(name, dict) else str(name),
            category=d.get("category", "base"),
            params=dict(d.get("params", {})),
            parts=parts,
        )

    @classmethod
    def load(cls, path: str) -> "UnitTemplate":
        with open(path, encoding="utf-8") as fh:
            return cls.from_dict(json.load(fh))


@dataclass
class BuildConfig:
    """Construction method and the thickness/gap constants. Seeded from the
    library's ``construction.defaults`` but editable per unit."""
    back_method: str = "groove"          # groove | staple | outside
    body_thickness_mm: float = 16.0
    door_thickness_mm: float = 18.0
    back_thickness_mm: float = 6.0
    door_gap_mm: float = 3.0
    shelf_setback_mm: float = 20.0
    groove_depth_mm: float = 8.0
    groove_setback_mm: float = 10.0
    # drawer-box clearances (defaults from the Cabinet Pro analysis; editable per shop/runner)
    drawer_box_side_clearance_mm: float = 26.0   # width lost to the runners
    drawer_box_depth_reduction_mm: float = 50.0  # box shorter than cabinet depth
    drawer_box_height_mm: float = 120.0          # melamine box side height


@dataclass
class SlotMaterial:
    """A chosen material for a slot (body/door/back): its color code + name,
    and for vacuum doors an optional design code."""
    code: str = "MEL-W"
    name: str = ""
    type: str = "melamine"
    design_code: str = ""      # used for vacuum doors (e.g. "ZV01")


@dataclass
class UnitInstance:
    template: UnitTemplate
    name: str = ""
    qty: int = 1
    params: dict = field(default_factory=dict)        # overrides template.params
    build: BuildConfig = field(default_factory=BuildConfig)
    materials: dict = field(default_factory=dict)      # slot -> SlotMaterial

    def effective_params(self) -> dict:
        p = dict(self.template.params)
        p.update(self.params or {})
        return p


@dataclass
class GeneratedPart:
    """One cut part = one ORDER_CSV_V2 row (before CSV formatting)."""
    unit_name: str
    part_type: str
    name_fa: str
    name_en: str
    width_mm: float
    height_mm: float
    quantity: int
    thickness_mm: float
    product_type: str                 # melamine | vacuum_door
    pvc_code: str = ""
    pvc_color: str = ""
    design_code: str = ""
    grain: str = "L"
    rotation: str = "Y"
    edge_1: str = "N"                 # bottom (|| width)
    edge_2: str = "N"                 # top    (|| width)
    edge_3: str = "N"                 # left   (|| height)
    edge_4: str = "N"                 # right  (|| height)
    note: str = ""
    formula_trace: dict = field(default_factory=dict)   # {"width": "...", "height": "...", "qty": "..."}

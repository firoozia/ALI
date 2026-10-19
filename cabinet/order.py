"""Order = several cabinet units + manual parts, exported as ONE ORDER_CSV_V2
with continuous line numbers.

A :class:`ManualPart` is a single part the user types by hand (for anything
outside a template). :func:`build_order` flattens all units and manual parts
into one list of :class:`GeneratedPart`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from .generator import generate_parts
from .library import MaterialLibrary
from .models import GeneratedPart, UnitInstance

__all__ = ["ManualPart", "Order", "build_order"]


@dataclass
class ManualPart:
    name_fa: str = ""
    name_en: str = "Part"
    width_mm: float = 0.0
    height_mm: float = 0.0
    quantity: int = 1
    thickness_mm: float = 18.0
    material_code: str = "MEL-W"
    material_name: str = ""
    product_type: str = "melamine"     # melamine | vacuum_door
    design_code: str = ""
    grain: str = "none"
    rotation: str = "Y"
    edge_1: str = "N"
    edge_2: str = "N"
    edge_3: str = "N"
    edge_4: str = "N"
    note: str = ""

    def to_generated(self) -> GeneratedPart:
        is_vac = self.product_type == "vacuum_door"
        return GeneratedPart(
            unit_name="Manual",
            part_type="manual",
            name_fa=self.name_fa,
            name_en=self.name_en,
            width_mm=round(float(self.width_mm), 1),
            height_mm=round(float(self.height_mm), 1),
            quantity=int(self.quantity),
            thickness_mm=float(self.thickness_mm),
            product_type=self.product_type,
            pvc_code=self.material_code,
            pvc_color=self.material_name or self.material_code,
            design_code=self.design_code,
            grain=self.grain,
            rotation=self.rotation,
            edge_1="N" if is_vac else self.edge_1,
            edge_2="N" if is_vac else self.edge_2,
            edge_3="N" if is_vac else self.edge_3,
            edge_4="N" if is_vac else self.edge_4,
            note=self.note,
            formula_trace={"width": "manual", "height": "manual", "qty": "manual"},
        )

    def is_valid(self) -> bool:
        return self.width_mm > 0 and self.height_mm > 0 and self.quantity >= 1


@dataclass
class Order:
    order_no: str = "SO"
    customer_name: str = ""
    project_name: str = ""
    units: List[UnitInstance] = field(default_factory=list)
    manual_parts: List[ManualPart] = field(default_factory=list)


def build_order(order: Order, lib: MaterialLibrary) -> List[GeneratedPart]:
    """All parts of the order, in order: each unit's parts, then manual parts.
    Line numbers are assigned by the CSV writer in this same sequence."""
    parts: List[GeneratedPart] = []
    for unit in order.units:
        parts.extend(generate_parts(unit, lib))
    for mp in order.manual_parts:
        if not mp.is_valid():
            raise ValueError(f"manual part {mp.name_en!r}: invalid size/qty")
        parts.append(mp.to_generated())
    return parts

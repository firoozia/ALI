"""Turn a :class:`UnitInstance` into a list of :class:`GeneratedPart`.

The carcass parts and doors come from the template's part specs; the back panel
is added by the generator according to the build method (groove / staple /
outside), because that varies by workshop. Groove is the default (world
standard: a dado holding the fiber/MDF of any thickness).

Dimensions are millimetres. ``width_mm``/``height_mm`` are the ORDER (finished)
size — ZINAX subtracts the edge-band thickness itself on import, so we do NOT
pre-subtract here (we only expose :func:`cut_size` for display).
"""
from __future__ import annotations

from typing import List

from . import formula
from .library import MaterialLibrary, _band_of
from .models import BuildConfig, GeneratedPart, SlotMaterial, UnitInstance

__all__ = ["generate_parts", "cut_size", "GeneratorError", "apply_groove"]

_EDGE_NAMES = ("edge_1", "edge_2", "edge_3", "edge_4")


def apply_groove(cell: str) -> str:
    """Add a groove mark to an edge cell, in ZINAX notation.

    N -> S, P1 -> S/P1, S and S/P1 are left as-is.
    """
    band = _band_of(cell)
    if band is None:
        # cell is N / S / blank -> groove only
        return "S"
    return f"S/{band}"


class GeneratorError(ValueError):
    pass


def _vars(inst: UnitInstance) -> dict:
    p = inst.effective_params()
    b = inst.build
    v = {
        # thicknesses / gaps as short tokens used in formulas
        "t": b.body_thickness_mm,
        "bt": b.back_thickness_mm,
        "dt": b.door_thickness_mm,
        "g": b.door_gap_mm,
        "ss": b.shelf_setback_mm,
        "dg": b.groove_depth_mm,
        "s": b.groove_setback_mm,
    }
    for k, val in p.items():
        try:
            v[k] = float(val)
        except (TypeError, ValueError):
            pass  # non-numeric params are ignored as formula variables
    return v


def _slot_material(inst: UnitInstance, slot: str) -> SlotMaterial:
    m = inst.materials.get(slot)
    if m is not None:
        return m
    # fall back to body, then a plain default
    return inst.materials.get("body", SlotMaterial())


def _edges_for(spec_edges, band: str) -> dict:
    """Resolve a part spec's ``edges`` into the 4 edge cells."""
    cells = {"edge_1": "N", "edge_2": "N", "edge_3": "N", "edge_4": "N"}
    if spec_edges in (None, "none", ""):
        return cells
    if spec_edges == "all":
        return {k: band for k in cells}
    if spec_edges == "front":
        # front edge of a horizontal part = one width-parallel edge
        cells["edge_1"] = band
        return cells
    if isinstance(spec_edges, dict):
        for k in cells:
            short = k.replace("edge_", "e")
            val = spec_edges.get(k, spec_edges.get(short, "N"))
            cells[k] = band if val in ("band", "P", True, "true") else (val or "N")
        return cells
    return cells


def _groove_edges(spec_groove_edge) -> list:
    """Normalise a part spec's groove_edge into a list of edge names."""
    if spec_groove_edge in (None, "none", "", False):
        return []
    if isinstance(spec_groove_edge, str):
        return [spec_groove_edge] if spec_groove_edge in _EDGE_NAMES else []
    return [e for e in spec_groove_edge if e in _EDGE_NAMES]


def generate_parts(inst: UnitInstance, lib: MaterialLibrary) -> List[GeneratedPart]:
    tmpl = inst.template
    v = _vars(inst)
    band = lib.default_band_code() if lib.edge_bands else "P1"
    out: List[GeneratedPart] = []

    for spec in tmpl.parts:
        qty = int(round(formula.evaluate(spec.qty, v)))
        if qty <= 0:
            continue
        w = formula.evaluate(spec.w, v)
        h = formula.evaluate(spec.h, v)
        if w <= 0 or h <= 0:
            raise GeneratorError(
                f"{tmpl.id}/{spec.type}: non-positive size {w}x{h} "
                f"(w={spec.w!r}, h={spec.h!r})"
            )
        mat = _slot_material(inst, spec.slot)
        thickness = _slot_thickness(inst.build, spec.slot)
        is_vacuum = spec.slot == "door" and mat.type == "vacuum"
        product_type = "vacuum_door" if is_vacuum else "melamine"
        edges = {"edge_1": "N", "edge_2": "N", "edge_3": "N", "edge_4": "N"}
        if not is_vacuum:
            edges = _edges_for(spec.edges, band)
            # groove mark on the back-facing edge, only in the groove method
            if (inst.build.back_method or "groove").lower() == "groove":
                for ge in _groove_edges(spec.groove_edge):
                    edges[ge] = apply_groove(edges[ge])
        out.append(GeneratedPart(
            unit_name=inst.name or tmpl.name_en or tmpl.id,
            part_type=spec.type,
            name_fa=spec.name_fa,
            name_en=spec.name_en,
            width_mm=round(w, 1),
            height_mm=round(h, 1),
            quantity=qty,
            thickness_mm=thickness,
            product_type=product_type,
            pvc_code=mat.code,
            pvc_color=mat.name or mat.code,
            design_code=mat.design_code if is_vacuum else "",
            grain=spec.grain,
            rotation="Y",
            note="",
            formula_trace={
                "width": formula.trace(spec.w, v),
                "height": formula.trace(spec.h, v),
                "qty": formula.trace(spec.qty, v),
            },
            **edges,
        ))

    back = _make_back(inst, lib, v)
    if back is not None:
        out.append(back)
    return out


def _slot_thickness(build: BuildConfig, slot: str) -> float:
    return {
        "body": build.body_thickness_mm,
        "door": build.door_thickness_mm,
        "back": build.back_thickness_mm,
    }.get(slot, build.body_thickness_mm)


def _make_back(inst: UnitInstance, lib: MaterialLibrary, v: dict):
    method = (inst.build.back_method or "groove").lower()
    if method == "outside":
        return None  # the shop cuts the back separately; not in the cut list

    if method == "staple":
        # applied / overlay: full outside of the carcass
        w_expr, h_expr = "W", "H"
    else:  # groove (default): seated in the dados, grows by 2*dg each way
        w_expr, h_expr = "(W-2*t)+2*dg", "(H-2*t)+2*dg"

    w = formula.evaluate(w_expr, v)
    h = formula.evaluate(h_expr, v)
    if w <= 0 or h <= 0:
        raise GeneratorError(f"back panel non-positive size {w}x{h}")
    mat = _slot_material(inst, "back")
    return GeneratedPart(
        unit_name=inst.name or inst.template.name_en or inst.template.id,
        part_type="back",
        name_fa="پشت‌بند",
        name_en="Back",
        width_mm=round(w, 1),
        height_mm=round(h, 1),
        quantity=1,
        thickness_mm=inst.build.back_thickness_mm,
        product_type="melamine",
        pvc_code=mat.code,
        pvc_color=mat.name or mat.code,
        grain="none",
        rotation="Y",
        note=f"back method: {method}",
        formula_trace={
            "width": formula.trace(w_expr, v),
            "height": formula.trace(h_expr, v),
            "qty": "1",
        },
    )


def cut_size(part: GeneratedPart, lib: MaterialLibrary) -> tuple:
    """Display-only: the saw cut size after subtracting edge-band thickness,
    matching ZINAX's own import math.

    cut width  = width  - t(edge_3) - t(edge_4)
    cut height = height - t(edge_1) - t(edge_2)
    """
    if not lib.edge_band_defaults.get("subtract", True):
        return part.width_mm, part.height_mm
    cw = part.width_mm - lib.band_thickness(part.edge_3) - lib.band_thickness(part.edge_4)
    ch = part.height_mm - lib.band_thickness(part.edge_1) - lib.band_thickness(part.edge_2)
    return round(max(cw, 0.0), 1), round(max(ch, 0.0), 1)

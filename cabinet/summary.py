"""Order summary: piece counts, edge-band meters per band, and a material /
thickness rollup with a rough sheet-count estimate.

Band meters follow the ZINAX contract: edges 1&2 are ``width_mm`` long, edges
3&4 are ``height_mm`` long, each banded edge adds its length + waste (default
50 mm). Sheet count is only an area-based ESTIMATE — the real nesting count is
ZINAX's job.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable, List, Optional

from .library import MaterialLibrary, _band_of
from .models import GeneratedPart

__all__ = ["BandLine", "MaterialLine", "Summary", "band_meters", "summarize"]

# Fraction of a sheet that is usable after trim/offcuts, for the estimate only.
_SHEET_UTILISATION = 0.80


@dataclass
class BandLine:
    code: str
    meters: float


@dataclass
class MaterialLine:
    pvc_code: str
    thickness_mm: float
    pieces: int
    area_m2: float
    est_sheets: Optional[int]


@dataclass
class Summary:
    total_pieces: int = 0
    melamine_pieces: int = 0
    vacuum_pieces: int = 0
    bands: List[BandLine] = field(default_factory=list)
    materials: List[MaterialLine] = field(default_factory=list)


def band_meters(parts: Iterable[GeneratedPart], lib: MaterialLibrary) -> dict:
    """mm of each band code over all parts (× quantity), including waste."""
    waste = float(lib.edge_band_defaults.get("default_waste_mm", 50))
    totals: dict = {}
    for p in parts:
        for cell, length in (
            (p.edge_1, p.width_mm), (p.edge_2, p.width_mm),
            (p.edge_3, p.height_mm), (p.edge_4, p.height_mm),
        ):
            code = _band_of(cell)
            if code is None:
                continue
            totals[code] = totals.get(code, 0.0) + (length + waste) * p.quantity
    return totals


def summarize(parts: Iterable[GeneratedPart], lib: MaterialLibrary) -> Summary:
    parts = list(parts)
    s = Summary()
    for p in parts:
        s.total_pieces += p.quantity
        if p.product_type == "vacuum_door":
            s.vacuum_pieces += p.quantity
        else:
            s.melamine_pieces += p.quantity

    s.bands = [BandLine(code, round(mm / 1000.0, 2))
               for code, mm in sorted(band_meters(parts, lib).items())]

    groups: dict = {}
    for p in parts:
        key = (p.pvc_code, p.thickness_mm)
        g = groups.setdefault(key, {"pieces": 0, "area": 0.0})
        g["pieces"] += p.quantity
        g["area"] += (p.width_mm * p.height_mm / 1_000_000.0) * p.quantity

    for (code, th), g in sorted(groups.items()):
        s.materials.append(MaterialLine(
            pvc_code=code,
            thickness_mm=th,
            pieces=g["pieces"],
            area_m2=round(g["area"], 3),
            est_sheets=_estimate_sheets(g["area"], th, lib),
        ))
    return s


def _estimate_sheets(area_m2: float, thickness: float, lib: MaterialLibrary):
    sheet = None
    for sh in lib.sheets:
        if sh.thickness == thickness:
            sheet = sh
            break
    if sheet is None and lib.sheets:
        sheet = lib.sheets[0]
    if sheet is None:
        return None
    sheet_area = sheet.width * sheet.height / 1_000_000.0 * _SHEET_UTILISATION
    if sheet_area <= 0:
        return None
    return int(math.ceil(area_m2 / sheet_area))

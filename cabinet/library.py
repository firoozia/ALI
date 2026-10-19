"""Editable material library (colors, thicknesses, edge bands, sheets, build
defaults). Backed by ``catalog/materials.json`` and writable from the app.

Codes (material ``code``, edge-band ``code``, thickness) must match ZINAX CAM
so that uploading the order creates the right sheet on its side.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Optional

__all__ = ["EdgeBand", "Material", "Sheet", "MaterialLibrary", "LibraryError"]

_DEFAULT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "catalog",
    "materials.json",
)


class LibraryError(ValueError):
    pass


@dataclass
class EdgeBand:
    code: str
    name: str = ""
    thickness_mm: float = 0.0
    width_mm: float = 22.0


@dataclass
class Material:
    code: str
    name: str = ""
    type: str = "melamine"          # melamine | mdf | fiber | vacuum | ...
    default_thickness: float = 18.0


@dataclass
class Sheet:
    name: str
    width: float
    height: float
    thickness: float
    material: str


@dataclass
class MaterialLibrary:
    thicknesses_mm: list = field(default_factory=lambda: [3, 6, 16, 18])
    materials: list = field(default_factory=list)       # list[Material]
    edge_bands: list = field(default_factory=list)      # list[EdgeBand]
    sheets: list = field(default_factory=list)          # list[Sheet]
    edge_band_defaults: dict = field(default_factory=lambda: {"subtract": True, "default_waste_mm": 50})
    construction: dict = field(default_factory=dict)
    path: Optional[str] = None

    # ---- load / save -----------------------------------------------------
    @classmethod
    def load(cls, path: Optional[str] = None) -> "MaterialLibrary":
        path = path or _DEFAULT_PATH
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        lib = cls(
            thicknesses_mm=list(data.get("thicknesses_mm", [3, 6, 16, 18])),
            materials=[Material(**_pick(m, Material)) for m in data.get("materials", [])],
            edge_bands=[EdgeBand(**_pick(b, EdgeBand)) for b in data.get("edge_bands", [])],
            sheets=[Sheet(**_pick(s, Sheet)) for s in data.get("sheets", [])],
            edge_band_defaults=dict(data.get("edge_band_defaults", {"subtract": True, "default_waste_mm": 50})),
            construction=dict(data.get("construction", {})),
            path=path,
        )
        return lib

    def save(self, path: Optional[str] = None) -> None:
        path = path or self.path or _DEFAULT_PATH
        data = {
            "_meta": {"version": "0.1", "units": "mm", "editable": True},
            "thicknesses_mm": self.thicknesses_mm,
            "materials": [vars(m) for m in self.materials],
            "edge_bands": [vars(b) for b in self.edge_bands],
            "edge_band_defaults": self.edge_band_defaults,
            "sheets": [vars(s) for s in self.sheets],
            "construction": self.construction,
        }
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        self.path = path

    # ---- lookups ---------------------------------------------------------
    def material(self, code: str) -> Material:
        for m in self.materials:
            if m.code == code:
                return m
        raise LibraryError(f"material {code!r} not in library")

    def band(self, code: str) -> EdgeBand:
        for b in self.edge_bands:
            if b.code == code:
                return b
        raise LibraryError(f"edge band {code!r} not in library")

    def band_thickness(self, cell: str) -> float:
        """Thickness that an edge cell removes from the cut size.

        ``N`` and ``S`` (groove mark) remove nothing; ``P1`` and ``S/P1`` use
        the band's thickness.
        """
        code = _band_of(cell)
        if code is None:
            return 0.0
        return self.band(code).thickness_mm

    def default_band_code(self) -> str:
        if not self.edge_bands:
            raise LibraryError("library has no edge bands")
        return self.edge_bands[0].code

    # ---- editing (writable) ---------------------------------------------
    def add_material(self, mat: Material) -> None:
        if any(m.code == mat.code for m in self.materials):
            raise LibraryError(f"material {mat.code!r} already exists")
        self.materials.append(mat)

    def remove_material(self, code: str) -> None:
        self.materials = [m for m in self.materials if m.code != code]

    def add_band(self, band: EdgeBand) -> None:
        if not band.code.upper().startswith("P") or "/" in band.code or any(c.isspace() for c in band.code):
            raise LibraryError("edge-band code must start with P and have no space or '/'")
        if any(b.code == band.code for b in self.edge_bands):
            raise LibraryError(f"edge band {band.code!r} already exists")
        self.edge_bands.append(band)


def _band_of(cell: str):
    """Return the band code of an edge cell, or None for N / S / blank."""
    if cell is None:
        return None
    s = str(cell).strip()
    if s == "" or s.upper() == "N":
        return None
    if s.upper() == "S":
        return None
    if "/" in s:                       # "S/P1" -> "P1"
        s = s.split("/", 1)[1].strip()
    if s.upper() == "N" or s == "":
        return None
    return s.upper()


def _pick(d: dict, cls) -> dict:
    """Keep only the keys that ``cls`` accepts (ignore extra JSON fields)."""
    fields = cls.__dataclass_fields__.keys()
    return {k: v for k, v in d.items() if k in fields}

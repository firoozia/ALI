"""Cabinet unit -> cut-list engine (Phase 1).

A parametric unit template + chosen materials/build options is turned into a
list of cut parts and exported as a ZINAX ORDER_CSV_V2 file. No nesting / G-code
here — that is ZINAX's job.
"""
from .formula import FormulaError, evaluate, trace
from .library import EdgeBand, Material, MaterialLibrary, Sheet, LibraryError
from .models import (BuildConfig, GeneratedPart, PartSpec, SlotMaterial,
                     UnitInstance, UnitTemplate)
from .generator import GeneratorError, cut_size, generate_parts
from .order_csv import ORDER_CSV_HEADER, OrderMeta, to_csv_string, write_order_csv

__all__ = [
    "FormulaError", "evaluate", "trace",
    "EdgeBand", "Material", "MaterialLibrary", "Sheet", "LibraryError",
    "BuildConfig", "GeneratedPart", "PartSpec", "SlotMaterial",
    "UnitInstance", "UnitTemplate",
    "GeneratorError", "cut_size", "generate_parts",
    "ORDER_CSV_HEADER", "OrderMeta", "to_csv_string", "write_order_csv",
]

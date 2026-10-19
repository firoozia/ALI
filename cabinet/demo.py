"""Tiny end-to-end demo: build a base 2-door unit and print its ORDER.csv +
build-reason breakdown. Run:  python -m cabinet.demo
"""
from __future__ import annotations

import os

from . import (BuildConfig, MaterialLibrary, OrderMeta, SlotMaterial,
               UnitInstance, UnitTemplate, cut_size, generate_parts,
               to_csv_string)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build_demo():
    lib = MaterialLibrary.load()
    tmpl = UnitTemplate.load(os.path.join(ROOT, "catalog", "models", "base_2door.json"))
    cons = lib.construction.get("defaults", {})
    inst = UnitInstance(
        template=tmpl,
        name="Base 800",
        build=BuildConfig(
            back_method=lib.construction.get("default_back_method", "groove"),
            body_thickness_mm=cons.get("body_thickness_mm", 16),
            door_thickness_mm=cons.get("door_thickness_mm", 18),
            back_thickness_mm=cons.get("back_thickness_mm", 6),
            door_gap_mm=cons.get("door_gap_mm", 3),
            shelf_setback_mm=cons.get("shelf_setback_mm", 20),
        ),
        materials={
            "body": SlotMaterial("MEL-W", "Melamine White", "melamine"),
            "door": SlotMaterial("MEL-W", "Melamine White", "melamine"),
            "back": SlotMaterial("FIB-6", "MDF back 6", "fiber"),
        },
    )
    return lib, inst, generate_parts(inst, lib)


def main():
    lib, inst, parts = build_demo()
    print("=== ORDER.csv (ZINAX ORDER_CSV_V2) ===")
    print(to_csv_string(parts, OrderMeta(order_no="SO", customer_name="Ali",
                                         project_name="demo kitchen")), end="")
    print("\n=== Build reason (دلیل) ===")
    print(f"Unit: {inst.name}  method={inst.build.back_method}  "
          f"params={inst.effective_params()}")
    for p in parts:
        cw, ch = cut_size(p, lib)
        print(f"  {p.name_en:7} x{p.quantity}  order {p.width_mm}x{p.height_mm} "
              f"t{p.thickness_mm}  cut {cw}x{ch}  "
              f"[{p.pvc_code}]  "
              f"w: {p.formula_trace['width']} | h: {p.formula_trace['height']}")


if __name__ == "__main__":
    main()

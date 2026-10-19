import os

import pytest

from cabinet import (BuildConfig, MaterialLibrary, SlotMaterial, UnitInstance,
                     UnitTemplate, cut_size, generate_parts)
from cabinet.generator import GeneratorError

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "catalog", "models")


@pytest.fixture
def lib():
    return MaterialLibrary.load()


def _instance(template_id="base_2door", **build_kw):
    tmpl = UnitTemplate.load(os.path.join(MODELS, f"{template_id}.json"))
    build = BuildConfig(body_thickness_mm=16, door_thickness_mm=18,
                        back_thickness_mm=6, door_gap_mm=3, shelf_setback_mm=20,
                        groove_depth_mm=8, **build_kw)
    return UnitInstance(
        template=tmpl, name="U1", qty=1, build=build,
        materials={
            "body": SlotMaterial("MEL-W", "Melamine White", "melamine"),
            "door": SlotMaterial("MEL-W", "Melamine White", "melamine"),
            "back": SlotMaterial("FIB-6", "MDF back 6", "fiber"),
        },
    )


def test_base_2door_part_sizes(lib):
    parts = generate_parts(_instance("base_2door"), lib)
    by = {p.part_type: p for p in parts}
    # W=800 H=720 D=560 t=16 doors=2 g=3 ss=20 dg=8
    assert (by["side"].width_mm, by["side"].height_mm, by["side"].quantity) == (560, 720, 2)
    assert (by["top"].width_mm, by["top"].height_mm) == (768, 560)       # W-2t x D
    assert (by["bottom"].width_mm, by["bottom"].height_mm) == (768, 560)
    assert (by["shelf"].width_mm, by["shelf"].height_mm) == (768, 540)   # D-ss
    # door: (800-(2+1)*3)/2 = 395.5 ; H-2g = 714
    assert by["door"].width_mm == pytest.approx(395.5)
    assert by["door"].height_mm == 714
    assert by["door"].quantity == 2
    assert by["door"].thickness_mm == 18


def test_groove_back_is_default_and_sized(lib):
    parts = generate_parts(_instance("base_2door"), lib)
    back = [p for p in parts if p.part_type == "back"][0]
    # groove: (W-2t)+2dg x (H-2t)+2dg = 784 x 704 ; thickness = back 6
    assert (back.width_mm, back.height_mm) == (784, 704)
    assert back.thickness_mm == 6
    assert back.product_type == "melamine"
    assert back.pvc_code == "FIB-6"


def test_staple_back_is_full_overlay(lib):
    parts = generate_parts(_instance("base_2door", back_method="staple"), lib)
    back = [p for p in parts if p.part_type == "back"][0]
    assert (back.width_mm, back.height_mm) == (800, 720)


def test_outside_back_is_omitted(lib):
    parts = generate_parts(_instance("base_2door", back_method="outside"), lib)
    assert not any(p.part_type == "back" for p in parts)


def test_door_edges_banded_carcass_not(lib):
    parts = generate_parts(_instance("base_2door"), lib)
    door = [p for p in parts if p.part_type == "door"][0]
    assert (door.edge_1, door.edge_2, door.edge_3, door.edge_4) == ("P1", "P1", "P1", "P1")
    side = [p for p in parts if p.part_type == "side"][0]
    # no PVC band on the carcass; in the default groove method the rear edge (edge_3)
    # carries a groove mark "S".
    assert (side.edge_1, side.edge_2, side.edge_3, side.edge_4) == ("N", "N", "S", "N")


def test_cut_size_subtracts_band_thickness(lib):
    parts = generate_parts(_instance("base_2door"), lib)
    door = [p for p in parts if p.part_type == "door"][0]
    # all four edges P1 (0.5mm): cut = w-1.0, h-1.0
    cw, ch = cut_size(door, lib)
    assert cw == pytest.approx(door.width_mm - 1.0)
    assert ch == pytest.approx(door.height_mm - 1.0)


def test_vacuum_door_has_no_edges_and_design_code(lib):
    inst = _instance("base_2door")
    inst.materials["door"] = SlotMaterial("WHT-001", "Vacuum white", "vacuum", design_code="ZV01")
    parts = generate_parts(inst, lib)
    door = [p for p in parts if p.part_type == "door"][0]
    assert door.product_type == "vacuum_door"
    assert door.design_code == "ZV01"
    assert (door.edge_1, door.edge_2, door.edge_3, door.edge_4) == ("N", "N", "N", "N")


def test_zero_shelves_skipped(lib):
    inst = _instance("base_2door")
    inst.params = {"shelves": 0}
    parts = generate_parts(inst, lib)
    assert not any(p.part_type == "shelf" for p in parts)


def test_bad_params_raise(lib):
    inst = _instance("base_2door")
    inst.params = {"W": 20}  # W-2t = 20-32 < 0 -> top/bottom invalid
    with pytest.raises(GeneratorError):
        generate_parts(inst, lib)


def test_formula_trace_present(lib):
    parts = generate_parts(_instance("base_2door"), lib)
    top = [p for p in parts if p.part_type == "top"][0]
    assert top.formula_trace["width"] == "W-2*t = 800-2*16 = 768"

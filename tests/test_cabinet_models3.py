import os

import pytest

from cabinet import (BuildConfig, MaterialLibrary, SlotMaterial, UnitInstance,
                     UnitTemplate, generate_parts)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "catalog", "models")


@pytest.fixture
def lib():
    return MaterialLibrary.load()


def _inst(template_id, door_material=None, **params):
    tmpl = UnitTemplate.load(os.path.join(MODELS, f"{template_id}.json"))
    mats = {
        "body": SlotMaterial("MEL-W", "Melamine White", "melamine"),
        "door": door_material or SlotMaterial("MEL-W", "Melamine White", "melamine"),
        "back": SlotMaterial("FIB-6", "MDF back 6", "fiber"),
    }
    return UnitInstance(template=tmpl, name="U1", params=params,
                        build=BuildConfig(), materials=mats)


# ---- drawer unit --------------------------------------------------------
def test_drawer_unit_part_counts(lib):
    parts = generate_parts(_inst("base_3drawer", drawers=3), lib)
    counts = {}
    for p in parts:
        counts[p.part_type] = counts.get(p.part_type, 0) + p.quantity
    assert counts["side"] == 2
    assert counts["drawer_front"] == 3
    assert counts["drawer_side"] == 6      # drawers*2
    assert counts["drawer_fb"] == 6        # drawers*2
    assert counts["drawer_bottom"] == 3
    assert counts["back"] == 1


def test_drawer_sizes(lib):
    parts = {p.part_type: p for p in generate_parts(_inst("base_3drawer", drawers=3), lib)}
    # W=800 H=720 D=560 t=16 g=3 drawers=3 ddr=50 dsc=26 dbh=120
    front = parts["drawer_front"]
    assert front.width_mm == 800 - 2 * 3                      # W-2g = 794
    assert front.height_mm == pytest.approx((720 - (3 + 1) * 3) / 3)   # 236
    assert parts["drawer_side"].width_mm == 560 - 50          # D-ddr = 510
    assert parts["drawer_side"].height_mm == 120              # dbh
    assert parts["drawer_fb"].width_mm == 800 - 2 * 16 - 26   # 742
    assert parts["drawer_bottom"].thickness_mm == 6           # back slot = thin fiber


def test_drawer_front_is_banded(lib):
    front = [p for p in generate_parts(_inst("base_3drawer"), lib) if p.part_type == "drawer_front"][0]
    assert (front.edge_1, front.edge_2, front.edge_3, front.edge_4) == ("P1", "P1", "P1", "P1")


# ---- wardrobe -----------------------------------------------------------
def test_wardrobe_tall(lib):
    parts = {p.part_type: p for p in generate_parts(_inst("wardrobe_2door"), lib)}
    assert parts["side"].height_mm == 2200
    assert parts["door"].height_mm == 2200 - 2 * 3
    shelves = [p for p in generate_parts(_inst("wardrobe_2door"), lib) if p.part_type == "shelf"]
    assert sum(p.quantity for p in shelves) == 4


# ---- vacuum -------------------------------------------------------------
def test_vacuum_doors_forced_by_template(lib):
    # door material is plain melamine, but the template forces product=vacuum
    inst = _inst("base_2door_vacuum")
    inst.materials["door"] = SlotMaterial("WHT-001", "Vacuum White", "vacuum", design_code="ZV01")
    parts = generate_parts(inst, lib)
    door = [p for p in parts if p.part_type == "door"][0]
    assert door.product_type == "vacuum_door"
    assert door.design_code == "ZV01"
    assert (door.edge_1, door.edge_2, door.edge_3, door.edge_4) == ("N", "N", "N", "N")
    # carcass stays melamine
    side = [p for p in parts if p.part_type == "side"][0]
    assert side.product_type == "melamine"


def test_all_new_models_import_into_zinax(lib):
    import sys
    zx_root = "/home/user/zinax-cam"
    if not os.path.isdir(os.path.join(zx_root, "zinax_cam")):
        pytest.skip("zinax-cam not available")
    if zx_root not in sys.path:
        sys.path.insert(0, zx_root)
    import importlib.util
    import tempfile
    from cabinet import write_order_csv
    s = importlib.util.spec_from_file_location("zx_csv", os.path.join(zx_root, "csv_handler.py"))
    zx = importlib.util.module_from_spec(s)
    s.loader.exec_module(zx)
    for tid in ("base_3drawer", "wardrobe_2door", "base_2door_vacuum"):
        inst = _inst(tid)
        if tid == "base_2door_vacuum":
            inst.materials["door"] = SlotMaterial("WHT-001", "Vacuum White", "vacuum", design_code="ZV01")
        parts = generate_parts(inst, lib)
        path = os.path.join(tempfile.mkdtemp(), "ORDER.csv")
        write_order_csv(parts, path)
        order, errors = zx.parse_csv(path)
        assert errors == [], f"{tid}: {errors}"
        assert order.total_parts() > 0

import csv
import io
import os

import pytest

from cabinet import (BuildConfig, ManualPart, MaterialLibrary, Order, OrderMeta,
                     SlotMaterial, UnitInstance, UnitTemplate, build_order,
                     to_csv_string)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "catalog", "models")


def _unit(template_id, name):
    tmpl = UnitTemplate.load(os.path.join(MODELS, f"{template_id}.json"))
    return UnitInstance(
        template=tmpl, name=name, build=BuildConfig(),
        materials={
            "body": SlotMaterial("MEL-W", "Melamine White", "melamine"),
            "door": SlotMaterial("MEL-W", "Melamine White", "melamine"),
            "back": SlotMaterial("FIB-6", "MDF back 6", "fiber"),
        },
    )


@pytest.fixture
def lib():
    return MaterialLibrary.load()


def test_multi_unit_order_continuous_line_no(lib):
    order = Order(order_no="SO", customer_name="Ali", project_name="kitchen",
                  units=[_unit("base_2door", "U1"), _unit("wall_2door", "U2")])
    parts = build_order(order, lib)
    rows = list(csv.DictReader(io.StringIO(
        to_csv_string(parts, OrderMeta(order.order_no, order.customer_name, order.project_name)))))
    line_nos = [int(r["line_no"]) for r in rows]
    assert line_nos == list(range(1, len(rows) + 1))   # continuous, no gaps
    assert len(rows) == len(parts)


def test_manual_part_included(lib):
    order = Order(units=[_unit("base_1door", "U1")],
                  manual_parts=[ManualPart(name_en="Filler", width_mm=100, height_mm=720,
                                           quantity=2, thickness_mm=18,
                                           material_code="MEL-W", edge_1="P1")])
    parts = build_order(order, lib)
    manual = [p for p in parts if p.part_type == "manual"]
    assert len(manual) == 1
    assert manual[0].width_mm == 100 and manual[0].quantity == 2
    assert manual[0].edge_1 == "P1"


def test_manual_vacuum_part_strips_edges(lib):
    order = Order(manual_parts=[ManualPart(name_en="VacDoor", width_mm=500, height_mm=900,
                                           product_type="vacuum_door", design_code="ZV09",
                                           edge_1="P1")])
    p = build_order(order, lib)[0]
    assert p.product_type == "vacuum_door"
    assert p.design_code == "ZV09"
    assert (p.edge_1, p.edge_2, p.edge_3, p.edge_4) == ("N", "N", "N", "N")


def test_invalid_manual_part_raises(lib):
    order = Order(manual_parts=[ManualPart(name_en="bad", width_mm=0, height_mm=500)])
    with pytest.raises(ValueError):
        build_order(order, lib)

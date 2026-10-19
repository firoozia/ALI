import os

import pytest

from cabinet import (BuildConfig, ManualPart, MaterialLibrary, Order,
                     SlotMaterial, UnitInstance, UnitTemplate, build_order,
                     render_report_html, summarize)
from cabinet.summary import band_meters

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "catalog", "models")


def _unit(template_id="base_2door", name="U1"):
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


def test_band_meters_match_contract(lib):
    # One melamine piece 400x400 with all four P1 edges, waste 50 -> 1.80 m
    order = Order(manual_parts=[ManualPart(name_en="sq", width_mm=400, height_mm=400,
                                           material_code="MEL-W",
                                           edge_1="P1", edge_2="P1", edge_3="P1", edge_4="P1")])
    parts = build_order(order, lib)
    mm = band_meters(parts, lib)
    assert mm["P1"] == pytest.approx(4 * (400 + 50))      # 1800 mm
    s = summarize(parts, lib)
    assert s.bands[0].code == "P1"
    assert s.bands[0].meters == pytest.approx(1.80)


def test_band_meters_use_order_size_and_qty(lib):
    # 500x300, edge_1 (||width, 500) + edge_3 (||height, 300), P1, qty 2
    order = Order(manual_parts=[ManualPart(name_en="r", width_mm=500, height_mm=300, quantity=2,
                                           material_code="MEL-W", edge_1="P1", edge_3="P1")])
    mm = band_meters(build_order(order, lib), lib)
    assert mm["P1"] == pytest.approx(((500 + 50) + (300 + 50)) * 2)


def test_summary_counts_and_materials(lib):
    order = Order(units=[_unit("base_2door", "U1")])
    s = summarize(build_order(order, lib), lib)
    assert s.total_pieces == 8         # 2 sides+top+bottom+shelf+2 doors+back
    assert s.vacuum_pieces == 0
    codes = {m.pvc_code for m in s.materials}
    assert "MEL-W" in codes and "FIB-6" in codes
    for m in s.materials:
        assert m.area_m2 > 0
        assert m.est_sheets is None or m.est_sheets >= 1


def test_report_html_renders(lib):
    order = Order(order_no="SO", customer_name="Ali", project_name="kitchen",
                  units=[_unit("base_2door", "U1")],
                  manual_parts=[ManualPart(name_en="Filler", width_mm=100, height_mm=720)])
    html_fa = render_report_html(order, lib, lang="fa")
    assert html_fa.startswith("<!doctype html>")
    assert 'dir="rtl"' in html_fa
    assert "W-2*t = 800-2*16 = 768" in html_fa      # a formula trace is shown
    assert "Filler" in html_fa                       # manual part listed
    html_en = render_report_html(order, lib, lang="en")
    assert "Build reason" in html_en

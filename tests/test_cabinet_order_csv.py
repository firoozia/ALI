import csv
import io
import os

import pytest

from cabinet import (BuildConfig, MaterialLibrary, OrderMeta, SlotMaterial,
                     UnitInstance, UnitTemplate, generate_parts, to_csv_string,
                     write_order_csv)
from cabinet.order_csv import ORDER_CSV_HEADER

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "catalog", "models")

# The real ZINAX sample header (docs/crosscheck/real_zinax/*/ORDER.csv).
REAL_HEADER = [
    "order_no", "line_no", "customer_name", "project_name", "product_type",
    "width_mm", "height_mm", "quantity", "design_code", "mdf_thickness_mm",
    "pvc_code", "pvc_color", "grain_direction", "rotation",
    "edge_1", "edge_2", "edge_3", "edge_4",
]


@pytest.fixture
def parts():
    lib = MaterialLibrary.load()
    tmpl = UnitTemplate.load(os.path.join(MODELS, "base_2door.json"))
    inst = UnitInstance(
        template=tmpl, name="U1",
        build=BuildConfig(body_thickness_mm=16, door_thickness_mm=18, back_thickness_mm=6),
        materials={
            "body": SlotMaterial("MEL-W", "Melamine White", "melamine"),
            "door": SlotMaterial("MEL-W", "Melamine White", "melamine"),
            "back": SlotMaterial("FIB-6", "MDF back 6", "fiber"),
        },
    )
    return generate_parts(inst, lib), lib


def test_header_matches_real_zinax():
    assert ORDER_CSV_HEADER == REAL_HEADER


def test_csv_parses_and_has_rows(parts):
    gparts, _ = parts
    text = to_csv_string(gparts, OrderMeta(order_no="SO", customer_name="Ali", project_name="kitchen"))
    reader = csv.DictReader(io.StringIO(text))
    assert reader.fieldnames == REAL_HEADER
    rows = list(reader)
    assert len(rows) == len(gparts)
    # required fields present and valid on every row
    for r in rows:
        assert r["order_no"] == "SO"
        assert int(r["line_no"]) >= 1
        assert float(r["width_mm"]) > 0
        assert float(r["height_mm"]) > 0
        assert int(r["quantity"]) >= 1
        assert r["product_type"] in ("melamine", "vacuum_door")


def test_order_size_not_cut_size(parts):
    """width_mm/height_mm must be the finished order size (ZINAX subtracts band)."""
    gparts, _ = parts
    rows = list(csv.DictReader(io.StringIO(to_csv_string(gparts))))
    door = [r for r in rows if r["product_type"] == "melamine" and float(r["width_mm"]) == 395.5][0]
    assert float(r_h := door["height_mm"]) == 714  # not 713 (no band subtracted)


def test_write_file_has_bom(tmp_path, parts):
    gparts, _ = parts
    path = os.path.join(tmp_path, "ORDER.csv")
    write_order_csv(gparts, path)
    with open(path, "rb") as fh:
        head = fh.read(3)
    assert head == b"\xef\xbb\xbf"  # UTF-8 BOM like the real files

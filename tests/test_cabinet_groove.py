import os

import pytest

from cabinet import (BuildConfig, MaterialLibrary, SlotMaterial, UnitInstance,
                     UnitTemplate, generate_parts)
from cabinet.generator import apply_groove

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "catalog", "models")


@pytest.fixture
def lib():
    return MaterialLibrary.load()


def _inst(back_method="groove"):
    tmpl = UnitTemplate.load(os.path.join(MODELS, "base_2door.json"))
    return UnitInstance(
        template=tmpl, name="U1",
        build=BuildConfig(back_method=back_method),
        materials={
            "body": SlotMaterial("MEL-W", "Melamine White", "melamine"),
            "door": SlotMaterial("MEL-W", "Melamine White", "melamine"),
            "back": SlotMaterial("FIB-6", "MDF back 6", "fiber"),
        },
    )


def test_apply_groove_matches_zinax_tokens():
    assert apply_groove("N") == "S"
    assert apply_groove("") == "S"
    assert apply_groove("S") == "S"
    assert apply_groove("P1") == "S/P1"
    assert apply_groove("S/P1") == "S/P1"


def test_groove_method_marks_carcass_rear_edges(lib):
    parts = {p.part_type: p for p in generate_parts(_inst("groove"), lib)}
    # sides: rear vertical edge_3 = S
    assert parts["side"].edge_3 == "S"
    assert (parts["side"].edge_1, parts["side"].edge_2, parts["side"].edge_4) == ("N", "N", "N")
    # top/bottom: rear horizontal edge_1 = S
    assert parts["top"].edge_1 == "S"
    assert parts["bottom"].edge_1 == "S"


def test_groove_combines_with_band_as_slash(lib):
    # shelf has a front band on edge_1 ("front") AND, if its groove edge were edge_1,
    # it would combine. The shelf has no groove_edge, so check a door is untouched and
    # verify the combine via a crafted part: give the side a band on its groove edge.
    inst = _inst("groove")
    # edit the template copy: band the side's rear edge too -> expect S/P1
    for spec in inst.template.parts:
        if spec.type == "side":
            spec.edges = {"edge_3": "band"}
    parts = {p.part_type: p for p in generate_parts(inst, lib)}
    assert parts["side"].edge_3 == "S/P1"


def test_staple_method_has_no_groove_marks(lib):
    parts = generate_parts(_inst("staple"), lib)
    for p in parts:
        for cell in (p.edge_1, p.edge_2, p.edge_3, p.edge_4):
            assert not cell.startswith("S"), f"{p.part_type} has groove mark in staple method"


def test_doors_never_grooved(lib):
    door = [p for p in generate_parts(_inst("groove"), lib) if p.part_type == "door"][0]
    assert (door.edge_1, door.edge_2, door.edge_3, door.edge_4) == ("P1", "P1", "P1", "P1")


def test_groove_cells_accepted_by_zinax_parser(lib):
    """The S / S/P1 cells we emit must be 'known' to zinax-cam's parse_edge."""
    import sys
    zx_root = "/home/user/zinax-cam"
    if not os.path.isdir(os.path.join(zx_root, "zinax_cam")):
        pytest.skip("zinax-cam not available")
    if zx_root not in sys.path:
        sys.path.insert(0, zx_root)
    from zinax_cam.domain.edge_band import factory_bands, parse_edge
    bands = factory_bands()
    for cell in ("N", "S", "P1", "S/P1"):
        assert parse_edge(cell, bands).known, f"zinax rejects {cell!r}"
    # an unknown form like "sp" must NOT be accepted (confirms S/P1 is the real token)
    assert not parse_edge("sp", bands).known

"""
FIROO CAM - G-code Generator Test
Run: python test_gcode.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

print("=" * 55)
print("FIROO CAM — G-code Generator Test")
print("=" * 55)

# ── Step 1: Design Resolver ───────────────────────────────────
print("\n[1] Testing DesignResolver...")
from design_resolver import DesignResolver
resolver = DesignResolver()
codes = resolver.all_codes()
print(f"    Indexed designs: {len(codes)}")
print(f"    First 5: {codes[:5]}")

# pick first real design for test
test_code = next((c for c in codes if c.startswith("cd") and c != "cd0"), None)
if not test_code:
    test_code = codes[0] if codes else None

if not test_code:
    print("    ❌ No designs found — check C:\\FIROO_CAM\\designs\\")
    sys.exit(1)
print(f"    Using design: {test_code}")

# ── Step 2: Load design ───────────────────────────────────────
print(f"\n[2] Loading design '{test_code}'...")
design = resolver.load(test_code, width=900, height=500)
if design is None:
    print(f"    ❌ Could not load {test_code}")
    sys.exit(1)
print(f"    ✅ Design loaded: '{design.name}'")
print(f"    Layers: {len(design.layers)}")
for layer in design.layers:
    print(f"      L{layer.get('id',0)}: {layer.get('name','?'):20} "
          f"offset={layer.get('offset_mm',0):.1f}mm  "
          f"depth={layer.get('depth_mm',0):.1f}mm  "
          f"tool={layer.get('tool','?')}")

# ── Step 3: GCodeGenerator ────────────────────────────────────
print("\n[3] Testing GCodeGenerator...")
from gcode_generator import GCodeGenerator
from data_models import Part, Sheet

gen = GCodeGenerator()
print(f"    Tools loaded: {len(gen.tools)}")
print(f"    Post processor: {gen._pp.name if gen._pp else 'fallback'}")
print(f"    File extension: .{gen.file_ext}")
print(f"    ATC mode: {gen.is_atc}")
print(f"    Output dir: {gen.output_dir}")

# ── Step 4: Create fake nested part ──────────────────────────
print("\n[4] Creating test part...")
part = Part(
    part_id    = "TEST01",
    part_code  = "TestPart",
    width      = 900.0,
    height     = 500.0,
    thickness  = 18.0,
    design_code= test_code,
    customer   = "TestCustomer",
    x          = 10.0,
    y          = 10.0,
    rotated    = False,
    status     = "nested",
)
print(f"    Part: {part.part_code} {part.width}x{part.height} design={part.design_code}")

# ── Step 5: Apply design ──────────────────────────────────────
print("\n[5] Applying design to part...")
from gcode_generator import DesignApplier
applier = DesignApplier()
layers = applier.get_design_config(part)
if layers is None:
    print(f"    ❌ Could not get design config for {test_code}")
    sys.exit(1)
print(f"    ✅ Got {len(layers)} layer(s)")
for l in layers:
    print(f"      {l['name']:20} tool={l['tool']}  "
          f"depth={l['depth_mm']:.1f}mm  offset={l['offset_mm']:.1f}mm")

# ── Step 6: Generate G-code for part ─────────────────────────
print("\n[6] Generating G-code for part...")
sheet = Sheet(sheet_id=1, width=2440, height=1220, thickness=18, material="MDF")
sheet.parts.append(part)

import os
from pathlib import Path
out_dir = Path(gen.output_dir)
out_dir.mkdir(parents=True, exist_ok=True)

saved = gen.generate_sheet(sheet, customer="TEST", sheet_idx=1)
if saved:
    print(f"    ✅ Generated {len(saved)} file(s):")
    for f in saved:
        fpath = Path(f)
        size  = fpath.stat().st_size if fpath.exists() else 0
        print(f"      {fpath.name}  ({size} bytes)")
    # Show first 30 lines of first file
    first = Path(saved[0])
    if first.exists():
        lines = first.read_text(encoding="utf-8").split("\n")
        print(f"\n    --- First 30 lines of {first.name} ---")
        for i, line in enumerate(lines[:30]):
            print(f"    {line}")
        if len(lines) > 30:
            print(f"    ... ({len(lines)} lines total)")
else:
    print("    ⚠ No files generated (parts may have no design layers with depth > 0)")

# ── Step 7: Validate ─────────────────────────────────────────
print("\n[7] Validation check...")
warnings = gen.validate_sheets([sheet])
if warnings:
    print(f"    ⚠ {len(warnings)} warning(s):")
    for w in warnings: print(f"      {w}")
else:
    print("    ✅ No warnings — all designs and tools valid")

print("\n" + "=" * 55)
print("✅  G-code Generator Test COMPLETE")
print("=" * 55)

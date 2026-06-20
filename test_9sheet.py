#!/usr/bin/env python3
"""
Test: Can the nesting engine achieve 9 sheets for 72 MDF parts?
Sheet: 1220×2440mm, margin=8mm, gap=6.5mm
Target: 9 sheets @ 90.83% utilization (matching Solid Edge 2D Nesting)
"""
import sys, os, time, threading
sys.path.insert(0, os.path.dirname(__file__))

from data_models import Part, Sheet
from nesting_engine import NestingEngine, SheetDef

# ── 72 parts from parts_export.csv ─────────────────────────────────────────
PARTS_RAW = [
    # (width, height, qty, code)
    (800,  500,  10, "A"),   # 800×500
    (986,  453,   5, "B"),   # 986×453
    (996,  325,   5, "C"),   # 996×325
    (566,  566,   3, "D"),   # 566×566
    (865,  300,   6, "E"),   # 865×300
    (678,  545,   5, "F"),   # 678×545
    (723,  545,   2, "G"),   # 723×545
    (723,  545,   2, "H"),   # 723×545 (copy)
    (765,  498,   6, "I"),   # 765×498
    (878,  347,   8, "J"),   # 878×347
    (2350,  66,   3, "K"),   # 66×2350 ANCHOR
    (2320, 543,   3, "L"),   # 543×2320 ANCHOR
    (545,  181,   8, "M"),   # 545×181
    (565,  231,   6, "N"),   # 565×231
]

def make_parts():
    parts = []
    for w, h, qty, code in PARTS_RAW:
        for i in range(qty):
            p = Part(part_code=f"{code}{i+1}", width=w, height=h)
            p.rotated = False
            p.status  = "pending"
            parts.append(p)
    return parts

def run_test(gap=6.5, margin=8.0, time_limit=60.0):
    parts = make_parts()
    print(f"Parts: {len(parts)} total")
    total_area = sum(float(p.width)*float(p.height) for p in parts)
    sheet_area = 1220*2440
    util_9 = total_area / (9*sheet_area) * 100
    print(f"Total part area: {total_area:,.0f} mm²")
    print(f"Theoretical utilization (9 sheets): {util_9:.2f}%")
    print()

    engine = NestingEngine()
    engine.gap    = gap
    engine.margin = margin
    engine.margin_left = engine.margin_right = engine.margin_top = engine.margin_bottom = margin
    engine.auto_rotate = True
    engine.target_sheets = 9

    # Portrait orientation: width=1220 (short), height=2440 (long)
    # → uw=1204mm (column stacking direction), uh=2424mm (column height)
    # This matches Solid Edge's NestLength convention
    sd = SheetDef(name="MDF", width=1220, height=2440,
                  thickness=18, material="MDF", quantity=999)
    engine.sheet_defs = [sd]

    stop_ev = threading.Event()
    t0 = time.time()

    print(f"Running nesting (gap={gap}mm, margin={margin}mm, time_limit={time_limit}s)...")
    result_sheets = engine.run_continuous(
        parts=parts,
        stop_event=stop_ev,
        time_limit=time_limit,
        population=10,
    )

    elapsed = time.time() - t0
    placed = sum(s.part_count() for s in result_sheets)
    total_placed_area = sum(
        float(p.actual_width()) * float(p.actual_height())
        for s in result_sheets for p in s.parts
    )
    global_util = total_placed_area / (len(result_sheets) * sheet_area) * 100

    print(f"\n{'='*60}")
    print(f"Result: {placed}/{len(parts)} parts in {len(result_sheets)} sheets")
    print(f"Global utilization: {global_util:.2f}%")
    print(f"Time: {elapsed:.1f}s")

    print(f"\nPer-sheet breakdown:")
    for i, s in enumerate(result_sheets):
        pnames = [p.part_code for p in s.parts]
        codes  = [c[0] for c in pnames]
        code_counts = {}
        for c in codes:
            code_counts[c] = code_counts.get(c, 0) + 1
        util = s.utilization()
        print(f"  Sheet {i+1}: {s.part_count()} parts — {dict(sorted(code_counts.items()))} — util={util:.1f}%")

    # Find overflow parts
    placed_ids = {id(p) for s in result_sheets for p in s.parts}
    overflow = [p for p in parts if id(p) not in placed_ids
                and not any(id(p)==id(pp) for s in result_sheets for pp in s.parts)]
    # Better: check by part_code
    placed_codes = {p.part_code for s in result_sheets for p in s.parts}
    overflow2 = [p for p in parts if p.part_code not in placed_codes]

    # Actually just check total
    if placed < len(parts):
        print(f"\nOVERFLOW: {len(parts)-placed} parts didn't fit!")
        # Count which codes are missing
        placed_counts = {}
        for s in result_sheets:
            for p in s.parts:
                c = p.part_code[0]
                placed_counts[c] = placed_counts.get(c, 0) + 1
        expected_counts = {code: qty for _,_,qty,code in PARTS_RAW}
        for code, exp in sorted(expected_counts.items()):
            got = placed_counts.get(code, 0)
            if got < exp:
                print(f"  {code}: placed {got}/{exp}")
    else:
        print(f"\n✅ ALL {len(parts)} PARTS PLACED IN {len(result_sheets)} SHEETS!")
        if len(result_sheets) <= 9:
            print(f"🎉 TARGET ACHIEVED: {len(result_sheets)} sheets ≤ 9!")
        else:
            print(f"❌ Too many sheets: {len(result_sheets)} > 9")

    return result_sheets, placed, len(parts)

if __name__ == "__main__":
    import random
    random.seed(42)
    run_test(gap=6.5, margin=8.0, time_limit=90.0)

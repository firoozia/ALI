#!/usr/bin/env python3
"""
Test column packing with portrait sheet (width=1220, height=2440).
Verify correct anchor placement and count best achievable sheets.
"""
import sys, os, time, random
sys.path.insert(0, os.path.dirname(__file__))

from data_models import Part
from nesting_engine import NestingEngine, SheetDef

PARTS_RAW = [
    (800,  500, 10, "A"),(986, 453, 5, "B"),(996, 325, 5, "C"),(566, 566, 3, "D"),
    (865,  300,  6, "E"),(678, 545, 5, "F"),(723, 545, 2, "G"),(723, 545, 2, "H"),
    (765,  498,  6, "I"),(878, 347, 8, "J"),(2350, 66, 3, "K"),(2320,543, 3, "L"),
    (545,  181,  8, "M"),(565, 231, 6, "N"),
]

def make_parts():
    parts = []
    for w,h,qty,code in PARTS_RAW:
        for i in range(qty):
            p = Part(part_code=f"{code}{i+1}",width=w,height=h)
            p.rotated=False; p.status="pending"
            parts.append(p)
    return parts

def main():
    parts = make_parts()
    engine = NestingEngine()
    engine.gap    = 6.5
    engine.margin = 8.0
    engine.margin_left=engine.margin_right=engine.margin_top=engine.margin_bottom=8.0
    engine.auto_rotate = True

    # PORTRAIT: width=1220 (short), height=2440 (long)
    sd = SheetDef(name="MDF", width=1220, height=2440,
                  thickness=18, material="MDF", quantity=999)
    engine.sheet_defs = [sd]

    print("=== Column packing (BFDC) ===")
    # Test with standard column sort order
    col_order = sorted(parts, key=lambda p: (
        -(1 if max(float(p.width)+6.5, float(p.height)+6.5) > 2424*0.85 else 0),
        -min(float(p.width)+6.5, float(p.height)+6.5),
        -max(float(p.width)+6.5, float(p.height)+6.5)
    ))

    sheets, overflow = engine._pack_column_budget(col_order, sd, 9)
    total = sum(s.part_count() for s in sheets)
    print(f"Column/9bins: {total}/{len(parts)} parts in {len(sheets)} sheets, overflow={len(overflow)}")

    for i,s in enumerate(sheets):
        codes = {}
        for p in s.parts:
            c = p.part_code[0]; codes[c]=codes.get(c,0)+1
        print(f"  Sheet {i+1}: {s.part_count()} parts — {dict(sorted(codes.items()))}")

    if overflow:
        print(f"  Overflow: {[(p.part_code, p.width, p.height) for p in overflow]}")

    print("\n=== BFDH packing ===")
    sheets2, overflow2 = engine._pack_bfdh_budget(col_order, sd, 9)
    total2 = sum(s.part_count() for s in sheets2)
    print(f"BFDH/9bins: {total2}/{len(parts)} parts in {len(sheets2)} sheets, overflow={len(overflow2)}")

    for i,s in enumerate(sheets2):
        codes = {}
        for p in s.parts:
            c = p.part_code[0]; codes[c]=codes.get(c,0)+1
        print(f"  Sheet {i+1}: {s.part_count()} parts — {dict(sorted(codes.items()))}")

    print("\n=== MaxRects with anchor-first order ===")
    from rectpack import newPacker, PackingMode, SORT_NONE, SORT_LSIDE
    from rectpack import MaxRectsBaf, MaxRectsBssf, MaxRectsBlsf

    # Try anchor-first SORT_NONE (9 bins)
    for algo_cls, sfunc, name in [
        (MaxRectsBaf, SORT_NONE, "BAF/None"),
        (MaxRectsBssf, SORT_LSIDE, "BSSF/LongSide"),
        (MaxRectsBlsf, SORT_LSIDE, "BLSF/LongSide"),
    ]:
        sheets3, overflow3 = engine._pack_maxrects_budget(col_order, algo_cls, sfunc, sd, 9)
        total3 = sum(s.part_count() for s in sheets3)
        print(f"  {name}: {total3}/{len(parts)} (overflow={len(overflow3)})")

    print("\n=== Random column packing ===")
    best = 0; best_sheets = None
    random.seed(42)
    for trial in range(10000):
        order = list(parts)
        random.shuffle(order)
        sheets4, ov4 = engine._pack_column_budget(order, sd, 9)
        n = sum(s.part_count() for s in sheets4)
        if n > best:
            best = n; best_sheets = sheets4
            print(f"  Trial {trial+1}: {n}/{len(parts)}")
        if n == len(parts):
            print("  ✅ SOLVED!")
            break

    if best_sheets:
        print(f"\nBest: {best}/{len(parts)}")
        for i,s in enumerate(best_sheets):
            codes = {}
            for p in s.parts:
                c = p.part_code[0]; codes[c]=codes.get(c,0)+1
            print(f"  Sheet {i+1}: {s.part_count()} parts — {dict(sorted(codes.items()))}")

if __name__ == "__main__":
    main()

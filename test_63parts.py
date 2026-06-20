#!/usr/bin/env python3
"""
Targeted test: Pack 63 non-anchor parts in 7 sheets.
After anchors (3K+3L+3A=9 parts) go on sheets 1-2,
the remaining 63 parts must fit in 7 sheets.
"""
import sys, os, time, random, threading
sys.path.insert(0, os.path.dirname(__file__))

from data_models import Part
from nesting_engine import NestingEngine, SheetDef
from rectpack import newPacker, PackingMode, SORT_NONE, SORT_AREA, SORT_LSIDE
from rectpack import MaxRectsBaf, MaxRectsBssf, MaxRectsBlsf, MaxRectsBl, SkylineMwf
from copy import deepcopy

# 63 remaining parts (after 3K+3L+3A placed on sheets 1-2)
PARTS_63 = [
    (800,  500,   7, "A"),   # 7 remaining (3 used on sheet 2)
    (986,  453,   5, "B"),
    (996,  325,   5, "C"),
    (566,  566,   3, "D"),
    (865,  300,   6, "E"),
    (678,  545,   5, "F"),
    (723,  545,   2, "G"),
    (723,  545,   2, "H"),
    (765,  498,   6, "I"),
    (878,  347,   8, "J"),
    (545,  181,   8, "M"),
    (565,  231,   6, "N"),
]

GAP    = 6.5
MARGIN = 8.0
UW     = 2440 - 2*MARGIN   # = 2424
UH     = 1220 - 2*MARGIN   # = 1204

def make_parts():
    parts = []
    for w, h, qty, code in PARTS_63:
        for i in range(qty):
            p = Part(part_code=f"{code}{i+1}", width=w, height=h)
            p.rotated = False
            p.status  = "pending"
            parts.append(p)
    return parts

def pack_one_bin_maxrects(parts_list, algo_cls, sort_func):
    """Pack one bin using rectpack. Returns (placed_count, remaining_parts)."""
    packer = newPacker(mode=PackingMode.Offline, pack_algo=algo_cls,
                       rotation=True, sort_algo=sort_func)
    packer.add_bin(UW, UH, count=1)
    for i, p in enumerate(parts_list):
        pw = float(p.width)  + GAP
        ph = float(p.height) + GAP
        if (pw <= UW and ph <= UH) or (ph <= UW and pw <= UH):
            packer.add_rect(pw, ph, rid=i)
    packer.pack()
    placed_ids = {rect[5] for rect in packer.rect_list()}
    placed = [parts_list[i] for i in placed_ids]
    remaining = [parts_list[i] for i in range(len(parts_list)) if i not in placed_ids]
    return len(placed), remaining

def pack_7_sheets(order, algo_cls=MaxRectsBaf, sort_func=SORT_NONE):
    """Pack ordered parts into 7 sheets. Returns (total_placed, overflow)."""
    remaining = list(order)
    total_placed = 0
    for _ in range(7):
        if not remaining:
            break
        cnt, remaining = pack_one_bin_maxrects(remaining, algo_cls, sort_func)
        total_placed += cnt
    return total_placed, remaining

def col_dim(p):
    """Returns (cw, ch) = (shorter+gap, longer+gap) for column packing."""
    w0 = float(p.width)  + GAP
    h0 = float(p.height) + GAP
    if h0 < w0:
        return h0, w0
    return w0, h0

def main():
    parts = make_parts()
    total = len(parts)
    total_area = sum(float(p.width)*float(p.height) for p in parts)
    print(f"63-part problem: {total} parts, area={total_area:,.0f}mm²")
    print(f"7 sheets usable: {7*UW*UH:,.0f}mm² — required util: {total_area/(7*UW*UH)*100:.1f}%")
    print()

    best_placed = 0
    best_overflow = list(parts)
    best_algo = ""

    algos = [
        (MaxRectsBaf,  SORT_NONE,  "BAF/Order"),
        (MaxRectsBaf,  SORT_AREA,  "BAF/Area"),
        (MaxRectsBssf, SORT_NONE,  "BSSF/Order"),
        (MaxRectsBssf, SORT_AREA,  "BSSF/Area"),
        (MaxRectsBlsf, SORT_LSIDE, "BLSF/LongSide"),
        (MaxRectsBl,   SORT_AREA,  "BL/Area"),
        (SkylineMwf,   SORT_NONE,  "Skyline/Order"),
    ]

    # ── Deterministic orderings ─────────────────────────────────────────
    orderings = []

    # 1. By column width descending (widest-col first)
    orderings.append(("cw-desc", sorted(parts, key=lambda p: -col_dim(p)[0])))

    # 2. By column height descending (tallest first)
    orderings.append(("ch-desc", sorted(parts, key=lambda p: -col_dim(p)[1])))

    # 3. By area desc (classic NFD)
    orderings.append(("area-desc", sorted(parts, key=lambda p: -float(p.width)*float(p.height))))

    # 4. By long side desc
    orderings.append(("lside-desc", sorted(parts, key=lambda p: -max(float(p.width),float(p.height)))))

    # 5. CH-descending then CW-descending within same CH bucket
    orderings.append(("ch-then-cw", sorted(parts, key=lambda p: (-col_dim(p)[1], -col_dim(p)[0]))))

    # 6. CW-desc then CH-desc
    orderings.append(("cw-then-ch", sorted(parts, key=lambda p: (-col_dim(p)[0], -col_dim(p)[1]))))

    # 7. Mix by row-sort: group by cw bucket, within each bucket sort by -ch
    def stripe_mixed(lst):
        s = sorted(lst, key=lambda p: (-col_dim(p)[1], -col_dim(p)[0]))
        # Interleave wide-cw and narrow-cw
        wide  = [p for p in s if col_dim(p)[0] >= 400]
        narrow = [p for p in s if col_dim(p)[0] < 400]
        result = []
        wi, ni = 0, 0
        while wi < len(wide) or ni < len(narrow):
            if wi < len(wide):
                result.append(wide[wi]); wi += 1
            if ni < len(narrow):
                result.append(narrow[ni]); ni += 1
        return result
    orderings.append(("stripe-mixed", stripe_mixed(parts)))

    # 8. Group by sheet-compatible column combos:
    # Idea: Put groups that sum to ~1204mm together
    def column_combo_sort(lst):
        # Sort by buckets to encourage 3-col sheets
        # Bucket: wide (cw≥500), medium-wide (350-500), medium-narrow (250-350), narrow (<250)
        def bucket(p):
            cw = col_dim(p)[0]
            if cw >= 500: return 0
            if cw >= 350: return 1
            if cw >= 250: return 2
            return 3
        return sorted(lst, key=lambda p: (bucket(p), -col_dim(p)[1]))
    orderings.append(("col-bucket", column_combo_sort(parts)))

    print("Testing deterministic orderings (all 7 algos each):")
    t0 = time.time()
    for name, order in orderings:
        for algo_cls, sort_func, algo_name in algos:
            placed, overflow = pack_7_sheets(order, algo_cls, sort_func)
            if placed > best_placed:
                best_placed = placed
                best_overflow = overflow
                best_algo = f"{name}/{algo_name}"
                if placed == total:
                    print(f"  ✅ {name}/{algo_name}: {placed}/{total} — SOLVED!")
        print(f"  {name}: best so far = {best_placed}/{total}")
    print(f"After deterministic: {best_placed}/{total} — algo: {best_algo}")
    print(f"Time: {time.time()-t0:.1f}s\n")

    if best_placed == total:
        return

    # ── Random search ──────────────────────────────────────────────────────
    print("Random search (5000 trials each for 2 best algos)...")
    search_algos = [(MaxRectsBaf, SORT_NONE), (MaxRectsBssf, SORT_AREA)]

    trials = 0
    t1 = time.time()
    while time.time() - t1 < 30.0:
        order = list(parts)
        random.shuffle(order)
        for algo_cls, sort_func in search_algos:
            placed, overflow = pack_7_sheets(order, algo_cls, sort_func)
            trials += 1
            if placed > best_placed:
                best_placed = placed
                best_overflow = overflow
                best_algo = f"random/{algo_cls.__name__}"
                print(f"  Trial {trials}: {placed}/{total} ({best_algo})")
            if placed == total:
                print(f"✅ SOLVED after {trials} trials!")
                return

    print(f"\nAfter {trials} random trials ({time.time()-t1:.1f}s): {best_placed}/{total}")
    if best_overflow:
        print("Overflow parts:")
        for p in best_overflow:
            cw, ch = col_dim(p)
            print(f"  {p.part_code}: {p.width}×{p.height} (cw={cw}, ch={ch})")

if __name__ == "__main__":
    random.seed(42)
    main()

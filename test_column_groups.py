#!/usr/bin/env python3
"""Test precise ordering targeting Solid Edge 9-sheet layout."""
import sys, os, random, time
sys.path.insert(0, os.path.dirname(__file__))
from data_models import Part, Sheet
from nesting_engine import NestingEngine, SheetDef
from rectpack import MaxRectsBaf, MaxRectsBssf, MaxRectsBlsf, MaxRectsBl
from rectpack import SORT_NONE, SORT_AREA, SORT_LSIDE
from copy import deepcopy

PARTS_RAW = [
    (800,  500,  10, "A"), (986,  453,   5, "B"), (996,  325,   5, "C"),
    (566,  566,   3, "D"), (865,  300,   6, "E"), (678,  545,   5, "F"),
    (723,  545,   2, "G"), (723,  545,   2, "H"), (765,  498,   6, "I"),
    (878,  347,   8, "J"), (2350,  66,   3, "K"), (2320, 543,   3, "L"),
    (545,  181,   8, "M"), (565,  231,   6, "N"),
]

def make_parts():
    parts = []
    for w, h, qty, code in PARTS_RAW:
        for i in range(qty):
            p = Part(part_code=f"{code}{i+1}", width=w, height=h)
            p.rotated = False; p.status = "pending"
            parts.append(p)
    return parts

ALGOS = [
    (MaxRectsBaf, SORT_NONE), (MaxRectsBaf, SORT_AREA),
    (MaxRectsBssf, SORT_NONE), (MaxRectsBssf, SORT_AREA),
    (MaxRectsBlsf, SORT_LSIDE), (MaxRectsBl, SORT_AREA),
]

def test_all(engine, sd, ordered, label, n=9):
    best_over = len(ordered); best_s = []; best_o = list(ordered)
    for algo, sfunc in ALGOS:
        s, o = engine._pack_maxrects_budget(ordered, algo, sfunc, sd, n)
        if len(o) < best_over:
            best_over = len(o); best_s = s; best_o = o
    placed = sum(sh.part_count() for sh in best_s)
    util = sum(float(p.actual_width())*float(p.actual_height()) for sh in best_s for p in sh.parts)
    gu = util / (len(best_s)*1220*2440)*100 if best_s else 0
    print(f"{label}: {placed}/{len(ordered)} in {len(best_s)} sh, {gu:.1f}%, over={best_over} {[p.part_code for p in best_o][:4]}")
    if best_over == 0:
        print("  *** 9-SHEET SUCCESS! ***")
        for i, sh in enumerate(best_s):
            cnts = {}
            for p in sh.parts: cnts[p.part_code[0]] = cnts.get(p.part_code[0],0)+1
            print(f"  S{i+1}: {sh.part_count()}p {dict(sorted(cnts.items()))} {sh.utilization():.1f}%")
    return best_over, best_s, best_o

def build_from_seq(all_parts, seq):
    """Build ordered list from sequence of codes."""
    by_code = {}
    for p in all_parts:
        c = p.part_code[0]
        by_code.setdefault(c, []).append(deepcopy(p))
    result = []
    for c in seq:
        if c in by_code and by_code[c]:
            result.append(by_code[c].pop(0))
    for lst in by_code.values():
        result.extend(lst)
    return result

def main():
    random.seed(42)
    parts = make_parts()
    engine = NestingEngine()
    engine.gap = 6.5; engine.margin = 8.0
    engine.margin_left = engine.margin_right = engine.margin_top = engine.margin_bottom = 8.0
    engine.auto_rotate = True
    sd = SheetDef(name="MDF", width=1220, height=2440, thickness=18, material="MDF", quantity=999)
    engine.sheet_defs = [sd]

    # Insight: K=66×2350 TALL can only go beside L(543×2320) if placed FIRST
    # (since K is taller than L, K at (0,0) → L can go beside K)
    # Ordering: K,L,L → sheet 1: K+L+L (=L+L+K pattern)
    #           K,L,F,F,F → sheet 2: K+L+F×3 pattern
    #           K + non-anchors → sheet 3: K + other parts

    print("=== Testing K-first anchor orderings ===")
    non_anc = [deepcopy(p) for p in parts if p.part_code[0] not in 'KL']
    non_anc_area = sorted(non_anc, key=lambda p: -float(p.width)*float(p.height))

    # K1,L1,L2 → sheet1; K2,L3,F×3 → sheet2; K3+rest
    na_codes = [p.part_code[0] for p in non_anc_area]
    seq1 = list('KLL') + list('KL') + list('FFF') + list('K') + na_codes
    test_all(engine, sd, build_from_seq(parts, seq1), "KLL+KL+FFF+K+rest")

    # K,L,L then K,L then K then F×5 then rest
    seq2 = list('KLL') + list('KLF') + list('KFFF') + na_codes
    test_all(engine, sd, build_from_seq(parts, seq2), "KLL+KLF+KFFF+rest")

    # K,L,L then non-anchors-area then K,L,F×3 then K
    seq3 = list('KLL') + na_codes[:20] + list('KL') + list('FFF') + na_codes[20:] + list('K')
    test_all(engine, sd, build_from_seq(parts, seq3), "KLL+na20+KLFFF+na+K")

    # K,L,L then F×3+K+L+K (seeds sheets 1 and 2)
    seq4 = list('KLL') + list('FFFKL') + list('K') + na_codes
    test_all(engine, sd, build_from_seq(parts, seq4), "KLL+FFFKL+K+rest")

    # All K first then all L, then non-anchors
    seq5 = list('KKK') + list('LLL') + na_codes
    test_all(engine, sd, build_from_seq(parts, seq5), "KKK+LLL+rest")

    # Pair K with L explicitly: K,L,K,L,K,L then non-anchors
    seq6 = list('KLKL') + list('KL') + na_codes
    test_all(engine, sd, build_from_seq(parts, seq6), "KLKLKL+rest")

    # Specific seed: K,L,L + K,L,F,F,F + K,D,D,D,N,A,A,A + rest
    seq7 = list('KLL') + list('KLFFF') + list('KDDDN') + list('AAA') + \
           list('AAAIIIAAAIIIAAAIII') + \
           list('GH') + list('GH') + \
           list('BJMBJMBJMBJMB') + \
           list('CEMCEMCEMCEMCE') + \
           list('JJJNNNN') + list('MM')
    test_all(engine, sd, build_from_seq(parts, seq7), "Specific-9-sheet-design")

    # Also test with BFDC column packing
    print("\n=== Column packing (BFDC) with K-first ===")
    for label, seq in [
        ("KLL+KLFFF+KDDDN+AIII+rest", list('KLL')+list('KLFFF')+list('KDDDN')+list('AAAIIIAAAIIIAAAIIIAA')+list('GGHH')+list('FF')+list('BJMBJMBJMBJMB')+list('CEMCEMCEMCEMCE')+list('JJJNNNNNN')+list('MM')),
        ("KLL+rest(area)", list('KLL')+list('KL')+list('K')+na_codes),
    ]:
        o = build_from_seq(parts, seq)
        s, ov = engine._pack_column_budget(o, sd, 9)
        placed = sum(sh.part_count() for sh in s)
        util = sum(float(p.actual_width())*float(p.actual_height()) for sh in s for p in sh.parts)
        gu = util / (len(s)*1220*2440)*100 if s else 0
        print(f"BFDC {label}: {placed}/{len(o)} in {len(s)} sh, {gu:.1f}%, over={[p.part_code for p in ov][:4]}")

    # Randomized search: K first in specific positions
    print("\n=== Randomized search: K first, L in top 3 slots ===")
    ls_p = [deepcopy(p) for p in parts if p.part_code[0]=='L']
    ks_p = [deepcopy(p) for p in parts if p.part_code[0]=='K']
    fs_p = [deepcopy(p) for p in parts if p.part_code[0]=='F']
    rest_p = [deepcopy(p) for p in parts if p.part_code[0] not in 'KLF']

    best_over = len(parts); t0 = time.time()
    for trial in range(500):
        rest2 = [deepcopy(p) for p in rest_p]; random.shuffle(rest2)
        # Try different anchor ordering with fixed F right after anchors
        anchor_seqs = [
            [deepcopy(p) for p in ks_p[:1]+ls_p[:2]+ks_p[1:2]+ls_p[2:3]+fs_p[:3]+ks_p[2:]],
            [deepcopy(p) for p in ks_p[:1]+ls_p[:2]+ks_p[1:2]+ls_p[2:3]+ks_p[2:]+fs_p[:3]],
            [deepcopy(p) for p in ks_p[:1]+ls_p[:2]+ls_p[2:]+fs_p[:3]+ks_p[1:]],
        ]
        for anc_ord in anchor_seqs:
            for algo, sfunc in [(MaxRectsBaf, SORT_NONE), (MaxRectsBaf, SORT_AREA),
                                (MaxRectsBssf, SORT_NONE)]:
                ordered_r = anc_ord + [deepcopy(p) for p in fs_p[3:]] + rest2
                s, o = engine._pack_maxrects_budget(ordered_r, algo, sfunc, sd, 9)
                if len(o) < best_over:
                    best_over = len(o)
                    best_ord_r = ordered_r; best_s_r = s; best_o_r = o
                    print(f"  Trial {trial}: over={best_over} {[p.part_code for p in o]}")
                    if best_over == 0:
                        print("  *** SUCCESS ***")
                        for i, sh in enumerate(s):
                            cnts = {}
                            for p in sh.parts: cnts[p.part_code[0]] = cnts.get(p.part_code[0],0)+1
                            print(f"  S{i+1}: {sh.part_count()}p {dict(sorted(cnts.items()))} {sh.utilization():.1f}%")
                        break
                if best_over == 0: break
            if best_over == 0: break
        if best_over == 0: break

    print(f"Best: over={best_over} in {time.time()-t0:.1f}s")

if __name__ == "__main__":
    main()

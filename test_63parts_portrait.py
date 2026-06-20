#!/usr/bin/env python3
"""Test 63 non-anchor parts in 7 sheets with PORTRAIT orientation (uw=1204, uh=2424)."""
import sys, os, time, random
sys.path.insert(0, os.path.dirname(__file__))

from data_models import Part
from nesting_engine import NestingEngine, SheetDef

PARTS_63 = [
    (800,500,7,"A"),(986,453,5,"B"),(996,325,5,"C"),(566,566,3,"D"),
    (865,300,6,"E"),(678,545,5,"F"),(723,545,2,"G"),(723,545,2,"H"),
    (765,498,6,"I"),(878,347,8,"J"),(545,181,8,"M"),(565,231,6,"N"),
]

def make_parts():
    parts=[]
    for w,h,qty,code in PARTS_63:
        for i in range(qty):
            p=Part(part_code=f"{code}{i+1}",width=w,height=h)
            p.rotated=False; p.status="pending"
            parts.append(p)
    return parts

def main():
    parts=make_parts()
    engine=NestingEngine()
    engine.gap=6.5; engine.margin=8.0
    engine.margin_left=engine.margin_right=engine.margin_top=engine.margin_bottom=8.0
    engine.auto_rotate=True

    # PORTRAIT: uw=1204mm, uh=2424mm
    sd=SheetDef(name="MDF",width=1220,height=2440,thickness=18,material="MDF",quantity=999)
    engine.sheet_defs=[sd]

    print(f"63 parts in portrait 1220×2440 (uw=1204, uh=2424)")
    print(f"Total area: {sum(p.width*p.height for p in parts):,.0f}mm²")
    print(f"7-bin capacity (usable): {7*1204*2424:,.0f}mm²")
    print()

    best=0; best_info=""

    def col_dim(p):
        w0=float(p.width)+6.5; h0=float(p.height)+6.5
        return (h0,w0) if h0<w0 else (w0,h0)

    orderings=[
        ("cw-desc",    sorted(parts,key=lambda p:-col_dim(p)[0])),
        ("ch-desc",    sorted(parts,key=lambda p:-col_dim(p)[1])),
        ("area-desc",  sorted(parts,key=lambda p:-p.width*p.height)),
        ("lside-desc", sorted(parts,key=lambda p:-max(p.width,p.height))),
        ("cw-asc",     sorted(parts,key=lambda p:col_dim(p)[0])),   # narrowest-col-first
        ("ch-asc",     sorted(parts,key=lambda p:col_dim(p)[1])),   # shortest-col-first
        ("width-desc", sorted(parts,key=lambda p:-p.width)),
        ("height-desc",sorted(parts,key=lambda p:-p.height)),
    ]

    print("=== Column packing (BFDC) ===")
    for name,order in orderings:
        sheets,ov=engine._pack_column_budget(order,sd,7)
        n=sum(s.part_count() for s in sheets)
        if n>best:
            best=n; best_info=f"COL/{name}"
            print(f"  {n}/{len(parts)}: {name}")
            for i,s in enumerate(sheets):
                codes={};
                [codes.__setitem__(p.part_code[0],codes.get(p.part_code[0],0)+1) for p in s.parts]
                print(f"    Sheet {i+1}: {s.part_count()} parts {dict(sorted(codes.items()))}")
            if ov:
                print(f"    Overflow: {[(p.part_code,p.width,p.height) for p in ov]}")
        if n==len(parts):
            print("  ✅ SOLVED!"); return

    print(f"\n=== BFDH ===")
    for name,order in orderings:
        sheets2,ov2=engine._pack_bfdh_budget(order,sd,7)
        n2=sum(s.part_count() for s in sheets2)
        if n2>best:
            best=n2; best_info=f"BFDH/{name}"
            print(f"  {n2}/{len(parts)}: {name}")
            if ov2:
                print(f"    Overflow: {[(p.part_code,p.width,p.height) for p in ov2]}")
        if n2==len(parts):
            print("  ✅ BFDH SOLVED!"); return

    print(f"\n=== MaxRects ===")
    from rectpack import newPacker,PackingMode,SORT_NONE,SORT_AREA,SORT_LSIDE
    from rectpack import MaxRectsBaf,MaxRectsBssf,MaxRectsBlsf,MaxRectsBl

    for algo_cls,sfunc,aname in [
        (MaxRectsBaf,SORT_NONE,"BAF/None"),(MaxRectsBaf,SORT_AREA,"BAF/Area"),
        (MaxRectsBssf,SORT_LSIDE,"BSSF/LongSide"),(MaxRectsBlsf,SORT_LSIDE,"BLSF/LongSide"),
    ]:
        for oname,order in orderings:
            sheets3,ov3=engine._pack_maxrects_budget(order,algo_cls,sfunc,sd,7)
            n3=sum(s.part_count() for s in sheets3)
            if n3>best:
                best=n3; best_info=f"MR/{aname}/{oname}"
                print(f"  {n3}/{len(parts)}: {aname}/{oname}")
                if ov3:
                    print(f"    Overflow: {[(p.part_code,p.width,p.height) for p in ov3]}")
            if n3==len(parts):
                print(f"  ✅ MaxRects SOLVED!"); return

    print(f"\n=== Random column (30s) ===")
    t0=time.time(); trials=0
    while time.time()-t0 < 30.0:
        order=list(parts); random.shuffle(order)
        sheets4,ov4=engine._pack_column_budget(order,sd,7)
        n4=sum(s.part_count() for s in sheets4)
        trials+=1
        if n4>best:
            best=n4; best_info=f"RAND_COL trial {trials}"
            print(f"  Trial {trials}: {n4}/{len(parts)}")
            if ov4:
                print(f"    Overflow: {[(p.part_code,p.width,p.height) for p in ov4]}")
        if n4==len(parts):
            print(f"  ✅ SOLVED at trial {trials}!"); return
    print(f"After {trials} trials ({time.time()-t0:.1f}s): best={best}/{len(parts)}")

if __name__=="__main__":
    random.seed(42)
    main()

#!/usr/bin/env python3
"""
Try multi-bin rectpack approach for 63 parts in 7 sheets.
Also try column-based approaches with better column grouping.
"""
import sys, os, time, random
sys.path.insert(0, os.path.dirname(__file__))

from data_models import Part
from rectpack import newPacker, PackingMode, SORT_NONE, SORT_AREA, SORT_LSIDE, SORT_PERI
from rectpack import MaxRectsBaf, MaxRectsBssf, MaxRectsBlsf, MaxRectsBl, SkylineMwf
from copy import deepcopy

PARTS_63 = [
    (800,500,7,"A"),(986,453,5,"B"),(996,325,5,"C"),(566,566,3,"D"),
    (865,300,6,"E"),(678,545,5,"F"),(723,545,2,"G"),(723,545,2,"H"),
    (765,498,6,"I"),(878,347,8,"J"),(545,181,8,"M"),(565,231,6,"N"),
]
GAP=6.5; MARGIN=8.0
# Sheet is 2440×1220mm, rotated so long side = height in layout
# In the engine: SheetDef(width=2440, height=1220) → uw=2440-2*8=2424, uh=1220-2*8=1204
# But parts need to fit. K=66×2350 → padded 72.5×2356.5, rotated to 2356.5 wide > UW=2424? No.
# Wait: uw=2424mm is height in physical sheet. uh=1204mm is width.
# Let me check: in nesting engine, packer.add_bin(uw, uh) where:
# uw = sheet_def.width - ml - mr = 2440 - 8 - 8 = 2424
# uh = sheet_def.height - mt - mb = 1220 - 8 - 8 = 1204
# So the rectpack bin is 2424 × 1204 mm.
# Parts fit if pw <= 2424 AND ph <= 1204, or rotated: ph <= 2424 AND pw <= 1204
UW=2424; UH=1204  # rectpack bin dimensions

def make_parts():
    parts=[]
    for w,h,qty,code in PARTS_63:
        for i in range(qty):
            p=Part(part_code=f"{code}{i+1}",width=w,height=h)
            p.rotated=False; p.status="pending"
            parts.append(p)
    return parts

def pack_multibin(parts_list, algo_cls, sort_func, n_bins=7):
    """Use rectpack with multiple bins simultaneously."""
    packer = newPacker(mode=PackingMode.Offline, pack_algo=algo_cls,
                       rotation=True, sort_algo=sort_func)
    for _ in range(n_bins):
        packer.add_bin(UW, UH, count=1)
    for i,p in enumerate(parts_list):
        pw=float(p.width)+GAP; ph=float(p.height)+GAP
        if (pw<=UW and ph<=UH) or (ph<=UW and pw<=UH):
            packer.add_rect(pw,ph,rid=i)
    packer.pack()
    placed_ids={r[5] for r in packer.rect_list()}
    overflow=[parts_list[i] for i in range(len(parts_list)) if i not in placed_ids]
    return len(placed_ids), overflow

def pack_sequential(parts_list, algo_cls, sort_func, n_bins=7):
    """Sequential single-bin packing."""
    remaining=list(parts_list)
    total_placed=0
    for _ in range(n_bins):
        if not remaining: break
        packer=newPacker(mode=PackingMode.Offline,pack_algo=algo_cls,
                         rotation=True,sort_algo=sort_func)
        packer.add_bin(UW,UH,count=1)
        for i,p in enumerate(remaining):
            pw=float(p.width)+GAP; ph=float(p.height)+GAP
            if (pw<=UW and ph<=UH) or (ph<=UW and pw<=UH):
                packer.add_rect(pw,ph,rid=i)
        packer.pack()
        placed_ids={r[5] for r in packer.rect_list()}
        total_placed+=len(placed_ids)
        remaining=[remaining[i] for i in range(len(remaining)) if i not in placed_ids]
    return total_placed, remaining

def main():
    parts=make_parts()
    total=len(parts)
    print(f"63 parts, UW={UW}, UH={UH}")
    print(f"Total area: {sum(p.width*p.height for p in parts):,.0f}mm²")
    print(f"7-bin capacity: {7*UW*UH:,.0f}mm²")
    print()

    best=0; best_info=""

    algos=[
        (MaxRectsBaf,SORT_NONE,"BAF/None"),
        (MaxRectsBaf,SORT_AREA,"BAF/Area"),
        (MaxRectsBssf,SORT_NONE,"BSSF/None"),
        (MaxRectsBssf,SORT_AREA,"BSSF/Area"),
        (MaxRectsBssf,SORT_LSIDE,"BSSF/LongSide"),
        (MaxRectsBlsf,SORT_LSIDE,"BLSF/LongSide"),
        (MaxRectsBl,SORT_AREA,"BL/Area"),
    ]

    def col_dim(p):
        w0=float(p.width)+GAP; h0=float(p.height)+GAP
        return (h0,w0) if h0<w0 else (w0,h0)

    orderings=[
        ("area-desc", sorted(parts,key=lambda p:-p.width*p.height)),
        ("lside-desc", sorted(parts,key=lambda p:-max(p.width,p.height))),
        ("ch-desc",    sorted(parts,key=lambda p:-col_dim(p)[1])),
        ("cw-desc",    sorted(parts,key=lambda p:-col_dim(p)[0])),
        ("peri-desc",  sorted(parts,key=lambda p:-(p.width+p.height))),
        ("height-desc",sorted(parts,key=lambda p:-p.height)),
        ("width-desc", sorted(parts,key=lambda p:-p.width)),
    ]

    print("=== MULTI-BIN (all 7 bins at once) ===")
    for oname,order in orderings:
        for algo_cls,sort_func,aname in algos:
            n,ov=pack_multibin(order,algo_cls,sort_func)
            if n>best:
                best=n; best_info=f"MULTI/{oname}/{aname}"
                print(f"  {best}/{total}: {best_info}")
            if n==total:
                print(f"✅ SOLVED!")
                return
    print(f"Multi-bin best: {best}/{total}")

    print("\n=== SEQUENTIAL (bin by bin) ===")
    for oname,order in orderings:
        for algo_cls,sort_func,aname in algos:
            n,ov=pack_sequential(order,algo_cls,sort_func)
            if n>best:
                best=n; best_info=f"SEQ/{oname}/{aname}"
                print(f"  {best}/{total}: {best_info}")
            if n==total:
                print(f"✅ SOLVED!")
                return
    print(f"Sequential best: {best}/{total}")

    # Try random with multi-bin
    print("\n=== RANDOM MULTI-BIN (20s) ===")
    t0=time.time(); trials=0
    while time.time()-t0 < 20:
        order=list(parts); random.shuffle(order)
        for algo_cls,sort_func,_ in algos[:4]:
            n,ov=pack_multibin(order,algo_cls,sort_func)
            trials+=1
            if n>best:
                best=n; best_info=f"RAND-MULTI/{algo_cls.__name__}"
                print(f"  Trial {trials}: {best}/{total} ({best_info})")
            if n==total:
                print(f"✅ SOLVED after {trials} trials!")
                return
    print(f"Random multi-bin best: {best}/{total} after {trials} trials")

    # ── Now test BFDC (column packing) with different sort orders ──────────
    print("\n=== COLUMN PACKING (BFDC) with various sorts ===")
    from nesting_engine import NestingEngine, SheetDef
    engine=NestingEngine()
    engine.gap=GAP; engine.margin=MARGIN
    engine.margin_left=engine.margin_right=engine.margin_top=engine.margin_bottom=MARGIN
    engine.auto_rotate=True
    sd=SheetDef(name="MDF",width=2440,height=1220,thickness=18,material="MDF",quantity=999)
    engine.sheet_defs=[sd]

    for oname,order in orderings:
        sheets,overflow=engine._pack_column_budget(order,sd,7)
        n=sum(s.part_count() for s in sheets)
        if n>best:
            best=n; best_info=f"COL/{oname}"
            print(f"  {best}/{total}: {best_info}")
        if n==total:
            print(f"✅ COLUMN SOLVED!")
            return

    print(f"\nFinal best: {best}/{total}")

if __name__ == "__main__":
    random.seed(42)
    main()

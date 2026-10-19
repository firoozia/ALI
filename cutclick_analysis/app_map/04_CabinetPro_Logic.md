# Cabinet Pro — Cut-List Logic (reverse-engineered)

App: "Cabinet & Cupboard Cut List" / "Cabinet Pro - Workshop Edition",
package `com.cabinetpro.cutlist`. Standalone, offline Jetpack-Compose + Kotlin,
R8-obfuscated into `defpackage/`. All part-sizing math runs locally on-device.

> **Confidence legend:** **[confirmed]** = read directly from decompiled bytecode logic.
> **[inferred]** = deduced from naming / context, not 100% provable through obfuscation.
> All dimensions are in millimetres unless the user switches the unit to inches
> (unit enum `nj2`: `nj2.d` = mm (default), `nj2.m` = in — display/convert only; math is unit-agnostic).

---

## Overview

The app models a cabinet as a single **unit** (overall Height × Width × Depth +
one material thickness) plus an **interior layout tree** of compartments,
shelves, vertical dividers and drawers, plus a set of **door zones**. From these
it generates a flat list of rectangular **cut boards** (`z30`), groups identical
ones into **cut-list rows** (`a40`), computes **door panels** separately
(`lq2.a()` → `oa0`), and can **nest** them onto sheet stock and **export** CSV/PDF.

Key classes:

| Obf. class | Role | Fields |
|---|---|---|
| `m90` | **Unit dimensions** | `a`=height, `b`=width, `c`=depth, `d`=thickness (all `int`, mm). `toString`="Dimensions(...)" |
| `nk1` | **Part-type enum** | SIDE0, TOP1, BOTTOM2, SHELF3, VERTICAL4, BACK5, DRAWER_FRONT6, DRAWER_SIDE7, DRAWER_BACK8, DRAWER_BOTTOM9 |
| `z30` | **Cut board (a single part)** | `a`=id(UUID), `b`=type(`nk1`), `c`=mode("Single"…), `d`=width, `e`=height, `f`=depth/thickness. `toString`="CutBoard(...)" |
| `a40` | **Cut-list row (grouped)** | `a`=name, `b`=size "WxH", `c`=qty, `d`=type/material. `toString`="CutItem(...)" |
| `w30` | **Custom/extra part** (user-added) | name, label, width, height, qty → type "Extra" |
| `lq2` | **Zone door** | bounds, doorType(`wa0`), fittingStyle(`vj0`), reveal `h`, thickness `i`, cabW `j`, cabH `k`, 4 dual-edge flags |
| `oa0` | **Door calc result** | panelCount, panelWidthMm, panelHeightMm, panelThicknessMm, gapMm, description |
| `al` | **Door panel board item** | widthMm, heightMm, thicknessMm, qty, material, type |
| `wa0` | **Door type enum** | NONE, SINGLE_LEFT, SINGLE_RIGHT, DOUBLE |
| `vj0` | **Door fitting enum** | OVERLAY(0) ("Overlay (Face)"), INSET(1) ("Inset (Flush)") |
| `t71` | **Material enum** | MDF 18/16, Plywood 18/15, Particleboard 16/18, Solid Wood 20 (label only) |
| `um1`/`dk1` | nesting **PlacedPart** / **PackNode** | x,y,w,h,isRotated,grain / w,h,grain,thickness |

The carcass generator is `s30.x(double sheetLen)` (the cut-list ViewModel, class
`s30`); the geometry helpers are static methods on `i10` (`M`,`L`,`q`,`O`,`V`,`s`,`D`,`N`).

**Default unit:** `m90(2000, 1200, 560, 18)` → H=2000, W=1200, D=560, **T=18 mm**.
Default material MDF_18; default sheet length "2440"; default unit mm. **[confirmed]**

---

## Part model

A part is a `z30` = **CutBoard(id, type, mode, width `d`, height `e`, depth `f`)**.
- There is **no quantity field on a part** — quantity comes from grouping identical
  boards later (rows with the same type and same `width×height`).
- The third dimension `f` ("depth") is used as the **board thickness** for every
  carcass part (always passed the unit thickness T). So each part is effectively
  `width × height × thickness`.
- **No per-part material, grain, edge-band, or groove field.** Material/grain are
  attached only at the row/sheet level (see Materials/Sheets). **[confirmed]**

`kk1` (the class in the brief) is just a generic 2-tuple `Pair(d, m)`; `sb` case 4
labels a part `"<TypeName> (<index>)"` where the tuple carries `(nk1 type, index)`.
It is **not** the part-with-dimensions model — that is `z30`.

---

## Unit → Parts formulas (per part type)

All taken from `s30.x()` + `i10.{M,L,O,V}`. `z30(type, W, H, THK)` = (width, height, thickness).

### Derived quantities (top of `s30.x`) **[confirmed]**
```
H = unit.height          # m90.a
W = unit.width           # m90.b
D = unit.depth           # m90.c
T = unit.thickness       # m90.d   (single global thickness, default 18)
backPly = state.c        # integer from the "Back Ply" control, default 0   [inferred name]

effDepth  = max(1, D - backPly)     # carcass panel depth (sides/top/bottom/shelf)
interiorW = max(0, W - 2*T)
interiorH = max(0, H - 2*T)
```

### SIDE  (`nk1.d`, ×2)  — `i10.M` **[confirmed]**
```
Side = z30(SIDE, width=effDepth, height=H, thickness=T)      # 2 pieces
```
Full-height gable; its "width" is the carcass depth. If the back is split into two
heights `h1,h2` (tall-cabinet case, see BACK), the two sides are each split too:
`2×(effDepth × h1 × T)` + `2×(effDepth × h2 × T)`.

### TOP (`nk1.m`, ×1) and BOTTOM (`nk1.n`, ×1) — `i10.q` in `x()` **[confirmed]**
```
Top    = z30(TOP,    width=interiorW, height=effDepth, thickness=T)
Bottom = z30(BOTTOM, width=interiorW, height=effDepth, thickness=T)
```
**Frameless/Euro**: top & bottom sit *between* the sides, so width = W − 2T.
With vertical dividers present, top & bottom are instead emitted as **segments**:
for each gap between dividers a Top and a Bottom of `width = segmentSpan`.

### BACK (`nk1.q`, ×1) — `i10.L` **[confirmed]**
```
Back = z30(BACK, width=W, height=H, thickness=T)       # FULL overlay back
```
The back is a **full-overlay panel of the whole W × H**, thickness = T (not a thin
ply; same board thickness). Carcass panel depth is reduced by `backPly` so the back
lands on the rear face. **No rebate/groove** is cut for it. If `kk1Var≠null` the back
is split into two panels `W × h1` and `W × h2` (tall cabinets exceeding usable height).

### VERTICAL / divider (`nk1.p`, ×n) — `i10.O` **[confirmed]**
```
Vertical = z30(VERTICAL, width=dividerDepth, height=verticalSpan, thickness=T)
# dividerDepth = divider's own stored depth, else effDepth
# verticalSpan = interior height region the divider occupies (p91.d - p91.b)
```

### SHELF (`nk1.o`, ×n) — `i10.O` **[confirmed]**
```
Shelf = z30(SHELF, width=shelfSpan, height=shelfDepth, thickness=T)
# shelfSpan  = interior width of the compartment (p91.c - p91.a)
# shelfDepth = shelf's own stored depth, else effDepth   (no fixed setback constant)
```
Shelves are split into segments where vertical dividers cross the compartment.
Shelf positions come from the layout tree (auto-spaced), not a simple count formula.

### DRAWERS — `i10.O`, `h82` branch (per compartment, n = drawer-front count) **[confirmed]**
Let opening = compartment interior rectangle: `openingW`, `openingH`; `D` = carcass depth param (effDepth).
```
drawerBoxW   = max(1, openingW - 26 - 2*T)              # front & back width
sideLen      = max(1, D - 50)                           # side length & bottom width
frontHeight  = max(1, (openingH - (n+1)*25) / n)        # each drawer's height
bottomLen    = drawerBoxW + 2*T  ( = openingW - 26 )    # bottom length

per drawer (×n):
  DrawerFront  = z30(DRAWER_FRONT,  width=drawerBoxW,  height=frontHeight, thickness=T)
  DrawerSide   = z30(DRAWER_SIDE,   width=sideLen,     height=frontHeight, thickness=T)   # ×2
  DrawerBack   = z30(DRAWER_BACK,   width=drawerBoxW,  height=frontHeight, thickness=T)
  DrawerBottom = z30(DRAWER_BOTTOM, width=sideLen,     height=bottomLen,   thickness=T)
```
**Fixed drawer constants [confirmed]:**
- `26` mm = total side clearance between drawer box and opening (≈13 mm per side — slide clearance).
- `50` mm = depth reduction (drawer box length = cabinet depth − 50).
- `25` mm = vertical gap allowance per drawer; total `(n+1)×25` removed from opening height before dividing by n.
- Drawer bottom is a **full flat panel** (`sideLen × (openingW−26)`), **not grooved** into the box.
- `DRAWER_FRONT`/`DRAWER_BACK` here are the **drawer-box** front/back. The visible
  drawer **face** is produced by the door-panel path below (overlay/inset).

### DOORS — `lq2.a()` → `oa0`; emitted as rows "Door Panel (qty)" **[confirmed]**
Per door zone: opening rect (`openingW`,`openingH`), reveal/gap `R` (`revealGapMm`), thickness `T`.
```
if fitting == INSET:
    panelW = max(1, openingW - 2*R)
    panelH = max(1, openingH - 2*R)

if fitting == OVERLAY:
    # per-edge overhang from lq2.c():
    #   edge at outer cabinet boundary (or marked dual):  overhang = max(0, T - R/2)
    #   internal shared edge:                             overhang = max(0, T/2 - R/2)
    panelW = openingW + leftOverhang + rightOverhang
    panelH = openingH + topOverhang  + bottomOverhang

by doorType:
  NONE         -> no panel
  SINGLE_LEFT  -> 1 panel: panelW × panelH
  SINGLE_RIGHT -> 1 panel: panelW × panelH
  DOUBLE       -> 2 panels: each width = max(0,(panelW - R)/2), height = panelH   # R = centre gap
```
So **overlay** doors are *larger* than the opening (they cover the carcass edge by
~T, less half the reveal); **inset** doors are *smaller* by one reveal each side.
Door panel thickness = `T`; gap carried = `R`.

---

## Construction method & options

- **Frameless / European (32-mm-style) carcass only.** No face-frame parts exist
  (no stile/rail/face-frame types in `nk1`). **[confirmed]**
- **Top/bottom captured between the sides** (W − 2T); sides run full height. **[confirmed]**
- **Back = full-overlay applied panel** (W × H × T); carcass depth reduced by the
  "Back Ply" value so the back sits on the rear. **No grooved/rebated back option.** **[confirmed logic; "Back Ply" name inferred]**
- **Doors:** fitting style per zone — **Overlay (Face)** vs **Inset (Flush)** (`vj0`);
  door type **None / Single Left / Single Right / Double** (`wa0`). **[confirmed]**
- **User-settable parameters** (Size / Doors tabs, Compose literals found):
  - Overall **Width / Height / Depth** (`m90`).
  - **Material Thickness** (single global T; label "Material Thickness:"). **[confirmed]**
  - **Reveal / gap** per door zone (`revealGapMm`, R). **[confirmed]**
  - **Back Ply** numeric (reduces carcass depth). **[confirmed control exists; mapping to `state.c` inferred]**
  - Shelves, vertical dividers and drawers are edited via the interior layout
    (compartment tree `h82`), not simple global counts. Shelf/divider counts and
    positions come from that tree. **[confirmed structurally]**
- **Drawer clearances are hard-coded constants** (26 / 50 / 25 mm) — not user-settable. **[confirmed]**

---

## Materials / Sheets

- **Material enum `t71`** (label strings only, default **MDF_18**):
  `MDF 18mm`, `MDF 16mm`, `Plywood 18mm`, `Plywood 15mm`, `Particleboard 16mm`,
  `Particleboard 18mm`, `Solid Wood 20mm`. **[confirmed]**
  - Material is attached to cut-list rows/door panels as a **text label only**.
    The thickness used in *all* geometry is the global `m90.d` (Material Thickness
    control), **not** derived from the material name. The "18mm" in the name is
    cosmetic. **[confirmed]**
- **Sheet stock:** user sets **Sheet W** and **Sheet H** (controls "Sheet W",
  "Sheet H", "Sheet Size (…)"), chosen from presets (`tn1`). A **sheet length**
  string drives `x()`, **default 2440 mm** (standard 8-ft panel). **[confirmed]**
- **Nesting / packing:** parts are packed onto sheets (`dk1 PackNode`,
  `um1 PlacedPart`) honouring **grain direction** and a **cutting-direction strategy**
  ("Width Cut" / width-first vs long-cut, "mixed vs fixed cutting direction" — an
  advanced/premium nesting option). Warning emitted: "Sheet is too small for these
  piece(s), so they are not shown in sheet layout." **[confirmed]**
- **Grain** is a *nesting/layout* property (orientation on the sheet; PDF shows
  ↑/→/↕ Grain arrows), **not** a per-cut-part attribute of the cut list. 32 "wood NN.png"
  textures / "30+ HD textures" are a cosmetic 3D/premium feature. **[confirmed]**

---

## Export format

Two export paths, both via `FileProvider` + `Intent.createChooser`:

### CSV — `qy.java` / `s30.v(unit)` **[confirmed]**
- File `CutList_<timestamp>.csv`, MIME `text/csv`, chooser title "Share Cut List CSV".
- Header row:
  ```
  #,Part Name,Width (mm),Height/Depth (mm),Qty,Type
  ```
  (unit label switches to `in` when inches selected).
- One row per grouped part: `index, name, width, height, qty, type`.
  - `name` is e.g. "Side (2)", "Shelf (4)", "Door Panel (2)".
  - `type` = construction mode / material ("Single", "Mixed", or a material label; "Extra" for user-added custom parts).

### PDF — `x40.java` **[confirmed]**
- A4 **portrait** (595×842) "CUTTING LIST" pages (and "CUTTING LIST (cont.)").
  Table columns:
  ```
  [ Part Name, Size (W × H mm), Qty, Type ]
  ```
- Plus **landscape** (842×595) **sheet-layout / nesting diagram** pages drawing each
  placed part with grain arrows (↑ / → / ↕ Grain).
- MIME `application/pdf`, chooser title "Share PDF". Default project title "Cupboard Project".

---

## What it lacks (edge-band / groove) — important for the user

- **No edge-banding (نوار / PVC tape).** There is **no edge-band field, flag, edge
  count, or edge-length calculation** anywhere. No part (`z30`), row (`a40`), door
  panel (`al`), or nesting node (`dk1`/`um1`) carries any "edge", "banding", or "tape"
  attribute. A grep for edgeband/tape/banding returns nothing. **[confirmed absent]**
- **No groove / dado / rebate / rabbet (شیار).** Joinery is pure butt/overlay:
  - Back is an **overlaid full panel**, never grooved or rebated into the sides.
  - Shelves are plain boards (no dado housings; no setback groove).
  - Drawer bottoms are **full flat panels**, not captured in a groove.
  A grep for groove/dado/rebate/rabbet finds **no cabinet feature** (only unrelated
  tokens). **[confirmed absent]**
- **Thickness is a single global value**, not per-part or per-material; you cannot
  mix (e.g. 18 mm carcass + 4 mm back) — "Back Ply" only shifts depth, the back board
  is still emitted at the global T. **[confirmed]**
- **No kerf/saw-blade width** is subtracted in the part math (kerf, if any, lives only
  in the nesting layer, not in part sizes). **[inferred — not found in `x()`]**
- **Grain is not tracked per cut part** in the list — only as a sheet-nesting direction. **[confirmed]**

---

## Caveats on recoverability

- The **shelf/divider positioning** and the **back-split threshold** come from the
  interior layout tree (`h82`/`p82`/`o91`/`p91`/`r40`) and the sheet-length cutoff
  `d` passed to `x()`; the *panel sizes* are fully recovered above, but the exact
  *auto-spacing* of shelves and *when* a tall cabinet triggers a back/side split is
  governed by that tree and a usable-height check (`i10.W`, constants ~26/50 mm seen
  in `O`) and is only partially reconstructable through the obfuscation.
- The **"Back Ply" → `state.c`** mapping (the integer subtracted from depth) is
  inferred from the UI control name and the single depth-reduction use site; the
  bytecode binding was not traced end-to-end.

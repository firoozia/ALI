# WoodworkingShop — Deep Code Review

**Repo:** `/home/user/rajwanyair/woodworkingshop` (read-only clone)
**License:** MIT — `Copyright (c) 2026 Ryair` (`LICENSE`)
**Stack:** TypeScript + React + Vite, offline-first PWA, i18n (en/he + es/de/fr/ar in exports)
**Version:** 5.36.0 (`package.json`)
**Reviewer focus:** `src/engine/**` (pure logic), with `src/features/**` and `src/utils/**` where the engine is consumed.

Audience note: you are building a Windows PySide6 cabinet tool (parametric units → surfacing → manual parts → cut-list to Excel/CSV/OptiCut). Nesting-to-machine is handled by a separate tool (Zinax), so the optimizer and G-code here are "nice to know," not core. This review is weighted toward **unit→parts generation** and **surfacing (edge-banding + grooves)**, which is what you actually need.

---

## 1. Verdict — Real, or AI vaporware?

**It is real, genuinely-implemented, and unusually well-tested code. Not vaporware.** It is, however, AI-built (git author/co-author is "claude", commit stream is "Sprint N / Phase N" micro-features), and that shows in a specific way that matters to you: **breadth over integration.** There are ~200 engine modules, many of which are standalone, individually-correct, individually-tested "calculators" that are *not wired into the main cut-list pipeline.* The core path is real; a lot of the impressive-sounding surface area is parallel, disconnected machinery.

Evidence it is real:

- **Core algorithms are actually implemented**, not stubbed. The cut optimizer (`src/engine/optimizer/cut-optimizer.ts`, 811 lines) is a faithful MaxRects Best-Short-Side-Fit bin packer with a correct maximal-rectangles split step, kerf handling, and multi-sheet reuse — it cites Jylänki's "A Thousand Ways to Pack the Bin" and the code matches the paper. The part generator (`src/engine/geometry/parts.ts`), dimension solver (`dimensions.ts`), and door/drawer/dado/edge calculators all contain real arithmetic with sensible woodworking constants.
- **Test coverage is serious.** 289 test files. Engine specifically has real assertion-level tests, e.g. `tests/engine/parts.test.ts` (28 cases, 470 lines) asserts concrete formula outputs like `expectedSpan = 1003 - 2*17` for the top/bottom panel span; `tests/engine/cut-optimizer.property.test.ts` is a 10-case **property-based** suite (no overlaps, within-bounds, kerf respected). `tests/engine/dimensions.test.ts` has 37 cases. These are not snapshot-only or placeholder tests.
- **The governance tooling is heavy but not fake** — coverage ratchet, mutation testing (Stryker), bundle budgets, architecture checks. This is over-engineered for a cabinet app, but it is wired to real scripts.

Honest caveats:

- **Marketing claims outrun integration.** `package.json` advertises "CNC exports" and the UI/marketplace advertises an **Excel (.xlsx) BOM** — but there is **no .xlsx byte generator anywhere in `src/`** (only the format is registered in `export-format.ts` with the right MIME type). Only CSV is genuinely produced. See §5.
- **The sophisticated surfacing calculators are decoupled from the cut-list** (see §3). The per-edge edge-banding engine and the dado/rabbet/joint calculators are standalone UI panels; `generateParts()` uses its own much simpler inline logic.
- **Dead-ish breadth:** modules like `edge-profile.ts` are only referenced by their own barrel export and their own test — no production consumer builds its inputs from real parts.

**Bottom line:** trustworthy as a *reference for formulas and one solid algorithm (the packer)*. Do not assume a feature is end-to-end just because a well-written module with that name exists.

---

## 2. Unit → Parts generation (the core thing you need)

Two files do the work: `src/engine/geometry/dimensions.ts` computes derived interior dimensions; `src/engine/geometry/parts.ts` emits the part list. Both are pure functions. `generateParts()` is JSON-memoized.

### Part model (`src/engine/core/types.ts:266`)

```
interface Part {
  id: string;            // "P01", "P02", ...
  name: {en, he};        // bilingual
  qty: number;
  material: string;      // material key → thickness/grain/density
  thickness: number;     // mm
  length: number;        // mm — grain direction (by convention)
  width: number;         // mm
  edgeBanding: {en, he}; // COARSE label only: "None" | "Front edge" | "All 4 edges"
  rotationLocked?: boolean;              // optimizer: never rotate
  grainConstraint?: 'along-length' | 'along-width';
}
```

Note what the part model does **not** carry: no per-edge banding (only one coarse label), no groove/dado/rabbet geometry, no finished-vs-cut distinction. This is the single most important thing to improve on in your own port.

### Construction method

**Frameless (European / full-overlay) carcass only.** There is no face-frame in the production generator (a separate standalone `calculators/face-frame.ts` exists but is not used here). Construction evidence:

- Sides are **full height**; top & bottom are **captured between the sides** (`tbWidth = width - 2*t`). That is a frameless butt carcass.
- Doors default to **full overlay** (door width ≈ full external width minus reveals — covers the side edges).
- Joinery type (`screw`/`dado`/`dowel`/`pocket-screw`/`biscuit`) is a config field (`CabinetConfig.joineryType`) but **does not change part sizes** — e.g. a dado joint does not lengthen the mating shelf to seat into the groove. Joinery only drives validation + assembly text.

### Derived dimensions (`dimensions.ts:17`)

```
t = carcassMaterial.thickness
r = doorReveal                       # mm gap around doors (default 3)

internalWidth   = width  - 2*t
internalHeight  = height - 2*t
shelfDepth      = depth  - 20        # 20 mm front setback
shelfWidth      = internalWidth - 2  # 1 mm clearance each side
doorHeight      = height - 2*r
doorWidth       = (doorCount==2) ? (width - 2*r - (r-1))/2   # two leaves + centre gap
                                 : (width - 2*r)             # single leaf
backPanelHeight = height - 20        # 10 mm inset each edge
backPanelWidth  = width  - 20
```

### Part sizing formulas (`parts.ts`) — frameless cabinet

All thicknesses = carcass thickness `t` unless noted. `bm` = back-panel material.

```
Side panel      qty 2   length = height          width = depth           (EB: front edge if all-visible)
Top panel       qty 1   length = width - 2*t     width = depth
Bottom panel    qty 1   length = width - 2*t     width = depth
Fixed shelf     qty 1   length = internalWidth   width = shelfDepth       (only if height > 1200)
Adj. shelf      qty N   length = shelfWidth      width = shelfDepth       (N = shelfCount)
Centre support  qty C   length = internalHeight  width = shelfDepth       (C = shelfCentreSupports; full-height divider)
Door            qty D   length = doorHeight      width = doorWidth        (glass → tempered-glass-4 @ 4mm; EB 4-edges if banding on)
Back panel      qty 1   length = height-20       width = width-20   mat=back  (EB none)
Toe kick front  qty 1   length = width           width = kickHeight
Toe kick side   qty 2   length = depth - t       width = kickHeight
Hanging rail    qty 1   length = internalWidth   width = 25   thick = 25   (wardrobe only)
```

### Drawers (`parts.ts:211`)

```
drawerWidth = internalWidth - 26              # 13 mm each side for slides
drawerDepth = min(depth - t - 30, 500)        # clearance for back + face, capped 500
per drawer i (height h = drawerHeights[i] ?? 150):
  Front        qty 1   length = h + 30            width = drawerWidth + 26   # overlay face
  Box side     qty 2   length = drawerDepth       width = h
  Box end      qty 2   length = drawerWidth-2*t   width = h                  # front+back of box
  Bottom       qty 1   length = drawerDepth-2     width = drawerWidth-2*t   mat=back
```
The drawer bottom is a **loose panel sized under** — it is *not* captured in a groove (no 4th-side dado), and the box is a simple butt box. The richer `drawer-box.ts` calculator (slide-type clearances 25.4/2/6 mm, false front with 2 mm reveal) exists but is **not** used here.

### Other furniture types

`panel` (single plate), `desk` (desktop + leg sides + modesty panel at 0.4×height + optional under-shelves), `bookshelf` (carcass + shelves, no doors/drawers), `wardrobe` (carcass + hanging rail). All in the same `generateParts()` switch.

### Supporting physics (genuinely useful, and tested)

- **Hinge count/positions** (`dimensions.ts:66`): 2 hinges ≤600mm, +1 per band up to 6; positions distributed with ≤100mm top/bottom offset.
- **Shelf deflection** (`dimensions.ts:166`): real simply-supported UDL beam formula `δ = 5wL⁴/(384EI)`, `I = depth·t³/12`, serviceability `L/360`, tri-state safe/warning/danger at `L/240`, back-solves a `maxLoadKg`. Material-specific elastic moduli table (plywood 6500–7000, MDF 2500, chipboard 2200 N/mm²). Centre supports reduce effective span `shelfWidth/(n+1)`.
- **Shelf spacing presets** (`shelf-spacing.ts`): 8 use-cases (books 240mm, large books 330, paperback 180, dishes 280, wine 100, folded garments 350, hanging 1000, toys 200) with pitch = clearance + thickness. Clean, portable table.

---

## 3. Surfacing — edge-banding & grooves (THE key section)

This is where you need the most honesty, because it is exactly where the repo's breadth-over-integration pattern bites.

### 3a. Edge-banding — two parallel, disconnected systems

**System A — what the cut-list actually uses (coarse):**
`generateParts()` reads a single project-level enum `CabinetConfig.edgeBanding: 'all-visible' | 'doors-only' | 'none'` and stamps each part with one of three coarse labels via `edgeLabel()`:

```
'none'  → "None"
'front' → "Front edge"       (one long edge)
'4-edges' → "All 4 edges"
```

- It is **not truly per-edge.** A side panel gets "Front edge" (meaning the single front long edge); doors get "All 4 edges"; interior parts get "None". There is no independent control of top/bottom/left/right.
- Banding length for costing (`computeEdgeBandingTotal`, `parts.ts:345`): `Front edge → length×qty`; `All 4 edges → 2(L+W)×qty`.
- **Banding thickness has ZERO effect on cut size.** Finished size = cut size everywhere in the engine. There is no "subtract 2×0.4 mm because this edge is banded" compensation anywhere. This is a real gap vs. professional practice.

**System B — the "real" per-edge engine, which is NOT wired in** (`src/engine/hardware/edge-profile.ts`):
This is a proper per-edge model, and it is good — but it is **orphaned**. Grep confirms its only consumers are its own barrel export (`hardware/index.ts`) and its own test; nothing builds its input from real `Part`s.

```
EdgeProfile = 'none' | 'iron-on' | 'glue-on' | 'solid-wood' | 't-mold' | 'post-form'
EDGE_PROFILE_SPECS thickness: iron-on 0.4, glue-on 0.6, solid-wood 20, t-mold 3, post-form 1 mm
PanelEdges { top, bottom, left, right: EdgeProfile }   # genuinely per-edge
calculateEdgeBandBom(panels[]) → one BOM line per (edgeMaterial × profile), total mm + m
```

So: **per-edge banding as a data model exists and is correct**, but (a) it still does not feed banding thickness into cut dimensions, and (b) it is not connected to the parts pipeline. If you want per-edge banding + finished/cut compensation in your Python tool, you will be *designing* that integration, not porting it — but `edge-profile.ts`'s profile/thickness table and per-(material×profile) BOM rollup are a good starting spec.

### 3b. Grooves / dados / rabbets — calculators exist, geometry is NOT applied to parts

- `src/engine/joinery/dado-rabbet.ts` — real calculator: `cutWidth = matingThickness + 0.5 mm` clearance; `cutDepth = floor(boardThickness/3)` (1/3 rule); router pass count for a 12.7 mm bit; bit/blade recommendation. Types: `dado | rabbet | throughDado`. **Standalone** (only consumed by `src/features/calculators/DadoRabbetPanel.tsx`).
- `src/engine/joinery/joint-detail.ts` — per-joint groove/pocket geometry for `screw/pocket-screw/dado/dowel/biscuit/mortise-tenon/dovetail`: e.g. dado depth = `round(t/3)`, width = mating thickness; biscuit #20 slot 10×24 mm; dowel Ø10 (≥18mm stock) / Ø8 at 32mm system pitch, depth 0.45t; mortise depth = tenonLen+2, tenon = t/3 thick × 2t/3 long; even emits DXF marker comment strings. Good reference data.
- **But:** none of this resizes or annotates the parts emitted by `generateParts()`. A dado carcass does not get longer shelves; the back panel is a plain inset panel (`height-20 × width-20`), **not** a rebated/grooved back; the drawer bottom is a loose under-sized panel, **not** grooved in.

**Honest summary of surfacing:** the *ingredients* (edge profiles + thicknesses, dado/rabbet/joint groove math) are present, correct, and tested as isolated calculators. The *integration* you care about — per-edge banding driving finished-vs-cut size, and grooves/rebates actually modifying part geometry and the cut-list — **does not exist in this codebase.** This is the same gap the other app you looked at had; WoodworkingShop has better raw material for closing it, but has not closed it.

---

## 4. Nesting / optimizer (quality note — you likely delegate this to Zinax)

`src/engine/optimizer/cut-optimizer.ts` — **high quality, genuinely real.**

- **Algorithm:** MaxRects **Best-Short-Side-Fit** (`cutMode:'freeform'`, default) with the canonical maximal-rectangles split (`splitFreeRects` splits every intersecting free rect into up to 4 L-pieces; `pruneContained` drops contained rects). Score = `min(leftover) * 1e6 + max(leftover)`; a `1e12` per-sheet-index penalty forces filling earlier sheets before opening a new one. Also a `cutMode:'guillotine'` strip-based FFD packer for panel-saw-compatible edge-to-edge cuts (documented ~5–15% lower yield).
- **Kerf:** `SAW_KERF = 4 mm` default (`materials.ts:171`); reserved by growing the used rect by kerf in the split step **and** a `preservesKerfClearance()` neighbor check. (Minor: kerf is reserved even against the sheet edge — slightly conservative.)
- **Grain:** material-level `hasGrain` gates rotation; grain-constrained parts that cannot fit get a last-resort forced rotation flagged `grainConflict` with a human-readable `rationale` ("BSSF(rotated, grain-forced): 12mm × 300mm margin"). Per-part `rotationLocked` overrides. Result reports `grainConflictCount`.
- **Multi-stock** (`multi-stock-optimizer.ts`): picks the best stock candidate per material by score `totalWaste + placedCount*kerf`.
- **Offcuts:** `offcutCatalog` parts are packed onto leftover offcuts *first* before opening full sheets.
- **Defect zones:** per-material regions pre-blocked on each new sheet (knots/damage avoidance).
- **I/O:** in `optimizeCutSheets(parts, kerf, sheetOverrides, cutMode, offcutCatalog, defectZones, extraMaterials)` → `OptimizationResult { sheets: CutSheet[], totalSheets, overallYield, totalWaste, grainConflictCount }`; each `CutSheet` has placed `CutRect[]` with `x,y,length,width,rotated,grainVertical,grainConflict,rationale` and per-sheet `yieldPercent`. A `Result`-wrapped boundary-safe variant (`optimizeCutSheetsResult`) returns typed errors instead of throwing.

If Zinax does your nesting, you don't need this — but it is the single most reusable, correct, standalone algorithm in the repo if you ever want an in-app preview.

---

## 5. Export formats — what's real vs. thin

Export generation is split: the `src/engine/export/**` barrel holds structured generators (ERP, STEP, IFC, glTF, plus a G-code **parser/validator**), while the actual **CSV, DXF, G-code, PDF** writers live in `src/utils/**` and `src/features/**`.

| Format | Where | Real? |
|---|---|---|
| **BOM CSV** | `src/utils/bom-export.ts` | **Real.** Exact schema below. 6 locales of headers. |
| **BOM Excel (.xlsx)** | registered in `export-format.ts` only | **NOT implemented.** No xlsx byte generator exists in `src/`. Advertised in UI/marketplace; only CSV is produced. Thin claim. |
| **DXF** (cut plan + per-part) | `src/utils/dxf-builders.ts`, `dxf-export.ts`, `workers/dxf-export.worker.ts` | **Real** (AutoCAD AC1015 entity model, schema `dxf-ac1015-v2`). |
| **G-code (.nc)** | `src/utils/gcode-export.ts` (`cutSheetToGcode`) | **Real but basic:** rectangular perimeter profiling with holding tabs, multi-pass depth, spindle M3/M5, optional tool-change, circular-pocket G2/G3 arcs, WebSerial streaming. Not full CAM (no interior pocketing of arbitrary shapes). `export/gcode-toolpath.ts` is only a *parser* for the SVG preview; `gcode-validator.ts` lints it. |
| **STEP (ISO 10303-21)** | `src/engine/export/step-export.ts` | **Real but simple:** each part = a MANIFOLD_SOLID_BREP cuboid (6 faces). Opens in FreeCAD/Fusion/SOLIDWORKS. Boxes only — no joinery geometry. |
| **IFC** | `ifc-export.ts`, `gltf-ifc-model.ts` | Real, box-level BIM entities. |
| **glTF** | `gltf-document.ts` | Real, box meshes + PBR materials. |
| **ERP (JSON/XML/SAP/Oracle/webhook)** | `erp-export.ts` | Real line-item builder + per-system formatters + payload validation (schema-versioned). |
| **PDF** (BOM + cut plan) | `src/features/pdf/**` | Real (jsPDF-based in the features layer). |
| **SVG cut plan** | features/optimizer | Real. |
| **Project JSON** | `features/configurator/save-load-json.ts` | Real, schema `project-json-v2`. |

**Exact BOM CSV schema** (`src/utils/bom-export.ts:33`, English; localized equivalents for he/es/de/fr/ar):

Parts section:
```
#,Cabinet,Part ID,Part Name,Qty,Material,Thickness (mm),Length (mm),Width (mm),Area (m²),Edge Banding,Weight (kg),Grain Direction
```
Hardware section:
```
#,Cabinet,Hardware ID,Hardware Name,Qty,Unit
```
Plus a **Material Summary** block: `Material, Total Area (m²), Board-Feet (nominal 1 inch), Weight (kg), Price/Sheet, Est. Material Cost`. Currency via `Intl.NumberFormat`. "Edge Banding" is the coarse label from §3a; "Grain Direction" = "Along length" / along-width.

There is **no OptiCut-format exporter** here (you mentioned OptiCut as a target). The closest reusable thing is the BOM CSV column set above — OptiCut imports a simple length/width/qty/material/grain/banding CSV, which maps cleanly onto these columns.

Schema versions are centralized in `export/export-schema.ts` (`bom-csv-v1`, `dxf-ac1015-v2`, `gcode-v1`, `pdf-plan-v1`, `project-json-v2`).

---

## 6. Materials / grain model

`src/engine/materials/materials.ts` — a flat built-in catalog (`MATERIALS[]`) plus `getMaterial(key, extraMaterials?)`.

```
interface Material {
  key; name{en,he};
  thickness;                 # mm
  sheetWidth; sheetLength;   # mm — default 1220 × 2440
  pricePerSheet?; currencyCode?;   # e.g. ILS/USD/EUR
  category: 'panel'|'back'|'door';
  color;                     # hex, for 3D/2D preview
  hasGrain: boolean;         # true → optimizer won't rotate 90°
  densityKgM3;               # weight estimation
}
```

Built-ins include plywood-17/18 (grained), melamine/MDF/chipboard 16/18 (no grain), OSB-18 (grained), thin backs plywood-4 / mdf-3, tempered-glass-4. Custom materials are supported at runtime (`extraMaterials` threaded through every engine fn; `features/configurator/CustomMaterialEditor.tsx` + a Zustand store).

**Grain modeling (two levels):**
- *Material level:* `hasGrain` — the optimizer's rotation gate.
- *Part level:* `Part.grainConstraint: 'along-length' | 'along-width'` and `rotationLocked`. Convention: `Part.length` is the grain direction.

**Weight:** `computePartWeightKg(L,W,t,qty,density)` and `computePartsWeight(parts)` (`parts.ts:366`) roll up assembled weight, skipping unknown materials.

There is no explicit per-part "material override for surfacing/grain print side" beyond this — grain is a single axis flag, not a face/figure/texture model (though `pbr-materials.ts` / `material-textures.ts` exist for 3D preview only).

---

## 7. What to borrow for your Python / PySide6 build

MIT license: **permissive — you may reuse, re-implement, and ship this logic in a closed or open product, including commercially, provided you keep the copyright + license notice** (`Copyright (c) 2026 Ryair`) in your source/attribution. Porting formulas to Python is unambiguously fine.

**Top 3 worth borrowing (ranked):**

1. **The MaxRects BSSF packer** (`optimizer/cut-optimizer.ts`) — the single best, most-reusable algorithm here, with a correct split/prune step, kerf reservation, grain-gated rotation with conflict flagging, offcut-first packing, and defect-zone blocking. Even if Zinax nests for production, this is a clean ~300-line core to port for an in-app preview/estimate. Port its property tests too (`cut-optimizer.property.test.ts`).

2. **The parametric dimension solver + part generator** (`geometry/dimensions.ts` + `geometry/parts.ts`) — this is your closest analog to "define cabinet units parametrically." Lift the derived-dimension formulas (§2) and the per-part sizing table directly. They are simple, tested (`parts.test.ts`, `dimensions.test.ts`), and cover cabinet/bookshelf/desk/wardrobe/panel. **But redesign the part model first** (see below).

3. **The surfacing *data specs*, not the plumbing** — `hardware/edge-profile.ts` (6 edge profiles + real thicknesses + per-(material×profile) linear-metre BOM rollup) and `joinery/dado-rabbet.ts` + `joinery/joint-detail.ts` (dado = 1/3 thickness, width = mating + 0.5 mm clearance; dowel/biscuit/mortise/dovetail groove tables). These give you correct constants and formulas to drive *your* surfacing engine.

**Also handy:** shelf-deflection beam math + material E-moduli (`dimensions.ts`), shelf-spacing presets (`shelf-spacing.ts`), hinge-count/position logic, the BOM CSV column schema (§5) as your Excel/CSV/OptiCut baseline, and the material catalog shape (§6).

**What NOT to copy / must redesign for your tool (this is the value-add gap):**

- **Make the Part model surfacing-aware from day one.** This repo's `Part` only carries a coarse banding *label* and no groove data. For نوار/شیار you need, per part/per edge: banding on/off + profile + thickness, and groove/rabbet spec (position, width, depth). Then:
- **Compute finished-size vs cut-size.** Nowhere does this repo subtract banding thickness from cut dimensions. Your tool should: `cut = finished − Σ(bandingThickness on that axis)` (and add back for grooved joints that seat into a mating part). This is the main correctness feature both apps you've looked at lack.
- **Apply grooves/rebates to geometry.** Let joinery actually resize parts (e.g. dado housing lengthens the captured shelf by 2×dadoDepth; grooved back/drawer-bottom sits in a slot). The calculators here give you the numbers; the wiring is yours to build.
- **Skip the xlsx "feature"** — it's not implemented. Generate real .xlsx yourself (openpyxl on Windows is trivial and better than their CSV-only reality).

---

## Appendix — key file map

- Part gen: `src/engine/geometry/parts.ts` (`generateParts`, `computeEdgeBandingTotal`, `computePartsWeight`)
- Dimensions/physics: `src/engine/geometry/dimensions.ts`
- Standalone calculators: `geometry/cabinet-door.ts`, `geometry/drawer-box.ts`, `geometry/shelf-spacing.ts`, `geometry/mirror-cabinet.ts`
- Surfacing: `hardware/edge-profile.ts`, `joinery/dado-rabbet.ts`, `joinery/joint-detail.ts`
- Optimizer: `optimizer/cut-optimizer.ts`, `optimizer/multi-stock-optimizer.ts`
- Materials: `materials/materials.ts`, `core/types.ts` (Part/CabinetConfig/Material)
- Exports: `utils/bom-export.ts` (CSV), `utils/gcode-export.ts`, `utils/dxf-*.ts`, `engine/export/{step,ifc,gltf,erp}-*.ts`, `engine/export/export-format.ts`
- Tests: `tests/engine/**` (289 test files total)

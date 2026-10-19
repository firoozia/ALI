# Parametric Cabinet Modeling & Cut-List/CNC Interchange Formats

Scope: design guidance for a cabinet-unit → parts generator. Covers (1) how parametric cabinet engines define a unit and generate parts, (2) construction-method geometry + part-sizing formulas, (3) edge-banding/grain representation in cut-lists, (4) interchange formats (CSV/XML/DXF) and nesting/beam-saw import columns, and (5) labeling/barcode conventions. The builder already has nesting/G-code; this is about the unit-definition + cut-list-export front end.

Note on sourcing: several vendor doc domains (wooddesigner.org/PolyBoard-OptiCut, community.microvellum.com, intercom.help, promob) would not resolve via WebFetch in this environment, so their contents are captured through search-engine synthesis (summaries of those pages) rather than direct page reads. These are flagged inline. Woodworking shop-practice formulas come mostly from trade blogs/forums and vary by shop; they are rules of thumb, not a single standard.

## How parametric cabinet engines work & standard parameters

### Takeaway
Parametric engines fall into two camps: (a) geometry-driven "dynamic component" models (OpenCutList + SketchUp DCs) where parts are real 3D components whose sizes are read off the model, and (b) formula/library-driven generators (Mozaik, Microvellum) where a cabinet "product" is a library template with construction rules and each part's L/W/thickness is a formula of the unit's W/H/D plus material thicknesses and gaps. The standard parameter set is overall W/H/D, panel thickness, door/drawer/shelf counts, overlay/reveal gaps, back-panel method, and edge-banding assignment.

### Cited Findings
- OpenCutList (OCL) is a crowdfunded SketchUp extension; it reads **components, not groups**, and generates the parts list by measuring component geometry. A group holding two components is counted as two parts; for merging, you explode and regroup geometry into a single component before running OCL — [SketchUp Forums: OCL & nested components](https://forums.sketchup.com/t/opencutlist-and-nested-components/342661); [OCL crowdfunded extension](https://forums.sketchup.com/t/opencutlist-a-crowdfunded-extension/301089)
- OCL works with scaled/resized **SketchUp Dynamic Components (DCs)**, but complex cutouts can distort on resize. OCL ignores 2D geometry and cuts; developer (Boris Beaulant) fixes for a rabbeted sub-panel were (1) convert sub-components to groups, or (2) give them the "Cut opening" behavior; group conversion was called the cleaner option — [SketchUp Forums: DC with a cutout](https://forums.sketchup.com/t/dynamic-component-with-a-cutout/342794); [DC cabinet component](https://forums.sketchup.com/t/dynamic-cabinet-component/311985)
- Competing DC libraries (e.g. Melamina PRO) have adapted their dynamic components to be OCL-compatible, and full cabinet DC libraries exist — [SketchUp Forums: live kitchen cabinet library](https://forums.sketchup.com/t/kitchen-cabinet-complete-live-library-available/344670); [building a DC library](https://forums.sketchup.com/t/building-a-dynamic-component-library-for-cabinetmakers-and-architects/317272/18)
- Mozaik ships separate **Face Frame, Frameless, and Closet/Wardrobe libraries**; users copy a library under a new name and modify/add/remove products. Construction method is set **per library, not per cabinet**; products build automatically to that library's specifications — [Mozaik Manufacturing](https://www.mozaiksoftware.com/products/additional-features-mozaik-manufacturing)
- In Mozaik, **joinery type is a parameter** (dowels, dados, tenons, screws) that can be defined and switched; cut lists are generated "based on the user's unique construction methods and parameters"; design changes propagate to drawings and production reports; built-in Product/Part Editors and a Tab Wizard customize products — [Mozaik Manufacturing additional features](https://www.mozaiksoftware.com/products/mozaik-manufacturing/additional-features)
- Microvellum models cabinets as **Products and Module Definitions** (library templates); parts and sheets export for third-party optimization rather than nesting directly in all cases — [Microvellum KB: Products & Module Definitions](https://community.microvellum.com/portal/en/kb/articles/products-module-definitions) (via search summary)
- OCL dimension/axis convention (relevant to parameterization): length = red axis, width = green, thickness = blue, in the component's local axes; dimensions default to sorted largest→smallest; automatic orientation can be disabled and axis order locked per part — [SketchUp Forums: edge banding / axes](https://forums.sketchup.com/t/edge-banding/346397); [OCL 8.0 campaign (lock orientation on axis)](https://forums.sketchup.com/t/opencutlist-a-crowdfunded-extension/301089)

### Inferences
- The two architectures imply two front-end designs. A geometry-driven generator (OCL-style) needs a reliable 3D/boolean model and then reads part sizes; a formula-driven generator (Mozaik/Microvellum-style) needs a **parameter→formula table per part** keyed to the unit's W/H/D, thicknesses, and gaps, and never requires a watertight 3D model to emit a cut-list. For a tool whose goal is cut-list export (not visualization), the formula/library approach is far simpler and more deterministic.
- The standard parameter set a unit definition should expose: overall `W`, `H`, `D`; panel `thickness` (often distinct carcass vs back vs door thickness); `door_count`, `drawer_count`, `shelf_count`; `overlay`/`reveal` gaps; `back_method` (rebate/groove/nailed/applied); per-part edge-banding flags; grain flag; and construction style (frameless vs face-frame). This set recurs across every tool examined.
- "Construction method set per library" (Mozaik) is a strong pattern: construction rules (side captures top/bottom or vice versa, back method, joinery) are best modeled as a reusable **construction profile** separate from the per-unit dimensions, so one profile drives many cabinet types.

### Gaps
- No tool published its actual formula syntax/grammar (e.g. exact variable names and expression language) in sources that resolved. Microvellum/Mozaik formula editors are documented behind login/paywall; formula-level detail here is reconstructed from shop math (next section), not from vendor formula references.

## Construction methods & part-sizing formulas (frameless vs face-frame, carcass, back, overlay, drawer, shelf)

### Takeaway
Frameless (Euro) carcasses are typically full-height sides with top/bottom (and stretchers) captured between the sides; the back is either inset into a groove/rabbet or applied over the back. The governing formula pattern is: parts spanning *between* two sides = overall dimension − 2 × side-thickness (+ fit allowance); the back and door/drawer sizes derive from the opening plus/minus overlay or reveal gaps. Exact deductions depend on joinery and hardware; the numbers below are common shop values, not a universal standard.

### Cited Findings — Carcass
- Frameless sides typically run the **full height and full depth** of the box; a worked example for a 30 (W) × 34.5 (H) × 24 (D) in base gives two sides at 34.5 × 24 — [Cabinet Cut List Calculator (codingace.net)](https://codingace.net/construction/cabinet_cut_list.html) (treat calculator math as unverified)
- Top/bottom (and horizontal members) fit **between the sides**: their width = overall cabinet width − 2 × panel thickness; depth ≈ external depth; a small "ease" allowance is often applied to prevent binding (edge-banding and out-of-square boxes) — [Cabinet Cut List Calculator](https://codingace.net/construction/cabinet_cut_list.html)
- Frameless boxes are commonly **3/4" (18–19mm) cabinet-grade plywood/melamine** — [CabinetNow frameless specs](https://www.cabinetnow.com/frameless-cabinet-specs/); [WoodWeb Case Construction Basics](https://woodweb.com/knowledge_base/Case_Construction_Basics.html)
- Target finished depth often constrains the math: e.g. a ~23¾" base depends on whether back and doors are counted — [WoodWeb: Proper Depth for Frameless Cabinets](https://woodweb.com/knowledge_base/Proper_Depth_for_Frameless_Cabinets.html)

### Cited Findings — Back panel
- **Inset back** (captured between sides, top, bottom): width = overall width − 2 × side thickness; height = overall height − 2 × top/bottom thickness — [Cabinet Cut List Calculator](https://codingace.net/construction/cabinet_cut_list.html)
- Frameless cabinetmakers commonly **dado/groove the back in**; one shop rebates a few mm off the face of the back, then routs a ~15mm dado so the rebate shoulders hide the join line; another cuts a 1/4" groove ~1/4"+ from the rear edge and rabbets the back to match — [WoodWeb: Dadoed-In Back Panel Case Construction](https://woodweb.com/knowledge_base/DadoedIn_Back_Panel_Case_Construction.html); [Festool Owners Group: back on Euro cabinet](https://festoolownersgroup.com/threads/how-to-fit-back-on-euro-cabinet.34583); [Popular Woodworking: frameless joinery](https://www.popularwoodworking.com/techniques/frameless-cabinet-joinery/)
- Grooving the back into the sides can give a built-in scribe (extra material beyond the groove) — [LumberJocks](https://www.lumberjocks.com/posts/43099)
- For a grooved/dadoed back the back-panel **outside dimensions grow** by 2 × groove depth versus the pure inset size (it reaches into the grooves on all captured sides). Groove depth is typically ~1/4"–3/8" in 3/4" stock; groove width should match (or be very slightly over) the back's actual thickness for a snug fit — [WoodWeb: Dadoes for Cabinet Case Construction](https://woodweb.com/knowledge_base/Dadoes_for_Cabinet_Case_Construction.html) (one guide suggesting the dado be *smaller* than the back thickness conflicts with snug-fit practice and should be treated with caution)

### Cited Findings — Door overlay & reveal
- **Partial overlay (face-frame):** door width = opening + 2 × overlay; same for height — [CabinetNow: measuring overlay](https://www.cabinetnow.com/how-to/measuring-for-cabinet-overlay-partial-full-overlay-and-inset/)
- **Full overlay, single door:** door width ≈ opening − 1/4" (example for openings < 24") — [WoodshopDiaries: determine cabinet door size](https://www.woodshopdiaries.com/how-to-determine-cabinet-door-size/)
- **Pair of doors on one opening:** each door = (opening width + overlay for both sides) / 2 − 1/16" (subtract 1/16" per door for the center gap; rule applied for openings > 24") — [WoodshopDiaries](https://www.woodshopdiaries.com/how-to-determine-cabinet-door-size/)
- **Inset doors:** subtract for a reveal — e.g. for a consistent 1/8" reveal, subtract ~1/4" from both opening height and width (1/8" each side); face-frame inset stiles often 1.5", rails 1.5", mullions between paired doors ~3" to keep reveals consistent — [WoodshopDiaries](https://www.woodshopdiaries.com/how-to-determine-cabinet-door-size/); [WoodWeb: Inset-door cabinets](https://woodweb.com/knowledge_base/Insetdoor_cabinets.html)
- **Reveal size:** 1/8" is a common recommended door reveal; face-frame needs at least ~1/4" reveal so doors clear — [cabinet door size guidance](https://www.woodshopdiaries.com/how-to-determine-cabinet-door-size/)
- **Drawer front stacked above a door (shared opening):** subtract gaps first (1/8" top + 1/8" between drawer and door + 1/8" bottom), subtract drawer-front height; remainder = door height — [WoodshopDiaries](https://www.woodshopdiaries.com/how-to-determine-cabinet-door-size/)

### Cited Findings — Drawer box (vs opening)
- Deduction depends on slide type and side thickness, no single rule:
  - **Undermount (Blum Tandem-style):** box width = opening − 5/8" for 1/2" sides, or opening − 3/8" for 5/8" sides (worked example: 5/8" box in a 15" opening ≈ 14-5/8") — [Eaglewoodworking: measure for drawer boxes](https://eaglewoodworking.com/knowledge-base/how-do-i-measure-for-drawer-boxes); [drawer.com measuring guide](https://www.drawer.com/product-information/tips-and-tricks/how-to-measure-for-custom-drawers)
  - **Side-mount slides:** box width = opening − 1-1/16" (independent of side thickness) — [Eaglewoodworking](https://eaglewoodworking.com/knowledge-base/how-do-i-measure-for-drawer-boxes)
  - A metric 25.4mm (1") per-opening slide allowance appears in an AI-generated doc, not a manufacturer spec — treat as illustrative only — [search summary of AI drawer design doc]
- **Height:** box height ≈ opening height − ~1" (clearance) — [Eaglewoodworking](https://eaglewoodworking.com/knowledge-base/how-do-i-measure-for-drawer-boxes)
- Key design rule: drawer clearance is dictated by the **specific slide model's spec sheet**, so a generator should treat per-side slide clearance as a hardware parameter, not a hard-coded constant.

### Cited Findings — Shelves (setback & width)
- **Adjustable shelf width:** interior opening width − a small total clearance, split between sides. Mozaik subtracts a set clearance and splits evenly (e.g. 3/16" total = 3/32" per side); a shelf seller subtracts 1/16" from the face-opening width — [Mozaik: Understanding Interior Parameters](https://mozaik.support.cyncly.com/hc/en-us/articles/45412216050321); search summary of shelf-sizing guides
- **Shelf depth / setback:** shelf must be shallower than interior depth so doors close; measure back-of-cabinet to inside face of frame/door and deduct backboards/rear supports plus a front setback — [search summary of shelf-sizing guide]
- A Thermwood (CNC software) face-frame shelf-depth formula seen in the wild: (Cabinet depth − Back thickness − Left stile thickness)/2 as a front-inset term; the poster noted it errored on depth changes and worked better on frameless — illustrates the formula shape, not a reliable universal — [Thermwood forum: f(x) for shelves](https://www.thermwood.com/forums/viewtopic.php?p=72984)

### Cited Findings — Face frame
- Face-frame rail/stile widths have **no single standard**; typical range 1-1/2" to 2-1/2"; 1-1/2" is a common default; wider bottom rails are common (e.g. for under-cabinet lighting); intermediate rails in drawer banks kept narrow (~1-1/4") to preserve opening size; European 35mm hinges require enough stile width for the mount — [Sawmill Creek: rail & stile widths](https://sawmillcreek.org/goto/post?id=2408447); [WoodWeb: Inset-door cabinets](https://woodweb.com/knowledge_base/Insetdoor_cabinets.html); [QuikDrawers: one-opening face frame designs](https://quikdrawers.com/One-Opening-Face-Frame-Designs)
- Face-frame changes the opening math: the door "opening" is the **frame opening** (inside the stiles/rails), not the carcass interior, so overlay/reveal formulas key off the frame opening.

### Inferences
- A clean, implementable formula model for a frameless base, with carcass thickness `t`, back thickness `tb`, groove depth `g`, side-to-side fit ease `e`:
  - Sides (2): `H × D` (full height, full depth)
  - Top/Bottom or stretchers (2): `(W − 2t + 2g_h?) × D` — width = `W − 2t` for butt/dado-captured, add `2×groove_depth` only if the member seats into a groove in the sides; depth ≈ `D` (minus any back inset).
  - Back (inset): `(W − 2t) × (H − 2t)`; (grooved): `(W − 2t + 2g) × (H − 2t + 2g)`, width = `tb`.
  - Door (full overlay single): `(opening_W − 2×reveal) × (opening_H − 2×reveal)` where reveal collapses to the overlay-derived gap; practical single-door = opening − ~1/8" to 1/4" all round.
  - Door pair: each `= (opening_W + 2×overlay)/2 − center_gap/2`.
  - Drawer box: `(opening_W − 2×slide_clearance) × (opening_H − height_clearance) × box_depth`, slide_clearance from hardware param.
  - Adjustable shelf: `(interior_W − side_clearance) × (interior_D − front_setback − back_allowance)`.
- These are the "spanning dimension = overall − 2×thickness (± joinery depth ± fit ease)" and "front = opening ± overlay/reveal" patterns, which generalize across both construction styles; the only style-dependent swap is whether `opening` is the carcass interior (frameless) or the face-frame opening (face-frame), and which members are captured vs full-length.

### Gaps
- No single authoritative, cross-tool table of default deductions; shop values vary (1/16", 1/8", 1/4", 3/8", 5/8"). A builder should make every gap/clearance a configurable parameter with sane defaults rather than hard-code.
- Did not find a definitive formula for toe-kick/base assembly sizing or for stretcher placement rules; these vary by cabinet type (base/wall/tall).

## Edge-banding, grain direction, and how they appear in a cut-list

### Takeaway
Edge-banding is represented per-edge (one flag/column for each of the up-to-4 edges), carrying an edge-band material code; its presence can either leave the part at finished size (pre-milled) or require the panel to be cut undersize by the band thickness so the banded part finishes to size. Grain is a per-part flag (none / along-length / along-width) that constrains rotation during nesting.

### Cited Findings — Edge-banding
- OCL: edge-banding needs **two materials** — one for the panel, one for the edge; the band is a material of type "Edge Banding" applied to the drawing faces (it cannot be a subgroup/component); curved edges are not supported; the edge-band columns can be hidden via an Options checkbox — [SketchUp Forums: cannot use edge banding as material](https://forums.sketchup.com/t/i-cannot-use-edge-banding-as-material-in-open-cutlist-extension/152025); [Edge Banding thread](https://forums.sketchup.com/t/edge-banding/346397); [No Edge Banding Columns](https://forums.sketchup.com/t/opencutlist-no-edge-banding-columns/153109)
- **Net vs overall dimensions** (OptiCut model): *net* = panel dimensions without edging (and including oversizing); *overall* = net + edge thickness added back. Edging thickness is subtracted from panel size when working in net dimensions; a "thickness compensation" setting offers none / maximum / fixed — [search summary of OptiCut "Net versus overall dimensions" help page]
- **Pre-milled edging** changes the math: if the edge bander mills the panel edge before banding, the part should be cut to finished size and the band-thickness deduction is unwanted. Documented formula: `Net = Overall − edge_thickness + oversizing`; a workaround is to set edge thickness to 0 in the cut list and set the CNC post-processor to overall dimensions. Warning example: 5mm oversizing with 2mm edges leaves only 1mm for the CNC part size instead of 2.5mm — [search summary of Wood Designer/PolyBoard pre-mill forum thread]
- An edge-band "position" setting ("cover on top" vs "cover sink") controls whether the band thickness is subtracted from cut size — [search summary of Woodwork for Inventor thread]
- Promob's Aspan nesting export writes **one column per face** — e.g. `BorderLeft`, `BorderTop`, `BorderRight` (plus `_A`/`_B` columns for parts with more than 4 faces); each column's value is the **edge-band code**; faces with no edging are left blank — [Promob: Exporting Edge-band in Nesting (Aspan)](https://suporte.promob.com/hc/en-us/articles/31118449462161) (via search summary)

### Cited Findings — Grain direction
- OCL: grain runs along the **first (length) dimension**; for sheet goods, adding a panel size to the material and enabling **"Grain Follows Length"** makes OCL rotate parts to match grain; a magnifier icon paints an arrow showing OCL's length direction; the panel size must be entered so grain runs along the length dimension — [SketchUp Forums: edge banding/axes thread](https://forums.sketchup.com/t/edge-banding/346397); [UK Workshop: defining grain direction in components](https://www.ukworkshop.co.uk/threads/sketchup-defining-grain-direction-in-components.76790/)
- OptiCut CSV: a **grain flag column** (0 = no grain, 1 = grain); default is grain along the part's longer side, and parts are placed so grain matches the panel grain — [search summary of OptiCut "Create cutting list" help]
- Microvellum grain uses **numeric codes: 0 = none, 1 = grain along length, 2 = grain along width**; invalid value defaults to 0 — [search summary of OptiCut/Microvellum grain handling]

### Inferences
- A cut-list record needs, at minimum per part, four edge-band fields (top/bottom/left/right, each a band code or blank) and one grain enum (0/1/2 or none/length/width). This matches both OCL's per-face model and Promob's per-column model.
- The single most important edge-band design decision for the builder: pick a convention for whether stored L/W is **finished size** (part after banding) or **cut size** (panel before banding), and expose a per-material `edge_thickness` + `premill` flag so the generator can compute cut size = finished − Σ(band thickness on that axis) when not pre-milled, or = finished when pre-milled. Getting this wrong is the classic 1–2mm error documented above.
- Grain flag must gate nesting rotation: grain=length forbids 90° rotation; grain=none allows free rotation; this is exactly how OptiCut/OCL use it.

### Gaps
- No universal naming for the four edge columns (OCL vs `BorderLeft/Top/Right` vs others); the builder must map to each target importer. Likewise edge-band codes are shop/material-library specific.

## Interchange formats: CSV, Excel, XML, DXF — columns & what nesting/beam-saw software imports

### Takeaway
There is **no single industry-standard cut-list schema**. Practical interchange is: (a) CSV for part lists into optimizers/nesting (configurable column order; common minimum = material, qty, reference/name, length/height, width, grain flag, plus per-edge band columns and label text), (b) vendor XML for richer transfer (Microvellum BlueCell XML with SheetGroup/PartGroup; Cut Rite PTX/MDB for beam saws), and (c) layered DXF for nested panels + machining geometry (layer names defined by the post-processor). Builders should emit a configurable CSV and plan a per-target column mapping.

### Cited Findings — CSV / Excel
- **OptiCut minimum panel columns (6):** material, quantity, reference (name), height, width, grain flag (0/1). Column order left→right in that sequence; the importer must be mapped to match — [search summary of OptiCut "Create cutting list"]; [search summary of OptiCut import]
- PolyBoard CSV export is **field-configurable**: you choose which data fields appear, their order, and the separator (`;` shown as selected) — verify separator before importing elsewhere — [search summary of PolyBoard cutting-list export help]
- Workflow confirmation: users export a parts list from eCabinets to CSV and import into a nesting optimizer — [Reekon forum: importing CSV from CutList Plus](https://forum.reekon.tools/t/importing-csv-from-cutlist-plus-software/2473)
- CSV import is **more limited than DXF** because CSV can't define machining/tooling layers — a part CSV carries sizes/materials/edging/labels but not geometry — [search summary of PolyBoard/OptiNest integration doc]
- OptiNest supports **custom text fields in the CSV** that are then added to labels; OptiCut auto-imports edging and label-reference data when files come from PolyBoard — [search summary of OptiNest parts import]
- A CutList Plus → CNC user reported CSV import "wasn't working in a usable format," particularly for CNC part tagging — i.e. round-trip CSV should be tested on a small file first — [Reekon forum thread](https://forum.reekon.tools/t/importing-csv-from-cutlist-plus-software/2473)
- Promob Cut Pro label XML tags are configurable; defaults include part height (`L`), part width (`W`), and edge-banding fields; label fields chosen from a Labels tab — [search summary of Promob Cut Pro support article]

### Cited Findings — XML
- **Microvellum BlueCell XML:** contains **non-optimized parts and sheet information**, organized into `SheetGroup` and `PartGroup` elements; Microvellum connects to the BlueCell *sawing* optimizer (beam saw) via this XML (not its nesting optimizer); BlueCell itself can output for both nested routers and panel saws — [Microvellum KB: BlueCell XML Import Overview](https://community.microvellum.com/portal/kb/articles/bluecell-xml-import-from-microvellum-overview) & [Reference](https://community.microvellum.com/portal/kb/articles/bluecell-xml-import-from-microvellum-reference) (via search summary; pages did not resolve for direct field-level read)
- **Cut Rite** (beam-saw optimizer) imports via an **MDB database** or a **PTX (Pattern Exchange) parts file**; the PTX parts file contains everything Cut Rite needs to compute the optimal layout — [Microvellum KB: Cut Rite PTX Parts File Import](https://community.microvellum.com/portal/kb/articles/cut-rite-ptx-parts-file-import-from-microvellum-overview) (via search summary)
- Microvellum also has a **generic project XML import** (Products/Parts into Microvellum itself via Toolbox Setup > Import File) — this is inbound project transfer, not an outbound nesting feed — [Microvellum KB: Overview XML Project Import](https://intercom.help/microvellum-knowledge-base/en/articles/13871580-overview-xml-project-import) (via search summary)

### Cited Findings — DXF
- OptiNest layered DXF output can contain the **panel outline, the nesting pattern, and machining details** (hinge, slide, fitting tooling); part and tooling **layer names are set in the post-processor** to match the CAM/CNC software — [search summary of OptiNest integration doc]
- Layer names are **software-specific, not a shared standard**; Control Nesting (Thermwood/CNC Automation) requires specific layer/level naming on processed layered DXF files — [Thermwood forum: layered DXF/Control Nesting](https://www.thermwood.com/forums/viewtopic.php?p=76287)
- DXF prep best practice: export parts as **closed polylines**, remove text/auxiliary lines, avoid splines (CNC handles linear + circular moves) — [Xometry: DXF nesting best practices](https://xometry.com/resources/sheet/dxf-nesting-best-practices)

### Inferences
- Minimal viable CSV cut-list schema for a generator to emit (superset covering the importers seen): `Label/PartName`, `Room/Cabinet`, `Qty`, `Length(L)`, `Width(W)`, `Thickness`, `Material`, `Grain(0/1/2)`, `EdgeTop`, `EdgeBottom`, `EdgeLeft`, `EdgeRight` (band codes), plus optional `Comment`/custom label text. Make column order, headers, and separator user-configurable because every target importer differs.
- For beam-saw targets, a cut-list CSV (parts + quantities + material + grain + edging) is sufficient since the saw optimizes rectangles; for nested-router targets, either a CSV part list (optimizer nests it) or a layered DXF (geometry + drilling already placed) is used — the richer the machining, the more DXF (or vendor XML) is needed over plain CSV.
- XML (BlueCell-style SheetGroup/PartGroup) is the right model if the tool must carry sheet/stock info alongside parts in one file; otherwise CSV part-only + separate material/stock config is simpler.

### Gaps
- Could not read the BlueCell XML **field-level reference** (exact PartGroup attribute names) or the Cut Rite PTX field list directly — those vendor pages did not resolve via fetch; only the element names (SheetGroup/PartGroup) and purpose are confirmed.
- No CabParts-specific XML schema found in any resolving source; CabParts documentation was not located.
- No single cross-vendor required-column list exists; "required" is per-importer.

## Labeling & barcode conventions

### Takeaway
Labels/barcodes are not standardized across the industry; each shop/software defines its own. Common practice: a per-part label carrying a cabinet/batch number (emphasized for across-the-room reading), part name, exact finished size, and a 1D barcode encoding a part ID pulled from the job database; cabinet numbering is often sequential (load order) or a letter-pair scheme (AA–ZZ = 676 cabinets).

### Cited Findings
- PolyBoard assigns a **simple sequential part-number reference** to all parts, included in the manufacturing output and in the cutting list; labels can include the part number if that field is enabled in print settings — [search summary of PolyBoard numbered-parts help]
- PolyBoard can produce **labels for both panel and bar parts**, and label content can be rendered as a **barcode**; it can also export a CSV cutting list for a beam saw that doesn't generate its own labels — [search summary of PolyBoard labels help]
- Sequential cabinet numbering (Thermwood control): numbers assigned in load-screen order, carrying across a second job in the same nest; this label is "more for part sorting than job sorting" — [Thermwood forum p.80699](https://www.thermwood.com/forums/viewtopic.php?p=80699)
- A shop label template uses a **two-letter cabinet ID (AA–ZZ = 676 cabinets)**, available with or without a RECUT barcode; label data is pulled from the database; barcode height increased for easier scanning — [Thermwood forum: colored symbols on labels](https://www.thermwood.com/forums/viewtopic.php?p=80691)
- Label-design guidance: emphasize the **batch/cabinet number** (readable at a few feet) and the **part name**, and print the **precise part size** to simplify post-machine operations and identification — [Thermwood forum p.36441 / labels redesign](https://www.thermwood.com/forums/viewtopic.php?p=36441)

### Inferences
- A sensible default label/barcode model for the generator: a part-unique ID (job + cabinet + part sequence) encoded in a 1D barcode (Code128/Code39 are the typical shop choices), with human-readable fields: cabinet/batch number (large), part name, finished L×W×thickness, material, and edge-band summary. Keep cabinet numbering pluggable (sequential vs letter-pair).
- Because the barcode is "just populated from the database," the generator should emit a stable part-ID key in both the cut-list CSV and the label data so scanning ties a physical part back to its record.

### Gaps
- No single standardized barcode symbology or ID format for cabinet parts was found; conventions are shop- and software-specific. No source gave an industry spec for the encoded string's structure.

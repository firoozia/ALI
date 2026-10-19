# OpenCutList — Code Review for a Python/PySide6 Cabinet Cut-List Tool

**Reviewed project:** `lairdubois/lairdubois-opencutlist-sketchup-extension` (GPLv3, Ruby, SketchUp extension)
**Reviewed tree:** `src/ladb_opencutlist/ruby`
**Focus:** edge-banding model, cut-list generation/grouping, formula engine, CSV export, and what to re-implement.

> **GPLv3 note (read first).** OpenCutList is GPLv3. You may study it and **re-implement the ideas, algorithms and data model** in your own Python/PySide6 app, but do **not** copy Ruby source, comments, string tables, or structure verbatim into your (presumably differently-licensed) codebase. Everything below is described as *logic/pseudocode* so you can write clean-room Python. The i18n labels quoted are only to explain intent, not to copy.

---

## 0. The big mental model

OpenCutList does not have an explicit "part" editor. It **reads a SketchUp model**, finds component instances, classifies each by the **material type** painted on it, and derives sizes from geometry. For your app (unit → parts → surfacing → CSV) the useful layer is everything *after* geometry: the **PartDef / GroupDef data model**, the **edge/veneer rollup**, the **formula engine**, and the **export worker**. Nesting/cutting-diagrams exist in the repo but are out of scope (and you delegate that to Zinax).

Material has a **type** (`ruby/model/attributes/material_attributes.rb:12-18`):

```
TYPE_UNKNOWN=0  TYPE_SOLID_WOOD=1  TYPE_SHEET_GOOD=2  TYPE_DIMENSIONAL=3
TYPE_EDGE=4     TYPE_HARDWARE=5    TYPE_VENEER=6
```

Edge banding and veneer/face are themselves **materials** (types 4 and 6), i.e. "virtual" materials (`MaterialAttributes.is_virtual?` returns true for EDGE and VENEER, `material_attributes.rb:144-155`). Edge banding only applies to **sheet-good** parts (`cutlist_generate_worker.rb:262`, `if material_attributes.type == TYPE_SHEET_GOOD`).

---

## 1. Edge-banding model (priority #1)

### 1.1 How edges are named/oriented

A part is a box with a local oriented coordinate system (length = X, width = Y, thickness = Z). The four bandable edges are the four side faces, named by **which oriented face plane they sit on**:

- `:ymin`, `:ymax` — the two faces normal to the **Y** axis → these run **along the length** (they are the *long* edges). Constant: `PartDef::EDGES_Y = [:ymin, :ymax]` (`part_def.rb:8`).
- `:xmin`, `:xmax` — the two faces normal to the **X** axis → run **along the width** (the *short* edges). `PartDef::EDGES_X = [:xmin, :xmax]` (`part_def.rb:9`).

Veneer/face uses the Z faces: `VENEERS_Z = [:zmin, :zmax]` (`part_def.rb:11`) — `zmin` = back, `zmax` = front/top.

So the scheme is **min/max per axis**, not front/back/left/right. The CSV/UI labels are more human (see §4): `edge_ymin`="Edge Length 1", `edge_ymax`="Edge Length 2", `edge_xmin`="Edge Width 1", `edge_xmax`="Edge Width 2", `face_zmin`="Backside", `face_zmax`="Frontside" (`yaml/i18n-src/en.yml:683-688`).

### 1.2 How an edge material + thickness is assigned

Edges are **not** entered as fields — they are **detected from geometry**: for a sheet-good part, OpenCutList grabs the min/max side faces on each oriented axis and looks for a face whose painted material is of type `TYPE_EDGE`:

- `_grab_oriented_min_max_face_infos(...)` groups coplanar faces by normal and buckets them into min/max per axis (`cutlist_generate_worker.rb:1063-1086`).
- `_grab_face_typed_materials(face_infos, TYPE_EDGE)` keeps only materials of the requested type (`cutlist_generate_worker.rb:1088-1098`).
- The first such material per side becomes that edge's band material (`cutlist_generate_worker.rb:271-280`).

The **band material carries its own thickness and standard widths** as attributes (`material_attributes.rb`): `thickness` (type EDGE stores its own `@thickness`, `material_attributes.rb:201-212`), `std_widths`, `length_increase`, `width_increase`, and a boolean `edge_decremented` (`material_attributes.rb:22`, read at `:520`).

The edge is then turned into its **own virtual GroupDef + PartDef** (a line item in the BOM) by `_populate_edge_group_def` (`cutlist_generate_worker.rb:1263-1304`):

```
band.thickness  = edge_material.thickness                 # the banding thickness
band.width(std) = nearest_std_width_>=(panel_thickness + width_increase)  # from std_widths
```

So the band's **"width"** dimension equals the **panel's thickness** (snapped up to a stocked tape width), and the band's **"thickness"** is the tape thickness. Pattern & count are stored on the part:

- `set_edge_materials(ymin,ymax,xmin,xmax)` computes `edge_count` (compact count of non-nil) and an `edge_pattern` string (`part_def.rb:282-308`). Pattern order is `"#{ymax}#{xmax}#{ymin}#{xmin}"`, each char `1`/`0`, e.g. `"1010"`.

### 1.3 CRUCIAL: does edge banding reduce the part's cut size? YES — and it's opt-in per band material

There is a per-material flag **`edge_decremented`**. When true, applying that band **shrinks the panel's cut dimension by the band's thickness**, so cut size = finished size − banding. This is exactly the "finished size vs cut size compensation" you asked about.

**Arithmetic** (`cutlist_generate_worker.rb:301-308`):

```
ymin_decrement = ymin_band.edge_decremented ? ymin_band.thickness : 0
ymax_decrement = ymax_band.edge_decremented ? ymax_band.thickness : 0
xmin_decrement = xmin_band.edge_decremented ? xmin_band.thickness : 0
xmax_decrement = xmax_band.edge_decremented ? xmax_band.thickness : 0

length_decrement = xmin_decrement + xmax_decrement   # X-end bands eat LENGTH
width_decrement  = ymin_decrement + ymax_decrement   # Y-side bands eat WIDTH
```

Note the cross-mapping: the bands on the **X faces** (the width-running short edges) reduce the **length**, and the **Y faces** reduce the **width**. These decrements are stored on the part (`:560-563`).

The reduced cut dimensions are computed lazily (`part_def.rb:214-228`):

```
edge_cutting_length = max(size.length - edge_length_decrement, 0)
edge_cutting_width  = max(size.width  - edge_width_decrement , 0)

cutting_length = (cutting_size.length == size.length && edge_length_decrement)
                 ? edge_cutting_length : cutting_size.length
cutting_width  = (cutting_size.width  == size.width  && edge_width_decrement )
                 ? edge_cutting_width  : cutting_size.width
```

Interpretation: `size` = finished/bbox size, `cutting_size` = raw/oversize (finished + any material `length_increase`/`width_increase`). **Edge decrement is only applied when there is no raw oversize overriding it** (i.e. when `cutting_size == size`). So the precedence is: material oversize wins; otherwise finished − band thickness. When any decrement > 0 the group flips `show_cutting_dimensions` / `edge_decremented` so the UI shows both the finished and cut sizes (`:565-566`).

### 1.4 Veneer / face banding (present)

Same idea on the Z faces, but it reduces **thickness** and is **always** decremented (no per-material opt-in). `cutlist_generate_worker.rb:359-363` and `:388`:

```
zmin_decrement = veneer_zmin.thickness
zmax_decrement = veneer_zmax.thickness
thickness_decrement = zmin_decrement + zmax_decrement
part.thickness = max(instance_thickness - thickness_decrement, 0)
```

Veneer also records a **texture/grain angle** per face (`_get_face_texture_angle`, `:1100-1127`) and, when the texture is rotated, recomputes the veneer sheet's bounding length/width from the rotated rectangle (`:676-695`).

### 1.5 Total band LENGTH per material (the BOM rollup)

Each banded edge contributes a run equal to the corresponding part side, and is accumulated into the band material's own GroupDef (`cutlist_generate_worker.rb:648-671`):

```
for edge in EDGES_Y (ymin, ymax):          # long edges
    edge_length         = part.size.length
    edge_cutting_length = edge_length + band.length_increase
    band_group.total_cutting_length += edge_cutting_length
    band_group.total_cutting_area   += edge_cutting_length * band_group.std_width
    band_group.total_cutting_volume += edge_cutting_length * band_group.std_width * band_group.std_thickness

for edge in EDGES_X (xmin, xmax):          # short edges
    edge_length = part.size.width          # (same formulas, width instead of length)
```

`_populate_edge_part_def` (`:1306-1327`) creates/updates one virtual edge PartDef per distinct (edge, length, width, thickness) and bumps `count` — so **identical bands fold into one BOM row with a quantity**, and `band_group.total_cutting_length` is the **total linear length of that tape** across the whole job (what you print on the summary). Multiply by count happens implicitly because the rollup runs once per instance. The length is multiplied per instance (the loop at `:648` runs inside the per-instance accumulation block that is gated by `group_def...` and executed for each counted part — see `count` handling and `thickness_layer_count` at `:632`/`:710`).

Summary export then reads `group.def.total_cutting_length`, `total_cutting_area`, `total_cutting_volume` straight out (`cutlist_export_worker.rb:254-256`).

### 1.6 Honesty: what is NOT modeled

- **No grooves/dados/rabbets/mortises/drilling/hardware bores.** A repo-wide grep for `groove|dado|rabbet|rebate|pocket|mortise|tenon|drill|hinge` returns **nothing** in the Ruby. Hardware is only a material *type* for counting, not a machining feature. If your tool needs grooves, that is greenfield.
- Edges are inferred from **painted faces**, not declared. In your app you will declare them directly, which is simpler and more robust.

---

## 2. Cut-list generation & grouping

**Entry point:** `ruby/worker/cutlist/cutlist_generate_worker.rb` (the `run` method, ~1500 lines; core loop `:230-712`, grouping/folding `:750-873`).

Pipeline:

1. **Collect instances.** Walk the model, build an `InstanceInfo` per component instance (size from oriented bounding box, scale, flipped flag). `instance_info.rb`, `size3d`.
2. **Classify & size.** Material type decides branch (solid wood / sheet / dimensional / …). Compute `size` (finished) and `cutting_size` (raw = finished + material increases, snapped to std thickness/section). Sheet goods additionally run the edge/veneer detection of §1.
3. **Group key.** `GroupDef.generate_group_id = MD5(material_uuid | std_width x std_thickness)` (`group_def.rb:39-41`). So a **group == one material at one standard thickness/width**.
4. **Part key (identical-row detection).** `PartDef.generate_part_id = MD5(group_id | entity_id | L | W | T | flipped)` (`part_def.rb:99-111`), rounded to OCL precision. Equal geometry + material + flip ⇒ same part ⇒ `count += 1` (`:632`). Scale and (for dynamic components) name are folded into the id so differently-scaled copies split.
5. **Numbering.** Stable saved numbers per definition; otherwise auto-increment, optionally per-group, optionally letters (`:474-497`, `:755-765`).
6. **Folding (second-level grouping).** With `part_folding`, parts in a group that match on size, cutting_size, description, tags, final_area, **edge_material_names**, **face_material_names**, cumulable, ignore_grain_direction are merged into a `FolderPart` with children (`:772-838`). Edge/face identity is part of the fold key — so two panels only merge if their banding matches.
7. **Sort.** `PartDef.part_order` sorts by a user strategy string like `"length>-width>thickness"` (`part_def.rb:121-180`); `>` separates keys, leading `-` = descending. `GroupDef.group_order` similarly (`group_def.rb:43-81`).

**Fields a cut-list row carries** (`AbstractPart` in `ruby/model/cutlist/part.rb:13-61`): `number`, `name`, `description`, `url`, finished `length/width/thickness`, raw `cutting_length/width/thickness`, `edge_cutting_length/width`, `count`, `material_name`, `cumulable` (+ `cumulative_cutting_length/width`), `mass`, `price`, `thickness_layer_count`, `tags`, `ignore_grain_direction`, `edge_count`, `edge_pattern`, `edge_material_names` (hash keyed by `:ymin/:ymax/:xmin/:xmax`), `edge_std_dimensions`, `edge_decrements {length,width}`, `face_count`, `face_pattern`, `face_material_names` (`:zmin/:zmax`), `face_texture_angles`, `final_area`, plus `l_ratio/w_ratio`.

**Cumulable** = a per-part flag to sum identical parts end-to-end on one stick (NONE/LENGTH/WIDTH, `definition_attributes.rb:8-10`; math in `part_def.rb:230-244`). Useful for your dimensional stock.

### Grain direction modeling

There is **no "grain = length|width" enum**. Grain is modeled two ways:
- **Material-level boolean `grained`** (`material_attributes.rb:22`). If the material is grained, orientation matters and the part is oriented so grain follows the long axis; cutting-diagram/packing then respect rotation.
- **Per-part `ignore_grain_direction`** flag (`definition_attributes.rb:149`) to let a specific part rotate freely even in a grained material.
- For **veneer**, an explicit **texture angle in radians** is computed from UVs (`:1100-1127`) and exposed in degrees (`part.rb:55`).

So "grain direction" = (material.grained) AND (part not flagged ignore) AND (orientation locked to the length axis), rather than a stored direction field.

---

## 3. Formula / variable engine (`ruby/model/formula`)

This is the standout idea to port. Every export column (and label field) value is a **Ruby expression string** evaluated against a per-row data object.

- **Language:** real Ruby, evaluated with `eval(formula, data.get_binding)` (`ruby/worker/common/common_eval_formula_worker.rb:37`). Variables are the data object's instance variables referenced as `@name` (e.g. `@bbox_length * @bbox_width`).
- **Variables exposed:** the `FormulaData` subclass defines them. For a cut-list row (`ExportCutlistRowFormulaData`, `cutlist_export_worker.rb:503-568`): `@number @name @count @cutting_length @cutting_width @cutting_thickness @edge_cutting_length @edge_cutting_width @bbox_length @bbox_width @bbox_thickness @final_area @material @material_type @material_name @material_description @material_url @entity_names @description @url @tags @edge_ymin @edge_ymax @edge_xmin @edge_xmax @face_zmin @face_zmax @layers @component_definition @component_instances`.
- **Typed value wrappers** (`ruby/model/formula/formula_wrapper.rb`): values are wrapped (`LengthFormulaWrapper`, `AreaFormulaWrapper`, `VolumeFormulaWrapper`, `IntegerFormulaWrapper`, `StringFormulaWrapper`, `ArrayFormulaWrapper`, `MaterialFormulaWrapper`, `EdgeFormulaWrapper`, `VeneerFormulaWrapper`, …). They overload arithmetic so units compose (`Length * Length = Area`, `Area * Length = Volume`, `:681-689`, `:707-713`), offer unit conversions (`to_mm`, `to_m2`, `to_fbm` board-feet, `:118-148`, `:715-745`, `:794-796`), and define `export`/`to_s` for how the value is rendered (e.g. an `EdgeFormulaWrapper` renders as `"<name> (<thickness> x <width>)"`, `:956-967`). Empty length → empty string (`:691-695`).
- **Safety (important):** before `eval`, the formula is pre-parsed by a Ripper-based validator, `ruby/parser/formula_parser.rb`. It walks the AST and **raises `ForbiddenFormulaError`** on: blacklisted keywords (`alias`, `self`), blacklisted commands (`exec fork spawn system syscall exit eval send require open load sleep puts gem …`, `:14-27`), any **constant not in a whitelist** (`Math` only, `:29`, `:198-200`), global vars (`$…`), undefined instance vars (an `@x` not actually defined on the data object, `:84-89`), and `def/defs/class/module/undef/backtick/%x{}` constructs (`:142-188`). Only after it passes clean is `eval` run.

**Port plan:** this is directly reproducible in Python. Do **not** use `eval`. Use a safe expression evaluator (e.g. the `ast` module with a node whitelist, or `asteval`/`simpleeval`), expose a flat namespace of typed quantities (store lengths internally in one base unit, e.g. mm or inches), overload `__mul__` so length×length yields an Area type, and give each type an `export()`/`__str__`. Reproduce the whitelist-parse-then-evaluate two-step.

---

## 4. CSV / export schema

**Worker:** `ruby/worker/cutlist/cutlist_export_worker.rb`.

### Formats and options
- Formats: `table` (in-UI), `pasteable` (TSV to clipboard), `csv`, `xlsx` (`:25-28`). XLSX via a bundled `write_xlsx`.
- CSV separators: tab / comma / **semicolon (default)** (`:17-19`, `:39`). Encodings: UTF-8 (default, with BOM `\xEF\xBB\xBF`), UTF-16LE, UTF-16BE, each written with the matching BOM (`:124-134`, `:148`).
- **Three sources** (`:13-15`): `SUMMARY` (one row per material group), `CUTLIST` (one row per part/folder, default), `INSTANCES_LIST` (one row per physical instance; edges & veneers skipped since they have no instances, `:356-357`).

### Column set is user-defined (not hard-coded)
The exact columns and order come from `@col_defs` — a UI-configured, reorderable list where each column is `{ name, title, formula, hidden, align }` (`:424-453`). For each row, each visible column evaluates `col_def['formula']` or defaults to `"@#{name}"` (`:444-449`). Header text = custom `title`, else i18n `tab.cutlist.export.<name>`, else blank (`:424-438`).

**The available/native column names** (the palette users pick from) and their default header labels (`js/plugins/tabs/jquery.ladb.tab-cutlist.js:3277-3309` + `yaml/i18n-src/en.yml:654-691`):

| variable (`@name`) | default header | notes |
|---|---|---|
| `number` | "No." | part number |
| `name` | "Designation" | |
| `count` | "Quantity" | |
| `bbox_length` / `bbox_width` / `bbox_thickness` | "Length" / "Width" / "Thickness" | **finished** size |
| `cutting_length` / `cutting_width` / `cutting_thickness` | "Length - raw" / "Width - raw" / "Thickness - raw" | **cut** size (incl. edge decrement / oversize) |
| `edge_cutting_length` / `edge_cutting_width` | "Length edges - raw" / "Width edges - raw" | size after edge decrement only |
| `final_area` | "Area - final" | |
| `material` / `material_type` / `material_name` / `material_description` / `material_url` | "Material" / … | |
| `description` | "Description" | |
| `url` | "URL" | |
| `tags` | "Badges" | comma-joined array |
| `edge_ymin` | "Edge Length 1" | long edge 1 band |
| `edge_ymax` | "Edge Length 2" | long edge 2 band |
| `edge_xmin` | "Edge Width 1" | short edge 1 band |
| `edge_xmax` | "Edge Width 2" | short edge 2 band |
| `face_zmin` / `face_zmax` | "Backside" / "Frontside" | veneer faces |
| `layer` / `layers` | "Tag" / "Tags" | SketchUp layer(s) |
| `entity_names` | "Instance names" | |
| `component_definition` / `component_instance(s)` | — | |
| `batch` | "Batch" | position/count |

Summary source adds: `part_count` ("Number of Parts"), `total_cutting_length` ("Length total - raw"), `total_cutting_area`, `total_cutting_volume`, `total_final_area` (`:476-499`, `en.yml:658-672`).

### How edge-banding & grain appear in the CSV
- **Edge banding:** four separate columns `edge_ymin/ymax/xmin/xmax`. Each is an `EdgeFormulaWrapper(material, group_def)` whose default string render is **`"<material name> (<band thickness> x <band width>)"`** (`formula_wrapper.rb:956-967`). Empty string when no band on that edge. The **decrement** is reflected implicitly through `cutting_length`/`cutting_width` (reduced) vs `bbox_length`/`bbox_width` (finished). Total band length per material lives in the **Summary** export, not the per-part rows.
- **Veneer/face:** `face_zmin`/`face_zmax`, rendered `"<name> (<thickness>)"` (`:969-980`).
- **Grain:** not a dedicated column by default. It is carried indirectly via `material` (which knows `grained?`, `:940-943`), the part's orientation, and for veneer the texture angle. If you want a grain column you compose a formula.

### Other exports (brief)
- **DXF / SVG:** produced by the cutting-diagram and layout write-workers (`cutlist_cuttingdiagram1d_write_worker.rb`, `…2d_write_worker.rb`, `cutlist_layout_to_layout_worker.rb`, `cutlist_packing_write_worker.rb`) and by the labels worker — vector output of nested sheets / labels. Out of your scope (Zinax). 
- **Labels:** `cutlist_labels_worker.rb` + `ruby/model/labels/label_entry.rb` builds label entries (one per instance, with batch position, bin, custom formula values) using the same formula engine — a model worth copying if you print part labels.
- **Importer:** `ruby/worker/importer/importer_load_worker.rb` reads a CSV back into parts; its fixed field set is **`name, count, length, width, thickness, material, tags`** with per-field data types and a user column→field mapping (`:17-46`), auto-detecting encoding (rchardet) and separator. A good minimal round-trip schema.

---

## 5. What to re-implement in Python (concise)

Port the **ideas**, write your own code (GPLv3 — clean-room).

1. **Material-typed model with virtual EDGE/VENEER materials.** Give each material a type; edge bands and veneers are materials carrying their own `thickness`, `std_widths`, `length_increase`, and an **`edge_decremented`** opt-in flag. (`material_attributes.rb`.)
2. **Per-edge banding on 4 named edges** (`ymin/ymax/xmin/xmax` = long×2, short×2) + `edge_pattern` bit-string + `edge_count`. Since you build parts directly, let the user *assign* a band material per edge rather than inferring from faces. (`part_def.rb:282-308`.)
3. **Finished-vs-cut compensation (the key feature).** Store finished size; compute cut size as `cut_length = finished_length − (xmin_dec + xmax_dec)`, `cut_width = finished_width − (ymin_dec + ymax_dec)`, where each decrement = band thickness **iff that band's `decremented` flag is on**; clamp at 0; let a material oversize override the decrement. Veneer analogously reduces thickness (always). Expose both finished and cut on the row. (`:301-308`, `part_def.rb:214-228`, `:388`.)
4. **Band-length BOM rollup.** For each banded edge add `side_length (+ length_increase)` into a per-band-material accumulator; also roll up area (`length × band_width`) and volume. Fold identical bands into one line with a quantity. This gives "X metres of 22×1 ABS white". (`:648-671`, `_populate_edge_part_def`.)
5. **Two-tier grouping + quantity.** Group by (material, std thickness/width); within a group, hash parts by rounded (L,W,T,material,edges,…) to count identical parts; optional "folding" that merges rows only when banding/tags/description also match. Sort via a `"key>-key2"` strategy string. (`group_def.rb`, `part_def.rb:99-180`, `cutlist_generate_worker.rb:772-838`.)
6. **Safe formula engine for columns.** Flat `@variable` namespace of typed quantities; unit-aware arithmetic (len×len→area), unit-conversion methods, `to_s`/`export` per type; **parse-and-whitelist before evaluating** (use Python `ast`/`asteval`, never `eval`). (`formula_wrapper.rb`, `formula_parser.rb`, `common_eval_formula_worker.rb`.)
7. **Configurable CSV/XLSX export.** Columns = ordered list of `{name,title,formula,hidden,align}`; header from title/i18n; sources = summary / parts / instances; separator + encoding (BOM) options. Represent each of the 4 edges as its own column rendering `"name (thk x width)"`; keep finished and raw size columns distinct so the decrement is visible. (`cutlist_export_worker.rb`.)
8. **CSV importer schema** `name,count,length,width,thickness,material,tags` with column mapping + typed parsing, for round-tripping. (`importer_load_worker.rb`.)

**Explicitly do NOT bother porting** (not present / out of scope): groove/dado/rabbet/hardware-machining (absent), nesting/cutting diagrams and DXF/SVG nest output (Zinax's job).

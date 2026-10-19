# Free and Open-Source (FOSS) Software for Cabinet Design and Cut-List Generation

Scope note: This catalog focuses on genuinely free/open-source tools a cabinet maker can use to model carcasses/cabinets and/or produce a parts cut-list. Licenses and any paid tiers are flagged. Windows availability is called out because the user's own app is Windows (PySide6). Deep optimizer coverage is deferred to another researcher; optimizers are named but not exhaustively compared here.

## OpenCutList (SketchUp extension) — features, exports, license, cost

### Takeaway
OpenCutList is the single strongest FOSS tool in this space: a mature, GPLv3, donation-funded SketchUp extension that reads a model's components/materials and auto-generates parts lists, cutting diagrams, labels, and cost/weight reports, with CSV export and DXF/SVG export of parts and diagrams. It is free but requires SketchUp (desktop), and it does not run on SketchUp Free (web).

### Cited Findings
- OpenCutList "automat[es] the generation of a parts list, computing cutting diagrams, printing labels and generating cost and weight reports." It reads the components and material properties of a scene to produce parts lists, summary reports, cutting diagrams, and labels — [GitHub README](https://github.com/lairdubois/lairdubois-opencutlist-sketchup-extension).
- Supported material types: solid wood, panels/sheet goods, and dimensional lumber (handles fractional inches even when the model is metric); exploded views and a nesting view are shown in screenshots — [GitHub README](https://github.com/lairdubois/lairdubois-opencutlist-sketchup-extension).
- License is GNU GPLv3; distributed as a signed .rbz from the repo dist folder or the Trimble Extension Warehouse; available in 13 languages (plus experimental Arabic/Hebrew). Documentation at docs.opencutlist.org — [GitHub README](https://github.com/lairdubois/lairdubois-opencutlist-sketchup-extension).
- Feature summary from release coverage: "generates cut lists, estimates, cutting diagrams, labels, exploded views, SVG, DXF for woodworking or similar projects" — [SketchUp forum / OpenCollective coverage](https://opencollective.com/lairdubois-opencutlist-sketchup-extension/updates/opencutlist-7-1-is-out).
- Export — CSV: cut lists can be exported to CSV via the Export button — [SketchUp forum](https://forums.sketchup.com/t/opencutlist-exporting-cut-lists-diagrams/177120).
- Export — DXF: users export cutting diagrams to DXF from the Cutting Diagram window's Export button (can then be imported back into SketchUp / sent to Layout). Part name over parts in DXF is only possible when exporting from a generated Cutting Diagram window; exporting components one-by-one from the parts list does not place the part name inside the DXF — [SketchUp forum](https://forums.sketchup.com/t/opencutlist-exporting-cut-lists-diagrams/177120).
- Export — SVG: SVG export works per component (measures each component, builds its cut list, exports as SVG), used e.g. for Shaper Origin workflows (Shaper notes it does not maintain the extension) — [Shaper support](https://support.shapertools.com/hc/en-us/articles/23554199534491-Exporting-SVGs-from-SketchUp-Using-OpenCutList).
- DXF caveats: enabling the "Shape of Parts" option is needed for curved parts/holes to come through; a curved part otherwise exported as a plain rectangle and drilled holes did not transfer — [SketchUp forum](https://forums.sketchup.com/t/opencutlist-exporting-cut-lists-diagrams/177120).
- Version 7.1 shipped and was signed by Trimble in December 2025; added Outliner features ("Deep Rename parts," "Deep Make Unique," drag-and-drop) and arithmetic in the VCB — [OpenCollective update](https://opencollective.com/lairdubois-opencutlist-sketchup-extension/updates/opencutlist-7-1-is-out).
- Compatibility (informal user reports): works fine in SketchUp 2023; "if it worked on SU n, it'll work on n+1"; no reports of failing on Mac or Windows; the Extension Warehouse "not compatible" flag is often just a listing artifact — [SketchUp forum](https://forums.sketchup.com/t/cutlist-for-mac-with-sketchup-2023-no-longer-compatible-what-can-i-use/228406).
- Cost: free; funded by donations via OpenCollective ("if OpenCutList helps you save time... please consider a donation") — [OpenCollective](https://opencollective.com/lairdubois-opencutlist-sketchup-extension/updates/opencutlist-7-1-is-out).

### Inferences
- OpenCutList does NOT model/generate a cabinet from unit dimensions on its own — it depends on components you (or a cabinet-generating plugin/dynamic component) build in SketchUp, then produces the cut-list/diagrams/labels from them. It is a cut-list engine, not a carcass generator.
- Because it is a SketchUp desktop extension, it runs on Windows wherever SketchUp (Pro, or legacy Make 2017) runs, but is unavailable on SketchUp Free (web).

### Gaps
- XLSX/Excel export: none of the sources confirmed native XLSX export (only CSV was confirmed). Could not reach docs.opencutlist.org (DNS failure through the research proxy), so the authoritative, current export-format list and current version detail are unverified beyond v7.1.
- An "8.0 campaign" forum post mentions planned features (e.g. QR codes in labels); not confirmed as shipped.

## FreeCAD and its workbenches for furniture/cabinets; cabinet/cutlist add-ons

### Takeaway
FreeCAD itself has no built-in cabinet/cut-list feature, but a strong dedicated add-on exists: the MIT-licensed "Woodworking" workbench (dprojects/Woodworking), which auto-generates cut lists/BOM with cost/weight and exports CSV/JSON/HTML/Markdown. The older Timber/Wood Frame workbenches target timber-frame construction and are largely unmaintained.

### Cited Findings
- **Woodworking workbench (dprojects/Woodworking):** FreeCAD add-on aimed mainly at simple home/garage cabinets (also general carpentry/CAD). Generates an automatic cut list via `getDimensions`, which also calculates wood weight and cost. `sheet2export` exports the cut list as CSV, JSON, HTML, and Markdown. Covers joinery/hardware (dowels, screws, minifix). License MIT. A Linux AppImage is provided (bundles a tested FreeCAD); manual install documented for other setups. Repo: 512 commits, 576 stars, 52 forks; README references a 4.0 release package — [GitHub: dprojects/Woodworking](https://github.com/dprojects/Woodworking).
- **Timber Workbench:** official wiki states it is "no longer developed or maintained"; purpose is modeling wooden constructions (frame, timber frame); includes a "Timber Listing" tool — [FreeCAD wiki: Timber Workbench](https://wiki.freecad.org/Timber_Workbench).
- **Wood Frame workbench:** a fork of FreeCAD-Timber (wood-galaxy), also no longer maintained; lists "listing for invoices and production list" — [FreeCAD wiki: Wood Frame Workbench](https://wiki.freecad.org/Wood_Frame_Workbench).
- FreeCAD community discussion: woodworkers want cut lists to maximize parts per plywood sheet; a cut list is defined as "(raw) material, length and amount of every piece"; Assembly3/Assembly4 (using App::Link, introduced in 0.19) are relevant for parametric assemblies — [FreeCAD DevTalk: FreeCAD for Woodworking](https://devtalk.freecad.org/t/freecad-for-woodworking/35356).

### Inferences
- The dprojects/Woodworking workbench is the best FOSS FreeCAD path to a FreeCAD-native cut list with export; its MIT license and CSV/JSON/HTML/Markdown export make it friendly for downstream tooling (e.g. feeding a Windows app).
- FreeCAD runs on Windows/Mac/Linux, but the Woodworking workbench's packaged convenience build is a Linux AppImage; Windows users would install the workbench manually into a FreeCAD install.

### Gaps
- Could not load wiki.freecad.org or devtalk.freecad.org directly (DNS failures via proxy); workbench details are from search snippets and the GitHub README. No confirmation of panel-nesting/cutting-diagram or edge-banding features in the Woodworking workbench (README does not mention them).
- Whether Timber "Timber Listing" or Wood Frame "production list" export to spreadsheet is unconfirmed.

## SketchUp-based free plugins / dynamic components; is SketchUp Free (web) usable?

### Takeaway
SketchUp Free (web) is NOT usable for this workflow: it does not support extensions and is personal-use only. A free cabinet workflow therefore requires a desktop SketchUp (Pro, or legacy free Make 2017) plus OpenCutList and/or dynamic components.

### Cited Findings
- SketchUp Free (web) "does not support extensions" / "plugins can not be used with the web version"; the Extension Warehouse is "exclusively for desktop versions, not web versions" — [SketchUp forum](https://forums.sketchup.com/t/sketchup-web-versions-capabilities/120249); [Mindsight Studios support](https://support.mindsightstudios.com/hc/en-us/articles/360063472273-Do-the-plugins-work-with-the-free-version-of-SketchUp).
- SketchUp Free also lacks Pro extensions, Layout, and CAD file import; limited to 10 GB storage; free designs are "for personal purposes only and not commercial" — [maketecheasier guide](https://maketecheasier.com/?p=422202).
- Legacy free desktop option: SketchUp Make 2017 does support plugins (dated; verify current availability) — [SketchUp forum](https://forums.sketchup.com/t/sketchup-web-versions-capabilities/120249).

### Inferences
- For a cabinet maker wanting a free SketchUp-based cut-list workflow, the realistic free route is SketchUp Make 2017 (desktop) + OpenCutList, since current SketchUp Pro is paid and SketchUp Free (web) blocks extensions. OpenCutList itself remains free on any desktop SketchUp.

### Gaps
- No current (2025–2026) official Trimble statement confirming the web-version extension policy was found; sources are forum/third-party and somewhat dated (though consistent).
- Did not find a specific actively-maintained FOSS "cabinet dynamic component" generator for SketchUp (dynamic components are a native Pro feature; free carcass-generating DC libraries were not surfaced).

## Blender add-ons for cabinetry/furniture; LibreCAD/QCAD for 2D parts

### Takeaway
Blender's cabinetry ecosystem is mostly paid (MakraCab, Furnimatic, ProCutter) with one notable free add-on (Home Builder 5); none are confirmed OSS. LibreCAD and QCAD are solid GPL 2D CAD tools for drawing/exporting parts as DXF but have no cabinet or cut-list automation.

### Cited Findings
- **Home Builder 5** — free Blender add-on for cabinet/layout design; v5.1.0 (March 21, 2026) added Blender 5.1 support, stair tools, cabinet material updates; adds wall elevations, floor plans, multi-view sheets with dimensions/annotations — [Blender Extensions: home-builder-5](https://extensions.blender.org/add-ons/home-builder-5/). (License not confirmed as OSS in results.)
- **MakraCab** — cabinet creation, nesting, and pricing; requires Blender 5.1; workflow: choose cabinet type, set dimensions, generate nesting + pricing; works with Cycles/Eevee. Paid — [Super Hive Market](https://superhivemarket.com/products/makracab-cabinet-design-nesting/docs).
- **Furnimatic** — parametric generator for kitchens/wardrobes/TV units; dimensions, materials, appliances, handles; v1.1 added auto animations and L/U/G corner cabinets. Paid — [Super Hive Market](https://superhivemarket.com/products/furnimatic).
- **ProCutter Plus** ($8.99) integrates with CutList Plus fx for CNC routing; **ProCutter** ($20, Gumroad) designs cabinet parts and outputs a full cut of all parts in one click. Paid — [Super Hive Market: Procutter Plus](https://superhivemarket.com/products/procutter-plus).
- **LibreCAD** — free, GPL 2D CAD on Qt (C++17); reads DXF/DWG, writes DXF/PDF/SVG; source on GitHub — [GitHub: LibreCAD/LibreCAD](https://github.com/LibreCAD/LibreCAD).
- **QCAD** — free/open-source 2D CAD for Windows/macOS/Linux; source GPLv3; part library of 4800+ CAD parts; scripting interface and CLI conversion tools; current version ~3.33; DXF native, DWG via commercial plugin — [QCAD.ch](https://qcad.ch/).

### Inferences
- Blender is a viable free modeler, but the only free cabinet-specific add-on surfaced (Home Builder 5) is not confirmed open-source; the OSS-with-cut-list path in Blender is weak compared to OpenCutList/FreeCAD.
- LibreCAD/QCAD are useful downstream for drafting/exporting individual parts to DXF (feeding a CNC or optimizer) but do not turn unit dimensions into a parts list.

### Gaps
- License status (true OSS vs. freeware/paid) of Home Builder 5 not confirmed. Did not locate a clearly FOSS Blender cabinet+cutlist add-on.

## Dedicated open-source "cabinet maker" / carcass generators (dimensions -> parts list)

### Takeaway
A few FOSS projects turn cabinet dimensions into parts: the FreeCAD Woodworking workbench (above), an OpenSCAD woodworkers cut-list library (code-driven), and the GPL Sweet Home 3D "Cabinet Maker" plugin (generation only, no confirmed cut-list). None is a polished standalone Windows carcass-to-cutlist app.

### Cited Findings
- **OpenSCAD woodworkers cut-list library (lenbok/woodworkers-lib, code-driven):** generates woodworking cut lists from OpenSCAD furniture designs via automatic ECHO output of panel sizes and edge-banding specs. Example defines an 800×400×1200 cabinet, calls `planeLeft/Right/Top/Bottom/Back` modules, runs OpenSCAD from the CLI, and filters output for "plane" lines; output lists panels (e.g., 18 mm sides, 4 mm back) — [Smithery skill page describing woodworkers-lib](https://smithery.ai/skills/dawiddutoit/openscad-cutlist-woodworkers).
- **Sweet Home 3D "Cabinet Maker" plugin:** GPL (per author's forum post) plugin that automates custom kitchen cabinets/wardrobes; browser configurators export a JSON string the Java plugin reads to generate 3D models; generated cabinets include drawers/doors, custom widths, corner fillers; has an AI-prompt layout generator; v1.0.2 announced; at least one user reported the base-cabinet "Okay" button doing nothing (open issue, unconfirmed) — [Sweet Home 3D forum](https://www.sweethome3d.com/support/forum/viewthread_thread,14733).
- **AVS Woodworker's Module Suite** (older OSS): includes a "cabinet maker" module that generates box-based structures; source included; results did not mention a parts list — [AVS cabinet_make docs](https://debian.man.ac.uk/.f/pub/cgu/avs/avs_modules/data_input/cabinet_maker/cabinet_make.txt).

### Inferences
- The closest FOSS "dimensions in -> parts list out" experiences are (a) FreeCAD Woodworking workbench (GUI, MIT, exports CSV/JSON/HTML/MD) and (b) OpenSCAD woodworkers-lib (code/CLI, ECHO cut-list). Both require technical setup; neither is a turnkey Windows GUI app.
- Sweet Home 3D Cabinet Maker generates the 3D cabinet from dimensions/JSON but is not confirmed to output a cut-list, so it complements rather than replaces a cut-list tool.

### Gaps
- Could not confirm lenbok/woodworkers-lib's current status, exact license, or install from the repo directly (only a third-party description was reachable).
- Sweet Home 3D Cabinet Maker's GPL status rests only on the author's forum post (no license file reviewed); its official download page/license text was not retrieved.
- Non-English/French forum comments surfaced for several tools; those secondary claims are noted as informal.

## Open-source cut-list / panel optimizers that pair with these (named only; deep coverage deferred)

### Takeaway
Two clearly FOSS panel optimizers exist to pair with the modeling tools above — opcut (GPLv3, Python, CLI/REST/web) and freecut (Rust GUI). CutList Optimizer (the common reference) is freemium/commercial, not OSS. Deep optimizer comparison is deferred to another researcher.

### Cited Findings
- **opcut** — cutting-stock optimizer for multiple panels with guillotine cuts; ships as CLI, REST API, and single-page web app; on PyPI, Docker, and AUR. License GPL-3.0-only; copyright Bozo Kopic 2017–2022 — [GitHub: bozokopic/opcut](https://github.com/bozokopic/opcut); [PyPI opcut 0.3.2](https://pypi.org/project/opcut/0.3.2); [Arch package listing](https://pkgdex.org/arch-linux/rolling/any/aur/opcut-0.4.16-1.rpm.html).
- **freecut** — Rust GUI (FLTK bindings) tool to cut rectangular pieces from panels; installed via cargo; generates a PDF solution; offers a guillotine layout mode for panel saws — [lib.rs: freecut](https://lib.rs/crates/freecut).
- **CutList Optimizer** (reference, not OSS) — browser-based cutting optimizer, freemium; supports edge banding and grain orientation — [forestsource.io](https://forestsource.io/software/cutlist-optimizer).
- **Optimik** (not OSS) — professional cutlist optimizer; one-time purchase ~$290–$750 and/or subscription, with a free limited version — [AlternativeTo: Optimik](https://alternativeto.net/software/optimik/about).

### Inferences
- opcut is the best OSS optimizer to self-host/integrate (its REST API and Python base could pair cleanly with a Windows PySide6 app); freecut is a lighter desktop option. Both pair with OpenCutList/FreeCAD outputs but neither generates the cabinet parts themselves.

### Gaps
- Edge-banding/grain-constraint support in opcut and freecut was not confirmed (CutList Optimizer confirms these; the OSS tools' results did not). Windows-specific packaging/binaries for opcut and freecut not explicitly confirmed (Python/cargo installs imply cross-platform including Windows).

## Cross-cutting notes for a Windows (PySide6) context
- OpenCutList, FreeCAD + Woodworking workbench, OpenSCAD + woodworkers-lib, LibreCAD, QCAD, opcut, and freecut are all cross-platform and run on Windows (OpenCutList requires a desktop SketchUp; Woodworking workbench's prebuilt convenience image is a Linux AppImage but the workbench installs into Windows FreeCAD).
- Common machine-readable exports in this FOSS ecosystem: CSV (OpenCutList; FreeCAD Woodworking), plus JSON/HTML/Markdown (FreeCAD Woodworking), and DXF/SVG for parts/diagrams (OpenCutList). XLSX is not confirmed in any FOSS tool here.
- A clean integration seam for a Windows app: ingest CSV/JSON/DXF parts lists from OpenCutList or the FreeCAD Woodworking workbench, and/or call opcut's REST API for optimization.

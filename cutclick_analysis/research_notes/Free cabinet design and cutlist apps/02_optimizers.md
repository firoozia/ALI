# Free Panel / Sheet Cut-List Optimizer Tools (Nesting / Cutting-Diagram Generators)

Scope: rectangular sheet-goods optimizers (MDF, melamine, plywood) that take a parts list
(length × width × qty, material, edge-banding/grain) and produce an optimized cutting layout /
cut-list. Emphasis on FREE options, their free-tier limits, input formats (manual, CSV, Excel),
and export formats (PDF/CSV/Excel/DXF/label/barcode) for feeding downstream CNC/beam-saw software.

> Research constraint / method note: In this environment, direct page fetching (WebFetch and raw
> curl) was blocked by the egress proxy for the relevant vendor hosts (cutlistoptimizer.com,
> maxcutsoftware.com, optimalon.com, apps.apple.com, rogueengineer.com all refused with DNS
> ENOTFOUND / CONNECT 403). All findings below therefore come from **web-search result snippets**
> (which do route successfully), not from the vendors' live pages. Exact current pricing numbers
> and some free-tier caps could not be verified against primary pricing pages and are flagged as
> gaps. Treat vendor marketing claims as unverified where noted.

---

## Key Question 1 — CutList Optimizer (cutlistoptimizer.com): free limits, features, import/export, edge banding, grain, labels

### Takeaway
CutList Optimizer (by developer "Cloptimizer") is the best-known **free, browser-based** rectangular
sheet-goods optimizer, with companion **Android and iOS** apps that sync projects to the same online
account. It supports grain direction, per-side edge banding, CSV import / paste-from-spreadsheet
(added in v4.0), and PDF/image/label/CAD export. Its exact free-vs-paid limit structure and any Pro
price could not be confirmed from a primary pricing page in this session.

### Cited Findings
- It is offered as an online web app at www.cutlistoptimizer.com, with a companion Android app by
  developer **Cloptimizer** that "saves projects online and syncs them between Android and web"; the
  app is free to download — [AppBrain listing](https://www.appbrain.com/app/cutlist-optimizer/com.cutlistoptimizer)
- The iOS "CutList Optimizer" listing is **free with in-app purchases**, and advertises unlimited
  projects/calculations/parts plus grain support and edge banding (listing does not state which
  features sit behind the purchases) — [Apple App Store](https://apps.apple.com/app/id6465744401)
- Changelog/feature references: CutList Optimizer (the Cloptimizer app) **added CSV import and a
  paste-to-insert feature in its 4.0 update**; its changelog lists **label PDF export**, and the
  listing mentions PDF and image export — [WebSearch result citing changelog/listing](https://apps.apple.com/ae/app/id1629462860)
- A related App Store entry (cutlistopt.com) supports **HD PDF export and CAD file export** and
  **tagging of sheets and parts**; shows "In-App Purchases" but prices not listed — [WebSearch result](https://apps.apple.com/ae/app/id1629462860)
- A browser-based "CutList Optimizer" (forestsource listing) runs on a **freemium** model, accounts
  for **edge banding and grain orientation**, saves projects, and exports results to **PDF or
  images**; free-tier caps not specified — [forestsource.io](https://forestsource.io/software/cutlist-optimizer)
- OpenCutList → cutlistoptimizer.com workflow is common: one reviewer edited an OpenCutList CSV in
  Excel and **imported it into cutlistoptimizer.com** to avoid re-entering parts by hand — [SketchUp forum / Rogue Engineer via WebSearch](https://forums.sketchup.com/t/opencutlist-version-6-0-0-is-out/260630)
- **No barcode option was found** for CutList Optimizer; barcode printing is a feature of other
  tools (OptiCut, Eurosoft ARDIS) — [WebSearch result](https://wooddesigner.org/opticut-label-printing/)

### Inferences
- The product is effectively a free cloud optimizer monetized via ads / optional Pro (common pattern
  for this category); grain and edge-banding support plus CSV/paste import make it suitable as a
  front-end whose PDF/image/CAD output feeds a shop, though it is oriented to table-saw/panel-saw
  cutting diagrams rather than native beam-saw program files.

### Gaps
- Exact free-tier limits (parts cap, calculations/day, ads, watermark) and the Pro subscription
  price for cutlistoptimizer.com could not be confirmed — the site's own pricing/FAQ page was not
  reachable (egress blocked) and search did not surface a pricing page.
- Whether CSV/label/CAD-export features are free or gated behind in-app purchase is unconfirmed.

---

## Key Question 2 — MaxCut, OptiCut, CutLogic 2D, Cutting Optimization Pro, SmartCut, PanelCutPro, Cut Master, OnBarcode-style tools: which are free and what do they do?

### Takeaway
MaxCut (Windows) has a genuinely free, non-expiring **Community Edition**; OptiCut (Boole &
Partners) is paid with a demo that cannot export; CutLogic 2D and Cutting Optimization Pro are paid
desktop tools with no verifiable free tier (search surfaced mostly crack/spam pages); "SmartCut",
"Cut Master" and similar are freemium mobile apps.

### Cited Findings — MaxCut
- **MaxCut Community Edition is free**: a Windows desktop app that runs entirely offline after a
  one-time install, with **no time limit / no trial period**; advanced features are reserved for the
  paid Business Edition — [MaxCut Software](https://maxcutsoftware.com/cutlist-optimizer-free-download-windows/)
- Free version covers **core cut-list and nesting optimization**; users report **grain-direction
  setting, saw-kerf input, and printing sticky labels** for stacks of parts in the free version — [getapp](https://www.getapp.co.nz/software/2092347/maxcut-software); [SawmillCreek forum](https://sawmillcreek.org/goto/post?id=2899815)
- Business Edition is paid, one listing giving a starting price of **US$20.00 per user** — [SoftwareAdvice AU](https://www.softwareadvice.com.au/software/517425/MaxCut-Software)
- MaxCut has an open feature request to **support export to older DXF versions**, implying DXF export
  exists at least in paid tiers — [MaxCut feedback](https://feedback.maxcutsoftware.com/p/support-export-to-older-dxf-versions-JLFdYJ)

### Cited Findings — OptiCut (Boole & Partners)
- Described as a cutting-optimization application for **panels and linear bars** by Boole & Partners;
  a demo exists but the companion OptiNest demo **cannot export optimization results** — [OptiNest help](https://wooddesigner.org/help-centre/optinest-set-up-and-overview/); [forestsource.io](https://forestsource.io/software/opticut)
- OptiCut can **print a field as a barcode** on labels — [wooddesigner OptiCut label printing](https://wooddesigner.org/opticut-label-printing/)

### Cited Findings — CutLogic 2D & Cutting Optimization Pro
- **CutLogic 2D**: no reliable free-trial/pricing page found; the only page mentioning a 30-day trial
  + free Community Edition is a **spam/crack page** and is unverified — [edx.ipeindia.org (spam, unverified)](https://edx.ipeindia.org/knoll-bluff/cutlogic-2d-crack)
- **Cutting Optimization Pro**: only descriptions found are on crack-download forum posts (unreliable);
  described as doing 1D/2D optimization, guillotine and nested cutting — not from the vendor — [alternativeto.net](https://alternativeto.net/software/cuttingopt-pro/about/)

### Cited Findings — SmartCut / Cut Master / other mobile freemium
- **SmartCut (Cutlist Optimizer V2)**: App Store listing **free with in-app purchases**; generates
  cut diagrams for sheets/boards/bars with blade width, grain direction, and PDF export — [Apple App Store](https://apps.apple.com/app/id1579298749)
- **"Cutlist Optimizer: Cut Master"**: a **free (with in-app purchases)** iPad app covering plywood,
  acrylic, glass, and metal; aimed at fabricators as well as woodworkers — [Apple App Store](https://apps.apple.com/kr/app/id6744231987)
- **Boardcut (iOS)**: free tier gives the **full tool up to 10 pieces** (optimizer, cut diagram,
  ordered cut steps, sheet-image sharing); works offline — [Apple App Store / mwm.ai](https://mwm.ai/apps/boardcut-cut-list-optimizer/6787905177)
- **CutList Plywood Optimizer (iOS)**: PDF export and AI cut-list import are **Pro** features; Pro
  Monthly **$9.99/mo with a 7-day trial** — [appshunter.io](https://appshunter.io/ios/app/cutlist-plywood-optimizer/id6768171871)
- **CutList Plus Express**: NOT free — Windows program priced at **$39**; its companion mobile apps
  are free only to those who bought the desktop software — [WoodworkingNetwork](https://www.woodworkingnetwork.com/wood-market-trends/woodworking-industry-trends-press-releases/New-CutList-Plus-Express-Optimizing-Software-For-Woodworkers-293907841.html)
- **OnBarcode-style tools**: no dedicated sheet-goods optimizer surfaced; barcode/label capability in
  this category is an add-on (OptiCut barcode field; **Eurosoft ARDIS** offers label printing with
  optional 2-D barcodes; FastCUT has a Labels add-on) — [FastCUT Labels](https://fastcam.com/fastcut-labels.html); [wooddesigner](https://wooddesigner.org/opticut-label-printing/)

### Inferences
- Among this group, **MaxCut Community Edition is the only true free, full-desktop optimizer** with
  no time limit; the rest are either paid desktop (OptiCut, CutLogic 2D, Cutting Optimization Pro,
  CutList Plus) or freemium mobile apps with piece-count or export gating.

### Gaps
- **"PanelCutPro" and "Cut Master" (as a standalone woodworking desktop tool) and "boardcutpro"**
  returned no matching products — these names may be misremembered or very niche; could not confirm
  existence/pricing.
- CutLogic 2D and Cutting Optimization Pro official pricing/trial terms unverified (vendor pages not
  reachable; search dominated by spam).
- Exact list of MaxCut Business-only features vs Community is not itemized here.

---

## Key Question 3 — Online free optimizers (cutlistoptimizer, Optimalon, boardcutpro) and open-source optimizers (SVGnest/Deepnest family, OpenCutList engine)

### Takeaway
Free online rectangular optimizers include **cutlistoptimizer.com, Optimalon (free tier),
CutListLab, CutListCalc, and Rogue Engineer's optimizer**. Open-source options are **OpenCutList**
(SketchUp extension, free + crowdfunded) and the **SVGnest → Deepnest** family (true nesting, better
for irregular shapes than rectangular panels).

### Cited Findings — Optimalon (online)
- **Free web app**: create, store and modify 2D cutting projects from any browser, no install;
  generates graphical cutting layouts you can save and zoom — [Optimalon](https://optimalon.com/online_cut_optimizer.htm); [24-7pressrelease](https://www.24-7pressrelease.com/press-release/267027/)
- Uses **guillotine cutting** with **five complexity levels** (2 XY, 3 Two-Stage XY, 4 XYZ, 5 XYZW,
  6 Standard); supports metric + imperial; parts can be marked **non-rotatable to preserve grain**;
  supports **kerf and trim** settings — [Optimalon via WebSearch](https://optimalon.com/online_cut_optimizer.htm)
- **Premium (paid)** features: **import/export panels & parts to Excel**, detailed **Excel report**,
  and **export graphical layouts as AutoCAD DXF**, plus CNC-compatible output; pricing reported at
  **~$7–$10/month** with a free limited version — [alternativeto.net](https://alternativeto.net/software/optimalon-online-panel-cut-optimizer/about); [metalworkingworld](https://www.metalworkingworldmagazine.com/46447)
- Companion **1DCutX** is a length-cutting optimization **add-in for Microsoft Excel** (linear stock) — [WebSearch](https://optimalon.com)

### Cited Findings — other free online tools
- **CutListLab**: free, **no signup, no limit on parts or optimizations**, with grain and edge-banding
  support; printable cutting diagram, least-waste, sheet count — [saashub](https://www.saashub.com/cutlistlab); [alternativeto](https://alternativeto.net/software/cutlistlab/)
- **Rogue Engineer Free Cut List Optimizer**: browser tool for table-saw/track-saw users; **no
  account, no daily limit, no watermark, no subscription** (funded by selling plans); accepts
  fractions (e.g., 23¾ or 23 3/4); produces **guillotine-style cuts**, figures how many
  sheets/boards to buy, numbered cut order, shopping list, **printable cut sheets and part labels**,
  and **grain lock** (parts can't be rotated) — [Rogue Engineer](https://rogueengineer.com/cut-list-optimizer/)
- **CutListCalc**: browser-based, **no registration/paywall/install**; handles sheet goods + linear
  cuts; exports **PDF diagrams** — [peerpush](https://peerpush.com/p/cutlistcalc)
- **373 Nesting**: NOT free long-term — **14-day free trial, no credit card**, paid plans from ~A$9/mo — [Capterra](https://www.capterra.com/p/10046042/373-Nesting-2d-Panel-Cutting-Optimizer/)

### Cited Findings — OpenCutList (open source)
- **Free, open-source, crowdfunded SketchUp extension**: cut list, cutting diagrams, and reports — [SketchUp forum](https://forums.sketchup.com/t/opencutlist-version-6-0-0-is-out/260630)
- Exports results as **CSV** (flat rows only; summary view is not included in CSV) — [SketchUp forum / lairdubois](https://www.lairdubois.fr/questions/reponses/6251)
- v6.0.0 added **export of parts geometry in 2D or 3D in common file formats**; can export design
  elements as **.SVG** (used e.g. for Shaper Origin workflows) — [Shaper support](https://support.shapertools.com/hc/en-us/articles/23554199534491); [SketchUp forum](https://forums.sketchup.com/t/opencutlist-version-6-0-0-is-out/260630)
- Cutting-diagram algorithm seeks the **cheapest layout**; entered off-cuts are used only if they
  reduce cost — [SketchUp forum](https://forums.sketchup.com/t/off-cuts-in-open-cutlist/346946)
- Supports **labels**; **v7.0 promised customizable QR codes on labels** (built from Ruby formulas —
  shipping not confirmed) — [SketchUp 8.0 campaign thread](https://forums.sketchup.com/t/opencutlist-a-crowdfunded-extension-8-0-campaign/301089)
- Known constraints: works with **components, not groups**; very **picky about part dimensions**
  (tiny thickness differences stop identical parts from grouping); labels/dimensions **do not carry
  into LayOut** when drawing selected parts — [finewoodworking forum](https://finewoodworking.com/forum/cut-list-programs-review); [SketchUp forum](https://forums.sketchup.com/t/exporting-open-cut-list-to-layout-labels-no-showing/294934)

### Inferences
- For a free online rectangular optimizer that **exports DXF/Excel for a CNC/beam-saw downstream**,
  Optimalon's **paid** tier or MaxCut (desktop) are the realistic routes; the fully-free online tools
  (CutListLab, CutListCalc, Rogue Engineer, free cutlistoptimizer) center on **PDF/image/print**
  output rather than machine files.
- OpenCutList is the strongest **open-source** panel optimizer, but it is bound to SketchUp and its
  machine-facing export is **SVG/CSV**, not beam-saw program formats.

### Gaps
- Optimalon exact current free-vs-premium feature split and price verified only via third-party
  listings (2012–2014 press + alternativeto), not the live vendor page.
- OpenCutList's underlying packing-engine name/algorithm and license specifics not confirmed from the
  repo in this session.

---

## Key Question 4 — Deepnest.io / Deepnest (open-source nesting): relevant for irregular shapes vs rectangular panels?

### Takeaway
Deepnest (open source, built on SVGnest) is a **true irregular-shape nesting** tool aimed at laser /
plasma / CNC cutters — valuable for odd geometry but **overkill / not the natural fit for plain
rectangular sheet-goods** cut-lists, where guillotine optimizers (MaxCut, cutlistoptimizer,
Optimalon) are simpler and give beam-saw-friendly straight cuts.

### Cited Findings
- Deepnest is a **free, open-source nesting app** for laser/plasma/CNC; desktop app built on
  **SVGNest**, with a **C-based nesting engine**, line merging, and path approximation for complex
  parts; GitHub at functionalprototype/Deepnest, download at deepnest.io — [GitHub](https://github.com/functionalprototype/Deepnest); [all3dp](https://all3dp.com/2/best-free-nesting-software-for-laser-cutting/)
- **Import**: reads **DXF, SVG, and Corel CDR**; **Export**: writes **DXF and SVG** (DXF support works
  via conversion) — [GitHub readme / Yale tutorial](https://www.architecture.yale.edu/advanced-technology/tutorials/109-deepnest-io)
- **Line merging**: shared edges merged so the laser doesn't cut the same path twice (reduces cut
  time) — [all3dp](https://all3dp.com/2/best-free-nesting-software-for-laser-cutting/)
- Limitations: **web version supports only one sheet**; no editing features; uses a lot of CPU while
  nesting; some users report trouble reading certain DXF/SVG files (workaround: re-export via Fusion
  360) — [LightBurn forum](https://forum.lightburnsoftware.com/t/nesting-of-objects-on-more-sheets/135189)

### Inferences
- Deepnest / SVGnest are the right tool when parts are **irregular polygons** (cabinet hardware
  brackets, curved panels, metal/acrylic shapes) and the machine is a **laser/plasma/router** that
  cuts arbitrary paths. For MDF/melamine/plywood casework cut on a **panel/beam saw**, rectangular
  guillotine optimizers are more appropriate because they respect straight edge-to-edge cuts, grain,
  and edge-banding allowances — concepts Deepnest does not model.
- Deepnest does **not** take a tabular length×width×qty parts list with grain/edge-banding fields; it
  takes geometry files (DXF/SVG/CDR), so it is not a drop-in replacement for a cut-list optimizer.

### Gaps
- No current (2024–2026) release/maintenance status confirmed for the Deepnest fork(s); the active
  fork appears to be functionalprototype/Deepnest but activity level not verified.

---

## Key Question 5 — Parts-list input formats and downstream CNC/beam-saw export

### Takeaway
Manual entry is universal. **CSV import / paste-from-spreadsheet** is supported by cutlistoptimizer
(v4.0+), iOpticut, and Optimalon (Excel, premium); OpenCutList and Fusion 360's ExportCutlist
*produce* CSV in cutlistoptimizer's format. For downstream CNC/beam-saw, the machine-facing exports
are **DXF** (Optimalon premium, MaxCut, Deepnest, iOpticut) and **Excel/CNC output** (Optimalon
premium); fully-free tools mostly stop at **PDF/image/label** output.

### Cited Findings — inputs
- **cutlistoptimizer**: **CSV import + paste-to-insert** (v4.0); also fed by OpenCutList and Fusion
  360 ExportCutlist CSV — [WebSearch changelog](https://apps.apple.com/ae/app/id1629462860); [GitHub Fusion360-ExportCutlist](https://github.com/bluekeyes/Fusion360-ExportCutlist)
- **iOpticut**: accepts **CSV upload or pasted text**, previews data, provides a **downloadable
  template**; sets **grain direction per part** and **edge banding per side** — [WebSearch / mwm.ai](https://mwm.ai/apps/iopticut/374511507)
- **Optimalon (premium)**: **import panels & parts from Excel** — [alternativeto](https://alternativeto.net/software/optimalon-online-panel-cut-optimizer/about)
- **OpenCutList**: results saved as **CSV** (flat rows; summary not exported) — [lairdubois](https://www.lairdubois.fr/questions/reponses/6251)
- **Fusion 360 ExportCutlist** add-in exports **CSV including the cutlistoptimizer.com format** — [GitHub](https://github.com/bluekeyes/Fusion360-ExportCutlist)

### Cited Findings — outputs for CNC / beam-saw
- **Optimalon premium**: **Excel report, AutoCAD DXF layout export, CNC-compatible output** — [metalworkingworld](https://www.metalworkingworldmagazine.com/46447); [alternativeto](https://alternativeto.net/software/optimalon-online-panel-cut-optimizer/about)
- **MaxCut**: DXF export exists (feature request is specifically for *older* DXF versions) — [MaxCut feedback](https://feedback.maxcutsoftware.com/p/support-export-to-older-dxf-versions-JLFdYJ)
- **Deepnest**: **DXF/SVG export** (geometry nesting, for laser/plasma/router) — [GitHub](https://github.com/functionalprototype/Deepnest)
- **iOpticut**: exports **SVG or DXF** cutting layouts; PDF package with diagrams, cut lists,
  material summaries, and an **edge-banding list** — [WebSearch / Apple](https://apps.apple.com/app/id374511507)
- **cutlistoptimizer / CutList Optimizer app**: **PDF, image, label PDF, and CAD-file export** — [WebSearch changelog/listing](https://apps.apple.com/ae/app/id1629462860)
- **CutListLab / CutListCalc / Rogue Engineer**: output is **PDF / printable diagrams / labels**
  (no machine-file export noted) — [saashub](https://www.saashub.com/cutlistlab); [peerpush](https://peerpush.com/p/cutlistcalc); [Rogue Engineer](https://rogueengineer.com/cut-list-optimizer/)
- **Labels/barcode**: OpenCutList labels (+ promised QR in v7.0), OptiCut barcode field, MaxCut
  sticky labels, Eurosoft ARDIS labels w/ optional 2-D barcodes, FastCUT Labels add-on — [SketchUp 8.0 thread](https://forums.sketchup.com/t/opencutlist-a-crowdfunded-extension-8-0-campaign/301089); [wooddesigner](https://wooddesigner.org/opticut-label-printing/); [FastCUT](https://fastcam.com/fastcut-labels.html)

### Inferences
- A practical free pipeline for cabinetmakers: design in SketchUp → **OpenCutList CSV** (or Fusion 360
  ExportCutlist CSV) → **paste/import into cutlistoptimizer.com** for the optimized diagram. For a
  machine file (DXF) to hand to a CNC/beam-saw, you must step up to a **paid** tier (Optimalon premium,
  OptiCut, MaxCut Business) — the no-cost online tools generally output only PDF/print/label.
- Edge-banding and grain are modeled by cutlistoptimizer, iOpticut, Optimalon (grain via
  non-rotatable), CutListLab, MaxCut, and OpenCutList; the irregular-nesting tools (Deepnest) do not
  model edge banding or grain at all.

### Gaps
- Whether cutlistoptimizer.com's **CAD/DXF export** and **label PDF** are free or paid is unconfirmed
  (in-app-purchase gating not detailed).
- No tool in this search exports a **native beam-saw program format** (e.g., Homag/SCM/Holzma part/
  pattern files) in a free tier; only generic DXF/Excel/CNC output was found (Optimalon premium).

---

## Quick comparison matrix (free-focus)

| Tool | Platform | Free status / limit | Edge banding | Grain | Import | Machine export | Notes |
|---|---|---|---|---|---|---|---|
| CutList Optimizer (cutlistoptimizer.com / Cloptimizer) | Web + Android + iOS | Free to use; Pro via IAP (price unconfirmed) | Yes | Yes | CSV + paste (v4.0) | CAD/DXF + PDF/label (gating unclear) | Most popular; syncs projects to account |
| MaxCut Community Edition | Windows desktop | Free, no time limit; Business = paid (~$20/user) | — (adv. may be paid) | Yes | manual | DXF (export exists) | Sticky labels, kerf; offline |
| Optimalon Online | Web | Free limited; Premium ~$7–$10/mo | — | Yes (non-rotatable) | Excel (premium) | DXF + Excel + CNC (premium) | Guillotine, 5 complexity levels; 1DCutX Excel add-in |
| OpenCutList | SketchUp extension | Free, open source | Yes | Yes | from SketchUp model | SVG + CSV (+ QR labels v7) | Components only; dimension-picky |
| CutListLab | Web | Free, no signup, no parts limit | Yes | Yes | manual | PDF/printable | Least-waste, sheet count |
| CutListCalc | Web | Free, no registration | — | — | manual | PDF | Sheet + linear |
| Rogue Engineer Optimizer | Web | Free, no account/limit/watermark | — | Yes (grain lock) | manual (fractions ok) | PDF/print + labels | Table/track-saw focus |
| Boardcut (iOS) | iOS | Free up to 10 pieces | — | — | manual | sheet image share | Offline |
| SmartCut (Cutlist Optimizer V2) | iOS | Free w/ IAP | — | Yes | manual | PDF | sheets/boards/bars |
| iOpticut | iOS | free demo status unconfirmed | Yes (per side) | Yes (per part) | CSV/paste + template | SVG + DXF + PDF | edge-banding list in export |
| OptiCut (Boole & Partners) | Windows desktop | Paid; demo can't export | Yes | Yes | manual/import | DXF/CNC + barcode labels | Professional |
| CutLogic 2D | Windows desktop | Paid; free tier unverified (spam only) | ? | ? | ? | DXF (claimed, unverified) | Verify with vendor |
| Cutting Optimization Pro | Windows desktop | Paid; no verifiable free tier | ? | ? | ? | ? | Only crack-site descriptions found |
| CutList Plus Express | Windows desktop | Paid $39 (mobile apps free only w/ purchase) | ? | ? | manual | print | — |
| 373 Nesting | Web | 14-day trial, then ~A$9/mo | ? | ? | ? | ? | Not free long-term |
| Deepnest / SVGnest | Desktop (open source) | Free, open source | No (n/a) | No (n/a) | DXF/SVG/CDR | DXF/SVG | TRUE nesting — irregular shapes, laser/plasma/router; not for rectangular panel cut-lists |

(Blank/“?” = not confirmed in this session.)

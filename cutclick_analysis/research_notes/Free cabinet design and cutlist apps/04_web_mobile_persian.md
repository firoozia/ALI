# Free Web/Mobile Cut-List Apps & the Iranian/Persian Cabinet Cut-List Landscape

> Research note. Tooling limitation: WebFetch (full-page retrieval) failed on every
> domain during this session with DNS errors (`getaddrinfo ENOTFOUND`), including
> mainstream sites (alternativeto.net, optimalon.com, rogueengineer.com) and all
> Iranian `.ir` / `.com` sites (cafebazaar.ir, padcod.com, drchoob.ir, cutunix.com,
> kabinetplus.ir). All findings below therefore come from WebSearch result
> summaries/snippets, not from reading the pages in full. Where a fact rests only on
> a search snippet, treat it as indicative and verify against the live page. This
> especially constrains the Iranian section, where primary pages could not be opened.

## Q1 — Free Android/iOS apps for cut-list / panel optimization / cabinet calculation

### Takeaway
There is no clearly-free *native Android* panel optimizer surfaced in search; the
dominant free cross-platform option is a browser/PWA (CutList Lab, and the
cutlistoptimizer web app which also has an Android package). The App Store has many
cut-list optimizers (several free-to-download with in-app purchases), most of which
appear iOS-only. The Iranian market is mostly Android (Cafe Bazaar), covered in Q3.

### Cited Findings
- **CutList Optimizer** (`com.cutlistoptimizer`) is listed on AppBrain as a free-to-download Android app for "panel cutting optimization," requiring Android 5.0+, and it is also available as an online web app at www.cutlistoptimizer.com — [AppBrain](https://www.appbrain.com/app/cutlist-optimizer/com.cutlistoptimizer); a third-party audit page lists it under primary monetization "free" but with "low confidence / zero reviews analyzed," so not reliable — [marlvel.ai](https://marlvel.ai/api/llm/apps/productivity/com-devotellix-decoupe)
- **CutList Lab (cutlistlab)** — described as a *free* cut list optimizer for plywood, MDF, particleboard and melamine; runs in the browser with no signup; a Progressive Web App that is installable on Android and iPhone from the browser and works offline; exports include PDF, SVG, CSV and DXF; license listed as proprietary — [AlternativeTo (cutlistlab)](https://alternativeto.net/software/cutlistlab/about/)
- App Store cut-list/optimizer listings that surfaced (mostly appear iOS-only; free-to-download status not individually confirmed): **CutList Optimizer** (id6465744401), **Cutlist Optimizer: Cut Master** (id6744231987), **CutList Optimizer V2: SmartCut** (id1579298749), **Cutlist Optimizer Calculator** (id6743643399), **Offcuts** (id1480164923), **CutList Optimizer - Linear** (id6618137579), **CutList: Panel Cutting Planner**, **Cutlist: Cabinet Planner** — [Apple App Store search results](https://apps.apple.com/app/id6465744401); [mwm.ai CutList Panel Planner](https://mwm.ai/apps/cutlist-panel-cutting-planner/6778372105); [mwm.ai Cutlist Cabinet Planner](https://mwm.ai/apps/cutlist-cabinet-planner/6789299704)
- **Optador** — GitHub organization describing an "intelligent 2D cutting plan optimizer" for carpenters/furniture makers/manufacturers, "12+ algorithms," built with .NET MAUI for native desktop (Windows, macOS); claims 85–99% material efficiency, auto grain matching, saw-blade (kerf) support, multi-sheet optimization, PDF/PNG and QR-code label output, and MDF support. License / pricing / whether a web or mobile build exists was NOT confirmed in search — [GitHub Optador](https://github.com/Optador)

### Inferences
- The practical free mobile answer for most users is a PWA (CutList Lab, or cutlistoptimizer.com added to home screen) rather than a true native app, since the native App Store/Play entries are mostly freemium (free download + IAP/subscription) or unverified.
- Because the user's market (Iran) runs on Cafe Bazaar/Myket rather than Google Play, the globally-indexed Play Store listings are of limited direct relevance to them; the Iranian Android apps in Q3 matter more.

### Gaps
- Could not open Google Play pages directly (search returned App Store and third-party aggregators instead), so free vs paid status and current IAP for individual Android apps is unverified.
- Individual App Store listings' free/paid status and part limits were not opened (WebFetch down).

## Q2 — Free browser-based web apps for cabinet cut-lists & sheet optimization (besides cutlistoptimizer)

### Takeaway
Several genuinely free, no-account, browser-based panel optimizers exist alongside
cutlistoptimizer; the strongest free leads are CutList Lab, RogueEngineer's optimizer,
CutListCalc, Optimalon's online optimizer, and the SketchUp OpenCutList plugin.
Free ready-made Google Sheets/Excel cabinet templates were NOT clearly found; the
common pattern is "build your own sheet, paste rows into an optimizer."

### Cited Findings
- **CutList Lab** — free, browser-based + installable PWA, offline, no signup; exports PDF/SVG/CSV/DXF (see Q1) — [AlternativeTo](https://alternativeto.net/software/cutlistlab/about/)
- **RogueEngineer Free Cut List Optimizer** — described as "really free — no account, no daily calculation limit, no watermark, no subscription"; accepts plain spreadsheet rows pasted from Excel, Google Sheets, or Numbers "in almost any column order"; a guillotine-cut planner — [RogueEngineer](https://rogueengineer.com/cut-list-optimizer/)
- **CutListCalc** — free, browser-based for sheet goods and linear stock, PDF export, "no registration, no paywall, no install" — [PeerPush CutListCalc](https://peerpush.com/p/cutlistcalc)
- **Optimalon Online Cut Optimizer** — a free online panel cut optimizer (optimalon.com/online_cut_optimizer.htm); page could not be opened to confirm current limits — [Optimalon](https://optimalon.com/online_cut_optimizer.htm)
- **OpenCutList (SketchUp plugin)** — free plugin that exports a parts list directly from a SketchUp model; cited as the route to feed an optimizer when the design lives in SketchUp — [RogueEngineer](https://rogueengineer.com/cut-list-optimizer/)
- **373 Nesting (2D Panel Cutting Optimizer)** — web-based nesting/optimization aimed at cabinet makers and MDF/MDO sheets; CNC-optimized DXF export, kerf and cut-margin settings, part rotation; offers a 14-day free trial with no credit card (i.e., trial, not permanently free) — [Capterra 373 Nesting](https://www.capterra.com/p/10046042/373-Nesting-2d-Panel-Cutting-Optimizer/)
- **Excel-based cabinet tools are generally paid**, e.g. CabinetCRUNCHER / DoorCRUNCHER / DrawerCRUNCHER (a set of ~76 Microsoft-Excel-based programs) referenced on Fine Woodworking forums — [Fine Woodworking forum](https://www.finewoodworking.com/forum/cutlist-software-for-custom-cabinets-3)

### Inferences
- For a free web workflow, the realistic stack is: design/parts list (SketchUp + OpenCutList, or a hand-built Google Sheet) → paste into a free optimizer (CutList Lab / RogueEngineer / CutListCalc / cutlistoptimizer) → export PDF/CSV/DXF.
- "Free Google Sheets cabinet cut-list template" as a packaged download does not appear to be a well-established, high-quality offering; most results were low-quality content-farm pages. Users typically roll their own sheet (columns: part name, width, length, qty, thickness).

### Gaps
- Could not confirm current free limits (part counts, sheet counts, export caps) for Optimalon, CutListCalc, or RogueEngineer because pages would not load.
- No verified, reputable free downloadable Excel/Google Sheets cabinet template was found.

## Q3 — Iranian / Persian-language cabinet cut-list, reporting (گزارش‌گیری) & CNC-feeding tools

### Takeaway
The Iranian market is a cluster of domestic Android apps + Windows programs for MDF
cut optimization and cabinet costing, explicitly marketed as "fully Iranian" (کاملاً
ایرانی). Concrete, verifiable names: **Cut Master / کات مستر (مستر کات – "نجاری هوشمند")**,
**Kabinetkar / کابینت‌کار (پنیاک)**, **Kabinet Plus / کابینت‌پلاس**, **Pasargad / پاسارگاد**,
**Cutunix / کاتیونیکس**. Several explicitly export to OptiCut and/or Excel. CRITICALLY:
**"Zinax / زیناکس" could NOT be verified** — no matching product appeared in any English
or Persian search (see dedicated note below). "CutClick / کات‌کلیک / پادکد" (the user's
own reference app) also did NOT surface in search; its site (padcod.com) would not load.

### Cited Findings — "Zinax / زیناکس" (the user-flagged tool)
- Multiple targeted searches in English and Persian ("زیناکس نرم افزار کابینت برش", "zinax software cabinet", "زیناکس zinax چیست نرم افزار", "zinax ... قیمت") returned **no product named Zinax/زیناکس**. Nearest name-collisions were irrelevant: **Zemax/زیمکس** (optical design software) and various ".zax" file formats / a Fallout 2 manager — [search: زیمکس on abadis.ir](https://abadis.ir/fatofa/%D8%B2%DB%8C%D9%85%DA%A9%D8%B3/); [search returned only generic cabinet-software guides](https://ddg.wcroc.umn.edu/best-software-for-cabinet-design)
- **Verdict on Zinax:** Not verifiable from open web search as of Oct 2026. It may be a niche Iranian product indexed only on Cafe Bazaar / Myket / Instagram / Telegram / Aparat (platforms that did not surface or would not load here), a brand spelled differently in Latin letters, or a small/local tool. State plainly to the user that no public source confirms what Zinax is or does — do NOT guess its feature set.

### Cited Findings — Cut Master / کات مستر
- Published on Cafe Bazaar as **"مستر کات – نجاری هوشمند"** (package `ir.woodforyou.woodforyou`), developer "داریوش سافت" (Dariush Soft); current version 4.0.0 (~26 MB), last updated 12 Mehr 1405 (≈ Oct 2026) — [Cafe Bazaar listing](https://cafebazaar.ir/app/ir.woodforyou.woodforyou)
- Marketed for carpenters/cabinet-makers: "smart MDF cut calculation" (محاسبه هوشمند برش MDF), "16 professional carpentry tools," free AI consultation, waste reduction, workshop management; covers base/wall cabinets, standing tall units (سوپر ایستاده), side-by-side fridge covers, wardrobes; provides approximate project price calculation; monetized via in-app purchases (specific price not stated in search) — [Cafe Bazaar listing](https://cafebazaar.ir/app/ir.woodforyou.woodforyou); [drchoob.ir (Cut Master vs OptiCut article, not openable)](https://drchoob.ir/articles-best-cutting-app/)
- Persian tutorials/positioning describe Cut Master as precise MDF cut software designed "to produce the cut map in the fastest time with the least sheet waste," and note a Persian version is available in the market — [samanchoob.com Cut Master tutorial](https://samanchoob.com/cut-master-software/); [carpenter.mihanblog.com Cut Master training](http://carpenter.mihanblog.com/post/150)

### Cited Findings — Kabinetkar / کابینت‌کار (and "پنیاک")
- Cafe Bazaar app "کابینت کار" (`Kabinetkar.Amp`): an Android app to calculate price and produce ready-to-cut dimensions for MDF cabinet parts (units, doors); user enters unit dimensions and gets part dimensions near-instantly; a separate paid Windows version exists; Pro v3.0 priced ~180,000 toman; last update ~Bahman 1403 (early 2025); the listing warns about fake/copycat apps using the same name — [Cafe Bazaar Kabinetkar](https://cafebazaar.ir/app/Kabinetkar.Amp); official site [ampkabinetkar.ir](https://ampkabinetkar.ir/)
- A Persian page frames the product/ecosystem ("پنیاک") as "the most powerful fully-Iranian cut-optimization software," citing Excel export and OptiCut export as features — [search summary via plannerce.ir / vendor pages](https://plannerce.ir/practical-tools/)

### Cited Findings — Kabinet Plus / کابینت‌پلاس
- کابینت‌پلاس (kabinetplus.ir): advertises sending cabinet dimensions online to cutting-service workshops, plus an optimized cut map together with part labels (لیبل قطعات) — [kabinetplus.ir](https://kabinetplus.ir/)

### Cited Findings — Pasargad / پاسارگاد & Cutunix / کاتیونیکس
- پاسارگاد described (promotional Persian page) as "the most complete and advanced Iranian program for calculating and cutting cabinet components," and claims it can produce a cut-pattern output for four major programs including Cut Master — [optimizer.blogfa.com](https://optimizer.blogfa.com/)
- کاتیونیکس (Cutunix) — markets "smart cabinet-making tools" / app for cabinet makers; feature detail not confirmed (page would not open) — [cutunix.com](https://cutunix.com/cabinetmaker-dreams-and-smart-tools/)
- Persian listicles of "cabinet design apps for mobile (free + download links)" exist, indicating a crowded domestic Android app space — [ariavash.ir cabinet design apps](https://ariavash.ir/fa/article/application-cabinet-design/)

### Inferences
- The Iranian landscape is dominated by (a) Android apps distributed via Cafe Bazaar/Myket (Cut Master, Kabinetkar, etc.) and (b) Windows desktop cut-optimizers, often freemium/cheap (tens to ~hundreds of thousands of toman) rather than the hundreds/thousands of dollars of Western CAD/CAM.
- A recurring, important design pattern: Iranian tools treat **OptiCut** (the Western panel-saw optimizer) as the de-facto downstream/interchange target — multiple domestic apps advertise "OptiCut output" and "Excel output," implying OptiCut + Excel/CSV is the common bridge to the cutting floor. This is a strong signal for the user's own CutClick positioning.
- CutClick/پادکد being invisible to global search is consistent with a small Iranian product indexed only on local stores/social channels; this is normal for this market and not evidence it doesn't exist.

### Gaps
- **Zinax/زیناکس**: unverifiable — no public source. Needs the vendor's exact Latin spelling, a Cafe Bazaar/Myket package name, or an Instagram/Telegram handle to pin down.
- **CutClick/پادکد**: not surfaced in search; padcod.com would not load. Could not independently confirm its features/pricing/export.
- Exact current prices, free-tier limits, and import/export format specifics for Cut Master, Kabinetkar, Kabinet Plus, Pasargad, Cutunix could not be read from primary pages (WebFetch down); figures above are from snippets and may be dated.
- No Instagram/Telegram/Aparat/YouTube demo content was retrievable (those platforms didn't surface via US WebSearch and don't fetch here).

## Q4 — What formats do Persian CNC / panel-saw shops use to feed cutting machines?

### Takeaway
No Persian-specific sources were retrievable, but the general (and almost certainly
applicable) workflow is: cabinet/cut-list software → **CSV or XLSX part list** (or a
machine-specific post-processor output) → imported into the saw/nesting machine's own
software with column-by-column mapping; CNC nesting typically additionally wants **DXF**.
Iranian domestic apps advertising "خروجی اکسل" (Excel output) and "OptiCut output" fit
this exact pattern.

### Cited Findings
- **PolyBoard** cabinet software can export its cutting list as **CSV or TXT** (and PDF), with configurable field order/separator so columns can be reordered "to suit the CSV format required by your saw" — [wooddesigner.org PolyBoard cutting list export](https://wooddesigner.org/help-centre/polyboard-cutting-list-export/)
- Real-world panel-saw example: an **IMA Scheling FH4** saw's "HPO" software "can only read .CSV and .XLSX," configured column-by-column; the standard OptiCut export was not directly readable and needed mapping/custom handling — [wooddesigner.org forum: OptiCut CSV/XLSX to IMA Scheling](https://wooddesigner.org/forum/opticut-optinest/opticut-csv-xlsx-to-ima-scheling-hpo/)
- For **CNC nesting** (e.g., SCM Xilog Maestro), workflows use a post-processor export + a helper that generates a CSV ready to import, with correct piece naming — [wooddesigner.org forum: Xilog Maestro piece naming](https://wooddesigner.org/forum/cnc-vcarve-and-aspire/solution-for-xilog-maestro-nesting-piece-naming/)
- **Promob** nesting generates a CSV listing the parts to nest (with options like excluding parts below a set area) — [suporte.promob.com](https://suporte.promob.com/hc/articles/31116399684497); **ProNest** exports reports to Excel/CSV and uses a configurable post-processor for NC output — [Tekla/ProNest docs](https://support.tekla.com/doc/tekla-powerfab/2025i/inv_import_cutlist_from_pronest)
- Iranian apps explicitly list **"خروجی اکسل" (Excel output)** and **"خروجی اپتی‌کات" (OptiCut output)**, plus optimized cut maps with part labels — consistent with the CSV/XLSX-into-machine pattern — [plannerce.ir](https://plannerce.ir/practical-tools/); [kabinetplus.ir](https://kabinetplus.ir/)

### Inferences
- The lingua franca for feeding Iranian panel saws is very likely **Excel/CSV part lists** (part name, L×W, qty, thickness, edgebanding, grain), imported and column-mapped in the saw's software — with **OptiCut** frequently sitting in the middle as the optimizer, and **DXF** used when the machine is a CNC nesting router rather than a beam/panel saw.
- For a product like CutClick aiming at this market, the highest-value exports are: a clean Excel/CSV part list, an OptiCut-compatible import, a printable cut map with labels, and optionally DXF for CNC nesting.

### Gaps
- No Iran-specific documentation on exact controller formats (e.g., which post-processor for which locally-common saw/CNC brands) was found; all format evidence is from international vendors/forums applied by analogy.

## Context — non-free Iranian / Western CAD/CAM cabinet tools (brief)
- Western heavyweight CAD/CAM (Cabinet Vision, 2020 Design, Mozaik, Cabinet Pro, CabMaster, PolyBoard/OptiCut) are the paid, full-stack tools that generate cut lists + CNC G-code/DXF directly from 3D models; priced from hundreds to thousands of USD — [ddg.wcroc.umn.edu guide](https://ddg.wcroc.umn.edu/best-software-for-cabinet-design); [Capterra Cabinet Pricing/Ordering](https://www.capterra.com/p/190239/Cabinet-Pricing-Ordering-Software/); [Cabinet Pro panel optimization](https://www.woodshopnews.com/news/cabinet-pro-improves-panel-optimization-feature). These are context only; most Iranian shops instead chain a cheap domestic app + OptiCut + Excel/CSV to the machine.
- **MaxCut** (free Community Edition + paid Business Edition, Windows desktop, offline; nesting, grain direction, factory cutting lists, DXF export for CNC) is a notable near-free Western option relevant for comparison — [search summary; maxcutsoftware.com](https://maxcutsoftware.com/features/cutting-optimization/)

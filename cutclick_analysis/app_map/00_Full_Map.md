# CutClick 4.0.1 — Complete App Map & Rebuild Guide

A full functional reverse-engineering of the CutClick Android app (`com.padcod.cutclick`,
Padcod / pad-design.ir), written as a reference for building a **better equivalent** inside
your own product (FIROO CAM). Nothing from CutClick is copied; this documents *what it does*
and *where it falls short*, so you can decide what to add.

This file is the overview. Three detailed companion files go with it:
- `map_screens.md` — every screen, field, and the navigation tree.
- `map_data_api.md` — local DB schema, domain model, and the 45 REST endpoints.
- `map_logic.md` — the cabinet→parts formula engine, materials, pricing, output files.

---

## خلاصه فارسی (Executive summary)

CutClick یک اپ موبایل برای **سفارش برش** است، نه یک نرم‌افزار CAM. کارش این است:

1. کاربر (کابینت‌ساز) یک پروژه می‌سازد و **یونیت کابینت/کمد** تعریف می‌کند (عرض، عمق، ارتفاع، تعداد درب و کشو و طبقه…).
2. اپ هر یونیت را به **لیست قطعه‌ها** (ورق و اندازه) تبدیل می‌کند، با نوار (PVC)، شیار، گازور و پیش‌فرز.
3. پروژه را به یک **مجتمع خدماتی** (کارگاه برش) می‌فرستد. سرور پادکد **بهینه‌سازی برش (nesting)** و **قیمت** را حساب می‌کند و نقشه‌ی برش را برمی‌گرداند.
4. کاربر سفارش را **پیگیری** می‌کند، فاکتور و حساب و کتاب ساده دارد، و اشتراک می‌خرد.

**نکته‌ی کلیدی برای تو:** مغز محاسباتی CutClick سمت سرور است (nesting و قیمت). فقط **تبدیل یونیت به قطعه** سمت کلاینت است و آن هم با **فرمول‌های رشته‌ای** که از سرور می‌آیند. در مقابل، نرم‌افزار تو (FIROO CAM) دقیقاً همان مغز محاسباتی را **خودش و به‌صورت آفلاین** دارد: nesting، G-code، DXF، toolpath، طراحی درب. یعنی تو چیزی را داری که CutClick ندارد؛ چیزی که CutClick دارد و تو نداری، **لایه‌ی سفارش و موبایل و کابینت‌پارامتریک** است. جدول مقایسه و نقشه‌ی ساخت در بخش ۶ و ۷ آمده.

---

## 1. What CutClick is (and is not)

| | |
|---|---|
| **Is** | A customer-facing *ordering* app: model a cabinet → get a cut-list → send to a cutting workshop → track the order → pay. |
| **Is not** | A CAM/CNC tool. It generates **no DXF, no G-code, no toolpaths** anywhere (confirmed: zero matches). The nesting and pricing are done on Padcod's server; the app only draws the server's layout as a PDF. |
| **Users** | Cabinet makers (order side) and "service centers" / workshops (fulfilment side). |
| **Platform** | Android only, phone, forced portrait, Persian (RTL). |
| **Backend** | `kargah.pad-design.ir/api/v2` (main+cloud), `pad-design.ir` (`optimize`), `admin.pad-design.ir` (file/report generation). |

## 2. Architecture at a glance

```
            CutClick (Android, thin client)
   ┌─────────────────────────────────────────────┐
   │ UI: 14 activities, ~11 fragments, ~40 dialogs │
   │ Local SQLite "Project.db" (projects/plates/   │
   │   parts/cabinet units)                        │
   │ Client-side: Unit→Parts formula interpreter   │
   └───────────────┬───────────────────────────────┘
                   │ REST (static api_key header, user_id param)
   ┌───────────────▼───────────────────────────────┐
   │ Padcod server:                                 │
   │  • optimize   → nesting layout (rectangles)    │
   │  • ComputeProjectPrice → total price           │
   │  • file generation (cutting-map/invoice PDFs)  │
   │  • cloud project storage & sharing             │
   └────────────────────────────────────────────────┘
```

## 3. Screens (detail in `map_screens.md`)

- **14 activities, ~11 fragments, ~40 dialogs.**
- **Auth:** Splash (silent re-login via `getUser`) → Intro → Login (phone + OTP) → SignUp (profile + service-center code).
- **Main shell:** bottom nav with only **3 tabs** — (1) Order tracking, (2) New order/Home *(default)*, (3) Service center. Everything else (Plan, History, Support, Accounting, Wallet, Profile, Theme) hangs off a side settings sheet.
- **Plate (cut-list) flow:** ProjectPlate (thickness/sheets/units) → ProjectPlatePart (per-piece dims + edge-band/miter/groove + rotate/gazor/CNC) → optional Cabinet units → CompleteProject (choose workshop, optimize, price, submit).
- **Cabinet/closet flow:** ProjectCabinet (unit list) → ProjectCabinetPart (parametric: carcass dims, door/drawer/shelf counts, door type, assembly type).
- **Ordering:** service-center profile (info/machinery/price/contact), nearby-centers list (GPS), order tracking with status buckets (Myself → Calculating → In production → Ready for delivery).
- **Accounting:** hub + per-project ledger (expenses/receipts/invoices/PDF) — **note: the accounting list is hard-coded demo data, an unfinished stub.**
- **Plan/Wallet/Support:** subscription packages, wallet top-up (external payment), support tickets.

## 4. Data & API (detail in `map_data_api.md`)

- **Local DB:** `Project.db` v16, 8 tables (`projects`, `project_plates`, `project_plate_piece`, `project_plate_parts`, `project_detail`, `cabinet`, `cabinet_setting`, `cabinet_asset`). `onUpgrade` **drops everything** — any schema bump wipes local projects.
- **Core chain:** `User → Project → Plate (ورق/sheet of a material) → Part (قطعه)` with 4-sided edge-band + groove flags; plus parametric `Cabinet`/`Closet` units that *generate* parts. Per-plate roll-up aggregates (SUM of part edge/groove values).
- **API:** 45 endpoints. Catalog (`getDBInfo`) delivers plate/cabinet/unit templates. `optimize` + `ComputeProjectPrice` are server-side. Cloud endpoints store/share projects. File endpoints return a link to a server-rendered PDF.
- **Auth model (weak — learn from it, don't copy):** identity is a numeric `user_id` + `user_token` in plain SharedPreferences, and every request carries **one static embedded `api_key`** shared by all installs. Per-user scoping is just the `user_id` parameter. Rebuild with a real per-user bearer token and server-side ownership checks.

## 5. Calculation logic (detail in `map_logic.md`)

- **Unit → Parts is a formula interpreter.** Cabinet templates (`Cabinet`, `UnitParam`, `CabinetPart`) store Length/Width/Quantity as **formula strings** (`l`, `w`, `q`) downloaded from the server. The app substitutes tokens (dimensions `x/y/z…`, thickness `d`, edge-band `n`, door gap `t`, groove depth `v2`, depth-deduction `v1`) and evaluates with a hand-written math parser. So the "cabinet design knowledge" is **data from the server**, not code — a bad template silently yields wrong sizes, and divide-by-zero silently returns 0.
- **Units:** millimetres internally; UI enters `cm + mm` combined as `cm*10 + mm`. Persian/Arabic digits normalized to Latin. Number-to-words for invoices.
- **Materials/part flags:** plate `type=="1"` = plain/rotatable, else grooved/grain-fixed; PVC edge band on 4 edges; groove (شیار); pre-milling (پیش‌فرز); foamed; thickness options. Changing thickness **destroys** the part's service data.
- **Pricing & nesting:** server-side. `ComputeProjectPrice` returns one number; `optimize` returns the layout rectangles the client draws into the PDF. Accounting screens only display server values.
- **Output:** PDF only (cutting map drawn locally from the server layout; invoices/forms rendered server-side). **No DXF/G-code/toolpaths.**

---

## 6. CutClick vs. your FIROO CAM — the gap

Your repo (`firoozia/ALI`, "FIROO CAM") is the **manufacturing engine**: `nesting_engine.py`,
`gcode_generator.py`, `post_processor_manager.py` (+ `post_processor_bank.json`),
`door_design_engine.py` / `door_geometry_engine.py`, `tool_library.py`, `dxf_export_dialog.py`,
`report_generator.py`, a PySide6 desktop UI, and `locales/{fa,ar,en}.json`. CutClick is the
**customer/order front-end**. They are complementary — together they'd be the whole chain.

| Capability | CutClick | FIROO CAM (yours) | Takeaway |
|---|---|---|---|
| Nesting / cut optimization | server-only | **local engine** | You already own CutClick's biggest dependency. |
| G-code / post-processors | none | **yes** (bank of posts) | A real advantage over CutClick. |
| DXF export | none | **yes** | Advantage. |
| Toolpaths / door CNC | none | **yes** (door engines) | Advantage; CutClick only names CNC doors. |
| Parametric cabinet unit → parts | **yes** (formula engine) | — | **Biggest thing to add to yours.** |
| Edge-band / groove / pre-mill per part | **yes** (4-sided) | partial | Add per-edge service model. |
| Mobile app for customers | **yes** (Android) | desktop only | Add a thin mobile/ordering client. |
| Order lifecycle & tracking | **yes** | — | Add if you want the workshop↔customer loop. |
| Cloud project storage/sharing | **yes** | — | Optional. |
| Material/plate catalog | server `getDBInfo` | `sheet_library.json`, `config.json` | You have the start of it. |
| Pricing & accounting | server + stub | — | Optional, and CutClick's is unfinished. |
| i18n done right | text-as-state (bad) | `locales/*.json` (good) | Keep your approach. |

## 7. What to add to your product (prioritized)

The point of this map is the shortcomings list. In priority order, with where it fits your repo:

1. **Parametric cabinet/closet unit → part generator** (the one real thing CutClick has that you don't). Build it as a clean module, e.g. `cabinet/` with a `UnitTemplate` (named dimensions + a safe formula evaluator) that outputs parts straight into your existing `data_models.Part`/nesting pipeline. Avoid CutClick's traps: **validate formulas**, surface divide-by-zero as an error, and keep templates versioned (not a destructive DB wipe). This turns your CAM tool into a cabinet-design tool.
2. **Per-part edge-band / groove / pre-mill / grain model.** Extend your `Part` model with 4-edge banding, groove, pre-mill, and grain-direction flags, and feed grain into `nesting_engine` (`respect_grain` already exists in `config.json`). This is what connects "cabinet design" to "cut-ready part".
3. **Material / plate catalog.** Promote `sheet_library.json` into a proper catalog (sizes, thickness, grain, price) that both the cabinet generator and nesting read — CutClick gets this from `getDBInfo`.
4. **A thin ordering/mobile client (optional, if you want CutClick's customer loop).** Keep your heavy engines on a local/LAN **FastAPI** service; the mobile app only collects the order (units/parts) and shows results. This is the architecture I proposed earlier. Learn from CutClick's auth mistakes: real per-user tokens, server-side ownership checks, OTP rate-limiting, certificate validation.
5. **Order lifecycle + cutting-map view (optional).** If customers submit to your shop, mirror CutClick's status buckets (Submitted → Nesting → In production → Ready). You already render layouts; you can serve the cutting map yourself instead of depending on a server like Padcod does.

**Things NOT worth copying:** text-used-as-state, the static shared API key, `user_id`-as-identity, the destructive DB upgrade, the 14k-line screens, the demo/stub accounting, forced portrait.

---

## 8. How we work from here

- This whole map is committed to your repo under `cutclick_analysis/` on branch `ccr-760e5e5b-di257i`, so you can read it in the desktop app and comment.
- Tell me which items from §7 you want first. My suggestion: start with **(1) the cabinet unit → part generator**, because it plugs directly into the nesting/G-code engine you already have and is the single biggest capability gap.
- I'll build it as tested Python modules in this repo (no dependency on CutClick or its server), and we iterate from there.

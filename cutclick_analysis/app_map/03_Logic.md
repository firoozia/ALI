# CutClick (com.padcod.cutclick v4.0.1) — Calculation & Business Logic Map

Decompiled Android app for Iranian cabinet / closet (کابینت / یونیت) cut-list preparation.
This document describes **what is computed and the rules**, for rebuilding an equivalent.

Backends used (3 Retrofit clients):
- `https://pad-design.ir/` → `V3.c` : **`GET optimize?projectId&userId&app`** — server-side nesting/optimization.
- `https://kargah.pad-design.ir/api/v2/` → `T3.e` and `U3.b` : main app + cloud API. Includes
  **`POST ComputeProjectPrice`** (body = project), **`POST calculatePlanPrice`**, `getDBInfo`,
  `getFactors`, `getPayments`, `getCompaniesDetails`, `getProjectDataJson`, cloud storage, etc.
- `https://admin.pad-design.ir/` → `W3.b` : **file generation** — `projectPlatesPartsGenerateFiles`,
  `projectFactorCardexGenerateFiles`, `exportFiles`, `exportAccountCart` (each returns a link/token).

Headline architecture finding: **the domain geometry (turning a cabinet unit into sized cut
parts) is 100% client-side** and driven by server-supplied *formula strings*. **Nesting
optimization and project pricing are server-side.** Cutting-map PDFs are *rendered* locally from
layout data but the *packing* is done on the server.

---

## 1. Unit → Parts generation (with formulas)

### 1.1 Data model (templates live in a local SQLite DB, downloaded via `getDBInfo`)

A cabinet "unit" template is three cooperating tables:

- **`Cabinet`** (`Model/Cabinet/Cabinet.java`) — one row per unit type. Has an *integer* field for
  every geometry variable: `x, x1, x2, x3, y, y1, y2, y5, y6, z, z1..z5, w1, w2, w3, a1, b, f, f1,
  f2, f3, h, j, k` plus `cat_id, sub_cat_id, door_type, assemble_type, cover_body, code, title,
  img_1..4, img_assemble`. These integers are *defaults / which inputs are enabled*.
- **`UnitParam`** (`Model/Cabinet/UnitParam.java`) — one row per unit. Has a *String* field for the
  **same** variable names (`x, x1, ... z5`). These Strings are **formula expressions** that define
  each derived variable in terms of the user's entered dimensions. (A unit may redefine, e.g., `x2`
  as `"x-2*d"`.)
- **`CabinetPart`** (`Model/Cabinet/CabinetPart.java`) — one row per physical part of the unit.
  Key fields:
  - `l`, `w`, `q` — **String formulas** for the part's Length, Width, and Quantity.
  - `plate_type` — which sheet/material slot this part uses (body, door1/2/3, f3, f16, mill3…).
  - `have_grain` — part needs grain-direction material (راه‌دار).
  - `have_gazor` (گازور), `have_cnc`, `shiar_efect` (شیار / groove effect), `cover_body`,
    `door_type`, `part_info`, `ref`, `code`, `title`.
- **`CabinetAsset`** (`Model/Cabinet/CabinetAsset.java`) — hardware/BOM (یراق): `title, symbol,
  unit, count` where `count` is also a formula string. Stored into DB table `cabinet_asset`.

Per-project constants come from two places:
- **`CabinetSetting`** (`Model/Cabinet/CabinetSetting.java`, per project): `between_door_thickness`
  (درز بین درب = gap between doors), `groove_depth` (عمق شیار), `door_pvc_thickness` (ضخامت نوار درب),
  and the plate-id assignments `body_plate_id, door1/2/3_plate_id, f3_plate_id, f16_plate_id,
  mill3_plate_id`.
- **`TotalSettingModel`** (`Model/App/TotalSettingModel.java`, global defaults):
  `drawer_fraction_formula` (کسر کشو / depth-deduction formula), `unit_plate_thickness`,
  `unit_door_pvc_thickness`, `unit_door_between_space`, `unit_groove_depth`, `unit_rail_thickness`,
  `min_plate_part_size`, `min_plate_part_size_pvc`, `pvc_waste_size`.

### 1.2 The formula engine (client-side)

Every part dimension is produced by **token substitution then arithmetic evaluation**. This is the
core of the whole app.

**Evaluator** = `S3.d.b(String)` → a hand-written recursive-descent parser (`S3.c`). Grammar:
```
expr   = term (('+'|'-') term)*
term   = factor (('*'|'×'|'/'|'÷') factor)*
factor = ['+'|'-'] ( '(' expr ')' | number | func factor ) ['^' factor]
func   = sqrt | sin | cos | tan      // trig in DEGREES
```
Notable: **division by zero returns 0** (defensive, silent); supports `^` power and sqrt/sin/cos/tan.

**Input units**: the user enters each dimension as two fields — **cm and mm**. They are combined by
`ProjectCabinetPartActivity.w(cm, mm)`:
```
value_mm = cm * 10 + mm          // everything internal is in millimetres
```
(For display the reverse is used: `value_cm = value_mm / 10.0`, split on "." → [cm, mm].)

**Token set** substituted into each part formula (`l`, `w`, `q`) before evaluation:

| token | meaning (source) |
|-------|------------------|
| `x, x1, x2, x3` | user width dims (x3 clamped `max(x3,0)`) |
| `y, y1, y2, y5, y6` | user height dims (y1 clamped `max(y1,0)`) |
| `z, z1..z5` | user depth dims |
| `w1, w2, w3, a1` | `CabinetExtraParam` values, each clamped `max(.,0)` |
| `f, f1, f2, f3` | free/aux inputs (from EditText fields) |
| `h, j, k, b` | aux inputs |
| `d` | `TotalSettingModel.unit_plate_thickness` (carcass board thickness) |
| `n` | `CabinetSetting.door_pvc_thickness` (door edge-band thickness, نوار درب) |
| `t` | `CabinetSetting.between_door_thickness` (gap between doors, درز بین درب) |
| `v2` | `CabinetSetting.groove_depth` (عمق شیار) — substituted *into* the drawer-fraction formula |
| `v1` | the evaluated drawer-fraction / depth-deduction amount (کسر از عمق) |

**Pseudocode for generating one part** (reconstructed from `ProjectCabinetPartActivity`, ~line 980-1010):
```
# inputs: part (CabinetPart), user dims (cm+mm pairs), setting (CabinetSetting),
#         global (TotalSettingModel), extra (CabinetExtraParam), grooveSelected flag

# 1. depth-deduction (drawer/shelf groove) — v1
if (grooveSelected and part.shiar_efect == 1) or part.shiar_efect == 4:
    v1 = eval( global.drawer_fraction_formula.replace("v2", setting.groove_depth) )
else:
    v1 = 0

# 2. substitute tokens in each formula string
def build(formula):
    s = formula
    for each dim token X in {z1..z5, z, y..y6, x..x3, ...}:
        s = s.replace(X, w(cm_X, mm_X))          # cm*10+mm
    s = s.replace("x3", max(extra.x3,0)).replace("y1", max(extra.y1,0))
    s = s.replace("w1", max(extra.w1,0)).replace("w2", max(extra.w2,0))
         .replace("w3", max(extra.w3,0)).replace("a1", max(extra.a1,0))
    s = s.replace("f",..).replace("f1",..).replace("f2",..).replace("f3",..)
         .replace("h",..).replace("j",..).replace("k",..).replace("b",..)
    s = s.replace("d", global.unit_plate_thickness)
         .replace("v1", v1)
         .replace("n", setting.door_pvc_thickness)
         .replace("t", setting.between_door_thickness)
    return s

L_mm = round( S3.d.b( build(part.l) ) )
W_mm = round( S3.d.b( build(part.w) ) )
Q    = round( S3.d.b( build(part.q) ) )
```
So the actual carcass/side/shelf/door arithmetic (e.g. side = `y`, top/bottom = `x - 2*d`, back =
`x-2*d` × `y-2*d`, shelf = `z - v1` for depth deduction, door width = `x/n_doors - t`) **is not
hard-coded in the app** — it is carried in the server-provided `l`/`w`/`q` strings per part. The app
is a generic formula interpreter; the "cabinet design knowledge" lives in the DB rows.

**Rail/stretcher/shelf counts** and door/drawer counts are driven by spinner selections
(`getSelectedItemPosition()` for door count, drawer count, shelf count, back-panel yes/no, leg,
etc.) which select *which* `CabinetPart` rows are included and feed the `f*`/count tokens; parts are
emitted with `body` plate as default (`b0(... "بدنه")`).

### 1.3 Closet (کمد) side

`Model/Closet/*` mirrors the same idea for wardrobes: `ClosetProject`, `ClosetDoor`, `ClosetMdf`,
`ClosetMill3` (CNC-milled MDF doors), `ClosetDefaultParam`, `ClosetAssetRange`, `ClosetCat`. These
feed the same plate-part pipeline (`ProjectPlateModel` has a `closet_type` field). Closet doors
(ClosetDoor/ClosetMdf/ClosetMill3) are separate material classes (MDF door, 3-mill CNC door).

---

## 2. Part attributes & materials

A generated/edited cut part is **`ProjectPlateModel`** (`Model/App/ProjectPlateModel.java`), stored
per project. Relevant flags:

- **Dimensions / qty**: `l`, `w` (mm), `q`, `q_pi`, `piece`, `default_plate_count`.
- **Material**: `plate_id` (→ `PlateModel`), `plate_type`, `plate_title`, `plate_color`, `thickness`.
- **Grain direction (ساده vs راه‌دار)**: on the **`PlateModel`** (`Model/WebService/PlateModel.java`),
  `type == "1"` ⇒ **ساده / plain** (no grain, part may rotate freely in nesting); any other value ⇒
  **راه‌دار / grooved = directional grain** (orientation fixed). Rendered in the PDF header as
  `"ساده"` / `"راه‌دار"`. `PlateModel` also carries `max_l, max_w, min_l_w, size` (e.g. `366*183`),
  `thickness`, `cat_id`, `type`.
- **Edge banding / نوار (prefix "P")**: `p`, `pp`, `ppp`, `p_l`, `p_w` encode which of the part's
  4 edges get PVC tape and with which tape. Material/type/colour chosen via
  `plate_pvc_material` and `plate_pvc_type`. UI strings: "انواع نوار P / Edge band types P",
  "جنس نوار / Edge band material", "نوع و رنگ نوار / Edge band type and colour". Door edge-band
  thickness is the `n` token (`door_pvc_thickness`).
- **Groove / شیار (prefix "SH")**: `sh`, `sha`, `shb` encode groove(s) on the part (UI:
  "انواع شیار SH / Groove types SH", "عمق شیار / Groove depth" = `groove_depth`). On the cabinet side
  the groove effect is `CabinetPart.shiar_efect` (values 1 and 4 trigger the drawer/shelf depth
  deduction `v1` via `drawer_fraction_formula`).
- **Pre-milling (پیش فرز / پ‑فرز)**: `is_pf` (0/1). UI forces a selection ("لطفا پیش فرز را انتخاب کنید").
- **Foamed (فومیزه)** and **thickness options**: `thickness` field; materials come in `16 mm foamed`,
  `3 mm foamed`, `3 mm`, `16 mm`, etc. (string table). Also `f`, `fb`, `fd` part flags
  (foam/finish-related) and `is_edit`.
- `pp`, `ppp`, `p`, `sh`/`sha`/`shb`, `f`/`fb`/`fd` are all small-integer codes, decoded against the
  company's offered services; the human-readable list of offered services + their prices comes from
  `CompanyDetail.prices` (`List<CompanyPrices>` = {title, price}).

**Flagged limitation/warning**: changing sheet thickness wipes the part service data
("در صورت تغییر ضخامت ورق اطلاعات خدمات قطعات حذف خواهد شد" = "If the sheet thickness is changed, the
parts service data will be removed"). A rebuild should warn/migrate instead of silently dropping
edge-band/groove selections.

---

## 3. Pricing & accounting

**All real money math is server-side.** The client prepares inputs and renders results.

- **Project price**: `POST ComputeProjectPrice(ProjectSendData)` → `ComputeProjectResponse` whose
  `data` (`ComputeProject`) is just `{ total_price }`. The app sends the whole project (parts with
  dims, materials, edge-band, groove, pre-mill, counts) and the server returns one number. The area
  (m²), edge-band length, per-service and per-company prices are all combined server-side; the app
  does not compute them. Per-company unit prices are visible via `CompanyDetail.prices`
  (`CompanyPrices{title, price}`) and `machineryList`, but they are display-only.
- **Nesting/optimization**: `GET optimize(projectId,userId,app)` (host `pad-design.ir`). Triggered
  on "cuttingMap"/complete-project via an "Optimize" `HandlerThread`. Returns the sheet count and
  layout; `SubmittedProjectModel.optimize_done` / `CloudProjectDetail.optimize_done` flag status.
- **App subscription plans** (separate from cut pricing): `calculatePlanPrice(user_id, plan_day)`
  → `CalculatePlan{ total_price, discount_price, payment_url }`. `PlanModel` holds `credit,
  credit_show, day_expire, expire_date, introduce_credit, payment_credit, plan_list`; `PlanList`
  = `{id, price, score, title}`. Payment opens `https://pad-design.ir/multiPay?user_id&price&app`.
- **Accounting** (`AccountingActivity`, `AccountingProjectActivity`): these screens **display**
  server-computed values and do not compute profit/loss locally. Data sources:
  - **Factors / invoices** (`getFactors`) → `Factor{ company_title, created_at, items[],
    project_title, title, total_price }`, `FactorItem{ qty, unit_price, total_price, title }`,
    `FactorResponse.userBalance` (account balance, مانده حساب).
  - **Payments** (`getPayments`) → `PaymentModel{ cheque_number, company_title, created_at,
    factor_title, info, price, type }`.
  - UI shows `txt_total_account_balance` (مانده) and `total_profit_and_loss` (سود و زیان) — both
    rendered from server/aggregated values. The models `AccountingProjectModel` /
    `ProjectAccountingModel` are thin list rows ({title, price, image}).
  - `exportAccountCart` / `projectFactorCardexGenerateFiles` build the kardex/invoice files on
    `admin.pad-design.ir`.

A rebuild that wants client-side pricing must re-implement: area = L×W per part, edge-band running
length = sum of banded edges, service costs per flag × company price, plus sheet-count × sheet price
from the nesting result.

---

## 4. Units & number handling

- **Length unit = millimetre internally.** Input and display use **cm + mm**: `value_mm =
  cm*10 + mm`; display `cm.mm = value_mm / 10.0`. (`ProjectCabinetPartActivity.w` /
  `ProjectPlatePartActivity` lines ~1894-1897.)
- **Persian/Arabic → Latin digits**: `Utils/A.s(String)` maps ۰–۹ *and* Arabic-Indic ٠–٩ to 0–9 and
  strips ZWNJ (`‌`). Applied to user text before parsing. (`A.java` line 154.)
- **Number → Persian words (اعداد به حروف)**: table-driven algorithm in `t1/C0906b.java`
  (`case 25`): ones (یک…نه), teens (ده…نوزده), tens (بیست…نود), hundreds (یکصد…نهصد), and scale words
  (هزار/thousand, میلیون/million, میلیارد/billion … up to دسیلیون), groups of 3 digits joined with
  `" و "`. Used for writing invoice amounts in words.
- **Currency**: amounts shown with thousands separators (commas stripped before sending, see
  multiPay URL). تومان/ریال strings exist in the resource table; the stored/sent values are plain
  integers — the app does not do Toman↔Rial conversion in code (server returns the display unit).

---

## 5. Output files (local vs server)

**Generated locally on the device (`android.graphics.pdf.PdfDocument`):**
- **Part-list / cut-list PDFs** and the **cutting-map PDF** are drawn locally in
  `ProjectPlateActivity` (~line 1026), `ProjectPlatePartActivity` (~line 14713),
  `CompleteProjectActivity` (~line 717). Saved to
  **`Downloads/CutClick/<project>/CuttingMaps/<title>.pdf`** (`Utils/A.c`, `A.g`).
- The cutting-map PDF is rendered from **layout rectangles**: `M3.c` = one sheet
  (`f2326a = "L*W"` string, `f2327b` = part rectangles, `f2328c` = label list); `M3.a` = one part
  rectangle `(h, x, y, w)` floats. Each rect is drawn with `canvas.drawRect`; the sheet outline is
  normalized so the longer side is the height. Header shows project→part title, plain/grooved,
  thickness.

**Important**: the **packing/nesting that produces those rectangle coordinates is NOT computed on
the device** — it comes from the server `optimize` endpoint (run under the "Optimize"
HandlerThread) and is stored/returned, then the client only *draws* it. So the cutting map is a
*client-rendered view of a server-computed layout*.

**Downloaded from the server** (`admin.pad-design.ir`, each returns a token/link then fetched):
- `projectPlatesPartsGenerateFiles` / `...UserGenerateFiles` — official part/plate forms.
- `projectFactorCardexGenerateFiles` — invoice/kardex.
- `exportFiles`, `exportAccountCart`. Viewed via `PdfViewActivity` (`com.pdfview.PDFView`); responses
  carry `is_pdf / is_image / is_web` flags.

**No DXF, no G-code, no .nc, no SVG, no toolpath generation anywhere in the app** (grep for
`dxf|gcode|g-code|\.nc|postprocessor|toolpath` = 0 hits). The only machine-facing artifacts are PDFs
(cutting map + part forms). CNC doors (`ClosetMill3`) are described as parts/params only; any CNC
program is produced server-side or by the service centre, not by this app.

---

## Bugs / limitations to flag for the rebuild
1. **Silent divide-by-zero → 0** in the formula evaluator (`S3.c.e`): a malformed formula or a zero
   input yields a 0-sized part with no error. Should surface a validation error.
2. **Thickness change deletes service data** (section 2) — destructive, no confirmation/migration.
3. **Formula correctness is entirely in the server DB** — the client cannot validate that `l/w/q`
   produce sane geometry; a bad template row silently produces wrong cut sizes.
4. **Pricing & nesting opacity**: with no server, the app shows nothing (price = server, layout =
   server). A rebuild should keep a local fallback optimizer + price model.
5. **Trig in degrees** and `^` are supported by the evaluator but there is no operator precedence for
   unary/`^` edge cases beyond the hand-rolled parser — audit before reusing the grammar.

# CutClick (com.padcod.cutclick) v4.0.1 — Screen-by-Screen UI Map

A reverse-engineered map of every screen in the CutClick Android app, intended as a
functional reference for rebuilding an equivalent product. CutClick is an Iranian app
for cabinet/closet makers: it does cut-list (panel) optimization, cabinet/unit modeling,
project storage with cloud sharing, ordering cutting services from "service centers",
light accounting, and subscription/wallet billing.

Sources used:
- jadx Java (R8-obfuscated): `apk_src/sources` — app code in `com/padcod/cutclick/*`; fragments/dialogs in short packages `O3`, `H3`, `P3`, `B0`, `G`, `S1`, `J1`, etc.
- apktool layouts/manifest: `apk_dec/res/layout/*.xml`, `apk_dec/AndroidManifest.xml`
- Persian→English table: `out/translation_fa_en.csv`

Backend (all HTTPS in code):
- Main API `https://kargah.pad-design.ir/api/v2/` (Retrofit interface `T3.e`)
- Cloud API same host (`U3.b`: `storeCloudProject`, `getCloudProjects`, …)
- Forms/exports `https://admin.pad-design.ir/` (`W3.b`) + WebView report pages
- Optimizer `https://pad-design.ir/` (`V3.c`: `optimize`) and wallet top-up `multiPay`
- Firebase Cloud Messaging (project `cut-click`)

> Platform-wide UX/security notes (see also the sibling `audit_findings.md`):
> every screen is forced `portrait`; identity is just a numeric `user_id` in
> SharedPreferences (no real auth token); Persian toolbar/title text is used as
> navigation *state* (`equals()`/`switch` on strings); and several activities are
> `exported="true"` with unvalidated intent extras.

---

## 0. Component inventory (counts)

- **Activities: 14** — Splash, Intro, Login, SignUp, Main (bottom-nav host),
  ProjectPlate, ProjectPlatePart, ProjectCabinet, ProjectCabinetPart,
  CompleteProject, Accounting, AccountingProject, PdfView, WebView.
- **Primary fragments: ~11** — Order/Home (`P3.r`), ProcessingProjects/Tracking
  (`P3.F`), Company/Service-center (`P3.C0124g`), Plan (`P3.t`), OrderHistory (`P3.H`),
  Notification (`P3.s`), Support (`P3.J`), Financial/Wallet (`P3.C0127j`),
  AboutUs (`P3.C0118a`), ImageGallery (`P3.l`), Servicers-list (`P3.C`).
- **Dialogs / bottom sheets: ~40** (see each section; main ones documented below).

Main flows: **(1)** Auth/onboarding → **(2)** Home "New order" hub → **(3a)** Plate
cut-list project (Plate → Plate-parts → optional Cabinet units → Complete/submit) →
**(3b)** Cabinet/closet modeling → **(4)** Order submission to a service center
(optimize + price + submit) → **(5)** Order tracking → **(6)** Accounting →
**(7)** Plan/wallet + Support.

---

## 1. Onboarding / Auth

### SplashScreenActivity  (launcher)
- **Purpose:** Boot screen; silently re-authenticates and routes the user.
- **Reached by:** App icon (`MAIN/LAUNCHER`), also `cutclick://` deep link and FCM
  notification taps (passes extras `page`, `processStep`, `processProjectId`).
- **Layout `activity_splash_screen`:** logo + status text; shows "Fetching user
  info…" while loading.
- **Data/calls:** `getUser(user_id)` (`T3.e.v`). On success → `MainActivity`
  (carrying any notification extras). Startup also extracts a bundled/remote assets ZIP.
- **Notes/UX problems:** `exported="true"`. `Integer.parseInt(getString("processStep"))`
  with **no try/catch** → a crafted extra crashes the app. The `cutclick` scheme is
  declared but `getData()` is never read (deep link is a no-op). No offline state —
  if `getUser` fails the user is effectively stuck on splash.

### IntroActivity
- **Purpose:** First-run walkthrough / feature intro slides.
- **Reached by:** First launch (before login), extends a Material-Intro base
  (`C3.f`); slides use `fragment_intro` / `mi_fragment_simple_slide*`.
- **Notes:** `onBackPressed()` is overridden to do nothing (back disabled on intro).
  Decompiled `onCreate` is a jadx artifact (`throw null`), so exact slide content
  isn't recoverable from Java, but it is a standard swipeable multi-slide intro.

### LoginActivity
- **Purpose:** Phone-number + OTP login (two-step, single screen).
- **Reached by:** From Splash/Main when no session; also error handlers (`K0.c`,
  `q1.a`) push it when the server rejects the user.
- **Layout `activity_login`** (two card states in one screen):
  - **Step 1 "Mobile phone":** `edit_phone_number` — hint `(09xxxxxxxxx)`,
    `maxLength=11`, `inputType=phone`, **required** (error "Field required").
    Checkbox-style row `btn_role` "I accept the terms of service" → opens WebView to
    `https://kabinetplus.ir/terms`. Button `btn_login` "Get activation code".
    Shows `txt_version` ("v 1.3" placeholder).
  - **Step 2 "Activation code":** PIN view `pinview` + `edit_verify_number` —
    `maxLength=5`, `inputType=number`; explanatory line "Enter the code sent to
    <number>"; `btn_change_number` "Change number"; `btn_verify` "Enter".
- **Calls:** `login(mobile, smsToken, "cutclick")` (`T3.e.C`) → returns a `user_id`;
  then `verify(user_id, 5-digit code)` (`T3.e.a`). Uses Google SMS Retriever
  (`SmsBroadcastReceiver`) to auto-read the OTP.
- **Notes/UX problems:** OTP is only validated as "length ≥ 5" client-side (message
  "Invalid code" otherwise); no resend timer visible. `login` returns a `user_id` for
  any number, so account takeover depends entirely on server-side rate limiting of
  `verify` (see audit C1). Re-signing the APK breaks SMS auto-fill.

### SignUpActivity  (profile / edit-profile)
- **Purpose:** Collect/edit the user's profile and optional service-center code.
- **Reached by:** After first `verify` (new users), from the side menu item
  "Profile", from Main when `updateRequired`/`changeCompany` is set.
- **Layout `activity_sign_up`:**
  - `edit_user_name` "First name" — `digits` restricted to a Persian alphabet set,
    validation: required, 3–20 chars.
  - `edit_user_family` "Last name" — same 3–20 validation.
  - `edit_inviter_number` "Referrer mobile (optional)" — `maxLength=11`, numeric.
  - `edit_company_code` "Service code" — `maxLength=4`, numeric; validated via
    `getCompaniesDetailsByCode` (`T3.e.E`); error "Enter your service code correctly".
  - `btn_edit_profile` "Edit profile"; `btn_role` + `btn_laws` "I accept the terms &
    privacy"; `btn_log_out` "Log out".
- **Calls:** `getCompaniesDetailsByCode(code)` to resolve the service center, then
  `updateProfile(user_id, name, family, state_id, companies_code, inviter_phone)`
  (`T3.e.m`). On success → `MainActivity`.

---

## 2. Main navigation (MainActivity)

### MainActivity  (bottom-nav host)
- **Purpose:** Shell hosting the primary fragments; owns the toolbar, notification
  bell, settings button, and `MeowBottomNavigation`.
- **Layout `activity_main`:** toolbar (`txt_toolbar` default "Home", `btn_back`,
  `btn_notification` with `txt_notif_count` badge, `btn_setting`), a
  `main_frame_layout` container, and the bottom nav bar.
- **Bottom navigation (3 items; `MeowBottomNavigation`):**
  | Item | Icon | Fragment | Meaning |
  |---|---|---|---|
  | **1** | `process` | `P3.F` ProcessingProjects | **Order tracking** (پیگیری سفارشات) |
  | **2** | `ic_my_pro` | `P3.r` Order/Home | **New order / my projects** (ثبت سفارش) — *default tab* |
  | **3** | `ic_saw` | `P3.C0124g` Company (via `t()`) | **Service center** (خدماتی) |
  Mapping confirmed in `I4.f` case 4. Startup can deep-select a tab from FCM extras
  (`process`, `plan`, `company`).
- **Side settings sheet (`bottom_sheet_setting`, `O3.S`)** — drawer-style menu whose
  handler `MainActivity.s(int)` routes to:
  1 → Profile (`SignUpActivity`), 2 → About us (`P3.C0118a`), 3 → Rules (WebView
  `app_rule_url`), 4 → Plan (`P3.t`), 5 → Order history (`P3.H`), 6 → project-status
  tool (`B1.b`), 8 → Support (`P3.J`), 9 → Theme switch (`O3.z0`,
  `bottom_switch_theme`), 10 → Help URL (opens Chrome), 11 → Accounting
  (`AccountingActivity`), 12 → Financial/Wallet (`P3.C0127j`).
- **Calls on resume:** `getLastUpdateApp` (`T3.e.x`) for forced-update check, plus
  badge counts from the cached `User` (notifications, tickets, pending steps).
- **Notes:** `windowSoftInputMode=adjustPan`, forced portrait. On launch a survey
  bottom sheet (`O3.D0` `bottom_dialog_vote`) can appear if `is_survey==1`. Exit is
  guarded by an exit bottom sheet (`O3.L` `bottom_dialog_exit_app`, with Instagram link).

### Order / Home fragment  (`P3.r`, `fragment_order`) — default tab
- **Purpose:** Landing hub: promo slider + the user's project list; entry point to
  create a new project and to restore cloud projects.
- **Reached by:** Bottom-nav item 2 (default).
- **UI:** image slider (from `getSlider`), a RecyclerView of projects (local DB +
  cloud), and a **"Restore orders"** control (download cloud projects locally).
  A "+"/new action opens the **Create-project dialog** (below).
- **Calls:** `getSlider(user_id, "cutclick")` (`T3.e.k`); `getProjects(user_id,
  status_id=5, page)` (`T3.e.A`); `getCloudProjects(user_id, page, offset)` (`U3.b.f`);
  per-project cloud pull `storeCloudProject`/detail.
- **Dialogs opened:** Create-project (`O3.B0`), Open/transfer project, Share cloud
  project (`P3.n` → `dialog_share_cloud_project`), Upload-all (`O3.Z`).

#### Create-project dialog (`O3.B0`, `dialog_add_project`)
- **Fields:** `edit` "Order name" (`maxLength=30`, **no character sanitization** —
  see audit C2, titles become folder names). Three type buttons:
  **Cut Master** (کات مستر → plate cut-list project → `ProjectPlateActivity`),
  **Accounting** (حسابداری → `AccountingActivity`/project), **Design** (طراحی).
  Confirm = "تایید".

---

## 3. Project (plate) flow — cut-list / panel optimization

### ProjectPlateActivity  ("Cut Master")
- **Purpose:** Top editor for a plate/cut-list project: pick material thickness, manage
  the project's **sheets (ورق)** and **cabinet units (یونیت)**.
- **Reached by:** Create-project dialog → "Cut Master", or tapping an existing project
  in Home/History (`P3.n/E/p/m` launch it with `projectId`,`projectName`).
- **Layout `activity_project_plate`:** toolbar "Order: <name>" + "Cut Master";
  thickness toggle `toggle_cat` (`btn_16mm` / `btn_3mm`) and `recycler_thickness`;
  a sheet list `recycler_plate`; counters `txt_unit_count` and `txt_plate_count`
  (`maxLength=4`) with **"New unit"** (`btn_unit`) and **"New sheet"** (`btn_plate`)
  buttons; sheet columns Row / Sheet name / Size…; `btn_complete_project`
  **"Confirm and continue"**.
- **Behavior:** "New unit" → `ProjectCabinetActivity`; tapping a sheet →
  `ProjectPlatePartActivity` (passes `projectId`,`projectName`). "Confirm and continue"
  branches to `ProjectCabinetActivity` (if the project has cabinet units to fill) or
  straight to `CompleteProjectActivity`.
- **Dialogs:** Add-sheet-name (`O3.C0073g` `dialog_add_plate_name`), PVC/color type
  (`H3.C0049x` `dialog_add_plate_pvc_type`), select-plate (`O3.o0`).
- **Notes:** `windowSoftInputMode=adjustPan`; title (`projectName`) flows into the
  file-system path for cutting-map output without sanitization (audit C2).

### ProjectPlatePartActivity  ("Register order parts")
- **Purpose:** Per-piece data entry for one sheet — dimensions, edge-banding and
  machining options. This is the heart of the cut-list.
- **Reached by:** Tapping a sheet in `ProjectPlateActivity` (also from `J1.i` deep flows).
- **Layout `activity_project_plate_part`:** header "Register order parts",
  "Save and continue", **"Multi-edit mode"** toggle. Per row:
  - Count (hint "0", `maxLength=3`); **Width** = meters (`maxLength=1`) `/` cm
    (`maxLength=3`); `×`; **Length** = meters `/` cm; **Rotate** (چرخش), **Gazor**
    (گازور), **CNC** toggles; piece description (`maxLength=15`).
  - **Edge band P (نوار P):** 4 edges, each value "0.0 Cm" with Double/Sobel options.
  - **Persian/miter F (فارسی F):** 4 edges, "From back" / "Graded".
  - **Groove SH (شیار SH):** 4 edges, "From back" / "Mirror".
  - A "Parts list" section with per-piece description (`maxLength=15`).
- **Notes:** `windowSoftInputMode=stateAlwaysHidden|adjustResize`. This is the single
  largest class (~14.7k lines) — a strong rebuild candidate for componentization.
  Confirm dialogs: `H3.A` (`dialog_confirm_project_pate_part`), `K0.d`
  (`dialog_confirm_project_pate`).

### ProjectCabinetActivity  ("New unit" list)
- **Purpose:** List/manage the cabinet **units** of a project, filter by category.
- **Reached by:** "New unit" in `ProjectPlateActivity`.
- **Layout `activity_project_cabinet`:** "Register new unit", filter row
  ("Filter: Show all / By category"), empty-state "No units in this category",
  unit table (Row / Unit name / Width / Description / Count), "Confirm and continue".
  A pin/overflow menu uses `layout_cabinet_pin_menu` (`c4.DialogC0297b`).
- **Reached-from-here:** opens `O3.D` (`bottom_dialog_select_cabinet_default`) for
  defaults and `ProjectCabinetPartActivity` for editing a unit.
- **Notes:** `exported="true"` (any app can open an arbitrary local `projectId`).

### ProjectCabinetPartActivity  (parametric unit editor)
- **Purpose:** Fully parametric cabinet/closet unit: carcass dimensions + counts of
  shelves/doors/drawers/rails, door type, and assembly type.
- **Reached by:** `H3.ViewOnClickListenerC0032f` (selecting a unit in the cabinet list).
- **Layout `activity_project_cabinet_part`** — top tabs **"Door sheet"** / **"Assembly
  type"**; unit description (`maxLength=15`); each dimension as meters (`maxLength=1`)
  `/` cm (`maxLength=3`):
  - Width (عرض), Depth (عمق), Height (ارتفاع), Fixed carcass width (عرض بدنه ثابتی),
    Width parameter (پارامتر عرضی), Depth deduction (کسر عمق), Second depth (عمق دوم),
    Height 1–5 (ارتفاع 1..5), Drawer-depth deduction (کسر از عمق (کشو)).
  - Counts (`maxLength=3`): shelves (طبقه), doors (درب), units (یونیت), drawers (کشو),
    partitions (واداری), rails-under-drawer (تیره زیر کشو), stretchers (قید), rails (تیره).
  - Toggles: Door type (نوع درب), **Hidden handle** (دستگیره مخفی), **Carcass facade**
    (بدنه نما). Buttons: "Initial settings" (تنظیمات اولیه), "Save and continue".
- **Dialogs:** extra-param bottom sheet (`O3.B` `bottom_dialog_cabinet_extra_param`),
  size list (`O3.t0` `bottom_dialog_show_cabinet_size_list`), select-plate for cabinet
  (`O3.k0` `bottom_dialog_select_cabinet_plate`).
- **Notes:** `windowSoftInputMode=stateAlwaysHidden|adjustResize`, `exported="true"`.
  Changing a unit recalculates its default parts ("all default unit parts and deleted
  parts will be recalculated").

### CompleteProjectActivity  ("Complete order details" / submit)
- **Purpose:** Final review + submission of a project as an **order** to a service
  center: choose who performs it, optimize, price, and send.
- **Reached by:** "Confirm and continue" from `ProjectPlateActivity`.
- **Layout `activity_complete_project`:** "Complete order details", a
  "Services / Service center" selector, a sheet review table (Row / Sheet name /
  Sheet size / Band type & color / Pre-milling پ-فرز), "Confirm and continue".
- **Submission sequence (via callback `C0306i`):**
  1. `optimize(projectId, userId, "cutclick")` on the optimizer host (`V3.c.a`).
  2. `importProjectWithPlate(ProjectSendData, server_id, perform_type, "cutclick")`
     (`T3.e.F`) — uploads the whole project.
  3. `getUser` refresh, then `planUserPayment(user_id, server_id, unit_submit, app)`
     (`T3.e.h`) to settle plan usage.
  `ComputeProjectPrice(ProjectSendData)` (`T3.e.t`) is available for price preview.
- **Perform-type dialog (`B0.n`, `dialog_select_perform_type`):** "Order performed
  by:" + service-center name; note "For a more optimized cutting plan, send your order
  to one of the service centers". Options include **Myself** (خودم) vs a service center.
- **Notes:** After submit the user lands in Order tracking; the final cutting plan is
  delivered later by the service center and viewed there.

---

## 4. Ordering / Service centers

### Company / Service-center fragment (`P3.C0124g`, `fragment_company`)
- **Purpose:** Profile of a service center (the "saw" / wood-service provider the
  user orders from).
- **Reached by:** Bottom-nav item 3 (`MainActivity.t()`), or opening a center from
  the servicers list.
- **Layout `fragment_company`:** header with name + code (e.g. "پارسا چوب (256)"),
  tabs **General info / Machinery / Price / Contact us**, city, a **price list** table
  (Row / Service description / Unit price (Rial)), and **"Contact service center"**.
- **Calls:** `getCompaniesDetails(companies_id)` (`T3.e.G`).

### Servicers list fragment (`P3.C`, `fragment_servicers`)
- **Purpose:** Browse/search nearby service centers (uses GPS prompt: "To see nearest
  service centers, turn on location"). Feeds into the Company profile above.

### Image gallery fragment (`P3.l`, `fragment_image_gallery`)
- **Purpose:** Photo gallery (e.g. a service center's machinery/work images).

### Order tracking fragment (`P3.F`, `fragment_processing_projects`) — bottom-nav 1
- **Purpose:** Track submitted orders through their lifecycle.
- **Layout `fragment_processing_projects`:** status buckets with counts —
  **Myself (خودم)**, **Calculate/Calculating (محاسبه)**, **In production (درحال تولید)**,
  **Ready for delivery (آماده تحویل)**.
- **Calls:** `getProjects(user_id, status_id, page)` (`T3.e.A`) per bucket;
  `getStatusList(project_id)` (`T3.e.r`) for a timeline; order actions
  `userConfirmProject` / `userCancelProject` / `doneProject` (`T3.e.p/l/f`).
- **Reached-from-here:** order detail / cloud-project open (`H3.ViewOnClickListenerC0023a`
  `dialog_open_cloud_project`), status dialog (`dialog_project_status`), and WebView
  report pages (cutting plan, factor/cardex) on `admin.pad-design.ir`.

### Order history fragment (`P3.H`, `fragment_order_history`)
- **Purpose:** List of past/submitted projects; re-open or restore them.
- **Reached by:** Side menu item 5.

---

## 5. Accounting

### AccountingActivity  ("Accounting services")
- **Purpose:** Accounting hub listing accounting "projects"/customers with
  profit-loss and balance summaries.
- **Reached by:** Side menu item 11, or Create-project dialog → Accounting.
- **Layout `activity_accounting`:** "Accounting services", "Collection name",
  "Profit & loss: …", "Account balance: …", and a project grid.
- **Notes:** The list is currently built from **hard-coded demo data** in
  `onCreate` (names like "تلال", "ریانا", icons `ic_project_*.webp`) — i.e. this
  module looks like a local/stub feature, not server-backed. Opening an item →
  `AccountingProjectActivity`.

### AccountingProjectActivity  (per-project ledger)
- **Purpose:** Ledger for one accounting project: expenses, receipts, invoices, PDF.
- **Reached by:** Tapping an accounting project (also `J1.i`).
- **Layout `activity_accounting_project`:** "Order: <name>", "Confirm and continue",
  "Profit & loss" / "Account balance" summary, **"New invoice"**, **"Save PDF"**,
  **"Issue customer invoice"**, two tabs **Expenses (هزینه ها)** / **Receipts (دریافت ها)**,
  and a table (Row / Title / Amount (Toman)).
- **Dialogs:** New-expense entry (`G.d`, `dialog_entry_new_expense` — Title
  `maxLength=30`, Amount/area `maxLength=30`, Cost in Toman `maxLength=30`, Description
  `maxLength=150`, plus attachment picker); add-accounting-customer
  (`dialog_add_accunting_service` — Customer name `maxLength=30`, Phone, Address
  `maxLength=150`); factor-type picker (`dialog_factor_type_accounting_priject`);
  accounting settings (`t1.C0906b` `dialog_setting_accounting`, `dialog_personal_project_info`).
- **Calls:** `exportFiles(user_id, project_id, form_type, "cutclick")` (`W3.b.c`) for
  PDF/factor generation (opened in `PdfViewActivity`/WebView).

### Financial / Wallet fragment (`P3.C0127j`, `fragment_financial`)
- **Purpose:** User wallet / financial transactions and account-card export.
- **Reached by:** Side menu item 12.
- **Layout `fragment_financial`:** **"New payment"**, balance "مانده: … Toman"
  (amount `maxLength=16`), **"Download account card"**, transactions list.
- **Calls:** `getFactors(user_id, page, app)` (`T3.e.e`), `exportAccountCart(user_id)`
  (`W3.b.b`); top-up via `bottom_dialog_pay` (`O3.f0`) → opens `pad-design.ir/multiPay`.

---

## 6. Subscription / Plan

### Plan fragment (`P3.t`, `fragment_plan`)
- **Purpose:** Show the current subscription and buy/renew.
- **Reached by:** Side menu item 4 (or FCM `plan` extra).
- **Layout `fragment_plan`:** gamified stat tiles — **Invite friends**,
  **Buy subscription**, **Completed orders**, **Points/امتیاز**; current plan card
  with expiry date and days remaining; **"Custom (count & time)"** and
  **"Amazing packages"** sections.
- **Calls:** `getProjectPlan(user_id, "cutclick")` (`T3.e.z`); custom-plan pricing via
  **Create-plan bottom sheet** (`O3.I`, `bottom_dialog_create_plan` — "Day count" and
  "Order count" inputs, "Calculate price") → `calculatePlanPrice(user_id, plan_day)`
  (`T3.e.j`); checkout to `admin.pad-design.ir/api/v1/paymentCutClick/{planId}/{userId}`.

---

## 7. Support / Other

### Support fragment (`P3.J`, `fragment_support`)
- **Purpose:** Ticket list + create ticket ("Click to submit a ticket").
- **Reached by:** Side menu item 8.
- **Calls:** `getSupportMessage(user_id, page)` (`T3.e.c`), `getSubjects` (`T3.e.u`),
  `StoreSupport(subject_id, user_id, title, description, type)` (`T3.e.n`). Create
  ticket uses `bottom_dialog_support` (`O3.x0`).

### Notification fragment (`P3.s`, `fragment_notification`)
- **Purpose:** In-app notification center.
- **Reached by:** Toolbar bell (`btn_notification`).
- **Calls:** `getAllNotification(user_id, status, page)` (`T3.e.i`),
  `visitNotification(user_id)` (`T3.e.w`).

### About-us fragment (`P3.C0118a`, `fragment_about_us`)
- **Purpose:** Static about/contact page (side menu item 2; Instagram link).

### PdfViewActivity
- **Purpose:** In-app PDF viewer (cutting plans, invoices, account card).
- **Reached by:** "Cutting plan"/report buttons across tracking, accounting, forms
  (`G.d`, `G.n`, `H3.A/B/X`, `S1.n`).
- **Layout `activity_pdf_viewer`:** title "Cutting plan" (`title` extra), `pdf_view`
  (library `com.pdfview.PDFView`), `btn_share`.
- **Notes:** `exported="true"`; renders the file at the `path` extra with **no
  validation** — any installed app can make it show an arbitrary PDF (phishing), and a
  missing extra NPEs (audit M1).

### WebViewActivity
- **Purpose:** Generic in-app browser for server pages (terms, rules, help, report
  HTML, payment).
- **Reached by:** Login/SignUp terms, side menu "Rules"/"Help", report links in
  tracking/accounting (`H3.*`, `P3.z`).
- **Layout `activity_web_view`:** titled toolbar (default "CutClick"); `AdvancedWebView`
  loads the `url` extra; optional `formType` extra for report pages.

### Shared dialogs / bottom sheets (cross-cutting)
- **No internet** (`O3.W` `bottom_dialog_no_internet`), **Wait/loading**
  (`dialog_wait`), **Vote/survey** (`O3.D0` `bottom_dialog_vote`), **Theme switch**
  (`O3.z0` `bottom_switch_theme`), **Exit app** (`O3.L` `bottom_dialog_exit_app`),
  **Message** (`O3.U` `bottom_dialog_message`), **Factor detail**
  (`O3.N` `bottom_dialog_factor_detail`), **Select city** (`bottom_dialog_select_city`),
  **Share cloud project** (`P3.n` `dialog_share_cloud_project` — searches a colleague by
  mobile via `getUserInfo`, then `sendCloudProjectToUser`), **Upload all projects**
  (`O3.Z` `dialog_upload_all_project` → `storeCloudAllProjects`), **Transfer project**
  (`O3.l0` `dialog_select_project_for_transfer`), **App updater** (`J1.i`,
  `fragment_app_updater_dialog` / `dialog_update` — can be non-cancelable when
  `is_force_update=1`), **Delete alert** (`O3.C0089x`).

---

## 8. Navigation tree

```
SplashScreenActivity (launcher; getUser)
├─ (no session) ─► LoginActivity ─(login/verify)─► SignUpActivity ─► MainActivity
├─ (first run)  ─► IntroActivity ─► Login…
└─ (session ok) ─► MainActivity

MainActivity  (MeowBottomNavigation host; forced portrait)
├─ Tab 1  Order tracking        → P3.F  fragment_processing_projects
│         ├─ status dialog / order detail → open cloud project (H3.a)
│         ├─ Cutting-plan PDF   → PdfViewActivity
│         └─ Report pages       → WebViewActivity (admin.pad-design.ir)
├─ Tab 2  New order / Home      → P3.r  fragment_order            [DEFAULT]
│         ├─ Create-project (O3.B0 dialog_add_project)
│         │     ├─ "Cut Master" → ProjectPlateActivity
│         │     │        ├─ sheet → ProjectPlatePartActivity (edge-band/miter/groove)
│         │     │        ├─ "New unit" → ProjectCabinetActivity
│         │     │        │        └─ unit → ProjectCabinetPartActivity (parametric)
│         │     │        └─ "Confirm & continue" → CompleteProjectActivity
│         │     │                 └─ optimize → importProjectWithPlate → planUserPayment
│         │     │                      → (back to) Order tracking
│         │     ├─ "Accounting" → AccountingActivity → AccountingProjectActivity
│         │     │        └─ expense/invoice dialogs → exportFiles → PdfViewActivity
│         │     └─ "Design"
│         ├─ Share cloud project (P3.n) → sendCloudProjectToUser
│         └─ Restore / Upload-all (O3.Z) → storeCloudAllProjects
├─ Tab 3  Service center        → P3.C0124g fragment_company (getCompaniesDetails)
│         ├─ Servicers list (P3.C fragment_servicers, GPS)
│         └─ Image gallery (P3.l)
└─ Settings sheet (O3.S bottom_sheet_setting)
          ├─ Profile        → SignUpActivity
          ├─ About us       → P3.C0118a
          ├─ Rules / Help   → WebViewActivity / Chrome
          ├─ Plan           → P3.t fragment_plan → create-plan (O3.I) → calculatePlanPrice → pay WebView
          ├─ Order history  → P3.H fragment_order_history
          ├─ Support        → P3.J fragment_support (StoreSupport)
          ├─ Accounting     → AccountingActivity
          ├─ Financial/Wallet → P3.C0127j fragment_financial → pay (O3.f0) → multiPay
          └─ Theme switch   → O3.z0
Toolbar bell → P3.s fragment_notification (getAllNotification)
```

---

## 9. Rebuild-relevant observations (per-screen UX/logic problems)

- **Forced portrait everywhere** — the dense plate-part and cabinet-part grids would
  benefit greatly from landscape/tablet layouts.
- **Text used as state** — toolbar titles and button captions (e.g. "خدماتی",
  "گالری", "ندارد", "همرنگ"/"سفید") are compared with `equals()`/`switch` and even
  stored/sent to the server. Rebuild with enums/ids.
- **Project title → filesystem path** — `dialog_add_project` only caps length (30),
  no sanitization; the title becomes a Downloads subfolder that is recursively deleted
  (audit C2). Use the numeric id as the folder key.
- **Thin client validation** — OTP checked only as length ≥ 5; names 3–20; most
  numeric fields rely on `maxLength` + `inputType` only. Server is the real gate.
- **Accounting list is demo/stub data** — hard-coded in `AccountingActivity.onCreate`;
  treat the accounting module as unfinished when scoping a rebuild.
- **Giant screens** — `ProjectPlatePartActivity` (~14.7k lines) and
  `ProjectCabinetPartActivity` (~4.1k lines) are monolithic; decompose into reusable
  row/section components and a view-model.
- **Exported, unvalidated activities** — `ProjectCabinetActivity`,
  `ProjectCabinetPartActivity`, `PdfViewActivity` are `exported="true"` and trust their
  intent extras; `SplashScreenActivity` crashes on a bad `processStep`. Make internal
  activities non-exported and validate all extras.
- **Identity = raw `user_id`** — every endpoint takes `user_id`/`project_id` as plain
  params with one static shared API key; rebuild with a real bearer token issued at
  verify and server-side ownership checks.

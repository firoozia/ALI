# CutClick (com.padcod.cutclick v4.0.1) — Data Model & Backend API Map

Reverse-engineered from decompiled sources. CutClick is an Iranian cabinet / cut-list
("optimization") app. A user builds **Projects**; each project contains **Plates**
(ورق = sheet/board of a given material), and each plate is cut into **Parts**
(قطعه = piece). Projects can also be generated from parametric **Cabinet** units
(کابینت) and **Closet** units (کمد). Finished projects are optimized, priced and
submitted to a **company** (factory/workshop), and can be synced to a **Cloud** store.

Serialization: all models use Gson with `@InterfaceC0916b("…")` = `@SerializedName("…")`.
The JSON key is what the server/cloud exchanges; the local SQLite column names are
separate (and heavily abbreviated — decoded below).

---

## 1. Local Database Schema

- **DB file:** `Project.db`
- **Version:** `16`
- **Helper:** `N3/b.java` (extends `SQLiteOpenHelper`)
- **Upgrade policy:** `onUpgrade` simply DROPs all tables and recreates them (no data
  migration) whenever the version increases. 8 tables.

The three "project*" tables use single-letter column names. Column meaning is decoded
from the insert (`w`, `x`) and read (cursor index) methods in `N3/b.java` and the Gson
keys of the matching model classes.

### Table `projects`
Stores one row per local project.

| Column | Type | Meaning |
|---|---|---|
| id | integer PK AUTOINC | local project id |
| user_id | integer | owner user id |
| companies_id | integer | target company/factory id |
| service_type | integer | service/project type (e.g. cut-list vs cabinet) |
| title | text | project title |
| emoji | text | project emoji/icon |
| status | integer | local status |
| cloud_id | integer | id of this project in the Cloud store (0 = not synced) |
| server_id | integer | id assigned by backend after submit (0 = not submitted) |
| is_pay | integer DEFAULT 0 | paid flag |

### Table `project_plates`
One row per plate/sheet in a project. (`ProjectPlateModel`)

| Column | Type | Meaning |
|---|---|---|
| id | integer PK AUTOINC | local plate id |
| project_id | integer | FK → projects.id |
| plate_id | integer | FK → catalog plate (`PlateModel.id`) = material |
| title | text | plate title |
| pvc_type | integer DEFAULT 0 | PVC edge-band type |
| pvc_material | integer DEFAULT 0 | PVC material |
| pvc_color | text DEFAULT '' | PVC / plate color |
| image | text | plate image filename |
| q_pi | integer DEFAULT 0 | total piece/part quantity (rolled up from parts, SUM(e)) |
| p | integer DEFAULT 0 | perimeter/edge total p (SUM of part.n) |
| f | integer DEFAULT 0 | edge total f (SUM of part.o) |
| sh | integer DEFAULT 0 | groove/shiar total (SUM of part.p) |
| pp | integer DEFAULT 0 | edge total pp (SUM of part.q) |
| ppp | integer DEFAULT 0 | edge total ppp (SUM of part.r) |
| fb | integer DEFAULT 0 | edge total fb (SUM of part.s) |
| fd | integer DEFAULT 0 | edge total fd (SUM of part.t) |
| shb | integer DEFAULT 0 | edge total shb (SUM of part.u) |
| sha | integer DEFAULT 0 | edge total sha (SUM of part.v) |
| l | integer DEFAULT 0 | plate length (custom/override) |
| w | integer DEFAULT 0 | plate width (custom/override) |
| piece | text DEFAULT '0' | is-piece flag / piece mode |
| is_pf | integer | "pre-form"/company-cut flag (defaults -1 when company_pf=1) |
| def_count | integer DEFAULT 0 | default plate count |
| is_edit | integer DEFAULT 0 | edited-since-sync flag |
| qty | integer DEFAULT -1 | fixed plate quantity (-1 = auto/optimize) |
| thickness | text DEFAULT '16' | board thickness (mm) |
| plate_type | integer DEFAULT 1 | plate type |
| y | integer DEFAULT 0 | aux param y |
| z | integer DEFAULT 0 | aux param z |

> Note: columns `p, f, sh, pp, ppp, fb, fd, shb, sha, q_pi` on the plate are
> **aggregates** recomputed by `N3/b.java` method `y(projectId)` via
> `SELECT SUM(<col>) FROM project_plate_parts WHERE b = <plateId>`.

### Table `project_plate_piece`
Custom "free" offcut/piece sizes attached to a plate. (`ProjectPlatePieceModel`)

| Column | Type | Meaning |
|---|---|---|
| id | INTEGER PK | piece id |
| project_id | INTEGER | FK → projects.id |
| project_plate_id | INTEGER | FK → project_plates.id |
| l | VARCHAR | piece length (`piece_l`) |
| w | VARCHAR | piece width (`piece_w`) |
| q | INTEGER DEFAULT -1 | piece quantity (`piece_q`) |

### Table `project_plate_parts`
One row per cut part/piece (قطعه) belonging to a plate. Columns are single letters;
decoded from insert method `x(...)` and read loop (cursor indices) in `N3/b.java`,
cross-checked against `ProjectPlatePartModel` / `Cloud/CloudPlatePart` Gson keys.

| Column | Idx | Type | Model field (JSON) | Meaning |
|---|---|---|---|---|
| id | 0 | integer PK | id | part id |
| a | 1 | integer | project_id | FK → projects.id |
| b | 2 | integer | project_plate_id | FK → project_plates.id |
| c | 3 | text | l | part **length** |
| d | 4 | text | w | part **width** |
| e | 5 | text | q | **quantity** |
| f | 6 | text | gr (`setRg`) | groove value (شیار) |
| g | 7 | text | ref / app_ref | server/app reference key |
| h | 8 | text | description | part description / label |
| j | 9 | text | le (`setD`) | **left edge** PVC band |
| k | 10 | text | re (`setB`) | **right edge** PVC band |
| l | 11 | text | te (`setA`) | **top edge** PVC band |
| m | 12 | text | be (`setC`) | **bottom edge** PVC band |
| n | 13 | text | p | edge/measure p |
| o | 14 | text | f | edge/measure f |
| p | 15 | text | sh | groove/shiar sh |
| q | 16 | text | pp | edge pp |
| r | 17 | text | ppp | edge ppp |
| s | 18 | text | fb | edge fb |
| t | 19 | text | fd | edge fd |
| u | 20 | text | shb | edge shb |
| v | 21 | text | sha | edge sha |
| w | 22 | integer | g (`gazor`) | gazor/bevel flag (گازور) |
| x | 23 | integer | cnc | CNC flag |
| y | 24 | integer | cabinet_id (`unit_id`) | source cabinet/unit id (0 = manual) |
| z | 25 | integer | cabinet_type (`unit_type`) | source unit type |
| aa | 26 | text | cabinet_title (`unit_title`) | source unit title |
| bb | 27 | integer | closet_id | source closet id |
| cc | 28 | integer | closet_type | source closet type |
| ee | 29 | text | closet_title | source closet title |
| unit_info | 30 | text | unit_info | serialized unit metadata |
| unit_edit | 31 | integer | unit_edit | unit-edited flag |
| reverse_direction | 32 | integer | reverse_direction | grain/reverse-direction flag |

> Edge banding uses 4 sides: **te/re/be/le = top / right / bottom / left**
> (confirmed by `Cloud/CloudPlatePart` keys `te,re,be,le`). `g`=gazor, `gr`=groove, `cnc`=CNC.

### Table `project_detail`
One aggregate/summary row per project (totals). Columns `a..q` decoded from the read
loop in `N3/b.java` (maps to `ProjectDetailModel`).

| Column | Idx | Model field | Meaning |
|---|---|---|---|
| id | 0 | id | detail id |
| a | 1 | project_id | FK → projects.id |
| b | 2 | q_a_plate | quantity of "A" plates |
| c | 3 | q_b_plate | quantity of "B" plates |
| d | 4 | q_plate | total plates |
| e | 5 | q_part | total parts |
| f | 6 | pvc_t_1 | PVC edge type-1 total |
| g | 7 | pvc_t_2 | PVC edge type-2 total |
| h | 8 | pvc_t_3 | PVC edge type-3 total |
| i | 9 | pvc_t_4 | PVC edge type-4 total |
| j | 10 | f | edge-measure f total |
| k | 11 | sh | groove sh total |
| l | 12 | pp | pp total |
| m | 13 | ppp | ppp total |
| n | 14 | fb | fb total |
| o | 15 | fd | fd total |
| p | 16 | shb | shb total |
| q | 17 | sha | sha total |

### Table `cabinet`
One row per placed cabinet unit in a project. (read maps to `CabinetProjectModel`)

| Column | Type | Meaning |
|---|---|---|
| id | integer PK AUTOINC | local row id |
| project_id | integer | FK → projects.id |
| cabinet_id | integer | FK → catalog cabinet (`Cabinet.id`) |
| cat_id | integer | category id |
| sub_cat_id | integer | sub-category id |
| title | text | cabinet title |
| code | text | cabinet code |
| image_1..image_4 | text | preview images |
| img_assemble | text | assembly image |
| x, x1, x2, x3 | integer | parametric width dimensions |
| y, y1, y2, y5, y6 | integer | parametric height dimensions |
| z, z1, z2, z3, z4, z5 | integer | parametric depth dimensions |
| f, f1, f2, f3 | integer | shelf/frame params |
| w1, w2, w3 | integer | extra width params |
| b | integer | param b |
| k | integer | param k |
| h | integer | param h |
| j | integer | param j |
| a1 | integer | param a1 |
| door_type | integer | door type |
| door_plate_type | integer | door plate/material type |
| assemble_type | integer | assembly type |
| knock_type | integer | knock-down/joinery type |
| cover_body | integer | body-cover flag |
| info | text | serialized cabinet info |
| assemble_detail | text | serialized assembly detail |

### Table `cabinet_setting`
One row per project: default plate/material choices for generated cabinet parts.
(`CabinetSetting`)

| Column | Type | Meaning |
|---|---|---|
| id | integer PK AUTOINC | id |
| project_id | integer | FK → projects.id |
| door_pvc_thickness | integer | door PVC thickness |
| between_door_thickness | integer | gap between doors |
| groove_depth | integer | groove (شیار) depth |
| body_plate_id | integer | plate id for body |
| mill3_plate_id | integer | plate id for 3mm mill (فرز ۳) |
| f16_plate_id | integer | plate id for 16mm back |
| f3_plate_id | integer | plate id for 3mm back |
| door1_plate_id / door2_plate_id / door3_plate_id | integer | plate ids per door type |
| default_info | text | serialized defaults |

### Table `cabinet_asset`
Hardware/accessory (یراق‌آلات) rows per cabinet. (`CabinetProjectAssets`)

| Column | Type | Meaning |
|---|---|---|
| id | integer PK AUTOINC | id |
| project_id | integer | FK → projects.id |
| cabinet_id | integer | FK → cabinet / unit |
| title | text | asset title |
| symbol | text | asset symbol/code |
| unit | text | unit of measure |
| count | text | quantity |

---

## 2. Domain / Entity Model

### Relationship overview

```
User (1) ──< Project (ProjectModel)
                 │ 1
                 ├──< ProjectPlate (ورق / sheet)        [project_plates]
                 │        │ 1
                 │        ├──< ProjectPlatePart (قطعه / cut piece)  [project_plate_parts]
                 │        └──< ProjectPlatePiece (custom offcut sizes) [project_plate_piece]
                 │ 1
                 ├──  ProjectDetail (totals, 1:1)        [project_detail]
                 │ 1
                 ├──< Cabinet units (CabinetProjectModel) [cabinet]
                 │        └── generates Parts into plates (part.y = cabinet_id)
                 ├──  CabinetSetting (defaults, 1:1)     [cabinet_setting]
                 ├──< CabinetAsset (hardware)            [cabinet_asset]
                 └──< Closet units (ClosetProject)        → also generate plate parts
```

- A **Project** holds a list of **Plates**. Each Plate is a board of one catalog
  material (`plate_id` → `PlateModel`) with a thickness/color.
- Each **Plate** holds a list of **Parts** (the actual rectangles to cut: length `l`,
  width `w`, quantity `q`, plus 4-side edge banding te/re/be/le, groove, gazor, CNC).
- Each **Plate** may also hold free **Piece** sizes (manual offcuts).
- **Cabinet** and **Closet** units are *parametric generators*: from their dimensions
  the app computes parts and writes them into the plate parts (the part keeps a back-ref
  `cabinet_id`/`unit_type` or `closet_id`/`closet_type`). `CabinetSetting` decides which
  plate/material each generated part uses.
- **ProjectDetail** is a cached roll-up of counts/totals for the whole project.

### ProjectModel (`Model/App/ProjectModel`)
| Field | Type | JSON | Meaning |
|---|---|---|---|
| id | int | id | local id |
| user_id | int | user_id | owner |
| companies_id | int | companies_id | target company |
| service_type | int | service_type | project type |
| title | String | title | title |
| emoji | String | emoji | emoji |
| status | int | status_id | status |
| cloud_id | int | cloud_id | cloud store id |
| server_id | int | server_id | backend id after submit |
| is_pay | int | is_pay | paid |

### ProjectPlateModel (`Model/App/ProjectPlateModel`)
Key fields: `id, projectId, plateId, title, color (plate_color), img, pvc_type
(plate_pvc_type), plate_pvc_material, l, w, q, thickness, plateType (plate_type),
piece, is_pf, default_plate_count, is_edit, q_pi, p, f, sh, pp, ppp, fb, fd, shb, sha,
unit_type, closet_type, unitInfo (unit_info), p_l, p_w, plate_description (description)`.
Represents one board instance in the project; the `q_pi…sha` ints are edge-length/part
roll-ups. `is_pf` marks a plate the company pre-cuts.

### ProjectPlatePartModel (`Model/App/ProjectPlatePartModel`)
| Field (getter) | Type | JSON | Meaning |
|---|---|---|---|
| id | int | id | part id |
| projectId | int | project_id | parent project |
| projectPlateId | int | project_plate_id | parent plate |
| l | String | l | length |
| w | String | w | width |
| q | String | q | quantity |
| a | String | te | top edge band |
| b | String | re | right edge band |
| c | String | be | bottom edge band |
| d | String | le | left edge band |
| rg | String | gr | groove |
| gazor | int | g | gazor/bevel |
| cnc | int | cnc | CNC machining |
| f,p,sh,pp,ppp,fb,fd,shb,sha | String | same | edge/measure values |
| description | String | description | label |
| app_ref / server_ref | String | app_ref / ref | references |
| unit_id / unit_type / unit_title | int/int/String | cabinet_id / cabinet_type / cabinet_title | source cabinet |
| closet_id / closet_type / closet_title | int/int/String | closet_id/closet_type/closet_title | source closet |
| unitInfo | String | unit_info | unit metadata |
| unitEdit | int | unit_edit | edited flag |
| reverseDirection | int | reverse_direction | grain direction |

### ProjectDetailModel (`Model/App/ProjectDetailModel`)
Fields: `id, projectId, q_a_plate, q_b_plate, q_plate, q_part, pvc_t_1..pvc_t_4,
f, sh, pp, ppp, fb, fd, shb, sha`. Project-wide totals (plate counts, part count,
PVC-edge totals by type, edge-length sums).

### ProjectPlatePieceModel (`Model/App/ProjectPlatePieceModel`)
`id, projectId, projectPlateId, pieceL (piece_l), pieceW (piece_w), pieceQ (piece_q)`.
Manual offcut/piece sizes.

### TotalSettingModel (`Model/App/TotalSettingModel`) — global app settings from server
`minPlatePartSize, minPlatePartSizePvc, pvcWasteSize, unitPlateThickness,
unitDoorPvcThickness, unitDoorBetweenSpace, unitGrooveDepth, unitRailThickness(+Title),
drawerFractionFormula, defaultInfo`.

### DatabaseModel / DatabaseResponse (`getDBInfo` payload)
`DatabaseResponse{status,message,data}`. `DatabaseModel{dbVersion, plates[PlateModel],
cabinets[Cabinet], cabinetParts[CabinetPart], cabinetAssets[CabinetAsset],
unitCats[UnitCatsModel], unitParams[UnitParam], unitDefaultPlates[UnitDefaultPlateModel],
totalSetting[TotalSettingModel], assets(String)}`. This is the catalog/reference data
the app downloads to build units.

### PlateModel (`Model/WebService/PlateModel`) — catalog material
`id, cat (cat_id), code, title, type, thickness, size, maxL (max_l), maxW (max_w),
minLW (min_l_w), image1, image2, ord`.

### Cabinet (`Model/Cabinet/Cabinet`) — catalog cabinet template
`id, cat_id, sub_cat_id, title, code, img_1..img_4, img_assemble, door_type,
assemble_type, cover_body, b, f, f1, f2, f3, h, j, k, a1, w1, w2, w3, x, x1, x2, x3,
y, y1, y2, y5, y6, z, z1, z2, z3, z4, z5`. Parametric geometry definition.

### CabinetProjectModel (`Model/Cabinet/CabinetProjectModel`) — placed cabinet instance
Same geometry fields as Cabinet plus `project_id, cabinet_id, description, info,
assemble_detail, door_plate_type, knock_type`. Maps to the `cabinet` table.

### CabinetPart (`Model/Cabinet/CabinetPart`) — template part of a cabinet
`id, cabinet_id, code, title, ref, l, w, q, plate_type, door_type, cover_body,
have_cnc, have_gazor, have_grain, shiar_efect (groove effect), part_info`.

### CabinetSetting (`Model/Cabinet/CabinetSetting`)
`id, projectId, doorPvcThickness, betweenDoorThickness, grooveDepth, bodyPlateId,
mill3PlateId, f16PlateId, f3PlateId, door1PlateId, door2PlateId, door3PlateId, defInfo`.

### UnitParam (`Model/Cabinet/UnitParam`)
`id, unitId, a1, b, f, f1, f2, f3, h, j, k, w1, w2, w3, x, x1, x2, x3, y, y1, y2, y5,
y6, z, z1..z5` — all String formulas/expressions. The parametric formula set that
drives cabinet part sizing.

### UnitCatsModel / UnitDefaultPlateModel / CabinetAsset / CabinetProjectAssets
- `UnitCatsModel{id, parent_id, code, title, cover_body_l_1/l_2/r_1/r_2}` — unit categories.
- `UnitDefaultPlateModel{title, plate_id, plate_type}` — default plate per type.
- `CabinetAsset{id, cabinet_id, title, symbol, unit, count}` — template hardware.
- `CabinetProjectAssets{id, project_id, cabinet_id, title, symbol, unit, count}` — placed hardware (→ `cabinet_asset` table).

### Closet models (`Model/Closet/`)
- `ClosetProject{id, project_id, cat_id, code, title, count, image, door_type,
  door_plate_type, x, y, z, b, d, e, h, tr, zm, zm_type, max_zm}` — a placed closet unit.
- `ClosetCat` — closet category template with many min/max dimension bounds
  (`max_x/y/z/b/h/zm`, `min_*`, `fx_mr_*`, `md_1/2`, `mgl/mgr_*`, `mr/mr_60`, `mkt, mls,
  mp, zm`, …) — parametric closet rules.
- `ClosetDefaultData{id, code, door_type, x, y, z, b, h}` — default closet dims.

### User (`Model/WebService/User`)
`id, name, family, mobile, national_code, avatar, state_id, state_name, credit,
user_token, companies_id, companies_code, companies_title, companies_pf, panel_type,
payment_type, is_part_desc_en, is_survey, notification_count, report_count,
ticket_count, project_expire, project_expire_status, project_step1..step4`.
`companies_pf` drives the plate `is_pf` default; `user_token` is the auth token.

### UserShare (`Model/WebService/UserShare`)
`id, name, family, token` — the recipient user looked up by `getUserInfo`, used to
share/send a cloud project to another user.

### Send/transfer models
- **ProjectSendData** (body for submit/compute/cloud): `user_id, companies_id,
  project_title, emoji, service_type, plates[ProjectPlateSendData],
  cabinets[CabinetProjectSendData], cabinet_setting, cabinet_asset,
  closets[ClosetProjectSendData], closet_default, project_details`.
- **ProjectPlateSendData**: full plate + nested `plate_part[ProjectPlatePartModel]`
  and `plate_piece[ProjectPlatePieceModel]`, plus `is_piece, q_pl, q_pl2, type, code,
  closet_type (closet_plate_type), unit_type (cabinet_plate_type)`.
- **CabinetProjectSendData**: cabinet geometry + `plates[ProjectPlateSendData]` +
  `assets[CabinetProjectAssets]`.
- **ClosetProjectSendData**: closet geometry + `plates[ProjectPlateSendData]`.

### Cloud models (`Model/Cloud/`)
- `CloudProject{id, title, emoji, user_id, user_name, user_family}` — list item.
- `CloudProjectDetail{id, title, emoji, user_id, optimize_done,
  plates[ProjectPlateSendData], cabinets[CabinetProjectSendData], cabinet_setting}`.
- `CloudPlate` / `CloudPlatePart` — cloud-side plate & part (part keys confirm
  `te/re/be/le, g, gr, cnc, ref, app_ref`).

---

## 3. REST API Reference

### Base URLs & clients
| Interface | Base URL | Purpose |
|---|---|---|
| `T3.e` (`T3/d.java`) | `https://kargah.pad-design.ir/api/v2/` | main API |
| `U3.b` (`U3/a.java`) | `https://kargah.pad-design.ir/api/v2/` | cloud projects |
| `V3.c` (`com/padcod/cutclick/Activity/C0306i`) | `https://pad-design.ir/` | optimize |
| `W3.b` (`W3/a.java`) | `https://admin.pad-design.ir/` | file/form generation & export |

All clients add a request header `api_key` (see Auth). 500s timeouts; Gson converter.

### Main API — `T3.e`
Response wrappers: `*Response{status:int, message:String, data:…}`;
`ServerResponse{status, message}`.

| Method | HTTP | Path | Params / Body | Response | Auth |
|---|---|---|---|---|---|
| C | POST (form) | `login` | `mobile`, `token`, `app` | UserResponse | no (identifies by mobile) |
| a | POST (form) | `verify` | `user_id`, `verify` | UserResponse | user_id |
| v | GET | `getUser` | `user_id` | UserResponse | user_id |
| d | GET | `getUserInfo` | `user_id`, `mobile` | UserShareResponse | user_id |
| m | POST (form) | `updateProfile` | `user_id`, `name`, `family`, `state_id`, `companies_code`, `inviter_phone_number` | UserResponse | user_id |
| A | GET | `getProjects` | `user_id`, `status_id`, `page` | SubmittedProjectResponse | user_id |
| B | GET | `getProjectDataJson` | `project_id` | CloudProjectDetailResponse | — |
| q | GET | `getProjectDataDetailsJson` | `user_id`, `project_id` | CloudProjectDetailResponse | user_id |
| F | POST (body) | `importProjectWithPlate` | body `ProjectSendData`; query `server_id`, `perform_type`, `app` | SendProjectResponse | in body (user_id) |
| t | POST (body) | `ComputeProjectPrice` | body `ProjectSendData` | ComputeProjectResponse (`total_price`) | in body |
| j | POST (form) | `calculatePlanPrice` | `user_id`, `plan_day` | CalculatePlanResponse (`total_price`,`discount_price`,`payment_url`) | user_id |
| f | POST | `doneProject` | query `user_id`, `project_id` | ServerResponse | user_id |
| p | POST (form) | `userConfirmProject` | `user_id`, `project_id` | ServerResponse | user_id |
| l | POST (form) | `userCancelProject` | `user_id`, `project_id` | ServerResponse | user_id |
| h | POST | `planUserPayment` | query `user_id`, `project_id`, `unit_submit`(bool), `app` | ServerResponse | user_id |
| r | GET | `getStatusList` | `project_id` | ProjectStatusResponse | — |
| G | GET | `getCompaniesDetails` | `companies_id` | CompanyDetailResponse | — |
| E | GET | `getCompaniesDetailsByCode` | `companies_code` | CompanyDetailResponse | — |
| e | GET | `getFactors` | `user_id`, `page`, `app` | FactorResponse | user_id |
| b | GET | `getPayments` | `user_id`, `page`, `app` | PaymentResponse | user_id |
| c | GET | `getSupportMessage` | `user_id`, `page` | SupportMessageResponse | user_id |
| u | GET | `getSubjects` | — | SupportSubjectResponse | — |
| n | POST (form) | `StoreSupport` | `subject_id`, `user_id`, `title`, `description`, `type` | ServerResponse | user_id |
| o | GET | `getQuestion` | — | VoteResponse | — |
| g | POST (form) | `saveSurvey` | `user_id`, `survey_id`, `survey_option_id` | VoteResponse | user_id |
| k | GET | `getSlider` | `user_id`, `app` | SliderResponse | user_id |
| i | GET | `getAllNotification` | `user_id`, `status`, `page` | NotificationResponse | user_id |
| w | POST (form) | `visitNotification` | `user_id` | ServerResponse | user_id |
| s | GET | `getDBInfo` | `user_id`, `app` | DatabaseResponse (catalog) | user_id |
| x | GET | `getLastUpdateApp` | `user_id`, `app` | AppSettingResponse | user_id |
| y | POST (form) | `generate_form_token` | `user_id` | TokenResponse (`form_token`,`is_image`,`is_pdf`,`is_web`) | user_id |
| D | POST (form) | `saveToken` | `user_id`, `token` (FCM/push) | ServerResponse | user_id |
| z | GET | `getProjectPlan` | `user_id`, `app` | PlanResponse | user_id |

> `app` query param is a constant app identifier (e.g. `"cutclick"`).
> `perform_type` on `importProjectWithPlate` selects create vs update behavior.

### Cloud API — `U3.b`
| Method | HTTP | Path | Params / Body | Response |
|---|---|---|---|---|
| f | GET | `getCloudProjects` | `user_id`, `page`, `offset` | CloudProjectResponse |
| c | GET | `getCloudProjectDetail` | `project_id` | CloudProjectDetailResponse |
| d | POST (body) | `storeCloudProject` | body `ProjectSendData`; query `cloud_id` | CloudStoreResponse |
| e | POST (body) | `storeCloudAllProjects` | body `List<ProjectSendData>` | CloudStoreResponse |
| b | POST (body) | `sendCloudProjectToUser` | body `ProjectSendData`; query `new_user_id`, `name`, `family`, `token` | ServerResponse |
| a | DELETE | `deleteCloudProject` | `project_id` | ServerResponse |

### Optimize API — `V3.c` (base `https://pad-design.ir/`)
| Method | HTTP | Path | Params | Response |
|---|---|---|---|---|
| a | GET | `optimize` | `projectId`, `userId`, `app` | ServerResponse |

### Files / Export API — `W3.b` (base `https://admin.pad-design.ir/`)
Path-param endpoints return `ProjectFormLinkResponse{status,message,data{link}}`.
| Method | HTTP | Path | Params |
|---|---|---|---|
| d | GET | `projectPlatesPartsGenerateFiles/{project_id}/{user_id}/{token}/{type}` | path: project_id, user_id, token, type |
| a | GET | `projectPlatesPartsUserGenerateFiles/{project_id}/{user_id}/{token}/{type}` | path params |
| e | GET | `projectFactorCardexGenerateFiles/{project_id}/{user_id}/{token}/{type}` | path params |
| c | GET | `api/v1/exportFiles` | `user_id`, `project_id`, `form_type`, `app` → ExportFilesResponse (`zip_files`) |
| b | GET | `api/v1/exportAccountCart` | `user_id` → ExportAccountCartResponse (`link`) |

> `token` in the generate-files paths is the `form_token` obtained from
> `generate_form_token`. The app also opens `admin.pad-design.ir/…View/{id}/{user_id}/{form_token}`
> URLs directly (e.g. `projectPlatesPartsView`, `projectFactorCardexView`) and
> `pad-design.ir/multiPay?user_id=…&price=…&app=cutclick` for payment.

### Response model summary (selected)
- `UserResponse{status,message,data:User}`
- `UserShareResponse{…,data:UserShare}` (getUserInfo)
- `SubmittedProjectResponse` → list of `SubmittedProjectModel{id,title,emoji,service_type,
  status_id,status_title,submit_date,company_name,company_code,company_tel,exit_code,
  is_edit,is_edited,optimize_done,edit_title,companies_done_datetime}`
- `ProjectStatusResponse` → `ProjectStatusModel{status_id,status_title,status_type,created_at}`
- `CompanyDetailResponse` → `CompanyDetail{…, images[], machineryList[], prices[], tags[]}`
- `ComputeProjectResponse{data:[ComputeProject{total_price}]}`
- `CalculatePlanResponse{data:CalculatePlan{total_price,discount_price,payment_url}}`
- `SendProjectResponse{data:[SendProject{server_id}]}`
- `TokenResponse{data:TokenModel{form_token,is_image,is_pdf,is_web}}`
- `DatabaseResponse{data:DatabaseModel{…catalog…}}`
- `CloudProjectResponse`/`CloudProjectDetailResponse`/`CloudStoreResponse`

---

## 4. Auth Model

- **Login flow (OTP):**
  1. `POST login` with `mobile`, `token` (device/captcha token), `app`. Backend sends
     an OTP to the mobile and returns a `UserResponse` carrying the `User` (with `id`).
  2. `POST verify` with `user_id` + `verify` (the OTP code). On success returns the
     full `User` including `user_token`.
- **Identity & storage:** the user is identified by numeric **`user_id`** (`User.id`) and
  authenticated session token **`user_token`**. Both are stored in Android
  `SharedPreferences` (default prefs) via `com/padcod/cutclick/Utils/A`:
  - `A.e(ctx,"user_id")` reads the int `user_id`; written with `putInt("user_id", …)`.
  - `user_token` stored/read as a String key `"user_token"`.
  - The FCM/push token is stored separately and uploaded via `saveToken`.
- **Request authorization — `api_key` header:** every outbound request (main, cloud,
  files clients) runs through an OkHttp interceptor (`T3/a.java`) that adds a header
  named **`api_key`** (`R4/D.a()` → `headers.add("api_key", …)`). The value is built
  from an obfuscated hard-coded base64-like constant concatenated with
  `MyKeyboard.getMiddlePart()` and then passed through `Utils.A.h(context, …)` (a
  decode/derive step) — i.e. a client-embedded static API key, not a per-user bearer
  token. Most endpoints do **not** use an Authorization header; per-user scoping is done
  by passing `user_id` (and for file links, the `form_token`) as explicit
  query/field/path parameters.
- **Per-user vs. public:** endpoints marked "user_id" in §3 require a valid `user_id`
  (and implicitly the account it maps to server-side). Catalog/company/status/question
  endpoints are effectively public (only the static `api_key`). File-generation links
  additionally require a short-lived `form_token` from `generate_form_token`.
- **Payments** are handled out-of-app by opening `pad-design.ir` / `admin.pad-design.ir`
  payment URLs with `user_id` and amount in the query string.

---
*Source: decompiled jadx output; DB from `N3/b.java` (Project.db v16); models from
`com/padcod/cutclick/Model/**`; APIs from `T3.e`, `U3.b`, `V3.c`, `W3.b`.*

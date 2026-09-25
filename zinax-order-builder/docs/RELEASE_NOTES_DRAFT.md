# ZINAX Order Builder — Release Notes (Draft)

**⚠️ Internal testing only. This is not a public release note. Do not
distribute this build outside the internal QA group until manual Windows
QA has passed (see `WINDOWS_DESKTOP_MANUAL_QA_CHECKLIST.md`).**

- **Product name:** ZINAX Order Builder
- **Version:** 0.1.0 (desktop app version — pre-release, internal testing)
- **Build commit:** `3bd090f`
- **Platforms:** Web (any modern browser) and Windows desktop (`.msi` / `.exe`, built via Tauri)

## What this app does

ZINAX Order Builder is an order-entry and document-generation tool for
cabinet, MDF, and PVC-membrane door production. It helps a salesperson or
office admin build a door order, then produce:

- **Production CSV** — a spreadsheet-ready export for the factory's
  production/import process
- **Order PDF** — a printable, text-based order sheet for the customer or
  workshop
- **Proforma Invoice PDF** (optional) — an invoice with pricing, discount,
  and VAT, only generated when Invoice Mode is turned on
- **Order Project JSON** — a save file so an in-progress order can be
  reopened and continued later
- **Settings / Customers / Catalog JSON** — export/import files for backing
  up or transferring the company profile, customer list, and the design/
  PVC/MDF-thickness/grain-direction catalog

It also has a Customers page (contact list), a Designs/Catalog page
(managing the design codes, PVC colors, MDF thicknesses, and grain
directions used in orders), and a PDF Templates page (branding, titles,
and which fields show on generated PDFs).

## What this app does not do

- **It is not a CNC/CAM application.** There is no G-code, no DXF, no tool
  database, no machine settings, no ATC/feed-rate/spindle-speed control,
  and no cutting simulation anywhere in it, and none is planned.
- No cloud sync, no login/accounts, no backend server — everything runs
  and stores data locally.
- No automatic update mechanism yet.
- No Arabic/RTL translation yet (the language switch in the top bar is a
  placeholder for a future phase).

## What gets installed (Windows)

The Windows installer places a single desktop application, "ZINAX Order
Builder," that runs entirely offline. It does not install any background
service, driver, or scheduled task.

## Known limitations for this build

- **Unsigned installer** — Windows SmartScreen will likely show a warning
  ("Windows protected your PC") the first time the installer or app runs,
  because it is not yet digitally signed. This is expected for this
  internal build; code-signing is planned before any public release.
- **Placeholder publisher/copyright metadata** — the installer currently
  lists "ZINAX (placeholder — replace before a public release)" as the
  publisher; real company legal details need to replace this.
- **Temporary icon** — the app icon is a simple navy/gold "Z" mark, not a
  final approved logo.
- **No Arabic/RTL support yet** — only English is fully implemented.
- **No backend or cloud login** — this is intentional for this phase, not
  a bug.

## Before this can be released more broadly

1. Complete a full pass of `WINDOWS_DESKTOP_MANUAL_QA_CHECKLIST.md` on a
   real Windows machine and record the results in
   `WINDOWS_DESKTOP_QA_RESULT_TEMPLATE.md`.
2. Replace the placeholder publisher/copyright metadata and temporary icon.
3. Add code-signing to remove the SmartScreen warning.

**Manual QA is required before this build is considered ready for anyone
outside the internal testing group.**

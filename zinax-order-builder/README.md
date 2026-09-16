# ZINAX Order Builder

A web and Windows-desktop order-entry tool for cabinet / MDF / PVC-membrane
door production, built for the Dubai / GCC B2B furniture and cabinet
industry.

This is **not** a CNC/CAM application. It only produces:

1. A real Production CSV export
2. A real, text-based Order PDF
3. An optional, real Proforma Invoice PDF (when Invoice Mode is on)
4. Order Project JSON (save/open an in-progress order)
5. Settings / Customers / Catalog JSON (export/import with merge or replace)

## Stack

- React 19 + Vite + TypeScript
- Tailwind CSS
- `@react-pdf/renderer` for text-based (selectable) PDF export
- Tauri v2 for the Windows desktop edition — same app, same `src/core/`
  business logic, no duplicated code
- `vitest` for unit tests (`src/core/__tests__/`)

## Screens

- **Dashboard** — order stats and a recent orders table
- **New Order Builder** — order header, editable door order table, invoice
  toggle, summary panel, export bar (New Blank Order or Load Sample Order)
- **Order Sheet Preview** — printable, text-based order sheet PDF
- **Proforma Invoice Preview** — printable invoice PDF with totals and
  payment info
- **Customers** — customer list with search and JSON export/import
- **Designs** — design codes, PVC colors, MDF thicknesses, and grain
  directions used by the order table's dropdowns
- **PDF Templates** — titles, show/hide toggles, and branding for the
  generated PDFs
- **Settings** — company profile and defaults, with localStorage persistence

## Architecture

Business logic (schemas, validation, calculations, CSV/PDF/JSON contracts)
lives in `src/core/` and has no browser or Tauri dependencies, so it can be
reused unchanged by both editions. Browser-only code lives in `src/web/`,
and Tauri-only code (native save dialogs, file I/O) lives in `src/desktop/`;
`src/lib/` picks the right one at runtime. See
`docs/REVIEW-REPORT.md` for the full architecture write-up.

## Getting started (web)

```bash
npm install
npm run dev
```

Then open the printed local URL in your browser.

## Getting started (Windows desktop)

```bash
npm install
npm run desktop:dev     # runs the app in a Tauri window during development
npm run desktop:build   # produces a release .msi/.exe (or .deb/.rpm/.AppImage on Linux)
```

A GitHub Actions workflow (`.github/workflows/zinax-order-builder-windows.yml`)
builds the Windows `.msi`/`.exe` on every push to this branch. See
`docs/WINDOWS_DESKTOP_MANUAL_QA_CHECKLIST.md` before treating a build as
release-ready.

## Checks

```bash
npm run build
npm run lint
npx tsc --noEmit
npm run test
```

## Notes

- The UI is desktop-first but adapts down to tablet widths.
- The language selector toggles a label only; full Arabic/RTL localization
  is left for a future iteration.
- The Windows desktop build is currently an unsigned, internal test build —
  see `docs/RELEASE_NOTES_DRAFT.md` for known limitations before wider use.

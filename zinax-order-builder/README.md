# ZINAX Order Builder — UI Prototype

A high-fidelity, interactive UI prototype for a web-based order creation tool for
cabinet / MDF / PVC membrane door production, built for the Dubai / GCC B2B
furniture and cabinet industry.

This is **not** a CNC/CAM application. It only produces:

1. A production CSV (mock export)
2. A complete Order PDF (in-browser preview)
3. An optional Proforma Invoice PDF (in-browser preview)

## Stack

- React 19 + Vite
- Tailwind CSS
- lucide-react icons
- Mock data only — no backend, no database, no real file generation

## Screens

- **Dashboard** — order stats and a recent orders table
- **New Order Builder** — order header, editable door order table, invoice
  toggle, summary panel, sticky export bar
- **Order Sheet Preview** — A4-landscape-style printable order sheet
- **Proforma Invoice Preview** — printable invoice with totals and payment info
- Placeholder screens for Customers, Products / Designs, PDF Templates and
  Settings

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL in your browser.

## Notes

- All Export / Save / Print buttons are mocked and only show a confirmation
  toast — no files are actually generated.
- The UI is desktop-first but adapts down to tablet widths.
- The language selector toggles a label only; full Arabic/RTL localization is
  left for a future iteration.

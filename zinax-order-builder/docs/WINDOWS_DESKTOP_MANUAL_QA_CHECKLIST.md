# ZINAX Order Builder — Windows Desktop Manual QA Checklist

Run this checklist against a real Windows machine, using the `.msi` or `.exe`
artifact produced by the `zinax-order-builder-windows.yml` GitHub Actions
workflow (or a local `npm run desktop:build` on Windows). This app is an
order-management tool for cabinet/MDF/PVC-membrane door production — it has
no CNC/CAM features, and none should be added while testing.

Tick every box before signing off a release candidate. If any item fails,
note the exact step, what you expected, and what happened, then file it
before shipping.

## Install & launch

- [ ] 1. Install the app from the `.msi` (or `.exe`) installer.
- [ ] 2. Launch the app from the Start Menu / desktop shortcut.
- [ ] 3. Confirm the app name is **"ZINAX Order Builder"** in the window
      title bar, the taskbar, and Start Menu, and the icon shown everywhere
      is the navy/gold "Z" mark (not a default Tauri icon).

## Core order flow

- [ ] 4. Click **New Blank Order** — confirm it starts empty with a fresh
      order number and Settings-derived currency/salesperson/payment terms.
- [ ] 5. Go to **Customers**, add a customer, and confirm it appears in the
      Order Header's customer dropdown when selected into a new order.
- [ ] 6. Go to **Designs**, add a design code and a PVC color, and confirm
      both appear in the Door Order Table's dropdowns.
- [ ] 7. Add at least one order row using the new design/PVC codes.

## Export flows — each must open a native Windows save dialog

For every export below: confirm a native **"Save As"** dialog opens (not a
silent write), you can choose the destination folder and file name, and the
file appears exactly there after saving.

- [ ] 8. **Export Production CSV** — save it, then open it in Excel and
      verify the columns match the production schema (design code, width,
      height, qty, MDF thickness, PVC code, grain, etc.) with **no**
      invoice-only columns (unit price, discount, VAT) present, regardless
      of whether Invoice Mode is on or off.
- [ ] 9. **Export Order PDF** — save it, open the PDF, and verify the text
      is selectable/searchable (not a flattened image).
- [ ] 10. Enable **Proforma Invoice** mode, add prices/discount/VAT on at
      least one row, and confirm the invoice number is generated once and
      totals shown on screen are correct.
- [ ] 11. **Export Proforma Invoice PDF** — save it, open it, and verify
      the text is selectable and the totals in the PDF match the on-screen
      totals.
- [ ] 12. **Save Order (.json)** — save it to a known folder.
- [ ] 13. **Export Settings JSON**, **Export Customers JSON**, and
      **Export Catalog JSON** from their respective pages — each should
      open its own save dialog.

## Restart & persistence

- [ ] 14. Close the app completely.
- [ ] 15. Reopen the app.
- [ ] 16. Confirm Settings (company profile, defaults), Customers, and the
      Designs/PVC/MDF/Grain catalog all persisted exactly as left.

## Open / import flows

- [ ] 17. From **New Order**, click **Open Order (.json)** and pick the file
      saved in step 12 — confirm the order (header + rows + invoice state)
      is restored correctly.
- [ ] 18. Import the Settings/Customers/Catalog JSON files saved in step 13
      back in (Merge or Replace) and confirm the data reflects the import.

## Cancel & error handling

- [ ] 19. Trigger any export (e.g. Export Production CSV) and click
      **Cancel** in the save dialog — confirm **no file is created** and no
      "downloaded"/"saved" success toast appears (a neutral or no toast is
      fine; a false success message is not).
- [ ] 20. Try importing a corrupted or unrelated JSON file into
      Settings/Customers/Catalog/Order-open — confirm a clear **error**
      toast appears and nothing is silently accepted.

## Offline / standalone

- [ ] 21. Disconnect from the internet (or block the app in the firewall)
      and confirm every flow above still works — the app must never require
      a backend or network connection.
- [ ] 22. Confirm nothing in the app touches CNC/CAM features — no G-code,
      DXF, tool database, machine settings, or simulation anywhere in the
      UI. The only outputs are Production CSV, Order PDF, Proforma Invoice
      PDF, and Order/Settings/Customers/Catalog JSON.

---

*Sign-off:* tester name, Windows build/version, app version, and date once
all boxes are checked.

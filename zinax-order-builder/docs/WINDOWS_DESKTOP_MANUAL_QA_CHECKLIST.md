# ZINAX Order Builder — Windows Desktop Manual QA Checklist

**Who this is for:** anyone testing the app on a real Windows PC, developer
or not. No coding knowledge is needed — just follow each step in order and
tick it off. If a step doesn't do what it says it should, stop, write down
exactly what happened (a screenshot helps a lot), and record it in
`WINDOWS_DESKTOP_QA_RESULT_TEMPLATE.md` under "Bugs found." Don't try to fix
anything yourself — that's not your job here.

**What this app is:** an order-entry tool for a door factory (cabinet doors,
MDF, PVC-membrane doors). It produces four kinds of files: a Production CSV,
an Order PDF, an optional Proforma Invoice PDF, and Order/Settings/Customers/
Catalog JSON files. **It does not control any machine** — there is no
G-code, no CNC, no tool database, and nothing here should ever ask you to
connect to a CNC machine or import a machine program.

**Where to get the installer:** download the `.msi` file from the Windows
build (GitHub Actions run for `zinax-order-builder-windows.yml`, artifact
named `zinax-order-builder-windows-msi`). If the `.msi` fails to install for
any reason, download the `zinax-order-builder-windows-exe` artifact instead
and use that installer — it does the same thing through a different
installer technology (NSIS instead of MSI).

Work through the steps in order. Tick every box before signing off.

---

## Part 1 — Install and first launch

- [ ] **1. Install from the MSI.** Double-click the downloaded `.msi` file
      and follow the installer prompts (Next → Install → Finish).
      - [ ] If it fails or Windows blocks it, try step 2 instead.
- [ ] **2. Install from the EXE (only if step 1 failed).** Double-click the
      downloaded `.exe` installer instead and follow its prompts.
- [ ] **3. Launch the app** from the Start Menu (search "ZINAX") or the
      desktop shortcut, if one was created.
- [ ] **4. Confirm the app name.** The window title bar, the Windows
      taskbar, and the Start Menu entry should all say
      **"ZINAX Order Builder"** — not "app", "Tauri", or anything else.
- [ ] **5. Confirm the app icon.** Everywhere the app shows an icon (taskbar,
      Start Menu, desktop shortcut, window title bar) it should be the
      **navy-blue square with a gold "Z"** — not a default/generic icon.
- [ ] **6. Confirm the window size.** The window should open at a
      comfortable desktop size (around 1440×900 pixels — roughly 3/4 of a
      1080p screen) and should **not** let you shrink it below a usable
      minimum (around 1200×760) — try dragging a corner smaller and confirm
      it stops shrinking at some point rather than becoming unreadably tiny.

## Part 2 — Build a real order

- [ ] **7. Create a New Blank Order.** In the app, go to **New Order** and
      click **"New Blank Order."** It should start completely empty — no
      pre-filled sample rows — with a fresh order number.
- [ ] **8. Add a customer.** Go to **Customers**, click **"Add Customer,"**
      fill in a name/phone/email, and save.
- [ ] **9. Add a design code.** Go to **Designs**, add a new design code
      (any name/code is fine for testing).
- [ ] **10. Add a PVC color.** On the same Designs page, add a new PVC
      color entry.
- [ ] **11. Create an order row.** Go back to **New Order**, add a row to
      the door table, and pick the design code and PVC color you just
      created from the dropdowns (confirming they show up there).

## Part 3 — Export files (each should open a Windows "Save As" dialog)

For every export in this section: a normal Windows **Save As** window
should pop up, letting you pick a folder and a file name before anything is
written to disk. If a file appears somewhere without that dialog ever
showing up, that is a bug — write it down.

- [ ] **12. Export Production CSV** and save it somewhere you'll remember
      (e.g. the Desktop).
- [ ] **13. Open that CSV in Excel** (double-click it, or File → Open from
      inside Excel).
- [ ] **14. Confirm the CSV columns and text.** Check that the columns
      match the order you built (design code, width, height, quantity, MDF
      thickness, PVC code, etc.), that there are **no pricing/invoice
      columns** in it, and that any special characters (customer names with
      accents, Arabic text if you typed any, etc.) display correctly rather
      than as garbled symbols — this confirms the file is proper UTF-8 text.
- [ ] **15. Export Order PDF** and save it.
- [ ] **16. Open the PDF and confirm the text is selectable.** Open it in
      any PDF viewer, try to click-and-drag to select some of the text (like
      the customer name or a design code), and copy it. If you can't select
      any text at all — if the whole page behaves like one big picture —
      that's a bug.
- [ ] **17. Enable Proforma Invoice.** Back in the app, turn on the
      "Proforma Invoice" switch for this order.
- [ ] **18. Add prices.** Fill in a unit price, a discount, and a VAT
      percentage on at least one row, and confirm the totals shown on
      screen look correct (add them up yourself if unsure).
- [ ] **19. Export Proforma Invoice PDF**, save it, and open it — confirm
      it also has selectable text and the totals match what you saw on
      screen.
- [ ] **20. Save Order JSON.** Click "Save Order (.json)" and save it
      somewhere you'll remember.

## Part 4 — Restart and persistence

- [ ] **21. Close the app completely** (not just minimize — actually close
      the window, or right-click the taskbar icon and choose Close/Exit).
- [ ] **22. Reopen the app.**
- [ ] **23. Confirm Settings/Customers/Catalog persisted.** Go to Settings,
      Customers, and Designs — the customer, design code, and PVC color you
      added in Part 2 should all still be there, exactly as you left them.

## Part 5 — Opening files back up

- [ ] **24. Open the saved Order JSON.** From **New Order**, click
      "Open Order (.json)" and pick the file you saved in step 20 — confirm
      the order (header, rows, invoice prices) comes back exactly as it was.

## Part 6 — Cancel and safety checks

- [ ] **25. Cancel a Save dialog.** Start any export (e.g. Export
      Production CSV) and when the Save As window appears, click
      **Cancel** instead of Save. Confirm: no file was created anywhere,
      and the app does not claim it succeeded (no false "downloaded" or
      "saved" message — a quiet result or a neutral message is fine).

## Part 7 — Offline check

- [ ] **26. Test without internet.** Turn off Wi-Fi (or unplug the network
      cable), then repeat a few of the steps above — creating an order,
      exporting a CSV or PDF. Everything should keep working exactly the
      same, since this app never needs an internet connection.

## Part 8 — Uninstall and reinstall

- [ ] **27. Uninstall the app.** Go to Windows Settings → Apps → find
      "ZINAX Order Builder" → Uninstall.
- [ ] **28. Reinstall the app** using the same installer from Part 1.
- [ ] **29. Confirm behavior after reinstall.** Launch the app again — note
      whether your old Settings/Customers/Catalog data is still there or
      came back empty (either is worth noting, but write down which one you
      saw).

## Part 9 — SmartScreen warning

- [ ] **30. Note any SmartScreen warning.** If Windows shows a blue
      "Windows protected your PC" screen when you first run the installer
      or the app (because it isn't digitally signed yet), write down that
      you saw it — this is expected for now and not a bug, but it must be
      recorded so we know to add code-signing before a public release. If
      you don't see it at all, note that too.

---

*Sign-off:* once every box above is checked, fill in
`WINDOWS_DESKTOP_QA_RESULT_TEMPLATE.md` with your name, Windows version,
laptop model, and the date, and attach any screenshots of problems you hit.

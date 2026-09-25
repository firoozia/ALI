# ZINAX Order Builder — Windows Desktop QA Result

Fill this in after running through `WINDOWS_DESKTOP_MANUAL_QA_CHECKLIST.md`
on a real Windows machine. Copy this file, rename it with the date (e.g.
`2026-09-20-qa-result.md`), and fill in every field — "N/A" is fine if a
field genuinely doesn't apply, but don't leave anything blank.

## Tester & machine

- **Tester name:**
- **Date:**
- **Windows version:** (e.g. Windows 11 23H2, Windows 10 22H2 — check
  Settings → System → About)
- **Laptop / PC model:**
- **Installed MSI or EXE:** (MSI / EXE)
- **Installer filename:** (the exact `.msi` or `.exe` file name you ran)

## SmartScreen & install

- **SmartScreen warning shown:** (yes / no)
- **Install success:** (yes / no — note the error message if no)
- **App launch success:** (yes / no)

## Core flows

- **CSV export success:** (yes / no)
- **Order PDF export success:** (yes / no)
- **Invoice PDF export success:** (yes / no)
- **JSON save/open success:** (yes / no)

## Persistence

- **Settings persistence (after app restart):** (yes / no)
- **Customers persistence (after app restart):** (yes / no)
- **Catalog persistence (after app restart):** (yes / no)

## Other

- **Offline mode success:** (yes / no — did everything still work with no
  internet connection?)

## Bugs found

List each bug as: what you did → what you expected → what actually
happened. Number them if there's more than one.

1.

## Screenshots attached

List the file names of any screenshots you're attaching (e.g. of an error
message, a broken layout, or the SmartScreen warning).

-

## Final tester verdict

(Pick one and briefly say why)

- [ ] **Pass** — ready for wider testing/release
- [ ] **Pass with minor issues** — usable, but the bugs above should be
      fixed first if possible
- [ ] **Fail** — a blocking bug prevents normal use; do not release until
      fixed

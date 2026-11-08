# Changelog

Each released version's source code is kept in `versions\v<version>\`.
To make a new version: `.\release.ps1 1.2.0` (in PowerShell, in the MSCC folder), then run `start.bat`.
Numbering: PATCH 1.1.x = bug fix · MINOR 1.x.0 = new feature · MAJOR x.0.0 = data/format change.

## v1.1.1 - 2026-11-08
- The version label (top bar and sign-in screen) now links to https://github.com/ayosif2.
  The MSCC logo still links to the company website.

## v1.1.0 - 2026-11-08

### Edit locking (replaces "last save wins")
- Only one editor window can change a project at a time. Anyone else opening it gets a **read-only** view
  with "🔒 X is editing this project (since …)" — they can still view and export.
- The same user's second browser tab is read-only too.
- An abandoned lock (closed browser, crash, lost network) frees itself after **2 minutes**.
- The server refuses draft saves, submits and detail edits from anyone not holding the lock.
- Admin **Take over**: takes the lock, keeps the draft. The previous editor switches to read-only.
- Admin **Discard draft** (replaces "Force unlock"): deletes the draft and frees the lock, after a
  "cannot be undone" confirmation. Whoever had it open is told their draft was discarded.
- Opening a project no longer autosaves until something is actually changed.
- Fixed: the "draft — name" badge showed "undefined" and the open-draft warning never appeared.
- The project list shows "🔒 editing: name".

### Custom per-item factors
- New **ƒ Factor** button on each item: gives that one item its own brand factor and local factor
  (pre-filled with the current values). **✕ Factor** cancels it — the item goes back to the project factors.
- On a subsystem, **ƒ Factors** opens a brand + local factor on each of that subsystem's own items;
  **✕ Factors** cancels them all. New items added to it while open get the factors too.
- Items without a custom factor keep the original formula: GLP × brand factor + Local × local factor.
  Changing a project factor never changes items with a custom factor.
- Effective (total) factor per brand from the reverse calculation
  Σ(GLP × qty × factor) = GLP_total × Factor_total, shown as "effective ×…" next to each brand
  and in the Brand summary (★ = includes custom item factors). Same for Local.
- **Detailed Quotation** (PDF + CSV): each line shows the factors it was priced with (custom in blue with ★),
  and the Brand summary uses the effective factors.
- **Excel**: rows with a custom factor get their unit value written as a fixed number (the GLP grid still shows
  true list prices); all other rows keep the template formula.
- Fixed: Brand summary "After factor" (editor and Detailed PDF) was in USD without rounding although
  labelled in the project currency.
- Older revisions have no custom factors, so their totals and exports are unchanged.

### Other
- Fixed: cancelling a manual row number ("↺ auto") did nothing. Typing the automatic number, or clearing
  the box, now also means "no manual number". Merged rows drop any manual number.
- The version number is shown in the top bar and on the sign-in screen.
- Old copies of the source moved to `versions\_archive_before_1.0.0\`.

### Upgrading from v1.0.0
1. Close the "MSCC Server" and "MSCC Tunnel" windows.
2. Copy the whole MSCC folder somewhere safe first (rollback = put that copy back).
3. Run `start.bat`. The database gets one new table (`edit_locks`) automatically; no data is changed.

## v1.0.0 - 2026-11-08
- Baseline: the system as it was on 2026-11-08 (login tokens and hashed passwords, roles, projects,
  revisions, drafts, price list with subsystems, PDF/CSV/Excel exports, backups).

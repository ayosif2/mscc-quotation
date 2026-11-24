# Changelog

Each released version's source code is kept in `versions\v<version>\`.
To make a new version: `.\release.ps1 1.2.0` (in PowerShell, in the MSCC folder), then run `start.bat`.
Numbering: PATCH 1.1.x = bug fix · MINOR 1.x.0 = new feature · MAJOR x.0.0 = data/format change.

## v2.1.2 - 2026-11-24
- **Quotation with P/N** export now has the same **Select template** list as the normal Quotation (it always
  used the default template before). The internal-use warning stays.

## v2.1.1 - 2026-11-17
- **Row number (#) box selects its text** when it opens (also after Enter moves to the next row), so typing
  replaces the number straight away.

## v2.1.0 - 2026-11-17
- **Search by brand** in the project editor's "+ From price list" search (for project lines and for items
  inside a subsystem): a brand list next to the search box, A–Z with item counts. **All brands** (the default)
  is the search exactly as before. Picking a brand lists that brand's items at once, and the text then
  searches only within that brand (up to 50 results). A price-list subsystem counts for a brand if any item
  in it — or its display brand — is that brand. The brand stays selected while the editor is open.
- **Row number (#) editing**: Enter saves the number and moves to the next row's number, Shift+Enter to the
  previous one — the same as Qty. Enter on the last row closes the box.

## v2.0.1 - 2026-11-17
- **Brand factors for subsystem items**: a brand used only by items inside a subsystem now gets its own
  field in *Brand factors for this project* (before, only brands of top-level rows were listed, so those
  items could not have their brand factor changed, and they did not get the default factor from Settings).
  Note: brand factors multiply the GLP price only; items priced with a Local price use the Local factor.

## v2.0.0 - 2026-11-16
The app moves online: it runs on **Cloudflare Workers + D1** at **https://mscc.dpdns.org** (free plan), no longer
depending on the office PC and the tunnel. The PC version stays as a fallback with the same code.
- **Clear error messages**: when the server refuses something, the app now says why — e.g. *Password was not
  changed. Only the superadmin can create or change admin accounts…* — instead of always saying
  "Could not reach the server". That message now appears only when the server really can't be reached.
- **Frontend split into modules** (no behaviour change): `SRC/app.jsx` (about 4,000 lines) is now
  `app.jsx` + `lib/` (api, constants, quote maths) + `exports/` (PDF, Excel) + `ui/` (one file per tab and the editor).
- **Removed old code**: the browser-only demo mode (no server), the one-shot backup / restore routes
  (the app has used the paged ones since v1.4.0 — the old routes now answer "use the paged backup") and
  `migrate.js` (one-time JSON → SQLite migration from before v1.0.0).
- Kept on purpose: the PC server still accepts old-format (scrypt) passwords, so the fallback works for everyone.
  On Cloudflare, accounts that never signed in on v1.4.0 need a new password from an admin.
- PC server: `MSCC_DIST` environment variable to serve another build (for testing).

## v1.4.0 - 2026-11-15
Phase 2 of the Cloudflare Workers plan: a Workers + D1 version of the server, tested locally on a copy of the
real data. The PC version keeps running as before — see `worker/README.md` for the switch-over (phase 3).
- **New `worker/` project**: every `/api` route ported to Cloudflare Workers + D1 (same website, same JSON,
  same roles, edit locks and price-list caching), plus scripts to export the PC database and import it into D1.
- **Passwords are upgraded on sign-in** (scrypt → PBKDF2, the format the Workers version can check within its
  CPU budget). User Management shows **needs sign-in** next to users not yet upgraded.
- **Backup / restore now go in pages** (table by table) on both versions. The backup file format is unchanged,
  old backup files still restore, and a restore now asks for confirmation first and shows progress.
- Fixed: **deleting a project left its revisions and draft behind** — the tables made by the old `migrate.js`
  had no link to `projects`, so "cascade" never ran. Deletes now remove them explicitly. (40 revisions and 17
  drafts of earlier-deleted projects are still in the PC database; they are invisible in the app and are not
  copied to Cloudflare.)
- Settings → Usage shows where usage is on Cloudflare when running there.

## v1.3.0 - 2026-11-11
Phase 1 of the Cloudflare Workers plan: make the app light enough for the free tier — and faster today.
- **Projects list is a short summary**: revision codes and the draft owner only. A project's full contents
  load when you open, view or duplicate it. Measured on the real data: 8.4 MB → 290 KB (55 KB on the wire).
- **Compression**: server responses and the website's JavaScript are gzipped (website JS 1.4 MB → 387 KB),
  and the JS is cached by the browser until the next version.
- **Price list is cached**: after the first load the browser only checks whether it changed
  (0.3 KB instead of ~250 KB) and reloads it only after a price-list edit.
- **Database indexes** on revisions and usernames (each project's revisions used to scan the whole table).
- **Connection badge** uses a tiny check every 60 s instead of re-downloading all settings every 20 s.
- **Usage counter**: Settings → **Usage** shows server requests per day (UTC), data sent and average time,
  and the busiest requests, compared with the Workers free limit of 100,000 requests/day.
- Upgrading: run `start.bat`. The indexes and the usage table are added automatically; no data changes.

## v1.2.1 - 2026-11-09
- Fixed: **Duplicate** failed with "Could not reach the server — duplicate was created but its content could
  not be saved" (since v1.1.0, the server only accepts draft saves from the holder of the edit lock, and
  Duplicate saved without one). Duplicate now takes a short lock while it creates and fills the copy, then
  releases it before the editor opens.
- Duplicates left behind by the bug are empty projects named "… (Copy)" — an admin can delete them.

## v1.2.0 - 2026-11-08
- Settings → Templates: new checkbox **Include the Terms & Conditions page** on each template.
  Unticked = the Quotation and Quotation with P/N PDFs that use that template leave out the T&C page
  (the cover's "Pages N" counts one less). The T&C text is kept, just not printed.
  Existing templates stay ticked, so nothing changes until you untick one. Cloning a template copies the setting.
- Quotation with P/N now uses the **default** template (it has no template picker); before, it always used
  the first template in the list.

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

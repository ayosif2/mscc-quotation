# MSCC Quotation System on Cloudflare Workers

The same website as the PC version (`../dist`), with the server (`../server.js`) ported to
Cloudflare Workers and its SQLite database moved to Cloudflare D1. Designed for the **free plan**:
100,000 requests/day, 10 ms CPU per request, D1 5 M rows read and 100 k rows written per day.

| File | What it is |
|---|---|
| `src/index.js` | All `/api` routes (same JSON as the PC server) |
| `src/auth.js` | Passwords (PBKDF2, 30,000 rounds) and sign-in tokens, via Web Crypto |
| `migrations/0001_init.sql` | D1 tables and indexes |
| `scripts/export-d1.cjs` | PC database → `data/import-NNN.sql` (~1 MB files, statements < 100 KB) |
| `scripts/import-d1.cjs` | Loads those files into D1 (`--local` or `--remote`) |
| `wrangler.jsonc` | Worker + website + D1 binding |

`data/`, `.wrangler/` (local database) and `node_modules/` contain your data or are generated — they are
git-ignored. Delete `data/` after an import.

## Try it on this PC (no Cloudflare account needed)

```bat
cd worker
npm install
npm run build:site          :: builds ../dist
npm run db:init:local       :: creates the tables in a local D1
npm run db:export           :: reads ../mscc_data.db (read-only, safe while the PC server runs)
npm run db:import:local
npm run dev                 :: http://127.0.0.1:8787
```

## Phase 3 — go live (switch-over day)

**Before:** every user signs in once on the PC version (v1.4.0+). That upgrades their password to the
format the Worker can check. User Management shows **needs sign-in** for anyone who hasn't; an admin can set
them a new password instead. On Cloudflare those users get "Your password needs to be reset by an admin".

1. `npx wrangler login` (opens the browser — your Cloudflare account)
2. `npx wrangler d1 create mscc --location eeur` → paste the printed `database_id` into `wrangler.jsonc`
3. `npx wrangler d1 migrations apply DB --remote`
4. Stop using the PC version (or tell everyone), then: `npm run db:export` and `npm run db:import:remote`
5. `npm run build:site` and `npm run deploy`
6. Cloudflare dashboard → Workers & Pages → **mscc-quotation** → Settings → Domains & Routes → add your domain
   (e.g. `quote.yourdomain.com`). If the named tunnel uses that hostname, move the tunnel to another name first.
7. Sign in on the new address and check a few projects. Delete `data/`.

Keep the PC version as the fallback: it still has the same data up to the switch-over moment.

## Differences from the PC version

- Old-format (scrypt) passwords can't sign in — see above.
- Backups and restores always go in pages (the app does this automatically since v1.4.0).
- **Settings → Usage** points to the Cloudflare dashboard (Workers metrics: requests, CPU time;
  D1 metrics: rows read/written) instead of counting requests itself.
- Failed sign-ins are counted in the `auth_fails` table (a Worker keeps no memory between requests).
- Revisions and drafts of deleted projects ("orphans" left by older PC versions) are not exported.

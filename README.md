# MSCC Quotation System

Internal web app for building priced quotations (fire alarm, security, AV and similar systems)
from a shared price list, with revisions, drafts and PDF / CSV / Excel exports.

- **Backend:** Node.js + Express + SQLite (`better-sqlite3`) — [`server.js`](server.js)
- **Frontend:** React 18 + Vite — [`SRC/app.jsx`](SRC/app.jsx)
- **Roles:** pre-sales (own / shared projects), admin, superadmin

## Run

Requires [Node.js](https://nodejs.org).

```bat
start.bat
```

`start.bat` installs dependencies on first run, builds the frontend, starts the server on
http://localhost:3001 and (if `cloudflared.exe` is present) opens a public tunnel.
On the very first start the server creates a superadmin account and writes its password to
`FIRST_RUN_ADMIN.txt` — sign in, change the password, then delete that file.

Development: `npm run server` (backend) and `npm run dev` (frontend with hot reload).

## Data

The database (`mscc_data.db`) is created next to `server.js` and is **not** part of this repository.
Back it up from the app (Settings → ⬇ Export backup) or by copying the `.db` files while the server is stopped.

## Versions

See [CHANGELOG.md](CHANGELOG.md). Each release is tagged (`v1.0.0`, `v1.1.0`, …).
To release locally: `.\release.ps1 1.2.0`.

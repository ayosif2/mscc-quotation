// ─── MSCC Quotation System — Backend Server (SQLite) ─────────────────────────
// Requirements: npm install express cors better-sqlite3
// Run: node server.js

const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const os       = require("os");
const fs       = require("fs");
const crypto   = require("crypto");
const Database = require("better-sqlite3");
const { MIN_PASSWORD, hashPassword, verifyPassword, isHashed, signToken, verifyToken } = require("./auth-utils");

const app      = express();
const PORT     = process.env.PORT || 3001;
const DB_PATH  = process.env.MSCC_DB || path.join(__dirname, "mscc_data.db");
const BUILD    = path.join(__dirname, "dist");
const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // sessions last 7 days

app.disable("x-powered-by");
app.use(cors());
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  next();
});
// NOTE: the JSON body parser is mounted further down, *after* the auth check,
// so unauthenticated callers can never make the server parse a 50 MB body.
if (fs.existsSync(BUILD)) app.use(express.static(BUILD));

// ─── Database setup ───────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL UNIQUE,
    displayName TEXT,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'presales',
    active      INTEGER NOT NULL DEFAULT 1,
    createdAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS price_list (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL DEFAULT 'item',
    description TEXT,
    modelNo     TEXT,
    brand       TEXT,
    glp         REAL NOT NULL DEFAULT 0,
    local       REAL NOT NULL DEFAULT 0,
    notes       TEXT,
    children    TEXT NOT NULL DEFAULT '[]',
    partNumber  TEXT,
    sortOrder   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    projectName TEXT,
    client      TEXT,
    engineerName TEXT,
    refNumber   TEXT,
    systemType  TEXT,
    ownedBy     TEXT,
    grantedTo   TEXT NOT NULL DEFAULT '[]',
    status      TEXT NOT NULL DEFAULT 'draft',
    createdAt   TEXT NOT NULL,
    updatedAt   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS revisions (
    id             TEXT PRIMARY KEY,
    projectId      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revIndex       INTEGER NOT NULL,
    projectName    TEXT,
    client         TEXT,
    engineerName   TEXT,
    salesEngineer  TEXT,
    contactName    TEXT,
    contactPhone   TEXT,
    contactEmail   TEXT,
    refNumber      TEXT,
    systemType     TEXT,
    date           TEXT,
    currency       TEXT,
    conversionRate REAL,
    brandFactors   TEXT NOT NULL DEFAULT '{}',
    localFactor    REAL,
    lines          TEXT NOT NULL DEFAULT '[]',
    tcEnabled      INTEGER NOT NULL DEFAULT 0,
    tcMode         TEXT,
    tcValue        REAL,
    tcPercent      REAL,
    tcApprox       REAL,
    tcBaseUSD      REAL,
    installEnabled INTEGER NOT NULL DEFAULT 0,
    installValue   REAL,
    extras         TEXT NOT NULL DEFAULT '[]',
    notes          TEXT,
    roundUp        INTEGER NOT NULL DEFAULT 0,
    code           TEXT,
    grandTotal     REAL,
    gtAfterDiscount        TEXT,
    gtAfterDiscountEnabled INTEGER NOT NULL DEFAULT 0,
    createdAt      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS drafts (
    projectId TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    data      TEXT NOT NULL,
    savedBy   TEXT,
    savedAt   TEXT NOT NULL
  );
`);

// ─── Migration: add columns if upgrading from an older DB file ────────────────
function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn("price_list", "type", "type TEXT NOT NULL DEFAULT 'item'");
ensureColumn("price_list", "children", "children TEXT NOT NULL DEFAULT '[]'");
ensureColumn("price_list", "partNumber", "partNumber TEXT");
ensureColumn("revisions", "gtAfterDiscount", "gtAfterDiscount TEXT");
ensureColumn("revisions", "gtAfterDiscountEnabled", "gtAfterDiscountEnabled INTEGER NOT NULL DEFAULT 0");

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-4);
const now = () => new Date().toISOString();
const j   = v => JSON.stringify(v ?? null);
const p   = v => { try { return JSON.parse(v); } catch { return v; } };

const getLanIP = () => {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === "IPv4" && !net.internal) return net.address;
  return "localhost";
};

function hydrateRev(row) {
  if (!row) return null;
  return {
    ...row,
    brandFactors:  p(row.brandFactors),
    lines:         p(row.lines),
    extras:        p(row.extras),
    tcEnabled:     !!row.tcEnabled,
    installEnabled:!!row.installEnabled,
    roundUp:       !!row.roundUp,
    gtAfterDiscountEnabled: !!row.gtAfterDiscountEnabled,
  };
}

function hydrateProject(row) {
  if (!row) return null;
  const revRows = db.prepare(
    "SELECT * FROM revisions WHERE projectId=? ORDER BY revIndex ASC"
  ).all(row.id);
  const draftRow = db.prepare("SELECT * FROM drafts WHERE projectId=?").get(row.id);
  return {
    ...row,
    grantedTo: p(row.grantedTo) || [],
    revisions: revRows.map(hydrateRev),
    draft: draftRow ? { ...draftRow, data: p(draftRow.data) } : null,
  };
}

// Hydrate a price_list row: parse children JSON, drop type-irrelevant fields for clarity
function hydratePLItem(row) {
  if (!row) return null;
  const children = p(row.children) || [];
  if (row.type === "subsystem") {
    return { id: row.id, type: "subsystem", description: row.description, brand: row.brand, partNumber: row.partNumber || "", children, sortOrder: row.sortOrder };
  }
  return { id: row.id, type: "item", description: row.description, modelNo: row.modelNo, brand: row.brand, glp: row.glp, local: row.local, notes: row.notes, sortOrder: row.sortOrder };
}

// Normalize an incoming price-list item (from the client) into DB column values
function normalizePLItem(item, sortOrder) {
  const isSS = item.type === "subsystem";
  return {
    id:          item.id || uid(),
    type:        isSS ? "subsystem" : "item",
    description: item.description || "",
    modelNo:     isSS ? "" : (item.modelNo || ""),
    brand:       item.brand || "",
    glp:         isSS ? 0 : (item.glp || 0),
    local:       isSS ? 0 : (item.local || 0),
    notes:       isSS ? "" : (item.notes || ""),
    children:    j(isSS ? (item.children || []) : []),
    partNumber:  isSS ? (item.partNumber || "") : null,
    sortOrder:   sortOrder,
  };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS auth_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);

// Token-signing secret: generated once, lives inside the DB file (never sent to clients).
const TOKEN_SECRET = (() => {
  const r = db.prepare("SELECT value FROM auth_meta WHERE key='token_secret'").get();
  if (r) return r.value;
  const s = crypto.randomBytes(48).toString("hex");
  db.prepare("INSERT INTO auth_meta(key,value) VALUES('token_secret',?)").run(s);
  return s;
})();

// One-time migration: turn any plain-text passwords into salted hashes.
(() => {
  const plain = db.prepare("SELECT id, password FROM users").all().filter(u => !isHashed(u.password));
  if (!plain.length) return;
  const upd = db.prepare("UPDATE users SET password=? WHERE id=?");
  db.transaction(() => { for (const u of plain) upd.run(hashPassword(u.password || crypto.randomBytes(12).toString("hex")), u.id); })();
  console.log(`  [auth] Converted ${plain.length} plain-text password(s) to secure hashes.`);
})();

// The old hardcoded "admin1" login lived in the public JavaScript, so it can no longer be trusted.
// If there is no superadmin in the database, create one with a fresh random password.
(() => {
  if (db.prepare("SELECT 1 FROM users WHERE role='superadmin'").get()) return;
  const pw = process.env.MSCC_ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
  const taken = db.prepare("SELECT 1 FROM users WHERE lower(username)='admin1'").get();
  const username = taken ? "superadmin" : "admin1";
  db.prepare(`INSERT INTO users(id,username,displayName,password,role,active,createdAt) VALUES(?,?,?,?,?,1,?)`)
    .run(Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4), username, "Admin", hashPassword(pw), "superadmin", new Date().toISOString());
  const file = path.join(__dirname, "FIRST_RUN_ADMIN.txt");
  if (!process.env.MSCC_ADMIN_PASSWORD) {
    fs.writeFileSync(file, `MSCC superadmin account created.\r\nUsername: ${username}\r\nPassword: ${pw}\r\n\r\nSign in, change this password (top bar > Password), then DELETE this file.\r\n`, { mode: 0o600 });
  }
  console.log(`  [auth] Created superadmin "${username}".` + (process.env.MSCC_ADMIN_PASSWORD ? "" : ` Password saved in ${path.basename(file)} — delete that file after your first login.`));
})();

const lc = s => String(s || "").toLowerCase();
const isAdmin = u => u && (u.role === "admin" || u.role === "superadmin");
const isSuper = u => u && u.role === "superadmin";
const publicUser = u => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role, active: !!u.active, createdAt: u.createdAt });
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); // async handler wrapper

// Brute-force protection: failures are counted per (ip + username) and per username.
const FAILS = new Map(), FAIL_WINDOW = 15 * 60 * 1000;
const isLimited = (key, max) => { const e = FAILS.get(key); if (!e) return false; if (Date.now() - e.first > FAIL_WINDOW) { FAILS.delete(key); return false; } return e.n >= max; };
const addFail   = key => { const e = FAILS.get(key); if (!e || Date.now() - e.first > FAIL_WINDOW) FAILS.set(key, { n: 1, first: Date.now() }); else e.n++; };
setInterval(() => { for (const [k, e] of FAILS) if (Date.now() - e.first > FAIL_WINDOW) FAILS.delete(k); }, 5 * 60 * 1000).unref();
const DUMMY_HASH = hashPassword("dummy-password-for-timing");

// Public: the only /api route that works without a token.
app.post("/api/login", express.json({ limit: "10kb" }), (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string" || !username || !password || password.length > 200)
    return res.status(400).json({ ok: false, error: "bad_request" });
  const ip = req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "?";
  const uname = lc(username.trim());
  const k1 = `${ip}|${uname}`, k2 = uname;
  if (isLimited(k1, 8) || isLimited(k2, 30)) return res.status(429).json({ ok: false, error: "too_many_attempts" });
  const u = db.prepare("SELECT * FROM users WHERE lower(username)=lower(?)").get(username.trim());
  const good = verifyPassword(password, u ? u.password : DUMMY_HASH) && !!u; // always hash once → no timing leak on unknown names
  if (!good) { addFail(k1); addFail(k2); return res.status(401).json({ ok: false, error: "invalid" }); }
  if (!u.active) return res.status(403).json({ ok: false, error: "disabled" });
  FAILS.delete(k1);
  res.json({ ok: true, token: signToken(u, TOKEN_SECRET, TOKEN_TTL), user: publicUser(u) });
});

// Everything else under /api needs a valid, unexpired token for an active user.
function requireAuth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  const pl = m && verifyToken(m[1], TOKEN_SECRET);
  const u = pl && db.prepare("SELECT * FROM users WHERE lower(username)=lower(?)").get(pl.u);
  if (!u || !u.active || u.password.slice(-12) !== pl.pv) return res.status(401).json({ ok: false, error: "auth" });
  req.user = u;
  next();
}
const adminOnly = (req, res, next) => isAdmin(req.user) ? next() : res.status(403).json({ ok: false, error: "forbidden" });
const superOnly = (req, res, next) => isSuper(req.user) ? next() : res.status(403).json({ ok: false, error: "forbidden" });

app.use("/api", requireAuth);
app.use(express.json({ limit: "50mb" }));

app.get("/api/me", (req, res) => res.json(publicUser(req.user)));

app.post("/api/me/password", (req, res) => {
  const { current, next: nw } = req.body || {};
  if (typeof current !== "string" || typeof nw !== "string") return res.status(400).json({ ok: false, error: "bad_request" });
  if (!verifyPassword(current, req.user.password)) return res.status(403).json({ ok: false, error: "wrong_password" });
  if (nw.length < MIN_PASSWORD) return res.status(400).json({ ok: false, error: "too_short" });
  const h = hashPassword(nw);
  db.prepare("UPDATE users SET password=? WHERE id=?").run(h, req.user.id);
  res.json({ ok: true, token: signToken({ ...req.user, password: h }, TOKEN_SECRET, TOKEN_TTL) }); // keep this session alive
});

// ─── Settings ─────────────────────────────────────────────────────────────────
app.get("/api/settings", (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const obj  = {};
  for (const r of rows) obj[r.key] = p(r.value);
  res.json(obj);
});

app.post("/api/settings", adminOnly, (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ ok: false });
  const upsert = db.prepare(
    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  );
  const insertMany = db.transaction(entries => {
    for (const [k, v] of entries) upsert.run(k, j(v));
  });
  insertMany(Object.entries(req.body));
  res.json({ ok: true });
});

// ─── Users ────────────────────────────────────────────────────────────────────
// Passwords are never returned. Rules mirror the UI: admins manage pre-sales accounts,
// only the superadmin manages admin accounts, and nobody can create/change a superadmin here.
const ASSIGNABLE_ROLES = ["presales", "admin"];
const canManage = (actor, target) =>
  target.id === actor.id || (target.role === "presales" ? isAdmin(actor) : target.role === "admin" ? isSuper(actor) : false);

app.get("/api/users", adminOnly, (req, res) => {
  res.json(db.prepare("SELECT * FROM users").all().map(publicUser));
});

app.post("/api/users", adminOnly, (req, res) => {
  const b = req.body || {};
  const username = lc(String(b.username || "").trim());
  const password = typeof b.password === "string" ? b.password : "";
  if (!username || username.length > 60) return res.status(400).json({ ok: false, error: "bad_username" });
  if (password.length < MIN_PASSWORD) return res.status(400).json({ ok: false, error: "too_short" });
  const role = b.role || "presales";
  if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ ok: false, error: "bad_role" });
  if (role === "admin" && !isSuper(req.user)) return res.status(403).json({ ok: false, error: "forbidden" });
  if (db.prepare("SELECT 1 FROM users WHERE lower(username)=?").get(username)) return res.status(409).json({ ok: false, error: "exists" });
  const id = uid();
  db.prepare(`INSERT INTO users(id,username,displayName,password,role,active,createdAt) VALUES(?,?,?,?,?,1,?)`)
    .run(id, username, String(b.displayName || username).trim().slice(0, 100), hashPassword(password), role, now());
  res.json({ ok: true, id });
});

app.put("/api/users/:id", adminOnly, (req, res) => {
  const t = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!t) return res.status(404).json({ ok: false });
  if (!canManage(req.user, t)) return res.status(403).json({ ok: false, error: "forbidden" });
  const b = req.body || {}, sets = {};
  if (typeof b.displayName === "string") sets.displayName = b.displayName.trim().slice(0, 100);
  if (typeof b.password === "string" && b.password !== "") {
    if (b.password.length < MIN_PASSWORD) return res.status(400).json({ ok: false, error: "too_short" });
    sets.password = hashPassword(b.password);
  }
  if ("active" in b) {
    const a = b.active ? 1 : 0;
    if (a !== t.active) {
      if (t.id === req.user.id || t.role === "superadmin") return res.status(400).json({ ok: false, error: "cannot_deactivate" });
      sets.active = a;
    }
  }
  if ("role" in b && b.role !== t.role) {
    if (!isSuper(req.user) || t.id === req.user.id || t.role === "superadmin" || !ASSIGNABLE_ROLES.includes(b.role))
      return res.status(403).json({ ok: false, error: "forbidden" });
    sets.role = b.role;
  }
  const cols = Object.keys(sets);
  if (cols.length) db.prepare(`UPDATE users SET ${cols.map(c => `${c}=@${c}`).join(", ")} WHERE id=@id`).run({ ...sets, id: t.id });
  res.json({ ok: true });
});

app.delete("/api/users/:id", adminOnly, (req, res) => {
  const t = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!t) return res.json({ ok: true });
  if (t.id === req.user.id || t.role === "superadmin" || !canManage(req.user, t)) return res.status(403).json({ ok: false, error: "forbidden" });
  db.prepare("DELETE FROM users WHERE id=?").run(t.id);
  res.json({ ok: true });
});

// ─── Price List ───────────────────────────────────────────────────────────────
app.get("/api/pricelist", (req, res) => {
  const rows = db.prepare("SELECT * FROM price_list ORDER BY sortOrder ASC").all();
  res.json(rows.map(hydratePLItem));
});

app.post("/api/pricelist/replace", (req, res) => {
  const replaceTx = db.transaction(items => {
    db.prepare("DELETE FROM price_list").run();
    const ins = db.prepare(`
      INSERT INTO price_list(id,type,description,modelNo,brand,glp,local,notes,children,partNumber,sortOrder)
      VALUES(@id,@type,@description,@modelNo,@brand,@glp,@local,@notes,@children,@partNumber,@sortOrder)
    `);
    items.forEach((item, i) => ins.run(normalizePLItem(item, i)));
  });
  replaceTx(req.body);
  res.json({ ok: true, count: req.body.length });
});

app.post("/api/pricelist/append", (req, res) => {
  const base = db.prepare("SELECT COUNT(*) as c FROM price_list").get().c;
  const ins  = db.prepare(`
    INSERT INTO price_list(id,type,description,modelNo,brand,glp,local,notes,children,partNumber,sortOrder)
    VALUES(@id,@type,@description,@modelNo,@brand,@glp,@local,@notes,@children,@partNumber,@sortOrder)
  `);
  const appendTx = db.transaction(items => {
    items.forEach((item, i) => ins.run(normalizePLItem(item, base + i)));
  });
  appendTx(req.body);
  res.json({ ok: true });
});

app.post("/api/pricelist", (req, res) => {
  const sortOrder = db.prepare("SELECT COUNT(*) as c FROM price_list").get().c;
  const item = normalizePLItem(req.body, sortOrder);
  db.prepare(`
    INSERT INTO price_list(id,type,description,modelNo,brand,glp,local,notes,children,partNumber,sortOrder)
    VALUES(@id,@type,@description,@modelNo,@brand,@glp,@local,@notes,@children,@partNumber,@sortOrder)
  `).run(item);
  res.json({ ok: true, id: item.id });
});

app.put("/api/pricelist/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM price_list WHERE id=?").get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false });
  const merged = { ...hydratePLItem(existing), ...req.body, id: req.params.id };
  const normalized = normalizePLItem(merged, existing.sortOrder);
  db.prepare(`
    UPDATE price_list SET type=@type, description=@description, modelNo=@modelNo,
      brand=@brand, glp=@glp, local=@local, notes=@notes, children=@children, partNumber=@partNumber
    WHERE id=@id
  `).run(normalized);
  res.json({ ok: true });
});

app.delete("/api/pricelist/:id", (req, res) => {
  db.prepare("DELETE FROM price_list WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ─── Projects ─────────────────────────────────────────────────────────────────
// Pre-sales users only see / touch projects they own or were granted; admins see everything.
const canAccessProject = (user, row) =>
  isAdmin(user) || lc(row.ownedBy) === lc(user.username) || (p(row.grantedTo) || []).map(lc).includes(lc(user.username));

function projectOr404(req, res) {
  const row = db.prepare("SELECT * FROM projects WHERE id=?").get(req.params.id);
  if (!row) { res.status(404).json({ ok: false }); return null; }
  if (!canAccessProject(req.user, row)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return row;
}

app.get("/api/projects", (req, res) => {
  const rows = db.prepare("SELECT * FROM projects ORDER BY createdAt DESC").all()
    .filter(r => canAccessProject(req.user, r));
  res.json(rows.map(hydrateProject));
});

app.post("/api/projects", (req, res) => {
  const b = req.body || {}, admin = isAdmin(req.user);
  const rec = {
    id: typeof b.id === "string" && b.id ? b.id : uid(),
    projectName: b.projectName ?? null, client: b.client ?? null, engineerName: b.engineerName ?? null,
    refNumber: b.refNumber ?? null, systemType: b.systemType ?? null,
    ownedBy: admin ? (b.ownedBy ?? null) : req.user.username,          // pre-sales can only create their own
    grantedTo: j(admin ? (b.grantedTo || []) : []),
    status: b.status || "draft",
    createdAt: b.createdAt || now(), updatedAt: now(),
  };
  db.prepare(`
    INSERT INTO projects(id,projectName,client,engineerName,refNumber,systemType,ownedBy,grantedTo,status,createdAt,updatedAt)
    VALUES(@id,@projectName,@client,@engineerName,@refNumber,@systemType,@ownedBy,@grantedTo,@status,@createdAt,@updatedAt)
  `).run(rec);
  res.json({ ok: true, id: rec.id });
});

app.put("/api/projects/:id", (req, res) => {
  if (!projectOr404(req, res)) return;
  const allowed = ["projectName", "client", "engineerName", "refNumber", "systemType", "status"];
  if (isAdmin(req.user)) allowed.push("ownedBy", "grantedTo");
  const data = {};
  for (const k of allowed) if (k in (req.body || {})) data[k] = req.body[k];
  if ("grantedTo" in data) data.grantedTo = j(data.grantedTo);
  data.updatedAt = now();
  const sets = Object.keys(data).map(c => `${c}=@${c}`).join(", ");
  db.prepare(`UPDATE projects SET ${sets} WHERE id=@id`).run({ ...data, id: req.params.id });
  res.json({ ok: true });
});

app.delete("/api/projects/:id", adminOnly, (req, res) => {
  db.prepare("DELETE FROM projects WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

app.post("/api/projects/:id/grant", adminOnly, (req, res) => {
  const row = db.prepare("SELECT grantedTo FROM projects WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ ok: false });
  const granted = [...new Set([...(p(row.grantedTo) || []), req.body.username])];
  db.prepare("UPDATE projects SET grantedTo=?, updatedAt=? WHERE id=?")
    .run(j(granted), now(), req.params.id);
  res.json({ ok: true });
});

app.post("/api/projects/:id/revoke", adminOnly, (req, res) => {
  const row = db.prepare("SELECT grantedTo FROM projects WHERE id=?").get(req.params.id);
  if (!row) return res.status(404).json({ ok: false });
  const granted = (p(row.grantedTo) || []).filter(u => u !== req.body.username);
  db.prepare("UPDATE projects SET grantedTo=?, updatedAt=? WHERE id=?")
    .run(j(granted), now(), req.params.id);
  res.json({ ok: true });
});

// ─── Revisions ────────────────────────────────────────────────────────────────
const REV_FIELDS = ["projectName","client","engineerName","salesEngineer","contactName","contactPhone","contactEmail",
  "refNumber","systemType","date","currency","conversionRate","localFactor","tcMode","tcValue","tcPercent","tcApprox",
  "tcBaseUSD","installValue","notes","code","grandTotal","gtAfterDiscount"];

app.post("/api/projects/:id/revisions", (req, res) => {
  if (!projectOr404(req, res)) return;
  const projectId = req.params.id;
  const b = req.body || {};
  const revIndex  = db.prepare(
    "SELECT COUNT(*) as c FROM revisions WHERE projectId=?"
  ).get(projectId).c;

  const rev = { createdAt: now() };
  for (const k of REV_FIELDS) rev[k] = b[k] ?? null;
  Object.assign(rev, {
    id: uid(), projectId, revIndex,                 // set AFTER the body so a client can't override them
    brandFactors:  j(b.brandFactors  ?? {}),
    lines:         j(b.lines         ?? []),
    extras:        j(b.extras        ?? []),
    tcEnabled:     b.tcEnabled     ? 1 : 0,
    installEnabled:b.installEnabled? 1 : 0,
    roundUp:       b.roundUp       ? 1 : 0,
    gtAfterDiscountEnabled: b.gtAfterDiscountEnabled ? 1 : 0,
  });

  const saveTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO revisions(
        id,projectId,revIndex,projectName,client,engineerName,salesEngineer,
        contactName,contactPhone,contactEmail,refNumber,systemType,date,currency,
        conversionRate,brandFactors,localFactor,lines,tcEnabled,tcMode,tcValue,
        tcPercent,tcApprox,tcBaseUSD,installEnabled,installValue,extras,notes,
        roundUp,code,grandTotal,gtAfterDiscount,gtAfterDiscountEnabled,createdAt
      ) VALUES(
        @id,@projectId,@revIndex,@projectName,@client,@engineerName,@salesEngineer,
        @contactName,@contactPhone,@contactEmail,@refNumber,@systemType,@date,@currency,
        @conversionRate,@brandFactors,@localFactor,@lines,@tcEnabled,@tcMode,@tcValue,
        @tcPercent,@tcApprox,@tcBaseUSD,@installEnabled,@installValue,@extras,@notes,
        @roundUp,@code,@grandTotal,@gtAfterDiscount,@gtAfterDiscountEnabled,@createdAt
      )
    `).run(rev);
    db.prepare("DELETE FROM drafts WHERE projectId=?").run(projectId);
    db.prepare("UPDATE projects SET status='submitted', updatedAt=? WHERE id=?")
      .run(now(), projectId);
  });
  saveTx();

  res.json({ ok: true, id: rev.id, revIndex });
});

// ─── Drafts ───────────────────────────────────────────────────────────────────
app.post("/api/projects/:id/draft", (req, res) => {
  if (!projectOr404(req, res)) return;
  const { data } = req.body || {};
  db.prepare(`
    INSERT INTO drafts(projectId,data,savedBy,savedAt) VALUES(?,?,?,?)
    ON CONFLICT(projectId) DO UPDATE SET data=excluded.data, savedBy=excluded.savedBy, savedAt=excluded.savedAt
  `).run(req.params.id, j(data), req.user.username, now());   // savedBy comes from the login, not the request
  db.prepare("UPDATE projects SET updatedAt=? WHERE id=?").run(now(), req.params.id);
  res.json({ ok: true });
});

app.delete("/api/projects/:id/draft", (req, res) => {
  if (!projectOr404(req, res)) return;
  db.prepare("DELETE FROM drafts WHERE projectId=?").run(req.params.id);
  res.json({ ok: true });
});

// ─── Backup ───────────────────────────────────────────────────────────────────
app.get("/api/backup", adminOnly, (req, res) => {
  const settings  = {};
  for (const r of db.prepare("SELECT key,value FROM settings").all())
    settings[r.key] = p(r.value);

  const projects  = db.prepare("SELECT * FROM projects ORDER BY createdAt DESC").all()
    .map(r => ({ ...r, grantedTo: p(r.grantedTo) || [] }));
  const revisions = db.prepare("SELECT * FROM revisions ORDER BY revIndex ASC").all()
    .map(hydrateRev);
  const drafts    = db.prepare("SELECT * FROM drafts").all()
    .map(d => ({ ...d, data: p(d.data) }));
  const priceList = db.prepare("SELECT * FROM price_list ORDER BY sortOrder ASC").all()
    .map(hydratePLItem);

  const backup = {
    exportedAt: now(),
    settings,
    users:      db.prepare("SELECT * FROM users").all().map(u => ({ ...u, active: !!u.active })),
    priceList,
    projects,
    revisions,
    drafts,
  };

  res.setHeader("Content-Disposition", `attachment; filename="mscc_backup_${now().slice(0,10)}.json"`);
  res.setHeader("Content-Type", "application/json");
  res.json(backup);
});

app.post("/api/backup/restore", superOnly, (req, res) => {
  const { settings, users, priceList, projects, revisions, drafts } = req.body || {};
  const actor = req.user; // the superadmin doing the restore — kept even if the backup does not contain them

  const restoreTx = db.transaction(() => {
    db.prepare("DELETE FROM drafts").run();
    db.prepare("DELETE FROM revisions").run();
    db.prepare("DELETE FROM projects").run();
    db.prepare("DELETE FROM price_list").run();
    db.prepare("DELETE FROM users").run();
    db.prepare("DELETE FROM settings").run();

    const upsertSetting = db.prepare(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    );
    for (const [k, v] of Object.entries(settings || {})) upsertSetting.run(k, j(v));

    const insUser = db.prepare(`
      INSERT OR IGNORE INTO users(id,username,displayName,password,role,active,createdAt)
      VALUES(@id,@username,@displayName,@password,@role,@active,@createdAt)
    `);
    for (const u of (users || [])) {
      if (!u || !u.username) continue;
      insUser.run({
        id: u.id || uid(), username: u.username, createdAt: u.createdAt || now(),
        displayName: u.displayName || "",
        // old backups hold plain-text passwords → hash them on the way in
        password: isHashed(u.password) ? u.password : hashPassword(u.password || crypto.randomBytes(12).toString("hex")),
        role: ["presales", "admin", "superadmin"].includes(u.role) ? u.role : "presales",
        active: u.active ? 1 : 0,
      });
    }
    if (!db.prepare("SELECT 1 FROM users WHERE lower(username)=lower(?)").get(actor.username))
      insUser.run({ id: actor.id, username: actor.username, displayName: actor.displayName || "", password: actor.password,
                    role: actor.role, active: 1, createdAt: actor.createdAt });

    const insPL = db.prepare(`
      INSERT OR IGNORE INTO price_list(id,type,description,modelNo,brand,glp,local,notes,children,partNumber,sortOrder)
      VALUES(@id,@type,@description,@modelNo,@brand,@glp,@local,@notes,@children,@partNumber,@sortOrder)
    `);
    (priceList || []).forEach((item, i) => insPL.run(normalizePLItem(item, item.sortOrder ?? i)));

    const insProj = db.prepare(`
      INSERT OR IGNORE INTO projects(id,projectName,client,engineerName,refNumber,systemType,ownedBy,grantedTo,status,createdAt,updatedAt)
      VALUES(@id,@projectName,@client,@engineerName,@refNumber,@systemType,@ownedBy,@grantedTo,@status,@createdAt,@updatedAt)
    `);
    for (const pr of (projects || []))
      insProj.run({ ...pr, status: pr.status || "draft", grantedTo: j(pr.grantedTo || []), updatedAt: pr.updatedAt || now() });

    const insRev = db.prepare(`
      INSERT OR IGNORE INTO revisions(
        id,projectId,revIndex,projectName,client,engineerName,salesEngineer,
        contactName,contactPhone,contactEmail,refNumber,systemType,date,currency,
        conversionRate,brandFactors,localFactor,lines,tcEnabled,tcMode,tcValue,
        tcPercent,tcApprox,tcBaseUSD,installEnabled,installValue,extras,notes,
        roundUp,code,grandTotal,gtAfterDiscount,gtAfterDiscountEnabled,createdAt
      ) VALUES(
        @id,@projectId,@revIndex,@projectName,@client,@engineerName,@salesEngineer,
        @contactName,@contactPhone,@contactEmail,@refNumber,@systemType,@date,@currency,
        @conversionRate,@brandFactors,@localFactor,@lines,@tcEnabled,@tcMode,@tcValue,
        @tcPercent,@tcApprox,@tcBaseUSD,@installEnabled,@installValue,@extras,@notes,
        @roundUp,@code,@grandTotal,@gtAfterDiscount,@gtAfterDiscountEnabled,@createdAt
      )
    `);
    for (const r of (revisions || []))
      insRev.run({
        ...r,
        brandFactors:   j(r.brandFactors  ?? {}),
        lines:          j(r.lines         ?? []),
        extras:         j(r.extras        ?? []),
        tcEnabled:      r.tcEnabled      ? 1 : 0,
        installEnabled: r.installEnabled ? 1 : 0,
        roundUp:        r.roundUp        ? 1 : 0,
        gtAfterDiscountEnabled: r.gtAfterDiscountEnabled ? 1 : 0,
        createdAt:      r.createdAt      || now(),
      });

    const insDraft = db.prepare(`
      INSERT OR IGNORE INTO drafts(projectId,data,savedBy,savedAt) VALUES(?,?,?,?)
    `);
    for (const d of (drafts || []))
      insDraft.run(d.projectId, j(d.data), d.savedBy || null, d.savedAt || now());
  });

  restoreTx();
  res.json({ ok: true });
});

// ─── Error handler (always JSON, never a stack trace to the client) ───────────
app.use((err, req, res, next) => {
  console.error("[error]", req.method, req.originalUrl, err.message);
  res.status(err.status || err.statusCode || 500).json({ ok: false, error: err.status === 413 ? "too_large" : "server_error" });
});

// ─── Catch-all ────────────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  const idx = path.join(BUILD, "index.html");
  if (fs.existsSync(idx)) res.sendFile(idx);
  else res.send("Backend running. Build the React app and place dist/ here.");
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  const ip = getLanIP();
  console.log("\n========================================");
  console.log("  MSCC Quotation System — Server Ready");
  console.log("========================================");
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${ip}:${PORT}`);
  console.log("  Share the Network URL with your team.");
  console.log("========================================\n");
  const { exec } = require("child_process");
  exec(`start http://localhost:${PORT}`);
});
// ─── MSCC Quotation System — Cloudflare Workers + D1 API (v1.4.0) ────────────
// A port of ../server.js. Same routes, same JSON, same rules (roles, edit locks, price-list
// versions), so the website (../dist) works unchanged. Differences:
//   • D1 is asynchronous and has no multi-request transactions → db.batch() where it matters.
//   • Free plan: 10 ms CPU per request → passwords use PBKDF2 (Web Crypto); backups go in pages.
//   • No memory between requests → failed sign-ins are counted in the auth_fails table.
//   • Usage counting is left to Cloudflare's dashboard (Workers → mscc-quotation → Metrics).
import { Hono } from "hono";
import { MIN_PASSWORD, hashPassword, verifyPassword, isHashed, isLegacyHash, needsRehash, signToken, verifyToken, randomHex } from "./auth.js";

const app = new Hono();
const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000;
const LOCK_TTL = 2 * 60 * 1000;
const FAIL_WINDOW = 15 * 60 * 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const now = () => new Date().toISOString();
const j = v => JSON.stringify(v ?? null);
const p = v => { try { return JSON.parse(v); } catch { return v; } };
const nz = v => (v === undefined ? null : v);                  // D1 refuses undefined
const lc = s => String(s || "").toLowerCase();
const isAdmin = u => u && (u.role === "admin" || u.role === "superadmin");
const isSuper = u => u && u.role === "superadmin";
const publicUser = u => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role, active: !!u.active,
  createdAt: u.createdAt, passwordReady: !needsRehash(u.password) });
const err = (c, status, error) => c.json({ ok: false, error }, status);
const body = async c => { try { const b = await c.req.json(); return b && typeof b === "object" ? b : {}; } catch { return {}; } };

const q = (c, sql, ...args) => c.env.DB.prepare(sql).bind(...args.map(nz));
const first = (c, sql, ...args) => q(c, sql, ...args).first();
const all = async (c, sql, ...args) => (await q(c, sql, ...args).all()).results;
const run = (c, sql, ...args) => q(c, sql, ...args).run();

function hydrateRev(row) {
  if (!row) return null;
  return { ...row, brandFactors: p(row.brandFactors), lines: p(row.lines), extras: p(row.extras),
    tcEnabled: !!row.tcEnabled, installEnabled: !!row.installEnabled, roundUp: !!row.roundUp,
    gtAfterDiscountEnabled: !!row.gtAfterDiscountEnabled };
}
function hydratePLItem(row) {
  if (!row) return null;
  const children = p(row.children) || [];
  if (row.type === "subsystem")
    return { id: row.id, type: "subsystem", description: row.description, brand: row.brand, partNumber: row.partNumber || "", children, sortOrder: row.sortOrder };
  return { id: row.id, type: "item", description: row.description, modelNo: row.modelNo, brand: row.brand, glp: row.glp, local: row.local, notes: row.notes, sortOrder: row.sortOrder };
}
function normalizePLItem(item, sortOrder) {
  const isSS = item.type === "subsystem";
  return [item.id || uid(), isSS ? "subsystem" : "item", item.description || "", isSS ? "" : (item.modelNo || ""), item.brand || "",
    isSS ? 0 : (item.glp || 0), isSS ? 0 : (item.local || 0), isSS ? "" : (item.notes || ""), j(isSS ? (item.children || []) : []),
    isSS ? (item.partNumber || "") : null, sortOrder];
}
const PL_INSERT = "INSERT INTO price_list(id,type,description,modelNo,brand,glp,local,notes,children,partNumber,sortOrder) VALUES(?,?,?,?,?,?,?,?,?,?,?)";
const REV_COLS = ["id","projectId","revIndex","projectName","client","engineerName","salesEngineer","contactName","contactPhone",
  "contactEmail","refNumber","systemType","date","currency","conversionRate","brandFactors","localFactor","lines","tcEnabled",
  "tcMode","tcValue","tcPercent","tcApprox","tcBaseUSD","installEnabled","installValue","extras","notes","roundUp","code",
  "grandTotal","gtAfterDiscount","gtAfterDiscountEnabled","createdAt"];
const REV_INSERT = (verb = "INSERT") => `${verb} INTO revisions(${REV_COLS.join(",")}) VALUES(${REV_COLS.map(() => "?").join(",")})`;
const revValues = r => REV_COLS.map(k => nz(r[k]));
function revRecord(r, overrides = {}) {
  const rec = {}; for (const k of REV_COLS) rec[k] = r[k] ?? null;
  return Object.assign(rec, {
    brandFactors: j(r.brandFactors ?? {}), lines: j(r.lines ?? []), extras: j(r.extras ?? []),
    tcEnabled: r.tcEnabled ? 1 : 0, installEnabled: r.installEnabled ? 1 : 0, roundUp: r.roundUp ? 1 : 0,
    gtAfterDiscountEnabled: r.gtAfterDiscountEnabled ? 1 : 0, createdAt: r.createdAt || now(),
  }, overrides);
}

// ─── One-time setup per Worker instance ──────────────────────────────────────
// Token secret (kept in D1, moved over from the PC database), and a first superadmin
// when there is none and the ADMIN_PASSWORD secret is set (`npx wrangler secret put ADMIN_PASSWORD`).
let setupPromise = null;
let TOKEN_SECRET = null;
async function setup(c) {
  const r = await first(c, "SELECT value FROM auth_meta WHERE key='token_secret'");
  if (r) TOKEN_SECRET = r.value;
  else { TOKEN_SECRET = randomHex(48); await run(c, "INSERT OR IGNORE INTO auth_meta(key,value) VALUES('token_secret',?)", TOKEN_SECRET); }
  if (!(await first(c, "SELECT 1 x FROM users WHERE role='superadmin'")) && c.env.ADMIN_PASSWORD) {
    const name = (c.env.ADMIN_USERNAME || "admin1").toLowerCase();
    await run(c, "INSERT OR IGNORE INTO users(id,username,displayName,password,role,active,createdAt) VALUES(?,?,?,?,?,1,?)",
      uid(), name, "Admin", await hashPassword(c.env.ADMIN_PASSWORD), "superadmin", now());
  }
}
app.use("/api/*", async (c, next) => {
  if (!setupPromise) setupPromise = setup(c).catch(e => { setupPromise = null; throw e; });
  await setupPromise;
  await next();
  const h = c.res.headers;
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "SAMEORIGIN");
  h.set("Referrer-Policy", "same-origin");
  if (!h.get("Cache-Control")) h.set("Cache-Control", "no-store");
});

// ─── Sign-in (the only public /api route) ────────────────────────────────────
async function isLimited(c, key, max) {
  const e = await first(c, "SELECT n, first FROM auth_fails WHERE key=?", key);
  return !!e && Date.now() - e.first <= FAIL_WINDOW && e.n >= max;
}
async function addFail(c, key) {
  const t = Date.now();
  await run(c, `INSERT INTO auth_fails(key,n,first) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET
    n = CASE WHEN ? - first > ? THEN 1 ELSE n + 1 END, first = CASE WHEN ? - first > ? THEN ? ELSE first END`,
    key, t, t, FAIL_WINDOW, t, FAIL_WINDOW, t);
}
// Unknown usernames are checked against this (never matches) so they take as long as real ones.
const DUMMY_HASH = "pbkdf2$30000$" + "0".repeat(32) + "$" + "0".repeat(64);
app.post("/api/login", async c => {
  const { username, password } = await body(c);
  if (typeof username !== "string" || typeof password !== "string" || !username || !password || password.length > 200)
    return err(c, 400, "bad_request");
  const ip = c.req.header("cf-connecting-ip") || "?";
  const uname = lc(username.trim());
  const k1 = `${ip}|${uname}`, k2 = uname;
  if (await isLimited(c, k1, 8) || await isLimited(c, k2, 30)) return err(c, 429, "too_many_attempts");
  const u = await first(c, "SELECT * FROM users WHERE lower(username)=lower(?)", username.trim());
  if (u && isLegacyHash(u.password)) return err(c, 403, "password_upgrade"); // old hash: an admin must set a new password
  const good = (await verifyPassword(password, u ? u.password : DUMMY_HASH)) && !!u;
  if (!good) { await addFail(c, k1); await addFail(c, k2); return err(c, 401, "invalid"); }
  if (!u.active) return err(c, 403, "disabled");
  await run(c, "DELETE FROM auth_fails WHERE key=?", k1);
  if (needsRehash(u.password)) { u.password = await hashPassword(password); await run(c, "UPDATE users SET password=? WHERE id=?", u.password, u.id); }
  return c.json({ ok: true, token: await signToken(u, TOKEN_SECRET, TOKEN_TTL), user: publicUser(u) });
});

// Everything else needs a valid, unexpired token for an active user whose password is unchanged.
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/login") return next();
  const m = /^Bearer (.+)$/.exec(c.req.header("authorization") || "");
  const pl = m && await verifyToken(m[1], TOKEN_SECRET);
  const u = pl && await first(c, "SELECT * FROM users WHERE lower(username)=lower(?)", pl.u);
  if (!u || !u.active || u.password.slice(-12) !== pl.pv) return err(c, 401, "auth");
  c.set("user", u);
  await next();
});
const adminOnly = async (c, next) => isAdmin(c.get("user")) ? next() : err(c, 403, "forbidden");
const superOnly = async (c, next) => isSuper(c.get("user")) ? next() : err(c, 403, "forbidden");

app.get("/api/me", c => c.json(publicUser(c.get("user"))));
app.get("/api/ping", c => c.json({ ok: true }));
app.get("/api/usage", adminOnly, c => c.json({ since: null, days: [], routes: [],
  note: "On Cloudflare, usage is in the Cloudflare dashboard: Workers & Pages → mscc-quotation → Metrics (requests, CPU time) and D1 → mscc → Metrics (rows read/written)." }));

app.post("/api/me/password", async c => {
  const { current, next: nw } = await body(c), u = c.get("user");
  if (typeof current !== "string" || typeof nw !== "string") return err(c, 400, "bad_request");
  if (isLegacyHash(u.password) || !(await verifyPassword(current, u.password))) return err(c, 403, "wrong_password");
  if (nw.length < MIN_PASSWORD) return err(c, 400, "too_short");
  const h = await hashPassword(nw);
  await run(c, "UPDATE users SET password=? WHERE id=?", h, u.id);
  return c.json({ ok: true, token: await signToken({ ...u, password: h }, TOKEN_SECRET, TOKEN_TTL) });
});

// ─── Settings ─────────────────────────────────────────────────────────────────
app.get("/api/settings", async c => {
  const obj = {}; for (const r of await all(c, "SELECT key, value FROM settings")) obj[r.key] = p(r.value);
  return c.json(obj);
});
app.post("/api/settings", adminOnly, async c => {
  const b = await body(c);
  if (Array.isArray(b)) return err(c, 400, "bad_request");
  const st = Object.entries(b).map(([k, v]) => q(c, "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, j(v)));
  if (st.length) await c.env.DB.batch(st);
  return c.json({ ok: true });
});

// ─── Users ────────────────────────────────────────────────────────────────────
const ASSIGNABLE_ROLES = ["presales", "admin"];
const canManage = (actor, target) =>
  target.id === actor.id || (target.role === "presales" ? isAdmin(actor) : target.role === "admin" ? isSuper(actor) : false);

app.get("/api/users", adminOnly, async c => c.json((await all(c, "SELECT * FROM users")).map(publicUser)));
app.post("/api/users", adminOnly, async c => {
  const b = await body(c), actor = c.get("user");
  const username = lc(String(b.username || "").trim());
  const password = typeof b.password === "string" ? b.password : "";
  if (!username || username.length > 60) return err(c, 400, "bad_username");
  if (password.length < MIN_PASSWORD) return err(c, 400, "too_short");
  const role = b.role || "presales";
  if (!ASSIGNABLE_ROLES.includes(role)) return err(c, 400, "bad_role");
  if (role === "admin" && !isSuper(actor)) return err(c, 403, "forbidden");
  if (await first(c, "SELECT 1 x FROM users WHERE lower(username)=?", username)) return err(c, 409, "exists");
  const id = uid();
  await run(c, "INSERT INTO users(id,username,displayName,password,role,active,createdAt) VALUES(?,?,?,?,?,1,?)",
    id, username, String(b.displayName || username).trim().slice(0, 100), await hashPassword(password), role, now());
  return c.json({ ok: true, id });
});
app.put("/api/users/:id", adminOnly, async c => {
  const actor = c.get("user");
  const t = await first(c, "SELECT * FROM users WHERE id=?", c.req.param("id"));
  if (!t) return c.json({ ok: false }, 404);
  if (!canManage(actor, t)) return err(c, 403, "forbidden");
  const b = await body(c), sets = {};
  if (typeof b.displayName === "string") sets.displayName = b.displayName.trim().slice(0, 100);
  if (typeof b.password === "string" && b.password !== "") {
    if (b.password.length < MIN_PASSWORD) return err(c, 400, "too_short");
    sets.password = await hashPassword(b.password);
  }
  if ("active" in b) {
    const a = b.active ? 1 : 0;
    if (a !== t.active) {
      if (t.id === actor.id || t.role === "superadmin") return err(c, 400, "cannot_deactivate");
      sets.active = a;
    }
  }
  if ("role" in b && b.role !== t.role) {
    if (!isSuper(actor) || t.id === actor.id || t.role === "superadmin" || !ASSIGNABLE_ROLES.includes(b.role)) return err(c, 403, "forbidden");
    sets.role = b.role;
  }
  const cols = Object.keys(sets);
  if (cols.length) await run(c, `UPDATE users SET ${cols.map(k => `${k}=?`).join(", ")} WHERE id=?`, ...cols.map(k => sets[k]), t.id);
  return c.json({ ok: true });
});
app.delete("/api/users/:id", adminOnly, async c => {
  const actor = c.get("user");
  const t = await first(c, "SELECT * FROM users WHERE id=?", c.req.param("id"));
  if (!t) return c.json({ ok: true });
  if (t.id === actor.id || t.role === "superadmin" || !canManage(actor, t)) return err(c, 403, "forbidden");
  await run(c, "DELETE FROM users WHERE id=?", t.id);
  return c.json({ ok: true });
});

// ─── Price list (with the same version / 304 caching as the PC version) ─────
const plVersion = async c => (await first(c, "SELECT value FROM auth_meta WHERE key='pricelist_version'"))?.value || "0";
const bumpPL = c => q(c, "INSERT INTO auth_meta(key,value) VALUES('pricelist_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  Date.now().toString(36) + randomHex(3));

app.get("/api/pricelist", async c => {
  const etag = `"pl-${await plVersion(c)}"`;
  c.header("Cache-Control", "private, no-cache");
  c.header("ETag", etag);
  if (c.req.header("if-none-match") === etag) return c.body(null, 304);
  return c.json((await all(c, "SELECT * FROM price_list ORDER BY sortOrder ASC")).map(hydratePLItem));
});
app.post("/api/pricelist/replace", async c => {
  const items = await c.req.json().catch(() => null);
  if (!Array.isArray(items)) return err(c, 400, "bad_request");
  await c.env.DB.batch([q(c, "DELETE FROM price_list"), ...items.map((it, i) => q(c, PL_INSERT, ...normalizePLItem(it, i))), bumpPL(c)]);
  return c.json({ ok: true, count: items.length });
});
app.post("/api/pricelist/append", async c => {
  const items = await c.req.json().catch(() => null);
  if (!Array.isArray(items)) return err(c, 400, "bad_request");
  const base = (await first(c, "SELECT COUNT(*) n FROM price_list")).n;
  await c.env.DB.batch([...items.map((it, i) => q(c, PL_INSERT, ...normalizePLItem(it, base + i))), bumpPL(c)]);
  return c.json({ ok: true });
});
app.post("/api/pricelist", async c => {
  const b = await body(c);
  const sortOrder = (await first(c, "SELECT COUNT(*) n FROM price_list")).n;
  const vals = normalizePLItem(b, sortOrder);
  await c.env.DB.batch([q(c, PL_INSERT, ...vals), bumpPL(c)]);
  return c.json({ ok: true, id: vals[0] });
});
app.put("/api/pricelist/:id", async c => {
  const existing = await first(c, "SELECT * FROM price_list WHERE id=?", c.req.param("id"));
  if (!existing) return c.json({ ok: false }, 404);
  const v = normalizePLItem({ ...hydratePLItem(existing), ...(await body(c)), id: existing.id }, existing.sortOrder);
  await c.env.DB.batch([
    q(c, "UPDATE price_list SET type=?, description=?, modelNo=?, brand=?, glp=?, local=?, notes=?, children=?, partNumber=? WHERE id=?",
      v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], existing.id),
    bumpPL(c)]);
  return c.json({ ok: true });
});
app.delete("/api/pricelist/:id", async c => {
  await c.env.DB.batch([q(c, "DELETE FROM price_list WHERE id=?", c.req.param("id")), bumpPL(c)]);
  return c.json({ ok: true });
});

// ─── Projects ─────────────────────────────────────────────────────────────────
const canAccessProject = (user, row) =>
  isAdmin(user) || lc(row.ownedBy) === lc(user.username) || (p(row.grantedTo) || []).map(lc).includes(lc(user.username));
async function projectOr(c) {               // → row, or a Response to return
  const row = await first(c, "SELECT * FROM projects WHERE id=?", c.req.param("id"));
  if (!row) return c.json({ ok: false }, 404);
  if (!canAccessProject(c.get("user"), row)) return err(c, 403, "forbidden");
  return row;
}
const isStale = l => !l || Date.now() - l.heartbeat > LOCK_TTL;
const validLockId = id => typeof id === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(id);

// Draft / revision / detail writes are only accepted from the editor window holding the lock.
async function holdsLock(c, projectId) {
  const id = c.req.header("x-edit-lock");
  const l = await first(c, "SELECT * FROM edit_locks WHERE projectId=?", projectId);
  if (!l || !validLockId(id) || l.lockId !== id)
    return err2(c, 409, { ok: false, error: "lock_lost", lock: l && !isStale(l) ? { username: l.username, since: l.since } : null });
  return null; // the write that follows refreshes the heartbeat in the same batch
}
const err2 = (c, status, obj) => c.json(obj, status);
const touchLock = (c, projectId) => q(c, "UPDATE edit_locks SET heartbeat=? WHERE projectId=?", Date.now(), projectId);
const setLockStmt = (c, projectId, username, lockId, keepSince) =>
  q(c, `INSERT INTO edit_locks(projectId,username,lockId,since,heartbeat) VALUES(?,?,?,?,?)
        ON CONFLICT(projectId) DO UPDATE SET username=excluded.username, lockId=excluded.lockId, since=excluded.since, heartbeat=excluded.heartbeat`,
    projectId, username, lockId, keepSince || now(), Date.now());

async function hydrateProject(c, row) {
  const [revs, draft, lock] = await c.env.DB.batch([
    q(c, "SELECT * FROM revisions WHERE projectId=? ORDER BY revIndex ASC", row.id),
    q(c, "SELECT * FROM drafts WHERE projectId=?", row.id),
    q(c, "SELECT * FROM edit_locks WHERE projectId=?", row.id),
  ]);
  const d = draft.results[0], l = lock.results[0];
  return { ...row, grantedTo: p(row.grantedTo) || [], revisions: revs.results.map(hydrateRev),
    draft: d ? { ...d, data: p(d.data) } : null, lock: l && !isStale(l) ? { username: l.username, since: l.since } : null };
}

// Short summary per project (revision codes, draft owner) — the full project via /projects/:id.
app.get("/api/projects", async c => {
  const user = c.get("user");
  const [projects, revs, drafts, locks] = await c.env.DB.batch([
    q(c, "SELECT * FROM projects ORDER BY createdAt DESC"),
    q(c, "SELECT id, projectId, revIndex, code, createdAt FROM revisions ORDER BY projectId, revIndex"),
    q(c, "SELECT projectId, savedBy, savedAt FROM drafts"),
    q(c, "SELECT * FROM edit_locks"),
  ]);
  const R = {}, D = {}, L = {};
  for (const r of revs.results) (R[r.projectId] = R[r.projectId] || []).push({ id: r.id, revIndex: r.revIndex, code: r.code, createdAt: r.createdAt });
  for (const d of drafts.results) D[d.projectId] = { savedBy: d.savedBy, savedAt: d.savedAt };
  for (const l of locks.results) if (!isStale(l)) L[l.projectId] = { username: l.username, since: l.since };
  const out = [];
  for (const r of projects.results) {
    if (!canAccessProject(user, r)) continue;
    out.push({ ...r, grantedTo: p(r.grantedTo) || [], summary: true, revisions: R[r.id] || [], draft: D[r.id] || null, lock: L[r.id] || null });
  }
  return c.json(out);
});
app.get("/api/projects/:id", async c => {
  const row = await projectOr(c); if (row instanceof Response) return row;
  return c.json(await hydrateProject(c, row));
});
app.post("/api/projects", async c => {
  const b = await body(c), user = c.get("user"), admin = isAdmin(user);
  const rec = [typeof b.id === "string" && b.id ? b.id : uid(), b.projectName ?? null, b.client ?? null, b.engineerName ?? null,
    b.refNumber ?? null, b.systemType ?? null, admin ? (b.ownedBy ?? null) : user.username, j(admin ? (b.grantedTo || []) : []),
    b.status || "draft", b.createdAt || now(), now()];
  const st = [q(c, "INSERT INTO projects(id,projectName,client,engineerName,refNumber,systemType,ownedBy,grantedTo,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)", ...rec)];
  const lockId = c.req.header("x-edit-lock");
  if (validLockId(lockId)) st.push(setLockStmt(c, rec[0], user.username, lockId)); // the creating editor holds the lock
  await c.env.DB.batch(st);
  return c.json({ ok: true, id: rec[0] });
});
app.put("/api/projects/:id", async c => {
  const row = await projectOr(c); if (row instanceof Response) return row;
  const lockErr = await holdsLock(c, row.id); if (lockErr) return lockErr;
  const b = await body(c);
  const allowed = ["projectName", "client", "engineerName", "refNumber", "systemType", "status"];
  if (isAdmin(c.get("user"))) allowed.push("ownedBy", "grantedTo");
  const data = {};
  for (const k of allowed) if (k in b) data[k] = b[k];
  if ("grantedTo" in data) data.grantedTo = j(data.grantedTo);
  data.updatedAt = now();
  const cols = Object.keys(data);
  await c.env.DB.batch([q(c, `UPDATE projects SET ${cols.map(k => `${k}=?`).join(", ")} WHERE id=?`, ...cols.map(k => data[k]), row.id), touchLock(c, row.id)]);
  return c.json({ ok: true });
});
app.delete("/api/projects/:id", adminOnly, async c => {
  const id = c.req.param("id");
  await c.env.DB.batch([   // children first (no reliance on foreign-key cascades)
    q(c, "DELETE FROM drafts WHERE projectId=?", id), q(c, "DELETE FROM revisions WHERE projectId=?", id),
    q(c, "DELETE FROM edit_locks WHERE projectId=?", id), q(c, "DELETE FROM projects WHERE id=?", id)]);
  return c.json({ ok: true });
});
app.post("/api/projects/:id/grant", adminOnly, async c => {
  const row = await first(c, "SELECT grantedTo FROM projects WHERE id=?", c.req.param("id"));
  if (!row) return c.json({ ok: false }, 404);
  const { username } = await body(c);
  const granted = [...new Set([...(p(row.grantedTo) || []), username])];
  await run(c, "UPDATE projects SET grantedTo=?, updatedAt=? WHERE id=?", j(granted), now(), c.req.param("id"));
  return c.json({ ok: true });
});
app.post("/api/projects/:id/revoke", adminOnly, async c => {
  const row = await first(c, "SELECT grantedTo FROM projects WHERE id=?", c.req.param("id"));
  if (!row) return c.json({ ok: false }, 404);
  const { username } = await body(c);
  const granted = (p(row.grantedTo) || []).filter(u => u !== username);
  await run(c, "UPDATE projects SET grantedTo=?, updatedAt=? WHERE id=?", j(granted), now(), c.req.param("id"));
  return c.json({ ok: true });
});

// Edit lock: acquire / heartbeat (every 30 s) / admin take over, and release.
app.post("/api/projects/:id/lock", async c => {
  const row = await projectOr(c); if (row instanceof Response) return row;
  const { lockId, takeover } = await body(c), user = c.get("user");
  if (!validLockId(lockId)) return err(c, 400, "bad_request");
  const l = await first(c, "SELECT * FROM edit_locks WHERE projectId=?", row.id);
  const mine = l && l.lockId === lockId;
  if (!mine && !isStale(l) && !(takeover && isAdmin(user)))
    return c.json({ ok: false, error: "locked", lock: { username: l.username, since: l.since } }, 409);
  if (mine) await touchLock(c, row.id).run();                    // plain heartbeat: one small write
  else await setLockStmt(c, row.id, user.username, lockId).run();
  return c.json({ ok: true, lock: { username: user.username, since: mine ? l.since : now() } });
});
app.post("/api/projects/:id/unlock", async c => {
  const { lockId } = await body(c);
  if (validLockId(lockId)) await run(c, "DELETE FROM edit_locks WHERE projectId=? AND lockId=?", c.req.param("id"), lockId);
  return c.json({ ok: true });
});

// ─── Revisions & drafts ──────────────────────────────────────────────────────
app.post("/api/projects/:id/revisions", async c => {
  const row = await projectOr(c); if (row instanceof Response) return row;
  const lockErr = await holdsLock(c, row.id); if (lockErr) return lockErr;
  const b = await body(c);
  const revIndex = (await first(c, "SELECT COUNT(*) n FROM revisions WHERE projectId=?", row.id)).n;
  const rec = revRecord(b, { id: uid(), projectId: row.id, revIndex, createdAt: now() }); // ids set after the body
  await c.env.DB.batch([
    q(c, REV_INSERT(), ...revValues(rec)),
    q(c, "DELETE FROM drafts WHERE projectId=?", row.id),
    q(c, "UPDATE projects SET status='submitted', updatedAt=? WHERE id=?", now(), row.id),
    touchLock(c, row.id),
  ]);
  return c.json({ ok: true, id: rec.id, revIndex });
});
app.post("/api/projects/:id/draft", async c => {
  const row = await projectOr(c); if (row instanceof Response) return row;
  const lockErr = await holdsLock(c, row.id); if (lockErr) return lockErr;
  const { data } = await body(c);
  await c.env.DB.batch([
    q(c, `INSERT INTO drafts(projectId,data,savedBy,savedAt) VALUES(?,?,?,?)
          ON CONFLICT(projectId) DO UPDATE SET data=excluded.data, savedBy=excluded.savedBy, savedAt=excluded.savedAt`,
      row.id, j(data), c.get("user").username, now()),
    q(c, "UPDATE projects SET updatedAt=? WHERE id=?", now(), row.id),
    touchLock(c, row.id),
  ]);
  return c.json({ ok: true });
});
// Admin "Discard draft": deletes the draft and frees the lock.
app.delete("/api/projects/:id/draft", adminOnly, async c => {
  const row = await projectOr(c); if (row instanceof Response) return row;
  await c.env.DB.batch([q(c, "DELETE FROM drafts WHERE projectId=?", row.id), q(c, "DELETE FROM edit_locks WHERE projectId=?", row.id)]);
  return c.json({ ok: true });
});

// ─── Backup / restore in pages (same API as the PC version) ──────────────────
const BACKUP_PAGE = { settings: 1000, users: 1000, priceList: 500, projects: 500, revisions: 100, drafts: 100 };
app.get("/api/backup/part", adminOnly, async c => {
  const table = String(c.req.query("table") || ""), offset = Math.max(0, parseInt(c.req.query("offset"), 10) || 0);
  const limit = BACKUP_PAGE[table];
  if (!limit) return err(c, 400, "bad_table");
  let rows;
  if (table === "settings") rows = (await all(c, "SELECT key, value FROM settings ORDER BY key LIMIT ? OFFSET ?", limit, offset)).map(r => ({ key: r.key, value: p(r.value) }));
  else if (table === "users") rows = (await all(c, "SELECT * FROM users ORDER BY id LIMIT ? OFFSET ?", limit, offset)).map(u => ({ ...u, active: !!u.active }));
  else if (table === "priceList") rows = (await all(c, "SELECT * FROM price_list ORDER BY sortOrder ASC, id LIMIT ? OFFSET ?", limit, offset)).map(hydratePLItem);
  else if (table === "projects") rows = (await all(c, "SELECT * FROM projects ORDER BY createdAt DESC, id LIMIT ? OFFSET ?", limit, offset)).map(r => ({ ...r, grantedTo: p(r.grantedTo) || [] }));
  else if (table === "revisions") rows = (await all(c, "SELECT * FROM revisions ORDER BY projectId, revIndex LIMIT ? OFFSET ?", limit, offset)).map(hydrateRev);
  else rows = (await all(c, "SELECT * FROM drafts ORDER BY projectId LIMIT ? OFFSET ?", limit, offset)).map(d => ({ ...d, data: p(d.data) }));
  return c.json({ rows, next: rows.length === limit ? offset + limit : null });
});
app.post("/api/backup/restore/start", superOnly, async c => {
  const { settings, users } = await body(c), actor = c.get("user");
  const st = ["edit_locks", "drafts", "revisions", "projects", "price_list", "users", "settings"].map(t => q(c, `DELETE FROM ${t}`));
  for (const [k, v] of Object.entries(settings || {})) st.push(q(c, "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, j(v)));
  const INS = "INSERT OR IGNORE INTO users(id,username,displayName,password,role,active,createdAt) VALUES(?,?,?,?,?,?,?)";
  let actorIn = false;
  for (const u of (Array.isArray(users) ? users : [])) {
    if (!u || !u.username) continue;
    if (lc(u.username) === lc(actor.username)) actorIn = true;
    const pw = isHashed(u.password) ? u.password : await hashPassword(u.password || randomHex(12)); // old backups: plain text
    st.push(q(c, INS, u.id || uid(), u.username, u.displayName || "", pw,
      ["presales", "admin", "superadmin"].includes(u.role) ? u.role : "presales", u.active ? 1 : 0, u.createdAt || now()));
  }
  if (!actorIn) st.push(q(c, INS, actor.id, actor.username, actor.displayName || "", actor.password, actor.role, 1, actor.createdAt));
  st.push(bumpPL(c));
  await c.env.DB.batch(st);
  return c.json({ ok: true });
});
app.post("/api/backup/restore/rows", superOnly, async c => {
  const { table, rows: raw } = await body(c);
  const rows = Array.isArray(raw) ? raw : [];
  let st;
  if (table === "priceList") st = [...rows.map((it, i) => q(c, PL_INSERT.replace("INSERT", "INSERT OR IGNORE"), ...normalizePLItem(it, it.sortOrder ?? i))), bumpPL(c)];
  else if (table === "projects") st = rows.map(pr => q(c, "INSERT OR IGNORE INTO projects(id,projectName,client,engineerName,refNumber,systemType,ownedBy,grantedTo,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    pr.id, pr.projectName, pr.client, pr.engineerName, pr.refNumber, pr.systemType, pr.ownedBy, j(pr.grantedTo || []), pr.status || "draft", pr.createdAt || now(), pr.updatedAt || now()));
  else if (table === "revisions") st = rows.map(r => q(c, REV_INSERT("INSERT OR IGNORE"), ...revValues(revRecord(r))));
  else if (table === "drafts") st = rows.map(d => q(c, "INSERT OR IGNORE INTO drafts(projectId,data,savedBy,savedAt) VALUES(?,?,?,?)", d.projectId, j(d.data), d.savedBy || null, d.savedAt || now()));
  else return err(c, 400, "bad_table");
  if (st.length) await c.env.DB.batch(st);
  return c.json({ ok: true, count: rows.length });
});
// The one-shot backup endpoints are too big for one Worker request; the app uses the paged ones.
app.get("/api/backup", c => err(c, 410, "use_paged_backup"));
app.post("/api/backup/restore", c => err(c, 410, "use_paged_restore"));

app.all("/api/*", c => err(c, 404, "not_found"));
app.onError((e, c) => { console.error("[error]", c.req.method, c.req.path, e && e.message); return c.json({ ok: false, error: "server_error" }, 500); });

export default app;

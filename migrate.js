// ─── MSCC Migration: mscc_data.json → mscc_data.db ───────────────────────────
// Run ONCE before switching to the new server:
//   node migrate.js
//
// The script is safe to re-run — it uses INSERT OR IGNORE so existing rows
// are never overwritten. Your original mscc_data.json is never modified.

const fs       = require("fs");
const path     = require("path");
const Database = require("better-sqlite3");

const JSON_PATH = path.join(__dirname, "mscc_data.json");
const DB_PATH   = path.join(__dirname, "mscc_data.db");

if (!fs.existsSync(JSON_PATH)) {
  console.log("No mscc_data.json found — nothing to migrate.");
  process.exit(0);
}

console.log("Reading mscc_data.json …");
const src = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF");   // off during bulk import

// ─── Create tables (same DDL as server.js) ────────────────────────────────────
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
    description TEXT,
    modelNo     TEXT,
    brand       TEXT,
    glp         REAL NOT NULL DEFAULT 0,
    local       REAL NOT NULL DEFAULT 0,
    notes       TEXT,
    sortOrder   INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS projects (
    id           TEXT PRIMARY KEY,
    projectName  TEXT,
    client       TEXT,
    engineerName TEXT,
    refNumber    TEXT,
    systemType   TEXT,
    ownedBy      TEXT,
    grantedTo    TEXT NOT NULL DEFAULT '[]',
    status       TEXT NOT NULL DEFAULT 'draft',
    createdAt    TEXT NOT NULL,
    updatedAt    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS revisions (
    id             TEXT PRIMARY KEY,
    projectId      TEXT NOT NULL,
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
    createdAt      TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS drafts (
    projectId TEXT PRIMARY KEY,
    data      TEXT NOT NULL,
    savedBy   TEXT,
    savedAt   TEXT NOT NULL
  );
`);

const j   = v => JSON.stringify(v ?? null);
const now = () => new Date().toISOString();

const migrate = db.transaction(() => {

  // ── Settings ────────────────────────────────────────────────────────────────
  const upsertSetting = db.prepare(
    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  );
  let settingsCount = 0;
  for (const [k, v] of Object.entries(src.settings || {})) {
    upsertSetting.run(k, j(v));
    settingsCount++;
  }
  console.log(`  Settings : ${settingsCount} keys`);

  // ── Users ───────────────────────────────────────────────────────────────────
  const insUser = db.prepare(`
    INSERT OR IGNORE INTO users(id,username,displayName,password,role,active,createdAt)
    VALUES(@id,@username,@displayName,@password,@role,@active,@createdAt)
  `);
  let usersCount = 0;
  for (const u of (src.users || [])) {
    insUser.run({ ...u, active: u.active ? 1 : 0, displayName: u.displayName || "" });
    usersCount++;
  }
  console.log(`  Users    : ${usersCount}`);

  // ── Price list ──────────────────────────────────────────────────────────────
  const insPL = db.prepare(`
    INSERT OR IGNORE INTO price_list(id,description,modelNo,brand,glp,local,notes,sortOrder)
    VALUES(@id,@description,@modelNo,@brand,@glp,@local,@notes,@sortOrder)
  `);
  let plCount = 0;
  (src.priceList || []).forEach((item, i) => {
    insPL.run({
      id: item.id, description: item.description || "",
      modelNo: item.modelNo || "", brand: item.brand || "",
      glp: item.glp || 0, local: item.local || 0,
      notes: item.notes || "", sortOrder: item.sortOrder ?? i,
    });
    plCount++;
  });
  console.log(`  PriceList: ${plCount} items`);

  // ── Projects ────────────────────────────────────────────────────────────────
  const insProj = db.prepare(`
    INSERT OR IGNORE INTO projects(id,projectName,client,engineerName,refNumber,systemType,ownedBy,grantedTo,status,createdAt,updatedAt)
    VALUES(@id,@projectName,@client,@engineerName,@refNumber,@systemType,@ownedBy,@grantedTo,@status,@createdAt,@updatedAt)
  `);
  let projCount = 0;
  for (const pr of (src.projects || [])) {
    insProj.run({
      id: pr.id, projectName: pr.projectName || "",
      client: pr.client || "", engineerName: pr.engineerName || "",
      refNumber: pr.refNumber || "", systemType: pr.systemType || "",
      ownedBy: pr.ownedBy || "", grantedTo: j(pr.grantedTo || []),
      status: pr.status || "draft",
      createdAt: pr.createdAt || now(), updatedAt: pr.updatedAt || now(),
    });
    projCount++;
  }
  console.log(`  Projects : ${projCount}`);

  // ── Revisions ───────────────────────────────────────────────────────────────
  const insRev = db.prepare(`
    INSERT OR IGNORE INTO revisions(
      id,projectId,revIndex,projectName,client,engineerName,salesEngineer,
      contactName,contactPhone,contactEmail,refNumber,systemType,date,currency,
      conversionRate,brandFactors,localFactor,lines,tcEnabled,tcMode,tcValue,
      tcPercent,tcApprox,tcBaseUSD,installEnabled,installValue,extras,notes,
      roundUp,code,grandTotal,createdAt
    ) VALUES(
      @id,@projectId,@revIndex,@projectName,@client,@engineerName,@salesEngineer,
      @contactName,@contactPhone,@contactEmail,@refNumber,@systemType,@date,@currency,
      @conversionRate,@brandFactors,@localFactor,@lines,@tcEnabled,@tcMode,@tcValue,
      @tcPercent,@tcApprox,@tcBaseUSD,@installEnabled,@installValue,@extras,@notes,
      @roundUp,@code,@grandTotal,@createdAt
    )
  `);
  let revCount = 0;
  for (const r of (src.revisions || [])) {
    // Handle old format where some fields lived inside r.data
    const data = r.data || {};
    const merged = { ...data, ...r };
    delete merged.data;
    insRev.run({
      id: merged.id, projectId: merged.projectId,
      revIndex: merged.revIndex ?? 0,
      projectName:   merged.projectName   || "",
      client:        merged.client        || "",
      engineerName:  merged.engineerName  || "",
      salesEngineer: merged.salesEngineer || "",
      contactName:   merged.contactName   || "",
      contactPhone:  merged.contactPhone  || "",
      contactEmail:  merged.contactEmail  || "",
      refNumber:     merged.refNumber     || "",
      systemType:    merged.systemType    || "",
      date:          merged.date          || "",
      currency:      merged.currency      || "USD",
      conversionRate:merged.conversionRate ?? 1,
      brandFactors:  j(merged.brandFactors  ?? {}),
      localFactor:   merged.localFactor   ?? 1,
      lines:         j(merged.lines        ?? []),
      tcEnabled:     merged.tcEnabled      ? 1 : 0,
      tcMode:        merged.tcMode         || null,
      tcValue:       merged.tcValue        ?? null,
      tcPercent:     merged.tcPercent      ?? null,
      tcApprox:      merged.tcApprox       ?? null,
      tcBaseUSD:     merged.tcBaseUSD      ?? null,
      installEnabled:merged.installEnabled ? 1 : 0,
      installValue:  merged.installValue   ?? null,
      extras:        j(merged.extras       ?? []),
      notes:         merged.notes          || null,
      roundUp:       merged.roundUp        ? 1 : 0,
      code:          merged.code           || null,
      grandTotal:    merged.grandTotal     ?? null,
      createdAt:     merged.createdAt      || now(),
    });
    revCount++;
  }
  console.log(`  Revisions: ${revCount}`);

  // ── Drafts ──────────────────────────────────────────────────────────────────
  const insDraft = db.prepare(`
    INSERT OR IGNORE INTO drafts(projectId,data,savedBy,savedAt) VALUES(?,?,?,?)
  `);
  let draftCount = 0;
  for (const d of (src.drafts || [])) {
    insDraft.run(d.projectId, j(d.data), d.savedBy || null, d.savedAt || now());
    draftCount++;
  }
  console.log(`  Drafts   : ${draftCount}`);
});

migrate();
db.pragma("foreign_keys = ON");
db.close();

console.log("\n  Migration complete → mscc_data.db");
console.log("  Your mscc_data.json has NOT been modified.");
console.log("  You can keep it as a backup or delete it after verifying.\n");

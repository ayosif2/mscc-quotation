-- MSCC Quotation System — D1 schema (same tables as server.js, v1.4.0)
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

CREATE TABLE IF NOT EXISTS edit_locks (
  projectId TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  username  TEXT NOT NULL,
  lockId    TEXT NOT NULL,
  since     TEXT NOT NULL,
  heartbeat INTEGER NOT NULL
);

-- token signing secret, price-list version
CREATE TABLE IF NOT EXISTS auth_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- failed sign-ins (the PC version keeps these in memory; a Worker has no memory between requests)
CREATE TABLE IF NOT EXISTS auth_fails (key TEXT PRIMARY KEY, n INTEGER NOT NULL, first INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS idx_revisions_project ON revisions(projectId, revIndex);
CREATE INDEX IF NOT EXISTS idx_users_username_lc ON users(lower(username));

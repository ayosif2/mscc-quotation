// Export the PC database (mscc_data.db) to a .sql file that Cloudflare D1 can import.
//   node scripts/export-d1.cjs ../mscc_data.db data/import
// writes data/import-001.sql, data/import-002.sql, … (about 1 MB each — one huge file fails to import)
// Opens the database read-only (safe while the PC server is running).
// D1 limits each SQL statement to 100 KB, so long text values (big revisions) are written as an
// INSERT followed by UPDATE … SET col = col || '…' pieces.
// Usage counters are not exported; edit locks and failed sign-ins start empty.
const path = require("path");
const fs = require("fs");
const Database = require(path.join(__dirname, "..", "..", "node_modules", "better-sqlite3"));

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error("usage: node scripts/export-d1.cjs <mscc_data.db> <out.sql>"); process.exit(1); }
const db = new Database(src, { readonly: true, fileMustExist: true });

const PIECE = 20000; // characters per statement piece (≤ ~60 KB even for 3-byte characters)
const lit = v => v === null || v === undefined ? "NULL"
  : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "NULL")
  : typeof v === "bigint" ? v.toString()
  : "'" + String(v).replace(/'/g, "''") + "'";

const TABLES = [ // parents before children (foreign keys)
  { name: "settings", pk: "key" },
  { name: "users", pk: "id" },
  { name: "price_list", pk: "id" },
  { name: "projects", pk: "id" },
  { name: "revisions", pk: "id" },
  { name: "drafts", pk: "projectId" },
];

const lines = []; // each entry = one row: its INSERT plus any UPDATE pieces (kept together in one file)
const counts = {}, skipped = {};
// Revisions / drafts whose project was deleted (left behind by old versions) can't be opened in the
// app and would break D1's foreign-key check, so they are left out — and counted.
const ORPHAN_FILTER = { revisions: "projectId IN (SELECT id FROM projects)", drafts: "projectId IN (SELECT id FROM projects)" };
for (const t of TABLES) {
  const where = ORPHAN_FILTER[t.name];
  const rows = db.prepare(`SELECT * FROM ${t.name}${where ? " WHERE " + where : ""}`).all();
  if (where) skipped[t.name] = db.prepare(`SELECT COUNT(*) c FROM ${t.name} WHERE NOT (${where})`).get().c;
  counts[t.name] = rows.length;
  for (const r of rows) {
    const cols = Object.keys(r);
    const tail = [];
    const vals = cols.map(c => {
      const v = r[c];
      if (typeof v === "string" && v.length > PIECE) {
        for (let i = PIECE; i < v.length; i += PIECE) tail.push(`UPDATE ${t.name} SET ${c} = ${c} || ${lit(v.slice(i, i + PIECE))} WHERE ${t.pk} = ${lit(r[t.pk])};`);
        return lit(v.slice(0, PIECE));
      }
      return lit(v);
    });
    lines.push([`INSERT OR REPLACE INTO ${t.name}(${cols.join(",")}) VALUES(${vals.join(",")});`, ...tail].join("\n"));
  }
}
// token secret (so the same signing key is used) and the price-list version
for (const k of ["token_secret", "pricelist_version"]) {
  const r = db.prepare("SELECT value FROM auth_meta WHERE key=?").get(k);
  if (r) lines.push(`INSERT OR REPLACE INTO auth_meta(key,value) VALUES(${lit(k)},${lit(r.value)});`);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
for (const f of fs.readdirSync(path.dirname(out))) if (f.startsWith(path.basename(out) + "-") && f.endsWith(".sql")) fs.unlinkSync(path.join(path.dirname(out), f));
const LIMIT = 1024 * 1024, files = [];
let cur = [], size = 0;
const flush = () => { if (!cur.length) return; const f = `${out}-${String(files.length + 1).padStart(3, "0")}.sql`; fs.writeFileSync(f, cur.join("\n") + "\n"); files.push(f); cur = []; size = 0; };
for (const row of lines) { const b = Buffer.byteLength(row) + 1; if (size + b > LIMIT) flush(); cur.push(row); size += b; }
flush();
const longest = Math.max(...lines.flatMap(r => r.split("\n")).map(l => Buffer.byteLength(l)));
console.log("exported:", counts);
console.log("skipped (their project was deleted):", skipped);
console.log(`files: ${files.length} (~1 MB each), longest statement: ${(longest / 1024).toFixed(1)} KB (D1 limit 100 KB)`);

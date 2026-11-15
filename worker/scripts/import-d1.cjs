// Import every data/import-*.sql file into D1, in order.
//   node scripts/import-d1.cjs --local      (wrangler dev database on this PC)
//   node scripts/import-d1.cjs --remote     (the real Cloudflare database — phase 3)
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const where = process.argv[2];
if (!["--local", "--remote"].includes(where)) { console.error("usage: node scripts/import-d1.cjs --local|--remote"); process.exit(1); }
const dir = path.join(__dirname, "..", "data");
const files = fs.readdirSync(dir).filter(f => /^import-\d{3}\.sql$/.test(f)).sort();
if (!files.length) { console.error("no data/import-*.sql files — run: npm run db:export"); process.exit(1); }
const wrangler = path.join(__dirname, "..", "node_modules", "wrangler", "bin", "wrangler.js");
for (const [i, f] of files.entries()) {
  process.stdout.write(`[${i + 1}/${files.length}] ${f} … `);
  execFileSync(process.execPath, [wrangler, "d1", "execute", "DB", where, "--yes", "--file", path.join(dir, f)], { stdio: ["ignore", "ignore", "inherit"] });
  console.log("ok");
}
console.log("done");

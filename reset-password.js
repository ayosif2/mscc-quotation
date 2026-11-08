// Emergency password reset (run on the server PC):
//   node reset-password.js <username> <newPassword>
// Use this if the superadmin password is lost. Stop nothing — it is safe to run while the server is up.
const path = require("path");
const Database = require("better-sqlite3");
const { hashPassword, MIN_PASSWORD } = require("./auth-utils");

const [, , username, newPassword] = process.argv;
if (!username || !newPassword) { console.log("Usage: node reset-password.js <username> <newPassword>"); process.exit(1); }
if (newPassword.length < MIN_PASSWORD) { console.log(`Password must be at least ${MIN_PASSWORD} characters.`); process.exit(1); }

const db = new Database(process.env.MSCC_DB || path.join(__dirname, "mscc_data.db"));
const u = db.prepare("SELECT id, username FROM users WHERE lower(username)=lower(?)").get(username);
if (!u) { console.log(`No user named "${username}".`); process.exit(1); }
db.prepare("UPDATE users SET password=?, active=1 WHERE id=?").run(hashPassword(newPassword), u.id);
console.log(`Password for "${u.username}" updated and account activated. All their old sessions are now invalid.`);

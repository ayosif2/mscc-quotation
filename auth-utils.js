// ─── MSCC auth helpers (password hashing + signed session tokens) ────────────
// Uses only Node's built-in crypto — no extra npm packages needed.
const crypto = require("crypto");

// Two stored formats:
//   pbkdf2$<rounds>$<salt hex>$<hash hex>  — current (v1.4.0). Cloudflare Workers can check it cheaply
//                                            (Web Crypto), so it is the only format the Worker accepts.
//   scrypt$<salt hex>$<hash hex>           — older. Still accepted here; upgraded to pbkdf2 on sign-in.
const SCRYPT_RE = /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/;
const PBKDF2_RE = /^pbkdf2\$\d{4,7}\$[0-9a-f]{32}\$[0-9a-f]{64}$/;
const PBKDF2_ROUNDS = 30000; // keep in sync with worker/src/auth.js — sized for the Workers 10 ms CPU budget
const MIN_PASSWORD = 8;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.pbkdf2Sync(String(pw), salt, PBKDF2_ROUNDS, 32, "sha256");
  return `pbkdf2$${PBKDF2_ROUNDS}$${salt.toString("hex")}$${h.toString("hex")}`;
}
const isHashed = s => typeof s === "string" && (PBKDF2_RE.test(s) || SCRYPT_RE.test(s));
const needsRehash = s => !(typeof s === "string" && PBKDF2_RE.test(s) && Number(s.split("$")[1]) === PBKDF2_ROUNDS);

function verifyPassword(pw, stored) {
  if (typeof stored !== "string") return false;
  if (PBKDF2_RE.test(stored)) {
    const [, rounds, salt, hash] = stored.split("$");
    const h = crypto.pbkdf2Sync(String(pw), Buffer.from(salt, "hex"), Number(rounds), 32, "sha256");
    return crypto.timingSafeEqual(h, Buffer.from(hash, "hex"));
  }
  if (SCRYPT_RE.test(stored)) {
    const [, salt, hash] = stored.split("$");
    const h = crypto.scryptSync(String(pw), Buffer.from(salt, "hex"), 64);
    return crypto.timingSafeEqual(h, Buffer.from(hash, "hex"));
  }
  return false;
}

// Token = base64url(payload) + "." + HMAC-SHA256(payload).
// "pv" ties a token to the user's current password hash, so changing a
// password instantly invalidates every session that was issued before it.
const b64u = b => Buffer.from(b).toString("base64url");
const sign = (payload, secret) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");

function signToken(user, secret, ttlMs) {
  const payload = b64u(JSON.stringify({ u: user.username, pv: user.password.slice(-12), exp: Date.now() + ttlMs }));
  return payload + "." + sign(payload, secret);
}

function verifyToken(token, secret) {
  if (typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload, secret);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

module.exports = { MIN_PASSWORD, hashPassword, verifyPassword, isHashed, needsRehash, signToken, verifyToken };

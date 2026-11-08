// ─── MSCC auth helpers (password hashing + signed session tokens) ────────────
// Uses only Node's built-in crypto — no extra npm packages needed.
const crypto = require("crypto");

const HASH_RE = /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/;
const MIN_PASSWORD = 8;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString("hex")}$${h.toString("hex")}`;
}
const isHashed = s => typeof s === "string" && HASH_RE.test(s);

function verifyPassword(pw, stored) {
  if (!isHashed(stored)) return false;
  const [, salt, hash] = stored.split("$");
  const h = crypto.scryptSync(String(pw), Buffer.from(salt, "hex"), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, "hex"));
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

module.exports = { MIN_PASSWORD, hashPassword, verifyPassword, isHashed, signToken, verifyToken };

// ─── MSCC auth helpers for Cloudflare Workers (Web Crypto) ───────────────────
// Same formats as ../auth-utils.js, so data and sessions move between the two versions:
//   password: pbkdf2$<rounds>$<salt hex>$<hash hex>   (older scrypt$… hashes can't be checked here)
//   token:    base64url(JSON {u, pv, exp}) + "." + base64url(HMAC-SHA256(payload, secret))
export const MIN_PASSWORD = 8;
export const PBKDF2_ROUNDS = 30000; // keep in sync with ../auth-utils.js — sized for the 10 ms CPU budget

const enc = new TextEncoder();
const PBKDF2_RE = /^pbkdf2\$\d{4,7}\$[0-9a-f]{32}\$[0-9a-f]{64}$/;
const SCRYPT_RE = /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/;

const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const fromHex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
function b64u(bytes) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64u(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
  return Uint8Array.from(s, ch => ch.charCodeAt(0));
}
function sameBytes(a, b) {            // constant-time compare
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function pbkdf2(pw, salt, rounds) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(pw)), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256));
}

export async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ROUNDS}$${toHex(salt)}$${toHex(await pbkdf2(pw, salt, PBKDF2_ROUNDS))}`;
}
export const isHashed = s => typeof s === "string" && (PBKDF2_RE.test(s) || SCRYPT_RE.test(s));
export const isLegacyHash = s => typeof s === "string" && SCRYPT_RE.test(s);
export const needsRehash = s => !(typeof s === "string" && PBKDF2_RE.test(s) && Number(s.split("$")[1]) === PBKDF2_ROUNDS);

// true / false. (Legacy scrypt hashes always give false — check isLegacyHash first.)
export async function verifyPassword(pw, stored) {
  if (typeof stored !== "string" || !PBKDF2_RE.test(stored)) return false;
  const [, rounds, salt, hash] = stored.split("$");
  return sameBytes(await pbkdf2(pw, fromHex(salt), Number(rounds)), fromHex(hash));
}

async function hmac(payload, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload))));
}
export async function signToken(user, secret, ttlMs) {
  const payload = b64u(enc.encode(JSON.stringify({ u: user.username, pv: user.password.slice(-12), exp: Date.now() + ttlMs })));
  return payload + "." + await hmac(payload, secret);
}
export async function verifyToken(token, secret) {
  if (typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if (!sameBytes(enc.encode(sig), enc.encode(await hmac(payload, secret)))) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64u(payload)));
    if (!data || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}
export const randomHex = n => toHex(crypto.getRandomValues(new Uint8Array(n)));

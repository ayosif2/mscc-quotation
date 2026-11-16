// Talking to the server: requests, connection status, edit-lock header, data helpers, error messages, roles.
// Split out of app.jsx in v2.0.0 — the code itself is unchanged.
import { useState, useEffect } from "react";
import { DEFAULT_SETTINGS } from "./constants.js";

// ─── API ──────────────────────────────────────────────────────────────────────
// The built site is served from the same origin as the API — server.js on the PC, or the Cloudflare
// Worker online — so a relative "/api" works on localhost, a LAN IP or a public domain.
// `npm run dev` proxies /api to the PC server (vite.config.js).
// (Before v2.0.0 there was also a browser-only demo mode with no server; it has been removed.)
export const API = "/api";
export const LS = { get: k => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } }, set: (k,v) => { try { localStorage.setItem(k,JSON.stringify(v)); } catch {} } };

// ─── Connection status ──────────────────────────────────────────────────────
// "unknown"  = server configured, haven't confirmed reachability yet.
// "online" / "offline" = last real request succeeded / failed to reach the server.
export let connStatus = "unknown";
export const connListeners = new Set();
export function setConnStatus(s){ if(connStatus===s)return; connStatus=s; connListeners.forEach(fn=>fn(s)); }
export function useConnStatus(){
  const [s,setS]=useState(connStatus);
  useEffect(()=>{ connListeners.add(setS); return ()=>connListeners.delete(setS); },[]);
  return s;
}

// Every real request to the server updates connStatus as a side effect, so the
// badge and the save/submit feedback are always based on the same source of truth —
// there's no separate "ping" that can go stale by the time the real save happens.
export const authHeaders = () => { const t = LS.get("mscc_session")?.token; return t ? { Authorization:`Bearer ${t}` } : {}; };
// Edit lock (v1.1.0): the open project editor sets this to its own random id. It is sent
// with every request so the server only accepts draft saves / submits from the window
// that holds the project's lock. Only one editor is open per browser tab at a time.
export let currentEditLock = null;
export const lockHeaders = () => currentEditLock ? { "X-Edit-Lock": currentEditLock } : {};
export const getEditLock = () => currentEditLock;
export const setEditLock = id => { currentEditLock = id; };
export function forceLogout(){ LS.set("mscc_session",null); window.location.reload(); }
export async function apiCall(path, opts={}) {
  try {
    const r = await fetch(`${API}${path}`, { ...opts, headers:{"Content-Type":"application/json", ...authHeaders(), ...lockHeaders(), ...(opts.headers||{})} });
    setConnStatus("online"); // reached the server at all, even if it returned an error status
    if (r.status===401) { forceLogout(); return { ok:false, data:null, status:401 }; } // session expired / password changed / account disabled
    if (!r.ok) { let data=null; try{ data = await r.json(); }catch{} return { ok:false, data, status:r.status, error:data?.error }; }
    let data=null; try{ data = await r.json(); }catch{ data=null; }
    return { ok:true, data };
  } catch (e) {
    setConnStatus("offline");
    return { ok:false, data:null, error:e };
  }
}
// Back-compat helper for reads that just want data-or-null (they already fall back to localStorage on a miss).
export async function apiFetch(path, opts={}) {
  const r = await apiCall(path, opts);
  return r.ok ? r.data : null;
}
// Lightweight reachability probe, reusing the existing /settings endpoint so no new backend route is required.
export async function checkConnection(){ await apiCall("/ping"); } // tiny request (v1.3.0; used to re-download all settings)

export const uid = () => Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-4);
export const now = () => new Date().toISOString();

// ─── Data helpers ─────────────────────────────────────────────────────────────
// Every write returns { ok, status, error } so the screen can say *why* it failed (see failMsg).
export const res = r => ({ ok:r.ok, status:r.status, error:r.data?.error });

export async function loadSettings() {
  const r = await apiFetch("/settings");
  if (r && Object.keys(r).length) { const s={...DEFAULT_SETTINGS}; if(r.company)s.company={...DEFAULT_SETTINGS.company,...r.company}; if(r.defaultCurrency)s.defaultCurrency=r.defaultCurrency; if(r.defaultLocalFactor!==undefined)s.defaultLocalFactor=r.defaultLocalFactor; if(r.defaultBrandFactors)s.defaultBrandFactors=r.defaultBrandFactors; if(r.templates)s.templates=r.templates; if(r.defaultTemplateId)s.defaultTemplateId=r.defaultTemplateId; LS.set("mscc_settings",s); return s; }
  return LS.get("mscc_settings") || DEFAULT_SETTINGS; // last settings seen, if the server can't be reached
}
export async function saveSettings(s) { const r=await apiCall("/settings",{method:"POST",body:JSON.stringify({company:s.company,defaultCurrency:s.defaultCurrency,defaultLocalFactor:s.defaultLocalFactor,defaultBrandFactors:s.defaultBrandFactors,templates:s.templates,defaultTemplateId:s.defaultTemplateId})}); if(r.ok)LS.set("mscc_settings",s); return res(r); }
export async function loadUsers() { return (await apiFetch("/users")) || []; }
export async function saveUser(u,isNew) { return res(await apiCall(isNew?"/users":`/users/${u.id}`,{method:isNew?"POST":"PUT",body:JSON.stringify(u)})); }
export async function loadPriceList() { return (await apiFetch("/pricelist")) || []; }
export async function replacePriceList(items) { return res(await apiCall("/pricelist/replace",{method:"POST",body:JSON.stringify(items)})); }
export async function appendPriceList(items) { return res(await apiCall("/pricelist/append",{method:"POST",body:JSON.stringify(items)})); }
export async function updatePriceItem(item) { return res(await apiCall(`/pricelist/${item.id}`,{method:"PUT",body:JSON.stringify(item)})); }
export async function addPriceItem(item) { return res(await apiCall("/pricelist",{method:"POST",body:JSON.stringify(item)})); }
export async function deletePriceItem(id) { return res(await apiCall(`/pricelist/${id}`,{method:"DELETE"})); }
// The list is a short summary per project (v1.3.0): revision codes and the draft's owner only.
export async function loadProjects() { return (await apiFetch("/projects")) || []; }
// One project with all revision and draft contents — load this before editing, viewing or duplicating.
export async function loadProject(id) { return await apiFetch(`/projects/${id}`); }
export const ensureFullProject = async p => (p && p.summary ? await loadProject(p.id) : p);
export async function createProject(p) { const r=await apiCall("/projects",{method:"POST",body:JSON.stringify(p)}); return {...res(r),id:r.data?.id||p.id}; }
export async function updateProject(p) { const r=await apiCall(`/projects/${p.id}`,{method:"PUT",body:JSON.stringify(p)}); return {...res(r),lockLost:r.status===409,lock:r.data?.lock}; }
export async function deleteProject(id) { return res(await apiCall(`/projects/${id}`,{method:"DELETE"})); }
export async function submitRevision(projectId,rev) { const r=await apiCall(`/projects/${projectId}/revisions`,{method:"POST",body:JSON.stringify(rev)}); return {...res(r),lockLost:r.status===409,lock:r.data?.lock}; }
export async function saveDraft(projectId,data,savedBy) { const r=await apiCall(`/projects/${projectId}/draft`,{method:"POST",body:JSON.stringify({data,savedBy})}); return {...res(r),lockLost:r.status===409,lock:r.data?.lock}; }
export async function clearDraft(projectId) { return res(await apiCall(`/projects/${projectId}/draft`,{method:"DELETE"})); }
// Edit locks.
export async function acquireLock(projectId,lockId,takeover) { const r=await apiCall(`/projects/${projectId}/lock`,{method:"POST",body:JSON.stringify({lockId,takeover:!!takeover})}); return{ok:r.ok,locked:r.status===409,lock:r.data?.lock,offline:!r.ok&&!r.status}; }
export function releaseLock(projectId,lockId) { if(!projectId)return Promise.resolve(); try{ return fetch(`${API}/projects/${projectId}/unlock`,{method:"POST",keepalive:true,headers:{"Content-Type":"application/json",...authHeaders()},body:JSON.stringify({lockId})}).catch(()=>{}); }catch{ return Promise.resolve(); } }
// Projects-list helpers for the draft / lock owner.
export const draftOwner = d => d ? (d.savedBy||d._savedBy||"") : "";
export const draftTime  = d => d && (d.savedAt||d._savedAt) ? new Date(d.savedAt||d._savedAt).toLocaleString() : "";
export async function grantAccess(projectId,username) { return res(await apiCall(`/projects/${projectId}/grant`,{method:"POST",body:JSON.stringify({username})})); }
export async function revokeAccess(projectId,username) { return res(await apiCall(`/projects/${projectId}/revoke`,{method:"POST",body:JSON.stringify({username})})); }

export const MIN_PW = 8; // keep in sync with MIN_PASSWORD in auth-utils.js and worker/src/auth.js

// ─── Error messages (v2.0.0) ─────────────────────────────────────────────────
// Turns a failed request into "<what did not happen>. <why>". Before v2.0.0 every failure said
// "Could not reach the server", even when the server had answered with a refusal.
export const ERROR_TEXT = {
  forbidden: "You don't have permission to do this.",
  too_short: `Passwords must be at least ${MIN_PW} characters.`,
  exists: "That username is already taken.",
  bad_username: "That username isn't valid (1–60 characters).",
  bad_role: "That role can't be assigned.",
  cannot_deactivate: "You can't deactivate your own account or the superadmin.",
  wrong_password: "The current password is wrong.",
  bad_request: "The server rejected the data that was sent.",
  bad_table: "The server rejected the data that was sent.",
  locked: "Someone else is editing this project.",
  lock_lost: "Someone else has taken over editing this project.",
  too_many_attempts: "Too many failed attempts. Try again in 15 minutes.",
  server_error: "The server ran into an error. Try again; if it keeps happening, tell the admin.",
};
export function failMsg(r, what, overrides={}) {
  const head = what ? what.charAt(0).toUpperCase()+what.slice(1)+"." : "";
  if (!r || !r.status) return `Could not reach the server — ${what||"nothing was saved"}. Check your connection and try again.`;
  const why = overrides[r.error] || overrides[r.status] || ERROR_TEXT[r.error]
    || (r.status===403 ? ERROR_TEXT.forbidden
      : r.status===404 ? "It no longer exists — someone may have deleted it. Reload the page."
      : r.status===413 ? "It is too large for the server to accept."
      : r.status===429 ? "The server is busy. Wait a minute and try again."
      : `The server answered with error ${r.status}.`);
  return `${head} ${why}`.trim();
}
// User Management: who may change whom.
export const USER_RULES = { forbidden: "Only the superadmin can create or change admin accounts, and the superadmin account can't be changed here." };
// Returns true for both "admin" and "superadmin"
export const isAdmin = u => u && (u.role==="admin" || u.role==="superadmin");
export const isSuperAdmin = u => u && u.role==="superadmin";

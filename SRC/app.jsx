import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";
import ExcelJS from "exceljs";
import JSZip from 'jszip';

//styles
const tot_Normal_Style = "border:1px solid #ddd;padding:7px 10px;text-align:right;font-weight:700;";
const tot_emphasized_style = "border:1px solid #ddd;padding:8px 10px;text-align:right;font-weight:700;font-size:14px;color:#c0392b;";
// ─── API ──────────────────────────────────────────────────────────────────────
// Three cases:
//  - Previewed inside Claude.ai itself (no real backend reachable) -> no API, local-storage-only demo mode.
//  - `npm run dev` (Vite dev server, frontend and backend on different ports) -> explicit cross-port URL.
//  - Everything else (this is how start.bat runs it: built dist served by server.js) -> same-origin app,
//    so a relative "/api" path works correctly regardless of protocol/host/port — localhost, LAN IP,
//    or a public HTTPS domain through a tunnel all resolve correctly with no hardcoding.
const IN_CLAUDE_PREVIEW = (() => { try { return window.location.hostname.includes("anthropic") || window.location.hostname.includes("claude.ai"); } catch { return false; } })();
const API = IN_CLAUDE_PREVIEW ? null : (import.meta.env.DEV ? `http://${window.location.hostname}:3001/api` : "/api");
const LS = { get: k => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } }, set: (k,v) => { try { localStorage.setItem(k,JSON.stringify(v)); } catch {} } };

// ─── Connection status ──────────────────────────────────────────────────────
// "disabled" = no server configured for this deployment (nothing to check).
// "unknown"  = server configured, haven't confirmed reachability yet.
// "online" / "offline" = last real request succeeded / failed to reach the server.
let connStatus = API ? "unknown" : "disabled";
const connListeners = new Set();
function setConnStatus(s){ if(connStatus===s)return; connStatus=s; connListeners.forEach(fn=>fn(s)); }
function useConnStatus(){
  const [s,setS]=useState(connStatus);
  useEffect(()=>{ connListeners.add(setS); return ()=>connListeners.delete(setS); },[]);
  return s;
}

// Every real request to the server updates connStatus as a side effect, so the
// badge and the save/submit feedback are always based on the same source of truth —
// there's no separate "ping" that can go stale by the time the real save happens.
const authHeaders = () => { const t = LS.get("mscc_session")?.token; return t ? { Authorization:`Bearer ${t}` } : {}; };
// Edit lock (v1.1.0): the open project editor sets this to its own random id. It is sent
// with every request so the server only accepts draft saves / submits from the window
// that holds the project's lock. Only one editor is open per browser tab at a time.
let currentEditLock = null;
const lockHeaders = () => currentEditLock ? { "X-Edit-Lock": currentEditLock } : {};
function forceLogout(){ LS.set("mscc_session",null); window.location.reload(); }
async function apiCall(path, opts={}) {
  if (!API) return { ok:true, data:null, noServer:true };
  try {
    const r = await fetch(`${API}${path}`, { ...opts, headers:{"Content-Type":"application/json", ...authHeaders(), ...lockHeaders(), ...(opts.headers||{})} });
    setConnStatus("online"); // reached the server at all, even if it returned an error status
    if (r.status===401) { forceLogout(); return { ok:false, data:null, status:401 }; } // session expired / password changed / account disabled
    if (!r.ok) { let data=null; try{ data = await r.json(); }catch{} return { ok:false, data, status:r.status }; }
    let data=null; try{ data = await r.json(); }catch{ data=null; }
    return { ok:true, data };
  } catch (e) {
    setConnStatus("offline");
    return { ok:false, data:null, error:e };
  }
}
// Back-compat helper for reads that just want data-or-null (they already fall back to localStorage on a miss).
async function apiFetch(path, opts={}) {
  const r = await apiCall(path, opts);
  return r.ok ? r.data : null;
}
// Lightweight reachability probe, reusing the existing /settings endpoint so no new backend route is required.
async function checkConnection(){ if(API) await apiCall("/settings"); }

const uid = () => Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-4);
const now = () => new Date().toISOString();

// ─── Constants ────────────────────────────────────────────────────────────────
const LOGO_URL = "https://static.wixstatic.com/media/0b6472_98229db8a906487eb945955cdb276022~mv2.png/v1/fill/w_259,h_125,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/0b6472_98229db8a906487eb945955cdb276022~mv2.png";
const SITE_URL = "https://www.mscc-eg.com/";
// Injected at build time from package.json by vite.config.js (bump it with release.ps1).
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
// Bundled Excel output template. Place the .xlsx file at this path under /public
// (served as a static asset — works the same under `npm run dev` and under
// start.bat's built dist served by server.js, since it's just a GET of a static file).
// Nothing ever writes back to this file: every export re-fetches these bytes fresh
// and edits an in-memory copy, so the template on disk is never touched.
const XLSX_TEMPLATE_URL = "/templates/quotation_template.xlsx";
const DEFAULT_SETTINGS = {
  company:{ name:"Mega Systems & Control Co.", address:"49 Abbas Elakkad, Nasr City, Cairo", poBox:"P.O. Box 8077", city:"11371 Nasr City, Cairo", phone:"+202-24011172/3", mobile:"+20-1017848999", email:"info@mscc-eg.com" },
  defaultCurrency:"USD", defaultLocalFactor:1, defaultBrandFactors:{},
  templates:[{ id:"default", name:"Default Template",
    coverLetter:`Dear Sir,\n\nThank you for giving Mega Systems & Control the opportunity to present you with this proposal for your inquiry. This document contains our budgetary quotation & payment terms. Please find here below our proposal prepared as per provided project documents.\n\nPayment & Terms\n\nPrices:\nAll prices exclude VAT.\nAll prices are in {currency}.\n\nValidity: 3 Days from offer date.\nWarranty: 12 Months from elementary Hand over Date.\n\nPayment\n*Down payments against check (No additional charges)\n\nA) For Material\n50% down payment, 50% upon material readiness.\n\nB) For Engineering, T&C\n50% Down Payment, 50% after final submission`,
    termsAndConditions:`1. The return of items are allowed within 3 days from the date of receipt of the items without any discounts.\n2. 5% administrative expenses are deducted from the value of the total invoice in case of return within 14 days from the date of receipt.\n3. It will not be allowed to accept the return after 14 days from the date of receipt except in the event of manufacturing defects.\n4. The company is not responsible for running out of quantity (stock availability) in case of delayed purchase.\n5. The validity of the PO is two days maximum.\n6. In case of non stock items, the new items are delivered at the daily dollar rate.\n7. The validity of the offer is 3 days.\n8. The PO does not imply the reservation of the items.\n9. Our prices for T&C inside Cairo and Giza otherwise transportation and accommodation to be added.\n10. Supervision include: Testing of wires & devices; Programming; Testing the system; Training; Documentation if needed; Graphics if needed.\n11. Warranty certificate and Graphics Dongle (if included) will be provided after last payment.\n12. Number of Supervision visits to be set based on technical team assessment (1 visit before installation & 1 visit/4 loops).\n13. Visit requests shall take 5 to 7 working days to be processed.\n14. Single line diagrams, Riser diagrams, Shop drawings are essential for revision before installation.\n15. Project Submissions or Handovers entity shall be identified initially. T&C package includes 1 handover to a single entity.\n16. Stabilizers and UPS should be available on site.\n17. Project timeline and expected timetables shall be identified before start of supervision.\n18. Price of supervision is valid for 6 months after full material supply.`,
  }],
  defaultTemplateId:"default",
};

// ─── Data helpers ─────────────────────────────────────────────────────────────
const getSettings  = () => LS.get("mscc_settings")  || DEFAULT_SETTINGS;
const getUsers     = () => LS.get("mscc_users")      || [];
const getPriceList = () => LS.get("mscc_pricelist")  || [];

async function loadSettings() {
  if (API) { const r = await apiFetch("/settings"); if (r && Object.keys(r).length) { const s={...DEFAULT_SETTINGS}; if(r.company)s.company={...DEFAULT_SETTINGS.company,...r.company}; if(r.defaultCurrency)s.defaultCurrency=r.defaultCurrency; if(r.defaultLocalFactor!==undefined)s.defaultLocalFactor=r.defaultLocalFactor; if(r.defaultBrandFactors)s.defaultBrandFactors=r.defaultBrandFactors; if(r.templates)s.templates=r.templates; if(r.defaultTemplateId)s.defaultTemplateId=r.defaultTemplateId; return s; } }
  return LS.get("mscc_settings") || DEFAULT_SETTINGS;
}
async function saveSettings(s) { if(API){const r=await apiCall("/settings",{method:"POST",body:JSON.stringify({company:s.company,defaultCurrency:s.defaultCurrency,defaultLocalFactor:s.defaultLocalFactor,defaultBrandFactors:s.defaultBrandFactors,templates:s.templates,defaultTemplateId:s.defaultTemplateId})});if(!r.ok)return{ok:false};} LS.set("mscc_settings",s); return{ok:true}; }
async function loadUsers() { if(API){const r=await apiFetch("/users");if(r)return r;} return LS.get("mscc_users")||[]; }
async function saveUser(u,isNew) { if(API){const r=await apiCall(isNew?"/users":`/users/${u.id}`,{method:isNew?"POST":"PUT",body:JSON.stringify(u)});return{ok:r.ok};} const users=LS.get("mscc_users")||[]; LS.set("mscc_users",isNew?[...users,u]:users.map(x=>x.id===u.id?u:x)); return{ok:true}; }
async function loadPriceList() { if(API){const r=await apiFetch("/pricelist");if(r)return r;} return LS.get("mscc_pricelist")||[]; }
async function replacePriceList(items) { if(API){const r=await apiCall("/pricelist/replace",{method:"POST",body:JSON.stringify(items)});return{ok:r.ok};} LS.set("mscc_pricelist",items); return{ok:true}; }
async function appendPriceList(items) { if(API){const r=await apiCall("/pricelist/append",{method:"POST",body:JSON.stringify(items)});return{ok:r.ok};} const cur=LS.get("mscc_pricelist")||[]; LS.set("mscc_pricelist",[...cur,...items]); return{ok:true}; }
async function updatePriceItem(item) { if(API){const r=await apiCall(`/pricelist/${item.id}`,{method:"PUT",body:JSON.stringify(item)});return{ok:r.ok};} const cur=LS.get("mscc_pricelist")||[]; LS.set("mscc_pricelist",cur.map(x=>x.id===item.id?item:x)); return{ok:true}; }
async function addPriceItem(item) { if(API){const r=await apiCall("/pricelist",{method:"POST",body:JSON.stringify(item)});return{ok:r.ok};} const cur=LS.get("mscc_pricelist")||[]; LS.set("mscc_pricelist",[...cur,item]); return{ok:true}; }
async function deletePriceItem(id) { if(API){const r=await apiCall(`/pricelist/${id}`,{method:"DELETE"});return{ok:r.ok};} const cur=LS.get("mscc_pricelist")||[]; LS.set("mscc_pricelist",cur.filter(x=>x.id!==id)); return{ok:true}; }
async function loadProjects() { if(API){const r=await apiFetch("/projects");if(r)return r;} return LS.get("mscc_projects")||[]; }
async function createProject(p) { if(API){const r=await apiCall("/projects",{method:"POST",body:JSON.stringify(p)});if(!r.ok)return{ok:false};return{ok:true,id:r.data?.id||p.id};} const cur=LS.get("mscc_projects")||[]; LS.set("mscc_projects",[p,...cur]); return{ok:true,id:p.id}; }
async function updateProject(p) { if(API){const r=await apiCall(`/projects/${p.id}`,{method:"PUT",body:JSON.stringify(p)});return{ok:r.ok,lockLost:r.status===409,lock:r.data?.lock};} const cur=LS.get("mscc_projects")||[]; LS.set("mscc_projects",cur.map(x=>x.id===p.id?{...x,...p}:x)); return{ok:true}; }
async function deleteProject(id) { if(API){const r=await apiCall(`/projects/${id}`,{method:"DELETE"});return{ok:r.ok};} const cur=LS.get("mscc_projects")||[]; LS.set("mscc_projects",cur.filter(x=>x.id!==id)); return{ok:true}; }
async function submitRevision(projectId,rev) { if(API){const r=await apiCall(`/projects/${projectId}/revisions`,{method:"POST",body:JSON.stringify(rev)});return{ok:r.ok,lockLost:r.status===409,lock:r.data?.lock};} const cur=LS.get("mscc_projects")||[]; LS.set("mscc_projects",cur.map(p=>p.id!==projectId?p:{...p,status:"submitted",revisions:[...(p.revisions||[]),rev],draft:null})); return{ok:true}; }
async function saveDraft(projectId,data,savedBy) { if(API){const r=await apiCall(`/projects/${projectId}/draft`,{method:"POST",body:JSON.stringify({data,savedBy})});return{ok:r.ok,lockLost:r.status===409,lock:r.data?.lock};} const cur=LS.get("mscc_projects")||[]; LS.set("mscc_projects",cur.map(p=>p.id===projectId?{...p,draft:{...data,_savedBy:savedBy,_savedAt:now()}}:p)); return{ok:true}; }
async function clearDraft(projectId) { if(API){const r=await apiCall(`/projects/${projectId}/draft`,{method:"DELETE"});return{ok:r.ok};} const cur=LS.get("mscc_projects")||[]; LS.set("mscc_projects",cur.map(p=>p.id===projectId?{...p,draft:null}:p)); return{ok:true}; }
// Edit locks. Without a server (local demo mode) there is nobody to share with, so the lock always succeeds.
async function acquireLock(projectId,lockId,takeover) { if(!API)return{ok:true}; const r=await apiCall(`/projects/${projectId}/lock`,{method:"POST",body:JSON.stringify({lockId,takeover:!!takeover})}); return{ok:r.ok,locked:r.status===409,lock:r.data?.lock,offline:!r.ok&&!r.status}; }
function releaseLock(projectId,lockId) { if(!API||!projectId)return Promise.resolve(); try{ return fetch(`${API}/projects/${projectId}/unlock`,{method:"POST",keepalive:true,headers:{"Content-Type":"application/json",...authHeaders()},body:JSON.stringify({lockId})}).catch(()=>{}); }catch{ return Promise.resolve(); } }
// Projects-list helpers for the draft / lock owner (server sends savedBy/savedAt; the local demo mode stored _savedBy/_savedAt).
const draftOwner = d => d ? (d.savedBy||d._savedBy||"") : "";
const draftTime  = d => d && (d.savedAt||d._savedAt) ? new Date(d.savedAt||d._savedAt).toLocaleString() : "";
async function grantAccess(projectId,username) { if(API){const r=await apiCall(`/projects/${projectId}/grant`,{method:"POST",body:JSON.stringify({username})});return{ok:r.ok};} const cur=LS.get("mscc_projects")||[]; LS.set("mscc_projects",cur.map(p=>p.id===projectId?{...p,grantedTo:[...new Set([...(p.grantedTo||[]),username])]}:p)); return{ok:true}; }
async function revokeAccess(projectId,username) { if(API){const r=await apiCall(`/projects/${projectId}/revoke`,{method:"POST",body:JSON.stringify({username})});return{ok:r.ok};} const cur=LS.get("mscc_projects")||[]; LS.set("mscc_projects",cur.map(p=>p.id===projectId?{...p,grantedTo:(p.grantedTo||[]).filter(u=>u!==username)}:p)); return{ok:true}; }

const MIN_PW = 8; // keep in sync with MIN_PASSWORD in auth-utils.js
// Returns true for both "admin" and "superadmin"
const isAdmin = u => u && (u.role==="admin" || u.role==="superadmin");
const isSuperAdmin = u => u && u.role==="superadmin";

function parseCSV(text) {
  const rows=[]; let cur="",inQ=false,row=[];
  for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];if(ch==='"'){if(inQ&&next==='"'){cur+='"';i++;}else inQ=!inQ;}else if(ch===','&&!inQ){row.push(cur);cur="";}else if((ch==='\n'||ch==='\r')&&!inQ){if(ch==='\r'&&next==='\n')i++;row.push(cur);cur="";if(row.some(c=>c.trim()))rows.push(row);row=[];}else cur+=ch;}
  row.push(cur);if(row.some(c=>c.trim()))rows.push(row);
  if(rows.length<2)return[];
  const hdrs=rows[0].map(h=>h.trim().toLowerCase().replace(/\s+/g,""));
  const idx=k=>hdrs.findIndex(h=>h.includes(k));
  // TYPE is optional — older price-list CSVs (exported before subsystem
  // support) have no TYPE column at all, and every row there is a plain item.
  const iType=idx("type"),iDesc=idx("desc"),iModel=idx("model"),iBrand=idx("brand"),iGlp=idx("glp"),iLocal=idx("local"),iNotes=idx("note"),iPN=idx("partnumber"),iQty=idx("qty");
  const pn=s=>parseFloat(String(s).replace(/[^0-9.]/g,""))||0;
  const out=[];
  let curSS=null; // subsystem currently collecting "child" rows beneath it
  rows.slice(1).forEach(cols=>{
    const type=iType>=0?(cols[iType]||"").trim().toLowerCase():"";
    const description=iDesc>=0?(cols[iDesc]||"").trim():"";
    const modelNo=iModel>=0?(cols[iModel]||"").trim():"";
    const brand=iBrand>=0?(cols[iBrand]||"").trim():"";
    const glp=pn(iGlp>=0?cols[iGlp]:"");
    const local=pn(iLocal>=0?cols[iLocal]:"");
    const notes=iNotes>=0?(cols[iNotes]||"").trim():"";
    if(type==="subsystem"){
      if(!description&&!modelNo)return;
      curSS={id:uid(),type:"subsystem",description,brand,partNumber:iPN>=0?(cols[iPN]||"").trim():"",children:[]};
      out.push(curSS);
      return;
    }
    if(type==="child"){
      if(!curSS||(!description&&!modelNo))return; // orphan child row (no preceding subsystem) — skip
      curSS.children.push({description,modelNo,brand,glp,local,notes,qty:Math.max(1,parseInt(iQty>=0?cols[iQty]:"1",10)||1)});
      return;
    }
    curSS=null; // a plain item row ends any subsystem currently collecting children
    if(!description&&!modelNo)return;
    out.push({id:uid(),description,modelNo,brand,glp,local,notes});
  });
  return out;
}
function toCSV(items){
  const esc=s=>`"${String(s||"").replace(/"/g,'""')}"`;
  const lines=["TYPE,DESCRIPTION,Model No,BRAND, glp ,Local,Notes,Part Number,Qty"];
  items.forEach(i=>{
    if(i.type==="subsystem"){
      lines.push(`"subsystem",${esc(i.description)},"",${esc(i.brand)},,,,${esc(i.partNumber)},`);
      (i.children||[]).forEach(c=>{
        lines.push(`"child",${esc(c.description)},${esc(c.modelNo)},${esc(c.brand)},${c.glp||0},${c.local||0},${esc(c.notes)},"",${c.qty||1}`);
      });
      return;
    }
    lines.push(`"item",${esc(i.description)},${esc(i.modelNo)},${esc(i.brand)},${i.glp||0},${i.local||0},${esc(i.notes)},"",`);
  });
  return lines.join("\n");
}

// ─── Factors (v1.1.0) ─────────────────────────────────────────────────────────
// By default an item uses the project's brand factor and local factor (the
// original formula). When the "Custom factor" button was pressed on that item
// (customFactor:true) it uses its own itemBrandFactor / itemLocalFactor instead.
// An empty or invalid custom value falls back to the project factor.
const fNum=(v,fb)=>{const n=parseFloat(v);return isNaN(n)?fb:n;};
function itemFactors(item,brandFactors,localFactor){
  const bf=(brandFactors||{})[item.brand]??1, lf=localFactor??1;
  if(!item.customFactor)return{bf,lf,custom:false};
  return{bf:fNum(item.itemBrandFactor,bf),lf:fNum(item.itemLocalFactor,lf),custom:true};
}
function calcUnitPrice(item,brandFactors,localFactor){const f=itemFactors(item,brandFactors,localFactor);return((item.glp||0)*f.bf)+((item.local||0)*f.lf);}
// Turn custom factors on for one item, pre-filled with the factors it uses right now.
const withCustomFactor=(item,brandFactors,localFactor)=>{const f=itemFactors(item,brandFactors,localFactor);return{...item,customFactor:true,itemBrandFactor:f.bf,itemLocalFactor:f.lf};};
// Turn them off again: the item goes back to the project's factors.
const withoutCustomFactor=item=>{const{customFactor,itemBrandFactor,itemLocalFactor,...rest}=item;return rest;};
const fmtFactor=n=>String(+(+n||0).toFixed(3));
// Effective (total) factor per brand, from the reverse calculation
//   Σ(GLP × qty × factor) = GLP_total × Factor_total  ⇒  Factor_total = Σ(GLP × qty × factor) ÷ GLP_total
// and the same for Local. Optional items are left out; subsystem children count × the subsystem qty.
// Amounts are in USD before currency conversion / rounding.
function factorSummary(lines,brandFactors,localFactor){
  const brands={};const local={raw:0,factored:0,custom:false};
  const add=(it,qty)=>{
    const f=itemFactors(it,brandFactors,localFactor);const b=it.brand||"Other";
    if(!brands[b])brands[b]={glp:0,factored:0,custom:false,base:(brandFactors||{})[it.brand]??1};
    brands[b].glp+=(it.glp||0)*qty;brands[b].factored+=(it.glp||0)*qty*f.bf;
    local.raw+=(it.local||0)*qty;local.factored+=(it.local||0)*qty*f.lf;
    if(f.custom){brands[b].custom=true;if(it.local)local.custom=true;}
  };
  (lines||[]).forEach(l=>{
    if(l.type==="section"||l.optional)return;
    if(l.type==="subsystem"){(l.children||[]).filter(c=>!c.optional).forEach(c=>add(c,(c.qty||1)*(l.qty||1)));return;}
    add(l,l.qty||1);
  });
  Object.values(brands).forEach(v=>{v.factor=v.glp>0?v.factored/v.glp:v.base;});
  local.factor=local.raw>0?local.factored/local.raw:(localFactor??1);
  return{brands,local};
}
// Assign per-section sequential row numbers; section header rows get rowNum=""
function assignRowNums(lines){
  // Strip mergeGroup from lines whose group partner is no longer adjacent
  const cleaned=lines.map((l,i)=>{
    if(!l.mergeGroup||l.type==="section")return l;
    const prev=lines[i-1];const next=lines[i+1];
    const adjacent=(prev&&prev.mergeGroup===l.mergeGroup)||(next&&next.mergeGroup===l.mergeGroup);
    return adjacent?l:{...l,mergeGroup:null};
  });
  // First member of a group gets the number; subsequent members get rowNum=""
  // rowNumOverride sticks if set — auto number is stored in rowNumAuto
  let n=0;
  return cleaned.map((l,i)=>{
    if(l.type==="section")return{...l,rowNum:"",rowNumAuto:""};
    if(l.mergeGroup){const prev=cleaned[i-1];if(prev&&prev.mergeGroup===l.mergeGroup)return{...l,rowNum:"",rowNumAuto:"",rowNumOverride:null};} // merged rows share the first row's number
    n++;
    const auto=String(n);
    return{...l,rowNumAuto:auto,rowNum:l.rowNumOverride||auto};
  });
}
// ─── Subsystem helpers ───────────────────────────────────────────────────────
function ssChildUnitTotal(ss,brandFactors,localFactor){
  return(ss.children||[]).filter(c=>!c.optional).reduce((s,c)=>s+calcUnitPrice(c,brandFactors,localFactor)*c.qty,0);
}
function ssUnitPrice(ss,brandFactors,localFactor){return ss.optional?0:ssChildUnitTotal(ss,brandFactors,localFactor);}
function ssUnitPrice1(ss,brandFactors,localFactor){return ssChildUnitTotal(ss,brandFactors,localFactor);}
function ssTotal(ss,brandFactors,localFactor){return ss.optional?0:ssUnitPrice(ss,brandFactors,localFactor)*(ss.qty||1);}
function autoPartNumber(ss){return(ss.children||[]).map(c=>c.modelNo||"").filter(Boolean).join("\n");}

// ─── Solution Navigator Excel import ───────────────────────────────────────────
// Header name -> internal field. Matching is case-insensitive, trimmed, whitespace-collapsed.
const SOLNAV_HEADER_MAP = {
  "code number":      "modelNo",
  "description":      "description",
  "unit list price":  "glp",
  "ext quantity":     "qty",
  "designation":      "designation",
};
const REQUIRED_SOLNAV_FIELDS = ["modelNo","description","glp","qty"]; // designation is optional context, not required

function normalizeHeader(h){return String(h??"").trim().toLowerCase().replace(/\s+/g," ");}

// Parse "$2,392.05" / "1,250" / " 4 " -> number. Returns fallback if unparsable.
function parseMoneyOrNum(raw, fallback=0){
  if(raw===null||raw===undefined)return fallback;
  const s=String(raw).replace(/[$,\s]/g,"");
  const n=parseFloat(s);
  return isNaN(n)?fallback:n;
}

// Reads an ArrayBuffer (Solution Navigator .xlsx export) and returns
// { ok:true, designation, children:[{modelNo,description,brand,glp,local,qty,notes,isCustom}] }
// or { ok:false, error:"..." } if required headers are missing.
async function parseSolutionNavigatorExcel(arrayBuffer){
  const wb=new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const ws=wb.worksheets[0];
  if(!ws)return{ok:false,error:"The Excel file has no worksheets."};

  // Find the header row: the first row that contains at least one recognizable header name.
  let headerRowIdx=null,colMap={};
  const maxScanRows=Math.min(10,ws.rowCount||10);
  for(let r=1;r<=maxScanRows;r++){
    const row=ws.getRow(r);
    const found={};
    row.eachCell({includeEmpty:false},(cell,colNumber)=>{
      const norm=normalizeHeader(cell.value);
      if(SOLNAV_HEADER_MAP[norm])found[SOLNAV_HEADER_MAP[norm]]=colNumber;
    });
    if(Object.keys(found).length>=2){headerRowIdx=r;colMap=found;break;} // first row with 2+ matches = header row
  }

  if(headerRowIdx===null){
    return{ok:false,error:"This Excel file is not a proper Solution Navigator export. No recognizable header row was found."};
  }

  const missing=REQUIRED_SOLNAV_FIELDS.filter(f=>!(f in colMap));
  if(missing.length){
    return{ok:false,error:"This Excel file is not a proper Solution Navigator export. Missing required column(s): "+missing.map(f=>Object.keys(SOLNAV_HEADER_MAP).find(k=>SOLNAV_HEADER_MAP[k]===f)).join(", ")+"."};
  }

  const children=[];
  let designation="";
  for(let r=headerRowIdx+1;r<=ws.rowCount;r++){
    const row=ws.getRow(r);
    const get=field=>colMap[field]?row.getCell(colMap[field]).value:null;
    const modelNo=String(get("modelNo")??"").trim();
    const description=String(get("description")??"").trim();
    if(!modelNo&&!description)continue; // skip blank trailing rows

    if(!designation&&colMap.designation){
      const d=String(get("designation")??"").trim();
      if(d)designation=d;
    }

    const glp=parseMoneyOrNum(get("glp"),0);
    const qty=Math.max(1,Math.round(parseMoneyOrNum(get("qty"),1)));

    children.push({
      modelNo,
      description,
      brand:"Simplex",
      glp,
      local:0,
      qty,
      notes:"",
      isCustom:true,
    });
  }

  if(!children.length){
    return{ok:false,error:"This Excel file is not a proper Solution Navigator export. No item rows were found beneath the header."};
  }

  return{ok:true,designation,children};
}

// Flat lines for calculations: expand subsystems into their children (multiplied by ss.qty)
function expandForCalc(lines){
  const out=[];
  for(const l of lines){
    if(l.type==="subsystem"){if(l.optional)continue;for(const c of(l.children||[])){if(!c.optional)out.push({...c,qty:c.qty*(l.qty||1)});}}
    else if(l.type!=="section"&&!l.optional){out.push(l);}
  }
  return out;
}
// Generate part number HTML for subtable in BOM/Detailed PDFs
function subsystemSubtableHTML(ss,ssQty,colSpan,showPrice,brandFactors,localFactor,rnd,fmtN,lUD,lT){
  const rows=(ss.children||[]).map((c,i)=>{
    const dispQty=showPrice?c.qty:c.qty*ssQty;
    const unitCell=showPrice?`<td style="border:1px solid #e0e0e0;padding:4px 8px;text-align:right;font-size:11px;">${fmtN(lUD(c),rnd)}</td><td style="border:1px solid #e0e0e0;padding:4px 8px;text-align:right;font-size:11px;">${fmtN(lT(c),rnd)}</td>`:"";
    return`<tr style="background:#fafafa;">
      <td style="border:1px solid #e0e0e0;padding:4px 8px;padding-left:20px;font-size:11px;color:#888;">${i+1}</td>
      <td style="border:1px solid #e0e0e0;padding:4px 8px;font-family:monospace;font-size:10px;">${c.modelNo||""}</td>
      <td style="border:1px solid #e0e0e0;padding:4px 8px;font-size:11px;">${c.brand||""}</td>
      <td style="border:1px solid #e0e0e0;padding:4px 8px;font-size:11px;">${c.description||""}</td>
      <td style="border:1px solid #e0e0e0;padding:4px 8px;text-align:center;font-size:11px;">${c.optional?"Opt.":dispQty}</td>
      ${unitCell}
    </tr>`;
  }).join("");
  if(showPrice){
    // detailed: show ×N note in header
    return`<tr><td colspan="${colSpan}" style="padding:0;border:none;">
      <table style="width:96%;margin-left:4%;border-collapse:collapse;margin-bottom:4px;">
        <thead><tr style="background:#f0f0f0;">
          <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;text-align:center;width:5%">#</th>
          <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;width:11%">Model No</th>
          <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;width:9%">Brand</th>
          <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;">Description</th>
          <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;text-align:center;width:8%">Qty×1</th>
          <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;text-align:right;width:10%">Unit Price</th>
          <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;text-align:right;width:10%">Total</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </td></tr>`;
  }
  return`<tr><td colspan="${colSpan}" style="padding:0;border:none;">
    <table style="width:96%;margin-left:4%;border-collapse:collapse;margin-bottom:4px;">
      <thead><tr style="background:#f0f0f0;">
        <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;text-align:center;width:5%">#</th>
        <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;width:14%">Model No</th>
        <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;width:10%">Brand</th>
        <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;">Description</th>
        <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;text-align:center;width:10%">Qty (×${ssQty})</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </td></tr>`;
}
// Detailed Quotation: the factors a line was priced with, shown under its price.
// Custom per-item factors are blue with ★; project factors are grey.
function factorNoteHTML(item,brandFactors,localFactor){
  const f=itemFactors(item,brandFactors,localFactor);
  return`<div style="font-size:9px;font-weight:400;color:${f.custom?"#1d4ed8":"#999"};white-space:nowrap;">×${fmtFactor(f.bf)}${item.local?` · L×${fmtFactor(f.lf)}`:""}${f.custom?" ★":""}</div>`;
}
const factorNoteText=(item,brandFactors,localFactor)=>{const f=itemFactors(item,brandFactors,localFactor);return`×${fmtFactor(f.bf)}${item.local?` / L×${fmtFactor(f.lf)}`:""}${f.custom?" (custom)":""}`;};
function subsystemSubtableHTML2(ss,ssQty,colSpan,showPrice,brandFactors,localFactor,rnd,fmtN,lUD,lT){
  const rows=(ss.children||[]).map((c,i)=>{
    const dispQty=showPrice?c.qty:c.qty*ssQty;
    const unitCell=showPrice?`<td style="border:1px solid #e0e0e0;padding:4px 8px;text-align:right;font-size:11px;">${fmtN(lUD(c),rnd)}</td><td style="border:1px solid #e0e0e0;padding:4px 8px;text-align:right;font-size:11px;">${fmtN(lT(c),rnd)}</td>`:"";
    return`<tr style="background:#fafafa;">

      <td style="border:1px solid #e0e0e0;padding:4px 8px;padding-left:20px;font-size:11px;color:#888;">${i+1}</td>
      <td style="border:1px solid #e0e0e0;padding:4px 8px;font-family:monospace;font-size:10px;">${c.modelNo||""}</td>
      <td style="border:1px solid #e0e0e0;padding:4px 8px;font-size:11px;">${c.brand||""}</td>
      <td style="border:1px solid #e0e0e0;padding:4px 8px;font-size:11px;">${c.description||""}</td>
      <td style="border:1px solid #e0e0e0;padding:4px 8px;font-size:11px;">${c.glp||""}</td>
      <td style="border:1px solid #e0e0e0;padding:4px 8px;font-size:11px;">${c.local||""}</td>
      <td style="border:1px solid #e0e0e0;padding:4px 8px;text-align:center;font-size:11px;">${c.optional?"Opt.":dispQty}</td>
      <td style="border:1px solid #e0e0e0;padding:4px 8px;font-size:11px;">${fmtN(lUD(c)*(c.optional?"Opt.":dispQty),rnd)||""}${factorNoteHTML(c,brandFactors,localFactor)}</td>

    </tr>`;
  }).join("");
  if(showPrice){
    // detailed: show ×N note in header
    return`<tr><td colspan="${colSpan}" style="padding:0;border:none;">
        <tr style="background:#f0f0f0;">
          <td style="border:1px solid #ddd;padding:4px 8px;font-size:11px;text-align:center;width:5%">#</td>
          <td style="border:1px solid #ddd;padding:4px 8px;font-size:11px;width:11%">Model No</td>
          <td style="border:1px solid #ddd;padding:4px 8px;font-size:11px;width:9%">Brand</td>
          <td style="border:1px solid #ddd;padding:4px 8px;font-size:11px;">Description</td>
          <td style="border:1px solid #ddd;padding:4px 8px;font-size:11px;text-align:center;width:8%">glb</td>
          <td style="border:1px solid #ddd;padding:4px 8px;font-size:11px;text-align:right;width:10%">Local</td>
          <td style="border:1px solid #ddd;padding:4px 8px;font-size:11px;text-align:right;width:10%">Qty</td>
          <td style="border:1px solid #ddd;padding:4px 8px;font-size:11px;text-align:right;width:10%">Total</td>
        </tr>
        ${rows}
      
    </td></tr>`;
  }
  return`<tr><td colspan="${colSpan}" style="padding:0;border:none;">
    <table style="width:96%;margin-left:4%;border-collapse:collapse;margin-bottom:4px;">
      <thead><tr style="background:#f0f0f0;">
        <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;text-align:center;width:5%">#</th>
        <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;width:14%">Model No</th>
        <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;width:10%">Brand</th>
        <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;">Description</th>
        <th style="border:1px solid #ddd;padding:4px 8px;font-size:11px;text-align:center;width:10%">Qty (×${ssQty})</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </td></tr>`;
}
function applyRounding(val,round,rate){const r=rate??1;const c=val*r;if(round)return Math.ceil(c);return Math.round(c*100)/100;}
const fmtN=(n,round)=>round?Math.ceil(n).toLocaleString("en-US"):Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtR=(n,round,curr)=>fmtN(n,round)+" "+curr;

function normalizeBrand(name,existingBrands){
  if(!name||!name.trim())return name;
  const lower=name.toLowerCase().trim();
  const match=(existingBrands||[]).find(b=>b.toLowerCase()===lower);
  return match||name.trim();
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const C={
  page:{minHeight:"100vh",fontFamily:"Arial,sans-serif",background:"#f0f0f0"},
  center:{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"},
  card:{background:"#fff",border:"1px solid #c8c8c8",borderRadius:"8px",padding:"1.25rem"},
  input:{display:"block",width:"100%",padding:"7px 10px",borderRadius:"6px",border:"1px solid #b0b0b0",fontSize:13,background:"#f8f8f8",color:"#1a1a1a",boxSizing:"border-box"},
  label:{display:"block",fontSize:12,color:"#555",marginBottom:3},
  btnP:{padding:"7px 16px",borderRadius:"6px",border:"none",background:"#c0392b",color:"#fff",fontWeight:500,fontSize:13,cursor:"pointer"},
  btnS:{padding:"6px 13px",borderRadius:"6px",border:"1px solid #c0c0c0",background:"#f0f0f0",color:"#222",fontSize:13,cursor:"pointer"},
  btnD:{padding:"6px 13px",borderRadius:"6px",border:"1px solid #e74c3c",background:"#fdf0f0",color:"#c0392b",fontSize:13,cursor:"pointer"},
  tab:a=>({padding:"8px 15px",border:"none",borderBottom:a?"2px solid #c0392b":"2px solid transparent",background:"transparent",cursor:"pointer",fontWeight:a?500:400,color:a?"#111":"#666",fontSize:13,whiteSpace:"nowrap"}),
  row:{display:"flex",gap:10,flexWrap:"wrap"},
  f1:{flex:1,minWidth:120},
  sT:{fontSize:13,fontWeight:600,margin:"1rem 0 0.5rem",borderBottom:"1px solid #ddd",paddingBottom:5,color:"#222"},
  badge:c=>({display:"inline-block",fontSize:11,padding:"1px 7px",borderRadius:99,background:c==="red"?"#fdf0f0":c==="green"?"#f0fdf4":c==="orange"?"#fff7ed":c==="gray"?"#f3f4f6":c==="purple"?"#f3e8ff":"#eff6ff",color:c==="red"?"#c0392b":c==="green"?"#16a34a":c==="orange"?"#ea580c":c==="gray"?"#6b7280":c==="purple"?"#7c3aed":"#2563eb"}),
  err:{color:"#c0392b",fontSize:12,marginTop:4},
  ok:{color:"#16a34a",fontSize:12},
  th:{textAlign:"left",padding:"7px 9px",fontSize:12,fontWeight:600,color:"#555",borderBottom:"1px solid #ddd",whiteSpace:"nowrap"},
  td:{padding:"7px 9px",fontSize:13,borderBottom:"1px solid #eee",verticalAlign:"middle"},
};

// ─── Brand Selector ───────────────────────────────────────────────────────────
function BrandSelector({ value, onChange, allBrands }) {
  const seen=new Set();
  const uniqueBrands=(allBrands||[]).filter(b=>{if(!b)return false;const l=b.toLowerCase();if(seen.has(l))return false;seen.add(l);return true;});
  const isKnown=value&&uniqueBrands.some(b=>b.toLowerCase()===value.toLowerCase());
  const [showCustom,setShowCustom]=useState(!!value&&!isKnown);
  const selectVal=showCustom?"__other__":(uniqueBrands.find(b=>b.toLowerCase()===(value||"").toLowerCase())||"");
  const handleSelect=e=>{if(e.target.value==="__other__"){setShowCustom(true);onChange("");}else{setShowCustom(false);onChange(e.target.value);}};
  return(<div><select style={C.input} value={selectVal} onChange={handleSelect}><option value="">Select brand…</option>{uniqueBrands.map(b=><option key={b} value={b}>{b}</option>)}<option value="__other__">Other…</option></select>{showCustom&&<input style={{...C.input,marginTop:4}} value={value||""} onChange={e=>onChange(e.target.value)} placeholder="Type brand name…" autoFocus/>}</div>);
}

// ─── PDF / CSV Generators ─────────────────────────────────────────────────────
const headerHTML=(co)=>`<table style="width:100%;border-collapse:collapse;margin-bottom:16px;"><tr><td style="border-bottom:2px solid #c0392b;padding-bottom:8px;"><img src="${LOGO_URL}" style="height:55px;object-fit:contain;" onerror="this.style.display='none'"/></td><td style="border-bottom:2px solid #c0392b;padding-bottom:8px;text-align:right;font-size:11px;color:#555;vertical-align:bottom;"><div style="font-size:14px;font-weight:700;color:#c0392b;">${co.name}</div><div>${co.address}</div><div>${co.poBox} | ${co.city}</div><div>Tel: ${co.phone} | Mobile: ${co.mobile}</div><div>Email: ${co.email}</div></td></tr></table>`;
const footerHTML=(co,label)=>`<div style="position:fixed;bottom:0;left:0;right:0;border-top:1px solid #e0e0e0;padding:5px 28px;font-size:10px;color:#888;display:flex;justify-content:space-between;background:#fff;"><span>${co.name} | ${co.address} | Tel: ${co.phone} | ${co.email}</span><span>${label}</span></div>`;
const printBtn=`<div class="no-print" style="position:fixed;top:12px;right:12px;z-index:999;"><button onclick="window.print()" style="background:#c0392b;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600;">🖨 Print / Save as PDF</button></div>`;
const openWin=(html)=>{
  const blob=new Blob([html],{type:"text/html;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const w=window.open(url,"_blank");
  if(!w)alert("Allow popups to view PDF.");
  // Revoke the object URL after a short delay to free memory
  setTimeout(()=>URL.revokeObjectURL(url),60000);
};
const sectionRowHTML=(label,colspan)=>`<tr><td colspan="${colspan}" style="background:#c0392b;color:#fff;font-weight:700;text-align:center;padding:7px 10px;border:1px solid #a93226;font-size:12px;letter-spacing:0.3px;">${label||"Section"}</td></tr>`;;
const sectionRowHTML2=(label,colspan)=>`<tr><td colspan="${colspan}" style="background:#c0392b;color:#fff;font-weight:700;text-align:center;padding:7px 10px;border:1px solid #a93226;font-size:12px;letter-spacing:0.3px;">${label||"Section"}</td></tr>`;;

// Measure how many physical pages a table's rows will actually span when printed.
// Renders the REAL thead/body HTML into a hidden, off-screen container sized to
// match the print page's content width, so measured row heights are accurate —
// then buckets rows against the true per-page height budget (derived from the
// actual @page size/margins, not a guessed constant).
function estimateContentPages(theadRowHTML, bodyRowsHTML, headerBlockHTML) {
  const MM_TO_PX = 96 / 25.4;
  const PAGE_H_MM = 297, PAGE_W_MM = 210;           // A4
  const PAGE_MARGIN_MM = 10;                         // matches @page{margin:10mm;}
  const PAGE_PADDING_V_PX = 20 + 10;                 // matches .page print padding (top+bottom)
  const PAGE_PADDING_H_PX = 20 + 20;                 // matches .page print padding (left+right)

  const pageHeightPx = PAGE_H_MM * MM_TO_PX - (PAGE_MARGIN_MM * 2 * MM_TO_PX) - PAGE_PADDING_V_PX;
  const pageWidthPx  = PAGE_W_MM * MM_TO_PX - (PAGE_MARGIN_MM * 2 * MM_TO_PX) - PAGE_PADDING_H_PX;

  const holder = document.createElement("div");
  holder.style.cssText = `position:fixed;left:-99999px;top:0;width:${pageWidthPx}px;font-family:Arial,sans-serif;font-size:12px;`;
  holder.innerHTML = `
    <div id="msr-hdr">${headerBlockHTML}</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead id="msr-thead">${theadRowHTML}</thead>
      <tbody id="msr-tbody">${bodyRowsHTML}</tbody>
    </table>`;
  document.body.appendChild(holder);

  const headerBlockHeight = holder.querySelector("#msr-hdr").getBoundingClientRect().height;
  const theadHeight       = holder.querySelector("#msr-thead").getBoundingClientRect().height;
  const rows = Array.from(holder.querySelectorAll("#msr-tbody > tr"));

  const usableFirstPage = pageHeightPx - headerBlockHeight - theadHeight;
  const usableNextPage  = pageHeightPx - theadHeight;

  let pageCount = 1, used = 0, usable = usableFirstPage;
  rows.forEach(row => {
    const h = row.getBoundingClientRect().height;
    if (used + h > usable && used > 0) { pageCount++; used = 0; usable = usableNextPage; }
    used += h;
  });

  document.body.removeChild(holder);
  return pageCount;
}

function generatePDF(project, rev, settings, tplId) {
  rev={...(rev.data||{}),...rev};
  const curr=rev.currency||"USD",rnd=rev.roundUp,rate=rev.conversionRate||1;
  const tpl=settings.templates.find(t=>t.id===tplId)||settings.templates[0];
  const co=settings.company;
  const lUD=line=>applyRounding(calcUnitPrice(line,rev.brandFactors,rev.localFactor),rnd,rate);
  const lT=line=>line.optional?0:lUD(line)*line.qty;
  const supplyTotal=(rev.lines||[]).reduce((s,l)=>{if(l.type==="section")return s;if(l.type==="subsystem"){if(l.optional)return s;const ssU=applyRounding(ssUnitPrice(l,rev.brandFactors,rev.localFactor),rnd,rate);return s+ssU*(l.qty||1);}return s+lT(l);},0);
  const tcDisp=rev.tcEnabled?applyRounding(rev.tcBaseUSD||0,rnd,rate):0;
  const installDisp=rev.installEnabled?applyRounding(rev.installValue,rnd,rate):0;
  const extrasDisp=(rev.extras||[]).map(e=>({...e,disp:applyRounding(parseFloat(e.value)||0,rnd,rate)}));
  const grandTotal=supplyTotal+tcDisp+installDisp+extrasDisp.reduce((s,e)=>s+e.disp,0);
  const coverLetter=(tpl.coverLetter||"").replace(/{currency}/g,curr);
  const hdr=headerHTML(co);

const itemRows = (() => {
    let n = 0;
    const ls = rev.lines || [];
    const rows = [];

    for (let i = 0; i < ls.length; i++) {
        const l = ls[i];

        // Section row
        if (l.type === "section") {
            rows.push(sectionRowHTML(l.label, 7));
            continue;
        }

        // Subsystem row (with merging support)
        if (l.type === "subsystem") {
            n++;

            const ssU = applyRounding(
                ssUnitPrice1(l, rev.brandFactors, rev.localFactor),
                rnd,
                rate
            );
            const ssT = ssU * (l.qty || 1);

            const ssGrp_ = l.mergeGroup;
            const ssIsSE = ssGrp_ && ls[i - 1]?.mergeGroup === ssGrp_;

            let ssRs = 1;
            if (ssGrp_ && !ssIsSE) {
                let j = i + 1;
                while (j < ls.length && ls[j].mergeGroup === ssGrp_) {
                    ssRs++;
                    j++;
                }
            }

            const ssNumCell = ssIsSE
                ? ""
                : `<td style="border:1px solid #ddd;padding:6px 8px;text-align:center;vertical-align:middle;font-weight:400;" rowspan="${ssRs}">${l.rowNum}</td>`;

            const ssUnitCell = `${curr === "USD" ? "$" : curr} ${fmtN(ssU, rnd)}`

             

            const ssTotCell = l.optional
                ? `—`
                : `${curr === "USD" ? "$" : curr} ${fmtN(ssT, rnd)}`;

            rows.push(`
                <tr style="background:${l.optional ? "#fffbf0" : "#f5f0ff"};color:${l.optional ? "#888" : "inherit"};">
                    ${ssNumCell}
                    <td style="border:1px solid #ddd;padding:6px 8px;font-weight:400;">
                        ${(l.brand || "").replace(/\n/g, "<br/>")}
                    </td>
                    <td style="border:1px solid #ddd;padding:6px 8px;font-weight:400;white-space: pre-wrap;">${l.description || ""}</td>
                    <td style="border:1px solid #ddd;padding:6px 8px;font-weight:400;white-space:pre-wrap;text-align:center;">${l.optional ? "Opt." : (l.qty || "")}<em style="font-size:10px;color:#7c3aed;font-weight:400;"></em></td>
                    <td style="border:1px solid #ddd;padding:6px 8px;text-align:right;font-weight:400;">
                        ${ssUnitCell}
                    </td>
                    <td style="border:1px solid #ddd;padding:6px 8px;text-align:right;font-weight:400;">
                        ${l.optional ? "Opt." : ssTotCell}
                    </td>
                </tr>
            `);

            continue;
        }

        // Regular item row (with merging support)
        const grp = l.mergeGroup;
        const prevL = ls[i - 1];
        const isSubEntry = grp && prevL?.mergeGroup === grp;

        let rs = 1;
        if (grp && !isSubEntry) {
            let j = i + 1;
            while (j < ls.length && ls[j].mergeGroup === grp) {
                rs++;
                j++;
            }
        }

        const numCell = isSubEntry
            ? ""
            : `<td style="border:1px solid #ddd;padding:6px 8px;text-align:center;vertical-align:middle;font-weight:400;" rowspan="${rs}">${l.rowNum}</td>`;

        rows.push(`
                <tr style="background:${l.optional ? "#fffbf0" : "#f5f0ff"};color:${l.optional ? "#888" : "inherit"};">${numCell}
                <td style="border:1px solid #ddd;padding:6px 8px;font-weight:400;">${l.brand || ""}</td>
                <td style="border:1px solid #ddd;padding:6px 8px;white-space:pre-wrap;font-weight:400;white-space: pre-wrap;">${l.description || ""}</td>
                <td style="border:1px solid #ddd;padding:6px 8px;font-weight:400;white-space:pre-wrap;text-align:center;">${l.optional ? "Opt." : l.qty}</td>
                <td style="border:1px solid #ddd;padding:6px 8px;text-align:right;font-weight:400;">${curr === "USD" ? "$" : curr} ${fmtN(lUD(l), rnd)}</td>
                <td style="border:1px solid #ddd;padding:6px 8px;text-align:right;font-weight:400;">
                    ${l.optional 
                        ? "Opt." 
                        : `${curr === "USD" ? "$" : curr} ${fmtN(lT(l), rnd)}`}
                </td>
            </tr>
        `);
    }

    return rows.join("");
})();

const totRows = [
  `<tr style="background:#f9f9f9;">
    <td colspan="5" style="${tot_Normal_Style}">
      Total for supply
    </td>
    <td style="${tot_Normal_Style}">
      ${curr === "USD" ? "$" : curr} ${fmtN(supplyTotal, rnd)}
    </td>
  </tr>`,

  ...(rev.tcEnabled
    ? [
        `<tr>
          <td colspan="5" style="${tot_Normal_Style}">
            Total for T&C
          </td>
          <td style="${tot_Normal_Style}">
            ${curr === "USD" ? "$" : curr} ${fmtN(tcDisp, rnd)}
          </td>
        </tr>`,
      ]
    : []),

  ...(rev.installEnabled
    ? [
        `<tr>
          <td colspan="5" style="${tot_Normal_Style}">
            Installation
          </td>
          <td style="${tot_Normal_Style}">
            ${curr === "USD" ? "$" : curr} ${fmtN(installDisp, rnd)}
          </td>
        </tr>`,
      ]
    : []),

  ...extrasDisp.map(
    (e) => `<tr>
      <td colspan="5" style="${tot_Normal_Style}">
        ${e.label || "Extra"}
      </td>
      <td style="${tot_Normal_Style}">
        ${curr === "USD" ? "$" : curr} ${fmtN(e.disp, rnd)}
      </td>
    </tr>`
  ),

  `<tr style="background:#fdf0f0;">
    <td colspan="5" style="${(rev.gtAfterDiscountEnabled && rev.gtAfterDiscount)
      ? tot_Normal_Style
      : "border:1px solid #ddd;padding:8px 10px;text-align:right;font-weight:700;font-size:14px;color:#c0392b;"
     }
    ">
      Grand Total (${curr})
    </td>
    <td style="${(rev.gtAfterDiscountEnabled && rev.gtAfterDiscount)
      ? tot_Normal_Style
      : tot_emphasized_style
     }
    ">
      ${curr === "USD" ? "$" : curr} ${fmtN(grandTotal, rnd)}
    </td>
  </tr>`,

  ...(rev.gtAfterDiscountEnabled && rev.gtAfterDiscount
    ? [
        `<tr>
          <td colspan="5" style="${tot_emphasized_style}">
            Grand Total after discount (${curr})
          </td>
          <td style="${tot_emphasized_style}">
            ${curr === "USD" ? "$" : curr}${rev.gtAfterDiscount}
          </td>
        </tr>`,
      ]
    : []),
].join("");

  const theadRowHTML=`<tr style="background:#c0392b;color:#fff;"><th style="border:1px solid #aaa;padding:7px 8px;text-align:center;width:5%">#</th><th style="border:1px solid #aaa;padding:7px 8px;width:12%">Brand</th><th style="border:1px solid #aaa;padding:7px 8px;">Description</th><th style="border:1px solid #aaa;padding:7px 8px;text-align:center;width:6%">Qty</th><th style="border:1px solid #aaa;padding:7px 8px;text-align:right;width:13%">Unit Price</th><th style="border:1px solid #aaa;padding:7px 8px;text-align:right;width:13%">Total</th></tr>`;
  const titleBlockHTML=`<h3 style="margin-top:0;">Quotation — ${project.projectName}</h3>`;
  // Cover letter + T&Cs are each their own fixed .page (1 page each in the common case);
  // the quotation table is measured for real against the actual @page size/margins.
  const contentPages=estimateContentPages(theadRowHTML,itemRows+totRows,hdr+titleBlockHTML);
  const totalPages=2+contentPages;

  const infoTable=`<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:18px;">
    <tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;;width:110px;">Project:</td><td style="border:1px solid #ccc;padding:5px 8px;" colspan="3"><strong>${project.projectName}</strong></td></tr>
    <tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Company</td><td style="border:1px solid #ccc;padding:5px 8px;" colspan="3">${project.client||""}</td></tr>
    <tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Contact:</td><td style="border:1px solid #ccc;padding:5px 8px;">${rev.contactName||""}</td><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Project Day</td><td style="border:1px solid #ccc;padding:5px 8px;">${rev.date||""}</td></tr>
    <tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Phone:</td><td style="border:1px solid #ccc;padding:5px 8px;">${rev.contactPhone||""}</td><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Sales Engineer</td><td style="border:1px solid #ccc;padding:5px 8px;">${rev.salesEngineer||""}</td></tr>
    <tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">E-Mail:</td><td style="border:1px solid #ccc;padding:5px 8px;">${rev.contactEmail||""}</td><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Pages</td><td style="border:1px solid #ccc;padding:5px 8px;">Pages ${totalPages}</td></tr>
    <tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Ref:</td><td style="border:1px solid #ccc;padding:5px 8px;">${rev.systemType||""}</td><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Pre-Sales Engineer</td><td style="border:1px solid #ccc;padding:5px 8px;">${rev.engineerName||""}</td></tr>
    <tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Code:</td><td style="border:1px solid #ccc;padding:5px 8px;" colspan="3"><code>${rev.code}</code></td></tr>
  </table>`;

  openWin(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${rev.code}</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;color:#222;margin:0;padding:0;}
    .page{padding:28px 28px 16px;page-break-after:always;position:relative;box-sizing:border-box;}
    .page:last-of-type{page-break-after:auto;}
    @media print{
      .page{padding:20px 20px 10px;}
      .no-print{display:none!important;}
      @page{margin:10mm;}
    }
    @page{margin:10mm;@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:10px;color:#888;font-family:Arial,sans-serif;}}
    @page{@bottom-left{content:"${co.name} | ${co.address} | Tel: ${co.phone} | ${co.email}";font-size:9px;color:#888;font-family:Arial,sans-serif;}}
    h3{color:#c0392b;border-bottom:1px solid #c0392b;padding-bottom:4px;}
  </style></head><body style="-webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;">
  <div class="page">${hdr}${infoTable}<div style="white-space:pre-wrap;font-size:12px;line-height:1.7;">${coverLetter}</div>
  </div>
  <div class="page">${hdr}<h3 style="margin-top:0;">Terms &amp; Conditions</h3><div style="white-space:pre-wrap;font-size:12px;line-height:1.8;">${tpl.termsAndConditions||""}</div>
  </div>
  <div class="page">${hdr}${titleBlockHTML}
  <table style="width:100%;font-size:12px;border-collapse:collapse;">
    <thead>${theadRowHTML}</thead>
    <tbody>${itemRows}${totRows}</tbody>
  </table>
  ${rev.notes?`<div style="margin-top:16px;padding:10px 14px;background:#f9f9f9;border:1px solid #ddd;border-radius:4px;font-size:12px;white-space:pre-wrap;"><strong>Notes:</strong><br/>${rev.notes}</div>`:""}
  ${printBtn}</body></html>`);
}

function exportQuotationCSV(project,rev){
  rev={...(rev.data||{}),...rev};
  const curr=rev.currency||"USD",rnd=rev.roundUp,rate=rev.conversionRate||1;
  const lUD=line=>applyRounding(calcUnitPrice(line,rev.brandFactors,rev.localFactor),rnd,rate);
  const lT=line=>lUD(line)*line.qty;
  const supplyTotal=(rev.lines||[]).reduce((s,l)=>{if(l.type==="section")return s;
  if(l.type==="subsystem"){
    const ssU=applyRounding(ssUnitPrice(l,rev.brandFactors,rev.localFactor),rnd,rate);return s+ssU*(l.qty||1);}return s+lT(l);},0);
  const rows=[[`Quotation: ${project.projectName}`],[`Client: ${project.client||""}`],[`Engineer: ${rev.engineerName||""}`],[`Sales Engineer: ${rev.salesEngineer||""}`],[`Code: ${rev.code}`],[`Date: ${rev.date||""}`],[`Currency: ${curr} (rate: ${rate})`],[],
    ["#","Brand","Description","Qty",`Unit Price (${curr})`,`Total (${curr})`],
    ...(() => { const ls=rev.lines||[]; const out=[]; for(let i=0;i<ls.length;i++){const l=ls[i]; if(l.type==="section"){out.push([l.label||"Section","","","","",""]);continue;} if(l.type==="subsystem"){const ssU=applyRounding(ssUnitPrice(l,rev.brandFactors,rev.localFactor),rnd,rate);const ssT=ssU*(l.qty||1);out.push([l.rowNum,l.partNumber||"",l.description+(l.optional?" (Subsystem, Optional)":" (Subsystem)"),l.optional?"Optional":(l.qty||1),l.optional?"—":fmtN(ssU,rnd),l.optional?"—":fmtN(ssT,rnd)]);continue;} const grp=l.mergeGroup;const isSubEntry=grp&&ls[i-1]?.mergeGroup===grp;out.push([isSubEntry?"":l.rowNum,l.brand||"",l.description||"",l.qty,fmtN(lUD(l),rnd),fmtN(lT(l),rnd)]);} return out; })(),
    [],[" "," "," "," ","Supply Total",fmtN(supplyTotal,rnd)],
    ...(rev.tcEnabled?[[" "," "," "," ","T&C",fmtN(applyRounding(rev.tcBaseUSD||0,rnd,rate),rnd)]]:[]),
    ...(rev.installEnabled?[[" "," "," "," ","Installation",fmtN(applyRounding(rev.installValue,rnd,rate),rnd)]]:[]),
    ...(rev.extras||[]).map(e=>[" "," "," "," ",e.label||"Extra",fmtN(applyRounding(parseFloat(e.value)||0,rnd,rate),rnd)]),
    [" "," "," "," ","GRAND TOTAL",fmtN(rev.grandTotal,rnd)],
    ...(rev.gtAfterDiscountEnabled&&rev.gtAfterDiscount?[[" "," "," "," ","Grand Total after discount",rev.gtAfterDiscount]]:[]),
    ...(rev.notes?[[],[`Notes: ${rev.notes}`]]:[]),
  ];
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${rev.code}.csv`;a.click();
}

function generateBOMPDF(project,rev,settings){
  rev={...(rev.data||{}),...rev};
  const co=settings.company;
  const hdr=headerHTML(co);
  const ftr=footerHTML(co,"Bill of Materials");
  const rows=(()=>{let n=0;const ls=rev.lines||[];const rows_=[];for(let i=0;i<ls.length;i++){const l=ls[i];if(l.type==="section"){rows_.push(sectionRowHTML(l.label,5));continue;}if(l.type==="subsystem"){n++;const ssGrp_=l.mergeGroup;const ssIsSE=ssGrp_&&ls[i-1]?.mergeGroup===ssGrp_;const rowsForLine_bom=x=>x.type==="subsystem"?2:1;let ssRs=rowsForLine_bom(l);if(ssGrp_&&!ssIsSE){let j=i+1;while(j<ls.length&&ls[j].mergeGroup===ssGrp_){ssRs+=rowsForLine_bom(ls[j]);j++;}}const ssNumCell=ssIsSE?"":`<td style="border:1px solid #ddd;padding:6px 8px;text-align:center;vertical-align:middle;font-weight:600;" rowspan="${ssRs}">${l.rowNum}</td>`;const hdr=`<tr style="background:${l.optional?"#fffbf0":"#f5f0ff"};">${ssNumCell}<td colspan="4" style="border:1px solid #ddd;padding:6px 8px;font-weight:600;color:${l.optional?"#888":"inherit"};">${l.description||""} <em style="font-size:10px;color:#7c3aed;font-weight:400;">(Subsystem ×${l.qty||1}${l.optional?", Opt.":""})</em></td></tr>`;rows_.push(hdr+subsystemSubtableHTML(l,l.qty||1,5,false,rev.brandFactors,rev.localFactor,false,fmtN,()=>0,()=>0));continue;}const grp=l.mergeGroup;const prevL=ls[i-1];const isSubEntry=grp&&prevL?.mergeGroup===grp;const rowsForLine_bom2=x=>x.type==="subsystem"?2:1;let rs=1;if(grp&&!isSubEntry){let j=i+1;while(j<ls.length&&ls[j].mergeGroup===grp){rs+=rowsForLine_bom2(ls[j]);j++;}}const numCell=isSubEntry?"":`<td style="border:1px solid #ddd;padding:6px 8px;text-align:center;vertical-align:middle;" rowspan="${rs}">${l.rowNum}</td>`;rows_.push(`<tr style="${l.optional?"background:#fffbf0;color:#888;":""}">
    ${numCell}<td style="border:1px solid #ddd;padding:6px 8px;font-family:monospace;font-size:11px;white-space:pre-wrap;">${l.modelNo||""}</td>
    <td style="border:1px solid #ddd;padding:6px 8px;">${l.brand||""}</td>
    <td style="border:1px solid #ddd;padding:6px 8px;white-space:pre-wrap;">${l.description||""}</td>
    <td style="border:1px solid #ddd;padding:6px 8px;text-align:center;">${l.optional?`<em>Opt.</em>`:l.qty}</td>
  </tr>`);}return rows_.join("");})();
  openWin(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>BOM — ${project.projectName}</title><style>body{font-family:Arial,sans-serif;font-size:12px;color:#222;margin:0;padding:28px 28px 60px;}@media print{body{padding:20px 20px 50px;}.no-print{display:none!important;}}@page{margin:10mm;}</style></head><body style="-webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;">
  ${hdr}<div style="margin-bottom:12px;"><strong style="font-size:14px;">Bill of Materials — ${project.projectName}<br>Company - ${project.client||""}</strong></div>
  <table style="width:100%;font-size:12px;border-collapse:collapse;">
    <thead><tr style="background:#c0392b;color:#fff;"><th style="border:1px solid #aaa;padding:7px 8px;text-align:center;width:5%">#</th><th style="border:1px solid #aaa;padding:7px 8px;width:15%">Model No</th><th style="border:1px solid #aaa;padding:7px 8px;width:12%">Brand</th><th style="border:1px solid #aaa;padding:7px 8px;">Description</th><th style="border:1px solid #aaa;padding:7px 8px;text-align:center;width:6%">Qty</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${ftr}${printBtn}</body></html>`);
}

function generateIssueSlipPDF(project,rev,settings){
  rev={...(rev.data||{}),...rev};
  const co=settings.company;
  const hdr=headerHTML(co);
  const ftr=footerHTML(co,"Issue Slip");
  // Same item-table row logic as the BOM PDF, unchanged.
  const rows=(()=>{let n=0;const ls=assignRowNums((rev.lines||[]).filter(l=>!l.optional).map(l=>l.type==="subsystem"?{...l,children:(l.children||[]).filter(c=>!c.optional)}:l));const rows_=[];for(let i=0;i<ls.length;i++){const l=ls[i];if(l.type==="section"){rows_.push(sectionRowHTML(l.label,5));continue;}if(l.type==="subsystem"){n++;const ssGrp_=l.mergeGroup;const ssIsSE=ssGrp_&&ls[i-1]?.mergeGroup===ssGrp_;const rowsForLine_bom=x=>x.type==="subsystem"?2:1;let ssRs=rowsForLine_bom(l);if(ssGrp_&&!ssIsSE){let j=i+1;while(j<ls.length&&ls[j].mergeGroup===ssGrp_){ssRs+=rowsForLine_bom(ls[j]);j++;}}const ssNumCell=ssIsSE?"":`<td style="border:1px solid #ddd;padding:6px 8px;text-align:center;vertical-align:middle;font-weight:600;" rowspan="${ssRs}">${l.rowNum}</td>`;const hdr=`<tr style="background:${l.optional?"#fffbf0":"#f5f0ff"};">${ssNumCell}<td colspan="4" style="border:1px solid #ddd;padding:6px 8px;font-weight:600;color:${l.optional?"#888":"inherit"};">${l.description||""} <em style="font-size:10px;color:#7c3aed;font-weight:400;">(Subsystem ×${l.qty||1}${l.optional?", Opt.":""})</em></td></tr>`;rows_.push(hdr+subsystemSubtableHTML(l,l.qty||1,5,false,rev.brandFactors,rev.localFactor,false,fmtN,()=>0,()=>0));continue;}const grp=l.mergeGroup;const prevL=ls[i-1];const isSubEntry=grp&&prevL?.mergeGroup===grp;const rowsForLine_bom2=x=>x.type==="subsystem"?2:1;let rs=1;if(grp&&!isSubEntry){let j=i+1;while(j<ls.length&&ls[j].mergeGroup===grp){rs+=rowsForLine_bom2(ls[j]);j++;}}const numCell=isSubEntry?"":`<td style="border:1px solid #ddd;padding:6px 8px;text-align:center;vertical-align:middle;" rowspan="${rs}">${l.rowNum}</td>`;rows_.push(`<tr style="${l.optional?"background:#fffbf0;color:#888;":""}">
    ${numCell}<td style="border:1px solid #ddd;padding:6px 8px;font-family:monospace;font-size:11px;white-space:pre-wrap;">${l.modelNo||""}</td>
    <td style="border:1px solid #ddd;padding:6px 8px;">${l.brand||""}</td>
    <td style="border:1px solid #ddd;padding:6px 8px;white-space:pre-wrap;">${l.description||""}</td>
    <td style="border:1px solid #ddd;padding:6px 8px;text-align:center;">${l.optional?`<em>Opt.</em>`:l.qty}</td>
  </tr>`);}return rows_.join("");})();
  // Arabic slip header — date is left blank for manual fill; client/project/
  // sales engineer are populated. Using a dir="rtl" table means the first
  // <td> in the markup renders on the right (reading-order-first), matching
  // the reference slip's layout.
  const slipHeader=`<div style="direction:rtl;text-align:right;font-size:13px;margin-bottom:16px;line-height:2.1;font-family:Arial,sans-serif;">
    <p style="margin:4px 0;">التاريخ:        /         /      ٢٠٢</p>
    <p style="margin:4px 0;">الجهة المنصرف إليها البضاعة : <strong>${project.client||""}</strong></p>
    <table style="width:100%;" dir="rtl"><tr>
      <td style="text-align:right;padding:0;">المشروع : <strong>${project.projectName||""}</strong></td>
      <td style="text-align:right;padding:0;">مهندس المشروع : <strong>${rev.salesEngineer||""}</strong></td>
    </tr></table>
  </div>`;
  // Arabic slip footer — centered receipt line, then a 3-column signature
  // block (dir="rtl" so "يعتمد" lands rightmost, the receiver-info block
  // lands leftmost, matching the reference slip).
  const slipFooter=`<div style="margin-top:28px;font-family:Arial,sans-serif;">
    <p style="text-align:center;font-weight:600;font-size:13px;direction:rtl;margin:0 0 22px;">استلمت البضاعة بحالة جيدة</p>
    <table style="width:100%;font-size:12px;direction:rtl;" dir="rtl"><tr>
      <td style="width:20%;text-align:center;font-weight:600;vertical-align:top;">يعتمد</td>
      <td style="width:25%;text-align:center;font-weight:600;vertical-align:top;">أمين المخزن</td>
      <td style="width:55%;text-align:right;vertical-align:top;line-height:2.3;">
        اسم المستلم: ...........................<br/>
        توقيع المستلم: ..........................<br/>
        رقم البطاقة:................................<br/>
        تاريخ الإستلام:.............................
      </td>
    </tr></table>
  </div>`;
  openWin(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Issue Slip — ${project.projectName}</title><style>body{font-family:Arial,sans-serif;font-size:12px;color:#222;margin:0;padding:28px 28px 60px;}@media print{body{padding:20px 20px 50px;}.no-print{display:none!important;}}@page{margin:10mm;}</style></head><body style="-webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;">
  ${hdr}${slipHeader}
  <table style="width:100%;font-size:12px;border-collapse:collapse;">
    <thead><tr style="background:#c0392b;color:#fff;"><th style="border:1px solid #aaa;padding:7px 8px;text-align:center;width:5%">#</th><th style="border:1px solid #aaa;padding:7px 8px;width:15%">Model No</th><th style="border:1px solid #aaa;padding:7px 8px;width:12%">Brand</th><th style="border:1px solid #aaa;padding:7px 8px;">Description</th><th style="border:1px solid #aaa;padding:7px 8px;text-align:center;width:6%">Qty</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${slipFooter}
  ${ftr}${printBtn}</body></html>`);
}

function exportBOMCSV(project,rev){
  rev={...(rev.data||{}),...rev};
  const rows=[[`BOM — ${project.projectName}`],[`Code: ${rev.code}`],[`Date: ${rev.date||""}`],[],
    ["#","Model No","Brand","Description","Qty"],
    ...(() => { const ls=rev.lines||[]; const out=[]; for(let i=0;i<ls.length;i++){const l=ls[i]; if(l.type==="section"){out.push([l.label||"Section","","","",""]);continue;} if(l.type==="subsystem"){out.push([l.rowNum,"",l.description+" (Subsystem ×"+(l.qty||1)+")"+(l.optional?" — OPTIONAL":""),""]);(l.children||[]).forEach((c,ci)=>out.push(["  └"+(ci+1),c.modelNo||"",c.brand||"",c.description||"",c.optional?"Optional":c.qty*(l.qty||1)]));continue;} const grp=l.mergeGroup;const isSubEntry=grp&&ls[i-1]?.mergeGroup===grp;out.push([isSubEntry?"":l.rowNum,l.modelNo||"",l.brand||"",l.description||"",l.optional?"Optional":l.qty]);} return out; })(),
  ];
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`BOM_${rev.code}.csv`;a.click();
}

function generateDetailedPDF(project, rev, settings, tplId){
  rev={...(rev.data||{}),...rev};
  const curr=rev.currency||"USD";
  const co=settings.company,rnd=rev.roundUp,rate=rev.conversionRate||1;
  const hdr=headerHTML(co);
  const ftr=footerHTML(co,"INTERNAL USE ONLY");
  const lFact=line=>applyRounding(calcUnitPrice(line,rev.brandFactors,rev.localFactor),rnd,rate);
  const lTot=line=>lFact(line)*line.qty;
  const lUD=line=>applyRounding(calcUnitPrice(line,rev.brandFactors,rev.localFactor),rnd,rate);
  const lT=line=>lUD(line)*line.qty;
  const supplyTotal=(rev.lines||[]).reduce((s,l)=>{if(l.optional)return s;if(l.type==="section")return s;if(l.type==="subsystem"){if(l.optional)return s;
  const ssU=applyRounding(ssUnitPrice(l,rev.brandFactors,rev.localFactor),rnd,rate);return s+ssU*(l.qty||1);}return s+lT(l);},0);
  const tcDisp=rev.tcEnabled?applyRounding(rev.tcBaseUSD||0,rnd,rate):0;
  const installDisp=rev.installEnabled?applyRounding(rev.installValue,rnd,rate):0;
  const extrasDisp=(rev.extras||[]).map(e=>({...e,disp:applyRounding(parseFloat(e.value)||0,rnd,rate)}));
  const grandTotal=supplyTotal+tcDisp+installDisp+extrasDisp.reduce((s,e)=>s+e.disp,0);
  const itemRows=(()=>{
    let n=0;
    const ls=rev.lines||[];
    const rows=[];
    for(let i=0;i<ls.length;i++){
      const l=ls[i];
      if(l.type==="section"){
        rows.push(sectionRowHTML2(l.label,11));
        continue;
      }
      if(l.type==="subsystem"){
        n++;
        const ssU=applyRounding(ssUnitPrice(l,rev.brandFactors,rev.localFactor),rnd,rate);
        const ssT=ssU*(l.qty||1);
        const lUD_=c=>applyRounding(calcUnitPrice(c,rev.brandFactors,rev.localFactor),rnd,rate);
        const lT_=c=>lUD_(c)*c.qty;const ssGrp_=l.mergeGroup;
        const ssIsSE=ssGrp_&&ls[i-1]?.mergeGroup===ssGrp_;
        const rowsForLine_det=x=>x.type==="subsystem"?(3+(x.children||[]).length):1;
        let ssRs=rowsForLine_det(l);
        if(ssGrp_&&!ssIsSE){
          let j=i+1;
          while(j<ls.length&&ls[j].mergeGroup===ssGrp_){
            ssRs+=rowsForLine_det(ls[j]);
            j++;
          }
        }
        const ssNumCell=ssIsSE?"":`<td style="border:1px solid #ddd;padding:5px 8px;text-align:center;vertical-align:middle;font-weight:600;" ${ssGrp_?'colspan="2" ':''}rowspan="${ssRs}">${l.rowNum}</td>`;const ssDetUnit=l.optional?"Optional":fmtN(ssU,rnd);
        const ssDetTot=l.optional?"—":fmtN(ssT,rnd);
        const hdr=`<tr style="background:${l.optional?"#fffbf0":"#ede9fe"};color:${l.optional?"#888":"inherit"};">${ssNumCell}${ssGrp_?"":"<td></td>"}<td>${l.partNumber}</td><td style="border:1px solid #ddd;padding:5px 8px;text-align:center;font-weight:600;" >${l.brand}</td><td colspan="5" style="border:1px solid #ddd;padding:5px 8px;font-weight:600;">${l.description||""} <em style="font-size:10px;color:#7c3aed;font-weight:400;">(Subsystem ×${l.optional?"opt.":l.qty||1})</em></td><td style="border:1px solid #ddd;padding:5px 8px;text-align:center;">${ssDetUnit}</td><td style="border:1px solid #ddd;padding:5px 8px;text-align:center;">${l.optional?"opt.":l.qty||1}</td><td colspan="1" style="border:1px solid #ddd;padding:5px 8px;text-align:right;font-weight:600;">${ssDetTot}</td></tr>`;
        rows.push(hdr+subsystemSubtableHTML2(l,l.qty||1,9,true,rev.brandFactors,rev.localFactor,rnd,fmtN,lUD_,lT_));
        continue;
      }
      const grp=l.mergeGroup;const prevL=ls[i-1];
      const isSubEntry=grp&&prevL?.mergeGroup===grp;
      const rowsForLine_det2=x=>x.type==="subsystem"?(3+(x.children||[]).length):1;
      let rs=1;
      if(grp&&!isSubEntry){
        let j=i+1;
        while(j<ls.length&&ls[j].mergeGroup===grp){
          rs+=rowsForLine_det2(ls[j]);
          j++;
        }
      }
      const numCell=isSubEntry?"":`<td colspan="2" style="border:1px solid #ddd;padding:5px 8px;text-align:center;vertical-align:middle;" rowspan="${rs}">${l.rowNum}</td>`;
      rows.push(`<tr>${numCell}<td style="border:1px solid #ddd;padding:5px 8px;font-family:monospace;font-size:11px;white-space:pre-wrap;">${l.modelNo||""}</td><td style="border:1px solid #ddd;padding:5px 8px;">${l.brand||""}</td><td colspan="3"style="border:1px solid #ddd;padding:5px 8px;white-space:pre-wrap;">${l.description||""}</td><td style="border:1px solid #ddd;padding:5px 8px;text-align:right;">${fmtN(l.glp,false)}</td><td style="border:1px solid #ddd;padding:5px 8px;text-align:right;">${fmtN(l.local||0,false)}</td><td style="border:1px solid #ddd;padding:5px 8px;text-align:right;">${fmtN(lFact(l),rnd)}${factorNoteHTML(l,rev.brandFactors,rev.localFactor)}</td><td style="border:1px solid #ddd;padding:5px 8px;text-align:center;">${l.optional?"opt.":l.qty}</td><td style="border:1px solid #ddd;padding:5px 8px;text-align:right;">${l.optional?"optional":fmtN(lTot(l),rnd)}</td></tr>`);}return rows.join("");
    })();

  const totRows=[
    `<tr style="background:#f9f9f9;"><td colspan="11" style="border:1px solid #ddd;padding:7px 10px;text-align:right;font-weight:700;">Total for supply</td><td style="border:1px solid #ddd;padding:7px 10px;text-align:right;font-weight:700;">$ ${fmtN(supplyTotal,rnd)}</td></tr>`,
    ...(rev.tcEnabled?[`<tr><td colspan="11" style="border:1px solid #ddd;padding:7px 10px;text-align:right;">Total for T&C</td><td style="border:1px solid #ddd;padding:7px 10px;text-align:right;">$ ${fmtN(tcDisp,rnd)}</td></tr>`]:[]),
    ...(rev.installEnabled?[`<tr><td colspan="11" style="border:1px solid #ddd;padding:7px 10px;text-align:right;">Installation</td><td style="border:1px solid #ddd;padding:7px 10px;text-align:right;">$ ${fmtN(installDisp,rnd)}</td></tr>`]:[]),
    ...extrasDisp.map(e=>`<tr><td colspan="11" style="border:1px solid #ddd;padding:7px 10px;text-align:right;">${e.label||"Extra"}</td><td style="border:1px solid #ddd;padding:7px 10px;text-align:right;">$ ${fmtN(e.disp,rnd)}</td></tr>`),
    `<tr style="background:#fdf0f0;"><td colspan="11" style="border:1px solid #ddd;padding:8px 10px;text-align:right;font-weight:700;font-size:14px;color:#c0392b;">Grand Total (${curr})</td><td style="border:1px solid #ddd;padding:8px 10px;text-align:right;font-weight:700;font-size:14px;color:#c0392b;">${curr==="USD"?"$":curr} ${fmtN(grandTotal,rnd)}</td></tr>`,
    ...(rev.gtAfterDiscountEnabled&&rev.gtAfterDiscount?[`<tr><td colspan="11" style="border:1px solid #ddd;padding:7px 10px;text-align:right;">Grand Total after discount</td><td style="border:1px solid #ddd;padding:7px 10px;text-align:right;">${rev.gtAfterDiscount}</td></tr>`]:[]),
  ].join("");
  // Brand summary — GLP brands + Local as a separate entry. Factor = effective factor from
  // Σ(GLP × qty × factor) = GLP_total × Factor_total (includes custom item factors, marked ★).
  // "After Factor" is in the quotation currency, rounded like the rest of the quotation.
  const fs=factorSummary(rev.lines,rev.brandFactors,rev.localFactor);
  const brandMap=fs.brands;
  const totalLocal=fs.local.raw;
  const totalLocalFactored=applyRounding(fs.local.factored,rnd,rate);
  const star=on=>on?` <span style="color:#1d4ed8;">★</span>`:"";
  const brandRows=Object.entries(brandMap).map(([b,v])=>`<tr>
    <td style="border:1px solid #ddd;padding:5px 8px;">${b}</td>
    <td style="border:1px solid #ddd;padding:5px 8px;text-align:right;">${fmtN(v.glp,false)}</td>
    <td style="border:1px solid #ddd;padding:5px 8px;text-align:center;">×${fmtFactor(v.factor)}${star(v.custom)}</td>
    <td style="border:1px solid #ddd;padding:5px 8px;text-align:right;">${fmtN(applyRounding(v.factored,rnd,rate),rnd)}</td>
  </tr>`).join("");
  const localRow=totalLocal>0?`<tr style="background:#f0f7ff;">
    <td style="border:1px solid #ddd;padding:5px 8px;font-style:italic;">Local</td>
    <td style="border:1px solid #ddd;padding:5px 8px;text-align:right;">${fmtN(totalLocal,false)}</td>
    <td style="border:1px solid #ddd;padding:5px 8px;text-align:center;">×${fmtFactor(fs.local.factor)}${star(fs.local.custom)}</td>
    <td style="border:1px solid #ddd;padding:5px 8px;text-align:right;">${fmtN(totalLocalFactored,rnd)}</td>
  </tr>`:"";
  const tGLP=Object.values(brandMap).reduce((s,v)=>s+v.glp,0);
  const tFact=Object.values(brandMap).reduce((s,v)=>s+applyRounding(v.factored,rnd,rate),0)+totalLocalFactored;
  const anyCustom=Object.values(brandMap).some(v=>v.custom)||fs.local.custom;
  openWin(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Detailed — ${project.projectName}</title><style>
    body{font-family:Arial,sans-serif;font-size:11px;color:#222;margin:0;padding:28px 28px 60px;}
    .footer{position:fixed;bottom:0;left:0;right:0;border-top:1px solid #e0e0e0;padding:5px 28px;font-size:10px;color:#888;display:flex;justify-content:space-between;background:#fff;}
    @media print{body{padding:20px 20px 50px;}.no-print{display:none!important;}.footer{display:none;}}
    @page{margin:10mm;@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:10px;color:#888;font-family:Arial,sans-serif;}}
    @page{@bottom-left{content:"${co.name} | ${co.address} | Tel: ${co.phone} | ${co.email}";font-size:9px;color:#888;font-family:Arial,sans-serif;}}
  </style></head><body style="-webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;">
  ${hdr}<div style="margin-bottom:12px;"><strong style="font-size:14px;">Detailed Quotation — ${project.projectName}</strong><span style="margin-left:16px;font-size:11px;color:#c0392b;border:1px solid #c0392b;padding:2px 8px;border-radius:4px;">INTERNAL USE ONLY</span></div>
  <table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:20px;">
    <thead><tr style="background:#c0392b;color:#fff;">
      <th colspan="2" style=" border:1px solid #aaa;padding:6px 8px;text-align:center;width:4%">#</th>
      <th style="border:1px solid #aaa;padding:6px 8px;width:11%">Model No</th>
      <th style="border:1px solid #aaa;padding:6px 8px;width:9%">Brand</th>
      <th colspan="3" style="border:1px solid #aaa;padding:6px 8px;">Description</th>
      <th style="border:1px solid #aaa;padding:6px 8px;text-align:right;width:8%">GLP Unit</th>
      <th style="border:1px solid #aaa;padding:6px 8px;text-align:right;width:8%">Local Unit</th>
      <th style="border:1px solid #aaa;padding:6px 8px;text-align:right;width:9%">Unit Price</th>
      <th style="border:1px solid #aaa;padding:6px 8px;text-align:center;width:5%">Qty</th>
      <th style="border:1px solid #aaa;padding:6px 8px;text-align:right;width:9%">Total</th>
    </tr></thead>
    <tbody>${itemRows}${totRows}</tbody>
  </table>
  <strong style="font-size:12px;">Brand Summary</strong>
  <table style="width:55%;font-size:11px;border-collapse:collapse;margin-top:8px;">
    <thead><tr style="background:#555;color:#fff;">
      <th style="border:1px solid #aaa;padding:6px 8px;">Brand / Source</th>
      <th style="border:1px solid #aaa;padding:6px 8px;text-align:right;">Total (USD)</th>
      <th style="border:1px solid #aaa;padding:6px 8px;text-align:center;">Factor</th>
      <th style="border:1px solid #aaa;padding:6px 8px;text-align:right;">After Factor (${curr})</th>
    </tr></thead>
    <tbody>${brandRows}${localRow}</tbody>
    <tfoot><tr style="background:#f0f0f0;font-weight:700;">
      <td style="border:1px solid #ddd;padding:6px 8px;">TOTAL</td>
      <td style="border:1px solid #ddd;padding:6px 8px;text-align:right;">${fmtN(tGLP+totalLocal,false)}</td>
      <td style="border:1px solid #ddd;padding:6px 8px;"></td>
      <td style="border:1px solid #ddd;padding:6px 8px;text-align:right;">${fmtN(tFact,rnd)}</td>
    </tr></tfoot>
  </table>
  <p style="font-size:10px;color:#888;margin:6px 0 0;">Factor per brand = Σ(GLP × qty × factor) ÷ Σ(GLP × qty).${anyCustom?` <span style="color:#1d4ed8;">★</span> = includes items with a custom factor (shown in blue under their price).`:""}</p>
  <div class="footer"><span>${co.name} | ${co.address} | Tel: ${co.phone} | ${co.email}</span><span>Detailed Quotation — Internal Use Only</span></div>
  ${printBtn}</body></html>`);
}

function exportDetailedCSV(project,rev){
  rev={...(rev.data||{}),...rev};
  const rnd=rev.roundUp,rate=rev.conversionRate||1;
  const lFact=line=>applyRounding(calcUnitPrice(line,rev.brandFactors,rev.localFactor),rnd,rate);
  const lTot=line=>lFact(line)*line.qty;
  // Brand summary uses the effective factor per brand: Σ(GLP × qty × factor) ÷ Σ(GLP × qty).
  const fs=factorSummary(rev.lines,rev.brandFactors,rev.localFactor);
  const brandMap=fs.brands;
  const totalLocal=fs.local.raw;
  const totalLocalFactored=applyRounding(fs.local.factored,rnd,rate);
  const tFact=Object.values(brandMap).reduce((s,v)=>s+applyRounding(v.factored,rnd,rate),0)+totalLocalFactored;
  const fN=x=>factorNoteText(x,rev.brandFactors,rev.localFactor);
  const rows=[
    [`Detailed Quotation — ${project.projectName}`],[`INTERNAL USE ONLY`],[`Code: ${rev.code}`],[`Date: ${rev.date||""}`],[],
    ["#","Model No","Brand","Description","GLP Unit","Local Unit","Factor","Unit Price","Qty","Total"],
    ...(() => { const ls=rev.lines||[]; const out=[]; for(let i=0;i<ls.length;i++){const l=ls[i]; if(l.type==="section"){out.push([l.label||"Section","","","","","","","","",""]);continue;} if(l.type==="subsystem"){const ssU=applyRounding(ssUnitPrice(l,rev.brandFactors,rev.localFactor),rnd,rate);const ssT=ssU*(l.qty||1);out.push([l.rowNum,"","",l.description+(l.optional?" (Subsystem, Optional)":" (Subsystem)"),"","","","",l.optional?"Optional":(l.qty||1),l.optional?"—":fmtN(ssT,rnd)]);(l.children||[]).forEach((c,ci)=>{const cU=applyRounding(calcUnitPrice(c,rev.brandFactors,rev.localFactor),rnd,rate);out.push(["  └"+(ci+1),c.modelNo||"",c.brand||"",c.description||"",fmtN(c.glp,false),fmtN(c.local||0,false),fN(c),fmtN(cU,rnd),c.qty,fmtN(cU*c.qty,rnd)]);});continue;} const grp=l.mergeGroup;const isSubEntry=grp&&ls[i-1]?.mergeGroup===grp;out.push([isSubEntry?"":l.rowNum,l.modelNo||"",l.brand||"",l.description||"",fmtN(l.glp,false),fmtN(l.local||0,false),fN(l),fmtN(lFact(l),rnd),l.qty,fmtN(lTot(l),rnd)]);} return out; })(),
    [],[`Brand Summary`],
    ["Brand / Source","Total (USD)","Factor","After Factor"],
    ...Object.entries(brandMap).map(([b,v])=>[b,fmtN(v.glp,false),`×${fmtFactor(v.factor)}${v.custom?" (incl. custom)":""}`,fmtN(applyRounding(v.factored,rnd,rate),rnd)]),
    ...(totalLocal>0?[["Local",fmtN(totalLocal,false),`×${fmtFactor(fs.local.factor)}${fs.local.custom?" (incl. custom)":""}`,fmtN(totalLocalFactored,rnd)]]:[]),
    ["TOTAL",fmtN(Object.values(brandMap).reduce((s,v)=>s+v.glp,0)+totalLocal,false),"",fmtN(tFact,rnd)],
    [],["Factor per brand = Σ(GLP × qty × factor) ÷ Σ(GLP × qty)"],
  ];
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`DetailedQuotation_${rev.code}.csv`;a.click();
}

// ─── Quotation with Part Numbers PDF ─────────────────────────────────────────
function generatePartNumPDF(project, rev, settings, tplId) {
  rev={...(rev.data||{}),...rev};
  const curr=rev.currency||"USD",rnd=rev.roundUp,rate=rev.conversionRate||1;
  const tpl=settings.templates.find(t=>t.id===tplId)||settings.templates[0];
  const co=settings.company;
  const lUD=line=>applyRounding(calcUnitPrice(line,rev.brandFactors,rev.localFactor),rnd,rate);
  const lT=line=>line.optional?0:lUD(line)*line.qty;
  const supplyTotal=(rev.lines||[]).reduce((s,l)=>{if(l.type==="section")return s;if(l.type==="subsystem"){if(l.optional)return s;const ssU=applyRounding(ssUnitPrice(l,rev.brandFactors,rev.localFactor),rnd,rate);return s+ssU*(l.qty||1);}return s+lT(l);},0);
  const tcDisp=rev.tcEnabled?applyRounding(rev.tcBaseUSD||0,rnd,rate):0;
  const installDisp=rev.installEnabled?applyRounding(rev.installValue,rnd,rate):0;
  const extrasDisp=(rev.extras||[]).map(e=>({...e,disp:applyRounding(parseFloat(e.value)||0,rnd,rate)}));
  const grandTotal=supplyTotal+tcDisp+installDisp+extrasDisp.reduce((s,e)=>s+e.disp,0);
  const coverLetter=(tpl.coverLetter||"").replace(/{currency}/g,curr);
  const hdr=headerHTML(co);

  const itemRows = (() => {
    let n = 0;
    const ls = rev.lines || [];
    const rows = [];

    for (let i = 0; i < ls.length; i++) {
        const l = ls[i];

        // ==================== SECTION ROW ====================
        if (l.type === "section") {
            rows.push(sectionRowHTML(l.label, 7));
            continue;
        }

        // ==================== SUBSYSTEM ROW ====================
        if (l.type === "subsystem") {
            n++;

            const ssU = applyRounding(
                ssUnitPrice1(l, rev.brandFactors, rev.localFactor),
                rnd,
                rate
            );
            const ssT = ssU * (l.qty || 1);

            const ssGrp_ = l.mergeGroup;
            const ssIsSE = ssGrp_ && ls[i - 1]?.mergeGroup === ssGrp_;

            let ssRs = 1;
            if (ssGrp_ && !ssIsSE) {
                let j = i + 1;
                while (j < ls.length && ls[j].mergeGroup === ssGrp_) {
                    ssRs++;
                    j++;
                }
            }

            const ssNumCell = ssIsSE
                ? ""
                : `<td style="border:1px solid #ddd;padding:6px 8px;text-align:center;vertical-align:middle;" rowspan="${ssRs}">${l.rowNum}</td>`;

            const ssQtyCell = l.optional
                ? `<em style="color:#888;">Opt.</em>`
                : `${l.qty || 1}`;

            const ssUnitCell = `${curr === "USD" ? "$" : curr} ${fmtN(ssU, rnd)}`;

            const ssTotCell = l.optional
                ? `—`
                : `${curr === "USD" ? "$" : curr}  ${fmtN(ssT, rnd)}`;

            rows.push(`
                <tr style="background:${l.optional ? "#fffbf0" : "#f5f0ff"}; color:${l.optional ? "#888" : "inherit"};">
                    ${ssNumCell}
                    <td style="border:1px solid #ddd;padding:6px 8px;font-family:monospace;font-size:10px;white-space:pre-wrap;">${(l.partNumber || "").replace(/\n/g, "<br/>")}</td>
                    <td style="border:1px solid #ddd;padding:6px 8px;">
                        ${l.brand || ""}
                    </td>
                    <td style="border:1px solid #ddd;padding:6px 8px;font-weight:400;white-space: pre-wrap;">${l.description || ""}<em style="font-size:10px;color:#7c3aed;font-weight:400;"></em></td>
                    <td style="border:1px solid #ddd;padding:6px 8px;text-align:center;">
                        ${l.optional?"Opt.":ssQtyCell}
                    </td>
                    <td style="border:1px solid #ddd;padding:6px 8px;text-align:right;">
                        ${ssUnitCell}
                    </td>
                    <td style="border:1px solid #ddd;padding:6px 8px;text-align:right;font-weight:400;">
                        ${l.optional?"Opt.":ssTotCell}
                    </td>
                </tr>
            `);

            continue;
        }

        // ==================== REGULAR ITEM ROW ====================
        const grp = l.mergeGroup;
        const prevL = ls[i - 1];
        const isSubEntry = grp && prevL?.mergeGroup === grp;

        let rs = 1;
        if (grp && !isSubEntry) {
            let j = i + 1;
            while (j < ls.length && ls[j].mergeGroup === grp) {
                rs++;
                j++;
            }
        }

        const numCell = isSubEntry
            ? ""
            : `<td style="border:1px solid #ddd;padding:6px 8px;text-align:center;vertical-align:middle;" rowspan="${rs}">${l.rowNum}</td>`;

        rows.push(`
                <tr style="background:${l.optional ? "#fffbf0" : "#f5f0ff"}; color:${l.optional ? "#888" : "inherit"};">
                    ${numCell}
                <td style="border:1px solid #ddd;padding:6px 8px;font-family:monospace;font-size:11px;white-space:pre-wrap;">${l.modelNo || ""}</td>
                <td style="border:1px solid #ddd;padding:6px 8px;">
                    ${l.brand || ""}
                </td>
                <td style="border:1px solid #ddd;padding:6px 8px;white-space:pre-wrap;">${l.description || ""}</td>
                <td style="border:1px solid #ddd;padding:6px 8px;text-align:center;">
                    ${l.optional?"Opt.":l.qty}
                </td>
                <td style="border:1px solid #ddd;padding:6px 8px;text-align:right;">
                    ${curr === "USD" ? "$" : curr} ${fmtN(lUD(l), rnd)}
                </td>
                <td style="border:1px solid #ddd;padding:6px 8px;text-align:right;">
                    ${l.optional?"Opt.":(curr === "USD" ? "$" : curr)} ${l.optional?"":fmtN(lT(l), rnd)}
                </td>
            </tr>
        `);
    }

    return rows.join("");
})();

const totRows = [
  `<tr style="background:#f9f9f9;">
    <td colspan="6" style="${tot_Normal_Style}">
      Total for supply
    </td>
    <td style="${tot_Normal_Style}">
      ${curr === "USD" ? "$" : curr} ${fmtN(supplyTotal, rnd)}
    </td>
  </tr>`,

  ...(rev.tcEnabled
    ? [
        `<tr>
          <td colspan="6" style="${tot_Normal_Style}">
            Total for T&C
          </td>
          <td style="${tot_Normal_Style}">
            ${curr === "USD" ? "$" : curr} ${fmtN(tcDisp, rnd)}
          </td>
        </tr>`,
      ]
    : []),

  ...(rev.installEnabled
    ? [
        `<tr>
          <td colspan="6" style="${tot_Normal_Style}">
            Installation
          </td>
          <td style="${tot_Normal_Style}">
            ${curr === "USD" ? "$" : curr} ${fmtN(installDisp, rnd)}
          </td>
        </tr>`,
      ]
    : []),

  ...extrasDisp.map(
    (e) => `<tr>
      <td colspan="6" style="${tot_Normal_Style}">
        ${e.label || "Extra"}
      </td>
      <td style="${tot_Normal_Style}">
        ${curr === "USD" ? "$" : curr} ${fmtN(e.disp, rnd)}
      </td>
    </tr>`
  ),

  `<tr style="background:#fdf0f0;">
    <td colspan="6" style="${(rev.gtAfterDiscountEnabled && rev.gtAfterDiscount)
      ? tot_Normal_Style
      : "border:1px solid #ddd;padding:8px 10px;text-align:right;font-weight:700;font-size:14px;color:#c0392b;"
     }
    ">
      Grand Total (${curr})
    </td>
    <td style="${(rev.gtAfterDiscountEnabled && rev.gtAfterDiscount)
      ? tot_Normal_Style
      : tot_emphasized_style
     }
    ">
      ${curr === "USD" ? "$" : curr} ${fmtN(grandTotal, rnd)}
    </td>
  </tr>`,

  ...(rev.gtAfterDiscountEnabled && rev.gtAfterDiscount
    ? [
        `<tr>
          <td colspan="6" style="${tot_emphasized_style}">
            Grand Total after discount (${curr})
          </td>
          <td style="${tot_emphasized_style}">
            ${curr === "USD" ? "$" : curr}${rev.gtAfterDiscount}
          </td>
        </tr>`,
      ]
    : []),
].join("");

  const theadRowHTML=`<tr style="background:#c0392b;color:#fff;"><th style="border:1px solid #aaa;padding:7px 8px;text-align:center;width:5%">#</th><th style="border:1px solid #aaa;padding:7px 8px;width:13%">Model No</th><th style="border:1px solid #aaa;padding:7px 8px;width:11%">Brand</th><th style="border:1px solid #aaa;padding:7px 8px;">Description</th><th style="border:1px solid #aaa;padding:7px 8px;text-align:center;width:8%">Qty</th><th style="border:1px solid #aaa;padding:7px 8px;text-align:right;width:12%">Unit Price</th><th style="border:1px solid #aaa;padding:7px 8px;text-align:right;width:12%">Total</th></tr>`;
  const titleBlockHTML=`<h3 style="margin-top:0;">Quotation — ${project.projectName}</h3>`;
  const contentPages=estimateContentPages(theadRowHTML,itemRows+totRows,hdr+titleBlockHTML);
  const totalPages=2+contentPages;

  const infoTable=`<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:18px;">
  <tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;;width:110px;">Project:</td><td style="border:1px solid #ccc;padding:5px 8px;" colspan="3"><strong>${project.projectName}</strong></td></tr>
  <tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Company</td><td style="border:1px solid #ccc;padding:5px 8px;" colspan="3">${project.client||""}</td></tr>
  <tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Contact:</td><td style="border:1px solid #ccc;padding:5px 8px;">${rev.contactName||""}</td><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Project Day</td><td style="border:1px solid #ccc;padding:5px 8px;">${rev.date||""}</td></tr>
  <tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Phone:</td><td style="border:1px solid #ccc;padding:5px 8px;">${rev.contactPhone||""}</td><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Sales Engineer</td><td style="border:1px solid #ccc;padding:5px 8px;">${rev.salesEngineer||""}</td></tr>
  <tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">E-Mail:</td><td style="border:1px solid #ccc;padding:5px 8px;">${rev.contactEmail||""}</td><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Pages</td><td style="border:1px solid #ccc;padding:5px 8px;">Pages ${totalPages}</td></tr>
  <tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Ref:</td><td style="border:1px solid #ccc;padding:5px 8px;">${rev.systemType||""}</td><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Pre-Sales Engineer</td><td style="border:1px solid #ccc;padding:5px 8px;">${rev.engineerName||""}</td></tr>
  <tr><td style="border:1px solid #ccc;padding:5px 8px;font-weight:600;background:#c0392b;color:#fff;">Code:</td><td style="border:1px solid #ccc;padding:5px 8px;" colspan="3"><code>${rev.code}</code></td></tr>
</table>`;

  openWin(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${rev.code}</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;color:#222;margin:0;padding:0;}
    .page{padding:28px 28px 16px;page-break-after:always;position:relative;box-sizing:border-box;}
    .page:last-of-type{page-break-after:auto;}
    @media print{
      .page{padding:20px 20px 10px;}
      .no-print{display:none!important;}
      @page{margin:10mm;}
    }
    @page{margin:10mm;@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:10px;color:#888;font-family:Arial,sans-serif;}}
    @page{@bottom-left{content:"${co.name} | ${co.address} | Tel: ${co.phone} | ${co.email}";font-size:9px;color:#888;font-family:Arial,sans-serif;}}
    h3{color:#c0392b;border-bottom:1px solid #c0392b;padding-bottom:4px;}
  </style></head><body style="-webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;">
  <div class="page">${hdr}${infoTable}<div style="white-space:pre-wrap;font-size:12px;line-height:1.7;">${coverLetter}</div>
  </div>
  <div class="page">${hdr}<h3 style="margin-top:0;">Terms &amp; Conditions</h3><div style="white-space:pre-wrap;font-size:12px;line-height:1.8;">${tpl.termsAndConditions||""}</div>
  </div>
  <div class="page">${hdr}${titleBlockHTML}
  <table style="width:100%;font-size:12px;border-collapse:collapse;">
    <thead>${theadRowHTML}</thead>
    <tbody>${itemRows}${totRows}</tbody>
  </table>
  ${rev.notes?`<div style="margin-top:16px;padding:10px 14px;background:#f9f9f9;border:1px solid #ddd;border-radius:4px;font-size:12px;white-space:pre-wrap;"><strong>Notes:</strong><br/>${rev.notes}</div>`:""}
  ${printBtn}</body></html>`);
}
function ClientBoM(project, rev, settings, tplId) {
  rev={...(rev.data||{}),...rev};
  const curr=rev.currency||"USD",rnd=rev.roundUp,rate=rev.conversionRate||1;
  const tpl=settings.templates.find(t=>t.id===tplId)||settings.templates[0];
  const co=settings.company;
  const lUD=line=>applyRounding(calcUnitPrice(line,rev.brandFactors,rev.localFactor),rnd,rate);
  const lT=line=>line.optional?0:lUD(line)*line.qty;
  const supplyTotal=(rev.lines||[]).reduce((s,l)=>{if(l.type==="section")return s;if(l.type==="subsystem"){if(l.optional)return s;const ssU=applyRounding(ssUnitPrice(l,rev.brandFactors,rev.localFactor),rnd,rate);return s+ssU*(l.qty||1);}return s+lT(l);},0);
  const tcDisp=rev.tcEnabled?applyRounding(rev.tcBaseUSD||0,rnd,rate):0;
  const installDisp=rev.installEnabled?applyRounding(rev.installValue,rnd,rate):0;
  const extrasDisp=(rev.extras||[]).map(e=>({...e,disp:applyRounding(parseFloat(e.value)||0,rnd,rate)}));
  const grandTotal=supplyTotal+tcDisp+installDisp+extrasDisp.reduce((s,e)=>s+e.disp,0);
  const coverLetter=(tpl.coverLetter||"").replace(/{currency}/g,curr);
  const hdr=headerHTML(co);

  const itemRows = (() => {
    let n = 0;
    const ls = rev.lines || [];
    const rows = [];

    for (let i = 0; i < ls.length; i++) {
        const l = ls[i];

        // ==================== SECTION ROW ====================
        if (l.type === "section") {
            rows.push(sectionRowHTML(l.label, 7));
            continue;
        }

        // ==================== SUBSYSTEM ROW ====================
        if (l.type === "subsystem") {
            n++;

            const ssU = applyRounding(
                ssUnitPrice(l, rev.brandFactors, rev.localFactor),
                rnd,
                rate
            );
            const ssT = ssU * (l.qty || 1);

            const ssGrp_ = l.mergeGroup;
            const ssIsSE = ssGrp_ && ls[i - 1]?.mergeGroup === ssGrp_;

            let ssRs = 1;
            if (ssGrp_ && !ssIsSE) {
                let j = i + 1;
                while (j < ls.length && ls[j].mergeGroup === ssGrp_) {
                    ssRs++;
                    j++;
                }
            }

            const ssNumCell = ssIsSE
                ? ""
                : `<td style="border:1px solid #ddd;padding:6px 8px;text-align:center;vertical-align:middle;" rowspan="${ssRs}">${l.rowNum}</td>`;

            const ssQtyCell = l.optional
                ? `<em style="color:#888;">Optional</em>`
                : `${l.qty || 1}`;


            rows.push(`
                <tr style="background:${l.optional ? "#fffbf0" : "#f5f0ff"}; color:${l.optional ? "#888" : "inherit"};">
                    ${ssNumCell}
                    <td style="border:1px solid #ddd;padding:6px 8px;font-family:monospace;font-size:10px;white-space:pre-wrap;">${(l.partNumber || "").replace(/\n/g, "<br/>")}</td>
                    <td style="border:1px solid #ddd;padding:6px 8px;">
                        ${l.brand || ""}
                    </td>
                    <td style="border:1px solid #ddd;padding:6px 8px;font-weight:400;">
                        ${l.description || ""}
                        <em style="font-size:10px;color:#7c3aed;font-weight:400;"></em>
                    </td>
                    <td style="border:1px solid #ddd;padding:6px 8px;text-align:center;">
                        ${l.optional?"Opt.":ssQtyCell}
                    </td>
                </tr>
            `);

            continue;
        }

        // ==================== REGULAR ITEM ROW ====================
        const grp = l.mergeGroup;
        const prevL = ls[i - 1];
        const isSubEntry = grp && prevL?.mergeGroup === grp;

        let rs = 1;
        if (grp && !isSubEntry) {
            let j = i + 1;
            while (j < ls.length && ls[j].mergeGroup === grp) {
                rs++;
                j++;
            }
        }

        const numCell = isSubEntry
            ? ""
            : `<td style="border:1px solid #ddd;padding:6px 8px;text-align:center;vertical-align:middle;" rowspan="${rs}">${l.rowNum}</td>`;

        rows.push(`
                <tr style="background:${l.optional ? "#fffbf0" : "#f5f0ff"}; color:${l.optional ? "#888" : "inherit"};">
                    ${numCell}
                <td style="border:1px solid #ddd;padding:6px 8px;font-family:monospace;font-size:11px;white-space:pre-wrap;">${l.modelNo || ""}</td>
                <td style="border:1px solid #ddd;padding:6px 8px;">
                    ${l.brand || ""}
                </td>
                <td style="border:1px solid #ddd;padding:6px 8px;white-space:pre-wrap;">${l.description || ""}</td>
                <td style="border:1px solid #ddd;padding:6px 8px;text-align:center;">
                    ${l.optional?"opt.":l.qty}
                </td>
            </tr>
        `);
    }

    return rows.join("");
})();
  const theadRowHTML=`<tr style="background:#c0392b;color:#fff;"><th style="border:1px solid #aaa;padding:7px 8px;text-align:center;width:5%">#</th><th style="border:1px solid #aaa;padding:7px 8px;width:13%">Model No</th><th style="border:1px solid #aaa;padding:7px 8px;width:11%">Brand</th><th style="border:1px solid #aaa;padding:7px 8px;">Description</th><th style="border:1px solid #aaa;padding:7px 8px;text-align:center;width:8%">Qty</th></tr>`;
  const titleBlockHTML=`<h3 style="margin-top:0;">Quotation — ${project.projectName}</h3>`;
  const contentPages=estimateContentPages(theadRowHTML,itemRows,hdr+titleBlockHTML);
  const totalPages=2+contentPages;


  openWin(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${rev.code}</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;color:#222;margin:0;padding:0;}
    .page{padding:28px 28px 16px;page-break-after:always;position:relative;box-sizing:border-box;}
    .page:last-of-type{page-break-after:auto;}
    @media print{
      .page{padding:20px 20px 10px;}
      .no-print{display:none!important;}
      @page{margin:10mm;}
    }
    @page{margin:10mm;@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:10px;color:#888;font-family:Arial,sans-serif;}}
    @page{@bottom-left{content:"${co.name} | ${co.address} | Tel: ${co.phone} | ${co.email}";font-size:9px;color:#888;font-family:Arial,sans-serif;}}
    h3{color:#c0392b;border-bottom:1px solid #c0392b;padding-bottom:4px;}
  </style></head><body style="-webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;">
  <div class="page">${hdr}${titleBlockHTML}
  <table style="width:100%;font-size:12px;border-collapse:collapse;">
    <thead>${theadRowHTML}</thead>
    <tbody>${itemRows}</tbody>
  </table>
  ${rev.notes?`<div style="margin-top:16px;padding:10px 14px;background:#f9f9f9;border:1px solid #ddd;border-radius:4px;font-size:12px;white-space:pre-wrap;"><strong>Notes:</strong><br/>${rev.notes}</div>`:""}
  ${printBtn}</body></html>`);
}
function exportPartNumCSV(project,rev){
  rev={...(rev.data||{}),...rev};
  const curr=rev.currency||"USD",rnd=rev.roundUp,rate=rev.conversionRate||1;
  const lUD=line=>applyRounding(calcUnitPrice(line,rev.brandFactors,rev.localFactor),rnd,rate);
  const lT=line=>line.optional?0:lUD(line)*line.qty;
  const supplyTotal=(rev.lines||[]).reduce((s,l)=>{if(l.type==="section")return s;if(l.type==="subsystem"){if(l.optional)return s;const ssU=applyRounding(ssUnitPrice(l,rev.brandFactors,rev.localFactor),rnd,rate);return s+ssU*(l.qty||1);}return s+lT(l);},0);
  const rows=[
    [`Quotation with Part Numbers — ${project.projectName}`],
    [`Client: ${project.client||""}`],[`Engineer: ${rev.engineerName||""}`],
    [`Code: ${rev.code}`],[`Date: ${rev.date||""}`],[`Currency: ${curr}`],[],
    ["#","Model No","Brand","Description","Qty",`Unit Price (${curr})`,`Total (${curr})`],
    ...(() => { const ls=rev.lines||[]; const out=[]; for(let i=0;i<ls.length;i++){const l=ls[i]; if(l.type==="section"){out.push([l.label||"Section","","","","","",""]);continue;} if(l.type==="subsystem"){const ssU=applyRounding(ssUnitPrice(l,rev.brandFactors,rev.localFactor),rnd,rate);const ssT=ssU*(l.qty||1);out.push([l.rowNum,l.partNumber||"","",l.description+(l.optional?" (Optional)":""),l.optional?"Optional":(l.qty||1),l.optional?"—":fmtN(ssU,rnd),l.optional?"—":fmtN(ssT,rnd)]);continue;} const grp=l.mergeGroup;const isSubEntry=grp&&ls[i-1]?.mergeGroup===grp;out.push([isSubEntry?"":l.rowNum,l.modelNo||"",l.brand||"",l.description||"",l.optional?"Optional":l.qty,l.optional?"—":fmtN(lUD(l),rnd),l.optional?"—":fmtN(lT(l),rnd)]);} return out; })(),
    [],[" "," "," "," "," ","Supply Total",fmtN(supplyTotal,rnd)],
    ...(rev.tcEnabled?[[" "," "," "," "," ","T&C",fmtN(applyRounding(rev.tcBaseUSD||0,rnd,rate),rnd)]]:[]),
    ...(rev.installEnabled?[[" "," "," "," "," ","Installation",fmtN(applyRounding(rev.installValue,rnd,rate),rnd)]]:[]),
    ...(rev.extras||[]).map(e=>[" "," "," "," "," ",e.label||"Extra",fmtN(applyRounding(parseFloat(e.value)||0,rnd,rate),rnd)]),
    [" "," "," "," "," ","GRAND TOTAL",fmtN(rev.grandTotal,rnd)],
    ...(rev.gtAfterDiscountEnabled&&rev.gtAfterDiscount?[[" "," "," "," "," ","Grand Total after discount",rev.gtAfterDiscount]]:[]),
  ];
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${rev.code}_with_partnumbers.csv`;a.click();
}

// ── Excel (template) export ───────────────────────────────────────────────────
// Loads the bundled template (XLSX_TEMPLATE_URL) fresh from the server on every
// call, fills in a private in-memory copy of the workbook, and downloads the
// result as a brand-new file. The template on disk is never opened for writing
// and never modified — each export starts from the same pristine bytes.
const XLSX_TEMPLATE_MAP = {
  projectName:"D2", company:"D3", contactPerson:"C4", contactPhone:"C5",
  contactEmail:"C6", systemType:"C7", code:"C8",
  salesEngineer:"G5", presales:"G7",
  dateDay:"I2", dateMonth:"I3", dateYear:"I4",
  itemsStartRow:39,                 // first item row (A39)
  col:{ num:"A", partNumber:"B", brand:"C", description:"D", qty:"E" },
  brandFactorRow:37,                // row above the brand headers holding each brand's factor
  brandHeaderRow:38,                // K38, L38, M38... = brand names, ending with "Local"
  brandCountCell:"H37",             // count of brand columns + 1 (for Local)
  brandGridStartCol:10,             // 0-based column index of K (A=0 ... K=10)
  totalsDescCol:"A", totalsValueCol:"G",TotalStartRow:"K",SupplyTotalCheck:"H",
};

// I-column formula — identical text on every row; it locates its own row's
// brand-grid cells (COLUMN()+2 .. COLUMN()+1+$H$37) and the factor row (37)
// purely via ROW()/COLUMN(), so no per-row substitution is needed.
const XLSX_I_FORMULA = 'IF($H$37>0,SUMPRODUCT(INDIRECT(ADDRESS(ROW(),COLUMN()+2)):INDIRECT(ADDRESS(ROW(),COLUMN()+1+$H$37)),INDIRECT(ADDRESS(37,COLUMN()+2)):INDIRECT(ADDRESS(37,COLUMN()+1+$H$37))),0)';

// Converts a 0-based column index (0=A, 10=K...) into a spreadsheet column letter.
function xlsxColLetter(idx0){
  let n=idx0+1, s="";
  while(n>0){ const rem=(n-1)%26; s=String.fromCharCode(65+rem)+s; n=Math.floor((n-1)/26); }
  return s;
}

async function generateExcelExport(project, rev, settings) {
  rev = { ...(rev.data || {}), ...rev };
  const curr = rev.currency || "USD", rnd = rev.roundUp, rate = rev.conversionRate || 1;
  const lUD = line => applyRounding(calcUnitPrice(line, rev.brandFactors, rev.localFactor), rnd, rate);
  const lT = line => line.optional ? 0 : lUD(line) * line.qty;
  const MAP = XLSX_TEMPLATE_MAP;

  // Currency format depending on round-up setting
  const currencyFmt = rnd ? '"$"#,##0' : '"$"#,##0.00';

  // ── Load template ────────────────────────────────────────────────────────
  const res = await fetch(XLSX_TEMPLATE_URL);
  if (!res.ok) {
    throw new Error(`Could not load the Excel template (HTTP ${res.status}). Confirm the file exists at ${XLSX_TEMPLATE_URL}.`);
  }
  const templateBuffer = await res.arrayBuffer();

  // Keep a clean copy of the original template for later header/footer image reinjection
  const originalTemplateBuffer = templateBuffer.slice(0);

  // Sanity-check that we actually received a real .xlsx (zip signature "PK")
  const sig = new Uint8Array(templateBuffer.slice(0, 2));
  if (templateBuffer.byteLength < 100 || sig[0] !== 0x50 || sig[1] !== 0x4B) {
    throw new Error(
      `The file at ${XLSX_TEMPLATE_URL} isn't a valid .xlsx file ` +
      `(got ${templateBuffer.byteLength} bytes, not a zip signature). ` +
      `Make sure quotation_template.xlsx is placed at public/templates/quotation_template.xlsx ` +
      `and rebuilt/restarted, and that no other route is intercepting that path.`
    );
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The Excel template has no worksheets.");

  // ── Header cells ─────────────────────────────────────────────────────────
  const setCell = (ref, val) => { if (ref) ws.getCell(ref).value = val; };

  setCell(MAP.projectName, project.projectName || "");
  setCell(MAP.company, project.client || "");
  setCell(MAP.contactPerson, rev.contactName || "");
  setCell(MAP.contactPhone, rev.contactPhone || "");
  setCell(MAP.contactEmail, rev.contactEmail || "");
  setCell(MAP.systemType, rev.systemType || "");
  setCell(MAP.code, rev.code || "");
  setCell(MAP.salesEngineer, rev.salesEngineer || "");
  setCell(MAP.presales, rev.engineerName || "");

  // rev.date is stored as an ISO string (YYYY-MM-DD)
  if (rev.date) {
    const [y, m, d] = rev.date.split("-").map(n => parseInt(n, 10));
    setCell(MAP.dateDay, d || "");
    setCell(MAP.dateMonth, m || "");
    setCell(MAP.dateYear, y || "");
  }

  // ── Brand grid (rows 37/38) ───────────────────────────────────────────────
  const ls = rev.lines || [];
  const brands = [...new Set(ls.flatMap(l => {
    if (l.type === "section") return [];
    if (l.type === "subsystem") {
      return l.optional ? [] : (l.children || []).filter(c => !c.optional).map(c => c.brand || "Other");
    }
    return l.brand ? [l.brand] : [];
  }))];

  setCell(MAP.brandCountCell, brands.length + 1);

  const brandCol = {};
  brands.forEach((b, i) => {
    const c = xlsxColLetter(MAP.brandGridStartCol + i);
    brandCol[b] = c;
    setCell(`${c}${MAP.brandFactorRow}`, rev.brandFactors?.[b] ?? 1);
    setCell(`${c}${MAP.brandHeaderRow}`, b);
  });
  const localCol = xlsxColLetter(MAP.brandGridStartCol + brands.length);
  setCell(`${localCol}${MAP.brandFactorRow}`, rev.localFactor ?? 1);
  setCell(`${localCol}${MAP.brandHeaderRow}`, "Local");
  // brands.forEach((b, i) => {
  //   const c = xlsxColLetter(MAP.brandGridStartCol + brands.length + i +1 );
  //   brandCol[b] = c;
  //   setCell(`${c}${MAP.brandHeaderRow}`, b);
  // });



  // ── Flatten line items ───────────────────────────────────────────────────
  const flat = [];
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (l.type === "section") {
      flat.push({ section: l.label || "Section" });
      continue;
    }
    if (l.type === "subsystem") {
      const brandTotals = {};
      let localTotal = 0;
      if (!l.optional) {
        (l.children || []).filter(c => !c.optional).forEach(c => {
          const b = c.brand || "Other";
          brandTotals[b] = (brandTotals[b] || 0) + (c.glp || 0) * (c.qty || 1);
          localTotal += (c.local || 0) * (c.qty || 1);
        });
      }
      flat.push({
        num: l.rowNum,
        partNumber: l.partNumber || "",
        brand: l.brand || "",
        description: l.description || "",
        qty: l.optional ? "opt." : (l.qty || 1),
        optional: !!l.optional,
        optUnit: l.optional ? ssChildUnitTotal(l, rev.brandFactors, rev.localFactor) : null,
        brandTotals,
        localTotal: l.optional ? null : localTotal,
        // custom per-item factors can't be expressed by the template's one-factor-per-brand
        // formula, so such rows get their unit value written as a fixed number instead
        fixedUnit: !l.optional && (l.children || []).some(c => !c.optional && c.customFactor) ? ssChildUnitTotal(l, rev.brandFactors, rev.localFactor) : null,
        mergeGroup: l.mergeGroup || null
      });
      continue;
    }
    const grp = l.mergeGroup;
    const isSubEntry = grp && ls[i - 1]?.mergeGroup === grp;
    flat.push({
      num: isSubEntry ? "" : l.rowNum,
      partNumber: l.modelNo || "",
      brand: l.brand || "",
      description: l.description || "",
      qty: l.optional ? "opt." : l.qty,
      optional: !!l.optional,
      optUnit: l.optional ? calcUnitPrice(l, rev.brandFactors, rev.localFactor) : null,
      glp: l.optional ? null : l.glp,
      local: l.optional ? null : l.local,
      fixedUnit: !l.optional && l.customFactor ? calcUnitPrice(l, rev.brandFactors, rev.localFactor) : null,
      mergeGroup: grp || null
    });
  }

  // ── Grow the item table ──────────────────────────────────────────────────
  const HEADER_FILL_ARGB = "FFD9D9D9";
  const ROW_H = 55;
  const startRow = MAP.itemsStartRow;

  if (flat.length > 1) ws.duplicateRow(startRow, flat.length - 1, true);

  flat.forEach((item, idx) => {
    const r = startRow + idx;
    ws.getRow(r).height = ROW_H;

    if (item.section) {
      const range = `A${r}:G${r}`;
      try { ws.unMergeCells(`${MAP.col.num}${r}:${localCol}${r}`); } catch (e) {}
      ws.mergeCells(range);
      ["A", "B", "C", "D", "E", "F", "G"].forEach(col => {
        ws.getCell(`${col}${r}`).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: HEADER_FILL_ARGB }
        };
      });
      ws.getCell(`${MAP.col.num}${r}`).value = item.section;
      return;
    }

    ws.getCell(`${MAP.col.num}${r}`).value = item.num;
    ws.getCell(`${MAP.col.partNumber}${r}`).value = item.partNumber;
    ws.getCell(`${MAP.col.brand}${r}`).value = item.brand;
    ws.getCell(`${MAP.col.description}${r}`).value = item.description;
    ws.getCell(`${MAP.col.qty}${r}`).value = item.qty;   // quantity – no currency

    if (item.brandTotals) {
      // Subsystem – one value per brand
      Object.entries(item.brandTotals).forEach(([b, val]) => {
        if (brandCol[b]) {
          const cell = ws.getCell(`${brandCol[b]}${r}`);
          cell.value = val;
          cell.numFmt = currencyFmt;
        }
      });
      if (item.localTotal != null) {
        const cell = ws.getCell(`${localCol}${r}`);
        cell.value = item.localTotal;
        cell.numFmt = currencyFmt;
      }
    } else {
      // Normal line
      if (item.brand && brandCol[item.brand] && item.glp != null) {
        const cell = ws.getCell(`${brandCol[item.brand]}${r}`);
        cell.value = item.glp;
        cell.numFmt = currencyFmt;
      }
      if (item.local != null) {
        const cell = ws.getCell(`${localCol}${r}`);
        cell.value = item.local;
        cell.numFmt = currencyFmt;
      }
    }

    // I = per-unit GLP total
    // (rows with a custom per-item factor get a fixed value — the GLP grid still shows true list prices)
    if (item.fixedUnit != null) {
      ws.getCell(`I${r}`).value = Math.round(item.fixedUnit * 100) / 100; // (no cell note: notes add VML parts that clash with the header-image re-injection below)
    } else {
      ws.getCell(`I${r}`).value = { formula: XLSX_I_FORMULA };
    }
    ws.getCell(`I${r}`).numFmt = currencyFmt;

    // F = rounded (or not) version of I
    ws.getCell(`F${r}`).value = item.optional
      ? (rnd ? Math.ceil(item.optUnit) : item.optUnit)
      : { formula: rnd ? `ROUNDUP(I${r},0)` : `I${r}` };
    ws.getCell(`F${r}`).numFmt = currencyFmt;

    // G = row total
    ws.getCell(`G${r}`).value = item.optional ? "-" : {
      formula: `IF(F${r}="opt.","-",F${r}*E${r})`
    };
    ws.getCell(`G${r}`).numFmt = currencyFmt;
  });

  // ── Merge numbering column for grouped items ─────────────────────────────
  {
    let gStart = null, gGroup = null;
    const closeGroup = (endIdx) => {
      if (gStart != null && endIdx > gStart) {
        const r0 = startRow + gStart;
        const r1 = startRow + endIdx;
        const range = `${MAP.col.num}${r0}:${MAP.col.num}${r1}`;
        try { ws.unMergeCells(range); } catch (e) {}
        ws.mergeCells(range);
        ws.getCell(`${MAP.col.num}${r0}`).value = flat[gStart].num;
      }
      gStart = null;
      gGroup = null;
    };

    flat.forEach((item, idx) => {
      if (item.mergeGroup) {
        if (gGroup !== item.mergeGroup) {
          closeGroup(idx - 1);
          gStart = idx;
          gGroup = item.mergeGroup;
        }
      } else {
        closeGroup(idx - 1);
      }
    });
    closeGroup(flat.length - 1);
  }

  // ── Totals block ─────────────────────────────────────────────────────────
  const supplyTotal = (rev.lines || []).reduce((s, l) => {
    if (l.type === "section") return s;
    if (l.type === "subsystem") {
      if (l.optional) return s;
      const ssU = applyRounding(ssUnitPrice(l, rev.brandFactors, rev.localFactor), rnd, rate);
      return s + ssU * (l.qty || 1);
    }
    return s + lT(l);
  }, 0);

  let totRow = startRow + flat.length;

  const writeTot = (label, val) => {
    ws.getRow(totRow).height = ROW_H;
    const labelRange = `${MAP.totalsDescCol}${totRow}:F${totRow}`;
    try { ws.unMergeCells(`${MAP.totalsDescCol}${totRow}:${localCol}${totRow}`); } catch (e) {}
    ws.mergeCells(labelRange);

    ["A", "B", "C", "D", "E", "F"].forEach(col => {
      ws.getCell(`${col}${totRow}`).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: HEADER_FILL_ARGB }
      };
    });

    ws.getCell(`${MAP.totalsDescCol}${totRow}`).value = label;
    const valueCell = ws.getCell(`${MAP.totalsValueCol}${totRow}`);
    valueCell.value = val;
    valueCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL_ARGB }
    };
    valueCell.numFmt = currencyFmt;

    const test = `A1:${MAP.totalsValueCol}${totRow}`;
    ws.pageSetup.printArea = test;
    totRow++;
  };

  const writeTot_Supply = (label, val) => {
    ws.getRow(totRow).height = ROW_H;
    const labelRange = `${MAP.totalsDescCol}${totRow}:F${totRow}`;
    try { ws.unMergeCells(`${MAP.totalsDescCol}${totRow}:${localCol}${totRow}`); } catch (e) {}
    ws.mergeCells(labelRange);

    ["A", "B", "C", "D", "E", "F"].forEach(col => {
      ws.getCell(`${col}${totRow}`).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: HEADER_FILL_ARGB }
      };
    });

    ws.getCell(`${MAP.totalsDescCol}${totRow}`).value = label;

    const valueCell = ws.getCell(`${MAP.totalsValueCol}${totRow}`);
    valueCell.value = {
      formula: 'SUM(INDIRECT(ADDRESS(ROW()-1,COLUMN())):INDIRECT(ADDRESS(39,COLUMN())))'
    };
    valueCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL_ARGB }
    };
    valueCell.numFmt = currencyFmt;

    ws.getCell(`${MAP.SupplyTotalCheck}${totRow}`).value = val;
    ws.getCell(`${MAP.SupplyTotalCheck}${totRow - 1}`).value = "Sum Check";

    let i_sum = 0;
    for (; (brands.length + 1) > i_sum; i_sum++) {
      const column = xlsxColLetter(MAP.brandGridStartCol + i_sum);
      const cell = ws.getCell(`${column}${totRow}`);
      cell.value = {
        formula: 'SUM(INDIRECT(ADDRESS(ROW()-1,COLUMN())):INDIRECT(ADDRESS(39,COLUMN())))'
      };
      cell.numFmt = currencyFmt;
    }

    let check_index = 39;
    const disparityCol = xlsxColLetter(MAP.brandGridStartCol + i_sum);
    ws.getCell(`${disparityCol}${38}`).value = "disparity";
    for (check_index = 39; check_index < totRow; check_index++) {
      ws.getCell(`${disparityCol}${check_index}`).value = {
        formula: 'INDIRECT(ADDRESS(ROW(),7))-INDIRECT(ADDRESS(ROW(),9))'
      };
    }

    const test = `A1:${MAP.totalsValueCol}${totRow}`;
    ws.pageSetup.printArea = test;
    totRow++;
  };

  writeTot_Supply("Supply Total", supplyTotal);
  if (rev.tcEnabled) writeTot("T&C", applyRounding(rev.tcBaseUSD || 0, rnd, rate));
  if (rev.installEnabled) writeTot("Installation", applyRounding(rev.installValue, rnd, rate));
  (rev.extras || []).forEach(e =>
    writeTot(e.label || "Extra", applyRounding(parseFloat(e.value) || 0, rnd, rate))
  );
  writeTot("GRAND TOTAL", rev.grandTotal);
  if (rev.gtAfterDiscountEnabled && rev.gtAfterDiscount) {
    writeTot("Grand Total after discount", rev.gtAfterDiscount);
  }

  // ── Page setup: margins + forced page breaks ─────────────────────────────
  // Top & bottom margins = 1.8 inches
  ws.pageSetup.margins = {
    ...(ws.pageSetup.margins || {}),
    top: 1.8,
    bottom: 1.8
  };

  // Clear any existing page breaks then force the exact breaks requested:
  //   Page 2 starts at row 32  → break after row 31
  //   Page 3 starts at row 37  → break after row 36
  if (ws.pageSetup.rowBreaks) {
    ws.pageSetup.rowBreaks = [];
  }
  ws.getRow(31).addPageBreak();   // page 2 starts at row 32
  ws.getRow(36).addPageBreak();   // page 3 starts at row 37

  // ── Serialize with ExcelJS ───────────────────────────────────────────────
  let outBuffer = await wb.xlsx.writeBuffer();

  // ── Re-inject original header/footer images (VML + media) ────────────────
  outBuffer = await reinjectHeaderFooterImages(originalTemplateBuffer, outBuffer);

  // ── Download ─────────────────────────────────────────────────────────────
  const blob = new Blob([outBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${rev.code || project.projectName}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Re-injects the original template's header/footer images (VML + media)
 * into the ExcelJS-generated workbook.
 * ExcelJS does not support images in headers/footers, so we copy the
 * necessary parts from the original template after ExcelJS has finished.
 */
async function reinjectHeaderFooterImages(templateBuffer, exceljsBuffer) {
  const templateZip = await JSZip.loadAsync(templateBuffer);
  const outZip = await JSZip.loadAsync(exceljsBuffer);

  // 1. Locate VML drawings that belong to headers/footers
  const vmlFiles = Object.keys(templateZip.files).filter(
    n =>
      n.startsWith("xl/drawings/vmlDrawing") &&
      n.endsWith(".vml") &&
      !n.includes("_rels")
  );

  if (vmlFiles.length === 0) {
    console.warn("No VML drawings found in template – header/footer images may be absent.");
    return exceljsBuffer;
  }

  // 2. Copy VML files, their .rels and the referenced media
  for (const vmlPath of vmlFiles) {
    // VML itself
    const vmlContent = await templateZip.file(vmlPath).async("uint8array");
    outZip.file(vmlPath, vmlContent);

    // Relationships for this VML
    const relsPath = vmlPath.replace("xl/drawings/", "xl/drawings/_rels/") + ".rels";
    if (templateZip.file(relsPath)) {
      const relsContent = await templateZip.file(relsPath).async("uint8array");
      outZip.file(relsPath, relsContent);

      // Media files referenced by the VML relationships
      const relsXml = await templateZip.file(relsPath).async("string");
      const mediaMatches = [...relsXml.matchAll(/Target="\.\.\/media\/([^"]+)"/g)];
      for (const m of mediaMatches) {
        const mediaName = m[1];
        const mediaPath = `xl/media/${mediaName}`;
        if (templateZip.file(mediaPath) && !outZip.file(mediaPath)) {
          const mediaData = await templateZip.file(mediaPath).async("uint8array");
          outZip.file(mediaPath, mediaData);
        }
      }
    }
  }

  // 3. Ensure the worksheet still has the <legacyDrawingHF> element
  const sheetPath = "xl/worksheets/sheet1.xml";
  if (templateZip.file(sheetPath) && outZip.file(sheetPath)) {
    let sheetXml = await outZip.file(sheetPath).async("string");
    const templateSheetXml = await templateZip.file(sheetPath).async("string");
    const legacyMatch = templateSheetXml.match(/<legacyDrawingHF[^>]*\/>/);

    if (legacyMatch && !sheetXml.includes("legacyDrawingHF")) {
      sheetXml = sheetXml.replace("</worksheet>", `  ${legacyMatch[0]}\n</worksheet>`);
      outZip.file(sheetPath, sheetXml);
    }
  }

  // 4. Ensure the sheet relationships point to the VML drawing
  const sheetRelsPath = "xl/worksheets/_rels/sheet1.xml.rels";
  if (templateZip.file(sheetRelsPath)) {
    const templateRels = await templateZip.file(sheetRelsPath).async("string");
    let outRels = outZip.file(sheetRelsPath)
      ? await outZip.file(sheetRelsPath).async("string")
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

    const vmlRelMatches = [
      ...templateRels.matchAll(/<Relationship[^>]*Target="[^"]*vmlDrawing[^"]*"[^>]*\/>/g)
    ];

    for (const m of vmlRelMatches) {
      const rel = m[0];
      const targetMatch = rel.match(/Target="([^"]+)"/);
      if (targetMatch && !outRels.includes(targetMatch[1])) {
        outRels = outRels.replace("</Relationships>", `  ${rel}\n</Relationships>`);
      }
    }
    outZip.file(sheetRelsPath, outRels);
  }

  // 5. Declare VML content type if missing
  const ctPath = "[Content_Types].xml";
  if (templateZip.file(ctPath) && outZip.file(ctPath)) {
    let ctXml = await outZip.file(ctPath).async("string");
    if (!ctXml.includes('Extension="vml"')) {
      ctXml = ctXml.replace(
        "</Types>",
        `  <Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>\n</Types>`
      );
      outZip.file(ctPath, ctXml);
    }
  }

  // 6. Produce the final buffer
  return await outZip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

function PrintModal({project,rev,settings,onClose}){
  const [tplId,setTplId]=useState(settings.defaultTemplateId);
  const [sub,setSub]=useState(null);
  const [xlsxBusy,setXlsxBusy]=useState(false);
  const [xlsxErr,setXlsxErr]=useState("");
  const doExcel=async()=>{
    setXlsxErr("");setXlsxBusy(true);
    try{ await generateExcelExport(project,rev,settings); onClose(); }
    catch(e){ setXlsxErr(e.message||"Could not generate the Excel file."); }
    finally{ setXlsxBusy(false); }
  };
  const warn=<div style={{background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:"6px",padding:"10px 14px",marginBottom:14,fontSize:13,color:"#ea580c"}}>⚠️ This document is for <strong>internal use only</strong> and should not be shared with clients.</div>;
  const wrap=(title,children)=>(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500}}>
      <div style={{...C.card,width:400}}><p style={{margin:"0 0 14px",fontWeight:600,fontSize:15}}>{title}</p>{children}</div>
    </div>
  );
  if(sub==="quotation")return wrap(`Quotation — ${rev.code||""}`,<><div style={{marginBottom:14}}><label style={C.label}>Select template</label><select style={C.input} value={tplId} onChange={e=>setTplId(e.target.value)}>{settings.templates.map(t=><option key={t.id} value={t.id}>{t.name}{t.id===settings.defaultTemplateId?" (default)":""}</option>)}</select></div><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button style={C.btnS} onClick={()=>setSub(null)}>← Back</button><button style={C.btnS} onClick={()=>{exportQuotationCSV(project,rev);onClose();}}>⬇ CSV</button><button style={C.btnP} onClick={()=>{generatePDF(project,rev,settings,tplId);onClose();}}>📄 PDF</button></div></>);
  if(sub==="bom")return wrap(`BOM — ${rev.code||""}`,<><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button style={C.btnS} onClick={()=>setSub(null)}>← Back</button><button style={C.btnS} onClick={()=>{exportBOMCSV(project,rev);onClose();}}>⬇ CSV</button><button style={C.btnP} onClick={()=>{generateBOMPDF(project,rev,settings);onClose();}}>📄 PDF</button></div></>);
  if(sub==="detailed")return wrap(`Detailed Quotation — ${rev.code||""}`,<>{warn}<div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button style={C.btnS} onClick={()=>setSub(null)}>← Back</button><button style={C.btnS} onClick={()=>{exportDetailedCSV(project,rev);onClose();}}>⬇ CSV</button><button style={C.btnP} onClick={()=>{generateDetailedPDF(project,rev,settings);onClose();}}>📄 PDF</button></div></>);
  if(sub==="PartNumber")return wrap(`Quotation with P/N — ${rev.code||""}`,<>{warn}<div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button style={C.btnS} onClick={()=>setSub(null)}>← Back</button><button style={C.btnS} onClick={()=>{exportPartNumCSV(project,rev);onClose();}}>⬇ CSV</button><button style={C.btnP} onClick={()=>{generatePartNumPDF(project,rev,settings);onClose();}}>📄 PDF</button></div></>); 
  
  return wrap("Export",<><div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>
  <button style={{...C.btnP,padding:"11px",fontSize:14,textAlign:"left"}} onClick={()=>setSub("quotation")}>📄 Quotation</button>
  <button style={{...C.btnS,padding:"11px",fontSize:14,textAlign:"left"}} onClick={()=>setSub("bom")}>📋 BOM</button>
  <button style={{...C.btnS,padding:"11px",fontSize:14,textAlign:"left"}} onClick={()=>setSub("detailed")}>🔍 Detailed Quotation</button>
  <button style={{...C.btnS,padding:"11px",fontSize:14,textAlign:"left"}} onClick={()=>setSub("PartNumber")}>📄 Quotation with P/N</button>
  <button style={{...C.btnS,padding:"11px",fontSize:14,textAlign:"left"}} onClick={()=>{generateIssueSlipPDF(project,rev,settings);onClose();}}>🧾 Issue Slip</button>
  <button style={{...C.btnS,padding:"11px",fontSize:14,textAlign:"left"}} disabled={xlsxBusy} onClick={doExcel}>📊 {xlsxBusy?"Generating…":"Excel"}</button>
  <button style={{...C.btnS,padding:"11px",fontSize:14,textAlign:"left"}} onClick={()=>ClientBoM(project,rev,settings)}>📋 Client BOM</button>
  </div>
  {xlsxErr&&<p style={{margin:"0 0 10px",fontSize:12,color:"#c0392b"}}>{xlsxErr}</p>}
  <div style={{display:"flex",justifyContent:"flex-end"}}><button style={C.btnS} onClick={onClose}>Cancel</button></div></>);
}

// ─── Login ────────────────────────────────────────────────────────────────────
function Login({onLogin}){
  const [u,setU]=useState(""),[p,setP]=useState(""),[err,setErr]=useState(""),[loading,setLoading]=useState(false);
  const go=async()=>{
    if(!u||!p){setErr("Enter credentials.");return;}
    if(!API){setErr("Server not available.");return;}
    setLoading(true);setErr("");
    try{
      const r=await fetch(`${API}/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u,password:p})});
      const d=await r.json().catch(()=>({}));
      setLoading(false);
      if(r.status===429){setErr("Too many failed attempts. Try again in 15 minutes.");return;}
      if(r.status===403&&d.error==="disabled"){setErr("Account disabled.");return;}
      if(!r.ok||!d.token){setErr("Invalid credentials.");return;}
      const sess={...d.user,token:d.token};
      LS.set("mscc_session",sess);onLogin(sess);
    }catch{setLoading(false);setErr("Could not reach the server.");}
  };
  return(<div style={C.center}><div style={{...C.card,width:330}}><div style={{textAlign:"center",marginBottom:18}}><a href={SITE_URL} target="_blank" rel="noreferrer"><img src={LOGO_URL} alt="MSCC" style={{height:52,objectFit:"contain"}} onError={e=>e.target.style.display="none"}/></a><p style={{margin:"8px 0 0",color:"#666",fontSize:13}}>Quotation Management System</p></div><div style={{marginBottom:9}}><label style={C.label}>Username</label><input style={C.input} value={u} onChange={e=>setU(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}/></div><div style={{marginBottom:9}}><label style={C.label}>Password</label><input style={C.input} type="password" value={p} onChange={e=>setP(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}/></div>{err&&<p style={C.err}>{err}</p>}<button style={{...C.btnP,width:"100%",marginTop:10,padding:"9px"}} onClick={go} disabled={loading}>{loading?"Signing in…":"Sign In"}</button><p style={{margin:"12px 0 0",textAlign:"center",fontSize:11,color:"#aaa"}}>v{APP_VERSION}</p></div></div>);
}

// Polls the server periodically so the badge reflects reachability even when the
// user hasn't triggered a save recently. Every real save/load call also updates
// the same status, so this is just filling the gaps between user actions.
function ConnStatusBadge(){
  const status=useConnStatus();
  useEffect(()=>{
    if(!API)return; // nothing to poll in local-storage-only deployments
    checkConnection();
    const iv=setInterval(checkConnection,20000);
    const onFocus=()=>checkConnection();
    window.addEventListener("focus",onFocus);
    return()=>{clearInterval(iv);window.removeEventListener("focus",onFocus);};
  },[]);
  if(status==="disabled")return null;
  const cfg={
    unknown:{dot:"#9ca3af",text:"Checking…",title:"Checking connection to server…"},
    online:{dot:"#16a34a",text:"Connected",title:"Connected to server — saves go through."},
    offline:{dot:"#dc2626",text:"Offline",title:"Can't reach the server — saves and submits will fail until this reconnects."},
  }[status];
  return(<span title={cfg.title} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#666",whiteSpace:"nowrap"}}>
    <span style={{width:8,height:8,borderRadius:"50%",background:cfg.dot,display:"inline-block",flexShrink:0}}/>
    {cfg.text}
  </span>);
}

function TopBar({user,tab,tabs,setTab,onLogout}){
  const [pwOpen,setPwOpen]=useState(false);
  return(<div style={{background:"#fff",borderBottom:"1px solid #ccc",padding:"0 18px",display:"flex",alignItems:"center",justifyContent:"space-between",height:50,position:"sticky",top:0,zIndex:100}}><a href={SITE_URL} target="_blank" rel="noreferrer"><span style={{display:"flex",alignItems:"center",gap:6}}><img src={LOGO_URL} alt="MSCC" style={{height:32,objectFit:"contain"}} onError={e=>e.target.style.display="none"}/><span style={{fontSize:10,color:"#999"}} title="App version">v{APP_VERSION}</span></span></a><div style={{display:"flex",overflowX:"auto"}}>{tabs.map(t=><button key={t} style={C.tab(tab===t)} onClick={()=>setTab(t)}>{t}</button>)}</div><div style={{display:"flex",alignItems:"center",gap:12}}><ConnStatusBadge/><span style={{fontSize:12,color:"#666",whiteSpace:"nowrap"}}>{user.displayName||user.username} <span style={C.badge(isAdmin(user)?"orange":"blue")}>{user.role}</span></span><button style={C.btnS} onClick={()=>setPwOpen(true)}>Password</button><button style={C.btnS} onClick={onLogout}>Sign out</button></div>{pwOpen&&<ChangePasswordModal onClose={()=>setPwOpen(false)}/>}</div>);
}

function ChangePasswordModal({onClose}){
  const [f,setF]=useState({cur:"",nw:"",c:""}),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
  const save=async()=>{
    if(!f.cur||!f.nw){setMsg("Fill in all fields.");return;}
    if(f.nw!==f.c){setMsg("New passwords don't match.");return;}
    if(f.nw.length<MIN_PW){setMsg(`Password must be at least ${MIN_PW} characters.`);return;}
    setBusy(true);setMsg("");
    const r=await apiCall("/me/password",{method:"POST",body:JSON.stringify({current:f.cur,next:f.nw})});
    setBusy(false);
    if(!r.ok){setMsg(r.status===403?"Current password is wrong.":"Could not change the password.");return;}
    const s=LS.get("mscc_session");if(s&&r.data?.token)LS.set("mscc_session",{...s,token:r.data.token});
    setDone(true);
  };
  return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.35)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={onClose}>
    <div style={{...C.card,width:320}} onClick={e=>e.stopPropagation()}>
      <p style={{margin:"0 0 10px",fontWeight:600,fontSize:14}}>Change my password</p>
      {done?<><p style={C.ok}>Password changed.</p><button style={C.btnS} onClick={onClose}>Close</button></>:<>
        <div style={{marginBottom:8}}><label style={C.label}>Current password</label><input style={C.input} type="password" value={f.cur} onChange={e=>setF(x=>({...x,cur:e.target.value}))}/></div>
        <div style={{marginBottom:8}}><label style={C.label}>New password</label><input style={C.input} type="password" value={f.nw} onChange={e=>setF(x=>({...x,nw:e.target.value}))}/></div>
        <div style={{marginBottom:8}}><label style={C.label}>Confirm new password</label><input style={C.input} type="password" value={f.c} onChange={e=>setF(x=>({...x,c:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&save()}/></div>
        {msg&&<p style={C.err}>{msg}</p>}
        <div style={{display:"flex",gap:7}}><button style={C.btnP} onClick={save} disabled={busy}>{busy?"Saving…":"Save"}</button><button style={C.btnS} onClick={onClose}>Cancel</button></div>
      </>}
    </div></div>);
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsTab({onSaved}){
  const [S,setS]=useState(null),[saved,setSaved]=useState(false),[saveErr,setSaveErr]=useState(""),[tIdx,setTIdx]=useState(0),[newTpl,setNewTpl]=useState(""),[warnL,setWarnL]=useState(false),[pendL,setPendL]=useState(null),[sub,setSub]=useState("company");
  useEffect(()=>{loadSettings().then(setS);},[]);
  if(!S)return<p style={{padding:20,color:"#888"}}>Loading…</p>;
  const persist=async s=>{setS(s);const r=await saveSettings(s);if(r.ok){setSaveErr("");setSaved(true);setTimeout(()=>setSaved(false),2000);if(onSaved)onSaved();}else{setSaveErr("Save failed — check your connection to the server and try again.");setTimeout(()=>setSaveErr(""),4000);}};
  const set=(path,val)=>{const s=JSON.parse(JSON.stringify(S));const ks=path.split(".");let o=s;ks.slice(0,-1).forEach(k=>o=o[k]);o[ks[ks.length-1]]=val;persist(s);};
  const updL=val=>{const n=parseFloat(val);if(!isNaN(n)&&n!==1&&S.defaultLocalFactor===1&&!warnL){setPendL(n);setWarnL(true);return;}set("defaultLocalFactor",isNaN(n)?1:n);};
  const syncBrands=async()=>{const pl=await loadPriceList();const brands=[...new Set(pl.map(i=>i.brand).filter(Boolean))];const s=JSON.parse(JSON.stringify(S));brands.forEach(b=>{if(!s.defaultBrandFactors[b])s.defaultBrandFactors[b]=1;});persist(s);};
  const doBackup=async()=>{if(!API){alert("Backup requires the local server.");return;}try{const r=await fetch(`${API}/backup`,{headers:authHeaders()});setConnStatus("online");if(r.status===401){forceLogout();return;}if(r.status===403){alert("Only admins can download backups.");return;}if(!r.ok)throw new Error("bad status");const blob=await r.blob();const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`mscc_backup_${new Date().toISOString().slice(0,10)}.json`;a.click();}catch{setConnStatus("offline");alert("Could not reach the server — backup was not downloaded. Check your connection and try again.");}};
  const doRestore=async e=>{const f=e.target.files[0];if(!f)return;const text=await f.text();try{const data=JSON.parse(text);if(!API){alert("Restore requires the local server.");return;}const r=await apiCall("/backup/restore",{method:"POST",body:JSON.stringify(data)});if(!r.ok){alert(r.status===403?"Only the superadmin can restore a backup.":"Could not reach the server — restore did not complete. Check your connection and try again.");return;}alert("Restore complete. Reload the page.");}catch{alert("Invalid backup file.");}e.target.value="";};
  return(<div><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><h2 style={{margin:0,fontSize:15,fontWeight:600}}>Global Settings</h2><div style={{display:"flex",gap:8,alignItems:"center"}}>{saved&&<span style={C.ok}>✓ Saved</span>}{saveErr&&<span style={C.err}>{saveErr}</span>}<button style={C.btnS} onClick={doBackup}>⬇ Export backup</button><label style={{...C.btnS,cursor:"pointer"}}>⬆ Import backup<input type="file" accept=".json" style={{display:"none"}} onChange={doRestore}/></label></div></div>
  <div style={{display:"flex",borderBottom:"1px solid #ddd",margin:"10px 0"}}>{["company","factors","currency","templates"].map(t=><button key={t} style={C.tab(sub===t)} onClick={()=>setSub(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>)}</div>
  {sub==="company"&&<div style={{maxWidth:500}}>{[["name","Company name"],["address","Address"],["poBox","P.O. Box"],["city","City/ZIP"],["phone","Phone"],["mobile","Mobile"],["email","Email"]].map(([f,l])=><div key={f} style={{marginBottom:9}}><label style={C.label}>{l}</label><input style={C.input} value={S.company[f]||""} onChange={e=>set(`company.${f}`,e.target.value)}/></div>)}</div>}
  {sub==="factors"&&<div style={{maxWidth:460}}><p style={C.sT}>Default local factor</p><div style={{marginBottom:9}}><label style={C.label}>Local factor</label><input style={{...C.input,maxWidth:170}} type="number" step="0.01" value={S.defaultLocalFactor} onChange={e=>updL(e.target.value)}/></div>{warnL&&<div style={{background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:"6px",padding:10,marginBottom:10}}><p style={{margin:"0 0 7px",color:"#ea580c",fontSize:13}}>⚠️ Changing global local factor. Confirm?</p><div style={{display:"flex",gap:8}}><button style={C.btnS} onClick={()=>{set("defaultLocalFactor",pendL);setWarnL(false);}}>Confirm</button><button style={C.btnS} onClick={()=>setWarnL(false)}>Cancel</button></div></div>}<p style={C.sT}>Brand factors <button style={{...C.btnS,fontSize:11,padding:"2px 7px",marginLeft:7}} onClick={syncBrands}>Sync from price list</button></p>{Object.keys(S.defaultBrandFactors).length===0&&<p style={{fontSize:13,color:"#888"}}>Import price list first, then sync.</p>}{Object.entries(S.defaultBrandFactors).map(([b,f])=><div key={b} style={{...C.row,marginBottom:7,alignItems:"center"}}><span style={{minWidth:110,fontSize:13,fontWeight:500}}>{b}</span><input style={{...C.input,maxWidth:120}} type="number" step="0.01" min="0" value={f} onChange={e=>{const s=JSON.parse(JSON.stringify(S));s.defaultBrandFactors[b]=parseFloat(e.target.value)||0;persist(s);}}/></div>)}</div>}
  {sub==="currency"&&<div style={{maxWidth:300}}><p style={C.sT}>Default currency</p><select style={C.input} value={S.defaultCurrency} onChange={e=>set("defaultCurrency",e.target.value)}>{["USD","EGP","EUR","GBP","SAR","AED"].map(c=><option key={c}>{c}</option>)}</select></div>}
  {sub==="templates"&&<div><div style={{...C.row,alignItems:"center",marginBottom:10}}><select style={{...C.input,maxWidth:230}} value={tIdx} onChange={e=>setTIdx(Number(e.target.value))}>{S.templates.map((t,i)=><option key={t.id} value={i}>{t.name}{t.id===S.defaultTemplateId?" (default)":""}</option>)}</select><button style={C.btnS} onClick={()=>set("defaultTemplateId",S.templates[tIdx].id)}>Set default</button>{S.templates.length>1&&<button style={C.btnD} onClick={()=>{const s=JSON.parse(JSON.stringify(S));s.templates.splice(tIdx,1);setTIdx(0);persist(s);}}>Delete</button>}</div><div style={{...C.row,marginBottom:10}}><div style={C.f1}><label style={C.label}>Clone as</label><input style={C.input} value={newTpl} onChange={e=>setNewTpl(e.target.value)} placeholder="New template name"/></div><button style={{...C.btnS,alignSelf:"flex-end"}} onClick={()=>{if(!newTpl.trim())return;const s=JSON.parse(JSON.stringify(S));s.templates.push({id:`tpl_${Date.now()}`,name:newTpl.trim(),coverLetter:s.templates[tIdx].coverLetter,termsAndConditions:s.templates[tIdx].termsAndConditions});setTIdx(s.templates.length-1);setNewTpl("");persist(s);}}>Clone</button></div><div style={{marginBottom:9}}><label style={C.label}>Cover letter</label><textarea style={{...C.input,minHeight:160,resize:"vertical",lineHeight:1.6}} value={S.templates[tIdx].coverLetter} onChange={e=>{const s=JSON.parse(JSON.stringify(S));s.templates[tIdx].coverLetter=e.target.value;persist(s);}}/></div><div><label style={C.label}>Terms & conditions</label><textarea style={{...C.input,minHeight:230,resize:"vertical",lineHeight:1.6}} value={S.templates[tIdx].termsAndConditions} onChange={e=>{const s=JSON.parse(JSON.stringify(S));s.templates[tIdx].termsAndConditions=e.target.value;persist(s);}}/></div></div>}
  </div>);
}

// ─── User Mgmt ────────────────────────────────────────────────────────────────
function UserMgmtTab({user}){
  const isSA=isSuperAdmin(user);
  const [users,setU]=useState([]);
  const [form,setForm]=useState({username:"",displayName:"",password:"",confirm:"",role:"presales"});
  const [msg,setMsg]=useState({t:"",tp:""});
  const [rid,setRid]=useState(null);
  const [rpw,setRpw]=useState({pw:"",c:""});
  useEffect(()=>{loadUsers().then(setU);},[]);
  const flash=(t,tp="ok")=>{setMsg({t,tp});setTimeout(()=>setMsg({t:"",tp:""}),3000);};
  const create=async()=>{
    const{username:un,displayName:dn,password:pw,confirm:cf,role:rl}=form;
    if(!un.trim()||!pw){flash("Required fields missing.","err");return;}
    if(pw!==cf){flash("Passwords don't match.","err");return;}
    if(pw.length<MIN_PW){flash(`Password must be at least ${MIN_PW} characters.`,"err");return;}
    if(rl==="admin"&&!isSA){flash("Only superadmin can create admin accounts.","err");return;}
    const uL=un.toLowerCase().trim();
    if(users.find(u=>u.username.toLowerCase()===uL)){flash("Username exists.","err");return;}
    const nu={id:uid(),username:uL,displayName:dn.trim()||un.trim(),password:pw,role:rl,active:1,createdAt:now()};
    const r=await saveUser(nu,true);if(!r.ok){flash("Could not reach the server — account was not created. Check your connection and try again.","err");return;}
    setU(await loadUsers());
    setForm({username:"",displayName:"",password:"",confirm:"",role:"presales"});
    flash("Account created.");
  };
  const dynamicAdmins=users.filter(u=>u.role==="admin");
  const presalesUsers=users.filter(u=>u.role==="presales");
  return(<div>
    <h2 style={{margin:"0 0 1rem",fontSize:15,fontWeight:600}}>User Management</h2>
    {msg.t&&<p style={msg.tp==="err"?C.err:C.ok}>{msg.t}</p>}

    {/* ── Dynamic admin accounts (visible to superadmin only) ── */}
    {isSA&&<><p style={C.sT}>Admin accounts ({dynamicAdmins.length})</p>
    {dynamicAdmins.length===0&&<p style={{fontSize:13,color:"#888",marginBottom:12}}>No admin accounts yet.</p>}
    {dynamicAdmins.map(u=><div key={u.id} style={{...C.card,padding:"9px 13px",marginBottom:7}}>
      {rid===u.id?(<div>
        <p style={{margin:"0 0 7px",fontWeight:500,fontSize:13}}>Reset — {u.displayName}</p>
        <div style={{...C.row,marginBottom:7}}>
          <div style={C.f1}><label style={C.label}>New password</label><input style={C.input} type="password" value={rpw.pw} onChange={e=>setRpw(r=>({...r,pw:e.target.value}))}/></div>
          <div style={C.f1}><label style={C.label}>Confirm</label><input style={C.input} type="password" value={rpw.c} onChange={e=>setRpw(r=>({...r,c:e.target.value}))}/></div>
        </div>
        <div style={{display:"flex",gap:7}}>
          <button style={C.btnS} onClick={async()=>{if(!rpw.pw||rpw.pw!==rpw.c){flash("Mismatch.","err");return;}if(rpw.pw.length<MIN_PW){flash(`Password must be at least ${MIN_PW} characters.`,"err");return;}const r=await saveUser({...u,password:rpw.pw},false);if(!r.ok){flash("Could not reach the server — password was not changed.","err");return;}setU(await loadUsers());setRid(null);setRpw({pw:"",c:""});flash("Done.");}}>Save</button>
          <button style={C.btnS} onClick={()=>setRid(null)}>Cancel</button>
        </div>
      </div>):(<div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <p style={{margin:0,fontWeight:500,fontSize:13}}>{u.displayName}</p>
          <p style={{margin:"2px 0 0",fontSize:12,color:"#666"}}>@{u.username} · <span style={C.badge("orange")}>admin</span> · <span style={C.badge(u.active?"green":"red")}>{u.active?"active":"disabled"}</span></p>
        </div>
        <div style={{display:"flex",gap:7}}>
          <button style={C.btnS} onClick={()=>setRid(u.id)}>Reset pw</button>
          <button style={u.active?C.btnD:C.btnS} onClick={async()=>{const r=await saveUser({...u,active:u.active?0:1},false);if(!r.ok){flash("Could not reach the server — status was not changed.","err");return;}setU(await loadUsers());}}>{u.active?"Deactivate":"Activate"}</button>
        </div>
      </div>)}
    </div>)}</>}

    {/* ── Create account ── */}
    <p style={C.sT}>Create account</p>
    <div style={{...C.row,marginBottom:7}}>
      <div style={C.f1}><label style={C.label}>Username</label><input style={C.input} value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))}/></div>
      <div style={C.f1}><label style={C.label}>Display name</label><input style={C.input} value={form.displayName} onChange={e=>setForm(f=>({...f,displayName:e.target.value}))}/></div>
    </div>
    <div style={{...C.row,marginBottom:10}}>
      <div style={C.f1}><label style={C.label}>Password</label><input style={C.input} type="password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))}/></div>
      <div style={C.f1}><label style={C.label}>Confirm</label><input style={C.input} type="password" value={form.confirm} onChange={e=>setForm(f=>({...f,confirm:e.target.value}))}/></div>
    </div>
    {isSA&&<div style={{marginBottom:10}}>
      <label style={C.label}>Role</label>
      <select style={{...C.input,maxWidth:180}} value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
        <option value="presales">Pre-Sales</option>
        <option value="admin">Admin</option>
      </select>
    </div>}
    <button style={C.btnP} onClick={create}>Create account</button>

    {/* ── Presales accounts ── */}
    <p style={C.sT}>Pre-Sales accounts ({presalesUsers.length})</p>
    {presalesUsers.length===0&&<p style={{fontSize:13,color:"#888"}}>No accounts yet.</p>}
    {presalesUsers.map(u=><div key={u.id} style={{...C.card,padding:"9px 13px",marginBottom:7}}>
      {rid===u.id?(<div>
        <p style={{margin:"0 0 7px",fontWeight:500,fontSize:13}}>Reset — {u.displayName}</p>
        <div style={{...C.row,marginBottom:7}}>
          <div style={C.f1}><label style={C.label}>New password</label><input style={C.input} type="password" value={rpw.pw} onChange={e=>setRpw(r=>({...r,pw:e.target.value}))}/></div>
          <div style={C.f1}><label style={C.label}>Confirm</label><input style={C.input} type="password" value={rpw.c} onChange={e=>setRpw(r=>({...r,c:e.target.value}))}/></div>
        </div>
        <div style={{display:"flex",gap:7}}>
          <button style={C.btnS} onClick={async()=>{if(!rpw.pw||rpw.pw!==rpw.c){flash("Mismatch.","err");return;}if(rpw.pw.length<MIN_PW){flash(`Password must be at least ${MIN_PW} characters.`,"err");return;}const r=await saveUser({...u,password:rpw.pw},false);if(!r.ok){flash("Could not reach the server — password was not changed.","err");return;}setU(await loadUsers());setRid(null);setRpw({pw:"",c:""});flash("Done.");}}>Save</button>
          <button style={C.btnS} onClick={()=>setRid(null)}>Cancel</button>
        </div>
      </div>):(<div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <p style={{margin:0,fontWeight:500,fontSize:13}}>{u.displayName}</p>
          <p style={{margin:"2px 0 0",fontSize:12,color:"#666"}}>@{u.username} · <span style={C.badge(u.active?"green":"red")}>{u.active?"active":"disabled"}</span></p>
        </div>
        <div style={{display:"flex",gap:7}}>
          <button style={C.btnS} onClick={()=>setRid(u.id)}>Reset pw</button>
          <button style={u.active?C.btnD:C.btnS} onClick={async()=>{const r=await saveUser({...u,active:u.active?0:1},false);if(!r.ok){flash("Could not reach the server — status was not changed.","err");return;}setU(await loadUsers());}}>{u.active?"Deactivate":"Activate"}</button>
        </div>
      </div>)}
    </div>)}
  </div>);
}

// ─── Price List ───────────────────────────────────────────────────────────────
function PriceListTab(){
  const [items,setItems]=useState([]),[search,setSearch]=useState(""),[editId,setEditId]=useState(null),[form,setForm]=useState({description:"",modelNo:"",brand:"",glp:"",local:"",notes:""}),[msg,setMsg]=useState({t:"",tp:""}),[page,setPage]=useState(1),[importPreview,setImportPreview]=useState(null);
  const [ssBuilderOpen,setSSBuilderOpen]=useState(false);
  const [ssForm,setSSF]=useState({description:"",brand:""});
  const [ssChildren,setSSChildren]=useState([]);
  const [ssPartNumber,setSSPartNumber]=useState("");
  const [ssPNTouched,setSSPNTouched]=useState(false); // true once user manually edits the part number field
  const [ssAddMode,setSSAddMode]=useState(null);
  const [ssCustomChild,setSSCC]=useState({description:"",modelNo:"",brand:"",glp:"",local:""});
  const [expandedSS,setExpandedSS]=useState(null); // id of subsystem template expanded in the table
  const fileRef=useRef();const PS=15;
  useEffect(()=>{loadPriceList().then(setItems);},[]);
  const flash=(t,tp="ok")=>{setMsg({t,tp});setTimeout(()=>setMsg({t:"",tp:""}),3000);};
  const reload=()=>loadPriceList().then(setItems);
  const allBrands=[...new Set(items.filter(i=>i.type!=="subsystem").map(i=>i.brand).filter(Boolean))];
  const filtered=items.filter(i=>{const q=search.toLowerCase();return!q||(i.description||"").toLowerCase().includes(q)||(i.modelNo||"").toLowerCase().includes(q)||(i.brand||"").toLowerCase().includes(q);});
  const totalP=Math.max(1,Math.ceil(filtered.length/PS));const pageI=filtered.slice((page-1)*PS,page*PS);
  const startEdit=item=>{setEditId(item.id);setForm({description:item.description,modelNo:item.modelNo,brand:item.brand,glp:item.glp,local:item.local,notes:item.notes||""});};
  const cancelEdit=()=>{setEditId(null);setForm({description:"",modelNo:"",brand:"",glp:"",local:"",notes:""});};
  const saveEdit=async()=>{if(!form.description.trim()&&!form.modelNo.trim()){flash("Need description or model.","err");return;}const r=await updatePriceItem({...form,id:editId,glp:parseFloat(form.glp)||0,local:parseFloat(form.local)||0,brand:normalizeBrand(form.brand,allBrands)});if(!r.ok){flash("Could not reach the server — item was not updated. Check your connection and try again.","err");return;}cancelEdit();reload();flash("Updated.");};
  const addNew=async()=>{if(!form.description.trim()&&!form.modelNo.trim()){flash("Need description or model.","err");return;}const r=await addPriceItem({id:uid(),...form,glp:parseFloat(form.glp)||0,local:parseFloat(form.local)||0,brand:normalizeBrand(form.brand,allBrands)});if(!r.ok){flash("Could not reach the server — item was not added. Check your connection and try again.","err");return;}setForm({description:"",modelNo:"",brand:"",glp:"",local:"",notes:""});const nl=await loadPriceList();setItems(nl);setSearch("");setPage(Math.max(1,Math.ceil(nl.length/PS)));flash("Added.");};
  const delItem=async id=>{if(!window.confirm("Delete?"))return;const r=await deletePriceItem(id);if(!r.ok){flash("Could not reach the server — item was not deleted.","err");return;}reload();};
  const handleFile=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{const p=parseCSV(ev.target.result);if(!p.length){flash("No valid rows.","err");return;}setImportPreview(p);};r.readAsText(f);e.target.value="";};
  const confirmImport=async mode=>{if(!importPreview)return;const r=mode==="replace"?await replacePriceList(importPreview):await appendPriceList(importPreview);if(!r.ok){flash("Could not reach the server — import was not saved. Check your connection and try again.","err");return;}const nl=await loadPriceList();setItems(nl);const s=await loadSettings();const brands=[...new Set(nl.map(i=>i.brand).filter(Boolean))];brands.forEach(b=>{if(!s.defaultBrandFactors[b])s.defaultBrandFactors[b]=1;});await saveSettings(s);setImportPreview(null);flash(`${importPreview.length} items ${mode==="replace"?"imported":"appended"}. Brands synced.`);};
  const exportCSVFile=()=>{const blob=new Blob([toCSV(items)],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="mscc_pricelist.csv";a.click();};

  // ── Subsystem template builder ───────────────────────────────────────────────
  const addSSChildFromCatalog=item=>{setSSChildren(c=>[...c,{id:uid(),description:item.description,modelNo:item.modelNo,brand:item.brand,glp:item.glp,local:item.local,notes:item.notes||"",qty:1}]);setSSAddMode(null);setSSPNTouched(false);};
  const addSSChildCustom=()=>{
    if(!ssCustomChild.description.trim()&&!ssCustomChild.modelNo.trim()){flash("Need description or model.","err");return;}
    setSSChildren(c=>[...c,{id:uid(),description:ssCustomChild.description,modelNo:ssCustomChild.modelNo,brand:normalizeBrand(ssCustomChild.brand,allBrands),glp:parseFloat(ssCustomChild.glp)||0,local:parseFloat(ssCustomChild.local)||0,notes:"",qty:1}]);
    setSSCC({description:"",modelNo:"",brand:"",glp:"",local:""});setSSAddMode(null);
  };
  const delSSChild=id=>setSSChildren(c=>c.filter(x=>x.id!==id));
  const updSSChildQty=(id,val)=>setSSChildren(c=>c.map(x=>x.id===id?{...x,qty:Math.max(1,parseInt(val)||1)}:x));
  useEffect(()=>{
    if(!ssPNTouched)setSSPartNumber(autoPartNumber({children:ssChildren}));
  },[ssChildren,ssPNTouched]);
  const saveSSTemplate=async()=>{
    if(!ssForm.description.trim()){flash("Subsystem template needs a name.","err");return;}
    if(ssChildren.length===0){flash("Add at least one item to the subsystem.","err");return;}
    const r=await addPriceItem({id:uid(),type:"subsystem",description:ssForm.description,brand:ssForm.brand||"",partNumber:ssPartNumber,children:ssChildren.map(({id,...c})=>({...c}))});
    if(!r.ok){flash("Could not reach the server — template was not saved. Check your connection and try again.","err");return;}
    setSSF({description:"",brand:""});setSSChildren([]);setSSPartNumber("");setSSPNTouched(false);setSSBuilderOpen(false);
    const nl=await loadPriceList();setItems(nl);setSearch("");setPage(Math.max(1,Math.ceil(nl.length/PS)));
    flash("Subsystem template saved.");
  };
  const cancelSSBuilder=()=>{setSSF({description:"",brand:""});setSSChildren([]);setSSPartNumber("");setSSPNTouched(false);setSSAddMode(null);setSSBuilderOpen(false);};


  return(<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:7}}>
      <h2 style={{margin:0,fontSize:15,fontWeight:600}}>Price List <span style={{fontSize:13,fontWeight:400,color:"#888"}}>({items.length})</span></h2>
      <div style={{display:"flex",gap:7,alignItems:"center"}}>{msg.t&&<span style={msg.tp==="err"?C.err:C.ok}>{msg.t}</span>}<label style={{...C.btnS,cursor:"pointer"}}>Import CSV<input ref={fileRef} type="file" accept=".csv" style={{display:"none"}} onChange={handleFile}/></label><button style={C.btnS} onClick={exportCSVFile}>Export CSV</button></div>
    </div>

    {importPreview&&<div style={{background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:"6px",padding:11,margin:"10px 0"}}><p style={{margin:"0 0 7px",fontWeight:500,fontSize:13}}>Preview: {importPreview.length} rows</p><div style={{maxHeight:120,overflowY:"auto",marginBottom:8}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><thead><tr><th style={C.th}>Model</th><th style={C.th}>Brand</th><th style={C.th}>Description</th><th style={C.th}>GLP</th><th style={C.th}>Local</th></tr></thead><tbody>{importPreview.slice(0,6).map((r,i)=><tr key={i}><td style={C.td}>{r.type==="subsystem"?r.partNumber:r.modelNo}</td><td style={C.td}>{r.brand}</td><td style={C.td}>{r.type==="subsystem"?`⊞ ${r.description} (subsystem, ${(r.children||[]).length} items)`:r.description}</td><td style={C.td}>{r.type==="subsystem"?"—":r.glp}</td><td style={C.td}>{r.type==="subsystem"?"—":r.local}</td></tr>)}</tbody></table>{importPreview.length>6&&<p style={{fontSize:11,color:"#888",margin:"3px 0 0"}}>...+{importPreview.length-6} more</p>}</div><div style={{display:"flex",gap:7}}><button style={C.btnP} onClick={()=>confirmImport("replace")}>Replace all</button><button style={C.btnS} onClick={()=>confirmImport("append")}>Append</button><button style={C.btnD} onClick={()=>setImportPreview(null)}>Cancel</button></div></div>}

    {!editId&&<div style={{...C.card,margin:"10px 0",padding:"12px"}}>
      <p style={{margin:"0 0 8px",fontSize:13,fontWeight:500}}>Add item</p>
      <div style={C.row}>
        <div style={{flex:2,minWidth:140}}><label style={C.label}>Description</label><textarea style={{...C.input,minHeight:60,resize:"vertical",lineHeight:1.5}} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
        <div style={C.f1}><label style={C.label}>Model No</label><textarea style={{...C.input,minHeight:60,resize:"vertical",lineHeight:1.5}} value={form.modelNo} onChange={e=>setForm(f=>({...f,modelNo:e.target.value}))}/></div>
        <div style={C.f1}><label style={C.label}>Brand</label><BrandSelector value={form.brand} onChange={v=>setForm(f=>({...f,brand:v}))} allBrands={allBrands}/></div>
        <div style={C.f1}><label style={C.label}>GLP</label><input style={C.input} type="number" step="0.01" value={form.glp} onChange={e=>setForm(f=>({...f,glp:e.target.value}))}/></div>
        <div style={C.f1}><label style={C.label}>Local</label><input style={C.input} type="number" step="0.01" value={form.local} onChange={e=>setForm(f=>({...f,local:e.target.value}))}/></div>
        <div style={{alignSelf:"flex-end"}}><button style={C.btnP} onClick={addNew}>Add</button></div>
      </div>
      <div style={{marginTop:8}}><label style={C.label}>Internal note (not printed)</label><textarea style={{...C.input,minHeight:50,resize:"vertical",lineHeight:1.5}} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="e.g. Check stock before ordering"/></div>
    </div>}

    {!editId&&!ssBuilderOpen&&<button style={{...C.btnS,borderColor:"#7c3aed",color:"#7c3aed",marginBottom:10}} onClick={()=>setSSBuilderOpen(true)}>⊞ Add subsystem template</button>}

    {ssBuilderOpen&&<div style={{...C.card,margin:"10px 0",padding:"12px",borderColor:"#7c3aed"}}>
      <p style={{margin:"0 0 8px",fontSize:13,fontWeight:500,color:"#7c3aed"}}>⊞ New subsystem template</p>
      <div style={C.row}>
        <div style={{flex:2,minWidth:160}}><label style={C.label}>Template name</label><textarea style={{...C.input,minHeight:60,resize:"vertical",lineHeight:1.5}} value={ssForm.description} onChange={e=>setSSF(f=>({...f,description:e.target.value}))} placeholder="e.g. Standard Fire Panel Kit"/></div>
        <div style={C.f1}><label style={C.label}>Brand (display only)</label><BrandSelector value={ssForm.brand} onChange={v=>setSSF(f=>({...f,brand:v}))} allBrands={allBrands}/></div>
      </div>

      <p style={{margin:"12px 0 6px",fontSize:12,fontWeight:500,color:"#666"}}>Items in this subsystem ({ssChildren.length})</p>
      {ssChildren.length===0&&<p style={{fontSize:12,color:"#888",marginBottom:8}}>No items added yet.</p>}
      {ssChildren.map(c=><div key={c.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"#faf5ff",borderLeft:"3px solid #c4b5fd",marginBottom:4,fontSize:12}}>
        <code style={{fontSize:11,minWidth:80}}>{c.modelNo||"—"}</code>
        <span style={{flex:1}}>{c.description}</span>
        <span style={{...C.badge("blue")}}>{c.brand}</span>
        <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#666"}}>
          Qty:
          <input style={{...C.input,width:46,padding:"2px 4px",textAlign:"center"}} type="number" min="1" value={c.qty||1} onChange={e=>updSSChildQty(c.id,e.target.value)}/>
        </label>
        <button style={{...C.btnD,padding:"1px 6px",fontSize:11}} onClick={()=>delSSChild(c.id)}>×</button>
      </div>)}

      <div style={{marginTop:8}}>
        {ssAddMode===null&&<div style={{display:"flex",gap:7}}>
          <button style={{...C.btnS,fontSize:11,padding:"3px 10px"}} onClick={()=>setSSAddMode("catalog")}>+ From price list</button>
          <button style={{...C.btnS,fontSize:11,padding:"3px 10px"}} onClick={()=>setSSAddMode("custom")}>+ Custom item</button>
        </div>}
        {ssAddMode==="catalog"&&<div style={{display:"flex",gap:7,alignItems:"flex-end"}}>
          <ItemSearchDropdown priceList={items} excludeSubsystems onSelect={addSSChildFromCatalog}/>
          <button style={C.btnS} onClick={()=>setSSAddMode(null)}>Cancel</button>
        </div>}
        {ssAddMode==="custom"&&<div>
          <div style={{...C.row,marginBottom:6}}>
            <div style={{flex:2}}><label style={C.label}>Description</label><input style={C.input} value={ssCustomChild.description} onChange={e=>setSSCC(f=>({...f,description:e.target.value}))}/></div>
            <div style={C.f1}><label style={C.label}>Model No</label><input style={C.input} value={ssCustomChild.modelNo} onChange={e=>setSSCC(f=>({...f,modelNo:e.target.value}))}/></div>
            <div style={C.f1}><label style={C.label}>Brand</label><BrandSelector value={ssCustomChild.brand} onChange={v=>setSSCC(f=>({...f,brand:v}))} allBrands={allBrands}/></div>
            <div style={C.f1}><label style={C.label}>GLP</label><input style={C.input} type="number" step="0.01" value={ssCustomChild.glp} onChange={e=>setSSCC(f=>({...f,glp:e.target.value}))}/></div>
            <div style={C.f1}><label style={C.label}>Local</label><input style={C.input} type="number" step="0.01" value={ssCustomChild.local} onChange={e=>setSSCC(f=>({...f,local:e.target.value}))}/></div>
          </div>
          <div style={{display:"flex",gap:7}}>
            <button style={C.btnP} onClick={addSSChildCustom}>Add</button>
            <button style={C.btnS} onClick={()=>setSSAddMode(null)}>Cancel</button>
          </div>
        </div>}
      </div>

      <div style={{marginTop:12}}>
        <label style={C.label}>Part Number (auto-generated from items above, editable)</label>
        <textarea style={{...C.input,minHeight:60,fontFamily:"monospace",fontSize:11,resize:"vertical",lineHeight:1.5}}
          value={ssPartNumber}
          onChange={e=>{setSSPartNumber(e.target.value);setSSPNTouched(true);}}
        />
        {ssPNTouched&&<div style={{fontSize:11,color:"#c0392b",cursor:"pointer",marginTop:2}} onClick={()=>{setSSPNTouched(false);setSSPartNumber(autoPartNumber({children:ssChildren}));}}>↺ Reset to auto-generated</div>}
      </div>

      <div style={{display:"flex",gap:7,marginTop:14}}>
        <button style={{...C.btnP,background:"#7c3aed",borderColor:"#7c3aed"}} onClick={saveSSTemplate}>Save template</button>
        <button style={C.btnS} onClick={cancelSSBuilder}>Cancel</button>
      </div>
    </div>}

    <div style={{margin:"8px 0"}}><input style={{...C.input,maxWidth:320}} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Search…"/></div>

    {filtered.length===0?<p style={{color:"#888",fontSize:13}}>{items.length===0?"No items yet.":"No results."}</p>:
    <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
      <thead style={{background:"#f4f4f4"}}><tr><th style={C.th}>#</th><th style={C.th}>Model No</th><th style={C.th}>Brand</th><th style={C.th}>Description</th><th style={{...C.th,textAlign:"right"}}>GLP</th><th style={{...C.th,textAlign:"right"}}>Local</th><th style={C.th}>Note</th><th style={C.th}></th></tr></thead>
      <tbody>{pageI.map((item,idx)=>{
        if(item.type==="subsystem"){
          const isExp=expandedSS===item.id;
          return(<Fragment key={item.id}>
            <tr style={{background:"#f5f0ff"}}>
              <td style={{...C.td,color:"#888"}}>{(page-1)*PS+idx+1}</td>
              <td style={C.td}><span style={C.badge("purple")}>SUBSYSTEM</span></td>
              <td style={C.td}>{item.brand||"—"}</td>
              <td style={{...C.td,whiteSpace:"pre-wrap",fontWeight:600}}>{item.description}
                {item.partNumber&&<div style={{marginTop:3,fontSize:10,fontFamily:"monospace",color:"#666",fontWeight:400,whiteSpace:"pre-wrap"}}>{item.partNumber}</div>}
              </td>
              <td style={{...C.td,textAlign:"right",color:"#888",fontSize:12}} colSpan={2}>{(item.children||[]).length} item{(item.children||[]).length===1?"":"s"}</td>
              <td style={{...C.td,color:"#888",fontSize:12}}>—</td>
              <td style={C.td}><div style={{display:"flex",gap:5}}>
                <button style={C.btnS} onClick={()=>setExpandedSS(isExp?null:item.id)}>{isExp?"Hide":"View"}</button>
                <button style={C.btnD} onClick={()=>delItem(item.id)}>Del</button>
              </div></td>
            </tr>
            {isExp&&<tr><td colSpan={8} style={{padding:0,border:"1px solid #ddd"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead style={{background:"#ede9fe"}}><tr><th style={C.th}>#</th><th style={C.th}>Model No</th><th style={C.th}>Brand</th><th style={C.th}>Description</th><th style={{...C.th,textAlign:"right"}}>GLP</th><th style={{...C.th,textAlign:"right"}}>Local</th><th style={{...C.th,textAlign:"center"}}>Qty</th></tr></thead>
                <tbody>{(item.children||[]).map((c,ci)=><tr key={ci}>
                  <td style={{...C.td,color:"#888",paddingLeft:20}}>└{ci+1}</td>
                  <td style={C.td}><code style={{fontSize:11}}>{c.modelNo||"—"}</code></td>
                  <td style={C.td}>{c.brand||"—"}</td>
                  <td style={{...C.td,whiteSpace:"pre-wrap"}}>{c.description||"—"}</td>
                  <td style={{...C.td,textAlign:"right"}}>{(c.glp||0).toFixed(2)}</td>
                  <td style={{...C.td,textAlign:"right"}}>{(c.local||0).toFixed(2)}</td>
                  <td style={{...C.td,textAlign:"center"}}>{c.qty||1}</td>
                </tr>)}</tbody>
              </table>
            </td></tr>}
          </Fragment>);
        }
        return(<tr key={item.id} style={{background:editId===item.id?"#f8f0f0":"#fff"}}>
        <td style={{...C.td,color:"#888"}}>{(page-1)*PS+idx+1}</td>
        {editId===item.id?<>
          <td style={C.td}><textarea style={{...C.input,minHeight:55,resize:"vertical"}} value={form.modelNo} onChange={e=>setForm(f=>({...f,modelNo:e.target.value}))}/></td>
          <td style={C.td}><BrandSelector value={form.brand} onChange={v=>setForm(f=>({...f,brand:v}))} allBrands={allBrands}/></td>
          <td style={C.td}><textarea style={{...C.input,minHeight:55,resize:"vertical"}} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></td>
          <td style={C.td}><input style={{...C.input,textAlign:"right"}} type="number" step="0.01" value={form.glp} onChange={e=>setForm(f=>({...f,glp:e.target.value}))}/></td>
          <td style={C.td}><input style={{...C.input,textAlign:"right"}} type="number" step="0.01" value={form.local} onChange={e=>setForm(f=>({...f,local:e.target.value}))}/></td>
          <td style={C.td}><textarea style={{...C.input,minHeight:55,resize:"vertical"}} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Internal note"/></td>
          <td style={C.td}><div style={{display:"flex",gap:5}}><button style={C.btnP} onClick={saveEdit}>Save</button><button style={C.btnS} onClick={cancelEdit}>Cancel</button></div></td>
        </>:<>
          <td style={C.td}><code style={{fontSize:11,whiteSpace:"pre-wrap"}}>{item.modelNo||"—"}</code></td>
          <td style={C.td}>{item.brand||"—"}</td>
          <td style={{...C.td,whiteSpace:"pre-wrap"}}>{item.description||"—"}</td>
          <td style={{...C.td,textAlign:"right"}}>{(item.glp||0).toFixed(2)}</td>
          <td style={{...C.td,textAlign:"right"}}>{(item.local||0).toFixed(2)}</td>
          <td style={{...C.td,color:"#888",fontSize:12,maxWidth:160,whiteSpace:"pre-wrap"}}>{item.notes||"—"}</td>
          <td style={C.td}><div style={{display:"flex",gap:5}}><button style={C.btnS} onClick={()=>startEdit(item)}>Edit</button><button style={C.btnD} onClick={()=>delItem(item.id)}>Del</button></div></td>
        </>}
      </tr>);})}</tbody>
    </table></div>}
    {totalP>1&&<div style={{display:"flex",gap:6,alignItems:"center",marginTop:10,justifyContent:"center"}}><button style={C.btnS} disabled={page===1} onClick={()=>setPage(p=>p-1)}>‹</button><span style={{fontSize:12,color:"#888"}}>Page {page}/{totalP} · {filtered.length} items</span><button style={C.btnS} disabled={page===totalP} onClick={()=>setPage(p=>p+1)}>›</button></div>}
  </div>);
}

// ─── Item Search Dropdown ─────────────────────────────────────────────────────
// Enter / Shift+Enter navigation (next / previous) for qty inputs in the editor.
// group "top"  -> normal lines + subsystem headers (never enters a subsystem)
// group "ss-<id>" -> children of one subsystem (never leaves that subsystem)
function qtyFocus(e){e.target.select();}
function qtyEnter(e){
  if(e.key!=="Enter")return;
  e.preventDefault();
  const el=e.currentTarget,group=el.dataset.qtyGroup;
  const root=el.closest("table")||document;
  const all=Array.from(root.querySelectorAll("input[data-qty-group]")).filter(i=>i.dataset.qtyGroup===group);
  const next=all[all.indexOf(el)+(e.shiftKey?-1:1)];
  if(next){next.focus();next.select();}
}

function ItemSearchDropdown({priceList,onSelect,excludeSubsystems}){
  const [q,setQ]=useState(""),[open,setOpen]=useState(false),[hi,setHi]=useState(-1);
  const ref=useRef(),listRef=useRef();
  const pool=useMemo(()=>excludeSubsystems?(priceList||[]).filter(i=>i.type!=="subsystem"):(priceList||[]),[priceList,excludeSubsystems]);
  const matchingChild=(i,ql)=>i.type==="subsystem"?(i.children||[]).find(c=>(c.modelNo||"").toLowerCase().includes(ql)||(c.description||"").toLowerCase().includes(ql)):null;
  const results=useMemo(()=>{if(!q.trim())return pool.slice(0,12);const ql=q.toLowerCase();return pool.filter(i=>(i.modelNo||"").toLowerCase().includes(ql)||(i.description||"").toLowerCase().includes(ql)||(i.brand||"").toLowerCase().includes(ql)||matchingChild(i,ql)).slice(0,20);},[q,pool]);
  useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  useEffect(()=>{setHi(-1);},[q]);
  useEffect(()=>{if(hi>=0&&listRef.current){const el=listRef.current.children[hi];if(el)el.scrollIntoView({block:"nearest"});}},[hi]);
  const onKey=e=>{if(!open||!results.length)return;if(e.key==="ArrowDown"){e.preventDefault();setHi(h=>Math.min(h+1,results.length-1));}else if(e.key==="ArrowUp"){e.preventDefault();setHi(h=>Math.max(h-1,0));}else if(e.key==="Enter"&&hi>=0){e.preventDefault();onSelect(results[hi]);setQ("");setOpen(false);setHi(-1);}else if(e.key==="Escape")setOpen(false);};
  return(<div ref={ref} style={{position:"relative",flex:1,minWidth:260}}>
    <input style={C.input} value={q} placeholder="Search model no or description…" onChange={e=>{setQ(e.target.value);setOpen(true);}} onFocus={()=>setOpen(true)} onKeyDown={onKey}/>
    {open&&results.length>0&&<div ref={listRef} style={{position:"absolute",top:"100%",left:0,right:0,background:"#fff",border:"1px solid #b0b0b0",borderRadius:"6px",boxShadow:"0 4px 16px rgba(0,0,0,0.15)",zIndex:200,maxHeight:260,overflowY:"auto"}}>
      {results.map((item,i)=>{
        const isSS=item.type==="subsystem";
        const ql=q.trim().toLowerCase();
        const ownMatch=isSS&&ql&&((item.description||"").toLowerCase().includes(ql));
        const mc=isSS&&ql&&!ownMatch?matchingChild(item,ql):null;
        return(<div key={item.id} style={{padding:"8px 12px",cursor:"pointer",borderBottom:"1px solid #eee",background:i===hi?"#fde8e8":"#fff"}} onMouseDown={()=>{onSelect(item);setQ("");setOpen(false);setHi(-1);}} onMouseEnter={()=>setHi(i)}>
          <div style={{fontSize:13}}>
            {isSS
              ? <><span style={{...C.badge("purple"),marginRight:8,fontSize:11}}>SUBSYSTEM</span><span style={{fontWeight:500,color:i===hi?"#c0392b":"#222"}}>{item.description}</span><span style={{color:i===hi?"#c0392b":"#888",marginLeft:8,fontSize:11}}>({(item.children||[]).length} items)</span></>
              : <><span style={{fontWeight:500,color:i===hi?"#c0392b":"#222"}}>{item.modelNo||"—"}</span><span style={{color:i===hi?"#c0392b":"#666",marginLeft:8}}>{item.description}</span><span style={{...C.badge("blue"),marginLeft:8,fontSize:11}}>{item.brand}</span></>
            }
          </div>
          {mc&&<div style={{fontSize:11,color:"#7c3aed",marginTop:2}}>↳ matched item: {mc.modelNo?`${mc.modelNo} — `:""}{mc.description}</div>}
          {item.notes&&<div style={{fontSize:11,color:"#ea580c",marginTop:2}}>📌 {item.notes}</div>}
        </div>);
      })}
    </div>}
  </div>);
}

// ─── Project Editor ───────────────────────────────────────────────────────────
// ─── SubsystemRow component (needs own state so can't be inside .map) ─────────
// Per-item factor inputs, shown under the unit price once "Custom factor" was pressed on that item.
// The placeholder shows the project factor the item would use without the custom value.
function FactorInputs({item,brandFactors,localFactor,onChange}){
  const base=itemFactors({...item,customFactor:false},brandFactors,localFactor);
  const inp={width:56,padding:"1px 4px",fontSize:11,textAlign:"right",border:"1px solid #93c5fd",borderRadius:3,background:"#fff"};
  const lbl={fontSize:10,color:"#1d4ed8",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:3};
  return(<div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"flex-end",marginTop:4}} onClick={e=>e.stopPropagation()} onMouseDown={e=>e.stopPropagation()}>
    <label style={lbl} title={`Brand factor for this item only (project ${item.brand||"brand"} factor: ×${fmtFactor(base.bf)})`}>Brand ×<input style={inp} type="number" step="0.01" min="0" value={item.itemBrandFactor??""} placeholder={fmtFactor(base.bf)} onChange={e=>onChange("itemBrandFactor",e.target.value)}/></label>
    <label style={lbl} title={`Local factor for this item only (project local factor: ×${fmtFactor(base.lf)})`}>Local ×<input style={inp} type="number" step="0.01" min="0" value={item.itemLocalFactor??""} placeholder={fmtFactor(base.lf)} onChange={e=>onChange("itemLocalFactor",e.target.value)}/></label>
  </div>);
}
const factorBtn={padding:"2px 4px",fontSize:10,whiteSpace:"nowrap",color:"#1d4ed8",borderColor:"#93c5fd"};

function SubsystemRow({line,idx,brandFactors,localFactor,rate,roundUp,curr,setSSCustomFactors,updChildFactor,resetRowNum,
  updSS,delSS,dupLine,toggleSSCollapse,addChildFromCatalog,addChildCustom,updChild,delChild,dragChildOut,reorderChildren,
  onDragStart,onDragEnter,onDragEnd,onDragOver,ssChildDragItem,ssChildDragOver,dragOver,
  priceList,plBrands,fmtN,fmtR,C,ssLineUnitDisp,ssLineTot,calcUnitPrice,applyRounding,
  isSubEntry,isContStart,canMerge,canUnmerge,isLastInGroup,groupSize,mergeWithAbove,unmerge,
  editingRowNum,setEditingRowNum,setRowNumOverride,saveSubsystemToPriceList,selectedIds,toggleSelect}){
  const [ssAddMode,setSSAddMode]=useState(null);
  const [ssCustomForm,setSSCF]=useState({description:"",modelNo:"",brand:"",glp:"",local:"",notes:""});
  const [editingChildId,setEditingChildId]=useState(null);
  const ssUnit_=ssLineUnitDisp(line);
  const ssTotal_=ssLineTot(line);
  return(<Fragment>
    {/* Subsystem header row */}
    <tr draggable onDragStart={e=>onDragStart(e,idx)} onDragEnter={e=>onDragEnter(e,idx)} onDragEnd={onDragEnd} onDragOver={onDragOver}
      style={{background:line.optional?"#fffbf0":"#f3e8ff",cursor:"grab",borderLeft:line.mergeGroup?"3px solid #c0392b":"3px solid #7c3aed",opacity:line.optional?0.75:1}}>
      <td style={{...C.td,textAlign:"center",verticalAlign:"middle"}}>
        <input type="checkbox" checked={selectedIds.has(line.id)} onChange={()=>toggleSelect(line.id)}/>
      </td>
      {isContStart&&<td style={C.td} rowSpan={groupSize}></td>}
      <td style={{...C.td,textAlign:"center",color:"#aaa",fontSize:16,userSelect:"none",verticalAlign:"middle"}} rowSpan={isSubEntry?1:groupSize}>
        ⠿
        {isSubEntry
          ? <div style={{marginTop:2}}>
              <span style={{fontSize:12,fontWeight:600,color:"#c0392b",opacity:0.55}}>{line.rowNum}</span>
              <div style={{fontSize:9,color:"#c0392b",marginTop:2}}>↑ merged</div>
            </div>
          : editingRowNum===line.id
          ? <div style={{marginTop:2}} onClick={e=>e.stopPropagation()}>
              <input autoFocus style={{...C.input,width:42,padding:"2px 4px",textAlign:"center",fontSize:12}}
                defaultValue={line.rowNumOverride||line.rowNumAuto||line.rowNum}
                onBlur={e=>{setRowNumOverride(line.id,e.target.value.trim());setEditingRowNum(null);}}
                onKeyDown={e=>{if(e.key==="Enter"){setRowNumOverride(line.id,e.target.value.trim());setEditingRowNum(null);}if(e.key==="Escape")setEditingRowNum(null);}}
              />
              {line.rowNumOverride&&<div style={{fontSize:9,color:"#c0392b",cursor:"pointer",marginTop:1}} onMouseDown={e=>{e.preventDefault();resetRowNum(line.id);}}>↺ auto</div>}
            </div>
          : <div style={{marginTop:2,cursor:"text"}} onClick={e=>{e.stopPropagation();setEditingRowNum(line.id);}}>
              <span style={{fontSize:12,fontWeight:600,color:line.rowNumOverride?"#c0392b":"#555",borderBottom:line.rowNumOverride?"1px dashed #c0392b":"1px dashed transparent",padding:"0 2px"}}>{line.rowNum}</span>
              {line.mergeGroup&&<div style={{fontSize:9,color:"#c0392b",marginTop:2}}>merged</div>}
            </div>
        }

      </td>
      {!isSubEntry? <td></td>: null}
      <td colSpan={4} style={{...C.td,padding:"6px 10px"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:10,background:"#7c3aed",color:"#fff",borderRadius:3,padding:"1px 5px",fontWeight:600}}>SUBSYSTEM</span>
          <textarea style={{...C.input,flex:1,fontWeight:600,fontSize:13,minHeight:34,resize:"vertical",lineHeight:1.4}} value={line.description} onChange={e=>updSS(line.id,"description",e.target.value)} placeholder="Subsystem description…"/>
        </div>
        <div style={{marginTop:4,display:"flex",gap:8}}>
          <div style={{flex:1}}>
          <label style={{...C.label,fontSize:10}}>Brand (display only)</label>
          <BrandSelector value={line.brand||""} onChange={v=>updSS(line.id,"brand",v)} allBrands={plBrands}/>
        </div>
        <div style={{marginTop:4}}>
          <label style={{...C.label,fontSize:10}}>Part Number (auto-generated, editable)</label>
          <textarea style={{...C.input,minHeight:36,fontSize:10,fontFamily:"monospace",resize:"vertical",lineHeight:1.4}} value={line.partNumber||""} onChange={e=>updSS(line.id,"partNumber",e.target.value)}/>
        </div>
        </div>
      </td>
      <td style={{...C.td,textAlign:"right",color:"#555",fontSize:11}} colSpan={3}>{fmtR(line.optional?applyRounding(ssChildUnitTotal(line,brandFactors,localFactor),roundUp,rate):ssUnit_,roundUp,curr)}</td>
      <td style={{...C.td,textAlign:"center"}}>
        {line.optional
          ?<span style={{fontSize:12,color:"#888",fontStyle:"italic"}}>Optional</span>
          :<input style={{...C.input,width:54,textAlign:"center",padding:"3px 5px"}} type="number" min="1" value={line.qty} onChange={e=>updSS(line.id,"qty",parseInt(e.target.value)||1)} data-qty-group="top" onFocus={qtyFocus} onKeyDown={qtyEnter}/>
        }
      </td>
      <td style={{...C.td,textAlign:"right",fontWeight:600,color:"#7c3aed"}}>{line.optional?"—":fmtR(ssTotal_,roundUp,curr)}</td>
      <td style={C.td}>
        <div style={{display:"flex",flexDirection:"column",gap:3}}>
          <button style={{...C.btnS,padding:"2px 7px",fontSize:11}} onClick={()=>{if(line.mergeGroup)updSS(line.id,"forceShowChildren",!line.forceShowChildren);else toggleSSCollapse(line.id);}}>
            {(line.mergeGroup?line.forceShowChildren:!line.collapsed)?"▼ Hide":"▶ Show"}
          </button>
          <button style={{...C.btnD,padding:"2px 7px",fontSize:12}} onClick={()=>delSS(line.id)}>×</button>
          <button style={{...C.btnS,padding:"2px 7px",fontSize:12}} onClick={()=>dupLine(line.id)} title="Duplicate this subsystem">📋 Copy</button>
          {canMerge&&<button style={{...C.btnS,padding:"2px 4px",fontSize:10,whiteSpace:"nowrap",color:"#c0392b",borderColor:"#c0392b"}} onClick={()=>mergeWithAbove(line.id)} title="Merge with row above">⤴ Merge</button>}
          {canUnmerge&&isLastInGroup&&<button style={{...C.btnS,padding:"2px 4px",fontSize:10,whiteSpace:"nowrap"}} onClick={()=>unmerge(line.id)} title="Unmerge this row">⊠ Unmerge</button>}
          {(line.children||[]).length>0&&<button style={{...C.btnS,padding:"2px 4px",fontSize:10,whiteSpace:"nowrap"}} onClick={()=>saveSubsystemToPriceList(line)} title="Save this subsystem as a reusable template">💾 Save tmpl</button>}
          {line.customFactors
            ?<button style={{...C.btnS,...factorBtn,background:"#eff6ff"}} onClick={()=>setSSCustomFactors(line.id,false)} title="Cancel the custom factors — every item in this subsystem goes back to the project's brand and local factors">✕ Factors</button>
            :<button style={{...C.btnS,...factorBtn}} onClick={()=>{setSSCustomFactors(line.id,true);if(line.mergeGroup?!line.forceShowChildren:line.collapsed){if(line.mergeGroup)updSS(line.id,"forceShowChildren",true);else toggleSSCollapse(line.id);}}} title="Give each item in this subsystem its own brand and local factor">ƒ Factors</button>}
          <label style={{display:"flex",alignItems:"center",gap:3,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>
            <input type="checkbox" checked={!!line.optional} onChange={e=>updSS(line.id,"optional",e.target.checked)}/>
            Opt.
          </label>
        </div>
      </td>
    </tr>
    {/* Children rows — auto-hidden while merged unless manually expanded */}
    {(line.mergeGroup?line.forceShowChildren:!line.collapsed)&&(line.children||[]).map((child,ci)=>(
      <tr key={child.id}
        draggable
        onDragStart={e=>{e.stopPropagation();ssChildDragItem.current={ssId:line.id,ci};e.dataTransfer.effectAllowed="move";}}
        onDragEnter={e=>{e.stopPropagation();ssChildDragOver.current={ssId:line.id,ci};}}
        onDragOver={e=>{e.preventDefault();e.stopPropagation();}}
        onDragEnd={e=>{
          e.stopPropagation();
          const from=ssChildDragItem.current;const to=ssChildDragOver.current;
          ssChildDragItem.current=null;ssChildDragOver.current=null;
          if(!from)return;
          if(to&&from.ssId===to.ssId&&from.ci!==to.ci){
            // shuffle within same subsystem
            reorderChildren(from.ssId,from.ci,to.ci);
          } else if(!to||from.ssId!==to?.ssId){
            // drag out to flat list
            dragChildOut(from.ssId,child.id,dragOver.current??idx+1);
          }
        }}
        style={{background:child.optional?"#fffbf0":child.customFactor?"#eff6ff":"#faf5ff",borderLeft:"4px solid #c4b5fd"}}>
        {editingChildId===child.id?(
          <td colSpan={11} style={{padding:"10px 12px",background:"#fffde7",border:"2px solid #f59e0b"}}>
            <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
              <div style={{flex:2,minWidth:130}}><label style={C.label}>Description</label><textarea style={{...C.input,minHeight:55,resize:"vertical",lineHeight:1.5}} value={child.description} onChange={e=>updChild(line.id,child.id,"description",e.target.value)}/></div>
              <div style={C.f1}><label style={C.label}>Model No</label><textarea style={{...C.input,minHeight:55,resize:"vertical",lineHeight:1.5}} value={child.modelNo||""} onChange={e=>updChild(line.id,child.id,"modelNo",e.target.value)}/></div>
              <div style={C.f1}><label style={C.label}>Brand</label><BrandSelector value={child.brand||""} onChange={v=>updChild(line.id,child.id,"brand",v)} allBrands={plBrands}/></div>
              <div style={C.f1}><label style={C.label}>GLP (USD)</label><input style={C.input} type="number" step="0.01" value={child.glp||0} onChange={e=>{updChild(line.id,child.id,"glp",parseFloat(e.target.value)||0);if(!child.isCustom)updChild(line.id,child.id,"isCustom",true);}}/></div>
              <div style={C.f1}><label style={C.label}>Local (USD)</label><input style={C.input} type="number" step="0.01" value={child.local||0} onChange={e=>{updChild(line.id,child.id,"local",parseFloat(e.target.value)||0);if(!child.isCustom)updChild(line.id,child.id,"isCustom",true);}}/></div>
            </div>
            <div style={{marginBottom:8}}><label style={C.label}>Notes (internal)</label><textarea style={{...C.input,minHeight:40,resize:"vertical"}} value={child.notes||""} onChange={e=>updChild(line.id,child.id,"notes",e.target.value)}/></div>
            <div style={{display:"flex",gap:7,alignItems:"center"}}>
              <button style={C.btnP} onClick={()=>{if(!child.isCustom)updChild(line.id,child.id,"isCustom",true);setEditingChildId(null);}}>✓ Done</button>
              <button style={C.btnS} onClick={()=>setEditingChildId(null)}>Cancel</button>
              {child.isCustom&&<span style={{fontSize:11,color:"#888"}}>Changes won't affect the price list.</span>}
              {!child.isCustom&&<span style={{fontSize:11,color:"#ea580c"}}>⚠ Editing will convert this to a custom item.</span>}
            </div>
          </td>
        ):(<>
        <td style={{...C.td,textAlign:"center",color:"#aaa",fontSize:12,paddingLeft:12}}>└{ci+1}</td>
        <td style={{...C.td,whiteSpace:"pre-wrap"}}><code style={{fontSize:11}}>{child.modelNo||"—"}</code></td>
        <td style={C.td}>{child.brand||"—"}</td>
        <td style={{...C.td,whiteSpace:"pre-wrap"}}>{child.description||"—"}</td>
        <td style={{...C.td,fontSize:11,color:"#ea580c"}}>{child.notes||""}</td>
        <td style={{...C.td,textAlign:"right",color:"#555"}}>{fmtN(child.glp,false)}</td>
        <td style={{...C.td,textAlign:"right",color:"#555"}}>{fmtN(child.local||0,false)}</td>
        <td style={{...C.td,textAlign:"right"}}>{applyRounding(calcUnitPrice(child,brandFactors,localFactor),roundUp,rate).toFixed(2)}
          {child.customFactor&&<FactorInputs item={child} brandFactors={brandFactors} localFactor={localFactor} onChange={(f,v)=>updChildFactor(line.id,child.id,f,v)}/>}
        </td>
        <td style={{...C.td,textAlign:"center"}}>
          {child.optional
            ?<span style={{fontSize:12,color:"#888",fontStyle:"italic"}}>Optional</span>
            :<input style={{...C.input,width:54,textAlign:"center",padding:"3px 5px"}} type="number" min="1" value={child.qty} onChange={e=>updChild(line.id,child.id,"qty",e.target.value)} data-qty-group={"ss-"+line.id} onFocus={qtyFocus} onKeyDown={qtyEnter}/>
          }
        </td>
        <td style={{...C.td,textAlign:"right",fontWeight:500}}>{child.optional?"—":fmtR(applyRounding(calcUnitPrice(child,brandFactors,localFactor),roundUp,rate)*child.qty,roundUp,curr)}</td>
        <td style={C.td}>
          <div style={{display:"flex",flexDirection:"column",gap:3}}>
            <button style={{...C.btnS,padding:"2px 7px",fontSize:12}} onClick={()=>setEditingChildId(child.id)} title="Edit item">✏️</button>
            <button style={{...C.btnD,padding:"2px 7px",fontSize:12}} onClick={()=>delChild(line.id,child.id)}>×</button>
            <label style={{display:"flex",alignItems:"center",gap:3,fontSize:11,cursor:"pointer"}}>
              <input type="checkbox" checked={!!child.optional} onChange={e=>updChild(line.id,child.id,"optional",e.target.checked)}/>Opt.
            </label>
          </div>
        </td>
        </>)}
      </tr>
    ))}
    {/* Add child buttons — auto-hidden while merged unless manually expanded */}
    {(line.mergeGroup?line.forceShowChildren:!line.collapsed)&&<tr key={line.id+"-add"}>
      <td colSpan={11} style={{padding:"6px 10px 8px 28px",background:"#f9f5ff",borderLeft:"4px solid #c4b5fd"}}>
        {ssAddMode===null&&<div style={{display:"flex",gap:7}}>
          <button style={{...C.btnS,fontSize:11,padding:"2px 10px"}} onClick={()=>setSSAddMode("catalog")}>+ From price list</button>
          <button style={{...C.btnS,fontSize:11,padding:"2px 10px"}} onClick={()=>setSSAddMode("custom")}>+ Custom item</button>
        </div>}
        {ssAddMode==="catalog"&&<div style={{display:"flex",gap:7,alignItems:"flex-end"}}>
          <ItemSearchDropdown priceList={priceList} excludeSubsystems onSelect={item=>{addChildFromCatalog(line.id,item);setSSAddMode(null);}}/>
          <button style={C.btnS} onClick={()=>setSSAddMode(null)}>Cancel</button>
        </div>}
        {ssAddMode==="custom"&&<div>
          <div style={{...C.row,marginBottom:6}}>
            <div style={{flex:2}}><label style={C.label}>Description</label><input style={C.input} value={ssCustomForm.description} onChange={e=>setSSCF(f=>({...f,description:e.target.value}))}/></div>
            <div style={C.f1}><label style={C.label}>Model No</label><input style={C.input} value={ssCustomForm.modelNo} onChange={e=>setSSCF(f=>({...f,modelNo:e.target.value}))}/></div>
            <div style={C.f1}><label style={C.label}>Brand</label><BrandSelector value={ssCustomForm.brand} onChange={v=>setSSCF(f=>({...f,brand:v}))} allBrands={plBrands}/></div>
            <div style={C.f1}><label style={C.label}>GLP</label><input style={C.input} type="number" step="0.01" value={ssCustomForm.glp} onChange={e=>setSSCF(f=>({...f,glp:e.target.value}))}/></div>
            <div style={C.f1}><label style={C.label}>Local</label><input style={C.input} type="number" step="0.01" value={ssCustomForm.local} onChange={e=>setSSCF(f=>({...f,local:e.target.value}))}/></div>
          </div>
          <div style={{display:"flex",gap:7}}>
            <button style={C.btnP} onClick={()=>{addChildCustom(line.id,ssCustomForm);setSSCF({description:"",modelNo:"",brand:"",glp:"",local:"",notes:""});setSSAddMode(null);}}>Add</button>
            <button style={C.btnS} onClick={()=>setSSAddMode(null)}>Cancel</button>
          </div>
        </div>}
      </td>
    </tr>}
  </Fragment>);
}

function ProjectEditor({project,user,settings,priceList,onBack,takeover,onReopen}){
  const isNew=!project;
  const isSharedProject=!!project&&(project.grantedTo||[]).length>0;
  const latestRev=project?(project.draft||(project.revisions?.length?project.revisions[project.revisions.length-1]:null)):null;
  const lr={...(latestRev?.data||{}),...(latestRev||{})};

  const [fields,setFields]=useState({projectName:project?.projectName||"",client:project?.client||"",engineerName:(!isAdmin(user)&&!isSharedProject)?(user.displayName||user.username):(isSharedProject?(lr.engineerName||project?.engineerName||""):(project?.engineerName||"")),salesEngineer:lr.salesEngineer||"",contactName:lr.contactName||"",contactPhone:lr.contactPhone||"",contactEmail:lr.contactEmail||"",refNumber:project?.refNumber||"",systemType:project?.systemType||"",date:lr.date||new Date().toISOString().slice(0,10),currency:lr.currency||settings.defaultCurrency,conversionRate:lr.conversionRate||1});
  const [brandFactors,setBF]=useState(()=>{ // includes any brand used by the loaded lines, so opening a project is not itself a change
    const bf=JSON.parse(JSON.stringify(lr.brandFactors||settings.defaultBrandFactors||{}));
    (lr.lines||[]).forEach(l=>{if(l.brand&&!(l.brand in bf))bf[l.brand]=settings.defaultBrandFactors?.[l.brand]??1;});
    return bf;
  });
  const [localFactor,setLF]=useState(lr.localFactor??settings.defaultLocalFactor);
  const [lines,setLines]=useState(()=>lr.lines?JSON.parse(JSON.stringify(lr.lines)):[]);
  const [selectedIds,setSelectedIds]=useState(()=>new Set());
  const [copyModalOpen,setCopyModalOpen]=useState(false);
  const [copyTarget,setCopyTarget]=useState("end");
  const [pasteAction,setPasteAction]=useState("copy"); // "copy" or "cut" — shares the placement modal
  const [tcEnabled,setTcEnabled]=useState(lr.tcEnabled??false);
  const [tcMode,setTcMode]=useState(lr.tcMode||"value");
  const [tcValue,setTcValue]=useState(lr.tcValue??0);
  const [tcPercent,setTcPercent]=useState(lr.tcPercent??0);
  const [tcApprox,setTcApprox]=useState(lr.tcApprox??"");
  const [installEnabled,setInstE]=useState(lr.installEnabled??false);
  const [installValue,setInstV]=useState(lr.installValue??0);
  const [extras,setExtras]=useState(()=>lr.extras?JSON.parse(JSON.stringify(lr.extras)):[]);
  const [notes,setNotes]=useState(lr.notes||"");
  const [gtAfterDiscount,setGtAfterDiscount]=useState(lr.gtAfterDiscount||"");
  const [gtAfterDiscountEnabled,setGtAfterDiscountEnabled]=useState(lr.gtAfterDiscountEnabled??false);
  const [roundUp,setRoundUp]=useState(lr.roundUp??false);
  const [addMode,setAddMode]=useState(null);
  const [customForm,setCF]=useState({description:"",modelNo:"",brand:"",glp:"",local:"",notes:""});
  const [warnLocal,setWarnLocal]=useState(false);
  const [msg,setMsg]=useState({t:"",tp:""});
  const [autoSaveStatus,setASS]=useState("");
  const projectIdRef=useRef(project?.id||null);
  const autoSaveTimer=useRef(null);

  // ── Edit lock (v1.1.0) ───────────────────────────────────────────────────
  // Only one editor window at a time may change a project. This window gets a
  // random lock id, asks the server for the lock on open, refreshes it every
  // 30 s, and releases it on Back / Submit / closing the tab. If someone else
  // holds it, the editor opens read-only. If the lock is lost while editing
  // (admin took over or discarded the draft), it switches to read-only too.
  const lockIdRef=useRef(null); if(!lockIdRef.current)lockIdRef.current=uid()+uid();
  const [lockState,setLockState]=useState(isNew?"mine":"checking"); // checking | mine | other | lost | offline
  const [lockInfo,setLockInfo]=useState(null);
  const lockStateRef=useRef(lockState); lockStateRef.current=lockState;
  const readOnly=lockState!=="mine";
  const loseLock=info=>{clearTimeout(autoSaveTimer.current);setLockInfo(info||null);setLockState("lost");};
  // Back / after Submit: release the lock first, so the project list that reloads next no longer shows it.
  const goBack=async()=>{
    if(lockStateRef.current==="mine"&&projectIdRef.current){lockStateRef.current="released";await releaseLock(projectIdRef.current,lockIdRef.current);}
    onBack();
  };
  useEffect(()=>{
    currentEditLock=lockIdRef.current;
    let alive=true;
    const beat=async first=>{
      const pid=projectIdRef.current; if(!pid)return; // a new project gets its lock when it is first saved
      const r=await acquireLock(pid,lockIdRef.current,first&&takeover);
      if(!alive)return;
      if(r.ok){setLockState("mine");return;}
      if(r.locked){if(first){setLockInfo(r.lock);setLockState("other");}else loseLock(r.lock);return;}
      if(first)setLockState("offline");
    };
    beat(true);
    const iv=setInterval(()=>{if(lockStateRef.current==="mine")beat(false);},30000);
    const release=()=>{if(lockStateRef.current==="mine")releaseLock(projectIdRef.current,lockIdRef.current);};
    window.addEventListener("pagehide",release);
    return()=>{alive=false;clearInterval(iv);window.removeEventListener("pagehide",release);release();if(currentEditLock===lockIdRef.current)currentEditLock=null;};
  },[]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Undo / Redo ──────────────────────────────────────────────────────────
  // Snapshots every editable piece of state (everything that feeds buildRevData,
  // minus derived values like tcBaseUSD). A snapshot is pushed onto history
  // ~600ms after edits settle, so a burst of typing/clicking becomes one undo
  // step rather than one per keystroke. applyingRef suppresses the snapshot
  // effect from re-logging a change that undo/redo itself just made.
  const snapshot=useCallback(()=>({
    fields:JSON.parse(JSON.stringify(fields)),
    brandFactors:JSON.parse(JSON.stringify(brandFactors)),
    localFactor,
    lines:JSON.parse(JSON.stringify(lines)),
    tcEnabled,tcMode,tcValue,tcPercent,tcApprox,
    installEnabled,installValue,
    extras:JSON.parse(JSON.stringify(extras)),
    notes,gtAfterDiscount,gtAfterDiscountEnabled,roundUp,
  }),[fields,brandFactors,localFactor,lines,tcEnabled,tcMode,tcValue,tcPercent,tcApprox,installEnabled,installValue,extras,notes,gtAfterDiscount,gtAfterDiscountEnabled,roundUp]);
  const applySnapshot=snap=>{
    setFields(snap.fields);setBF(snap.brandFactors);setLF(snap.localFactor);setLines(snap.lines);
    setTcEnabled(snap.tcEnabled);setTcMode(snap.tcMode);setTcValue(snap.tcValue);setTcPercent(snap.tcPercent);setTcApprox(snap.tcApprox);
    setInstE(snap.installEnabled);setInstV(snap.installValue);
    setExtras(snap.extras);setNotes(snap.notes);setGtAfterDiscount(snap.gtAfterDiscount);setGtAfterDiscountEnabled(snap.gtAfterDiscountEnabled);setRoundUp(snap.roundUp);
  };
  const historyRef=useRef([]);   // past snapshots (undo stack)
  const futureRef=useRef([]);    // undone snapshots (redo stack)
  const lastSnapshotRef=useRef(null);
  const applyingRef=useRef(false);
  const didMountRef=useRef(false);
  const [histVersion,setHistVersion]=useState(0); // bumped to re-render so the buttons' disabled state stays current
  useEffect(()=>{
    if(!didMountRef.current){didMountRef.current=true;lastSnapshotRef.current=snapshot();return;} // don't log the initial load as an "edit"
    if(applyingRef.current){applyingRef.current=false;lastSnapshotRef.current=snapshot();return;}
    const t=setTimeout(()=>{
      if(lastSnapshotRef.current){
        historyRef.current.push(lastSnapshotRef.current);
        if(historyRef.current.length>50)historyRef.current.shift();
      }
      futureRef.current=[]; // a fresh edit invalidates whatever was available to redo
      lastSnapshotRef.current=snapshot();
      setHistVersion(v=>v+1);
    },600);
    return ()=>clearTimeout(t);
  },[fields,brandFactors,localFactor,lines,tcEnabled,tcMode,tcValue,tcPercent,tcApprox,installEnabled,installValue,extras,notes,gtAfterDiscount,gtAfterDiscountEnabled,roundUp]); // eslint-disable-line react-hooks/exhaustive-deps
  const canUndo=historyRef.current.length>0;
  const canRedo=futureRef.current.length>0;
  const undo=()=>{
    if(!historyRef.current.length)return;
    const prev=historyRef.current.pop();
    futureRef.current.push(snapshot());
    applyingRef.current=true;
    applySnapshot(prev);
    setHistVersion(v=>v+1);
  };
  const redo=()=>{
    if(!futureRef.current.length)return;
    const next=futureRef.current.pop();
    historyRef.current.push(snapshot());
    applyingRef.current=true;
    applySnapshot(next);
    setHistVersion(v=>v+1);
  };

  const flash=(t,tp="ok")=>{setMsg({t,tp});setTimeout(()=>setMsg({t:"",tp:""}),3000);};

  // only brands present in current lines
  const allBrands=[...new Set(lines.map(l=>l.brand).filter(Boolean))];
  const plBrands=[...new Set((priceList||[]).map(i=>i.brand).filter(Boolean))];

  const supplyUSD=expandForCalc(lines).reduce((s,l)=>s+calcUnitPrice(l,brandFactors,localFactor)*l.qty,0);
  const factorSum=factorSummary(lines,brandFactors,localFactor); // effective factor per brand (reverse calculation)
  useEffect(()=>{
    const missing=allBrands.filter(b=>!(b in brandFactors));
    if(missing.length>0){setBF(bf=>{const u={...bf};missing.forEach(b=>{u[b]=settings.defaultBrandFactors[b]??1;});return u;});}
  },[allBrands.join(",")]);

  // optional items excluded from calculations
  const lineUnitUSD=line=>line.optional?0:calcUnitPrice(line,brandFactors,localFactor);
  const lineUnitDisp=line=>line.optional?0:applyRounding(calcUnitPrice(line,brandFactors,localFactor),roundUp,rate);
  // only brands present in current lines
  //allBrands=[...new Set(lines.map(l=>l.brand).filter(Boolean))];
  const rate=parseFloat(fields.conversionRate)||1;
  const curr=fields.currency;
  //const lineUnitUSD=line=>calcUnitPrice(line,brandFactors,localFactor);
  //const lineUnitDisp=line=>applyRounding(lineUnitUSD(line),roundUp,rate);
  const lineTotal=line=>line.optional?0:lineUnitDisp(line)*line.qty;
  const ssLineUnitDisp=ss=>applyRounding(ssUnitPrice(ss,brandFactors,localFactor),roundUp,rate);
  const ssLineTot=ss=>ssLineUnitDisp(ss)*(ss.qty||1);
  const ssOpen=l=>!!l&&l.type==="subsystem"&&!!(l.mergeGroup?l.forceShowChildren:!l.collapsed);
  const supplyTotal=lines.reduce((s,l)=>{
    if(l.type==="section")return s;
    if(l.type==="subsystem")return s+ssLineTot(l);
    return s+lineTotal(l);
  },0);
  const conv=v=>applyRounding(v,roundUp,rate);
  const tcBaseUSD=(()=>{if(!tcEnabled)return 0;if(tcMode==="value")return parseFloat(tcValue)||0;const raw=supplyUSD*((parseFloat(tcPercent)||0)/100);const approx=parseFloat(tcApprox);if(!isNaN(approx)&&approx>0)return Math.ceil(raw/approx)*approx;return raw;})();
  const tcDisp=tcEnabled?conv(tcBaseUSD):0;
  const installDisp=installEnabled?conv(parseFloat(installValue)||0):0;
  const extrasDisp=extras.map(e=>({...e,disp:conv(parseFloat(e.value)||0)}));
  const grandTotal=supplyTotal+tcDisp+installDisp+extrasDisp.reduce((s,e)=>s+e.disp,0);

  const autoCode=()=>{const d=fields.date||new Date().toISOString().slice(0,10);const[y,m,day]=d.split("-");const eng=(fields.engineerName||"Eng").replace(/\s+/g,"");const revN=project?project.revisions.length:0;return `#${fields.refNumber||"XXX"}-${day}-${m}-${y.slice(2)}-${fields.systemType||"SYS"}-${eng}-Rev-${revN}`;};

  const buildRevData=useCallback(()=>({...fields,brandFactors:JSON.parse(JSON.stringify(brandFactors)),localFactor,lines:JSON.parse(JSON.stringify(lines)),tcEnabled,tcMode,tcValue:parseFloat(tcValue)||0,tcPercent:parseFloat(tcPercent)||0,tcApprox,tcBaseUSD,installEnabled,installValue:parseFloat(installValue)||0,extras:JSON.parse(JSON.stringify(extras)),notes,gtAfterDiscount,gtAfterDiscountEnabled,roundUp,code:autoCode(),grandTotal,currency:curr,conversionRate:rate}),[fields,brandFactors,localFactor,lines,tcEnabled,tcMode,tcValue,tcPercent,tcApprox,tcBaseUSD,installEnabled,installValue,extras,notes,gtAfterDiscount,gtAfterDiscountEnabled,roundUp,grandTotal,curr,rate]);

  // auto-save draft
  const triggerAutoSave=useCallback(()=>{
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current=setTimeout(async()=>{
      if(!fields.projectName.trim())return;
      if(lockStateRef.current!=="mine")return;
      setASS("Saving…");
      let pid=projectIdRef.current;
      if(!pid){const np={id:uid(),projectName:fields.projectName,client:fields.client,engineerName:fields.engineerName,refNumber:fields.refNumber,systemType:fields.systemType,ownedBy:isAdmin(user)?null:user.username,grantedTo:[],status:"draft",createdAt:now()};const cr=await createProject(np);if(!cr.ok){setASS("⚠ Autosave failed — no connection to server");return;}pid=cr.id;projectIdRef.current=pid;}
      const sr=await saveDraft(pid,buildRevData(),user.username||user.displayName);
      if(sr.lockLost){setASS("");loseLock(sr.lock);return;}
      if(!sr.ok){setASS("⚠ Autosave failed — no connection to server");return;}
      setASS("Draft saved ✓");setTimeout(()=>setASS(""),2500);
    },1500);
  },[fields,buildRevData,user]);

  // Autosave only after a real change — merely opening (or viewing) a project saves nothing.
  const autoSaveArmed=useRef(false);
  useEffect(()=>{
    if(!autoSaveArmed.current){autoSaveArmed.current=true;return;}
    if(lockStateRef.current!=="mine")return;
    triggerAutoSave();
  },[fields,brandFactors,localFactor,lines,tcEnabled,tcMode,tcValue,tcPercent,tcApprox,installEnabled,installValue,extras,notes,gtAfterDiscount,gtAfterDiscountEnabled,roundUp]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFromCatalog=item=>{
    if(item.type==="subsystem"){
      const children=(item.children||[]).map(c=>({...c,id:uid(),qty:c.qty||1}));
      const ss={id:uid(),type:"subsystem",description:item.description,brand:item.brand||"",partNumber:item.partNumber||autoPartNumber({children}),qty:1,children,collapsed:false,rowNum:""};
      setLines(l=>assignRowNums([...l,ss]));setAddMode(null);return;
    }
    setLines(l=>assignRowNums([...l,{id:uid(),description:item.description,modelNo:item.modelNo,brand:item.brand,glp:item.glp,local:item.local,notes:item.notes||"",qty:1,rowNum:"",isCustom:false}]));setAddMode(null);
  };
  const addCustom=()=>{if(!customForm.description.trim()&&!customForm.modelNo.trim()){flash("Need description or model.","err");return;}const item={id:uid(),description:customForm.description,modelNo:customForm.modelNo,brand:normalizeBrand(customForm.brand,plBrands),glp:parseFloat(customForm.glp)||0,local:parseFloat(customForm.local)||0,notes:customForm.notes||"",qty:1,rowNum:"",isCustom:true};setLines(l=>assignRowNums([...l,item]));setCF({description:"",modelNo:"",brand:"",glp:"",local:"",notes:""});setAddMode(null);};
  const addSection=()=>{setLines(l=>assignRowNums([...l,{id:uid(),type:"section",label:"New Section",rowNum:""}]));};
  const delLine=id=>setLines(l=>assignRowNums(l.filter(x=>x.id!==id)));
  // Duplicates any line (item, subsystem, or section) and inserts the copy
  // right after it — after the whole merge group if the source is grouped,
  // so a duplicate never lands mid-group and breaks the contiguous run.
  // The copy gets a fresh id (and fresh child ids for a subsystem) and starts
  // out ungrouped/un-overridden, since those are specific to the original row.
  const dupLine=id=>setLines(l=>{
    const idx=l.findIndex(x=>x.id===id);
    if(idx===-1) return l;
    const src=l[idx];
    const clone=JSON.parse(JSON.stringify(src));
    clone.id=uid();
    clone.mergeGroup=null;
    clone.rowNumOverride=null;
    if(clone.type==="subsystem") clone.children=(clone.children||[]).map(c=>({...c,id:uid()}));
    let insertAt=idx+1;
    if(src.mergeGroup){
      let j=idx+1;
      while(j<l.length && l[j].mergeGroup===src.mergeGroup) j++;
      insertAt=j;
    }
    return assignRowNums([...l.slice(0,insertAt), clone, ...l.slice(insertAt)]);
  });

  // Multi-select copy: a checkbox per row feeds selectedIds; a toolbar button
  // opens a small placement picker, then copySelectedTo() clones every
  // selected line (in its original relative order) and inserts the whole
  // batch at the chosen position in one shot.
  const toggleSelect=id=>setSelectedIds(s=>{const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n;});
  const clearSelection=()=>setSelectedIds(new Set());
  const copySelectedTo=target=>{
    setLines(l=>{
      const selected=l.filter(x=>selectedIds.has(x.id));
      if(!selected.length) return l;
      const clones=selected.map(src=>{
        const clone=JSON.parse(JSON.stringify(src));
        clone.id=uid();
        clone.mergeGroup=null;
        clone.rowNumOverride=null;
        if(clone.type==="subsystem") clone.children=(clone.children||[]).map(c=>({...c,id:uid()}));
        return clone;
      });
      let insertAt;
      if(target==="start") insertAt=0;
      else if(target==="end") insertAt=l.length;
      else { const i=l.findIndex(x=>x.id===target); insertAt = i===-1 ? l.length : i+1; }
      return assignRowNums([...l.slice(0,insertAt), ...clones, ...l.slice(insertAt)]);
    });
    clearSelection();
    setCopyModalOpen(false);
  };
  // Cut: moves the selected lines (the same lines, not clones — ids and any
  // mergeGroup carry over as-is) out of their current spot and re-inserts
  // them at the chosen position, in their original relative order.
  const cutSelectedTo=target=>{
    setLines(l=>{
      const selected=l.filter(x=>selectedIds.has(x.id));
      if(!selected.length) return l;
      const remaining=l.filter(x=>!selectedIds.has(x.id));
      let insertAt;
      if(target==="start") insertAt=0;
      else if(target==="end") insertAt=remaining.length;
      else { const i=remaining.findIndex(x=>x.id===target); insertAt = i===-1 ? remaining.length : i+1; }
      return assignRowNums([...remaining.slice(0,insertAt), ...selected, ...remaining.slice(insertAt)]);
    });
    clearSelection();
    setCopyModalOpen(false);
  };

  const mergeWithAbove=(id)=>setLines(prev=>{
    const idx=prev.findIndex(l=>l.id===id);
    if(idx<1)return prev;
    const above=prev[idx-1];
    if(above.type==="section"||prev[idx].type==="section")return prev;
    const grp=above.mergeGroup||above.id;
    return assignRowNums(prev.map((l,i)=>{
      if(i===idx-1)return{...l,mergeGroup:grp};
      if(i===idx)return{...l,mergeGroup:grp};
      return l;
    }));
  });

  const unmerge=(id)=>setLines(prev=>{
    const idx=prev.findIndex(l=>l.id===id);
    if(idx<0)return prev;
    const grp=prev[idx].mergeGroup;
    if(!grp)return prev;
    // find last index of the group
    let lastIdx=idx;
    prev.forEach((l,i)=>{if(l.mergeGroup===grp)lastIdx=Math.max(lastIdx,i);});
    const next=[...prev];
    const[moved]=next.splice(idx,1);
    const unmerged={...moved,mergeGroup:null};
    // after splice, if lastIdx was after idx it shifted by 1
    const insertAt=lastIdx>=idx?lastIdx:lastIdx+1;
    next.splice(insertAt,0,unmerged);
    return assignRowNums(next);
  });

  const getGroupBlock=(lines,idx)=>{
    const grp=lines[idx]?.mergeGroup;
    if(!grp)return[idx];
    let first=idx;
    while(first>0&&lines[first-1]?.mergeGroup===grp)first--;
    const block=[];
    for(let i=first;i<lines.length&&lines[i]?.mergeGroup===grp;i++)block.push(i);
    return block;
  };
  const saveLineToPriceList=async line=>{const r=await addPriceItem({id:uid(),description:line.description,modelNo:line.modelNo,brand:line.brand,glp:line.glp,local:line.local,notes:line.notes||""});if(!r.ok){flash("Could not reach the server — item was not saved to the price list.","err");return;}flash(`"${line.description||line.modelNo}" saved to price list.`);};
  const saveSubsystemToPriceList=async ss=>{
    const children=(ss.children||[]).map(c=>({description:c.description,modelNo:c.modelNo,brand:c.brand,glp:c.glp,local:c.local,notes:c.notes||"",qty:c.qty||1}));
    const r=await addPriceItem({id:uid(),type:"subsystem",description:ss.description,brand:ss.brand||"",partNumber:ss.partNumber||autoPartNumber({children}),children});
    if(!r.ok){flash("Could not reach the server — template was not saved.","err");return;}
    flash(`Subsystem "${ss.description}" saved to price list as a template.`);
  };
  const dragItem=useRef(null);
  const dragOver=useRef(null);

  const onDragStart=(e,idx)=>{dragItem.current=idx;e.dataTransfer.effectAllowed="move";};
  const onDragEnter=(e,idx)=>{dragOver.current=idx;};
  const onDragOver=e=>{e.preventDefault();e.dataTransfer.dropEffect="move";};
  const onDragEnd=()=>{
    const from=dragItem.current,to=dragOver.current;
    dragItem.current=null;dragOver.current=null;
    if(lockStateRef.current!=="mine")return; // read-only
    if(from===null||to===null||from===to)return;
    setLines(prev=>{
      const fromLine=prev[from];
      const toLine=prev[to];
      // Sub-entry: only allow shuffling within the same group
      if(fromLine?.mergeGroup){
        if(fromLine.mergeGroup===toLine?.mergeGroup){
          // shuffle within group
          const grp=fromLine.mergeGroup;
          const gIdx=prev.reduce((a,l,i)=>l.mergeGroup===grp?[...a,i]:a,[]);
          const fPos=gIdx.indexOf(from),tPos=gIdx.indexOf(to);
          if(fPos<0||tPos<0)return prev;
          const items=gIdx.map(i=>prev[i]);
          const[m]=items.splice(fPos,1);items.splice(tPos,0,m);
          const next=[...prev];
          gIdx.forEach((oi,i)=>{next[oi]=items[i];});
          return assignRowNums(next);
        }
        // block dragging sub-entry out of group
        return prev;
      }
      // Normal row or first-of-group: drag entire block
      const block=getGroupBlock(prev,from);
      const blockItems=block.map(i=>prev[i]);
      const next=prev.filter((_,i)=>!block.includes(i));
      const removed=block.filter(i=>i<to).length;
      const insertAt=Math.max(0,Math.min(to-removed,next.length));
      next.splice(insertAt,0,...blockItems);
      return assignRowNums(next);
    });
  };
  const updLine=(id,field,val)=>setLines(l=>l.map(x=>x.id===id?{...x,[field]:field==="qty"?(parseInt(val)||1):val}:x));

  // ── Custom per-item factors (v1.1.0) ───────────────────────────────────────
  // The button on a row affects only that row. On a subsystem it opens a brand
  // and local factor for each of that subsystem's own items. Cancelling removes
  // the custom values, so the item(s) use the project's factors again.
  const setCustomFactor=(id,on)=>setLines(l=>l.map(x=>x.id!==id?x:(on?withCustomFactor(x,brandFactors,localFactor):withoutCustomFactor(x))));
  const setSSCustomFactors=(ssId,on)=>setLines(l=>l.map(x=>{
    if(x.id!==ssId)return x;
    const children=(x.children||[]).map(c=>on?withCustomFactor(c,brandFactors,localFactor):withoutCustomFactor(c));
    if(on)return{...x,customFactors:true,children};
    const{customFactors,...rest}=x;return{...rest,children};
  }));
  // Factor edits leave the subsystem's (possibly hand-edited) part number alone.
  const updChildFactor=(ssId,childId,field,val)=>setLines(l=>l.map(x=>x.id!==ssId?x:{...x,children:x.children.map(c=>c.id===childId?{...c,[field]:val}:c)}));

  // ── Subsystem helpers ───────────────────────────────────────────────────────
  const addSubsystem=()=>setLines(l=>assignRowNums([...l,{id:uid(),type:"subsystem",description:"New Subsystem",brand:"",partNumber:"",qty:1,children:[],collapsed:false,rowNum:""}]));  const updSS=(ssId,field,val)=>setLines(l=>l.map(x=>x.id===ssId?{...x,[field]:val}:x));
  const toggleSSCollapse=(ssId)=>setLines(l=>l.map(x=>x.id===ssId?{...x,collapsed:!x.collapsed}:x));
  const delSS=(ssId)=>setLines(l=>assignRowNums(l.filter(x=>x.id!==ssId)));
  const solNavFileRef=useRef();
  const [solNavLoading,setSolNavLoading]=useState(false);
  const [solNavPending,setSolNavPending]=useState(null); // {result, fileName} — awaiting subsystem-vs-items choice
  const onSolNavFile=async e=>{
    const file=e.target.files[0];
    e.target.value="";
    if(!file)return;
    setSolNavLoading(true);
    try{
      const buf=await file.arrayBuffer();
      const result=await parseSolutionNavigatorExcel(buf);
      if(!result.ok){alert(result.error);setSolNavLoading(false);return;}
      setSolNavPending({result,fileName:file.name});
    }catch(err){
      alert("Could not read this Excel file. Make sure it's a valid Solution Navigator export.");
    }
    setSolNavLoading(false);
  };
  const confirmSolNavAsSubsystem=()=>{
    const{result,fileName}=solNavPending;
    const children=result.children.map(c=>({...c,id:uid()}));
    const ss={
      id:uid(),type:"subsystem",
      description:result.designation||fileName.replace(/\.xlsx?$/i,""),
      brand:"Simplex",
      partNumber:autoPartNumber({children}),
      qty:1,children,collapsed:false,rowNum:"",
    };
    setLines(l=>assignRowNums([...l,ss]));
    flash(`Imported ${children.length} item(s) from Solution Navigator as a new subsystem.`);
    setSolNavPending(null);
  };
  const confirmSolNavAsItems=()=>{
    const{result}=solNavPending;
    const items=result.children.map(c=>({
      id:uid(),description:c.description,modelNo:c.modelNo,brand:c.brand,
      glp:c.glp,local:c.local,notes:c.notes||"",qty:c.qty,rowNum:"",isCustom:true,
    }));
    setLines(l=>assignRowNums([...l,...items]));
    flash(`Imported ${items.length} item(s) from Solution Navigator as normal items.`);
    setSolNavPending(null);
  };
  const addChildFromCatalog=(ssId,item)=>{
    setLines(l=>l.map(x=>{
      if(x.id!==ssId)return x;
      let child={id:uid(),description:item.description,modelNo:item.modelNo,brand:item.brand,glp:item.glp,local:item.local,notes:item.notes||"",qty:1,isCustom:false,optional:false};
      if(x.customFactors)child=withCustomFactor(child,brandFactors,localFactor); // subsystem has its factors open
      const children=[...x.children,child];
      return{...x,children,partNumber:autoPartNumber({...x,children})};
    }));
  };
  const addChildCustom=(ssId,form)=>{
    const child={id:uid(),description:form.description,modelNo:form.modelNo,brand:normalizeBrand(form.brand,plBrands),glp:parseFloat(form.glp)||0,local:parseFloat(form.local)||0,notes:form.notes||"",qty:1,isCustom:true,optional:false};
    setLines(l=>l.map(x=>{
      if(x.id!==ssId)return x;
      const children=[...x.children,x.customFactors?withCustomFactor(child,brandFactors,localFactor):child];
      return{...x,children,partNumber:autoPartNumber({...x,children})};
    }));
  };
  const updChild=(ssId,childId,field,val)=>setLines(l=>l.map(x=>{
    if(x.id!==ssId)return x;
    const children=x.children.map(c=>c.id===childId?{...c,[field]:field==="qty"?(parseInt(val)||1):val}:c);
    return{...x,children,partNumber:autoPartNumber({...x,children})};
  }));
  const delChild=(ssId,childId)=>setLines(l=>l.map(x=>{
    if(x.id!==ssId)return x;
    const children=x.children.filter(c=>c.id!==childId);
    return{...x,children,partNumber:autoPartNumber({...x,children})};
  }));
  // drag child out of subsystem to flat list at a given flat-list index
  const dragChildOut=(ssId,childId,toFlatIdx)=>lockStateRef.current==="mine"&&setLines(prev=>{
    let child=null;
    const next=prev.map(x=>{
      if(x.id!==ssId)return x;
      const children=x.children.filter(c=>{if(c.id===childId){child=c;return false;}return true;});
      return{...x,children,partNumber:autoPartNumber({...x,children})};
    });
    if(!child)return prev;
    const flatItem={...child,rowNum:""};
    const insertAt=Math.max(0,Math.min(toFlatIdx,next.length));
    next.splice(insertAt,0,flatItem);
    return assignRowNums(next);
  });
  const reorderChildren=(ssId,fromCi,toCi)=>lockStateRef.current==="mine"&&setLines(prev=>prev.map(x=>{
    if(x.id!==ssId)return x;
    const ch=[...x.children];
    const[m]=ch.splice(fromCi,1);
    ch.splice(toCi,0,m);
    return{...x,children:ch};
  }));
  // child drag within subsystem
  const ssChildDragItem=useRef(null);
  const ssChildDragOver=useRef(null);
  const F=k=>e=>setFields(f=>({...f,[k]:e.target.value}));

  const [validationModal,setValidationModal]=useState("");  // "" = hidden, else message string
  const [editingLineId,setEditingLineId]=useState(null);
  const [editingRowNum,setEditingRowNum]=useState(null); // id of line whose rowNum is being edited
  // Manual row numbers. An empty box, or the number the row would get automatically,
  // means "no manual number" — so it keeps renumbering when rows move.
  // "↺ auto" fires on mouse-down (before the box loses focus) and sets rowNumResetRef,
  // so the box's own blur can't save the old manual number back right after the reset.
  const rowNumResetRef=useRef(null);
  const setRowNumOverride=(id,val)=>{
    if(rowNumResetRef.current===id){rowNumResetRef.current=null;return;}
    setLines(l=>assignRowNums(l.map(x=>{if(x.id!==id)return x;const v=String(val??"").trim();return{...x,rowNumOverride:v&&v!==String(x.rowNumAuto)?v:null};})));
  };
  const resetRowNum=id=>{rowNumResetRef.current=id;setLines(l=>assignRowNums(l.map(x=>x.id===id?{...x,rowNumOverride:null}:x)));setEditingRowNum(null);setTimeout(()=>{if(rowNumResetRef.current===id)rowNumResetRef.current=null;},0);};

  const validate=()=>{
    if(!fields.projectName.trim()){setValidationModal("Please add a project name before continuing.");return false;}
    if(!fields.engineerName.trim()){setValidationModal("Please add a Pre-Sales Engineer name before continuing.");return false;}
    return true;
  };

  const [submitting,setSubmitting]=useState(false);
  const [savingDraft,setSavingDraft]=useState(false);

  const handleSubmit=async()=>{
    if(readOnly||!validate()||submitting)return;
    clearTimeout(autoSaveTimer.current); // cancel any pending debounced autosave — it could otherwise
    setSubmitting(true);                 // race with this submit (duplicate project, or a stale draft
    try{                                 // resurrected right after submitRevision clears it).
      const rev=buildRevData();let pid=projectIdRef.current;
      if(!pid){
        const np={id:uid(),projectName:fields.projectName,client:fields.client,engineerName:fields.engineerName,refNumber:fields.refNumber,systemType:fields.systemType,ownedBy:isAdmin(user)?null:user.username,grantedTo:[],status:"draft",createdAt:now()};
        const cr=await createProject(np);
        if(!cr.ok){flash("Could not reach the server — nothing was submitted. Check your connection and try again.","err");return;}
        pid=cr.id;projectIdRef.current=pid;
      }else{
        const ur=await updateProject({id:pid,projectName:fields.projectName,client:fields.client,engineerName:fields.engineerName,refNumber:fields.refNumber,systemType:fields.systemType,ownedBy:project?.ownedBy||(isAdmin(user)?null:user.username),grantedTo:project?.grantedTo||[]});
        if(ur.lockLost){loseLock(ur.lock);flash("Not submitted — you no longer hold the edit lock for this project.","err");return;}
        if(!ur.ok){flash("Could not reach the server — nothing was submitted. Check your connection and try again.","err");return;}
      }
      const sr=await submitRevision(pid,rev);
      if(sr.lockLost){loseLock(sr.lock);flash("Not submitted — you no longer hold the edit lock for this project.","err");return;}
      if(!sr.ok){flash("Could not reach the server — revision was not submitted. Check your connection and try again.","err");return;}
      flash(`Submitted as Rev-${project?.revisions?.length||0}.`);
      setTimeout(()=>goBack(),800);
    } finally { setSubmitting(false); }
  };

  const handleSaveDraft=async()=>{
    if(readOnly||!validate()||savingDraft)return;
    clearTimeout(autoSaveTimer.current); // cancel any pending debounced autosave — same race as handleSubmit
    setSavingDraft(true);setASS("Saving…");
    try{
      let pid=projectIdRef.current;
      if(!pid){
        const np={id:uid(),projectName:fields.projectName,client:fields.client,engineerName:fields.engineerName,refNumber:fields.refNumber,systemType:fields.systemType,ownedBy:isAdmin(user)?null:user.username,grantedTo:[],status:"draft",createdAt:now()};
        const cr=await createProject(np);
        if(!cr.ok){setASS("");flash("Could not reach the server — draft was not saved. Check your connection and try again.","err");return;}
        pid=cr.id;projectIdRef.current=pid;
      }else{
        const ur=await updateProject({id:pid,projectName:fields.projectName,client:fields.client,engineerName:fields.engineerName,refNumber:fields.refNumber,systemType:fields.systemType,ownedBy:project?.ownedBy||(isAdmin(user)?null:user.username),grantedTo:project?.grantedTo||[]});
        if(ur.lockLost){setASS("");loseLock(ur.lock);flash("Not saved — you no longer hold the edit lock for this project.","err");return;}
        if(!ur.ok){setASS("");flash("Could not reach the server — draft was not saved. Check your connection and try again.","err");return;}
      }
      const sr=await saveDraft(pid,buildRevData(),user.username||user.displayName);
      if(sr.lockLost){setASS("");loseLock(sr.lock);flash("Not saved — you no longer hold the edit lock for this project.","err");return;}
      if(!sr.ok){setASS("");flash("Could not reach the server — draft was not saved. Check your connection and try again.","err");return;}
      setASS("Draft saved ✓");setTimeout(()=>setASS(""),2500);
      flash("Draft saved successfully.");
    } finally { setSavingDraft(false); }
  };

  return(<div>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
      <button style={C.btnS} onClick={goBack}>← Back</button>
      <button style={C.btnS} disabled={readOnly||!canUndo} onClick={undo} title="Undo">↩ Undo</button>
      <button style={C.btnS} disabled={readOnly||!canRedo} onClick={redo} title="Redo">↪ Redo</button>
      <h2 style={{margin:0,fontSize:15,fontWeight:600}}>{isNew?"New Project":`${readOnly?"View":"Edit"}: ${project.projectName}`}</h2>
      {autoSaveStatus&&<span style={{fontSize:12,color:"#ea580c"}}>{autoSaveStatus}</span>}
      {msg.t&&<span style={msg.tp==="err"?C.err:C.ok}>{msg.t}</span>}
    </div>

    {/* Edit-lock banner */}
    {readOnly&&(()=>{
      const who=lockInfo?.username, at=lockInfo?.since?new Date(lockInfo.since).toLocaleString():"";
      const box={display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",padding:"10px 14px",borderRadius:6,marginBottom:10,fontSize:13};
      if(lockState==="checking")return<div style={{...box,background:"#f4f4f4",color:"#666"}}>Checking whether someone else has this project open…</div>;
      if(lockState==="offline")return<div style={{...box,background:"#fef2f2",border:"1px solid #fecaca",color:"#b91c1c"}}>Couldn't reach the server, so this project is open read-only.<button style={C.btnS} onClick={()=>onReopen&&onReopen(false,projectIdRef.current)}>Try again</button></div>;
      if(lockState==="other")return<div style={{...box,background:"#fff7ed",border:"1px solid #fed7aa",color:"#9a3412"}}>
        <span>🔒 <strong>Read-only</strong> — <strong>{who}</strong> is editing this project{at&&<> (since {at})</>}. You can view and export it, but not change it.</span>
        <span style={{marginLeft:"auto",display:"flex",gap:8}}>
          <button style={C.btnS} onClick={()=>onReopen&&onReopen(false,projectIdRef.current)}>Try again</button>
          {isAdmin(user)&&<button style={C.btnD} onClick={()=>{if(window.confirm(`Take over editing from ${who}? Their draft is kept, but they can no longer save.`))onReopen&&onReopen(true,projectIdRef.current);}}>Take over</button>}
        </span>
      </div>;
      return<div style={{...box,background:"#fef2f2",border:"1px solid #fecaca",color:"#b91c1c"}}>
        <span>⚠ <strong>Editing stopped</strong> — {who?<><strong>{who}</strong> took over this project.</>:<>an admin discarded this draft or took over the project.</>} Changes made after the last "Draft saved ✓" were not saved.</span>
        <button style={{...C.btnS,marginLeft:"auto"}} onClick={()=>onReopen&&onReopen(false,projectIdRef.current)}>Reopen</button>
      </div>;
    })()}

    {/* While read-only every input and button below is disabled */}
    <fieldset disabled={readOnly} style={{border:0,padding:0,margin:0,minWidth:0}}>

    {/* Details */}
    <div style={{...C.card,marginBottom:10}}>
      <p style={C.sT}>Project details</p>
      <div style={{...C.row,marginBottom:7}}>
        <div style={C.f1}><label style={C.label}>Project name *</label><input style={C.input} value={fields.projectName} onChange={F("projectName")}/></div>
        <div style={C.f1}><label style={C.label}>Client / Company</label><input style={C.input} value={fields.client} onChange={F("client")}/></div>
        <div style={C.f1}><label style={C.label}>Date</label><input style={C.input} type="date" value={fields.date} onChange={F("date")}/></div>
      </div>
      <div style={{...C.row,marginBottom:7}}>
        <div style={C.f1}><label style={C.label}>Ref #</label><input style={C.input} value={fields.refNumber} onChange={F("refNumber")} placeholder="e.g. 152"/></div>
        <div style={C.f1}><label style={C.label}>System type</label><input style={C.input} value={fields.systemType} onChange={F("systemType")} placeholder="e.g. FA, PA"/></div>
      </div>
      <p style={C.sT}>Personnel</p>
      <div style={{...C.row,marginBottom:7}}>
        <div style={C.f1}><label style={C.label}>Pre-Sales Engineer *</label><input style={{...C.input,background:!isAdmin(user)&&!isNew&&!isSharedProject?"#e8e8e8":"#f8f8f8"}} value={fields.engineerName} onChange={F("engineerName")} readOnly={!isAdmin(user)&&!isNew&&!isSharedProject}/></div>
        <div style={C.f1}><label style={C.label}>Sales Engineer</label><input style={C.input} value={fields.salesEngineer} onChange={F("salesEngineer")}/></div>
      </div>
      <p style={C.sT}>Client contact</p>
      <div style={C.row}>
        <div style={C.f1}><label style={C.label}>Contact name</label><input style={C.input} value={fields.contactName} onChange={F("contactName")}/></div>
        <div style={C.f1}><label style={C.label}>Contact phone</label><input style={C.input} value={fields.contactPhone} onChange={F("contactPhone")}/></div>
        <div style={C.f1}><label style={C.label}>Contact email</label><input style={C.input} value={fields.contactEmail} onChange={F("contactEmail")}/></div>
      </div>
      <div style={{marginTop:10,background:"#f4f4f4",borderRadius:"6px",padding:"6px 10px",fontSize:12,color:"#666"}}>Code: <strong style={{color:"#222",fontFamily:"monospace"}}>{autoCode()}</strong></div>
    </div>

    {/* Currency */}
    <div style={{...C.card,marginBottom:10}}>
      <p style={C.sT}>Currency & rounding</p>
      <div style={{...C.row,alignItems:"flex-end"}}>
        <div style={C.f1}><label style={C.label}>Currency</label><select style={C.input} value={fields.currency} onChange={F("currency")}>{["USD","EGP","EUR","GBP","SAR","AED"].map(c=><option key={c}>{c}</option>)}</select></div>
        <div style={C.f1}><label style={C.label}>Rate (1 USD = ? {fields.currency})</label><input style={C.input} type="number" step="0.01" value={fields.conversionRate} onChange={F("conversionRate")} disabled={fields.currency==="USD"}/></div>
        <div style={{display:"flex",alignItems:"center",gap:7,paddingBottom:2}}><input type="checkbox" id="ru" checked={roundUp} onChange={e=>setRoundUp(e.target.checked)}/><label htmlFor="ru" style={{fontSize:13,cursor:"pointer"}}>Round up to whole number</label></div>
      </div>
    </div>

    {/* Brand factors — only current brands */}
    <div style={{...C.card,marginBottom:10}}>
      <p style={C.sT}>Brand factors for this project</p>
      {allBrands.length===0&&<p style={{fontSize:13,color:"#888"}}>Add items to see brands.</p>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:8}}>
        {allBrands.map(brand=>{const eff=factorSum.brands[brand];return<div key={brand}><label style={C.label}>{brand} <span style={{color:"#aaa"}}>×{(settings.defaultBrandFactors[brand]??1).toFixed(2)} default</span></label><input style={C.input} type="number" step="0.01" min="0" value={brandFactors[brand]??1} onChange={e=>setBF(bf=>({...bf,[brand]:parseFloat(e.target.value)||0}))}/>{eff?.custom&&<p style={{margin:"3px 0 0",fontSize:11,color:"#1d4ed8"}} title="Σ(GLP × qty × factor) ÷ Σ(GLP × qty), including items with a custom factor">effective ×{fmtFactor(eff.factor)} <span style={{color:"#888"}}>(custom item factors)</span></p>}</div>;})}
      </div>
      <div style={{marginTop:9,maxWidth:200}}><label style={C.label}>Local factor</label><input style={C.input} type="number" step="0.01" value={localFactor} onChange={e=>{const v=parseFloat(e.target.value);if(!isNaN(v)&&v!==settings.defaultLocalFactor&&!warnLocal)setWarnLocal(true);setLF(isNaN(v)?1:v);}}/>{warnLocal&&<p style={{fontSize:12,color:"#ea580c",marginTop:3}}>⚠️ Changed from default</p>}{factorSum.local.custom&&<p style={{margin:"3px 0 0",fontSize:11,color:"#1d4ed8"}}>effective ×{fmtFactor(factorSum.local.factor)} <span style={{color:"#888"}}>(custom item factors)</span></p>}</div>
      {allBrands.length>0&&<p style={{margin:"8px 0 0",fontSize:11,color:"#888"}}>Items without a custom factor use these. Press <strong>ƒ Factor</strong> on a row to give that one item its own brand and local factor.</p>}
    </div>

    {/* Line items */}
    <div style={{...C.card,marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <p style={{...C.sT,margin:0}}>Line items</p>
        {selectedIds.size>0&&<div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:12,color:"#666"}}>{selectedIds.size} selected</span>
          <button style={C.btnP} onClick={()=>{setPasteAction("copy");setCopyTarget("end");setCopyModalOpen(true);}}>📋 Copy Selected ({selectedIds.size})</button>
          <button style={{...C.btnS,borderColor:"#c0392b",color:"#c0392b"}} onClick={()=>{setPasteAction("cut");setCopyTarget("end");setCopyModalOpen(true);}}>✂️ Cut Selected ({selectedIds.size})</button>
          <button style={C.btnS} onClick={clearSelection}>Clear</button>
        </div>}
      </div>
      {lines.length>0&&<div style={{overflowX:"auto",marginBottom:10}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead style={{background:"#f4f4f4"}}><tr>
          <th style={{...C.th,width:30,textAlign:"center"}}>
            <input type="checkbox"
              checked={lines.length>0&&lines.every(l=>selectedIds.has(l.id))}
              onChange={e=>setSelectedIds(e.target.checked?new Set(lines.map(l=>l.id)):new Set())}
              title="Select all"/>
          </th>
          <th style={{...C.th,width:50}}>#</th>
          <th style={{...C.th,width:50}}></th>
          <th style={C.th}>Model</th>
          <th style={C.th}>Brand</th>
          <th style={C.th}>Description</th>
          <th style={C.th}>Note</th>
          <th style={{...C.th,textAlign:"right"}}>GLP Unit</th>
          <th style={{...C.th,textAlign:"right"}}>Local Unit</th>
          <th style={{...C.th,textAlign:"right"}}>Unit Price</th>
          <th style={{...C.th,textAlign:"center",width:65}}>Qty</th>
          <th style={{...C.th,textAlign:"right"}}>Total {curr}</th>
          <th style={C.th}></th>
        </tr></thead>
        <tbody>{lines.map((line,idx)=>{
          // ── Subsystem row ───────────────────────────────────────────────
          if(line.type==="subsystem"){
            const ssGrp=line.mergeGroup;
            const ssPrevLine=lines[idx-1];
            const ssIsFirstInGroup=ssGrp&&!(ssPrevLine?.mergeGroup===ssGrp);
            const ssIsSubEntry=ssGrp&&!ssIsFirstInGroup;
            const ssCanMerge=!ssGrp&&idx>0&&ssPrevLine&&ssPrevLine.type!=="section";
            const ssCanUnmerge=!!ssGrp;
            let ssIsLastInGroup=false;
            if(ssGrp){const nextL=lines[idx+1];ssIsLastInGroup=!(nextL?.mergeGroup===ssGrp);}
            const ssIsContStart=!!ssGrp&&!ssIsFirstInGroup&&ssOpen(ssPrevLine);
            let ssGroupSize=1;
            if(ssIsFirstInGroup||ssIsContStart){let j=idx;while(!ssOpen(lines[j])&&j+1<lines.length&&lines[j+1].mergeGroup===ssGrp){ssGroupSize++;j++;}}
            return(<SubsystemRow key={line.id} line={line} idx={idx}
              brandFactors={brandFactors} localFactor={localFactor} rate={rate} roundUp={roundUp} curr={curr}
              setSSCustomFactors={setSSCustomFactors} updChildFactor={updChildFactor} resetRowNum={resetRowNum}
              updSS={updSS} delSS={delSS} dupLine={dupLine} toggleSSCollapse={toggleSSCollapse}
              addChildFromCatalog={addChildFromCatalog} addChildCustom={addChildCustom}
              updChild={updChild} delChild={delChild} dragChildOut={dragChildOut} reorderChildren={reorderChildren}
              onDragStart={onDragStart} onDragEnter={onDragEnter} onDragEnd={onDragEnd} onDragOver={onDragOver}
              ssChildDragItem={ssChildDragItem} ssChildDragOver={ssChildDragOver} dragOver={dragOver}
              priceList={priceList} plBrands={plBrands} fmtN={fmtN} fmtR={fmtR} C={C}
              ssLineUnitDisp={ssLineUnitDisp} ssLineTot={ssLineTot} calcUnitPrice={calcUnitPrice} applyRounding={applyRounding}
              isSubEntry={ssIsSubEntry} isContStart={ssIsContStart} canMerge={ssCanMerge} canUnmerge={ssCanUnmerge} isLastInGroup={ssIsLastInGroup} groupSize={ssGroupSize}
              mergeWithAbove={mergeWithAbove} unmerge={unmerge}
              editingRowNum={editingRowNum} setEditingRowNum={setEditingRowNum} setRowNumOverride={setRowNumOverride}
              saveSubsystemToPriceList={saveSubsystemToPriceList} selectedIds={selectedIds} toggleSelect={toggleSelect}/>);
          }
          if(line.type==="section") return(
            <tr key={line.id}
              draggable
              onDragStart={e=>onDragStart(e,idx)}
              onDragEnter={e=>onDragEnter(e,idx)}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              style={{cursor:"grab"}}>
              <td style={{padding:"5px 8px",background:"#c0392b",textAlign:"center",borderBottom:"2px solid #a93226"}}>
                <input type="checkbox" checked={selectedIds.has(line.id)} onChange={()=>toggleSelect(line.id)}/>
              </td>
              <td colSpan={10} style={{padding:"5px 8px",background:"#c0392b",borderBottom:"2px solid #a93226"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{color:"rgba(255,255,255,0.6)",fontSize:16,userSelect:"none"}}>⠿</span>
                  <input
                    style={{flex:1,background:"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,0.4)",color:"#fff",fontWeight:700,fontSize:13,padding:"2px 4px",outline:"none"}}
                    value={line.label||""}
                    onChange={e=>updLine(line.id,"label",e.target.value)}
                    placeholder="Section name…"
                  />
                  <button style={{...C.btnD,padding:"2px 8px",fontSize:12,background:"rgba(0,0,0,0.2)",border:"1px solid rgba(255,255,255,0.3)",color:"#fff"}} onClick={()=>delLine(line.id)}>×</button>
                  <button style={{...C.btnS,padding:"2px 8px",fontSize:12}} onClick={()=>dupLine(line.id)} title="Duplicate this section">📋 Copy</button>
                </div>
              </td>
            </tr>
          );
          // ── Merge logic ──────────────────────────────────────────────
          const grp=line.mergeGroup;
          const prevLine=lines[idx-1];
          const nextLine=lines[idx+1];
          const isFirstInGroup=grp&&(!(prevLine?.mergeGroup===grp));
          const isLastInGroup=grp&&(!(nextLine?.mergeGroup===grp));
          const isSubEntry=grp&&!isFirstInGroup; // not the first → rowspan handled above
          // count group size for rowspan
          const isContStart=!!grp&&!isFirstInGroup&&ssOpen(prevLine);
          let groupSize=1;
          if(isFirstInGroup||isContStart){let j=idx;while(!ssOpen(lines[j])&&j+1<lines.length&&lines[j+1].mergeGroup===grp){groupSize++;j++;}}
          // can merge with above?
          const canMerge=!grp&&idx>0&&prevLine&&prevLine.type!=="section";
          // can unmerge? only if in a group
          const canUnmerge=!!grp;
          // ── Inline edit state ─────────────────────────────────────────
          const isEditing=editingLineId===line.id;

          if(isEditing){
            return(<tr key={line.id} style={{background:"#fffde7",border:"2px solid #f59e0b"}}>
              <td colSpan={10} style={{padding:"10px 12px"}}>
                <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                  <div style={{flex:2,minWidth:130}}><label style={C.label}>Description</label><textarea style={{...C.input,minHeight:55,resize:"vertical",lineHeight:1.5}} value={line.description} onChange={e=>updLine(line.id,"description",e.target.value)}/></div>
                  <div style={C.f1}><label style={C.label}>Model No</label><textarea style={{...C.input,minHeight:55,resize:"vertical",lineHeight:1.5}} value={line.modelNo||""} onChange={e=>updLine(line.id,"modelNo",e.target.value)}/></div>
                  <div style={C.f1}><label style={C.label}>Brand</label><BrandSelector value={line.brand||""} onChange={v=>updLine(line.id,"brand",v)} allBrands={plBrands}/></div>
                  <div style={C.f1}><label style={C.label}>GLP (USD)</label><input style={C.input} type="number" step="0.01" value={line.glp||0} onChange={e=>{updLine(line.id,"glp",parseFloat(e.target.value)||0);if(!line.isCustom)updLine(line.id,"isCustom",true);}}/></div>
                  <div style={C.f1}><label style={C.label}>Local (USD)</label><input style={C.input} type="number" step="0.01" value={line.local||0} onChange={e=>{updLine(line.id,"local",parseFloat(e.target.value)||0);if(!line.isCustom)updLine(line.id,"isCustom",true);}}/></div>
                </div>
                <div style={{marginBottom:8}}><label style={C.label}>Notes (internal)</label><textarea style={{...C.input,minHeight:40,resize:"vertical"}} value={line.notes||""} onChange={e=>updLine(line.id,"notes",e.target.value)}/></div>
                <div style={{display:"flex",gap:7,alignItems:"center"}}>
                  <button style={C.btnP} onClick={()=>{if(!line.isCustom)setLines(l=>l.map(x=>x.id===line.id?{...x,isCustom:true}:x));setEditingLineId(null);}}>✓ Done</button>
                  <button style={C.btnS} onClick={()=>setEditingLineId(null)}>Cancel</button>
                  {line.isCustom&&<span style={{fontSize:11,color:"#888"}}>Changes won't affect the price list.</span>}
                  {!line.isCustom&&<span style={{fontSize:11,color:"#ea580c"}}>⚠ Editing will convert this to a custom item.</span>}
                </div>
              </td>
            </tr>);
          }

          // ── Normal row render ─────────────────────────────────────────
          // For sub-entries (not first in group), skip the # cell entirely
          return(<tr key={line.id}
          draggable
          onDragStart={e=>onDragStart(e,idx)}
          onDragEnter={e=>onDragEnter(e,idx)}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          style={{background:line.optional?"#fffbf0":line.customFactor?"#eff6ff":isSubEntry?"#fafafa":"#fff",cursor:isSubEntry?"grab":"grab",opacity:line.optional?0.75:1,borderLeft:grp?"3px solid #c0392b":"none"}}>
          <td style={{...C.td,textAlign:"center",verticalAlign:"middle"}}>
            <input type="checkbox" checked={selectedIds.has(line.id)} onChange={()=>toggleSelect(line.id)}/>
          </td>
          {isContStart&&<td style={C.td} rowSpan={groupSize}></td>}
          <td style={{...C.td,cursor:"grab",textAlign:"center",color:"#aaa",fontSize:16,userSelect:"none",verticalAlign:"middle"}} rowSpan={isSubEntry?1:groupSize} title="Drag to reorder">
            ⠿
            {isSubEntry
              ? <div style={{marginTop:2}}>
                  <span style={{fontSize:12,fontWeight:600,color:"#c0392b",opacity:0.55}}>{line.rowNum||prevLine?.rowNum||""}</span>
                  <div style={{fontSize:9,color:"#c0392b",marginTop:2}}>↑ merged</div>
                </div>
              : editingRowNum===line.id
              ? <div style={{marginTop:2}} onClick={e=>e.stopPropagation()}>
                  <input autoFocus style={{...C.input,width:42,padding:"2px 4px",textAlign:"center",fontSize:12}}
                    defaultValue={line.rowNumOverride||line.rowNumAuto||line.rowNum}
                    onBlur={e=>{setRowNumOverride(line.id,e.target.value.trim());setEditingRowNum(null);}}
                    onKeyDown={e=>{if(e.key==="Enter"){setRowNumOverride(line.id,e.target.value.trim());setEditingRowNum(null);}if(e.key==="Escape")setEditingRowNum(null);}}
                  />
                  {line.rowNumOverride&&<div style={{fontSize:9,color:"#c0392b",cursor:"pointer",marginTop:1}} onMouseDown={e=>{e.preventDefault();resetRowNum(line.id);}}>↺ auto</div>}
                </div>
              : <div style={{marginTop:2,cursor:"text"}} onClick={e=>{e.stopPropagation();setEditingRowNum(line.id);}}>
                  <span style={{fontSize:12,fontWeight:600,color:line.rowNumOverride?"#c0392b":"#555",borderBottom:line.rowNumOverride?"1px dashed #c0392b":"1px dashed transparent",padding:"0 2px"}}>{line.rowNum}</span>
                  {grp&&<div style={{fontSize:9,color:"#c0392b",marginTop:2}}>merged</div>}
                </div>
            }
          </td>
          {!isSubEntry? <td></td>: null}
          <td style={{...C.td,whiteSpace:"pre-wrap"}}><code style={{fontSize:11}}>{line.modelNo||"—"}</code>{line.isCustom&&<span style={{...C.badge("gray"),marginLeft:4,fontSize:10}}>custom</span>}</td>
          <td style={C.td}>{line.brand||"—"}</td>
          <td style={{...C.td,whiteSpace:"pre-wrap"}}>{line.description||"—"}</td>
          <td style={{...C.td,fontSize:11,color:"#ea580c",maxWidth:120,whiteSpace:"pre-wrap"}}>{line.notes||""}</td>
          <td style={{...C.td,textAlign:"right",color:"#555"}}>{fmtN(line.glp,false)}</td>
          <td style={{...C.td,textAlign:"right",color:"#555"}}>{fmtN(line.local||0,false)}</td>
          <td style={{...C.td,textAlign:"right"}}>{fmtN(line.optional?applyRounding(calcUnitPrice(line,brandFactors,localFactor),roundUp,rate):lineUnitDisp(line),false)}
            {line.customFactor&&<FactorInputs item={line} brandFactors={brandFactors} localFactor={localFactor} onChange={(f,v)=>updLine(line.id,f,v)}/>}
          </td>
          <td style={{...C.td,textAlign:"center"}}>
            {line.optional
              ? <span style={{fontSize:12,color:"#888",fontStyle:"italic"}}>Optional</span>
              : <input style={{...C.input,width:54,textAlign:"center",padding:"3px 5px"}} type="number" min="1" value={line.qty} onChange={e=>updLine(line.id,"qty",e.target.value)} data-qty-group="top" onFocus={qtyFocus} onKeyDown={qtyEnter}/>
            }
          </td>
          <td style={{...C.td,textAlign:"right"}}>{line.optional?"—":fmtR(lineTotal(line),roundUp,curr)}</td>
          <td style={C.td}>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
    <button style={{...C.btnS,padding:"2px 7px",fontSize:12}} onClick={()=>setEditingLineId(line.id)} title="Edit item">✏️</button>
    <button style={{...C.btnD,padding:"2px 7px",fontSize:12}} onClick={()=>delLine(line.id)}>×</button>
    <button style={{...C.btnS,padding:"2px 7px",fontSize:12}} onClick={()=>dupLine(line.id)} title="Duplicate this item">📋 Copy</button>
    {canMerge&&<button style={{...C.btnS,padding:"2px 4px",fontSize:10,whiteSpace:"nowrap",color:"#c0392b",borderColor:"#c0392b"}} onClick={()=>mergeWithAbove(line.id)} title="Merge with row above">⤴ Merge</button>}
    {canUnmerge&&isLastInGroup&&<button style={{...C.btnS,padding:"2px 4px",fontSize:10,whiteSpace:"nowrap"}} onClick={()=>unmerge(line.id)} title="Unmerge this row">⊠ Unmerge</button>}
    <label style={{display:"flex",alignItems:"center",gap:3,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>
      <input type="checkbox" checked={!!line.optional} onChange={e=>updLine(line.id,"optional",e.target.checked)}/>
      Opt.
    </label>
    {line.isCustom&&<button style={{...C.btnS,padding:"2px 4px",fontSize:10,whiteSpace:"nowrap"}} onClick={()=>saveLineToPriceList(line)} title="Save to price list">💾</button>}
    {line.customFactor
      ?<button style={{...C.btnS,...factorBtn,background:"#dbeafe"}} onClick={()=>setCustomFactor(line.id,false)} title="Cancel the custom factor — this item goes back to the project's brand and local factor">✕ Factor</button>
      :<button style={{...C.btnS,...factorBtn}} onClick={()=>setCustomFactor(line.id,true)} title="Give this item its own brand and local factor">ƒ Factor</button>}
  </div>
</td>
        </tr>);})}</tbody>
      </table></div>}

      {solNavPending&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500}}>
        <div style={{...C.card,width:400}}>
          <p style={{margin:"0 0 6px",fontWeight:600,fontSize:15}}>Import from Solution Navigator</p>
          <p style={{margin:"0 0 16px",fontSize:13,color:"#666"}}>Found {solNavPending.result.children.length} item(s) in {solNavPending.fileName}. How should these be added?</p>
          <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>
            <button style={{...C.btnP,padding:"11px",fontSize:14,textAlign:"left"}} onClick={confirmSolNavAsSubsystem}>⊞ As a subsystem <span style={{fontWeight:400,fontSize:12,opacity:0.85}}>— grouped together as one line with these as its children</span></button>
            <button style={{...C.btnS,padding:"11px",fontSize:14,textAlign:"left"}} onClick={confirmSolNavAsItems}>≣ As normal items <span style={{fontWeight:400,fontSize:12,color:"#888"}}>— each added as its own separate line</span></button>
          </div>
          <div style={{display:"flex",justifyContent:"flex-end"}}><button style={C.btnS} onClick={()=>setSolNavPending(null)}>Cancel</button></div>
        </div>
      </div>}

      {copyModalOpen&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500}}>
        <div style={{...C.card,width:420}}>
          <p style={{margin:"0 0 14px",fontWeight:600,fontSize:15}}>{pasteAction==="cut"?"Move":"Copy"} {selectedIds.size} selected line{selectedIds.size===1?"":"s"} to…</p>
          <div style={{marginBottom:14}}>
            <label style={C.label}>{pasteAction==="cut"?"Move to":"Insert copies"}</label>
            <select style={C.input} value={copyTarget} onChange={e=>setCopyTarget(e.target.value)}>
              <option value="start">— At the very beginning —</option>
              {lines.map((l,i)=>({l,i})).filter(({l})=>pasteAction!=="cut"||!selectedIds.has(l.id)).map(({l,i})=>(
                <option key={l.id} value={l.id}>
                  After #{i+1}: {l.type==="section"?`[Section] ${l.label||""}`:l.type==="subsystem"?`[Subsystem] ${l.description||""}`:(l.description||l.modelNo||"item")}
                </option>
              ))}
              <option value="end">— At the very end —</option>
            </select>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button style={C.btnS} onClick={()=>setCopyModalOpen(false)}>Cancel</button>
            <button style={C.btnP} onClick={()=>pasteAction==="cut"?cutSelectedTo(copyTarget):copySelectedTo(copyTarget)}>{pasteAction==="cut"?"✂️ Cut":"📋 Copy"}</button>
          </div>
        </div>
      </div>}

      {addMode===null&&<div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button style={C.btnS} onClick={()=>setAddMode("catalog")}>+ From price list</button><button style={C.btnS} onClick={()=>setAddMode("custom")}>+ Custom item</button><button style={{...C.btnS,borderColor:"#c0392b",color:"#c0392b"}} onClick={addSection}>+ Add section</button><button style={{...C.btnS,borderColor:"#7c3aed",color:"#7c3aed"}} onClick={addSubsystem}>⊞ Add subsystem</button><button style={{...C.btnS,borderColor:"#16a34a",color:"#16a34a"}} disabled={solNavLoading} onClick={()=>solNavFileRef.current?.click()}>{solNavLoading?"Importing…":"📥 From Solution Navigator"}</button><input ref={solNavFileRef} type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={onSolNavFile}/></div>}
      {addMode==="catalog"&&<div style={{...C.row,alignItems:"flex-end",marginTop:6}}><ItemSearchDropdown priceList={priceList} onSelect={addFromCatalog}/><button style={C.btnS} onClick={()=>setAddMode(null)}>Cancel</button></div>}
      {addMode==="custom"&&<div style={{marginTop:8}}>
        <div style={C.row}>
          <div style={{flex:2,minWidth:130}}><label style={C.label}>Description</label><textarea style={{...C.input,minHeight:60,resize:"vertical",lineHeight:1.5}} value={customForm.description} onChange={e=>setCF(f=>({...f,description:e.target.value}))}/></div>
          <div style={C.f1}><label style={C.label}>Model No</label><textarea style={{...C.input,minHeight:60,resize:"vertical",lineHeight:1.5}} value={customForm.modelNo} onChange={e=>setCF(f=>({...f,modelNo:e.target.value}))}/></div>
          <div style={C.f1}><label style={C.label}>Brand</label><BrandSelector value={customForm.brand} onChange={v=>setCF(f=>({...f,brand:v}))} allBrands={plBrands}/></div>
          <div style={C.f1}><label style={C.label}>GLP (USD)</label><input style={C.input} type="number" step="0.01" value={customForm.glp} onChange={e=>setCF(f=>({...f,glp:e.target.value}))}/></div>
          <div style={C.f1}><label style={C.label}>Local (USD)</label><input style={C.input} type="number" step="0.01" value={customForm.local} onChange={e=>setCF(f=>({...f,local:e.target.value}))}/></div>
        </div>
        <div style={{marginTop:6,marginBottom:8}}><label style={C.label}>Notes (internal)</label><textarea style={{...C.input,minHeight:50,resize:"vertical",lineHeight:1.5}} value={customForm.notes} onChange={e=>setCF(f=>({...f,notes:e.target.value}))} placeholder="Internal note…"/></div>
        <div style={{display:"flex",gap:8}}><button style={C.btnP} onClick={addCustom}>Add to quotation</button><button style={C.btnS} onClick={()=>setAddMode(null)}>Cancel</button></div>
      </div>}
    </div>

    {/* Totals */}
    <div style={{...C.card,marginBottom:10}}>
      <p style={C.sT}>Totals</p>
      <div style={{display:"flex",justifyContent:"flex-end"}}><div style={{minWidth:340}}>
        <div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #eee"}}><span style={{fontSize:13}}>Supply subtotal</span><span style={{fontSize:13,fontWeight:500}}>{fmtR(supplyTotal,roundUp,curr)}</span></div>
        {/* T&C */}
        <div style={{padding:"6px 0",borderBottom:"1px solid #eee"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:tcEnabled&&tcMode==="percent"?6:0}}>
            <input type="checkbox" id="tc" checked={tcEnabled} onChange={e=>setTcEnabled(e.target.checked)}/>
            <label htmlFor="tc" style={{fontSize:13,fontWeight:500,cursor:"pointer"}}>T&C</label>
            {tcEnabled&&<select style={{...C.input,width:100,padding:"3px 6px",fontSize:12}} value={tcMode} onChange={e=>setTcMode(e.target.value)}><option value="value">By value</option><option value="percent">By %</option></select>}
            {tcEnabled&&tcMode==="value"&&<input style={{...C.input,width:100,textAlign:"right"}} type="number" step="0.01" value={tcValue} onChange={e=>setTcValue(e.target.value)} placeholder="USD"/>}
            {tcEnabled&&<span style={{fontSize:13,marginLeft:"auto",fontWeight:500}}>{fmtR(tcDisp,roundUp,curr)}</span>}
          </div>
          {tcEnabled&&tcMode==="percent"&&<div style={{...C.row,paddingLeft:22,alignItems:"flex-end",gap:8}}>
            <div style={C.f1}><label style={C.label}>% of supply</label><input style={C.input} type="number" step="0.1" min="0" max="100" value={tcPercent} onChange={e=>setTcPercent(e.target.value)} placeholder="e.g. 15"/></div>
            <div style={C.f1}><label style={C.label}>Round up to nearest</label><input style={C.input} type="text" value={tcApprox} onChange={e=>setTcApprox(e.target.value)} placeholder="e.g. 50 or 100"/></div>
            <div style={{paddingBottom:2,fontSize:12,color:"#888",whiteSpace:"nowrap"}}>Raw: {fmtN(supplyUSD*((parseFloat(tcPercent)||0)/100),false)} USD</div>
          </div>}
        </div>
        {/* Installation */}
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #eee"}}>
          <input type="checkbox" id="inst" checked={installEnabled} onChange={e=>setInstE(e.target.checked)}/>
          <label htmlFor="inst" style={{fontSize:13,cursor:"pointer",flex:1}}>Installation</label>
          {installEnabled&&<input style={{...C.input,width:100,textAlign:"right"}} type="number" step="0.01" value={installValue} onChange={e=>setInstV(e.target.value)} placeholder="USD"/>}
          {installEnabled&&<span style={{fontSize:13,minWidth:90,textAlign:"right"}}>{fmtR(installDisp,roundUp,curr)}</span>}
        </div>
        {/* Extras */}
        {extrasDisp.map((ex,i)=><div key={ex.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #eee"}}>
          <input style={{...C.input,flex:1}} value={ex.label} onChange={e=>setExtras(es=>es.map((x,j)=>j===i?{...x,label:e.target.value}:x))} placeholder="Label"/>
          <input style={{...C.input,width:100,textAlign:"right"}} type="number" step="0.01" value={ex.value} onChange={e=>setExtras(es=>es.map((x,j)=>j===i?{...x,value:e.target.value}:x))} placeholder="USD"/>
          <span style={{fontSize:13,minWidth:90,textAlign:"right"}}>{fmtR(ex.disp,roundUp,curr)}</span>
          <button style={{...C.btnD,padding:"2px 7px",fontSize:12}} onClick={()=>setExtras(es=>es.filter((_,j)=>j!==i))}>×</button>
        </div>)}
        <div style={{padding:"4px 0"}}><button style={{...C.btnS,fontSize:12,padding:"3px 9px"}} onClick={()=>setExtras(es=>[...es,{id:uid(),label:"",value:""}])}>+ Add line</button></div>
        <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderTop:"2px solid #ddd",marginTop:3}}>
          <span style={{fontSize:14,fontWeight:600}}>Grand total</span>
          <span style={{fontSize:16,fontWeight:700,color:"#c0392b"}}>{fmtR(grandTotal,roundUp,curr)}</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderTop:"1px solid #eee",marginTop:3}}>
          <input type="checkbox" id="gtad" checked={gtAfterDiscountEnabled} onChange={e=>setGtAfterDiscountEnabled(e.target.checked)}/>
          <label htmlFor="gtad" style={{fontSize:13,cursor:"pointer",flex:1}}>Grand total after discount <em style={{color:"#999",fontWeight:400}}>(display only — not used in calculations)</em></label>
          {gtAfterDiscountEnabled&&<input style={{...C.input,width:140,textAlign:"right"}} value={gtAfterDiscount} onChange={e=>setGtAfterDiscount(e.target.value)} placeholder={`e.g. ${fmtR(grandTotal,roundUp,curr)}`}/>}
        </div>
      </div></div>
      <div style={{marginTop:8}}><label style={C.label}>Notes</label><textarea style={{...C.input,minHeight:70,resize:"vertical"}} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Additional notes…"/></div>
    </div>

    {/* Brand summary — internal */}
    {lines.length>0&&(()=>{
      // Factor = effective factor from Σ(GLP × qty × factor) = GLP_total × Factor_total.
      // "After factor" is converted to the project currency (and rounded up if that is on).
      const bMap={};
      Object.entries(factorSum.brands).forEach(([b,v])=>{bMap[b]={...v,factored:conv(v.factored)};});
      const totalLocalRaw=factorSum.local.raw;
      const totalLocalFactored=conv(factorSum.local.factored);
      const tGLP=Object.values(bMap).reduce((s,v)=>s+v.glp,0);
      const tFactored=Object.values(bMap).reduce((s,v)=>s+v.factored,0)+totalLocalFactored;
      return(
        <div style={{...C.card,marginBottom:10,borderLeft:"3px solid #aaa"}}>
          <p style={{...C.sT,marginTop:0}}>Brand summary <span style={{fontSize:11,color:"#888",fontWeight:400,marginLeft:8}}>internal reference only</span></p>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead style={{background:"#f4f4f4"}}><tr>
              <th style={C.th}>Brand / Source</th>
              <th style={{...C.th,textAlign:"right"}}>Total GLP (USD)</th>
              <th style={{...C.th,textAlign:"center"}}>Factor</th>
              <th style={{...C.th,textAlign:"right"}}>After Factor ({curr})</th>
            </tr></thead>
            <tbody>
              {Object.entries(bMap).map(([b,v])=>(
                <tr key={b} style={{background:"#fff"}}>
                  <td style={C.td}><strong>{b}</strong></td>
                  <td style={{...C.td,textAlign:"right"}}>{fmtN(v.glp,false)}</td>
                  <td style={{...C.td,textAlign:"center"}} title={v.custom?"Effective factor: Σ(GLP × qty × factor) ÷ Σ(GLP × qty) — includes custom item factors":undefined}>×{fmtFactor(v.factor)}{v.custom&&<span style={{color:"#1d4ed8"}}> ★</span>}</td>
                  <td style={{...C.td,textAlign:"right",fontWeight:500}}>{fmtN(v.factored,roundUp)}</td>
                </tr>
              ))}
              {totalLocalRaw>0&&(
                <tr style={{background:"#f0f7ff"}}>
                  <td style={{...C.td,fontStyle:"italic"}}>Local</td>
                  <td style={{...C.td,textAlign:"right"}}>{fmtN(totalLocalRaw,false)}</td>
                  <td style={{...C.td,textAlign:"center"}}>×{fmtFactor(factorSum.local.factor)}{factorSum.local.custom&&<span style={{color:"#1d4ed8"}}> ★</span>}</td>
                  <td style={{...C.td,textAlign:"right",fontWeight:500}}>{fmtN(totalLocalFactored,roundUp)}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{background:"#f4f4f4",fontWeight:600}}>
                <td style={C.td}>Total</td>
                <td style={{...C.td,textAlign:"right"}}>{fmtN(tGLP,false)}</td>
                <td style={C.td}></td>
                <td style={{...C.td,textAlign:"right"}}>{fmtN(tFactored,roundUp)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      );
    })()}

    {/* Validation modal */}
    {validationModal&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setValidationModal("")}>
      <div style={{background:"#fff",borderRadius:8,padding:"28px 32px",maxWidth:360,width:"90%",boxShadow:"0 8px 32px rgba(0,0,0,0.18)",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:32,marginBottom:10}}>⚠️</div>
        <p style={{margin:"0 0 20px",fontSize:14,color:"#333",lineHeight:1.5}}>{validationModal}</p>
        <button style={{...C.btnP,padding:"8px 28px"}} onClick={()=>setValidationModal("")}>OK</button>
      </div>
    </div>}

    </fieldset>

    <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginBottom:24}}>
      <button style={C.btnS} onClick={goBack}>Back</button>
      <button style={{...C.btnS,borderColor:"#2563eb",color:"#2563eb",opacity:savingDraft||readOnly?0.6:1}} onClick={handleSaveDraft} disabled={readOnly||savingDraft||submitting}>💾 {savingDraft?"Saving…":"Save draft"}</button>
      <button style={{...C.btnP,opacity:submitting||readOnly?0.6:1}} onClick={handleSubmit} disabled={readOnly||savingDraft||submitting}>{submitting?"Submitting…":"Submit revision"}</button>
    </div>
  </div>);
}

// ─── Projects Tab ─────────────────────────────────────────────────────────────
function ProjectsTab({user,settings}){
  const [projects,setProjects]=useState([]),[priceList,setPriceList]=useState([]),[editing,setEditing]=useState(null),[viewRev,setViewRev]=useState(null),[printTarget,setPrintTarget]=useState(null),[grantModal,setGrantModal]=useState(null),[grantUser,setGrantUser]=useState(""),[unlockConfirm,setUnlockConfirm]=useState(null),[loading,setLoading]=useState(true),[search,setSearch]=useState("");
  const [dupModal,setDupModal]=useState(null); // the source project being duplicated
  const [dupFields,setDupFields]=useState({projectName:"",client:"",refNumber:"",systemType:""});
  const [dupErr,setDupErr]=useState("");
  const [dupBusy,setDupBusy]=useState(false);
  const reload=async()=>{setLoading(true);const[p,pl]=await Promise.all([loadProjects(),loadPriceList()]);setProjects(p);setPriceList(pl);setLoading(false);};
  useEffect(()=>{reload();},[]);
  const isAdminUser=isAdmin(user);
  const visible=projects.filter(p=>{
    if(!isAdminUser&&p.ownedBy!==user.username&&!(p.grantedTo||[]).includes(user.username))return false;
    if(!search.trim())return true;
    const q=search.toLowerCase();
    return(p.projectName||"").toLowerCase().includes(q)||(p.client||"").toLowerCase().includes(q)||(p.engineerName||"").toLowerCase().includes(q)||(p.refNumber||"").toLowerCase().includes(q);
  });
  const canEdit=p=>isAdminUser||p.ownedBy===user.username||(p.grantedTo||[]).includes(user.username);
  const doGrant=async()=>{if(!grantUser.trim())return;const uL=grantUser.toLowerCase().trim();const users=await loadUsers();if(!users.find(u=>u.username.toLowerCase()===uL)){alert("User not found.");return;}const r=await grantAccess(grantModal.id,uL);if(!r.ok){alert("Could not reach the server — access was not granted. Check your connection and try again.");return;}reload();setGrantModal(null);setGrantUser("");};
  const doRevoke=async(projId,username)=>{const r=await revokeAccess(projId,username);if(!r.ok){alert("Could not reach the server — access was not revoked.");return;}reload();};
  const doDelete=async id=>{if(!window.confirm("Delete project and all revisions?"))return;const r=await deleteProject(id);if(!r.ok){alert("Could not reach the server — project was not deleted.");return;}reload();};
  // Admin "Discard draft": deletes the unsubmitted draft and frees the edit lock (cannot be undone).
  const doDiscardDraft=async projId=>{const r=await clearDraft(projId);if(!r.ok){alert("Could not reach the server — draft was not discarded.");return;}reload();setUnlockConfirm(null);};
  // Opening the editor. takeover:true = admin takes the edit lock from whoever holds it.
  // The editor is re-mounted (editKey) with freshly loaded data whenever it is reopened.
  const [editTakeover,setEditTakeover]=useState(false),[editKey,setEditKey]=useState(0);
  const openEditor=(proj,takeover=false)=>{setEditTakeover(!!takeover);setEditKey(k=>k+1);setEditing(proj);};
  const reopenEditor=async(takeover,projId)=>{
    const fresh=await loadProjects();setProjects(fresh);
    const p=fresh.find(x=>x.id===(projId||editing?.id));
    if(p)openEditor(p,takeover);else{setEditing(null);reload();}
  };

  const openDuplicate=proj=>{
    setDupModal(proj);
    setDupFields({projectName:`${proj.projectName} (Copy)`,client:proj.client||"",refNumber:proj.refNumber||"",systemType:proj.systemType||""});
    setDupErr("");
  };
  // Duplicates a project's latest content (draft if it has one, else its most
  // recent submitted revision) into a brand-new project — fresh id, status
  // "draft", and an empty revisions list, so its own Rev numbering starts at
  // 0 exactly like any new project. The ref number must differ from the
  // source's, since that's what actually prevents the auto-generated code
  // (#ref-date-systemtype-engineer-Rev-N) from colliding with the original.
  const doDuplicate=async()=>{
    if(!dupModal)return;
    const src=dupModal;
    if(!dupFields.projectName.trim()){setDupErr("Project name is required.");return;}
    if((dupFields.refNumber||"").trim().toLowerCase()===(src.refNumber||"").trim().toLowerCase()){
      setDupErr("Ref number must be different from the original project's ref number.");
      return;
    }
    setDupBusy(true);
    try{
      const latestRev=src.draft||(src.revisions?.length?src.revisions[src.revisions.length-1]:null);
      const seedData=latestRev?JSON.parse(JSON.stringify(latestRev.data||latestRev)):{};
      const engineerName=!isAdminUser?(user.displayName||user.username):(src.engineerName||"");
      const np={id:uid(),projectName:dupFields.projectName.trim(),client:dupFields.client,engineerName,refNumber:dupFields.refNumber,systemType:dupFields.systemType,ownedBy:isAdminUser?null:user.username,grantedTo:[],status:"draft",createdAt:now()};
      const cr=await createProject(np);
      if(!cr.ok){setDupErr("Could not reach the server — duplicate was not created.");setDupBusy(false);return;}
      const draftPayload={...seedData,projectName:np.projectName,client:np.client,refNumber:np.refNumber,systemType:np.systemType,engineerName:np.engineerName,date:new Date().toISOString().slice(0,10)};
      const dr=await saveDraft(cr.id,draftPayload,user.username||user.displayName);
      if(!dr.ok){setDupErr("Could not reach the server — duplicate was created but its content could not be saved.");setDupBusy(false);return;}
      setDupModal(null);setDupBusy(false);
      const updated=await loadProjects();
      const newProj=updated.find(p=>p.id===cr.id)||{...np,draft:{...draftPayload,_savedBy:user.username||user.displayName,_savedAt:now()}};
      setProjects(updated);
      openEditor(newProj);
    }catch(e){setDupErr("Something went wrong — duplicate was not created.");setDupBusy(false);}
  };

  if(editing==="new")return<ProjectEditor key={"new-"+editKey} project={null} user={user} settings={settings} priceList={priceList} onBack={()=>{reload();setEditing(null);}} onReopen={reopenEditor}/>;
  if(editing)return<ProjectEditor key={editing.id+"-"+editKey} project={editing} takeover={editTakeover} user={user} settings={settings} priceList={priceList} onBack={()=>{reload();setEditing(null);}} onReopen={reopenEditor}/>;

  if(viewRev){
    const{project:proj,revIdx}=viewRev;
    const revRaw=proj.revisions[revIdx];
    const rev={...(revRaw.data||{}),...revRaw};
    const curr=rev.currency||"USD",rnd=rev.roundUp,rate=rev.conversionRate||1;
    const lUD=line=>applyRounding(calcUnitPrice(line,rev.brandFactors,rev.localFactor),rnd,rate);
    const lT=line=>line.optional?0:lUD(line)*line.qty;
    const supT=(rev.lines||[]).filter(l=>l.type!=="section").reduce((s,l)=>{if(l.type==="subsystem"){if(l.optional)return s;
    const ssU=applyRounding(ssUnitPrice(l,rev.brandFactors,rev.localFactor),rnd,rate);return s+ssU*(l.qty||1);}return s+lT(l);},0);
    return(<div>
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
        <button style={C.btnS} onClick={()=>setViewRev(null)}>← Back</button>
        <h2 style={{margin:0,fontSize:15,fontWeight:600}}>{proj.projectName} — {rev.code}</h2>
        <button style={{...C.btnP,marginLeft:"auto"}} onClick={()=>setPrintTarget({project:proj,rev})}>📄 Print / Export</button>
      </div>
      {printTarget&&<PrintModal project={printTarget.project} rev={printTarget.rev} settings={settings} onClose={()=>setPrintTarget(null)}/>}
      <div style={{...C.card,marginBottom:10}}><div style={{...C.row,flexWrap:"wrap",gap:16}}>
        {[["Project",proj.projectName],["Client",proj.client],["Pre-Sales",rev.engineerName],["Sales Eng.",rev.salesEngineer],["Contact",rev.contactName],["Phone",rev.contactPhone],["Email",rev.contactEmail],["Date",rev.date],["Currency",curr],["Code",rev.code]].map(([l,v])=>v?<div key={l} style={{minWidth:100}}><p style={{margin:0,fontSize:11,color:"#888"}}>{l}</p><p style={{margin:"1px 0 0",fontSize:13,fontWeight:500}}>{v}</p></div>:null)}
      </div></div>
      <div style={{overflowX:"auto",marginBottom:10}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead style={{background:"#f4f4f4"}}><tr><th colspan="2" style={C.th}>#</th><th style={C.th}>Brand</th><th colspan="3" style={C.th}>Description</th><th style={{...C.th,textAlign:"right"}}>Unit</th><th style={{...C.th,textAlign:"center"}}>Qty</th><th style={{...C.th,textAlign:"right"}}>Total</th></tr></thead>
        <tbody>{(()=>{let n=0;const ls=rev.lines||[];const rows=[];
          const rowsForLine=l=>1;
          ls.forEach((line,idx)=>{
          if(line.type==="section"){rows.push(<tr key={line.id}><td colSpan={9} style={{background:"#c0392b",color:"#fff",fontWeight:700,textAlign:"center",padding:"6px 10px",border:"1px solid #a93226",fontSize:12,letterSpacing:"0.3px"}}>{line.label||"Section"}</td></tr>);return;}
          if(line.type==="subsystem"){
            n++;
            const ssU=applyRounding(ssUnitPrice(line,rev.brandFactors,rev.localFactor),rnd,rate);
            const ssT=ssU*(line.qty||1);
            const ssGrp=line.mergeGroup;
            const ssIsSE=ssGrp&&ls[idx-1]?.mergeGroup===ssGrp;
            let ssRs=rowsForLine(line);if(ssGrp&&!ssIsSE){let j=idx+1;while(j<ls.length&&ls[j].mergeGroup===ssGrp){ssRs+=rowsForLine(ls[j]);j++;}}
            rows.push(<tr key={line.id} style={{background:line.optional?"#fffbf0":"#f5f0ff",color:line.optional?"#888":"inherit"}}>
            {!ssIsSE&&<td style={{...C.td,textAlign:"center",fontWeight:600,verticalAlign:"middle"}} colSpan={ssGrp?2:1} rowSpan={ssRs}>{line.rowNum}</td>}
            {!ssGrp&&<td></td>}
            <td style={{...C.td,fontWeight:600}}>{line.brand||""}</td>
            <td colspan="3" style={{...C.td,fontWeight:600,whiteSpace:"pre-wrap"}}>{line.description} <em style={{fontSize:10,color:"#7c3aed",fontWeight:400}}>(Subsystem ×{line.qty||1}{line.optional?", Optional":""})</em></td>
            <td style={{...C.td,textAlign:"right"}}>{line.optional?<span style={{fontStyle:"italic"}}>{fmtR(applyRounding(ssChildUnitTotal(line,rev.brandFactors,rev.localFactor),rnd,rate),rnd,curr)}</span>:fmtR(ssU,rnd,curr)}</td>
            <td style={{...C.td,textAlign:"center"}}>{line.optional?"—":(line.qty||1)}</td>
            <td style={{...C.td,textAlign:"right",fontWeight:600,color:line.optional?"#888":"#7c3aed"}}>{line.optional?"—":fmtR(ssT,rnd,curr)}</td>
          </tr>);
            return;
          }
          const grp=line.mergeGroup;const isSubEntry=grp&&ls[idx-1]?.mergeGroup===grp;
          if(!isSubEntry)n++;let rs=1;if(grp&&!isSubEntry){let j=idx+1;while(j<ls.length&&ls[j].mergeGroup===grp){rs+=rowsForLine(ls[j]);j++;}}
          rows.push(<tr key={line.id} style={{background:"#fff"}}>
            {!isSubEntry&&<td colspan="2" style={{...C.td,textAlign:"left",verticalAlign:"middle"}} rowSpan={rs}>{line.rowNum}</td>}
            <td style={C.td}>{line.brand}</td>
            <td colspan="3" style={{...C.td,whiteSpace:"pre-wrap"}}>{line.description}</td>
            <td style={{...C.td,textAlign:"right"}}>{fmtR(lUD(line),rnd,curr)}</td>
            <td style={{...C.td,textAlign:"center"}}>{line.qty}</td>
            <td style={{...C.td,textAlign:"right",fontWeight:500}}>{line.optional?"—":fmtR(lT(line),rnd,curr)}</td>
          </tr>);
        });return rows;})()}</tbody>
      </table></div>
      <div style={{display:"flex",justifyContent:"flex-end"}}><div style={{minWidth:280}}>
        {[["Supply subtotal",supT],...(rev.tcEnabled?[["T&C",applyRounding(rev.tcBaseUSD||0,rnd,rate)]]:[]),...(rev.installEnabled?[["Installation",applyRounding(rev.installValue,rnd,rate)]]:[]),...(rev.extras||[]).map(e=>[e.label||"Extra",applyRounding(parseFloat(e.value)||0,rnd,rate)])].map(([l,v])=><div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #eee"}}><span style={{fontSize:13}}>{l}</span><span style={{fontSize:13,fontWeight:500}}>{fmtR(v,rnd,curr)}</span></div>)}
        <div style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderTop:"2px solid #ddd",marginTop:3}}>
          <span style={{fontWeight:600,fontSize:14}}>Grand total</span>
          <span style={rev.gtAfterDiscountEnabled&&rev.gtAfterDiscount?{fontWeight:500,fontSize:14,color:"#888",textDecoration:"line-through"}:{fontWeight:700,fontSize:16,color:"#c0392b"}}>{fmtR(rev.grandTotal,rnd,curr)}</span>
        </div>
        {rev.gtAfterDiscountEnabled&&rev.gtAfterDiscount&&<div style={{display:"flex",justifyContent:"space-between",padding:"7px 0"}}>
          <span style={{fontWeight:600,fontSize:14}}>Grand total after discount</span>
          <span style={{fontWeight:700,fontSize:16,color:"#c0392b"}}>{curr==="USD"?"$":curr}{rev.gtAfterDiscount}</span>
        </div>}
      </div></div>
      {rev.notes&&<div style={{marginTop:10,padding:"8px 12px",background:"#f8f8f8",borderRadius:"6px",fontSize:13,border:"1px solid #eee",whiteSpace:"pre-wrap"}}><strong>Notes:</strong> {rev.notes}</div>}
    </div>);
  }

  return(<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
      <h2 style={{margin:0,fontSize:15,fontWeight:600}}>{isAdminUser?"All Projects":"My Projects"} <span style={{fontWeight:400,color:"#888",fontSize:13}}>({visible.length})</span></h2>
      <button style={C.btnP} onClick={()=>setEditing("new")}>+ New project</button>
    </div>
    <div style={{marginBottom:12}}>
      <input style={{...C.input,maxWidth:360}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by project name, client or engineer…"/>
    </div>
    {loading&&<p style={{color:"#888",fontSize:13}}>Loading…</p>}
    {!loading&&visible.length===0&&<p style={{fontSize:13,color:"#888"}}>No projects yet.</p>}
    {visible.map(proj=>{
      const hasDraft=!!proj.draft,draftBy=draftOwner(proj.draft),draftAt=draftTime(proj.draft);
      const lockBy=proj.lock?.username,lockAt=proj.lock?.since?new Date(proj.lock.since).toLocaleString():"";
      const lockedByOther=!!lockBy&&lockBy.toLowerCase()!==String(user.username).toLowerCase();
      return(<div key={proj.id} style={{...C.card,marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
              <p style={{margin:0,fontWeight:600,fontSize:14}}>{proj.projectName}</p>
              <span style={C.badge(proj.status==="submitted"?"green":"gray")}>{proj.status}</span>
              {hasDraft&&<span style={C.badge("orange")} title="Unsubmitted changes">draft{draftBy&&<> — {draftBy}</>}{draftAt&&<> · {draftAt}</>}</span>}
              {lockBy&&<span style={C.badge("blue")} title={`Open in the editor since ${lockAt}`}>🔒 editing: {lockBy}</span>}
              {isAdminUser&&proj.ownedBy&&<span style={{fontSize:12,color:"#888"}}>by {proj.ownedBy}</span>}
            </div>
            {lockedByOther&&<p style={{margin:"4px 0 0",fontSize:12,color:"#ea580c"}}>🔒 {lockBy} is editing this project right now — it will open read-only for you.</p>}
            <p style={{margin:"2px 0 0",fontSize:12,color:"#888"}}>{proj.client&&<>{proj.client} · </>}{proj.engineerName&&<>{proj.engineerName} · </>}{proj.revisions?.length||0} rev{(proj.revisions?.length||0)!==1?"s":""}{(proj.revisions?.length||0)>0&&` · ${proj.revisions[proj.revisions.length-1].code}`}</p>
            {(proj.grantedTo||[]).length>0&&<div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:4}}>{proj.grantedTo.map(u=><span key={u} style={C.badge("blue")}>{u}{isAdminUser&&<span onClick={()=>doRevoke(proj.id,u)} style={{marginLeft:3,cursor:"pointer",fontWeight:700}}>×</span>}</span>)}</div>}
          </div>
          <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
            {(proj.revisions?.length||0)>0&&<select style={{...C.input,maxWidth:170,fontSize:12}} onChange={e=>{if(e.target.value!=="")setViewRev({project:proj,revIdx:parseInt(e.target.value)});}} defaultValue=""><option value="">View revision…</option>{proj.revisions.map((r,i)=><option key={i} value={i}>Rev-{i}: {r.code}</option>)}</select>}
            {canEdit(proj)&&<button style={C.btnS} onClick={()=>openEditor(proj)}>{lockedByOther?"View":"Edit"}</button>}
            {canEdit(proj)&&<button style={C.btnS} onClick={()=>openDuplicate(proj)}>📋 Duplicate</button>}
            {isAdminUser&&lockedByOther&&<button style={C.btnS} title="Open the editor and take the edit lock — the draft is kept" onClick={()=>{if(window.confirm(`Take over editing from ${lockBy}? Their draft is kept, but they can no longer save.`))openEditor(proj,true);}}>Take over</button>}
            {isAdminUser&&(hasDraft||lockBy)&&<button style={C.btnD} onClick={()=>setUnlockConfirm(proj)}>Discard draft</button>}
            {isAdminUser&&<button style={C.btnS} onClick={()=>setGrantModal(proj)}>Grant access</button>}
            {isAdminUser&&<button style={C.btnD} onClick={()=>doDelete(proj.id)}>Delete</button>}
          </div>
        </div>
      </div>);
    })}
    {grantModal&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300}}><div style={{...C.card,width:320}}><p style={{margin:"0 0 10px",fontWeight:600,fontSize:14}}>Grant access — {grantModal.projectName}</p><label style={C.label}>Presales username</label><input style={C.input} value={grantUser} onChange={e=>setGrantUser(e.target.value)} placeholder="username"/><div style={{display:"flex",gap:8,marginTop:10}}><button style={C.btnP} onClick={doGrant}>Grant</button><button style={C.btnS} onClick={()=>{setGrantModal(null);setGrantUser("");}}>Cancel</button></div></div></div>}
    {dupModal&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300}}><div style={{...C.card,width:380}}>
      <p style={{margin:"0 0 4px",fontWeight:600,fontSize:14}}>Duplicate project</p>
      <p style={{margin:"0 0 14px",fontSize:12,color:"#888"}}>Copies {dupModal.projectName}'s current content into a brand-new project. Its revision count starts fresh at 0.</p>
      <label style={C.label}>Project name</label>
      <input style={C.input} value={dupFields.projectName} onChange={e=>setDupFields(f=>({...f,projectName:e.target.value}))}/>
      <label style={{...C.label,marginTop:8}}>Client</label>
      <input style={C.input} value={dupFields.client} onChange={e=>setDupFields(f=>({...f,client:e.target.value}))}/>
      <label style={{...C.label,marginTop:8}}>Ref number <span style={{color:"#c0392b"}}>— must differ from the original ({dupModal.refNumber||"none"})</span></label>
      <input style={C.input} value={dupFields.refNumber} onChange={e=>setDupFields(f=>({...f,refNumber:e.target.value}))}/>
      <label style={{...C.label,marginTop:8}}>System type</label>
      <input style={C.input} value={dupFields.systemType} onChange={e=>setDupFields(f=>({...f,systemType:e.target.value}))}/>
      {dupErr&&<p style={{margin:"10px 0 0",fontSize:12,color:"#c0392b"}}>{dupErr}</p>}
      <div style={{display:"flex",gap:8,marginTop:14}}>
        <button style={C.btnP} disabled={dupBusy} onClick={doDuplicate}>{dupBusy?"Duplicating…":"Duplicate"}</button>
        <button style={C.btnS} onClick={()=>{setDupModal(null);setDupErr("");}}>Cancel</button>
      </div>
    </div></div>}
    {unlockConfirm&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300}}><div style={{...C.card,width:380}}>
      <p style={{margin:"0 0 8px",fontWeight:600,fontSize:14}}>Discard draft — {unlockConfirm.projectName}</p>
      <p style={{margin:"0 0 8px",fontSize:13,color:"#555"}}>{unlockConfirm.draft?<>This permanently deletes the unsubmitted draft{draftOwner(unlockConfirm.draft)&&<> last saved by <strong>{draftOwner(unlockConfirm.draft)}</strong></>}. The project goes back to its last submitted revision.</>:<>There is no saved draft, but the edit lock will be released.</>}</p>
      {unlockConfirm.lock&&<p style={{margin:"0 0 8px",fontSize:13,color:"#ea580c"}}><strong>{unlockConfirm.lock.username}</strong> has it open right now — their editor will stop saving and switch to read-only.</p>}
      <p style={{margin:"0 0 14px",fontSize:13,color:"#b91c1c",fontWeight:600}}>This cannot be undone.</p>
      <div style={{display:"flex",gap:8}}><button style={C.btnD} onClick={()=>doDiscardDraft(unlockConfirm.id)}>Yes, discard</button><button style={C.btnS} onClick={()=>setUnlockConfirm(null)}>Cancel</button></div>
    </div></div>}
  </div>);
}

// ─── App Shell ────────────────────────────────────────────────────────────────
function AppShell({user,onLogout}){
  const isAdminUser=isAdmin(user);
  const tabs=isAdminUser?["Projects","Price List","Settings","User Management"]:["My Projects","Price List"];
  const [tab,setTab]=useState(tabs[0]);
  const [settings,setSettings]=useState(null);
  const reloadSettings=()=>loadSettings().then(setSettings);
  useEffect(()=>{reloadSettings();},[]);
  useEffect(()=>{if(tab==="Settings")reloadSettings();},[tab]);
  if(!settings)return<div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}><p style={{color:"#888"}}>Loading…</p></div>;
  return(<div style={C.page}><TopBar user={user} tab={tab} tabs={tabs} setTab={setTab} onLogout={onLogout}/><div style={{padding:"18px 22px",maxWidth:1100,margin:"0 auto"}}>{(tab==="Projects"||tab==="My Projects")&&<ProjectsTab user={user} settings={settings}/>}{tab==="Price List"&&<PriceListTab/>}{tab==="Settings"&&<SettingsTab onSaved={reloadSettings}/>}{tab==="User Management"&&<UserMgmtTab user={user}/>}</div></div>);
}

export default function App(){
  const [user,setUser]=useState(()=>{const s=LS.get("mscc_session");if(s&&!s.token){LS.set("mscc_session",null);return null;}return s;}); // old-style sessions (they held the password) are discarded
  const logout=()=>{LS.set("mscc_session",null);setUser(null);};
  useEffect(()=>{ // confirm the session with the server and pick up any role / name change
    if(!user||!API)return;
    apiCall("/me").then(r=>{if(r.ok&&r.data){const n={...user,...r.data};LS.set("mscc_session",n);if(n.role!==user.role||n.displayName!==user.displayName)setUser(n);}});
  // eslint-disable-next-line
  },[]);
  useEffect(()=>{
    let link=document.querySelector("link[rel~='icon']");
    if(!link){link=document.createElement("link");link.rel="icon";document.head.appendChild(link);}
    link.href=LOGO_URL;
  },[]);
  if(!user)return<Login onLogin={u=>setUser(u)}/>;
  return<AppShell user={user} onLogout={logout}/>;
}
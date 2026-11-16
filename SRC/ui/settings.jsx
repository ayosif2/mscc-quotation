// Settings tab (company, factors, currency, templates, usage, backup / restore).
// Split out of app.jsx in v2.0.0 — the code itself is unchanged.
import { useState, useEffect } from "react";
import { apiCall, failMsg, loadPriceList, loadSettings, saveSettings } from "../lib/api.js";
import { C } from "./common.jsx";

// ─── Settings ─────────────────────────────────────────────────────────────────
// ─── Usage (v1.3.0) ───────────────────────────────────────────────────────────
// Server requests per UTC day, recorded to size up a move to Cloudflare Workers
// (free plan: 100,000 requests per day, reset at midnight UTC).
export function UsagePanel(){
  const [u,setU]=useState(null),[err,setErr]=useState("");
  useEffect(()=>{apiCall("/usage").then(r=>r.ok?setU(r.data):setErr("Could not load usage from the server."));},[]);
  if(err)return<p style={C.err}>{err}</p>;
  if(!u)return<p style={{color:"#888",fontSize:13}}>Loading…</p>;
  const mb=b=>(b/1048576).toFixed(b>=10485760?0:1)+" MB";
  const avg=(ms,n)=>n?Math.round(ms/n)+" ms":"—";
  const pct=n=>((n/100000)*100).toFixed(1)+"%";
  return(<div>
    {u.note&&<p style={{fontSize:13,color:"#1d4ed8",margin:"0 0 10px"}}>{u.note}</p>}<p style={{fontSize:12,color:"#666",margin:"0 0 10px"}}>Requests to the server per day (UTC), counted since v1.3.0. For comparison, Cloudflare Workers' free plan allows 100,000 requests per day.</p>
    {u.days.length===0&&<p style={{fontSize:13,color:"#888"}}>Nothing recorded yet.</p>}
    {u.days.length>0&&<table style={{width:"100%",maxWidth:640,borderCollapse:"collapse",fontSize:13,marginBottom:16}}>
      <thead style={{background:"#f4f4f4"}}><tr><th style={C.th}>Day (UTC)</th><th style={{...C.th,textAlign:"right"}}>Requests</th><th style={{...C.th,textAlign:"right"}}>Of free limit</th><th style={{...C.th,textAlign:"right"}}>Data sent</th><th style={{...C.th,textAlign:"right"}}>Avg time</th></tr></thead>
      <tbody>{u.days.map(d=><tr key={d.day}><td style={C.td}>{d.day}</td><td style={{...C.td,textAlign:"right"}}>{d.requests.toLocaleString("en-US")}</td><td style={{...C.td,textAlign:"right"}}>{pct(d.requests)}</td><td style={{...C.td,textAlign:"right"}}>{mb(d.bytes)}</td><td style={{...C.td,textAlign:"right"}}>{avg(d.ms,d.requests)}</td></tr>)}</tbody>
    </table>}
    {u.routes.length>0&&<><p style={C.sT}>Busiest requests (last 30 days)</p>
    <table style={{width:"100%",maxWidth:640,borderCollapse:"collapse",fontSize:13}}>
      <thead style={{background:"#f4f4f4"}}><tr><th style={C.th}>Request</th><th style={{...C.th,textAlign:"right"}}>Count</th><th style={{...C.th,textAlign:"right"}}>Data sent</th><th style={{...C.th,textAlign:"right"}}>Avg time</th></tr></thead>
      <tbody>{u.routes.map(r=><tr key={r.route}><td style={{...C.td,fontFamily:"monospace",fontSize:12}}>{r.route}</td><td style={{...C.td,textAlign:"right"}}>{r.requests.toLocaleString("en-US")}</td><td style={{...C.td,textAlign:"right"}}>{mb(r.bytes)}</td><td style={{...C.td,textAlign:"right"}}>{avg(r.ms,r.requests)}</td></tr>)}</tbody>
    </table></>}
  </div>);
}

export function SettingsTab({onSaved}){
  const [S,setS]=useState(null),[saved,setSaved]=useState(false),[saveErr,setSaveErr]=useState(""),[tIdx,setTIdx]=useState(0),[newTpl,setNewTpl]=useState(""),[warnL,setWarnL]=useState(false),[pendL,setPendL]=useState(null),[sub,setSub]=useState("company");
  const [bkBusy,setBkBusy]=useState(""); // backup/restore progress text (hooks must come before the early return below)
  useEffect(()=>{loadSettings().then(setS);},[]);
  if(!S)return<p style={{padding:20,color:"#888"}}>Loading…</p>;
  const persist=async s=>{setS(s);const r=await saveSettings(s);if(r.ok){setSaveErr("");setSaved(true);setTimeout(()=>setSaved(false),2000);if(onSaved)onSaved();}else{setSaveErr(failMsg(r,"settings were not saved"));setTimeout(()=>setSaveErr(""),4000);}};
  const set=(path,val)=>{const s=JSON.parse(JSON.stringify(S));const ks=path.split(".");let o=s;ks.slice(0,-1).forEach(k=>o=o[k]);o[ks[ks.length-1]]=val;persist(s);};
  const updL=val=>{const n=parseFloat(val);if(!isNaN(n)&&n!==1&&S.defaultLocalFactor===1&&!warnL){setPendL(n);setWarnL(true);return;}set("defaultLocalFactor",isNaN(n)?1:n);};
  const syncBrands=async()=>{const pl=await loadPriceList();const brands=[...new Set(pl.map(i=>i.brand).filter(Boolean))];const s=JSON.parse(JSON.stringify(S));brands.forEach(b=>{if(!s.defaultBrandFactors[b])s.defaultBrandFactors[b]=1;});persist(s);};
  // Backup / restore in chunks (v1.4.0): table by table, page by page, so it also works on Cloudflare
  // Workers where one request can't carry the whole database. The .json file format is unchanged.
  const doBackup=async()=>{
    setBkBusy("Preparing backup…");
    try{
      const out={exportedAt:new Date().toISOString(),settings:{},users:[],priceList:[],projects:[],revisions:[],drafts:[]};
      for(const table of ["settings","users","priceList","projects","revisions","drafts"]){
        let offset=0;
        while(offset!==null){
          setBkBusy(`Downloading ${table}… ${offset||""}`);
          const r=await apiCall(`/backup/part?table=${table}&offset=${offset}`);
          if(!r.ok){alert(r.status===403?"Only admins can download backups.":failMsg(r,"backup was not downloaded"));return;}
          if(table==="settings")r.data.rows.forEach(x=>{out.settings[x.key]=x.value;});else out[table].push(...r.data.rows);
          offset=r.data.next;
        }
      }
      const blob=new Blob([JSON.stringify(out)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`mscc_backup_${new Date().toISOString().slice(0,10)}.json`;a.click();
    }finally{setBkBusy("");}
  };
  const doRestore=async e=>{
    const f=e.target.files[0];if(!f)return;e.target.value="";
    let data;try{data=JSON.parse(await f.text());}catch{alert("Invalid backup file.");return;}
    if(!window.confirm("Restore this backup?\n\nThis REPLACES everything — all projects, revisions, drafts, the price list, users and settings — with the contents of the file. It cannot be undone. Download a backup of the current data first if you might need it."))return;
    const fail=r=>{alert(r.status===403?"Only the superadmin can restore a backup.":failMsg(r,"the restore stopped part-way")+" Run the restore again with the same file.");};
    setBkBusy("Restoring settings and users…");
    try{
      let r=await apiCall("/backup/restore/start",{method:"POST",body:JSON.stringify({settings:data.settings||{},users:data.users||[]})});
      if(!r.ok){fail(r);return;}
      for(const [table,size] of [["priceList",300],["projects",300],["revisions",40],["drafts",40]]){
        const rows=data[table]||[];
        for(let i=0;i<rows.length;i+=size){
          setBkBusy(`Restoring ${table}… ${Math.min(i+size,rows.length)} / ${rows.length}`);
          r=await apiCall("/backup/restore/rows",{method:"POST",body:JSON.stringify({table,rows:rows.slice(i,i+size)})});
          if(!r.ok){fail(r);return;}
        }
      }
      alert("Restore complete. Reload the page.");
    }finally{setBkBusy("");}
  };
  return(<div><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><h2 style={{margin:0,fontSize:15,fontWeight:600}}>Global Settings</h2><div style={{display:"flex",gap:8,alignItems:"center"}}>{saved&&<span style={C.ok}>✓ Saved</span>}{saveErr&&<span style={C.err}>{saveErr}</span>}{bkBusy&&<span style={{fontSize:12,color:"#ea580c"}}>{bkBusy}</span>}<button style={C.btnS} onClick={doBackup} disabled={!!bkBusy}>⬇ Export backup</button><label style={{...C.btnS,cursor:"pointer"}}>⬆ Import backup<input type="file" accept=".json" style={{display:"none"}} onChange={doRestore}/></label></div></div>
  <div style={{display:"flex",borderBottom:"1px solid #ddd",margin:"10px 0"}}>{["company","factors","currency","templates","usage"].map(t=><button key={t} style={C.tab(sub===t)} onClick={()=>setSub(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>)}</div>
  {sub==="company"&&<div style={{maxWidth:500}}>{[["name","Company name"],["address","Address"],["poBox","P.O. Box"],["city","City/ZIP"],["phone","Phone"],["mobile","Mobile"],["email","Email"]].map(([f,l])=><div key={f} style={{marginBottom:9}}><label style={C.label}>{l}</label><input style={C.input} value={S.company[f]||""} onChange={e=>set(`company.${f}`,e.target.value)}/></div>)}</div>}
  {sub==="factors"&&<div style={{maxWidth:460}}><p style={C.sT}>Default local factor</p><div style={{marginBottom:9}}><label style={C.label}>Local factor</label><input style={{...C.input,maxWidth:170}} type="number" step="0.01" value={S.defaultLocalFactor} onChange={e=>updL(e.target.value)}/></div>{warnL&&<div style={{background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:"6px",padding:10,marginBottom:10}}><p style={{margin:"0 0 7px",color:"#ea580c",fontSize:13}}>⚠️ Changing global local factor. Confirm?</p><div style={{display:"flex",gap:8}}><button style={C.btnS} onClick={()=>{set("defaultLocalFactor",pendL);setWarnL(false);}}>Confirm</button><button style={C.btnS} onClick={()=>setWarnL(false)}>Cancel</button></div></div>}<p style={C.sT}>Brand factors <button style={{...C.btnS,fontSize:11,padding:"2px 7px",marginLeft:7}} onClick={syncBrands}>Sync from price list</button></p>{Object.keys(S.defaultBrandFactors).length===0&&<p style={{fontSize:13,color:"#888"}}>Import price list first, then sync.</p>}{Object.entries(S.defaultBrandFactors).map(([b,f])=><div key={b} style={{...C.row,marginBottom:7,alignItems:"center"}}><span style={{minWidth:110,fontSize:13,fontWeight:500}}>{b}</span><input style={{...C.input,maxWidth:120}} type="number" step="0.01" min="0" value={f} onChange={e=>{const s=JSON.parse(JSON.stringify(S));s.defaultBrandFactors[b]=parseFloat(e.target.value)||0;persist(s);}}/></div>)}</div>}
  {sub==="currency"&&<div style={{maxWidth:300}}><p style={C.sT}>Default currency</p><select style={C.input} value={S.defaultCurrency} onChange={e=>set("defaultCurrency",e.target.value)}>{["USD","EGP","EUR","GBP","SAR","AED"].map(c=><option key={c}>{c}</option>)}</select></div>}
  {sub==="usage"&&<UsagePanel/>}
  {sub==="templates"&&<div><div style={{...C.row,alignItems:"center",marginBottom:10}}><select style={{...C.input,maxWidth:230}} value={tIdx} onChange={e=>setTIdx(Number(e.target.value))}>{S.templates.map((t,i)=><option key={t.id} value={i}>{t.name}{t.id===S.defaultTemplateId?" (default)":""}</option>)}</select><button style={C.btnS} onClick={()=>set("defaultTemplateId",S.templates[tIdx].id)}>Set default</button>{S.templates.length>1&&<button style={C.btnD} onClick={()=>{const s=JSON.parse(JSON.stringify(S));s.templates.splice(tIdx,1);setTIdx(0);persist(s);}}>Delete</button>}</div><div style={{...C.row,marginBottom:10}}><div style={C.f1}><label style={C.label}>Clone as</label><input style={C.input} value={newTpl} onChange={e=>setNewTpl(e.target.value)} placeholder="New template name"/></div><button style={{...C.btnS,alignSelf:"flex-end"}} onClick={()=>{if(!newTpl.trim())return;const s=JSON.parse(JSON.stringify(S));s.templates.push({id:`tpl_${Date.now()}`,name:newTpl.trim(),coverLetter:s.templates[tIdx].coverLetter,termsAndConditions:s.templates[tIdx].termsAndConditions,includeTerms:s.templates[tIdx].includeTerms!==false});setTIdx(s.templates.length-1);setNewTpl("");persist(s);}}>Clone</button></div><div style={{marginBottom:9}}><label style={C.label}>Cover letter</label><textarea style={{...C.input,minHeight:160,resize:"vertical",lineHeight:1.6}} value={S.templates[tIdx].coverLetter} onChange={e=>{const s=JSON.parse(JSON.stringify(S));s.templates[tIdx].coverLetter=e.target.value;persist(s);}}/></div><div>
    <label style={{display:"flex",alignItems:"center",gap:7,fontSize:13,fontWeight:500,cursor:"pointer",marginBottom:6}}>
      <input type="checkbox" checked={S.templates[tIdx].includeTerms!==false} onChange={e=>{const s=JSON.parse(JSON.stringify(S));s.templates[tIdx].includeTerms=e.target.checked;persist(s);}}/>
      Include the Terms &amp; Conditions page
      <span style={{fontSize:11,color:"#888",fontWeight:400}}>— in the Quotation and Quotation with P/N PDFs that use this template</span>
    </label>
    <label style={C.label}>Terms & conditions{S.templates[tIdx].includeTerms===false&&<span style={{color:"#ea580c"}}> — not printed (box above is unticked); the text is kept</span>}</label>
    <textarea style={{...C.input,minHeight:230,resize:"vertical",lineHeight:1.6,opacity:S.templates[tIdx].includeTerms===false?0.55:1}} value={S.templates[tIdx].termsAndConditions} onChange={e=>{const s=JSON.parse(JSON.stringify(S));s.templates[tIdx].termsAndConditions=e.target.value;persist(s);}}/>
  </div></div>}
  </div>);
}

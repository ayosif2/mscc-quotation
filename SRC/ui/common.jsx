// Shared styles and small components: brand picker, print dialog, sign-in, top bar, password dialog.
// Split out of app.jsx in v2.0.0 — the code itself is unchanged.
import { useState, useEffect } from "react";
import { generateExcelExport } from "../exports/excel.js";
import { ClientBoM, exportBOMCSV, exportDetailedCSV, exportPartNumCSV, exportQuotationCSV, generateBOMPDF, generateDetailedPDF, generateIssueSlipPDF, generatePDF, generatePartNumPDF } from "../exports/pdf.js";
import { API, LS, MIN_PW, apiCall, checkConnection, failMsg, isAdmin, useConnStatus } from "../lib/api.js";
import { APP_VERSION, LOGO_URL, SITE_URL, VERSION_URL } from "../lib/constants.js";

// ─── Styles ───────────────────────────────────────────────────────────────────
export const C={
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
export function BrandSelector({ value, onChange, allBrands }) {
  const seen=new Set();
  const uniqueBrands=(allBrands||[]).filter(b=>{if(!b)return false;const l=b.toLowerCase();if(seen.has(l))return false;seen.add(l);return true;});
  const isKnown=value&&uniqueBrands.some(b=>b.toLowerCase()===value.toLowerCase());
  const [showCustom,setShowCustom]=useState(!!value&&!isKnown);
  const selectVal=showCustom?"__other__":(uniqueBrands.find(b=>b.toLowerCase()===(value||"").toLowerCase())||"");
  const handleSelect=e=>{if(e.target.value==="__other__"){setShowCustom(true);onChange("");}else{setShowCustom(false);onChange(e.target.value);}};
  return(<div><select style={C.input} value={selectVal} onChange={handleSelect}><option value="">Select brand…</option>{uniqueBrands.map(b=><option key={b} value={b}>{b}</option>)}<option value="__other__">Other…</option></select>{showCustom&&<input style={{...C.input,marginTop:4}} value={value||""} onChange={e=>onChange(e.target.value)} placeholder="Type brand name…" autoFocus/>}</div>);
}

// ─── PDF / CSV Generators ─────────────────────────────────────────────────────
export const headerHTML=(co)=>`<table style="width:100%;border-collapse:collapse;margin-bottom:16px;"><tr><td style="border-bottom:2px solid #c0392b;padding-bottom:8px;"><img src="${LOGO_URL}" style="height:55px;object-fit:contain;" onerror="this.style.display='none'"/></td><td style="border-bottom:2px solid #c0392b;padding-bottom:8px;text-align:right;font-size:11px;color:#555;vertical-align:bottom;"><div style="font-size:14px;font-weight:700;color:#c0392b;">${co.name}</div><div>${co.address}</div><div>${co.poBox} | ${co.city}</div><div>Tel: ${co.phone} | Mobile: ${co.mobile}</div><div>Email: ${co.email}</div></td></tr></table>`;
export const footerHTML=(co,label)=>`<div style="position:fixed;bottom:0;left:0;right:0;border-top:1px solid #e0e0e0;padding:5px 28px;font-size:10px;color:#888;display:flex;justify-content:space-between;background:#fff;"><span>${co.name} | ${co.address} | Tel: ${co.phone} | ${co.email}</span><span>${label}</span></div>`;
export const printBtn=`<div class="no-print" style="position:fixed;top:12px;right:12px;z-index:999;"><button onclick="window.print()" style="background:#c0392b;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600;">🖨 Print / Save as PDF</button></div>`;

export function PrintModal({project,rev,settings,onClose}){
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
  const tplPicker=<div style={{marginBottom:14}}><label style={C.label}>Select template</label><select style={C.input} value={tplId} onChange={e=>setTplId(e.target.value)}>{settings.templates.map(t=><option key={t.id} value={t.id}>{t.name}{t.id===settings.defaultTemplateId?" (default)":""}</option>)}</select></div>;
  if(sub==="quotation")return wrap(`Quotation — ${rev.code||""}`,<>{tplPicker}<div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button style={C.btnS} onClick={()=>setSub(null)}>← Back</button><button style={C.btnS} onClick={()=>{exportQuotationCSV(project,rev);onClose();}}>⬇ CSV</button><button style={C.btnP} onClick={()=>{generatePDF(project,rev,settings,tplId);onClose();}}>📄 PDF</button></div></>);
  if(sub==="bom")return wrap(`BOM — ${rev.code||""}`,<><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button style={C.btnS} onClick={()=>setSub(null)}>← Back</button><button style={C.btnS} onClick={()=>{exportBOMCSV(project,rev);onClose();}}>⬇ CSV</button><button style={C.btnP} onClick={()=>{generateBOMPDF(project,rev,settings);onClose();}}>📄 PDF</button></div></>);
  if(sub==="detailed")return wrap(`Detailed Quotation — ${rev.code||""}`,<>{warn}<div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button style={C.btnS} onClick={()=>setSub(null)}>← Back</button><button style={C.btnS} onClick={()=>{exportDetailedCSV(project,rev);onClose();}}>⬇ CSV</button><button style={C.btnP} onClick={()=>{generateDetailedPDF(project,rev,settings);onClose();}}>📄 PDF</button></div></>);
  if(sub==="PartNumber")return wrap(`Quotation with P/N — ${rev.code||""}`,<>{warn}{tplPicker}<div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button style={C.btnS} onClick={()=>setSub(null)}>← Back</button><button style={C.btnS} onClick={()=>{exportPartNumCSV(project,rev);onClose();}}>⬇ CSV</button><button style={C.btnP} onClick={()=>{generatePartNumPDF(project,rev,settings,tplId);onClose();}}>📄 PDF</button></div></>); 
  
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
export function Login({onLogin}){
  const [u,setU]=useState(""),[p,setP]=useState(""),[err,setErr]=useState(""),[loading,setLoading]=useState(false);
  const go=async()=>{
    if(!u||!p){setErr("Enter credentials.");return;}
    setLoading(true);setErr("");
    try{
      const r=await fetch(`${API}/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u,password:p})});
      const d=await r.json().catch(()=>({}));
      setLoading(false);
      if(r.status===429){setErr("Too many failed attempts. Try again in 15 minutes.");return;}
      if(r.status===403&&d.error==="disabled"){setErr("Account disabled.");return;}if(r.status===403&&d.error==="password_upgrade"){setErr("Your password needs to be reset by an admin before you can sign in here.");return;}
      if(!r.ok||!d.token){setErr("Invalid credentials.");return;}
      const sess={...d.user,token:d.token};
      LS.set("mscc_session",sess);onLogin(sess);
    }catch{setLoading(false);setErr("Could not reach the server.");}
  };
  return(<div style={C.center}><div style={{...C.card,width:330}}><div style={{textAlign:"center",marginBottom:18}}><a href={SITE_URL} target="_blank" rel="noreferrer"><img src={LOGO_URL} alt="MSCC" style={{height:52,objectFit:"contain"}} onError={e=>e.target.style.display="none"}/></a><p style={{margin:"8px 0 0",color:"#666",fontSize:13}}>Quotation Management System</p></div><div style={{marginBottom:9}}><label style={C.label}>Username</label><input style={C.input} value={u} onChange={e=>setU(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}/></div><div style={{marginBottom:9}}><label style={C.label}>Password</label><input style={C.input} type="password" value={p} onChange={e=>setP(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}/></div>{err&&<p style={C.err}>{err}</p>}<button style={{...C.btnP,width:"100%",marginTop:10,padding:"9px"}} onClick={go} disabled={loading}>{loading?"Signing in…":"Sign In"}</button><p style={{margin:"12px 0 0",textAlign:"center",fontSize:11}}><a href={VERSION_URL} target="_blank" rel="noreferrer" style={{color:"#aaa",textDecoration:"none"}} title="Opens GitHub">v{APP_VERSION}</a></p></div></div>);
}

// Polls the server periodically so the badge reflects reachability even when the
// user hasn't triggered a save recently. Every real save/load call also updates
// the same status, so this is just filling the gaps between user actions.
export function ConnStatusBadge(){
  const status=useConnStatus();
  useEffect(()=>{
    checkConnection();
    const iv=setInterval(checkConnection,60000); // every real save/load also updates the badge
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

export function TopBar({user,tab,tabs,setTab,onLogout}){
  const [pwOpen,setPwOpen]=useState(false);
  return(<div style={{background:"#fff",borderBottom:"1px solid #ccc",padding:"0 18px",display:"flex",alignItems:"center",justifyContent:"space-between",height:50,position:"sticky",top:0,zIndex:100}}><span style={{display:"flex",alignItems:"center",gap:6}}><a href={SITE_URL} target="_blank" rel="noreferrer"><img src={LOGO_URL} alt="MSCC" style={{height:32,objectFit:"contain"}} onError={e=>e.target.style.display="none"}/></a><a href={VERSION_URL} target="_blank" rel="noreferrer" style={{fontSize:10,color:"#999",textDecoration:"none"}} title="App version — opens GitHub">v{APP_VERSION}</a></span><div style={{display:"flex",overflowX:"auto"}}>{tabs.map(t=><button key={t} style={C.tab(tab===t)} onClick={()=>setTab(t)}>{t}</button>)}</div><div style={{display:"flex",alignItems:"center",gap:12}}><ConnStatusBadge/><span style={{fontSize:12,color:"#666",whiteSpace:"nowrap"}}>{user.displayName||user.username} <span style={C.badge(isAdmin(user)?"orange":"blue")}>{user.role}</span></span><button style={C.btnS} onClick={()=>setPwOpen(true)}>Password</button><button style={C.btnS} onClick={onLogout}>Sign out</button></div>{pwOpen&&<ChangePasswordModal onClose={()=>setPwOpen(false)}/>}</div>);
}

export function ChangePasswordModal({onClose}){
  const [f,setF]=useState({cur:"",nw:"",c:""}),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
  const save=async()=>{
    if(!f.cur||!f.nw){setMsg("Fill in all fields.");return;}
    if(f.nw!==f.c){setMsg("New passwords don't match.");return;}
    if(f.nw.length<MIN_PW){setMsg(`Password must be at least ${MIN_PW} characters.`);return;}
    setBusy(true);setMsg("");
    const r=await apiCall("/me/password",{method:"POST",body:JSON.stringify({current:f.cur,next:f.nw})});
    setBusy(false);
    if(!r.ok){setMsg(failMsg(r,"password was not changed"));return;}
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

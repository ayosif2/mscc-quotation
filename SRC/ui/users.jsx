// User Management tab.
// Split out of app.jsx in v2.0.0 — the code itself is unchanged.
import { useState, useEffect } from "react";
import { MIN_PW, USER_RULES, failMsg, isSuperAdmin, loadUsers, now, saveUser, uid } from "../lib/api.js";
import { C } from "./common.jsx";

// ─── User Mgmt ────────────────────────────────────────────────────────────────
export function UserMgmtTab({user}){
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
    const r=await saveUser(nu,true);if(!r.ok){flash(failMsg(r,"account was not created",USER_RULES),"err");return;}
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
          <button style={C.btnS} onClick={async()=>{if(!rpw.pw||rpw.pw!==rpw.c){flash("Mismatch.","err");return;}if(rpw.pw.length<MIN_PW){flash(`Password must be at least ${MIN_PW} characters.`,"err");return;}const r=await saveUser({...u,password:rpw.pw},false);if(!r.ok){flash(failMsg(r,"password was not changed",USER_RULES),"err");return;}setU(await loadUsers());setRid(null);setRpw({pw:"",c:""});flash("Done.");}}>Save</button>
          <button style={C.btnS} onClick={()=>setRid(null)}>Cancel</button>
        </div>
      </div>):(<div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <p style={{margin:0,fontWeight:500,fontSize:13}}>{u.displayName}</p>
          <p style={{margin:"2px 0 0",fontSize:12,color:"#666"}}>@{u.username} · <span style={C.badge("orange")}>admin</span> · <span style={C.badge(u.active?"green":"red")}>{u.active?"active":"disabled"}</span>{u.passwordReady===false&&<> · <span style={C.badge("orange")} title="This user has not signed in since v1.4.0, so their password is still in the old format. It must be upgraded (sign in once, or an admin sets a new password) before the move to Cloudflare.">needs sign-in</span></>}</p>
        </div>
        <div style={{display:"flex",gap:7}}>
          <button style={C.btnS} onClick={()=>setRid(u.id)}>Reset pw</button>
          <button style={u.active?C.btnD:C.btnS} onClick={async()=>{const r=await saveUser({...u,active:u.active?0:1},false);if(!r.ok){flash(failMsg(r,"status was not changed",USER_RULES),"err");return;}setU(await loadUsers());}}>{u.active?"Deactivate":"Activate"}</button>
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
          <button style={C.btnS} onClick={async()=>{if(!rpw.pw||rpw.pw!==rpw.c){flash("Mismatch.","err");return;}if(rpw.pw.length<MIN_PW){flash(`Password must be at least ${MIN_PW} characters.`,"err");return;}const r=await saveUser({...u,password:rpw.pw},false);if(!r.ok){flash(failMsg(r,"password was not changed",USER_RULES),"err");return;}setU(await loadUsers());setRid(null);setRpw({pw:"",c:""});flash("Done.");}}>Save</button>
          <button style={C.btnS} onClick={()=>setRid(null)}>Cancel</button>
        </div>
      </div>):(<div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <p style={{margin:0,fontWeight:500,fontSize:13}}>{u.displayName}</p>
          <p style={{margin:"2px 0 0",fontSize:12,color:"#666"}}>@{u.username} · <span style={C.badge(u.active?"green":"red")}>{u.active?"active":"disabled"}</span>{u.passwordReady===false&&<> · <span style={C.badge("orange")} title="This user has not signed in since v1.4.0, so their password is still in the old format. It must be upgraded (sign in once, or an admin sets a new password) before the move to Cloudflare.">needs sign-in</span></>}</p>
        </div>
        <div style={{display:"flex",gap:7}}>
          <button style={C.btnS} onClick={()=>setRid(u.id)}>Reset pw</button>
          <button style={u.active?C.btnD:C.btnS} onClick={async()=>{const r=await saveUser({...u,active:u.active?0:1},false);if(!r.ok){flash(failMsg(r,"status was not changed",USER_RULES),"err");return;}setU(await loadUsers());}}>{u.active?"Deactivate":"Activate"}</button>
        </div>
      </div>)}
    </div>)}
  </div>);
}

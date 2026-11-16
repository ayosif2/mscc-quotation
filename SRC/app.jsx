// App entry: sign-in state and the tab shell.
// Split out of app.jsx in v2.0.0 — the code itself is unchanged.
import { useState, useEffect } from "react";
import { LS, apiCall, isAdmin, loadSettings } from "./lib/api.js";
import { LOGO_URL } from "./lib/constants.js";
import { C, Login, TopBar } from "./ui/common.jsx";
import { PriceListTab } from "./ui/pricelist.jsx";
import { ProjectsTab } from "./ui/projects.jsx";
import { SettingsTab } from "./ui/settings.jsx";
import { UserMgmtTab } from "./ui/users.jsx";

// ─── App Shell ────────────────────────────────────────────────────────────────
export function AppShell({user,onLogout}){
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
    if(!user)return;
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

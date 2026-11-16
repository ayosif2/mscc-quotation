// Projects tab (list, open, revisions, duplicate, sharing, delete).
// Split out of app.jsx in v2.0.0 — the code itself is unchanged.
import { useState, useEffect } from "react";
import { clearDraft, createProject, deleteProject, draftOwner, draftTime, ensureFullProject, failMsg, getEditLock, grantAccess, isAdmin, loadPriceList, loadProject, loadProjects, loadUsers, now, releaseLock, revokeAccess, saveDraft, setEditLock, uid } from "../lib/api.js";
import { applyRounding, calcUnitPrice, fmtR, ssChildUnitTotal, ssUnitPrice } from "../lib/quote.js";
import { C, PrintModal } from "./common.jsx";
import { ProjectEditor } from "./editor.jsx";

// ─── Projects Tab ─────────────────────────────────────────────────────────────
export function ProjectsTab({user,settings}){
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
  const doGrant=async()=>{if(!grantUser.trim())return;const uL=grantUser.toLowerCase().trim();const users=await loadUsers();if(!users.find(u=>u.username.toLowerCase()===uL)){alert("User not found.");return;}const r=await grantAccess(grantModal.id,uL);if(!r.ok){alert(failMsg(r,"access was not granted"));return;}reload();setGrantModal(null);setGrantUser("");};
  const doRevoke=async(projId,username)=>{const r=await revokeAccess(projId,username);if(!r.ok){alert(failMsg(r,"access was not revoked"));return;}reload();};
  const doDelete=async id=>{if(!window.confirm("Delete project and all revisions?"))return;const r=await deleteProject(id);if(!r.ok){alert(failMsg(r,"project was not deleted"));return;}reload();};
  // Admin "Discard draft": deletes the unsubmitted draft and frees the edit lock (cannot be undone).
  const doDiscardDraft=async projId=>{const r=await clearDraft(projId);if(!r.ok){alert(failMsg(r,"draft was not discarded"));return;}reload();setUnlockConfirm(null);};
  // Opening the editor. takeover:true = admin takes the edit lock from whoever holds it.
  // The editor is re-mounted (editKey) with freshly loaded data whenever it is reopened.
  const [editTakeover,setEditTakeover]=useState(false),[editKey,setEditKey]=useState(0);
  // The list only has summaries (v1.3.0), so the full project is loaded just before it opens.
  const [opening,setOpening]=useState(false);
  const openEditor=async(proj,takeover=false)=>{
    setOpening(true);const full=await ensureFullProject(proj);setOpening(false);
    if(!full){alert("The project could not be opened. Check your connection and reload the page — it may also have been deleted.");return;}
    setEditTakeover(!!takeover);setEditKey(k=>k+1);setEditing(full);
  };
  const reopenEditor=async(takeover,projId)=>{
    const p=await loadProject(projId||editing?.id);
    if(p)openEditor(p,takeover);else{setEditing(null);reload();}
  };
  const openRevision=async(proj,revIdx)=>{
    setOpening(true);const full=await ensureFullProject(proj);setOpening(false);
    if(!full||!full.revisions?.[revIdx]){alert("The revision could not be opened. Check your connection and reload the page.");return;}
    setViewRev({project:full,revIdx});
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
      // the list only holds summaries (v1.3.0) — copy from the full project
      const full=await ensureFullProject(src);
      if(!full){setDupErr("The project could not be loaded — duplicate was not created. Check your connection and reload the page.");setDupBusy(false);return;}
      const latestRev=full.draft||(full.revisions?.length?full.revisions[full.revisions.length-1]:null);
      const seedData=latestRev?JSON.parse(JSON.stringify(latestRev.data||latestRev)):{};
      const engineerName=!isAdminUser?(user.displayName||user.username):(src.engineerName||"");
      const np={id:uid(),projectName:dupFields.projectName.trim(),client:dupFields.client,engineerName,refNumber:dupFields.refNumber,systemType:dupFields.systemType,ownedBy:isAdminUser?null:user.username,grantedTo:[],status:"draft",createdAt:now()};
      // The server only accepts draft saves from a holder of the project's edit lock (v1.1.0),
      // so the duplicate is created and filled under a short lock of its own, released right
      // after; the editor that opens next then takes its own lock as usual.
      const dupLock=uid()+uid(), prevLock=getEditLock();
      setEditLock(dupLock);
      const draftPayload={...seedData,projectName:np.projectName,client:np.client,refNumber:np.refNumber,systemType:np.systemType,engineerName:np.engineerName,date:new Date().toISOString().slice(0,10)};
      let cr,dr;
      try{
        cr=await createProject(np);
        if(cr.ok)dr=await saveDraft(cr.id,draftPayload,user.username||user.displayName);
      }finally{
        setEditLock(prevLock);
        if(cr?.ok)await releaseLock(cr.id,dupLock);
      }
      if(!cr.ok){setDupErr(failMsg(cr,"duplicate was not created"));setDupBusy(false);return;}
      if(!dr?.ok){setDupErr(failMsg(dr,"duplicate was created but its content could not be saved"));setDupBusy(false);return;}
      setDupModal(null);setDupBusy(false);
      const updated=await loadProjects();
      setProjects(updated);
      await openEditor(updated.find(p=>p.id===cr.id)||{id:cr.id,summary:true});
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
    {opening&&<div style={{position:"fixed",inset:0,background:"rgba(255,255,255,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400}}><span style={{...C.card,fontSize:13,color:"#555"}}>Opening project…</span></div>}
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
            {(proj.revisions?.length||0)>0&&<select style={{...C.input,maxWidth:170,fontSize:12}} onChange={e=>{if(e.target.value!==""){const i=parseInt(e.target.value);e.target.value="";openRevision(proj,i);}}} defaultValue=""><option value="">View revision…</option>{proj.revisions.map((r,i)=><option key={i} value={i}>Rev-{i}: {r.code}</option>)}</select>}
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

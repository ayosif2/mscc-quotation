// Project editor (items, subsystems, factors, drafts, submit, edit lock).
// Split out of app.jsx in v2.0.0 — the code itself is unchanged.
import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";
import { acquireLock, addPriceItem, createProject, failMsg, getEditLock, isAdmin, now, releaseLock, saveDraft, setEditLock, submitRevision, uid, updateProject } from "../lib/api.js";
import { applyRounding, assignRowNums, autoPartNumber, calcUnitPrice, expandForCalc, factorSummary, fmtFactor, fmtN, fmtR, itemFactors, normalizeBrand, parseSolutionNavigatorExcel, ssChildUnitTotal, ssUnitPrice, withCustomFactor, withoutCustomFactor } from "../lib/quote.js";
import { BrandSelector, C } from "./common.jsx";

// ─── Item Search Dropdown ─────────────────────────────────────────────────────
// Enter / Shift+Enter navigation (next / previous) for qty inputs in the editor.
// group "top"  -> normal lines + subsystem headers (never enters a subsystem)
// group "ss-<id>" -> children of one subsystem (never leaves that subsystem)
export function qtyFocus(e){e.target.select();}
export function qtyEnter(e){
  if(e.key!=="Enter")return;
  e.preventDefault();
  const el=e.currentTarget,group=el.dataset.qtyGroup;
  const root=el.closest("table")||document;
  const all=Array.from(root.querySelectorAll("input[data-qty-group]")).filter(i=>i.dataset.qtyGroup===group);
  const next=all[all.indexOf(el)+(e.shiftKey?-1:1)];
  if(next){next.focus();next.select();}
}

export function ItemSearchDropdown({priceList,onSelect,excludeSubsystems}){
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
export function FactorInputs({item,brandFactors,localFactor,onChange}){
  const base=itemFactors({...item,customFactor:false},brandFactors,localFactor);
  const inp={width:56,padding:"1px 4px",fontSize:11,textAlign:"right",border:"1px solid #93c5fd",borderRadius:3,background:"#fff"};
  const lbl={fontSize:10,color:"#1d4ed8",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:3};
  return(<div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"flex-end",marginTop:4}} onClick={e=>e.stopPropagation()} onMouseDown={e=>e.stopPropagation()}>
    <label style={lbl} title={`Brand factor for this item only (project ${item.brand||"brand"} factor: ×${fmtFactor(base.bf)})`}>Brand ×<input style={inp} type="number" step="0.01" min="0" value={item.itemBrandFactor??""} placeholder={fmtFactor(base.bf)} onChange={e=>onChange("itemBrandFactor",e.target.value)}/></label>
    <label style={lbl} title={`Local factor for this item only (project local factor: ×${fmtFactor(base.lf)})`}>Local ×<input style={inp} type="number" step="0.01" min="0" value={item.itemLocalFactor??""} placeholder={fmtFactor(base.lf)} onChange={e=>onChange("itemLocalFactor",e.target.value)}/></label>
  </div>);
}
export const factorBtn={padding:"2px 4px",fontSize:10,whiteSpace:"nowrap",color:"#1d4ed8",borderColor:"#93c5fd"};

export function SubsystemRow({line,idx,brandFactors,localFactor,rate,roundUp,curr,setSSCustomFactors,updChildFactor,resetRowNum,
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

export function ProjectEditor({project,user,settings,priceList,onBack,takeover,onReopen}){
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
    setEditLock(lockIdRef.current);
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
    return()=>{alive=false;clearInterval(iv);window.removeEventListener("pagehide",release);release();if(getEditLock()===lockIdRef.current)setEditLock(null);};
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
  const saveLineToPriceList=async line=>{const r=await addPriceItem({id:uid(),description:line.description,modelNo:line.modelNo,brand:line.brand,glp:line.glp,local:line.local,notes:line.notes||""});if(!r.ok){flash(failMsg(r,"item was not saved to the price list"),"err");return;}flash(`"${line.description||line.modelNo}" saved to price list.`);};
  const saveSubsystemToPriceList=async ss=>{
    const children=(ss.children||[]).map(c=>({description:c.description,modelNo:c.modelNo,brand:c.brand,glp:c.glp,local:c.local,notes:c.notes||"",qty:c.qty||1}));
    const r=await addPriceItem({id:uid(),type:"subsystem",description:ss.description,brand:ss.brand||"",partNumber:ss.partNumber||autoPartNumber({children}),children});
    if(!r.ok){flash(failMsg(r,"template was not saved"),"err");return;}
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
        if(!cr.ok){flash(failMsg(cr,"nothing was submitted"),"err");return;}
        pid=cr.id;projectIdRef.current=pid;
      }else{
        const ur=await updateProject({id:pid,projectName:fields.projectName,client:fields.client,engineerName:fields.engineerName,refNumber:fields.refNumber,systemType:fields.systemType,ownedBy:project?.ownedBy||(isAdmin(user)?null:user.username),grantedTo:project?.grantedTo||[]});
        if(ur.lockLost){loseLock(ur.lock);flash("Not submitted — you no longer hold the edit lock for this project.","err");return;}
        if(!ur.ok){flash(failMsg(ur,"nothing was submitted"),"err");return;}
      }
      const sr=await submitRevision(pid,rev);
      if(sr.lockLost){loseLock(sr.lock);flash("Not submitted — you no longer hold the edit lock for this project.","err");return;}
      if(!sr.ok){flash(failMsg(sr,"revision was not submitted"),"err");return;}
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
        if(!cr.ok){setASS("");flash(failMsg(cr,"draft was not saved"),"err");return;}
        pid=cr.id;projectIdRef.current=pid;
      }else{
        const ur=await updateProject({id:pid,projectName:fields.projectName,client:fields.client,engineerName:fields.engineerName,refNumber:fields.refNumber,systemType:fields.systemType,ownedBy:project?.ownedBy||(isAdmin(user)?null:user.username),grantedTo:project?.grantedTo||[]});
        if(ur.lockLost){setASS("");loseLock(ur.lock);flash("Not saved — you no longer hold the edit lock for this project.","err");return;}
        if(!ur.ok){setASS("");flash(failMsg(ur,"draft was not saved"),"err");return;}
      }
      const sr=await saveDraft(pid,buildRevData(),user.username||user.displayName);
      if(sr.lockLost){setASS("");loseLock(sr.lock);flash("Not saved — you no longer hold the edit lock for this project.","err");return;}
      if(!sr.ok){setASS("");flash(failMsg(sr,"draft was not saved"),"err");return;}
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

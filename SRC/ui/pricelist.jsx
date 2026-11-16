// Price List tab.
// Split out of app.jsx in v2.0.0 — the code itself is unchanged.
import { useState, useEffect, useRef, Fragment } from "react";
import { addPriceItem, appendPriceList, deletePriceItem, failMsg, loadPriceList, loadSettings, replacePriceList, saveSettings, uid, updatePriceItem } from "../lib/api.js";
import { autoPartNumber, normalizeBrand, parseCSV, toCSV } from "../lib/quote.js";
import { BrandSelector, C } from "./common.jsx";
import { ItemSearchDropdown } from "./editor.jsx";

// ─── Price List ───────────────────────────────────────────────────────────────
export function PriceListTab(){
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
  const saveEdit=async()=>{if(!form.description.trim()&&!form.modelNo.trim()){flash("Need description or model.","err");return;}const r=await updatePriceItem({...form,id:editId,glp:parseFloat(form.glp)||0,local:parseFloat(form.local)||0,brand:normalizeBrand(form.brand,allBrands)});if(!r.ok){flash(failMsg(r,"item was not updated"),"err");return;}cancelEdit();reload();flash("Updated.");};
  const addNew=async()=>{if(!form.description.trim()&&!form.modelNo.trim()){flash("Need description or model.","err");return;}const r=await addPriceItem({id:uid(),...form,glp:parseFloat(form.glp)||0,local:parseFloat(form.local)||0,brand:normalizeBrand(form.brand,allBrands)});if(!r.ok){flash(failMsg(r,"item was not added"),"err");return;}setForm({description:"",modelNo:"",brand:"",glp:"",local:"",notes:""});const nl=await loadPriceList();setItems(nl);setSearch("");setPage(Math.max(1,Math.ceil(nl.length/PS)));flash("Added.");};
  const delItem=async id=>{if(!window.confirm("Delete?"))return;const r=await deletePriceItem(id);if(!r.ok){flash(failMsg(r,"item was not deleted"),"err");return;}reload();};
  const handleFile=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{const p=parseCSV(ev.target.result);if(!p.length){flash("No valid rows.","err");return;}setImportPreview(p);};r.readAsText(f);e.target.value="";};
  const confirmImport=async mode=>{if(!importPreview)return;const r=mode==="replace"?await replacePriceList(importPreview):await appendPriceList(importPreview);if(!r.ok){flash(failMsg(r,"import was not saved"),"err");return;}const nl=await loadPriceList();setItems(nl);const s=await loadSettings();const brands=[...new Set(nl.map(i=>i.brand).filter(Boolean))];brands.forEach(b=>{if(!s.defaultBrandFactors[b])s.defaultBrandFactors[b]=1;});await saveSettings(s);setImportPreview(null);flash(`${importPreview.length} items ${mode==="replace"?"imported":"appended"}. Brands synced.`);};
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
    if(!r.ok){flash(failMsg(r,"template was not saved"),"err");return;}
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

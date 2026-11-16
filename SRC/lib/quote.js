// Quotation maths and parsing: CSV, factors, subsystems, row numbers, Solution Navigator import, rounding.
// Split out of app.jsx in v2.0.0 — the code itself is unchanged.
import ExcelJS from "exceljs";
import { uid } from "./api.js";

export function parseCSV(text) {
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
export function toCSV(items){
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
export const fNum=(v,fb)=>{const n=parseFloat(v);return isNaN(n)?fb:n;};
export function itemFactors(item,brandFactors,localFactor){
  const bf=(brandFactors||{})[item.brand]??1, lf=localFactor??1;
  if(!item.customFactor)return{bf,lf,custom:false};
  return{bf:fNum(item.itemBrandFactor,bf),lf:fNum(item.itemLocalFactor,lf),custom:true};
}
export function calcUnitPrice(item,brandFactors,localFactor){const f=itemFactors(item,brandFactors,localFactor);return((item.glp||0)*f.bf)+((item.local||0)*f.lf);}
// Turn custom factors on for one item, pre-filled with the factors it uses right now.
export const withCustomFactor=(item,brandFactors,localFactor)=>{const f=itemFactors(item,brandFactors,localFactor);return{...item,customFactor:true,itemBrandFactor:f.bf,itemLocalFactor:f.lf};};
// Turn them off again: the item goes back to the project's factors.
export const withoutCustomFactor=item=>{const{customFactor,itemBrandFactor,itemLocalFactor,...rest}=item;return rest;};
export const fmtFactor=n=>String(+(+n||0).toFixed(3));
// Effective (total) factor per brand, from the reverse calculation
//   Σ(GLP × qty × factor) = GLP_total × Factor_total  ⇒  Factor_total = Σ(GLP × qty × factor) ÷ GLP_total
// and the same for Local. Optional items are left out; subsystem children count × the subsystem qty.
// Amounts are in USD before currency conversion / rounding.
export function factorSummary(lines,brandFactors,localFactor){
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
export function assignRowNums(lines){
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
export function ssChildUnitTotal(ss,brandFactors,localFactor){
  return(ss.children||[]).filter(c=>!c.optional).reduce((s,c)=>s+calcUnitPrice(c,brandFactors,localFactor)*c.qty,0);
}
export function ssUnitPrice(ss,brandFactors,localFactor){return ss.optional?0:ssChildUnitTotal(ss,brandFactors,localFactor);}
export function ssUnitPrice1(ss,brandFactors,localFactor){return ssChildUnitTotal(ss,brandFactors,localFactor);}
export function ssTotal(ss,brandFactors,localFactor){return ss.optional?0:ssUnitPrice(ss,brandFactors,localFactor)*(ss.qty||1);}
export function autoPartNumber(ss){return(ss.children||[]).map(c=>c.modelNo||"").filter(Boolean).join("\n");}

// ─── Solution Navigator Excel import ───────────────────────────────────────────
// Header name -> internal field. Matching is case-insensitive, trimmed, whitespace-collapsed.
export const SOLNAV_HEADER_MAP = {
  "code number":      "modelNo",
  "description":      "description",
  "unit list price":  "glp",
  "ext quantity":     "qty",
  "designation":      "designation",
};
export const REQUIRED_SOLNAV_FIELDS = ["modelNo","description","glp","qty"]; // designation is optional context, not required

export function normalizeHeader(h){return String(h??"").trim().toLowerCase().replace(/\s+/g," ");}

// Parse "$2,392.05" / "1,250" / " 4 " -> number. Returns fallback if unparsable.
export function parseMoneyOrNum(raw, fallback=0){
  if(raw===null||raw===undefined)return fallback;
  const s=String(raw).replace(/[$,\s]/g,"");
  const n=parseFloat(s);
  return isNaN(n)?fallback:n;
}

// Reads an ArrayBuffer (Solution Navigator .xlsx export) and returns
// { ok:true, designation, children:[{modelNo,description,brand,glp,local,qty,notes,isCustom}] }
// or { ok:false, error:"..." } if required headers are missing.
export async function parseSolutionNavigatorExcel(arrayBuffer){
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
export function expandForCalc(lines){
  const out=[];
  for(const l of lines){
    if(l.type==="subsystem"){if(l.optional)continue;for(const c of(l.children||[])){if(!c.optional)out.push({...c,qty:c.qty*(l.qty||1)});}}
    else if(l.type!=="section"&&!l.optional){out.push(l);}
  }
  return out;
}
export function applyRounding(val,round,rate){const r=rate??1;const c=val*r;if(round)return Math.ceil(c);return Math.round(c*100)/100;}
export const fmtN=(n,round)=>round?Math.ceil(n).toLocaleString("en-US"):Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
export const fmtR=(n,round,curr)=>fmtN(n,round)+" "+curr;

export function normalizeBrand(name,existingBrands){
  if(!name||!name.trim())return name;
  const lower=name.toLowerCase().trim();
  const match=(existingBrands||[]).find(b=>b.toLowerCase()===lower);
  return match||name.trim();
}

// Printable documents (quotation, detailed, part numbers, BOM, issue slip, client BoM) and CSV exports.
// Split out of app.jsx in v2.0.0 — the code itself is unchanged.
import { applyRounding, assignRowNums, calcUnitPrice, factorSummary, fmtFactor, fmtN, itemFactors, ssUnitPrice, ssUnitPrice1 } from "../lib/quote.js";
import { footerHTML, headerHTML, printBtn } from "../ui/common.jsx";

//styles
export const tot_Normal_Style = "border:1px solid #ddd;padding:7px 10px;text-align:right;font-weight:700;";
export const tot_emphasized_style = "border:1px solid #ddd;padding:8px 10px;text-align:right;font-weight:700;font-size:14px;color:#c0392b;";
// Generate part number HTML for subtable in BOM/Detailed PDFs
export function subsystemSubtableHTML(ss,ssQty,colSpan,showPrice,brandFactors,localFactor,rnd,fmtN,lUD,lT){
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
export function factorNoteHTML(item,brandFactors,localFactor){
  const f=itemFactors(item,brandFactors,localFactor);
  return`<div style="font-size:9px;font-weight:400;color:${f.custom?"#1d4ed8":"#999"};white-space:nowrap;">×${fmtFactor(f.bf)}${item.local?` · L×${fmtFactor(f.lf)}`:""}${f.custom?" ★":""}</div>`;
}
export const factorNoteText=(item,brandFactors,localFactor)=>{const f=itemFactors(item,brandFactors,localFactor);return`×${fmtFactor(f.bf)}${item.local?` / L×${fmtFactor(f.lf)}`:""}${f.custom?" (custom)":""}`;};
export function subsystemSubtableHTML2(ss,ssQty,colSpan,showPrice,brandFactors,localFactor,rnd,fmtN,lUD,lT){
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
export const openWin=(html)=>{
  const blob=new Blob([html],{type:"text/html;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const w=window.open(url,"_blank");
  if(!w)alert("Allow popups to view PDF.");
  // Revoke the object URL after a short delay to free memory
  setTimeout(()=>URL.revokeObjectURL(url),60000);
};
export const sectionRowHTML=(label,colspan)=>`<tr><td colspan="${colspan}" style="background:#c0392b;color:#fff;font-weight:700;text-align:center;padding:7px 10px;border:1px solid #a93226;font-size:12px;letter-spacing:0.3px;">${label||"Section"}</td></tr>`;;
export const sectionRowHTML2=(label,colspan)=>`<tr><td colspan="${colspan}" style="background:#c0392b;color:#fff;font-weight:700;text-align:center;padding:7px 10px;border:1px solid #a93226;font-size:12px;letter-spacing:0.3px;">${label||"Section"}</td></tr>`;;

// Measure how many physical pages a table's rows will actually span when printed.
// Renders the REAL thead/body HTML into a hidden, off-screen container sized to
// match the print page's content width, so measured row heights are accurate —
// then buckets rows against the true per-page height budget (derived from the
// actual @page size/margins, not a guessed constant).
export function estimateContentPages(theadRowHTML, bodyRowsHTML, headerBlockHTML) {
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

export function generatePDF(project, rev, settings, tplId) {
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
  const showTerms=tpl.includeTerms!==false; // template setting (v1.2.0); older templates have no flag = include
  const totalPages=(showTerms?2:1)+contentPages; // cover (+ T&C page) + item pages

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
  ${showTerms?`<div class="page">${hdr}<h3 style="margin-top:0;">Terms &amp; Conditions</h3><div style="white-space:pre-wrap;font-size:12px;line-height:1.8;">${tpl.termsAndConditions||""}</div>
  </div>`:""}
  <div class="page">${hdr}${titleBlockHTML}
  <table style="width:100%;font-size:12px;border-collapse:collapse;">
    <thead>${theadRowHTML}</thead>
    <tbody>${itemRows}${totRows}</tbody>
  </table>
  ${rev.notes?`<div style="margin-top:16px;padding:10px 14px;background:#f9f9f9;border:1px solid #ddd;border-radius:4px;font-size:12px;white-space:pre-wrap;"><strong>Notes:</strong><br/>${rev.notes}</div>`:""}
  ${printBtn}</body></html>`);
}

export function exportQuotationCSV(project,rev){
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

export function generateBOMPDF(project,rev,settings){
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

export function generateIssueSlipPDF(project,rev,settings){
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

export function exportBOMCSV(project,rev){
  rev={...(rev.data||{}),...rev};
  const rows=[[`BOM — ${project.projectName}`],[`Code: ${rev.code}`],[`Date: ${rev.date||""}`],[],
    ["#","Model No","Brand","Description","Qty"],
    ...(() => { const ls=rev.lines||[]; const out=[]; for(let i=0;i<ls.length;i++){const l=ls[i]; if(l.type==="section"){out.push([l.label||"Section","","","",""]);continue;} if(l.type==="subsystem"){out.push([l.rowNum,"",l.description+" (Subsystem ×"+(l.qty||1)+")"+(l.optional?" — OPTIONAL":""),""]);(l.children||[]).forEach((c,ci)=>out.push(["  └"+(ci+1),c.modelNo||"",c.brand||"",c.description||"",c.optional?"Optional":c.qty*(l.qty||1)]));continue;} const grp=l.mergeGroup;const isSubEntry=grp&&ls[i-1]?.mergeGroup===grp;out.push([isSubEntry?"":l.rowNum,l.modelNo||"",l.brand||"",l.description||"",l.optional?"Optional":l.qty]);} return out; })(),
  ];
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`BOM_${rev.code}.csv`;a.click();
}

export function generateDetailedPDF(project, rev, settings, tplId){
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

export function exportDetailedCSV(project,rev){
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
export function generatePartNumPDF(project, rev, settings, tplId) {
  rev={...(rev.data||{}),...rev};
  const curr=rev.currency||"USD",rnd=rev.roundUp,rate=rev.conversionRate||1;
  // template chosen in the export dialog (v2.1.2); falls back to the default template
  const tpl=settings.templates.find(t=>t.id===tplId)||settings.templates.find(t=>t.id===settings.defaultTemplateId)||settings.templates[0];
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
  const showTerms=tpl.includeTerms!==false; // template setting (v1.2.0); older templates have no flag = include
  const totalPages=(showTerms?2:1)+contentPages; // cover (+ T&C page) + item pages

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
  ${showTerms?`<div class="page">${hdr}<h3 style="margin-top:0;">Terms &amp; Conditions</h3><div style="white-space:pre-wrap;font-size:12px;line-height:1.8;">${tpl.termsAndConditions||""}</div>
  </div>`:""}
  <div class="page">${hdr}${titleBlockHTML}
  <table style="width:100%;font-size:12px;border-collapse:collapse;">
    <thead>${theadRowHTML}</thead>
    <tbody>${itemRows}${totRows}</tbody>
  </table>
  ${rev.notes?`<div style="margin-top:16px;padding:10px 14px;background:#f9f9f9;border:1px solid #ddd;border-radius:4px;font-size:12px;white-space:pre-wrap;"><strong>Notes:</strong><br/>${rev.notes}</div>`:""}
  ${printBtn}</body></html>`);
}
export function ClientBoM(project, rev, settings, tplId) {
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
export function exportPartNumCSV(project,rev){
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
export const XLSX_TEMPLATE_MAP = {
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
export const XLSX_I_FORMULA = 'IF($H$37>0,SUMPRODUCT(INDIRECT(ADDRESS(ROW(),COLUMN()+2)):INDIRECT(ADDRESS(ROW(),COLUMN()+1+$H$37)),INDIRECT(ADDRESS(37,COLUMN()+2)):INDIRECT(ADDRESS(37,COLUMN()+1+$H$37))),0)';

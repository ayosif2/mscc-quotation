// Excel export from the bundled template.
// Split out of app.jsx in v2.0.0 — the code itself is unchanged.
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { XLSX_I_FORMULA, XLSX_TEMPLATE_MAP } from "./pdf.js";
import { res } from "../lib/api.js";
import { XLSX_TEMPLATE_URL } from "../lib/constants.js";
import { applyRounding, calcUnitPrice, ssChildUnitTotal, ssUnitPrice } from "../lib/quote.js";

// Converts a 0-based column index (0=A, 10=K...) into a spreadsheet column letter.
export function xlsxColLetter(idx0){
  let n=idx0+1, s="";
  while(n>0){ const rem=(n-1)%26; s=String.fromCharCode(65+rem)+s; n=Math.floor((n-1)/26); }
  return s;
}

export async function generateExcelExport(project, rev, settings) {
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
export async function reinjectHeaderFooterImages(templateBuffer, exceljsBuffer) {
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

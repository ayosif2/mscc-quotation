// Company constants, app version and the default settings / templates.
// Split out of app.jsx in v2.0.0 — the code itself is unchanged.

// ─── Constants ────────────────────────────────────────────────────────────────
export const LOGO_URL = "https://static.wixstatic.com/media/0b6472_98229db8a906487eb945955cdb276022~mv2.png/v1/fill/w_259,h_125,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/0b6472_98229db8a906487eb945955cdb276022~mv2.png";
export const SITE_URL = "https://www.mscc-eg.com/";
// Injected at build time from package.json by vite.config.js (bump it with release.ps1).
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
export const VERSION_URL = "https://github.com/ayosif2"; // the version label links here
// Bundled Excel output template. Place the .xlsx file at this path under /public
// (served as a static asset — works the same under `npm run dev` and under
// start.bat's built dist served by server.js, since it's just a GET of a static file).
// Nothing ever writes back to this file: every export re-fetches these bytes fresh
// and edits an in-memory copy, so the template on disk is never touched.
export const XLSX_TEMPLATE_URL = "/templates/quotation_template.xlsx";
export const DEFAULT_SETTINGS = {
  company:{ name:"Mega Systems & Control Co.", address:"49 Abbas Elakkad, Nasr City, Cairo", poBox:"P.O. Box 8077", city:"11371 Nasr City, Cairo", phone:"+202-24011172/3", mobile:"+20-1017848999", email:"info@mscc-eg.com" },
  defaultCurrency:"USD", defaultLocalFactor:1, defaultBrandFactors:{},
  templates:[{ id:"default", name:"Default Template",
    coverLetter:`Dear Sir,\n\nThank you for giving Mega Systems & Control the opportunity to present you with this proposal for your inquiry. This document contains our budgetary quotation & payment terms. Please find here below our proposal prepared as per provided project documents.\n\nPayment & Terms\n\nPrices:\nAll prices exclude VAT.\nAll prices are in {currency}.\n\nValidity: 3 Days from offer date.\nWarranty: 12 Months from elementary Hand over Date.\n\nPayment\n*Down payments against check (No additional charges)\n\nA) For Material\n50% down payment, 50% upon material readiness.\n\nB) For Engineering, T&C\n50% Down Payment, 50% after final submission`,
    termsAndConditions:`1. The return of items are allowed within 3 days from the date of receipt of the items without any discounts.\n2. 5% administrative expenses are deducted from the value of the total invoice in case of return within 14 days from the date of receipt.\n3. It will not be allowed to accept the return after 14 days from the date of receipt except in the event of manufacturing defects.\n4. The company is not responsible for running out of quantity (stock availability) in case of delayed purchase.\n5. The validity of the PO is two days maximum.\n6. In case of non stock items, the new items are delivered at the daily dollar rate.\n7. The validity of the offer is 3 days.\n8. The PO does not imply the reservation of the items.\n9. Our prices for T&C inside Cairo and Giza otherwise transportation and accommodation to be added.\n10. Supervision include: Testing of wires & devices; Programming; Testing the system; Training; Documentation if needed; Graphics if needed.\n11. Warranty certificate and Graphics Dongle (if included) will be provided after last payment.\n12. Number of Supervision visits to be set based on technical team assessment (1 visit before installation & 1 visit/4 loops).\n13. Visit requests shall take 5 to 7 working days to be processed.\n14. Single line diagrams, Riser diagrams, Shop drawings are essential for revision before installation.\n15. Project Submissions or Handovers entity shall be identified initially. T&C package includes 1 handover to a single entity.\n16. Stabilizers and UPS should be available on site.\n17. Project timeline and expected timetables shall be identified before start of supervision.\n18. Price of supervision is valid for 6 months after full material supply.`,
  }],
  defaultTemplateId:"default",
};

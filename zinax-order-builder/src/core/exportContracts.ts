// Export contracts — a declarative summary of what each export action
// produces. The Export Schema screen renders straight from this file so
// the "shared core" claim is demonstrable, not just asserted in prose.
import { PRODUCTION_CSV_COLUMNS } from "./csvSchema";

export const PRODUCTION_CSV_CONTRACT = {
  id: "production-csv",
  fileNameHint: "ZX-<order_no>-production.csv",
  consumer: "FIROO CAM (import only)",
  columns: PRODUCTION_CSV_COLUMNS,
  excludes: [
    "unit_price",
    "discount",
    "VAT",
    "invoice total",
    "payment status",
    "bank details",
    "tool number",
    "CNC data",
  ],
};

export const ORDER_PDF_CONTRACT = {
  id: "order-pdf",
  fileNameHint: "ZX-<order_no>-order-sheet.pdf",
  consumer: "Customer approval / production floor",
  sections: ["Header", "Door Order Table", "Total Doors / Total Area", "Signatures & Stamp"],
};

export const INVOICE_PDF_CONTRACT = {
  id: "invoice-pdf",
  fileNameHint: "ZX-<order_no>-proforma-invoice.pdf",
  consumer: "Customer billing (proforma only, invoice mode must be ON)",
  sections: ["Header", "Bill To", "Invoice Table", "Totals", "Payment Details", "Signatures & Stamp"],
};

export const PDF_OUTPUTS = [ORDER_PDF_CONTRACT, INVOICE_PDF_CONTRACT];

export const DISABLED_CNC_FEATURES = [
  "No G-code",
  "No DXF",
  "No Tool Database",
  "No Machine Settings",
  "No ATC",
  "No Feed Rate / Spindle Speed",
  "No CNC Simulation",
];

export const SHARED_CORE_STATEMENTS = [
  "Web UI uses the shared order schema",
  "Windows app will use the same shared schema",
  "FIROO CAM imports the Production CSV produced from this schema",
];

export const ARCHITECTURE_NOTE =
  "Web and Windows editions use the same shared order schema and export rules.";

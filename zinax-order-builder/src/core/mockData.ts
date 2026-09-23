// Mock/sample data only — no backend, no persistence. For UI preview
// purposes. Company-editable catalogs (design codes, PVC colors, MDF
// thickness, grain directions) live in core/catalogSchema.ts instead —
// see Settings.
import { generateOrderNo, makeDefaultRow, type OrderHeader, type OrderRow } from "./orderSchema";
import { generateInvoiceNo, type Invoice } from "./invoiceSchema";

export const CURRENCIES = ["AED", "SAR", "USD", "QAR", "OMR"];

export const SALESPERSONS = ["Ahmed Al Mansoori", "Sara Khalid", "Yousef Haddad", "Layla Nasser"];

export const STATUS_STYLES: Record<string, string> = {
  Draft: "bg-ink-100 text-ink-600",
  "Ready for Production": "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  Invoiced: "bg-navy-50 text-navy-700 ring-1 ring-navy-200",
  Exported: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
};

export function makeInitialRows(): OrderRow[] {
  return [
    makeDefaultRow({
      designCode: "ZD001",
      designName: "Classic Offset Door",
      width: 500,
      height: 900,
      qty: 2,
      mdfThickness: "18 mm",
      pvcCode: "PVC-101",
      pvcColor: "Walnut",
      grain: "Vertical",
      unitPrice: 185,
      discount: 0,
      vat: 5,
      notes: "",
    }),
    makeDefaultRow({
      designCode: "ZD002",
      designName: "Double Offset Door",
      width: 450,
      height: 850,
      qty: 4,
      mdfThickness: "18 mm",
      pvcCode: "PVC-202",
      pvcColor: "Oak",
      grain: "Vertical",
      unitPrice: 165,
      discount: 5,
      vat: 5,
      notes: "",
    }),
    makeDefaultRow({
      designCode: "ZD003",
      designName: "Modern Groove Door",
      width: 600,
      height: 920,
      qty: 1,
      mdfThickness: "18 mm",
      pvcCode: "PVC-305",
      pvcColor: "Stone Gray",
      grain: "Horizontal",
      unitPrice: 210,
      discount: 0,
      vat: 5,
      notes: "Sample piece — confirm color before production",
    }),
  ];
}

export function makeInitialHeader(): OrderHeader {
  return {
    orderNo: generateOrderNo(2026, 149),
    orderDate: "2026-09-15",
    customerName: "Khalid Al Farsi",
    companyName: "Al Farsi Interiors LLC",
    phone: "+971 50 123 4567",
    whatsapp: "+971 50 123 4567",
    email: "khalid.alfarsi@example.com",
    address: "Marina District, Dubai, UAE",
    taxNumber: "",
    projectName: "Marina Residence Kitchen — Phase 2",
    salesperson: "Ahmed Al Mansoori",
    deliveryDate: "2026-09-29",
    currency: "AED",
    notes: "Client requested matte finish samples before final production run.",
  };
}

export function makeInitialInvoice(): Invoice {
  return {
    invoiceNo: generateInvoiceNo(2026, 91),
    invoiceDate: "2026-09-15",
    dueDate: "2026-09-29",
    paymentTerms: "50% advance, 50% on delivery",
    vat: 5,
    currency: "AED",
    bankDetails: "Emirates NBD — IBAN AE07 0331 1234 5678 9012 345 — Al Farsi Interiors LLC",
    paidAmount: 700,
    orderDiscountPercent: 0,
    documentType: "invoice",
    notes: "Proforma invoice — subject to final confirmation of quantities.",
  };
}

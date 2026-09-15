// Mock data only — no backend, no persistence. For UI preview purposes.

export const CURRENCIES = ["AED", "SAR", "USD", "QAR", "OMR"];

export const GRAIN_DIRECTIONS = ["Vertical", "Horizontal"];

export const MDF_THICKNESS = ["16 mm", "18 mm", "22 mm", "25 mm"];

export const DESIGN_LIBRARY = [
  { code: "ZD001", name: "Classic Offset Door" },
  { code: "ZD002", name: "Double Offset Door" },
  { code: "ZD003", name: "Modern Groove Door" },
  { code: "ZD004", name: "Shaker V-Groove" },
  { code: "ZD005", name: "Raised Panel Classic" },
];

export const PVC_COLORS = [
  { code: "PVC-101", color: "Walnut" },
  { code: "PVC-202", color: "Oak" },
  { code: "PVC-305", color: "Stone Gray" },
  { code: "PVC-410", color: "Matte White" },
  { code: "PVC-512", color: "Graphite" },
];

export const SALESPERSONS = ["Ahmed Al Mansoori", "Sara Khalid", "Yousef Haddad", "Layla Nasser"];

export const STATUS_STYLES = {
  Draft: "bg-ink-100 text-ink-600",
  "Ready for Production": "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  Invoiced: "bg-navy-50 text-navy-700 ring-1 ring-navy-200",
  Exported: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
};

export const RECENT_ORDERS = [
  {
    orderNo: "ZX-2026-0148",
    date: "2026-09-12",
    customer: "Khalid Al Farsi",
    project: "Marina Residence Kitchen",
    salesperson: "Ahmed Al Mansoori",
    totalDoors: 42,
    status: "Ready for Production",
  },
  {
    orderNo: "ZX-2026-0147",
    date: "2026-09-11",
    customer: "Al Reem Interiors LLC",
    project: "Al Reem Villa – Wardrobes",
    salesperson: "Sara Khalid",
    totalDoors: 96,
    status: "Invoiced",
  },
  {
    orderNo: "ZX-2026-0146",
    date: "2026-09-10",
    customer: "Fatima Al Zaabi",
    project: "Downtown Apartment Fit-out",
    salesperson: "Yousef Haddad",
    totalDoors: 18,
    status: "Exported",
  },
  {
    orderNo: "ZX-2026-0145",
    date: "2026-09-09",
    customer: "Elite Woodworks Trading",
    project: "Business Bay Show Kitchen",
    salesperson: "Layla Nasser",
    totalDoors: 27,
    status: "Draft",
  },
  {
    orderNo: "ZX-2026-0144",
    date: "2026-09-08",
    customer: "Omar Bin Sulayem",
    project: "Emirates Hills Master Suite",
    salesperson: "Ahmed Al Mansoori",
    totalDoors: 64,
    status: "Exported",
  },
  {
    orderNo: "ZX-2026-0143",
    date: "2026-09-06",
    customer: "Al Nakheel Contracting",
    project: "Palm Villas – Batch 3",
    salesperson: "Sara Khalid",
    totalDoors: 120,
    status: "Ready for Production",
  },
];

export const DASHBOARD_STATS = {
  totalOrders: 148,
  draftOrders: 9,
  exportedCsv: 112,
  pendingInvoices: 14,
};

let rowIdCounter = 1;
export function nextRowId() {
  return `row-${rowIdCounter++}`;
}

export function makeDefaultRow(overrides = {}) {
  return {
    id: nextRowId(),
    designCode: "",
    designName: "",
    width: "",
    height: "",
    qty: 1,
    mdfThickness: "18 mm",
    pvcCode: "",
    pvcColor: "",
    grain: "Vertical",
    unitPrice: "",
    discount: 0,
    vat: 5,
    notes: "",
    ...overrides,
  };
}

export function makeInitialRows() {
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

export function makeInitialHeader() {
  return {
    orderNo: "ZX-2026-0149",
    orderDate: "2026-09-15",
    customerName: "Khalid Al Farsi",
    companyName: "Al Farsi Interiors LLC",
    phone: "+971 50 123 4567",
    projectName: "Marina Residence Kitchen — Phase 2",
    salesperson: "Ahmed Al Mansoori",
    deliveryDate: "2026-09-29",
    currency: "AED",
    notes: "Client requested matte finish samples before final production run.",
  };
}

export function makeInitialInvoice() {
  return {
    invoiceNo: "INV-2026-0091",
    invoiceDate: "2026-09-15",
    dueDate: "2026-09-29",
    paymentTerms: "50% advance, 50% on delivery",
    vat: 5,
    currency: "AED",
    bankDetails: "Emirates NBD — IBAN AE07 0331 1234 5678 9012 345 — Al Farsi Interiors LLC",
    paidAmount: 700,
    notes: "Proforma invoice — subject to final confirmation of quantities.",
  };
}

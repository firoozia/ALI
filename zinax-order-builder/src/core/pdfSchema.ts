// PDF data models. The Order PDF and Proforma Invoice PDF previews/exports
// render from these shapes rather than reaching into raw header/row/invoice
// state themselves, so any PDF renderer (image-based, text-based, or a
// future Windows-native one) works from the exact same data. No totals or
// business math are computed in this file beyond calling into
// core/calculations.ts — PDF components must never recompute a total.
import type { OrderHeader, OrderRow } from "./orderSchema";
import type { Invoice, InvoiceDocumentType } from "./invoiceSchema";
import type { CompanyProfile } from "./companyProfile";
import type { PdfTemplateSettings } from "./pdfTemplateSchema";
import { balanceDue, formatCurrency, lineTotal, type OrderTotals } from "./calculations";
import { PRODUCT_MELAMINE } from "./melamine";

/**
 * The Order PDF's melamine panel table — shared by the downloadable PDF and
 * the on-screen preview so the two cannot drift. Edges read E1 bottom, E2 top,
 * E3 left, E4 right (seen from the front), exactly as ZINAX CAM prints them.
 */
export interface MelaminePdfColumn {
  key: "no" | "name" | "width" | "height" | "qty" | "thickness" | "colorCode" | "color"
    | "edge1" | "edge2" | "edge3" | "edge4" | "rotation" | "design" | "notes" | "unitPrice" | "lineTotal";
  label: string;
  flex: number;
}

/** Invoice "Design Code" cell: a plain melamine panel has no design, so name it as a panel instead of "-". */
export function invoiceItemCode(row: OrderRow): string {
  if (row.designCode) return row.designCode;
  if (row.productType === PRODUCT_MELAMINE) return row.designName ? `Panel: ${row.designName}` : "Panel";
  return "";
}

export function melaminePdfColumns(showPrices: boolean): MelaminePdfColumn[] {
  const base: MelaminePdfColumn[] = [
    { key: "no", label: "No.", flex: 0.45 },
    { key: "name", label: "Part", flex: 1.3 },
    { key: "width", label: "Width", flex: 0.7 },
    { key: "height", label: "Height", flex: 0.7 },
    { key: "qty", label: "Qty", flex: 0.5 },
    { key: "thickness", label: "Thick.", flex: 0.7 },
    { key: "colorCode", label: "Color Code", flex: 0.9 },
    { key: "color", label: "Color", flex: 0.9 },
    { key: "edge1", label: "E1 Bottom", flex: 0.7 },
    { key: "edge2", label: "E2 Top", flex: 0.7 },
    { key: "edge3", label: "E3 Left", flex: 0.7 },
    { key: "edge4", label: "E4 Right", flex: 0.7 },
    { key: "rotation", label: "Rotation", flex: 0.75 },
    { key: "design", label: "Design", flex: 0.8 },
    { key: "notes", label: "Notes", flex: 1.4 },
  ];
  if (!showPrices) return base;
  return [...base, { key: "unitPrice", label: "Unit Price", flex: 0.9 }, { key: "lineTotal", label: "Line Total", flex: 1 }];
}

export function melaminePdfCell(row: OrderRow, key: MelaminePdfColumn["key"], index: number, currency: string): string {
  switch (key) {
    case "no": return String(index + 1);
    case "name": return row.designName || "-";
    case "width": return String(row.width || "-");
    case "height": return String(row.height || "-");
    case "qty": return String(row.qty || "-");
    case "thickness": return row.mdfThickness || "-";
    case "colorCode": return row.pvcCode || "-";
    case "color": return row.pvcColor || "-";
    case "edge1": return row.edge1 || "N";
    case "edge2": return row.edge2 || "N";
    case "edge3": return row.edge3 || "N";
    case "edge4": return row.edge4 || "N";
    case "rotation": return row.rotation === "N" ? "N (locked)" : row.rotation === "Y" ? "Y" : row.rotation;
    case "design": return row.designCode || "Plain";
    case "notes": return row.notes || "-";
    case "unitPrice": return formatCurrency(row.unitPrice, currency);
    case "lineTotal": return formatCurrency(lineTotal(row), currency);
  }
}

/**
 * The invoice/quotation line-item table's columns — shared by the
 * downloadable PDF (lib/pdf/reactPdfInvoiceDocument.tsx) and the on-screen
 * preview (pages/InvoicePdfPreview.tsx) so the two can never drift apart
 * the way they previously did (one got fixed, the other kept showing the
 * old columns). Only the design + PVC/color codes identify the line item —
 * no design name/description, per the production team's request.
 */
export interface InvoiceLineColumn {
  key: "no" | "designCode" | "pvcCode" | "size" | "qty" | "unitPrice" | "discount" | "vat" | "lineTotal";
  label: string;
  align?: "left" | "right";
}

export const INVOICE_LINE_COLUMNS: InvoiceLineColumn[] = [
  { key: "no", label: "No." },
  { key: "designCode", label: "Design Code" },
  { key: "pvcCode", label: "PVC Code" },
  { key: "size", label: "Size" },
  { key: "qty", label: "Qty", align: "right" },
  { key: "unitPrice", label: "Unit Price", align: "right" },
  { key: "discount", label: "Discount", align: "right" },
  { key: "vat", label: "VAT", align: "right" },
  { key: "lineTotal", label: "Line Total", align: "right" },
];

// The PDF engine (@react-pdf/renderer) can only decode raster images
// (PNG/JPEG) for its <Image> component — never SVG. A logo/stamp saved
// before upload screens started rejecting unsupported formats (or edited
// directly into an imported settings file) would otherwise crash PDF
// generation with an opaque "Could not generate the PDF" error. Every
// vendor image is filtered through here on the way into a PDF model, so a
// stray non-raster value is simply omitted from the PDF instead of
// breaking it.
const PDF_SAFE_IMAGE_PREFIXES = ["data:image/png", "data:image/jpeg"];

function sanitizeVendorImage(dataUrl: string): string {
  return PDF_SAFE_IMAGE_PREFIXES.some((prefix) => dataUrl.startsWith(prefix)) ? dataUrl : "";
}

export interface OrderPdfModel {
  orderNo: string;
  date: string;
  customer: string;
  project: string;
  phone: string;
  salesperson: string;
  rows: OrderRow[];
  /** Vacuum-door rows, shown in the door table. */
  doorRows: OrderRow[];
  /** Melamine rows, shown in their own table with edges and rotation. */
  melamineRows: OrderRow[];
  totalDoors: number;
  totalPanels: number;
  totalArea: number;
  preparedBy: string;
  notes: string;
  vendorBrandName: string;
  vendorAddress: string;
  vendorPhone: string;
  vendorTaxNumber: string;
  vendorLogoUrl: string;
  vendorStampUrl: string;
  template: PdfTemplateSettings;
}

export function buildOrderPdfModel(
  header: OrderHeader,
  rows: OrderRow[],
  totals: OrderTotals,
  companyProfile: CompanyProfile,
  pdfTemplate: PdfTemplateSettings
): OrderPdfModel {
  return {
    orderNo: header.orderNo,
    date: header.orderDate,
    customer: header.customerName,
    project: header.projectName,
    phone: header.phone,
    salesperson: header.salesperson,
    rows,
    doorRows: rows.filter((r) => r.productType !== PRODUCT_MELAMINE),
    melamineRows: rows.filter((r) => r.productType === PRODUCT_MELAMINE),
    totalDoors: totals.totalDoors,
    totalPanels: totals.totalPanels,
    totalArea: totals.totalArea,
    preparedBy: header.salesperson,
    notes: header.notes,
    vendorBrandName: companyProfile.brandName,
    vendorAddress: companyProfile.address,
    vendorPhone: companyProfile.phone,
    vendorTaxNumber: companyProfile.taxNumber,
    vendorLogoUrl: sanitizeVendorImage(companyProfile.logoUrl),
    vendorStampUrl: sanitizeVendorImage(companyProfile.stampUrl),
    template: pdfTemplate,
  };
}

export interface InvoicePdfModel {
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  documentType: InvoiceDocumentType;
  /** "Quotation" when documentType is "quotation", otherwise the configured Proforma Invoice title from the PDF template. */
  documentTitle: string;
  orderNo: string;
  customerName: string;
  companyName: string;
  phone: string;
  project: string;
  paymentTerms: string;
  currency: string;
  bankDetails: string;
  notes: string;
  rows: OrderRow[];
  totals: OrderTotals;
  paidAmount: number;
  balanceDue: number;
  vendorBrandName: string;
  vendorAddress: string;
  vendorPhone: string;
  vendorTaxNumber: string;
  vendorLogoUrl: string;
  vendorStampUrl: string;
  template: PdfTemplateSettings;
}

export function buildInvoicePdfModel(
  header: OrderHeader,
  rows: OrderRow[],
  invoice: Invoice,
  totals: OrderTotals,
  companyProfile: CompanyProfile,
  pdfTemplate: PdfTemplateSettings
): InvoicePdfModel {
  const currency = invoice.currency || header.currency;
  const paidAmount = Number(invoice.paidAmount) || 0;
  return {
    invoiceNo: invoice.invoiceNo,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    documentType: invoice.documentType,
    documentTitle: invoice.documentType === "quotation" ? "Quotation" : pdfTemplate.invoicePdfTitle,
    orderNo: header.orderNo,
    customerName: header.customerName,
    companyName: header.companyName,
    phone: header.phone,
    project: header.projectName,
    paymentTerms: invoice.paymentTerms,
    currency,
    bankDetails: invoice.bankDetails,
    notes: invoice.notes,
    rows,
    totals,
    paidAmount,
    balanceDue: balanceDue(totals, paidAmount),
    vendorBrandName: companyProfile.brandName,
    vendorAddress: companyProfile.address,
    vendorPhone: companyProfile.phone,
    vendorTaxNumber: companyProfile.taxNumber,
    vendorLogoUrl: sanitizeVendorImage(companyProfile.logoUrl),
    vendorStampUrl: sanitizeVendorImage(companyProfile.stampUrl),
    template: pdfTemplate,
  };
}

export interface OrderPreviewData {
  header: OrderHeader;
  rows: OrderRow[];
  totals: OrderTotals;
  companyProfile: CompanyProfile;
  pdfTemplate: PdfTemplateSettings;
}

export interface InvoicePreviewData extends OrderPreviewData {
  invoice: Invoice;
}

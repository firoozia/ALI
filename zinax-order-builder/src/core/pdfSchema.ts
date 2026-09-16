// PDF data models. The Order PDF and Proforma Invoice PDF previews/exports
// render from these shapes rather than reaching into raw header/row/invoice
// state themselves, so any PDF renderer (image-based, text-based, or a
// future Windows-native one) works from the exact same data. No totals or
// business math are computed in this file beyond calling into
// core/calculations.ts — PDF components must never recompute a total.
import type { OrderHeader, OrderRow } from "./orderSchema";
import type { Invoice } from "./invoiceSchema";
import type { CompanyProfile } from "./companyProfile";
import type { PdfTemplateSettings } from "./pdfTemplateSchema";
import { balanceDue, type OrderTotals } from "./calculations";

export interface OrderPdfModel {
  orderNo: string;
  date: string;
  customer: string;
  project: string;
  phone: string;
  salesperson: string;
  rows: OrderRow[];
  totalDoors: number;
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
    totalDoors: totals.totalDoors,
    totalArea: totals.totalArea,
    preparedBy: header.salesperson,
    notes: header.notes,
    vendorBrandName: companyProfile.brandName,
    vendorAddress: companyProfile.address,
    vendorPhone: companyProfile.phone,
    vendorTaxNumber: companyProfile.taxNumber,
    vendorLogoUrl: companyProfile.logoUrl,
    vendorStampUrl: companyProfile.stampUrl,
    template: pdfTemplate,
  };
}

export interface InvoicePdfModel {
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
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
    vendorLogoUrl: companyProfile.logoUrl,
    vendorStampUrl: companyProfile.stampUrl,
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

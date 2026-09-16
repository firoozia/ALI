// PDF data models. The Order PDF and Proforma Invoice PDF previews render
// from these shapes rather than reaching into raw header/row/invoice state
// themselves, so the same builder functions can back a real PDF renderer
// in either edition later without the preview screens changing.
import type { OrderHeader, OrderRow } from "./orderSchema";
import type { Invoice } from "./invoiceSchema";
import type { CompanyProfile } from "./companyProfile";
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
  vendorLogoUrl: string;
}

export function buildOrderPdfModel(
  header: OrderHeader,
  rows: OrderRow[],
  totals: OrderTotals,
  companyProfile: CompanyProfile
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
    vendorLogoUrl: companyProfile.logoUrl,
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
  vendorLogoUrl: string;
}

export function buildInvoicePdfModel(
  header: OrderHeader,
  rows: OrderRow[],
  invoice: Invoice,
  totals: OrderTotals,
  companyProfile: CompanyProfile
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
    vendorLogoUrl: companyProfile.logoUrl,
  };
}

export interface OrderPreviewData {
  header: OrderHeader;
  rows: OrderRow[];
  totals: OrderTotals;
  companyProfile: CompanyProfile;
}

export interface InvoicePreviewData extends OrderPreviewData {
  invoice: Invoice;
}

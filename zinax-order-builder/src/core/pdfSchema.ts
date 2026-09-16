// PDF data models. The Order PDF and Proforma Invoice PDF previews render
// from these shapes rather than reaching into raw header/row/invoice state
// themselves, so the same builder functions can back a real PDF renderer
// in either edition later without the preview screens changing.
import type { OrderHeader, OrderRow } from "./orderSchema";
import type { Invoice } from "./invoiceSchema";
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
}

export function buildOrderPdfModel(
  header: OrderHeader,
  rows: OrderRow[],
  totals: OrderTotals
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
}

export function buildInvoicePdfModel(
  header: OrderHeader,
  rows: OrderRow[],
  invoice: Invoice,
  totals: OrderTotals
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
  };
}

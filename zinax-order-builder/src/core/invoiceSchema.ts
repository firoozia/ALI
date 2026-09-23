// Shared invoice data model — see core/orderSchema.ts for the architecture note.

export interface Invoice {
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms: string;
  vat: number | "";
  currency: string;
  bankDetails: string;
  paidAmount: number | "";
  /** Overall discount % applied to the whole order's Grand Total, on top of any per-row discounts. 0 = none. */
  orderDiscountPercent: number | "";
  notes: string;
}

export const DEFAULT_VAT_PERCENT = 5;

/** Invoice number structure: INV-<year>-<4-digit sequence>. */
export function generateInvoiceNo(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(4, "0")}`;
}

export function invoicePdfFileName(invoiceNo: string): string {
  return `${invoiceNo}_proforma_invoice.pdf`;
}

export function makeDefaultInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    invoiceNo: "",
    invoiceDate: "",
    dueDate: "",
    paymentTerms: "",
    vat: DEFAULT_VAT_PERCENT,
    currency: "AED",
    bankDetails: "",
    paidAmount: 0,
    orderDiscountPercent: 0,
    notes: "",
    ...overrides,
  };
}

// Shared validation rules — kept separate from calculations so the UI can
// highlight invalid cells without owning the definition of "invalid".
import type { OrderHeader, OrderRow } from "./orderSchema";
import { ORDER_ROW_COLUMNS } from "./orderSchema";
import type { Invoice } from "./invoiceSchema";

export const REQUIRED_ORDER_ROW_FIELDS: (keyof OrderRow)[] = ORDER_ROW_COLUMNS.filter(
  (col) => col.required
).map((col) => col.key);

export function isRowFieldInvalid(row: OrderRow, field: keyof OrderRow): boolean {
  if (!REQUIRED_ORDER_ROW_FIELDS.includes(field)) return false;
  const value = row[field];
  return value === "" || value === null || value === undefined;
}

export function rowHasErrors(row: OrderRow): boolean {
  return REQUIRED_ORDER_ROW_FIELDS.some((field) => isRowFieldInvalid(row, field));
}

export function orderHasErrors(rows: OrderRow[]): boolean {
  return rows.some(rowHasErrors);
}

export const REQUIRED_HEADER_FIELDS: { key: keyof OrderHeader; label: string }[] = [
  { key: "orderNo", label: "Order No." },
  { key: "orderDate", label: "Order Date" },
  { key: "customerName", label: "Customer Name" },
];

export function isHeaderFieldInvalid(header: OrderHeader, field: keyof OrderHeader): boolean {
  if (!REQUIRED_HEADER_FIELDS.some((f) => f.key === field)) return false;
  const value = header[field];
  return value === "" || value === null || value === undefined;
}

export function headerHasErrors(header: OrderHeader): boolean {
  return REQUIRED_HEADER_FIELDS.some((f) => isHeaderFieldInvalid(header, f.key));
}

export const REQUIRED_INVOICE_FIELDS: { key: keyof Invoice; label: string }[] = [
  { key: "invoiceNo", label: "Invoice No." },
  { key: "invoiceDate", label: "Invoice Date" },
  { key: "dueDate", label: "Due Date" },
];

export function invoiceHasErrors(invoice: Invoice): boolean {
  return REQUIRED_INVOICE_FIELDS.some((f) => {
    const value = invoice[f.key];
    return value === "" || value === null || value === undefined;
  });
}

/**
 * Human-readable validation errors for the whole order, in the order a
 * user should fix them. Used to block export and show a concrete list
 * rather than a generic "invalid" toast.
 */
export function getOrderValidationErrors(header: OrderHeader, rows: OrderRow[]): string[] {
  const errors: string[] = [];

  for (const field of REQUIRED_HEADER_FIELDS) {
    if (isHeaderFieldInvalid(header, field.key)) {
      errors.push(`${field.label} is required.`);
    }
  }

  if (rows.length === 0) {
    errors.push("At least one door row is required.");
  }

  rows.forEach((row, index) => {
    for (const field of REQUIRED_ORDER_ROW_FIELDS) {
      if (isRowFieldInvalid(row, field)) {
        const column = ORDER_ROW_COLUMNS.find((c) => c.key === field);
        errors.push(`Row ${index + 1}: ${column?.label ?? field} is required.`);
      }
    }
  });

  return errors;
}

export function getInvoiceValidationErrors(invoice: Invoice): string[] {
  const errors: string[] = [];
  for (const field of REQUIRED_INVOICE_FIELDS) {
    const value = invoice[field.key];
    if (value === "" || value === null || value === undefined) {
      errors.push(`${field.label} is required.`);
    }
  }
  return errors;
}

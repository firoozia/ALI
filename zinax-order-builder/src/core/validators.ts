// Shared validation rules — kept separate from calculations so the UI can
// highlight invalid cells without owning the definition of "invalid".
import type { OrderHeader, OrderRow } from "./orderSchema";
import { ORDER_ROW_COLUMNS } from "./orderSchema";
import type { Invoice } from "./invoiceSchema";
import { formatMdfThickness, type Catalog } from "./catalogSchema";

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

// --- Catalog-aware checks -------------------------------------------------

export function isDesignActive(catalog: Catalog, code: string): boolean {
  return catalog.designs.some((d) => d.code === code && d.active);
}

export function isPvcActive(catalog: Catalog, code: string): boolean {
  return catalog.pvcColors.some((p) => p.code === code && p.active);
}

export function isMdfThicknessActive(catalog: Catalog, mdfThickness: string): boolean {
  return catalog.mdfThickness.some((m) => m.active && formatMdfThickness(m) === mdfThickness);
}

export function isGrainActive(catalog: Catalog, grain: string): boolean {
  return catalog.grainDirections.some((g) => g.active && (g.code === grain || g.label === grain));
}

/**
 * Human-readable validation errors for the whole order, in the order a
 * user should fix them. Used to block export and show a concrete list
 * rather than a generic "invalid" toast. Catalog-aware: a design/PVC code
 * that no longer exists or was deactivated is reported just like a blank
 * field, so exports can never reference a retired catalog entry.
 */
export function getOrderValidationErrors(header: OrderHeader, rows: OrderRow[], catalog: Catalog): string[] {
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
    const n = index + 1;

    for (const field of REQUIRED_ORDER_ROW_FIELDS) {
      if (isRowFieldInvalid(row, field)) {
        const column = ORDER_ROW_COLUMNS.find((c) => c.key === field);
        errors.push(`Row ${n}: ${column?.label ?? field} is required.`);
      }
    }

    if (row.designCode && !isDesignActive(catalog, row.designCode)) {
      errors.push(`Row ${n}: Design Code "${row.designCode}" is not an active catalog design.`);
    }
    if (Number(row.width) <= 0) {
      errors.push(`Row ${n}: Width mm must be greater than 0.`);
    }
    if (Number(row.height) <= 0) {
      errors.push(`Row ${n}: Height mm must be greater than 0.`);
    }
    if (Number(row.qty) <= 0) {
      errors.push(`Row ${n}: Qty must be greater than 0.`);
    }
    if (row.mdfThickness && !isMdfThicknessActive(catalog, row.mdfThickness)) {
      errors.push(`Row ${n}: MDF Thickness "${row.mdfThickness}" is not an active setting.`);
    }
    if (!row.pvcCode) {
      errors.push(`Row ${n}: PVC Code is required.`);
    } else if (!isPvcActive(catalog, row.pvcCode)) {
      errors.push(`Row ${n}: PVC Code "${row.pvcCode}" is not an active catalog color.`);
    }
    if (row.grain && !isGrainActive(catalog, row.grain)) {
      errors.push(`Row ${n}: Grain Direction "${row.grain}" is not an active option.`);
    }
  });

  return errors;
}

/**
 * Invoice validation only applies while invoice mode is ON — a zero unit
 * price is perfectly normal while invoice mode is OFF and must never be
 * blocked.
 */
export function getInvoiceValidationErrors(invoice: Invoice, rows: OrderRow[], invoiceMode: boolean): string[] {
  if (!invoiceMode) return [];
  const errors: string[] = [];

  for (const field of REQUIRED_INVOICE_FIELDS) {
    const value = invoice[field.key];
    if (value === "" || value === null || value === undefined) {
      errors.push(`${field.label} is required.`);
    }
  }
  if (!invoice.currency) {
    errors.push("Currency is required.");
  }
  if (Number(invoice.paidAmount) < 0) {
    errors.push("Paid Amount must be 0 or greater.");
  }

  rows.forEach((row, index) => {
    const n = index + 1;
    if (Number(row.unitPrice) < 0) {
      errors.push(`Row ${n}: Unit Price must be 0 or greater.`);
    }
    const discount = Number(row.discount);
    if (discount < 0 || discount > 100) {
      errors.push(`Row ${n}: Discount % must be between 0 and 100.`);
    }
    if (Number(row.vat) < 0) {
      errors.push(`Row ${n}: VAT % must be 0 or greater.`);
    }
  });

  return errors;
}

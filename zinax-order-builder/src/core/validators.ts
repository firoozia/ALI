// Shared validation rules — kept separate from calculations so the UI can
// highlight invalid cells without owning the definition of "invalid".
import type { OrderRow } from "./orderSchema";
import { ORDER_ROW_COLUMNS } from "./orderSchema";

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

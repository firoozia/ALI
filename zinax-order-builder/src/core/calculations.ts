// Shared invoice/order calculations. Both editions must use these exact
// formulas — the UI must never re-derive totals with its own arithmetic.
import type { OrderRow } from "./orderSchema";

function num(value: number | ""): number {
  return Number(value) || 0;
}

/** line_subtotal = quantity * unit_price */
export function lineSubtotal(row: OrderRow): number {
  return num(row.qty) * num(row.unitPrice);
}

/** discount_amount = line_subtotal * discount_percent / 100 */
export function discountAmount(row: OrderRow): number {
  return (lineSubtotal(row) * num(row.discount)) / 100;
}

/** taxable_amount = line_subtotal - discount_amount */
export function taxableAmount(row: OrderRow): number {
  return lineSubtotal(row) - discountAmount(row);
}

/** vat_amount = taxable_amount * vat_percent / 100 */
export function vatAmount(row: OrderRow): number {
  return (taxableAmount(row) * num(row.vat)) / 100;
}

/** line_total = taxable_amount + vat_amount */
export function lineTotal(row: OrderRow): number {
  return taxableAmount(row) + vatAmount(row);
}

export function rowAreaSqm(row: OrderRow): number {
  return (num(row.width) / 1000) * (num(row.height) / 1000) * num(row.qty);
}

export interface OrderTotals {
  totalRows: number;
  totalDoors: number;
  totalArea: number;
  subtotal: number;
  totalDiscount: number;
  taxable: number;
  vatAmount: number;
  grandTotal: number;
  pvcConsumption: number;
}

export function computeOrderTotals(rows: OrderRow[]): OrderTotals {
  const totalDoors = rows.reduce((sum, r) => sum + num(r.qty), 0);
  const totalArea = rows.reduce((sum, r) => sum + rowAreaSqm(r), 0);
  const subtotal = rows.reduce((sum, r) => sum + lineSubtotal(r), 0);
  const totalDiscount = rows.reduce((sum, r) => sum + discountAmount(r), 0);
  const taxable = subtotal - totalDiscount;
  const vat = rows.reduce((sum, r) => sum + vatAmount(r), 0);
  const grandTotal = taxable + vat;
  // Rough estimate: PVC membrane consumption is door face area plus 10% wastage.
  const pvcConsumption = totalArea * 1.1;

  return {
    totalRows: rows.length,
    totalDoors,
    totalArea,
    subtotal,
    totalDiscount,
    taxable,
    vatAmount: vat,
    grandTotal,
    pvcConsumption,
  };
}

export function balanceDue(totals: OrderTotals, paidAmount: number | ""): number {
  return totals.grandTotal - num(paidAmount);
}

export function formatCurrency(value: number | "", currency = "AED"): string {
  const n = num(value);
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(value: number | "", digits = 2): string {
  const n = num(value);
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

import { describe, it, expect } from "vitest";
import {
  lineSubtotal,
  discountAmount,
  taxableAmount,
  vatAmount,
  lineTotal,
  computeOrderTotals,
  rowAreaSqm,
  balanceDue,
} from "../calculations";
import { makeDefaultRow } from "../orderSchema";

describe("calculations", () => {
  it("computes line_subtotal = quantity * unit_price", () => {
    const row = makeDefaultRow({ qty: 3, unitPrice: 100 });
    expect(lineSubtotal(row)).toBe(300);
  });

  it("computes discount_amount = line_subtotal * discount_percent / 100", () => {
    const row = makeDefaultRow({ qty: 2, unitPrice: 100, discount: 10 });
    expect(discountAmount(row)).toBe(20);
  });

  it("computes taxable_amount = line_subtotal - discount_amount", () => {
    const row = makeDefaultRow({ qty: 2, unitPrice: 100, discount: 10 });
    expect(taxableAmount(row)).toBe(180);
  });

  it("VAT is configurable per row and drives vat_amount / line_total", () => {
    const row5 = makeDefaultRow({ qty: 1, unitPrice: 200, discount: 0, vat: 5 });
    expect(vatAmount(row5)).toBe(10);
    expect(lineTotal(row5)).toBe(210);

    const row20 = makeDefaultRow({ qty: 1, unitPrice: 200, discount: 0, vat: 20 });
    expect(vatAmount(row20)).toBe(40);
    expect(lineTotal(row20)).toBe(240);
  });

  it("computes total area in square meters from mm dimensions", () => {
    const row = makeDefaultRow({ width: 500, height: 900, qty: 2 });
    // (0.5m * 0.9m) * 2 = 0.9 m²
    expect(rowAreaSqm(row)).toBeCloseTo(0.9, 6);
  });

  it("computeOrderTotals aggregates rows correctly", () => {
    const rows = [
      makeDefaultRow({ width: 500, height: 900, qty: 2, unitPrice: 100, discount: 0, vat: 5 }),
      makeDefaultRow({ width: 450, height: 850, qty: 4, unitPrice: 50, discount: 10, vat: 5 }),
    ];
    const totals = computeOrderTotals(rows);
    expect(totals.totalRows).toBe(2);
    expect(totals.totalDoors).toBe(6);
    expect(totals.subtotal).toBe(2 * 100 + 4 * 50); // 400
    expect(totals.totalDiscount).toBeCloseTo(20, 6); // 10% of 200 from row 2
    expect(totals.taxable).toBeCloseTo(380, 6);
    expect(totals.grandTotal).toBeGreaterThan(totals.taxable);
  });

  it("balanceDue = grandTotal - paidAmount", () => {
    const totals = computeOrderTotals([makeDefaultRow({ qty: 1, unitPrice: 100, vat: 0 })]);
    expect(balanceDue(totals, 40)).toBeCloseTo(totals.grandTotal - 40, 6);
  });
});

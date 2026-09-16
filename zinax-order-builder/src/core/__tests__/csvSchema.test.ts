import { describe, it, expect } from "vitest";
import { PRODUCTION_CSV_COLUMNS, buildCsvString, buildProductionCsvRows, buildProductionCsvString } from "../csvSchema";
import { makeDefaultRow, type OrderHeader } from "../orderSchema";

const header: OrderHeader = {
  orderNo: "ZX-2026-0001",
  orderDate: "2026-01-01",
  customerName: "Test Customer",
  companyName: "Test Co",
  phone: "+971500000000",
  whatsapp: "+971500000000",
  email: "",
  address: "",
  taxNumber: "",
  projectName: "Test Project",
  salesperson: "Ahmed",
  deliveryDate: "2026-01-15",
  currency: "AED",
  notes: "",
};

describe("csvSchema", () => {
  it("keeps the exact required column order", () => {
    const keys = PRODUCTION_CSV_COLUMNS.map((c) => c.key);
    expect(keys).toEqual([
      "order_id",
      "order_no",
      "order_date",
      "customer_name",
      "project_name",
      "phone",
      "salesperson",
      "line_no",
      "design_code",
      "design_name",
      "width_mm",
      "height_mm",
      "quantity",
      "mdf_thickness_mm",
      "pvc_code",
      "pvc_color",
      "grain_direction",
      "notes",
    ]);
  });

  it("excludes every invoice-only field", () => {
    const keys = PRODUCTION_CSV_COLUMNS.map((c) => c.key);
    for (const forbidden of ["unit_price", "discount", "vat", "invoice_total", "payment_status", "bank_details", "tool_number"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("escapes commas, quotes, and line breaks per RFC 4180", () => {
    const rows = [{ order_id: 'has "quotes", a comma, and\na newline', order_no: "plain" }];
    const csv = buildCsvString(rows, [
      { key: "order_id", header: "order_id" },
      { key: "order_no", header: "order_no" },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("order_id,order_no");
    expect(lines[1]).toBe('"has ""quotes"", a comma, and\na newline",plain');
  });

  it("builds rows with a stable 1-based line_no and no invoice data", () => {
    const rows = [
      makeDefaultRow({ designCode: "ZD001", width: 500, height: 900, qty: 2, unitPrice: 999, discount: 50, vat: 20 }),
      makeDefaultRow({ designCode: "ZD002", width: 450, height: 850, qty: 4 }),
    ];
    const csvRows = buildProductionCsvRows(header, rows);
    expect(csvRows.map((r) => r.line_no)).toEqual([1, 2]);
    expect(csvRows[0]).not.toHaveProperty("unit_price");
    expect(csvRows[0]).not.toHaveProperty("discount");
    expect(csvRows[0]).not.toHaveProperty("vat");
    expect(csvRows[0].order_no).toBe(header.orderNo);
  });

  it("produces a complete CSV string with header row via buildProductionCsvString", () => {
    const rows = [makeDefaultRow({ designCode: "ZD001", width: 500, height: 900, qty: 2 })];
    const csv = buildProductionCsvString(header, rows);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(PRODUCTION_CSV_COLUMNS.map((c) => c.header).join(","));
  });
});

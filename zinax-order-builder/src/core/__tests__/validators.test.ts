import { describe, it, expect } from "vitest";
import { getOrderValidationErrors, getInvoiceValidationErrors } from "../validators";
import { makeDefaultRow, type OrderHeader } from "../orderSchema";
import { makeDefaultCatalog } from "../catalogSchema";
import { makeDefaultInvoice } from "../invoiceSchema";

const validHeader: OrderHeader = {
  orderNo: "ZX-2026-0001",
  orderDate: "2026-01-01",
  customerName: "Test Customer",
  companyName: "",
  phone: "",
  whatsapp: "",
  email: "",
  address: "",
  taxNumber: "",
  projectName: "",
  salesperson: "",
  deliveryDate: "",
  currency: "AED",
  notes: "",
};

describe("validators — order", () => {
  it("passes for a fully valid row referencing active catalog entries", () => {
    const catalog = makeDefaultCatalog();
    const row = makeDefaultRow({
      designCode: catalog.designs[0].code,
      width: 500,
      height: 900,
      qty: 1,
      mdfThickness: "18 mm",
      pvcCode: catalog.pvcColors[0].code,
      grain: "Vertical",
    });
    expect(getOrderValidationErrors(validHeader, [row], catalog)).toEqual([]);
  });

  it("rejects a design code that does not exist in the catalog", () => {
    const catalog = makeDefaultCatalog();
    const row = makeDefaultRow({ designCode: "NOT-REAL", width: 500, height: 900, qty: 1, pvcCode: catalog.pvcColors[0].code });
    const errors = getOrderValidationErrors(validHeader, [row], catalog);
    expect(errors.some((e) => e.includes("not an active catalog design"))).toBe(true);
  });

  it("rejects a design code that exists but has been deactivated", () => {
    const catalog = makeDefaultCatalog();
    catalog.designs[0].active = false;
    const row = makeDefaultRow({ designCode: catalog.designs[0].code, width: 500, height: 900, qty: 1, pvcCode: catalog.pvcColors[0].code });
    const errors = getOrderValidationErrors(validHeader, [row], catalog);
    expect(errors.some((e) => e.includes("not an active catalog design"))).toBe(true);
  });

  it("rejects a PVC code that is missing or inactive", () => {
    const catalog = makeDefaultCatalog();
    const missing = makeDefaultRow({ designCode: catalog.designs[0].code, width: 500, height: 900, qty: 1, pvcCode: "" });
    expect(getOrderValidationErrors(validHeader, [missing], catalog).some((e) => e.includes("PVC Code is required"))).toBe(true);

    catalog.pvcColors[0].active = false;
    const inactive = makeDefaultRow({ designCode: catalog.designs[0].code, width: 500, height: 900, qty: 1, pvcCode: catalog.pvcColors[0].code });
    expect(getOrderValidationErrors(validHeader, [inactive], catalog).some((e) => e.includes("not an active catalog color"))).toBe(true);
  });

  it("rejects width/height/quantity that are zero or negative", () => {
    const catalog = makeDefaultCatalog();
    const row = makeDefaultRow({ designCode: catalog.designs[0].code, width: 0, height: -5, qty: 0, pvcCode: catalog.pvcColors[0].code });
    const errors = getOrderValidationErrors(validHeader, [row], catalog);
    expect(errors.some((e) => e.includes("Width mm must be greater than 0"))).toBe(true);
    expect(errors.some((e) => e.includes("Height mm must be greater than 0"))).toBe(true);
    expect(errors.some((e) => e.includes("Qty must be greater than 0"))).toBe(true);
  });

  it("requires header fields and at least one row", () => {
    const catalog = makeDefaultCatalog();
    const blankHeader: OrderHeader = { ...validHeader, orderNo: "", customerName: "" };
    const errors = getOrderValidationErrors(blankHeader, [], catalog);
    expect(errors).toContain("Order No. is required.");
    expect(errors).toContain("Customer Name is required.");
    expect(errors).toContain("At least one door row is required.");
  });
});

describe("validators — invoice", () => {
  it("does NOT block a zero unit price when invoice mode is OFF", () => {
    const invoice = makeDefaultInvoice();
    const row = makeDefaultRow({ unitPrice: 0, discount: 0, vat: 0 });
    expect(getInvoiceValidationErrors(invoice, [row], false)).toEqual([]);
  });

  it("requires invoice_no/invoice_date/due_date/currency when invoice mode is ON", () => {
    const invoice = { ...makeDefaultInvoice(), invoiceNo: "", invoiceDate: "", dueDate: "", currency: "" };
    const errors = getInvoiceValidationErrors(invoice, [], true);
    expect(errors).toContain("Invoice No. is required.");
    expect(errors).toContain("Invoice Date is required.");
    expect(errors).toContain("Due Date is required.");
    expect(errors).toContain("Currency is required.");
  });

  it("rejects negative unit price, out-of-range discount, and negative VAT when invoice mode is ON", () => {
    const invoice = { ...makeDefaultInvoice(), invoiceNo: "INV-1", invoiceDate: "2026-01-01", dueDate: "2026-01-15" };
    const row = makeDefaultRow({ unitPrice: -10, discount: 150, vat: -5 });
    const errors = getInvoiceValidationErrors(invoice, [row], true);
    expect(errors.some((e) => e.includes("Unit Price must be 0 or greater"))).toBe(true);
    expect(errors.some((e) => e.includes("Discount % must be between 0 and 100"))).toBe(true);
    expect(errors.some((e) => e.includes("VAT % must be 0 or greater"))).toBe(true);
  });

  it("rejects a negative paid amount", () => {
    const invoice = { ...makeDefaultInvoice(), invoiceNo: "INV-1", invoiceDate: "2026-01-01", dueDate: "2026-01-15", paidAmount: -1 };
    expect(getInvoiceValidationErrors(invoice, [], true)).toContain("Paid Amount must be 0 or greater.");
  });
});

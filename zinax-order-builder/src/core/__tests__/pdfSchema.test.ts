import { describe, it, expect } from "vitest";
import { buildOrderPdfModel, buildInvoicePdfModel } from "../pdfSchema";
import { makeInitialHeader, makeInitialInvoice, makeInitialRows } from "../mockData";
import { computeOrderTotals } from "../calculations";
import { makeDefaultCompanyProfile } from "../companyProfile";

describe("pdfSchema", () => {
  it("buildOrderPdfModel carries the exact same rows and correct totals", () => {
    const header = makeInitialHeader();
    const rows = makeInitialRows();
    const totals = computeOrderTotals(rows);
    const company = makeDefaultCompanyProfile();

    const model = buildOrderPdfModel(header, rows, totals, company);

    expect(model.rows).toBe(rows);
    expect(model.rows).toHaveLength(rows.length);
    expect(model.orderNo).toBe(header.orderNo);
    expect(model.totalDoors).toBe(totals.totalDoors);
    expect(model.totalArea).toBeCloseTo(totals.totalArea, 6);
    expect(model.vendorBrandName).toBe(company.brandName);
  });

  it("buildInvoicePdfModel carries the exact same rows and computes balanceDue", () => {
    const header = makeInitialHeader();
    const rows = makeInitialRows();
    const invoice = makeInitialInvoice();
    const totals = computeOrderTotals(rows);
    const company = makeDefaultCompanyProfile();

    const model = buildInvoicePdfModel(header, rows, invoice, totals, company);

    expect(model.rows).toBe(rows);
    expect(model.invoiceNo).toBe(invoice.invoiceNo);
    expect(model.balanceDue).toBeCloseTo(totals.grandTotal - Number(invoice.paidAmount), 6);
  });
});

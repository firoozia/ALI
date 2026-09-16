import { describe, it, expect } from "vitest";
import { buildOrderPdfModel, buildInvoicePdfModel } from "../pdfSchema";
import { makeInitialHeader, makeInitialInvoice, makeInitialRows } from "../mockData";
import { computeOrderTotals } from "../calculations";
import { makeDefaultCompanyProfile } from "../companyProfile";
import { makeDefaultPdfTemplateSettings } from "../pdfTemplateSchema";

describe("pdfSchema", () => {
  it("buildOrderPdfModel carries the exact same rows, correct totals, and company/template settings", () => {
    const header = makeInitialHeader();
    const rows = makeInitialRows();
    const totals = computeOrderTotals(rows);
    const company = makeDefaultCompanyProfile();
    const template = makeDefaultPdfTemplateSettings();

    const model = buildOrderPdfModel(header, rows, totals, company, template);

    expect(model.rows).toBe(rows);
    expect(model.rows).toHaveLength(rows.length);
    expect(model.orderNo).toBe(header.orderNo);
    expect(model.totalDoors).toBe(totals.totalDoors);
    expect(model.totalArea).toBeCloseTo(totals.totalArea, 6);
    expect(model.vendorBrandName).toBe(company.brandName);
    expect(model.template.orderPdfTitle).toBe(template.orderPdfTitle);
  });

  it("buildInvoicePdfModel carries the exact same rows, computes balanceDue only from core calculations, and uses company/template settings", () => {
    const header = makeInitialHeader();
    const rows = makeInitialRows();
    const invoice = makeInitialInvoice();
    const totals = computeOrderTotals(rows);
    const company = makeDefaultCompanyProfile();
    const template = makeDefaultPdfTemplateSettings();

    const model = buildInvoicePdfModel(header, rows, invoice, totals, company, template);

    expect(model.rows).toBe(rows);
    expect(model.invoiceNo).toBe(invoice.invoiceNo);
    expect(model.balanceDue).toBeCloseTo(totals.grandTotal - Number(invoice.paidAmount), 6);
    expect(model.totals).toBe(totals);
    expect(model.vendorBrandName).toBe(company.brandName);
    expect(model.template.invoicePdfTitle).toBe(template.invoicePdfTitle);
  });

  it("respects a customized company profile and template (e.g. custom titles, stamp)", () => {
    const header = makeInitialHeader();
    const rows = makeInitialRows();
    const totals = computeOrderTotals(rows);
    const company = { ...makeDefaultCompanyProfile(), brandName: "Custom Brand", stampUrl: "data:image/png;base64,AAA" };
    const template = { ...makeDefaultPdfTemplateSettings(), orderPdfTitle: "Custom Order Title" };

    const model = buildOrderPdfModel(header, rows, totals, company, template);

    expect(model.vendorBrandName).toBe("Custom Brand");
    expect(model.vendorStampUrl).toBe("data:image/png;base64,AAA");
    expect(model.template.orderPdfTitle).toBe("Custom Order Title");
  });
});

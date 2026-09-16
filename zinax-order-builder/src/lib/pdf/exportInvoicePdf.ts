// High-level entry point the UI calls: exportInvoicePdf(order). The PDF
// engine (currently @react-pdf/renderer) loads lazily via dynamic import
// so it never bloats the main application bundle.
import { createElement } from "react";
import { buildInvoicePdfModel, type InvoicePreviewData } from "../../core/pdfSchema";
import { invoicePdfFileName } from "../../core/invoiceSchema";
import { downloadBlob } from "../download";
import type { PdfExportResult } from "./pdfExportTypes";

export async function exportInvoicePdf(order: InvoicePreviewData): Promise<PdfExportResult> {
  const { header, rows, totals, companyProfile, pdfTemplate, invoice } = order;
  const model = buildInvoicePdfModel(header, rows, invoice, totals, companyProfile, pdfTemplate);
  const fileName = invoicePdfFileName(model.invoiceNo);

  const [{ pdf }, { default: ReactPdfInvoiceDocument }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./reactPdfInvoiceDocument"),
  ]);

  // See exportOrderPdf.ts for why this cast is needed.
  const element = createElement(ReactPdfInvoiceDocument, { model }) as Parameters<typeof pdf>[0];
  const instance = pdf(element);
  const blob = await instance.toBlob();
  const saved = await downloadBlob(fileName, blob);
  return { fileName, byteLength: blob.size, saved };
}

// High-level entry point the UI calls: exportOrderPdf(order). Everything
// about which PDF engine renders the document, and the fact that engine
// only loads when this function actually runs (dynamic import — see
// task G / code-splitting), is an implementation detail hidden here.
import { createElement } from "react";
import { buildOrderPdfModel, type OrderPreviewData } from "../../core/pdfSchema";
import { downloadBlob } from "../download";
import type { PdfExportResult } from "./pdfExportTypes";

export async function exportOrderPdf(order: OrderPreviewData): Promise<PdfExportResult> {
  const { header, rows, totals, companyProfile, pdfTemplate } = order;
  const model = buildOrderPdfModel(header, rows, totals, companyProfile, pdfTemplate);
  const fileName = `${model.orderNo}_order_sheet.pdf`;

  const [{ pdf }, { default: ReactPdfOrderDocument }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./reactPdfOrderDocument"),
  ]);

  // ReactPdfOrderDocument's own props aren't DocumentProps (it internally
  // renders a <Document>), but react-pdf's own reconciler resolves it fine
  // at runtime — this cast only relaxes pdf()'s overly narrow static type.
  const element = createElement(ReactPdfOrderDocument, { model, currency: header.currency }) as Parameters<typeof pdf>[0];
  const instance = pdf(element);
  const blob = await instance.toBlob();
  const saved = await downloadBlob(fileName, blob);
  return { fileName, byteLength: blob.size, saved };
}

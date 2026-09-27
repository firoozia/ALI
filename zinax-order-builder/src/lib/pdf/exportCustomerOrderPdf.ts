// High-level entry point the customer portal calls to let a customer keep
// a PDF copy of their own submission — mirrors exportOrderPdf.ts's
// dynamic-import pattern so @react-pdf/renderer only loads when actually
// used.
import { createElement } from "react";
import type { CustomerSubmission } from "../../core/publicCatalogSchema";
import { downloadBlob } from "../download";

export async function exportCustomerOrderPdf(companyName: string, submission: CustomerSubmission): Promise<boolean> {
  const fileName = `${(submission.customerName || "order").trim().replace(/[^a-zA-Z0-9]+/g, "-")}.order.pdf`;

  const [{ pdf }, { default: ReactPdfCustomerOrderDocument }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./reactPdfCustomerOrderDocument"),
  ]);

  const submittedAt = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const element = createElement(ReactPdfCustomerOrderDocument, {
    companyName,
    submission,
    submittedAt,
  }) as Parameters<typeof pdf>[0];
  const instance = pdf(element);
  const blob = await instance.toBlob();
  return downloadBlob(fileName, blob);
}

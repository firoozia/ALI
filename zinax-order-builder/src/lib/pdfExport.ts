// Browser-only PDF export: rasterizes a DOM node (the same markup used for
// the on-screen preview) into a real, multi-page A4 PDF file. This is the
// Web edition's renderer for the PDF data models in core/pdfSchema.ts — a
// Windows edition would render the same data model with a native PDF
// library (e.g. ReportLab) instead of html2canvas/jsPDF.
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

export type PdfOrientation = "portrait" | "landscape";

export async function exportElementAsPdf(
  element: HTMLElement,
  fileName: string,
  orientation: PdfOrientation = "portrait"
): Promise<void> {
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
  });

  const pdf = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const imgData = canvas.toDataURL("image/png");

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position -= pageHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(fileName);
}

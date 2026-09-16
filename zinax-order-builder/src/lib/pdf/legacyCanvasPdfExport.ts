// Legacy image-based PDF export (html2canvas + jsPDF), rasterizing a DOM
// node into a multi-page PDF. Superseded by the text-based engine
// (exportOrderPdf.ts / exportInvoicePdf.ts via @react-pdf/renderer) as of
// Phase 1C — kept here only as a fallback engine, not wired into any
// screen by default. Both jsPDF and html2canvas load lazily via dynamic
// import so keeping this file around costs nothing in the main bundle.
export type PdfOrientation = "portrait" | "landscape";

export async function exportElementAsPdfCanvas(
  element: HTMLElement,
  fileName: string,
  orientation: PdfOrientation = "portrait"
): Promise<void> {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

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

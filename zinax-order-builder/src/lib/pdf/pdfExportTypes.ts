// Shared types for the PDF export abstraction. The UI only ever calls the
// two high-level functions in exportOrderPdf.ts / exportInvoicePdf.ts —
// everything else in src/lib/pdf/ is an implementation detail that can be
// swapped (a different PDF engine, a native renderer on Windows) without
// the calling screens changing.

export interface PdfExportResult {
  fileName: string;
  /** Byte size of the generated file, purely informational for the UI/tests. */
  byteLength: number;
}

export type PdfEngine = "text" | "canvas";

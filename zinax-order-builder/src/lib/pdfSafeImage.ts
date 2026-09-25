// The PDF engine (@react-pdf/renderer) can only decode raster images
// (PNG/JPEG) through its <Image> component — it cannot render SVG or any
// other format. Before this check existed, uploading a company logo or
// stamp in an unsupported format (most commonly SVG, since browser file
// pickers group it under "image/*") would only fail later, at PDF
// generation time, as a generic "Could not generate the PDF" error with
// no indication that the logo/stamp was the actual cause. Upload screens
// (Settings, PDF Templates) call this at the point of upload so the user
// gets an immediate, specific rejection instead. core/pdfSchema.ts has its
// own matching check for values that predate this fix and are already
// stored — that one stays in core/ since it runs during PDF-model
// construction, not a browser file-picker event.

const SUPPORTED_MIME_TYPES = ["image/png", "image/jpeg"];

/** True if a just-selected upload File is a format the PDF engine can render. */
export function isPdfSafeImageFile(file: File): boolean {
  return SUPPORTED_MIME_TYPES.includes(file.type);
}

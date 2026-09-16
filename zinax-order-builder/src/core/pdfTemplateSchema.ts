// PDF template / branding behavior — the presentation toggles that decide
// what shows up on generated documents. Company identity (name, logo,
// bank details, ...) lives in core/companyProfile.ts; this file only
// covers document-level presentation choices.

export type PdfLanguage = "EN" | "AR";

export interface PdfTemplateSettings {
  orderPdfTitle: string;
  invoicePdfTitle: string;
  showTaxNumber: boolean;
  showBankDetails: boolean;
  showSignatures: boolean;
  showPricesOnOrderPdf: boolean;
  footerNotes: string;
  /** Placeholder for future localization — layout does not mirror for AR yet. */
  language: PdfLanguage;
}

export function makeDefaultPdfTemplateSettings(): PdfTemplateSettings {
  return {
    orderPdfTitle: "Order Sheet",
    invoicePdfTitle: "Proforma Invoice",
    showTaxNumber: true,
    showBankDetails: true,
    showSignatures: true,
    showPricesOnOrderPdf: false,
    footerNotes: "",
    language: "EN",
  };
}

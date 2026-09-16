// Company profile — the branding/contact block that PDFs and invoices
// pull from. Editable per install via the Settings screen.

export interface CompanyProfile {
  companyName: string;
  brandName: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  taxNumber: string;
  /** Data URL or external URL placeholder; empty string = no logo set. */
  logoUrl: string;
  bankDetails: string;
  defaultCurrency: string;
  defaultVatPercent: number;
  defaultSalesperson: string;
  defaultPaymentTerms: string;
}

export function makeDefaultCompanyProfile(): CompanyProfile {
  return {
    companyName: "Al Farsi Interiors LLC",
    brandName: "ZINAX / ARYAK",
    address: "Dubai, United Arab Emirates",
    phone: "+971 4 123 4567",
    whatsapp: "+971 50 123 4567",
    email: "info@zinax-example.com",
    taxNumber: "TRN 100000000000003",
    logoUrl: "",
    bankDetails: "Emirates NBD — IBAN AE07 0331 1234 5678 9012 345",
    defaultCurrency: "AED",
    defaultVatPercent: 5,
    defaultSalesperson: "Ahmed Al Mansoori",
    defaultPaymentTerms: "50% advance, 50% on delivery",
  };
}

// The subset of a factory's door-design catalog that's published to the
// public, no-login customer portal — deliberately smaller than the full
// core/catalogSchema.ts Catalog (no PVC colors, MDF, grain options): the
// portal only needs a code, a name, and whether it's still offered.
export interface PublicDesign {
  code: string;
  name: string;
  pricePerDoor: number;
  active: boolean;
}

export interface PublicColor {
  code: string;
  color: string;
  active: boolean;
}

export interface PublicTenant {
  id: string;
  slug: string;
  companyName: string;
}

export interface CustomerPortalItem {
  designCode: string;
  width: number;
  height: number;
  qty: number;
  colorCode: string;
  direction: string;
}

export interface CustomerSubmission {
  customerName: string;
  endCustomerName: string;
  siteName: string;
  items: CustomerPortalItem[];
}

export type CustomerSubmissionStatus = "new" | "imported" | "dismissed";

/** A CustomerSubmission as stored in the factory's online inbox (customer_submissions table). */
export interface CustomerSubmissionRecord extends CustomerSubmission {
  id: string;
  submittedAt: string;
  status: CustomerSubmissionStatus;
}

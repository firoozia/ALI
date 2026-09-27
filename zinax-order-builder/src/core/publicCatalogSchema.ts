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

/** A factory's melamine edge-band code, published so portal customers pick the same codes. */
export interface PublicEdgeBand {
  code: string;
  name: string;
  thicknessMm: number;
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
  /** Missing on submissions made before melamine support: those are vacuum doors. */
  productType?: "vacuum_door" | "melamine";
  /** Melamine edges seen from the front: 1 bottom, 2 top, 3 left, 4 right. N | <band> | S | S/<band>. */
  edge1?: string;
  edge2?: string;
  edge3?: string;
  edge4?: string;
  /** Melamine rotation: Y may rotate, N locked. */
  rotation?: string;
}

/** A portal item the factory can import: a door needs a door code; a melamine panel does not. */
/** Melamine panels and vacuum doors share one items list; the portal shows them in two tables. */
export function isMelamineItem(item: CustomerPortalItem): boolean {
  return item.productType === "melamine";
}

export function isCompletePortalItem(item: CustomerPortalItem): boolean {
  const sized = item.width > 0 && item.height > 0 && item.qty > 0;
  return sized && (item.productType === "melamine" || Boolean(item.designCode));
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

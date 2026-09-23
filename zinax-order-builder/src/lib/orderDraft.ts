// The in-progress New Order draft — header + rows + invoice + invoice mode.
// Lives in src/lib/ (not src/core/) because it depends on the persisted
// order/invoice sequence counters (lib/orderSequence.ts) and on
// localStorage, both platform-specific concerns core/ must stay free of.
//
// App.tsx owns this draft as top-level state (not NewOrderBuilder's local
// state) so it survives navigating to the Order/Invoice PDF preview and
// back — previously the draft lived inside NewOrderBuilder, which
// unmounts on every screen switch, silently wiping the whole order. It
// also persists to localStorage so a draft survives closing the app,
// until "New Blank Order" or "Load Sample Order" is explicitly clicked.
import { generateOrderNo, type OrderHeader, type OrderRow } from "../core/orderSchema";
import { generateInvoiceNo, type Invoice } from "../core/invoiceSchema";
import type { CompanyProfile } from "../core/companyProfile";
import { nextOrderSequence, nextInvoiceSequence } from "./orderSequence";

export interface OrderDraft {
  header: OrderHeader;
  rows: OrderRow[];
  invoice: Invoice;
  invoiceMode: boolean;
}

export function makeBlankHeader(companyProfile: CompanyProfile): OrderHeader {
  return {
    orderNo: generateOrderNo(new Date().getFullYear(), nextOrderSequence()),
    orderDate: new Date().toISOString().slice(0, 10),
    customerName: "",
    companyName: "",
    phone: "",
    whatsapp: "",
    email: "",
    address: "",
    taxNumber: "",
    projectName: "",
    salesperson: companyProfile.defaultSalesperson,
    deliveryDate: "",
    currency: companyProfile.defaultCurrency,
    notes: "",
  };
}

export function makeBlankInvoice(companyProfile: CompanyProfile): Invoice {
  return {
    invoiceNo: generateInvoiceNo(new Date().getFullYear(), nextInvoiceSequence()),
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    paymentTerms: companyProfile.defaultPaymentTerms,
    vat: companyProfile.defaultVatPercent,
    currency: companyProfile.defaultCurrency,
    bankDetails: companyProfile.bankDetails,
    paidAmount: 0,
    orderDiscountPercent: 0,
    documentType: "invoice",
    notes: "",
  };
}

export function makeBlankDraft(companyProfile: CompanyProfile): OrderDraft {
  return {
    header: makeBlankHeader(companyProfile),
    rows: [],
    invoice: makeBlankInvoice(companyProfile),
    invoiceMode: false,
  };
}

export function nextInvoiceNo(): string {
  return generateInvoiceNo(new Date().getFullYear(), nextInvoiceSequence());
}

const LOCAL_STORAGE_KEY = "zinax_order_draft_v1";

/** Returns null if there's no saved draft, or it's malformed — callers fall back to a blank draft. */
export function loadOrderDraftFromStorage(): OrderDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OrderDraft>;
    if (!parsed.header || !Array.isArray(parsed.rows) || !parsed.invoice) return null;
    return {
      header: parsed.header,
      rows: parsed.rows,
      invoice: parsed.invoice,
      invoiceMode: Boolean(parsed.invoiceMode),
    };
  } catch {
    return null;
  }
}

export function saveOrderDraftToStorage(draft: OrderDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable (private mode, quota exceeded) — the draft just won't persist.
  }
}

export function clearOrderDraftFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

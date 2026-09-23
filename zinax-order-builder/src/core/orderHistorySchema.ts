// A lightweight record of every order that's been saved or exported at
// least once — this is what powers the Dashboard's stat cards and
// "Recent Orders" list with real data. Separate from the single
// in-progress OrderDraft (lib/orderDraft.ts): this is the running history
// across every order, keyed by orderNo.
import type { OrderHeader, OrderRow } from "./orderSchema";
import type { Invoice } from "./invoiceSchema";

export type OrderStatus = "Draft" | "Ready for Production" | "Exported" | "Invoiced";

// Higher rank = further along the pipeline. An order's status only ever
// moves forward — e.g. re-saving an already-Invoiced order as JSON must
// not demote it back to Draft — matching how a real order's lifecycle
// only ever progresses.
const STATUS_RANK: Record<OrderStatus, number> = {
  Draft: 0,
  "Ready for Production": 1,
  Exported: 2,
  Invoiced: 3,
};

export interface OrderRecord {
  orderNo: string;
  orderDate: string;
  customerName: string;
  projectName: string;
  salesperson: string;
  totalDoors: number;
  status: OrderStatus;
  /** ISO timestamp of the most recent save/export — drives "Recent Orders" sort order. */
  updatedAt: string;
  header: OrderHeader;
  rows: OrderRow[];
  invoice: Invoice;
  invoiceMode: boolean;
}

export function makeOrderRecord(
  header: OrderHeader,
  rows: OrderRow[],
  invoice: Invoice,
  invoiceMode: boolean,
  status: OrderStatus,
  totalDoors: number
): OrderRecord {
  return {
    orderNo: header.orderNo,
    orderDate: header.orderDate,
    customerName: header.customerName,
    projectName: header.projectName,
    salesperson: header.salesperson,
    totalDoors,
    status,
    updatedAt: new Date().toISOString(),
    header,
    rows,
    invoice,
    invoiceMode,
  };
}

/** Adds/updates a record by orderNo — status only ever moves forward (see STATUS_RANK), never backward. */
export function upsertOrderRecord(records: OrderRecord[], next: OrderRecord): OrderRecord[] {
  const idx = records.findIndex((r) => r.orderNo === next.orderNo);
  if (idx === -1) return [next, ...records];
  const existing = records[idx];
  const status = STATUS_RANK[next.status] >= STATUS_RANK[existing.status] ? next.status : existing.status;
  const merged: OrderRecord = { ...next, status };
  const copy = [...records];
  copy[idx] = merged;
  return copy;
}

export interface OrderStats {
  totalOrders: number;
  draftOrders: number;
  readyForProduction: number;
  invoicedOrders: number;
  exportedCsv: number;
}

export function computeOrderStats(records: OrderRecord[]): OrderStats {
  return {
    totalOrders: records.length,
    draftOrders: records.filter((r) => r.status === "Draft").length,
    readyForProduction: records.filter((r) => r.status === "Ready for Production").length,
    invoicedOrders: records.filter((r) => r.status === "Invoiced").length,
    exportedCsv: records.filter((r) => r.status === "Exported" || r.status === "Invoiced").length,
  };
}

/** Most recently updated first. */
export function sortByRecent(records: OrderRecord[]): OrderRecord[] {
  return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// --- Web persistence adapter (localStorage) -----------------------------

const LOCAL_STORAGE_KEY = "zinax_order_history_v1";

export function loadOrderHistoryFromStorage(): OrderRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOrderHistoryToStorage(records: OrderRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Storage unavailable (private mode, quota exceeded) — history just won't persist.
  }
}

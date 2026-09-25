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

// --- Remote persistence adapter (Supabase, one tenant's orders) --------
//
// Row Level Security in supabase/schema.sql is what actually enforces the
// tenant boundary — tenantId here is only used to shape the query, never
// trusted as the access-control check itself.

export interface RemoteOrderRow {
  order_no: string;
  order_date: string;
  customer_name: string;
  project_name: string;
  salesperson: string;
  total_doors: number;
  status: OrderStatus;
  updated_at: string;
  header: OrderHeader;
  rows: OrderRow[];
  invoice: Invoice;
  invoice_mode: boolean;
}

export function recordToRemoteRow(tenantId: string, record: OrderRecord) {
  return {
    tenant_id: tenantId,
    order_no: record.orderNo,
    order_date: record.orderDate,
    customer_name: record.customerName,
    project_name: record.projectName,
    salesperson: record.salesperson,
    total_doors: record.totalDoors,
    status: record.status,
    updated_at: record.updatedAt,
    header: record.header,
    rows: record.rows,
    invoice: record.invoice,
    invoice_mode: record.invoiceMode,
  };
}

export function remoteRowToRecord(row: RemoteOrderRow): OrderRecord {
  return {
    orderNo: row.order_no,
    orderDate: row.order_date,
    customerName: row.customer_name,
    projectName: row.project_name,
    salesperson: row.salesperson,
    totalDoors: row.total_doors,
    status: row.status,
    updatedAt: row.updated_at,
    header: row.header,
    rows: row.rows,
    invoice: row.invoice,
    invoiceMode: row.invoice_mode,
  };
}

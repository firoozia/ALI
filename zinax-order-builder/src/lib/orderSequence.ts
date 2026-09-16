// Persisted sequence counters for order/invoice numbers. This is a
// storage side-effect (localStorage), so it stays in src/lib/ rather than
// src/core/ — core/orderSchema.ts's generateOrderNo/generateInvoiceNo
// remain pure functions that just format {year, sequence} into a string.
const ORDER_SEQ_KEY = "zinax_order_seq_v1";
const INVOICE_SEQ_KEY = "zinax_invoice_seq_v1";

function nextSequence(key: string): number {
  try {
    const raw = window.localStorage.getItem(key);
    const next = (raw ? parseInt(raw, 10) : 0) + 1;
    window.localStorage.setItem(key, String(next));
    return next;
  } catch {
    return Math.floor(Math.random() * 9000) + 100;
  }
}

export function nextOrderSequence(): number {
  return nextSequence(ORDER_SEQ_KEY);
}

export function nextInvoiceSequence(): number {
  return nextSequence(INVOICE_SEQ_KEY);
}

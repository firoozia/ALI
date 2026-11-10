// From a caption to tracker events, without a model, for the shapes the groups really use (see captions.js). Returns null
// when the caption is not one of them, so the model reads it instead.
//   { events: [...] }              events to record (type, customer, lines, ...), without time and ref
//   { cleared: true }              a reply that closes a money item
//   { clearInvoices: ['inv-1'] }   a reply that lists the invoices the money cleared
//   { ignore: true }               something to leave out (an expense)

import { parseCutCaption, parseDeliveryCaption, parseGoodsCaption, parsePaymentCaption } from './captions.js';

export function eventsFromCaption(role, text) {
  if (role === 'cut') {
    const c = parseCutCaption(text);
    if (!c || c.kind === 'name') return null;
    const lines = [{ code: c.code, quantity: c.quantity, unit: c.unit, ...(c.invoiceQuantity !== undefined ? { invoiceQuantity: c.invoiceQuantity } : {}) }];
    // an opened roll or a damaged piece is kept (the cutters' log) but is never a sale: no customer, flagged internal
    if (c.kind === 'open-roll' || c.kind === 'damage') return { events: [{ type: 'cut', internal: true, kind: c.kind, customer: c.kind === 'damage' ? c.customer : '', lines }] };
    return { events: [{ type: 'cut', customer: c.customer, lines, ...(c.pieces ? { pieces: c.pieces } : {}) }] };
  }
  if (role === 'delivery') {
    const d = parseDeliveryCaption(text);
    if (!d || !d.customers.length) return null;
    return {
      events: d.customers.map((x) => ({
        type: 'delivery', customer: x.customer, lines: [], ...(x.quantity ? { delivered: { quantity: x.quantity, unit: x.unit } } : {}),
        ...(d.cod ? { cod: d.cod } : {}), ...(d.status ? { status: d.status } : {}),
      })),
    };
  }
  if (role === 'payment') {
    const p = parsePaymentCaption(text);
    if (!p) return null;
    if (p.kind === 'cleared') return { cleared: true };
    if (p.kind === 'clear-invoices') return { clearInvoices: p.invoices };
    if (p.kind === 'expense') return { ignore: true };
    if (p.kind === 'bank-credit') return { events: [{ type: 'payment', kind: 'transfer', customer: p.customer || '', amount: p.amount, currency: 'AED', lines: [], ...(p.customer ? {} : { pendingName: true }) }] };
    if (p.kind === 'name') return { name: p.customer }; // a bare name: it may belong to the payment just before or just after it
    const withInvoices = { ...(p.cheque ? { kind: 'cheque' } : {}), ...(p.currency ? { currency: p.currency } : {}), ...(p.foreign ? { foreign: p.foreign } : {}), ...(p.invoices?.length ? { invoices: p.invoices, ...(p.amount > 0 ? {} : { noAmount: true }) } : {}), ...(p.cleared ? { cleared: true } : {}) };
    if (p.kind === 'cash' && !p.customers.length) return { events: [{ type: 'payment', kind: 'cash', customer: '', amount: p.amount, currency: 'AED', lines: [], pendingName: true, ...withInvoices }] };
    if (p.kind === 'cash' && p.customers.length) {
      // several customers in one caption: one event with the names joined; the amount is not split between them
      return { events: [{ type: 'payment', kind: 'cash', customer: p.customers.join(' + '), amount: p.amount, currency: 'AED', lines: [], ...(p.customers.length > 1 ? { multi: true } : {}), ...withInvoices }] };
    }
    return null;
  }
  if (role === 'goods') {
    const g = parseGoodsCaption(text);
    // goods that arrived are kept by received.js, in any internal group, as stock coming in
    return g && g.kind !== 'received' ? { events: [{ type: 'goods', kind: g.kind, customer: g.customer, item: g.item, quantity: g.quantity, unit: g.unit, lines: [] }] } : null;
  }
  return null;
}

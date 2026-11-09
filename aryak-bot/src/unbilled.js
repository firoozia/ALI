// The evening report: what was CUT or DELIVERED and has no invoice yet, per customer. READ ONLY: the cutting and delivery posts (the tracker) against ALL the customer's QuickBooks
// invoices (the office's on the screen and ours). The owner's rule: the invoice follows what the customer ORDERED, so an invoice line of the same customer and code dated on or after
// the cut day counts whatever its quantity, and a cut larger than the invoice is normal. A delivery has no code in its post: it is a customer-level note (no invoice at all since).

import { withSeparators } from './separator.js';
import { sameCutCustomer } from './cuts.js';

const DAY = 24 * 3600 * 1000;
const dm = (ms, timeZone) => { const [, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-'); return `${d}/${m}`; };
const digits = (c) => (String(c || '').match(/\d{2,5}/g) || []).join('-');

/**
 * [events]: the tracker's events. [invoices]: QuickBooks invoice records of the last weeks (Line, TxnDate, CustomerRef.name). [itemCodes](itemId) -> the codes of an item.
 * [aliasOf](name) -> the QuickBooks name an approved alias stands for. Returns { groups: [{ customer, parts: ['303 6.4m 08/11', …] }], customers }.
 */
export function unbilled({ events, invoices, itemCodes = () => [], aliasOf = () => '', now = Date.now(), days = 30, timeZone = 'Asia/Dubai' }) {
  const lines = [];
  for (const inv of invoices) {
    const at = Date.parse(`${inv.TxnDate}T00:00:00Z`) || 0;
    for (const l of inv.Line || []) {
      if (l.DetailType !== 'SalesItemLineDetail') continue;
      lines.push({ customer: inv.CustomerRef?.name || '', codes: itemCodes(l.SalesItemLineDetail?.ItemRef?.value, l.SalesItemLineDetail?.ItemRef?.name), at });
    }
  }
  const same = (post, qboName) => sameCutCustomer(post, qboName) || (!!aliasOf(post) && sameCutCustomer(aliasOf(post), qboName));
  const invoicesOf = (post) => lines.filter((x) => same(post, x.customer));
  const byCustomer = new Map();
  const add = (customer, text) => { const name = aliasOf(customer) || customer; byCustomer.set(name, [...(byCustomer.get(name) || []), text]); }; // an approved alias merges the two spellings into the QuickBooks name
  for (const e of events) {
    if (e.at < now - days * DAY || e.internal || e.simulated) continue;
    const post = e.customerTyped || e.customer;
    if (!post) continue;
    const his = invoicesOf(post);
    if (e.type === 'cut') {
      for (const l of e.lines || []) {
        if (!(Number(l.quantity) > 0) || l.invoiced) continue; // an invoice the program itself recorded takes the cut
        const k = digits(l.code);
        const covered = his.some((x) => x.at >= e.at - DAY && x.codes.some((c) => digits(c) === k));
        if (!covered) add(e.customer || post, `${String(l.code).replace(/^ART\.?\s*NO\.?\s*/i, '')} ${Number(l.invoiceQuantity) > 0 ? l.invoiceQuantity : l.quantity}${l.unit === 'roll' ? ' roll' : 'm'} ${dm(e.at, timeZone)}`);
      }
    } else if (e.type === 'delivery' && e.delivered) {
      if (!his.some((x) => x.at >= e.at - DAY)) add(e.customer || post, `delivered ${dm(e.at, timeZone)}, no invoice since`);
    }
  }
  const groups = [...byCustomer].map(([customer, parts]) => ({ customer, parts: [...new Set(parts)] })).sort((a, b) => b.parts.length - a.parts.length || a.customer.localeCompare(b.customer));
  return { groups, customers: groups.length };
}

/** The short text: at most [max] lines, then «+N more»; a clean day says so in one line. */
export function unbilledText({ groups }, { max = 10, days = 30 } = {}) {
  if (!groups.length) return `✔ Everything cut or delivered in the last ${days} days has an invoice.`;
  const rows = groups.map((g) => `• ${g.customer}: ${g.parts.slice(0, 4).join(', ')}${g.parts.length > 4 ? ` +${g.parts.length - 4}` : ''}`);
  return [`Cut or delivered, not invoiced (${groups.length} customer${groups.length === 1 ? '' : 's'}):`, withSeparators(rows.slice(0, max)), ...(rows.length > max ? [`+${rows.length - max} more`] : [])].join('\n');
}

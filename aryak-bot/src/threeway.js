// The three-way check of what was cut, what LEFT the warehouse and what was INVOICED. READ ONLY: nothing is written to the sheet or to QuickBooks.
// The owner's sources of truth, in order: (1) CUT = the posts of the orders group (ART NO / code / customer / metres); (2) LEFT THE WAREHOUSE = the OUT rows of the stock sheet
// (no OUT row means the goods did not leave, even if they were cut); (3) INVOICED = the QuickBooks invoices. Cut photos are only supporting evidence and are not read here.
// Per customer (the QuickBooks name) and code:
//   cut + OUT + invoiced        OK, not listed
//   cut + OUT, not invoiced     «left, not invoiced»  (the real unbilled list)
//   cut, no OUT, not invoiced   «cut, still in the warehouse»
//   invoiced, no OUT            «invoiced, not left yet»
//   OUT without a cut post      «left without an order-group post» (check)
// An invoice covers a cut or an OUT when an invoice line of the same customer and code is dated on or after that day (the owner's rule: the invoice follows what was ORDERED, so the
// quantity may differ: cut 6.2 m may be invoiced 6 m, the end of a roll may give more). A quantity never makes a mismatch here.
import { qboNameFor } from './qboname.js';
import { settleCuts } from './tracker.js';
import { SEP } from './separator.js';

const DAY = 24 * 3600 * 1000;
const digits = (c) => (String(c || '').match(/\d{2,5}/g) || []).join('-');
const dayFormats = new Map();
const dm = (ms, timeZone) => {
  if (!dayFormats.has(timeZone)) dayFormats.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  const [, m, d] = dayFormats.get(timeZone).format(new Date(ms)).split('-');
  return `${d}/${m}`;
};
const unitText = (u) => (u === 'roll' ? ' roll' : u === 'pcs' ? ' pcs' : 'm');
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * [events]: the tracker's events (cuts of the orders group; deliveries). [outs]: the sheet's OUT rows [{ customer, code, qty, unit, at }], or null when the sheet could not give them
 * (then nothing is claimed about what left). [invoices]: QuickBooks invoice records with Line, TxnDate, CustomerRef. [itemCodes](itemId, name) -> the codes of an item.
 * Returns { sections: { leftNotInvoiced, stillInWarehouse, invoicedNotLeft, leftWithoutPost, delivered }, outKnown, trace } where a section is [{ customer, parts: [text] }].
 */
export function threeWay({ events, outs, invoices, itemCodes = () => [], aliasOf = () => '', qboNames = [], now = Date.now(), days = 14, timeZone = 'Asia/Dubai' }) {
  const outKnown = Array.isArray(outs);
  const since = now - days * DAY;
  const memo = new Map();
  const nameOf = (post) => { if (!memo.has(post)) memo.set(post, qboNameFor(post, qboNames, aliasOf) || aliasOf(post) || post); return memo.get(post); };
  const book = new Map(); // `${customer}|${code}` -> { customer, code, cut: {qty, unit, at}, out: {...}, inv: {...} }
  const slot = (customer, code) => { const k = `${customer}|${code}`; if (!book.has(k)) book.set(k, { customer, code, cut: null, out: null, inv: null }); return book.get(k); };
  const put = (box, field, qty, unit, at, text = '') => {
    const cur = box[field] || { qty: 0, unit, at: 0, text: '' };
    box[field] = { qty: cur.qty + (Number(qty) || 0), unit: cur.unit || unit, at: Math.max(cur.at, at), text: text || cur.text };
  };
  for (const e of settleCuts(events)) {
    if (e.type !== 'cut' || e.internal || e.simulated || e.at < since) continue;
    const post = e.customerTyped || e.customer; if (!post) continue;
    for (const l of e.lines || []) {
      const code = digits(l.code); if (!code || !(Number(l.quantity) > 0)) continue;
      put(slot(nameOf(e.customer || post), code), 'cut', Number(l.invoiceQuantity) > 0 ? l.invoiceQuantity : l.quantity, l.unit || 'm', e.at, e.text || '');
    }
  }
  if (outKnown) {
    for (const r of outs) {
      const at = Number(r.at) || 0; const code = digits(r.code);
      if (!code || !String(r.customer || '').trim() || at < since) continue; // an OUT with no customer name cannot be matched
      put(slot(nameOf(r.customer), code), 'out', r.qty, r.unit || 'm', at);
    }
  }
  const invDay = (inv) => Date.parse(`${inv.TxnDate}T00:00:00Z`) || 0;
  for (const inv of invoices) {
    const at = invDay(inv);
    for (const l of inv.Line || []) {
      if (l.DetailType !== 'SalesItemLineDetail') continue;
      const d = l.SalesItemLineDetail || {};
      const codes = [...new Set(itemCodes(d.ItemRef?.value, d.ItemRef?.name).map(digits).filter(Boolean))];
      for (const code of codes) put(slot(inv.CustomerRef?.name || '', code), 'inv', d.Qty, 'm', at);
    }
  }
  // an invoice line that is NOT dated before the cut / OUT day (a day of grace) covers it; each invoice figure is kept by its latest date, so «on or after» is read on that
  const covered = (x, at) => !!x.inv && x.inv.at >= at - DAY;
  const out = { leftNotInvoiced: [], stillInWarehouse: [], invoicedNotLeft: [], leftWithoutPost: [], delivered: [] };
  const add = (list, customer, text) => { const hit = list.find((g) => g.customer === customer); if (hit) hit.parts.push(text); else list.push({ customer, parts: [text] }); };
  const trace = [];
  const desc = (x) => [x.cut && `orders ${dm(x.cut.at, timeZone)}`, x.out && `OUT ${dm(x.out.at, timeZone)}`, x.inv ? `invoice ${dm(x.inv.at, timeZone)}` : 'no invoice'].filter(Boolean).join(', ');
  for (const x of book.values()) {
    if (!x.customer) continue;
    let section = ''; let qty = null;
    if (x.cut && x.out) { if (!covered(x, Math.min(x.cut.at, x.out.at))) { section = 'leftNotInvoiced'; qty = x.out; } } // cut + OUT: invoiced is fine, not invoiced is the real unbilled
    else if (x.cut && !x.out && outKnown) { if (covered(x, x.cut.at)) { section = 'invoicedNotLeft'; qty = x.inv; } else { section = 'stillInWarehouse'; qty = x.cut; } }
    else if (x.cut && !outKnown) { if (!covered(x, x.cut.at)) { section = 'leftNotInvoiced'; qty = x.cut; } } // the sheet gave nothing: the old question, cut and not invoiced
    else if (!x.cut && x.out) { section = 'leftWithoutPost'; qty = x.out; }
    else if (!x.cut && !x.out && x.inv && outKnown && x.inv.at >= since) { section = 'invoicedNotLeft'; qty = x.inv; }
    if (!section) continue;
    const text = `${x.code} ${round1(qty.qty)}${unitText(qty.unit)} (${desc(x)})`;
    add(out[section], x.customer, text);
    trace.push(`three-way: ${section} "${x.customer}" ${x.code}: ${desc(x)}${x.cut?.text ? ` — post: "${x.cut.text}"` : ''}`);
  }
  // a delivery post has no code: a customer-level note when nothing at all was invoiced for him since
  const lastInvoice = new Map();
  for (const inv of invoices) lastInvoice.set(inv.CustomerRef?.name || '', Math.max(lastInvoice.get(inv.CustomerRef?.name || '') || 0, invDay(inv)));
  for (const e of events) {
    if (e.type !== 'delivery' || !e.delivered || e.internal || e.simulated || e.at < since) continue;
    const customer = nameOf(e.customerTyped || e.customer); if (!customer) continue;
    if ((lastInvoice.get(customer) || 0) < e.at - DAY) add(out.delivered, customer, `delivered ${dm(e.at, timeZone)}, no invoice since`);
  }
  const order = (list) => list.sort((a, b) => b.parts.length - a.parts.length || a.customer.localeCompare(b.customer)).map((g) => ({ ...g, parts: [...new Set(g.parts)] }));
  for (const k of Object.keys(out)) out[k] = order(out[k]);
  return { sections: out, outKnown, trace };
}

const TITLES = {
  leftNotInvoiced: 'Left the warehouse, not invoiced',
  invoicedNotLeft: 'Invoiced, not left yet',
  stillInWarehouse: 'Cut, still in the warehouse (not left)',
  leftWithoutPost: 'Left without an order-group post (check)',
  delivered: 'Delivered, no invoice since',
};

/** The text: a block per section with its customers (at most [max] lines each), the blocks apart with separators; a clean state says so in one line. */
export function threeWayText(result, { max = 10, days = 14 } = {}) {
  const blocks = [];
  for (const key of ['leftNotInvoiced', 'invoicedNotLeft', 'stillInWarehouse', 'leftWithoutPost', 'delivered']) {
    const list = result.sections[key];
    if (!list.length) continue;
    const rows = list.map((g) => `• ${g.customer}: ${g.parts.slice(0, 4).join(', ')}${g.parts.length > 4 ? ` +${g.parts.length - 4}` : ''}`);
    blocks.push([`${TITLES[key]} (${list.length} customer${list.length === 1 ? '' : 's'}):`, ...rows.slice(0, max), ...(rows.length > max ? [`+${rows.length - max} more`] : [])].join('\n'));
  }
  if (!result.outKnown) blocks.unshift('⚠ The stock sheet gave no OUT rows, so what left the warehouse is unknown: only «cut, not invoiced» is shown.');
  if (!blocks.length || (blocks.length === 1 && !result.outKnown)) blocks.push(`✔ Everything cut, left and invoiced in the last ${days} days agrees.`);
  return blocks.join(`\n${SEP}\n`);
}

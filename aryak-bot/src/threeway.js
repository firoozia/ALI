// The three-way check of what was cut, what LEFT the warehouse and what was INVOICED. READ ONLY: nothing is written to the sheet or to QuickBooks.
// The owner's sources of truth, in order: (1) CUT = the posts of the orders group (ART NO / code / customer / metres); (2) LEFT THE WAREHOUSE = the OUT rows of the stock sheet
// (no OUT row means the goods did not leave, even if they were cut); (3) INVOICED = the QuickBooks invoices. Cut photos are only supporting evidence and are not read here.
//   cut + OUT + invoiced        OK, not listed
//   cut + OUT, not invoiced     «left, not invoiced»  (the real unbilled list)
//   cut, no OUT, not invoiced   «cut, still in the warehouse»
//   invoiced, no OUT            «invoiced, not left yet»
//   OUT without a cut post      «left without an order-group post» (check)
// How the three are matched (the owner's cases of 11/11):
//   - a cut post and an OUT row are the same goods when the code is the same (a truncated code «21» fits «212»), the days are close (5) and the OUT still holds the quantity (a cut may be a
//     PART of the OUT, e.g. 6.4 m of 15.6 m). The customer is taken from the OUT row, because one group can serve two customers («NUQOOSH & AL EBDA»); a cut is first paired with an OUT
//     of its own customer, and only then with another customer's OUT. The largest cuts pair first, so 97.6 m takes the 98.2 m OUT and the 72.6 m before it stays «cut, not left».
//   - an invoice line covers an item when it is the same customer and code, dated within 7 days on either side (an invoice may come BEFORE the post), and still holds the quantity
//     (within a tolerance: cut 6.2 m may be invoiced 6 m, the end of a roll may give more). One invoice line is used up by what it covers, so it is not reused.
import { qboNameFor } from './qboname.js';
import { settleCuts } from './tracker.js';
import { SEP } from './separator.js';

const DAY = 24 * 3600 * 1000;
const PAIR_DAYS = 5; // a cut post and its OUT row
const INVOICE_DAYS = 7; // an invoice and what it covers, before or after
const tol = (q) => Math.max(1.5, 0.06 * q); // metres of difference that are not a difference
const digits = (c) => (String(c || '').match(/\d{2,5}/g) || []).join('-');
const sameCode = (a, b) => a === b;
const prefixCode = (a, b) => a !== b && Math.min(a.length, b.length) >= 2 && (a.startsWith(b) || b.startsWith(a)); // a truncated code («21» for «212»)
const dayFormats = new Map();
const dm = (ms, timeZone) => {
  if (!dayFormats.has(timeZone)) dayFormats.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  const [, m, d] = dayFormats.get(timeZone).format(new Date(ms)).split('-');
  return `${d}/${m}`;
};
const dayKey = (ms, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
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

  // ---- the three sources as lists
  const cuts = [];
  for (const e of settleCuts(events)) {
    if (e.type !== 'cut' || e.internal || e.simulated || e.at < since) continue;
    const post = e.customerTyped || e.customer; if (!post) continue;
    for (const l of e.lines || []) {
      const code = digits(l.code); const qty = Number(l.invoiceQuantity) > 0 ? Number(l.invoiceQuantity) : Number(l.quantity);
      if (!code || !(qty > 0)) continue;
      cuts.push({ customer: nameOf(e.customer || post), code, qty, unit: l.unit || 'm', at: e.at, text: e.text || '', pool: null });
    }
  }
  const pools = new Map(); // an OUT group: one customer, one code, one day (two operations of a day are one)
  if (outKnown) {
    for (const r of outs) {
      const at = Number(r.at) || 0; const code = digits(r.code); const qty = Number(r.qty) || 0;
      if (!code || !(qty > 0) || !String(r.customer || '').trim() || at < since) continue; // an OUT with no customer name cannot be matched
      const customer = nameOf(r.customer); const k = `${customer}|${code}|${dayKey(at, timeZone)}`;
      const p = pools.get(k) || { customer, code, qty: 0, left: 0, at: 0, unit: r.unit || 'm', cuts: [] };
      p.qty += qty; p.left += qty; p.at = Math.max(p.at, at); pools.set(k, p);
    }
  }
  const lines = []; // the invoice lines
  for (const inv of invoices) {
    const at = Date.parse(`${inv.TxnDate}T00:00:00Z`) || 0;
    for (const l of inv.Line || []) {
      if (l.DetailType !== 'SalesItemLineDetail') continue;
      const d = l.SalesItemLineDetail || {};
      for (const code of new Set(itemCodes(d.ItemRef?.value, d.ItemRef?.name).map(digits).filter(Boolean))) lines.push({ customer: inv.CustomerRef?.name || '', code, qty: Number(d.Qty) || 0, left: Number(d.Qty) || 0, at, used: false });
    }
  }

  // ---- cut post <-> OUT row: the largest cuts first; an OUT of the cut's own customer first, then any other customer's
  const pairing = (cut, pass) => {
    let best = null;
    for (const p of pools.values()) {
      if (pass === 1 && p.customer !== cut.customer) continue;
      if (!(sameCode(cut.code, p.code) || (pass === 1 && prefixCode(cut.code, p.code)))) continue;
      if (Math.abs(p.at - cut.at) > PAIR_DAYS * DAY || p.left < cut.qty - tol(cut.qty)) continue;
      const score = Math.abs(p.at - cut.at) + (sameCode(cut.code, p.code) ? 0 : DAY);
      if (!best || score < best.score) best = { p, score };
    }
    return best?.p || null;
  };
  const byQty = [...cuts].sort((a, b) => b.qty - a.qty);
  for (const pass of [1, 2]) for (const cut of byQty) {
    if (cut.pool) continue;
    const p = pairing(cut, pass); if (!p) continue;
    p.left = Math.max(0, p.left - cut.qty); p.cuts.push(cut); cut.pool = p;
  }

  // ---- an invoice line covers an item
  const cover = (customer, code, at, qty) => {
    let best = null;
    for (const l of lines) {
      if (l.customer !== customer || !(sameCode(l.code, code) || prefixCode(l.code, code)) || l.left < qty - tol(qty)) continue;
      if (Math.abs(l.at - at) > INVOICE_DAYS * DAY) continue;
      const score = Math.abs(l.at - at);
      if (!best || score < best.score) best = { l, score };
    }
    if (best) { best.l.left = Math.max(0, best.l.left - qty); best.l.used = true; }
    return best?.l || null;
  };
  // an invoice that exists but is too far away in days: worth a look by the owner («invoiced in advance, or a second order»)
  const older = (customer, code, qty) => lines.find((l) => l.customer === customer && (sameCode(l.code, code) || prefixCode(l.code, code)) && !l.used && Math.abs(l.qty - qty) <= tol(qty));

  const out = { leftNotInvoiced: [], stillInWarehouse: [], invoicedNotLeft: [], leftWithoutPost: [], delivered: [] };
  const add = (list, customer, text) => { const hit = list.find((g) => g.customer === customer); if (hit) hit.parts.push(text); else list.push({ customer, parts: [text] }); };
  const trace = [];
  const note = (section, customer, code, text, extra = '') => { trace.push(`three-way: ${section} "${customer}" ${code}: ${text}${extra}`); };
  const postText = (cuts2) => (cuts2.find((c) => c.text)?.text ? ` — post: "${cuts2.find((c) => c.text).text}"` : '');

  // A) OUT rows with a cut post: left; invoiced or not
  const withCuts = [...pools.values()].filter((p) => p.cuts.length).sort((a, b) => a.at - b.at);
  for (const p of withCuts) {
    const first = Math.min(...p.cuts.map((c) => c.at), p.at);
    const inv = cover(p.customer, p.code, first, p.qty) || cover(p.customer, p.code, p.at, p.qty);
    if (inv) continue; // cut + OUT + invoiced
    const hint = older(p.customer, p.code, p.qty);
    if (hint) hint.used = true; // said here with the OUT, not again as «invoiced, not left»
    const text = `${p.code} ${round1(p.qty)}${unitText(p.unit)} (orders ${dm(Math.max(...p.cuts.map((c) => c.at)), timeZone)}, OUT ${dm(p.at, timeZone)}, no invoice${hint ? `; check: invoice ${dm(hint.at, timeZone)} of ${round1(hint.qty)}m is older than ${INVOICE_DAYS} days` : ''})`;
    add(out.leftNotInvoiced, p.customer, text); note('leftNotInvoiced', p.customer, p.code, text, postText(p.cuts));
  }
  // B) OUT rows nobody posted
  for (const p of [...pools.values()].filter((q) => !q.cuts.length).sort((a, b) => a.at - b.at)) {
    const inv = cover(p.customer, p.code, p.at, p.qty);
    const text = `${p.code} ${round1(p.qty)}${unitText(p.unit)} (OUT ${dm(p.at, timeZone)}, ${inv ? `invoice ${dm(inv.at, timeZone)}` : 'no invoice'})`;
    add(out.leftWithoutPost, p.customer, text); note('leftWithoutPost', p.customer, p.code, text);
  }
  // C) cut posts that have no OUT row
  for (const c of cuts.filter((x) => !x.pool).sort((a, b) => a.at - b.at)) {
    if (!outKnown) { // the sheet gave nothing: the old question, cut and not invoiced
      if (!cover(c.customer, c.code, c.at, c.qty)) { const text = `${c.code} ${round1(c.qty)}${unitText(c.unit)} (orders ${dm(c.at, timeZone)}, no invoice)`; add(out.leftNotInvoiced, c.customer, text); note('leftNotInvoiced', c.customer, c.code, text, postText([c])); }
      continue;
    }
    const inv = cover(c.customer, c.code, c.at, c.qty);
    if (inv) { const text = `${c.code} ${round1(inv.qty)}${unitText('m')} (orders ${dm(c.at, timeZone)}, invoice ${dm(inv.at, timeZone)}, no OUT)`; add(out.invoicedNotLeft, c.customer, text); note('invoicedNotLeft', c.customer, c.code, text, postText([c])); }
    else { const text = `${c.code} ${round1(c.qty)}${unitText(c.unit)} (orders ${dm(c.at, timeZone)}, no invoice)`; add(out.stillInWarehouse, c.customer, text); note('stillInWarehouse', c.customer, c.code, text, postText([c])); }
  }
  // D) recent invoice lines that neither a cut nor an OUT used up: invoiced, not left yet
  if (outKnown) {
    for (const l of lines.filter((x) => !x.used && x.customer && x.at >= since && x.qty > 0).sort((a, b) => a.at - b.at)) {
      const text = `${l.code} ${round1(l.qty)}m (invoice ${dm(l.at, timeZone)}, no OUT)`;
      add(out.invoicedNotLeft, l.customer, text); note('invoicedNotLeft', l.customer, l.code, text);
    }
  }
  // a delivery post has no code: a customer-level note when nothing at all was invoiced for him since
  const lastInvoice = new Map();
  for (const l of lines) lastInvoice.set(l.customer, Math.max(lastInvoice.get(l.customer) || 0, l.at));
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

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
const MIN_LISTED = 2; // an invoice line of 2 m or less (a sample, a piece) is not worth a line in the report
const tol = (q) => Math.max(1.5, 0.06 * q); // metres of difference that are not a difference
const digits = (c) => (String(c || '').match(/\d{2,5}/) || [''])[0]; // the product number: the first one (a truncated «21» stays «21»)
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
 * The codes an invoice item counts toward in the comparison with the stock sheet, or [] when it is no part of it.
 *  - PVC FILM (the category before «:» in the full name, or a top-level item named PVC): its own code.
 *  - EDGE BANDING: the sheet records its OUT under the same COLOUR code as the film, so a line whose colour is NNNN («... - NNNN», «COLOUR NNNN») counts toward code NNNN, added to
 *    the film lines of that code. A code is never built from a size like «0.8x22».
 *  - saw blades, services (delivery, parking), samples and everything else: nothing.
 */
export function itemCodesOf(it) {
  const name = String(it?.Name || ''); const sku = String(it?.Sku || ''); const full = String(it?.FullyQualifiedName || name);
  const category = full.includes(':') ? full.split(':')[0] : '';
  if (it?.Type === 'Service') return [];
  if (/deliver|parking|sample|transport|freight|shipping|\bsaw\b|blade/i.test(`${name} ${sku} ${category}`)) return [];
  if (/edge|banding/i.test(`${name} ${sku} ${category}`)) {
    const m = /(?:-|colou?r)\s*(\d{3,5})\s*$/i.exec(name) || /(?:-|colou?r)\s*(\d{3,5})\s*$/i.exec(full);
    return m ? [m[1]] : [];
  }
  const film = category ? /pvc\s*film/i.test(category) : /pvc/i.test(`${name} ${sku}`);
  return film ? [sku.replace(/^(?:PVC|EDGE\d*)-/i, ''), name.replace(/^.*?(\d{3,5})$/, '$1'), name] : [];
}

/** True for an item that counts toward some code (film or edge banding by colour). */
export const isFilmItem = (it) => itemCodesOf(it).length > 0;

/**
 * [events]: the tracker's events (cuts of the orders group; deliveries). [outs]: the sheet's OUT rows [{ customer, code, qty, unit, at }], or null when the sheet could not give them
 * (then nothing is claimed about what left). [invoices]: QuickBooks invoice records with Line, TxnDate, CustomerRef. [itemCodes](itemId, name) -> the codes of an item.
 * Returns { sections: { leftNotInvoiced, stillInWarehouse, invoicedNotLeft, leftWithoutPost, delivered }, outKnown, trace } where a section is [{ customer, parts: [text] }].
 */
export function threeWay({ events, outs, invoices, itemCodes = () => [], aliasOf = () => '', qboNames = [], now = Date.now(), days = 14, timeZone = 'Asia/Dubai' }) {
  const outKnown = Array.isArray(outs);
  const since = now - days * DAY;
  const firstPost = Math.min(Infinity, ...events.filter((e) => e.type === 'cut' && !e.internal && !e.simulated).map((e) => e.at)); // the orders-group history the tracker has begins here
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
      if ((l.Amount !== undefined && !(Number(l.Amount) > 0)) || (d.UnitPrice !== undefined && !(Number(d.UnitPrice) > 0))) continue; // a free line (rate 0.00: a replacement for damage, a sample) is no sale
      for (const code of new Set(itemCodes(d.ItemRef?.value, d.ItemRef?.name).map(digits).filter(Boolean))) lines.push({ customer: inv.CustomerRef?.name || '', code, qty: Number(d.Qty) || 0, left: Number(d.Qty) || 0, at, doc: inv.DocNumber || '', used: false });
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
    const near = lines.filter((l) => l.customer === customer && (sameCode(l.code, code) || prefixCode(l.code, code)) && l.left > 0 && Math.abs(l.at - at) <= INVOICE_DAYS * DAY)
      .sort((x, y) => Math.abs(x.at - at) - Math.abs(y.at - at));
    // one line that holds the quantity, else the lines of the window added up (300 m + 63 m cover a 363.2 m OUT)
    const single = near.find((l) => l.left >= qty - tol(qty));
    const chosen = single ? [single] : (near.reduce((s2, l) => s2 + l.left, 0) >= qty - tol(qty) ? near : []);
    if (!chosen.length) return null;
    let need = qty;
    for (const l of chosen) { const take = Math.min(l.left, need); l.left -= take; need -= take; l.used = true; if (need <= 1e-9) break; }
    return chosen[0];
  };
  // an invoice that exists but is too far away in days: worth a look by the owner («invoiced in advance, or a second order»)
  const older = (customer, code, qty) => lines.find((l) => l.customer === customer && (sameCode(l.code, code) || prefixCode(l.code, code)) && !l.used && Math.abs(l.qty - qty) <= tol(qty));

  const out = { leftNotInvoiced: [], quantityDiffers: [], checkCode: [], stillInWarehouse: [], invoicedNotLeft: [], leftWithoutPost: [], delivered: [] };
  const add = (list, customer, text) => { const hit = list.find((g) => g.customer === customer); if (hit) hit.parts.push(text); else list.push({ customer, parts: [text] }); };
  const trace = [];
  const note = (section, customer, code, text, extra = '') => { trace.push(`three-way: ${section} "${customer}" ${code}: ${text}${extra}`); };
  const postText = (cuts2) => (cuts2.find((c) => c.text)?.text ? ` — post: "${cuts2.find((c) => c.text).text}"` : '');

  // A) + B) the OUT rows (with a cut post, or nobody's post): a full invoice covers them; what is left over is looked at three ways
  const pending = [];
  for (const p of [...pools.values()].sort((x, y) => x.at - y.at)) {
    if (p.cuts.length) {
      const first = Math.min(...p.cuts.map((x) => x.at), p.at);
      if (cover(p.customer, p.code, first, p.qty) || cover(p.customer, p.code, p.at, p.qty)) continue; // cut + OUT + invoiced
    } else if (cover(p.customer, p.code, p.at, p.qty) || p.at < firstPost) continue; // invoiced is fine without an order post; before the tracked history nobody could have posted
    pending.push(p);
  }
  // 1) invoiced, but for another quantity: ONE line «quantity differs», never also «invoiced, not left»
  const stillPending = [];
  for (const p of pending) {
    const near = lines.filter((l) => l.customer === p.customer && (sameCode(l.code, p.code) || prefixCode(l.code, p.code)) && l.left > 0 && Math.abs(l.at - p.at) <= INVOICE_DAYS * DAY);
    const sum = near.reduce((x, l) => x + l.left, 0);
    if (!near.length || sum <= 0) { stillPending.push(p); continue; }
    for (const l of near) l.used = true;
    const diff = round1(p.qty - sum);
    const docs = [...new Set(near.map((l) => l.doc).filter(Boolean))].join(', ');
    const text = `${p.code}: OUT ${round1(p.qty)}${unitText(p.unit)} (${dm(p.at, timeZone)}) vs invoiced ${round1(sum)}m${docs ? ` (${docs})` : ''} → ${diff >= 0 ? `${diff}m not invoiced` : `${-diff}m invoiced beyond what left`}`;
    add(out.quantityDiffers, p.customer, text); note('quantityDiffers', p.customer, p.code, text);
    for (const l of near) l.left = 0;
  }
  // 2) the same customer, the same day and the same quantity under ANOTHER code: probably a wrong code on the OUT or on the invoice
  const unexplained = [];
  for (const p of stillPending) {
    const hit = lines.find((l) => l.customer === p.customer && !l.used && l.left > 0 && !sameCode(l.code, p.code) && !prefixCode(l.code, p.code) && Math.abs(l.at - p.at) <= DAY && Math.abs(l.left - p.qty) <= tol(p.qty));
    if (!hit) { unexplained.push(p); continue; }
    hit.used = true; hit.left = 0;
    const text = `OUT ${p.code} ${round1(p.qty)}${unitText(p.unit)} vs invoice ${hit.code} ${round1(hit.qty)}m on ${dm(p.at, timeZone)} — check the code`;
    add(out.checkCode, p.customer, text); note('checkCode', p.customer, p.code, text);
  }
  // 3) the rest: left and not invoiced (with a post: the real unbilled; without one: for the details)
  for (const p of unexplained) {
    if (p.cuts.length) {
      const hint = older(p.customer, p.code, p.qty);
      if (hint) hint.used = true; // said here with the OUT, not again as «invoiced, not left»
      const text = `${p.code} ${round1(p.qty)}${unitText(p.unit)} (orders ${dm(Math.max(...p.cuts.map((x) => x.at)), timeZone)}, OUT ${dm(p.at, timeZone)}, no invoice${hint ? `; check: invoice ${dm(hint.at, timeZone)} of ${round1(hint.qty)}m is older than ${INVOICE_DAYS} days` : ''})`;
      add(out.leftNotInvoiced, p.customer, text); note('leftNotInvoiced', p.customer, p.code, text, postText(p.cuts));
    } else {
      const text = `${p.code} ${round1(p.qty)}${unitText(p.unit)} (OUT ${dm(p.at, timeZone)}, no invoice)`;
      add(out.leftWithoutPost, p.customer, text); note('leftWithoutPost', p.customer, p.code, text);
    }
  }
  // C) cut posts that have no OUT row
  for (const c of cuts.filter((x) => !x.pool).sort((a, b) => a.at - b.at)) {
    if (!outKnown) { // the sheet gave nothing: the old question, cut and not invoiced
      if (!cover(c.customer, c.code, c.at, c.qty)) { const text = `${c.code} ${round1(c.qty)}${unitText(c.unit)} (orders ${dm(c.at, timeZone)}, no invoice)`; add(out.leftNotInvoiced, c.customer, text); note('leftNotInvoiced', c.customer, c.code, text, postText([c])); }
      continue;
    }
    const inv = cover(c.customer, c.code, c.at, c.qty);
    if (inv) { if (c.qty <= MIN_LISTED && inv.qty <= MIN_LISTED + 1e-9) continue; /* a 1 m or 2 m line is not worth a report line, with a post or without */ const text = `${c.code} ${round1(inv.qty)}${unitText('m')} (orders ${dm(c.at, timeZone)}, invoice ${dm(inv.at, timeZone)}, no OUT)`; add(out.invoicedNotLeft, c.customer, text); note('invoicedNotLeft', c.customer, c.code, text, postText([c])); }
    else { const text = `${c.code} ${round1(c.qty)}${unitText(c.unit)} (orders ${dm(c.at, timeZone)}, no invoice)`; add(out.stillInWarehouse, c.customer, text); note('stillInWarehouse', c.customer, c.code, text, postText([c])); }
  }
  // D) recent invoice lines that neither a cut nor an OUT used up: invoiced, not left yet
  if (outKnown) {
    const coverageStart = pools.size ? Math.min(...[...pools.values()].map((p) => p.at)) : Infinity; // the invoices before the first OUT row we have say nothing about what left
    for (const l of lines.filter((x) => !x.used && x.customer && x.at >= Math.max(since, coverageStart - DAY) && x.qty > MIN_LISTED).sort((a, b) => a.at - b.at)) {
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
  quantityDiffers: 'Quantity differs (OUT vs invoice)',
  checkCode: 'Possible wrong code (same day, same quantity)',
  invoicedNotLeft: 'Invoiced, not left yet',
  stillInWarehouse: 'Cut, still in the warehouse (not left)',
  leftWithoutPost: 'Left without an order-group post (check)',
  delivered: 'Delivered, no invoice since',
};

/**
 * The text: a block per section with its customers, the blocks apart with separators; a clean state says so in one line. The SHORT form (the default and the evening report) shows the three
 * sections that matter, at most [max] customers each, then «+N more»; [details] shows every section and every customer.
 */
export function threeWayText(result, { max = 8, days = 14, details = false } = {}) {
  const blocks = [];
  const keys = details ? ['leftNotInvoiced', 'quantityDiffers', 'checkCode', 'invoicedNotLeft', 'stillInWarehouse', 'leftWithoutPost', 'delivered'] : ['leftNotInvoiced', 'quantityDiffers', 'checkCode', 'invoicedNotLeft', 'stillInWarehouse'];
  let hidden = 0;
  for (const key of keys) {
    const list = result.sections[key] || [];
    if (!list.length) continue;
    const rows = list.map((g) => `• ${g.customer}: ${g.parts.slice(0, details ? 8 : 3).join(', ')}${g.parts.length > (details ? 8 : 3) ? ` +${g.parts.length - (details ? 8 : 3)}` : ''}`);
    const shown = details ? rows : rows.slice(0, max);
    blocks.push([`${TITLES[key]} (${list.length} customer${list.length === 1 ? '' : 's'}):`, ...shown, ...(rows.length > shown.length ? [`+${rows.length - shown.length} more`] : [])].join('\n'));
  }
  if (!details) hidden = (result.sections.leftWithoutPost || []).length + (result.sections.delivered || []).length;
  if (!result.outKnown) blocks.unshift('⚠ The stock sheet gave no OUT rows, so what left the warehouse is unknown: only «cut, not invoiced» is shown.');
  if (!blocks.length || (blocks.length === 1 && !result.outKnown)) blocks.push(`✔ Everything cut, left and invoiced in the last ${days} days agrees.`);
  if (!details && (hidden || blocks.length)) blocks.push('Say "unbilled details" for every customer' + (hidden ? ', the OUT rows nobody posted and the deliveries' : '') + '.');
  return blocks.join(`\n${SEP}\n`);
}

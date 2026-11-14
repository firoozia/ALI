// The final CUT of an order is posted in the cutting group («ART NO 220 NUQOOSH 12M»); the tracker records it. The office issues the invoice after the cut, so an invoice
// preview looks the cut up for each line: shown beside the line, a warning when the quantity differs or no cut is recorded, and the cut quantity proposed when the
// owner gave no quantity. When the invoice is created its cut lines are marked with the invoice number, so they are offered once, and a later report can list the
// cuts that have no invoice. Read only: nothing is ever posted in the group.

import { productCode } from './codes.js';
import { sameCustomer } from './tracker.js';
import { looseWords } from './namekey.js';
import { isEnglishOut } from './outlang.js';

const DAY = 24 * 3600 * 1000;
const FA = '۰۱۲۳۴۵۶۷۸۹';
export const faDigits = (s) => String(s).replace(/\d/g, (d) => FA[d]);
const code = (c) => (/catalog/i.test(String(c || '')) ? 'CATALOG' : productCode(c) || String(c || '').trim().toUpperCase()); // «ARYAK PVC CATALOG» in the books and «Catalog 0.18mm» in the group are one item
// what a warning calls a posted line: the product code, or the item and its note («CATALOG 0.18mm»); a line whose code is not a product code (a thickness read as a code)
// also quotes the post, so the owner sees what was written
const isProductCode = (k) => /^[A-Z]{0,4}\s?-?\d{3,5}(?:-\d+)?(?:\s?[A-Z])?$/.test(String(k || ''));
const postLabel = (r) => `${r.code}${r.note ? ` ${r.note}` : ''}`;
const postQuote = (r) => (!isProductCode(r.code) && r.text ? ` («${String(r.text).replace(/\s+/g, ' ').trim().slice(0, 80)}»)` : '');
const digitsOf = (c) => (String(c || '').match(/\d{2,5}/g) || []).join('-'); // «ART NO 220» and «220» share the number
// Words that say what a company does or where it is, never which company it is (a customer «MUNICH DOOR KITCHEN» is not «AL NOOR DOOR»).
export const GENERIC = new Set(['llc', 'l', 'c', 'ltd', 'co', 'company', 'trading', 'tr', 'ind', 'industries', 'industrial', 'est', 'fze', 'fzco', 'spc', 'general', 'the', 'and', 'of', 'international', 'for', 'trade', 'investment',
  'kitchen', 'kitchens', 'door', 'doors', 'wood', 'woods', 'wooden', 'furniture', 'decoration', 'decor', 'interiors', 'interior', 'carpentry', 'joinery', 'works', 'workshop', 'factory', 'group', 'design', 'designs', 'glass', 'aluminium', 'aluminum',
  'building', 'construction', 'contracting', 'contractors', 'furnishing', 'furnishings', 'national', 'dubai', 'sharjah', 'ajman', 'emirates', 'uae', 'gulf', 'al']);
const distinctive = (name) => looseWords(name).filter((w) => w.length >= 4 && !GENERIC.has(w));
/**
 * The same customer. The names are alike (sameCustomer), or they share their FIRST distinctive word (the caption says «NUQOOSH», the books say «NUQOOSH IND . LLC»; «Munich door»
 * is «MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C»), or every distinctive word of the shorter name (two or more) is in the longer one. A trade or place word alone never makes two customers one.
 */
const sameMemo = new Map(); // pure and called for every pair of names in the reports
export function sameCutCustomer(a, b) {
  if (!a || !b) return false;
  const k = a + '' + b;
  if (sameMemo.has(k)) return sameMemo.get(k);
  const made = sameCutOnce(a, b);
  if (sameMemo.size > 100000) sameMemo.clear();
  sameMemo.set(k, made);
  return made;
}

function sameCutOnce(a, b) {
  // short names written with other punctuation or spaces: «AR RAD», «AR-RAD», «ARRAD» are one name; two or more brand words that open the longer name are the same customer
  const ca = looseWords(a).filter((w) => !GENERIC.has(w)); const cb = looseWords(b).filter((w) => !GENERIC.has(w));
  const [shortWords, longWords] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  if (shortWords.length >= 1) {
    const sj = shortWords.join('');
    if (sj.length >= 4 && longWords.some((_, i) => longWords.slice(0, i + 1).join('') === sj)) return true; // equal to the first words of the longer name, joined (a whole word, never half of one)
  }
  const da = distinctive(a); const db = distinctive(b);
  if (!da.length || !db.length) return looseWords(a).join(' ') === looseWords(b).join(' '); // only trade words: the same name or nothing
  if (sameCustomer(a, b)) return true;
  if (da[0] === db[0]) return true;
  const [short, long] = da.length <= db.length ? [da, db] : [db, da];
  return short.length >= 2 && short.every((w) => long.includes(w));
}
const unitOf = (u) => ({ m: 'm', mtr: 'm', meter: 'm', متر: 'm', roll: 'roll', رول: 'roll', pcs: 'pcs', pc: 'pcs', piece: 'pcs', pieces: 'pcs' }[String(u || '').trim().toLowerCase()] || String(u || '').trim().toLowerCase());

/** The cut lines of [customer] for [codes] that no invoice has taken yet, newest first: [{ ref, index, qty, unit, at }]. */
export function cutRecords(tracker, customer, codes, { now = Date.now(), windowDays = 30, log = null } = {}) {
  const list = [].concat(codes).filter(Boolean);
  const wanted = new Set(list.map(code));
  const wantedDigits = new Set(list.map(digitsOf).filter((d) => d.length >= 2));
  if (!wanted.size || !customer) return [];
  const out = []; let cuts = 0; let ofCustomer = 0;
  for (const e of tracker.events) {
    if (e.type !== 'cut' || e.internal || e.at < now - windowDays * DAY) continue;
    cuts += 1;
    if (!(sameCutCustomer(e.customer, customer) || sameCutCustomer(e.customerTyped, customer))) continue;
    ofCustomer += 1;
    (e.lines || []).forEach((l, index) => {
      if (l.invoiced || !(Number(l.quantity) > 0)) return;
      if (!(wanted.has(code(l.code)) || (digitsOf(l.code) && wantedDigits.has(digitsOf(l.code))))) return;
      out.push({ ref: e.ref, index, qty: Number(l.quantity), unit: unitOf(l.unit) || 'm', at: e.at });
    });
  }
  if (log) log(`cut lookup: customer "${customer}", codes ${list.join('/')}: ${cuts} cut event(s) in ${windowDays} days, ${ofCustomer} of this customer, ${out.length} line(s) matched`);
  return out.sort((a, b) => b.at - a.at);
}

/** The cut lines as one figure: the sum of the records with the unit of the newest. */
export function cutTotal(records) {
  if (!records.length) return null;
  const unit = records[0].unit;
  const same = records.filter((r) => r.unit === unit);
  return { qty: Math.round(same.reduce((s, r) => s + r.qty, 0) * 1000) / 1000, unit, at: same[0].at, refs: same.map((r) => ({ ref: r.ref, index: r.index })) };
}

/** After an invoice is created: its cut lines carry the invoice number (kept in the tracker for the report of cuts with no invoice). */
export function markCutsInvoiced(tracker, refs, number, at = Date.now()) {
  let n = 0;
  for (const { ref, index } of refs || []) {
    const e = tracker.events.find((x) => x.ref === ref);
    if (!e || !e.lines?.[index] || e.lines[index].invoiced) continue;
    const lines = e.lines.map((l, i) => (i === index ? { ...l, invoiced: { number: String(number || ''), at } } : l));
    if (tracker.update(ref, { lines })) n += 1;
  }
  return n;
}

/** The cuts with no invoice yet (for the later report): [{ customer, code, qty, unit, at }]. */
export function unInvoicedCuts(tracker, { since = 0 } = {}) {
  const out = [];
  for (const e of tracker.events) {
    if (e.type !== 'cut' || e.internal || e.at < since) continue;
    for (const l of e.lines || []) if (!l.invoiced && Number(l.quantity) > 0) out.push({ customer: e.customer, code: l.code, qty: Number(l.quantity), unit: unitOf(l.unit) || 'm', at: e.at });
  }
  return out.sort((a, b) => b.at - a.at);
}

// ---- the day: Gregorian everywhere (the owner's rule), DD/MM in a list
/** «30/10» for a time stamp, in the time zone of the books (the digits Persian, as the rest of a Persian line). */
export function gregorianDay(ms, timeZone = 'Asia/Dubai') {
  const [, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-');
  return faDigits(`${d}/${m}`);
}

/** «برش: ۱۲ متر، ۳۰/۱۰، گروه سفارش آریاک». */
export function cutLine(total, { label = 'گروه سفارش آریاک', timeZone = 'Asia/Dubai' } = {}) {
  if (isEnglishOut()) { // «Cut: 12 m, 08/11, orders group»
    const day = new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: '2-digit' }).format(new Date(total.at)); // 08/11
    const where = /[؀-ۿ]/.test(label) ? 'orders group' : label;
    return `Cut: ${total.qty} ${total.unit === 'm' ? 'm' : total.unit === 'roll' ? 'roll' : total.unit}, ${day}, ${where}`;
  }
  const unit = total.unit === 'm' ? 'متر' : total.unit === 'roll' ? 'رول' : total.unit;
  return `برش: ${faDigits(total.qty)} ${unit}، ${gregorianDay(total.at, timeZone)}، ${label}`;
}

// ---- the cross-check of an invoice with the cutting group («Aryak Orders»): read only, a warning and never a stop
const dm = (ms, timeZone = 'Asia/Dubai') => { const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-'); return `${d}/${m}`; };
const amount = (qty, unit) => `${Math.round(qty * 1000) / 1000}${unit === 'm' ? 'm' : unit === 'roll' ? ' roll' : ` ${unit}`}`;

/**
 * [lines]: [{ code, sku, name, qty }] of the invoice. [invoiced]: the customer's invoice lines in QuickBooks since the cuts (the office's on the screen AND ours):
 * [{ codes: [..], qty, number, at }], or null when QuickBooks could not be read (then «not invoiced» and «already invoiced» are not claimed). THE OWNER'S RULE: the invoice follows
 * what the customer ORDERED, not what was cut (a margin, the end of a roll): a cut LARGER than the invoice is normal and never a warning. A cut counts as invoiced when an
 * invoice line of the same customer and the same code is dated on or after the cut day, whatever its quantity. Warned: no cut at all, an invoice line for a cut already
 * invoiced, an invoice LARGER than the cut, a cut no invoice carries. Returns { problems, more }: at most [max] lines, then the count of the rest. [log](text) says what matched.
 */
export function crossCheck(tracker, customer, lines, { now = Date.now(), windowDays = 30, timeZone = 'Asia/Dubai', invoiced = null, max = 5, log = null, aliasOf = () => '', trackedSince = 0, outs = null } = {}) {
  const rows = [];
  const forCustomer = (name) => sameCutCustomer(name, customer) || (!!aliasOf(name) && sameCutCustomer(aliasOf(name), customer)); // an alias the owner approved stands for the QuickBooks name
  for (const e of tracker.events) {
    if (e.type !== 'cut' || e.internal || e.at < now - windowDays * DAY) continue;
    if (!(forCustomer(e.customer) || forCustomer(e.customerTyped))) continue;
    (e.lines || []).forEach((l) => { if (Number(l.quantity) > 0) rows.push({ code: code(l.code), digits: digitsOf(l.code), qty: Number(l.invoiceQuantity) > 0 ? Number(l.invoiceQuantity) : Number(l.quantity), unit: unitOf(l.unit) || 'm', at: e.at, tracked: l.invoiced || null, ref: e.ref, post: e.customerTyped || e.customer, note: l.note || '', text: e.text || '', left: !l.invoiced, by: l.invoiced ? { number: l.invoiced.number, at: l.invoiced.at } : null }); });
  }
  const same = (r, inv) => (inv.codes || []).some((k) => code(k) === r.code || (r.digits && digitsOf(k) === r.digits));
  if (invoiced) { // the SAME pairing as «unbilled»: an invoice line of this customer and this code within +-windowDays of the cut, before OR after it (an invoice may come the day before the cut);
    // each invoice line is used up by what it takes (a margin is normal: a cut larger than its line still counts, but a line takes cuts only while some of it is left)
    const left = new Map(invoiced.map((inv) => [inv, Number(inv.qty) || 0]));
    const tol = (q) => Math.max(1.5, 0.06 * q);
    for (const r of [...rows].sort((a, b) => a.at - b.at)) {
      if (!r.left) continue;
      // an invoice line from before the tracking began (its cuts were never seen here) never pairs with a cut after it; the NEAREST date pairs first
      const cands = invoiced.filter((inv) => same(r, inv) && Math.abs(inv.at - r.at) <= windowDays * DAY && left.get(inv) > 0.0001 && !(trackedSince && inv.at < trackedSince && r.at >= trackedSince));
      const hit = cands.sort((a, b) => Math.abs(a.at - r.at) - Math.abs(b.at - r.at))[0];
      if (hit) { left.set(hit, Math.max(0, left.get(hit) - r.qty)); r.left = false; r.by = { number: hit.number, at: hit.at }; }
    }
  }
  const problems = []; const covered = [];
  const taken = new Set();
  for (const ln of lines) {
    const shown = ln.code || (/catalog/i.test(`${ln.sku || ''} ${ln.name || ''}`) ? 'CATALOG' : (/\d{2,}/.exec(ln.sku || ln.name || '') || [''])[0]);
    const wanted = new Set([ln.code, String(ln.sku || '').replace(/^(?:PVC|EDGE\d*)-/i, ''), String(ln.name || '').replace(/^.*?(\d{3,5})$/, '$1')].filter(Boolean).map(code));
    const wantedDigits = new Set([...wanted].map(digitsOf).filter((d) => d.length >= 2));
    const mine = rows.filter((r) => wanted.has(r.code) || (r.digits && wantedDigits.has(r.digits)));
    mine.forEach((r) => taken.add(r));
    const open = mine.filter((r) => r.left);
    const done = mine.filter((r) => !r.left);
    if (log) log(`cross-check: line ${shown} x${ln.qty} for "${customer}": ${mine.length} cut(s) of this customer (posts named: ${[...new Set(mine.map((r) => r.post))].join(' | ') || '-'}), ${open.length} open, ${done.length} invoiced`);
    if (!mine.length) problems.push(`${shown}: not cut yet (no orders-group post)`);
    else if (!open.length) { if (invoiced || done[0].tracked) problems.push(`${shown}: already invoiced${done[0].by?.number ? ` (${done[0].by.number})` : ''} on ${dm(done[0].by?.at || done[0].at, timeZone)}`); }
    else if (open.every((r) => r.unit === 'm')) { // meters against meters only: a count of pieces is another measure
      const total = open.reduce((x, r) => x + r.qty, 0);
      if (Number(ln.qty) > total + 0.001) problems.push(`${shown}: invoice has ${ln.qty}, cut ${amount(total, 'm')} on ${dm(open[0].at, timeZone)}`); // charging more than was cut
      else covered.push(`${shown}: cut ${dm(open[0].at, timeZone) === dm(now, timeZone) ? 'today' : 'on ' + dm(open[0].at, timeZone)}, this invoice covers it`);
      if (Array.isArray(outs) && !outs.some((o) => (forCustomer(o.customer)) && digitsOf(o.code) === digitsOf(shown) && Math.abs(Number(o.at) - open[0].at) <= windowDays * DAY)) problems.push(`${shown}: not left the warehouse yet`); // the stock sheet has no OUT for it
    }
  }
  if (invoiced) { // orders cut for this customer that no invoice (the office's or ours) carries and no line of this invoice takes
    const missing = new Map();
    for (const r of rows) if (r.left && !taken.has(r)) missing.set(postLabel(r), [...(missing.get(postLabel(r)) || []), r]);
    for (const [k, list] of missing) {
      if (log) log(`cross-check: cut ${k} of "${customer}" (post named: ${[...new Set(list.map((r) => r.post))].join(' | ')}) has no invoice line since ${dm(list[0].at, timeZone)}`);
      problems.push(`${k}: ${list[0].code === 'CATALOG' ? 'given' : 'cut'} ${amount(list.reduce((x, r) => x + r.qty, 0), list[0].unit)} on ${dm(list[0].at, timeZone)}${postQuote(list[0])}, not invoiced`);
    }
  }
  return { problems: problems.slice(0, max), more: Math.max(0, problems.length - max), covered: covered.slice(0, max) };
}

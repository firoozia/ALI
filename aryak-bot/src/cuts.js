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
const code = (c) => productCode(c) || String(c || '').trim().toUpperCase();
const digitsOf = (c) => (String(c || '').match(/\d{2,5}/g) || []).join('-'); // «ART NO 220» and «220» share the number
// Words that say what a company does or where it is, never which company it is (a customer «MUNICH DOOR KITCHEN» is not «AL NOOR DOOR»).
const GENERIC = new Set(['llc', 'l', 'c', 'ltd', 'co', 'company', 'trading', 'tr', 'ind', 'industries', 'industrial', 'est', 'fze', 'fzco', 'spc', 'general', 'the', 'and', 'of', 'international', 'for', 'trade', 'investment',
  'kitchen', 'kitchens', 'door', 'doors', 'wood', 'woods', 'wooden', 'furniture', 'decoration', 'decor', 'interiors', 'interior', 'carpentry', 'joinery', 'works', 'workshop', 'factory', 'group', 'design', 'designs', 'glass', 'aluminium', 'aluminum',
  'building', 'construction', 'contracting', 'contractors', 'furnishing', 'furnishings', 'national', 'dubai', 'sharjah', 'ajman', 'emirates', 'uae', 'gulf', 'al']);
const distinctive = (name) => looseWords(name).filter((w) => w.length >= 4 && !GENERIC.has(w));
/**
 * The same customer. The names are alike (sameCustomer), or they share their FIRST distinctive word (the caption says «NUQOOSH», the books say «NUQOOSH IND . LLC»; «Munich door»
 * is «MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C»), or every distinctive word of the shorter name (two or more) is in the longer one. A trade or place word alone never makes two customers one.
 */
export function sameCutCustomer(a, b) {
  if (!a || !b) return false;
  const da = distinctive(a); const db = distinctive(b);
  if (!da.length || !db.length) return looseWords(a).join(' ') === looseWords(b).join(' '); // only trade words: the same name or nothing
  if (sameCustomer(a, b)) return true;
  if (da[0] === db[0]) return true;
  const [short, long] = da.length <= db.length ? [da, db] : [db, da];
  return short.length >= 2 && short.every((w) => long.includes(w));
}
const unitOf = (u) => ({ m: 'm', mtr: 'm', meter: 'm', متر: 'm', roll: 'roll', رول: 'roll' }[String(u || '').trim().toLowerCase()] || String(u || '').trim().toLowerCase());

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

// ---- the day in the Persian calendar, as the office writes it («۸ آبان»)
const JMONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
function toJalali(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979; gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + gdm[gm - 1];
  jy += 33 * Math.floor(days / 12053); days %= 12053;
  jy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}
/** «۸ آبان» for a time stamp, in the time zone of the books. */
export function persianDay(ms, timeZone = 'Asia/Dubai') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-').map(Number);
  const j = toJalali(parts[0], parts[1], parts[2]);
  return `${faDigits(j.jd)} ${JMONTHS[j.jm - 1]}`;
}

/** «برش: ۱۲ متر، ۸ آبان، گروه سفارش آریاک». */
export function cutLine(total, { label = 'گروه سفارش آریاک', timeZone = 'Asia/Dubai' } = {}) {
  if (isEnglishOut()) { // «Cut: 12 m, 8 Nov, orders group»
    const day = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(new Date(total.at));
    const where = /[؀-ۿ]/.test(label) ? 'orders group' : label;
    return `Cut: ${total.qty} ${total.unit === 'm' ? 'm' : total.unit === 'roll' ? 'roll' : total.unit}, ${day}, ${where}`;
  }
  const unit = total.unit === 'm' ? 'متر' : total.unit === 'roll' ? 'رول' : total.unit;
  return `برش: ${faDigits(total.qty)} ${unit}، ${persianDay(total.at, timeZone)}، ${label}`;
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
export function crossCheck(tracker, customer, lines, { now = Date.now(), windowDays = 30, timeZone = 'Asia/Dubai', invoiced = null, max = 5, log = null } = {}) {
  const rows = [];
  for (const e of tracker.events) {
    if (e.type !== 'cut' || e.internal || e.at < now - windowDays * DAY) continue;
    if (!(sameCutCustomer(e.customer, customer) || sameCutCustomer(e.customerTyped, customer))) continue;
    (e.lines || []).forEach((l) => { if (Number(l.quantity) > 0) rows.push({ code: code(l.code), digits: digitsOf(l.code), qty: Number(l.quantity), unit: unitOf(l.unit) || 'm', at: e.at, tracked: l.invoiced || null, ref: e.ref, post: e.customerTyped || e.customer, left: !l.invoiced, by: l.invoiced ? { number: l.invoiced.number, at: l.invoiced.at } : null }); });
  }
  const same = (r, inv) => (inv.codes || []).some((k) => code(k) === r.code || (r.digits && digitsOf(k) === r.digits));
  if (invoiced) { // any invoice line of this customer and this code, on or after the cut day, takes the cut
    for (const r of rows) {
      if (!r.left) continue;
      const hit = invoiced.find((inv) => same(r, inv) && inv.at >= r.at - DAY);
      if (hit) { r.left = false; r.by = { number: hit.number, at: hit.at }; }
    }
  }
  const problems = [];
  const taken = new Set();
  for (const ln of lines) {
    const shown = ln.code || (/\d{2,}/.exec(ln.sku || ln.name || '') || [''])[0];
    const wanted = new Set([ln.code, String(ln.sku || '').replace(/^(?:PVC|EDGE\d*)-/i, ''), String(ln.name || '').replace(/^.*?(\d{3,5})$/, '$1')].filter(Boolean).map(code));
    const wantedDigits = new Set([...wanted].map(digitsOf).filter((d) => d.length >= 2));
    const mine = rows.filter((r) => wanted.has(r.code) || (r.digits && wantedDigits.has(r.digits)));
    mine.forEach((r) => taken.add(r));
    const open = mine.filter((r) => r.left);
    const done = mine.filter((r) => !r.left);
    if (log) log(`cross-check: line ${shown} x${ln.qty} for "${customer}": ${mine.length} cut(s) of this customer (posts named: ${[...new Set(mine.map((r) => r.post))].join(' | ') || '-'}), ${open.length} open, ${done.length} invoiced`);
    if (!mine.length) problems.push(`${shown}: no order found`);
    else if (!open.length) { if (invoiced || done[0].tracked) problems.push(`${shown}: already invoiced${done[0].by?.number ? ` (${done[0].by.number})` : ''} on ${dm(done[0].by?.at || done[0].at, timeZone)}`); }
    else if (open.every((r) => r.unit === 'm')) { // meters against meters only: a count of pieces is another measure
      const total = open.reduce((x, r) => x + r.qty, 0);
      if (Number(ln.qty) > total + 0.001) problems.push(`${shown}: invoice has ${ln.qty}, cut ${amount(total, 'm')} on ${dm(open[0].at, timeZone)}`); // charging more than was cut
    }
  }
  if (invoiced) { // orders cut for this customer that no invoice (the office's or ours) carries and no line of this invoice takes
    const missing = new Map();
    for (const r of rows) if (r.left && !taken.has(r)) missing.set(r.code, [...(missing.get(r.code) || []), r]);
    for (const [k, list] of missing) {
      if (log) log(`cross-check: cut ${k} of "${customer}" (post named: ${[...new Set(list.map((r) => r.post))].join(' | ')}) has no invoice line since ${dm(list[0].at, timeZone)}`);
      problems.push(`${k}: cut ${amount(list.reduce((x, r) => x + r.qty, 0), list[0].unit)} on ${dm(list[0].at, timeZone)}, not invoiced`);
    }
  }
  return { problems: problems.slice(0, max), more: Math.max(0, problems.length - max) };
}

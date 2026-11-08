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
const GENERIC = new Set(['llc', 'l', 'c', 'ltd', 'co', 'company', 'trading', 'ind', 'industries', 'industrial', 'est', 'fze', 'fzco', 'general', 'the', 'and', 'of', 'international', 'for', 'trade', 'investment', 'kitchen', 'kitchens', 'doors', 'furniture', 'decoration', 'interiors', 'carpentry', 'al']);
/** The same customer: one name holds the other, or they share a distinctive word (the caption says «NUQOOSH», the books say «NUQOOSH IND . LLC»). */
export function sameCutCustomer(a, b) {
  if (!a || !b) return false;
  if (sameCustomer(a, b)) return true;
  const wa = new Set(looseWords(a).filter((w) => w.length >= 4 && !GENERIC.has(w)));
  return looseWords(b).some((w) => w.length >= 4 && !GENERIC.has(w) && wa.has(w));
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
 * [{ codes: [..], qty, number, at }], or null when QuickBooks could not be read (then «not invoiced» and «already invoiced» are not claimed). A cut counts as invoiced
 * when the invoices of that code since the cut day carry its quantity (oldest cut first). Returns { problems, more }: at most [max] lines, then the count of the rest.
 * Problems: '211: no order found', '507: already invoiced (inv-9981) on 06/11', '509: cut 12m on 06/11, invoice has 10', '503: cut 8m on 07/11, not invoiced'.
 */
export function crossCheck(tracker, customer, lines, { now = Date.now(), windowDays = 30, timeZone = 'Asia/Dubai', invoiced = null, max = 5 } = {}) {
  const rows = [];
  for (const e of tracker.events) {
    if (e.type !== 'cut' || e.internal || e.at < now - windowDays * DAY) continue;
    if (!(sameCutCustomer(e.customer, customer) || sameCutCustomer(e.customerTyped, customer))) continue;
    (e.lines || []).forEach((l) => { if (Number(l.quantity) > 0) rows.push({ code: code(l.code), digits: digitsOf(l.code), qty: Number(l.quantity), unit: unitOf(l.unit) || 'm', at: e.at, tracked: l.invoiced || null, left: l.invoiced ? 0 : Number(l.quantity), by: l.invoiced ? { number: l.invoiced.number, at: l.invoiced.at } : null }); });
  }
  // QuickBooks' own invoices take the cuts they carry: per code, the oldest cut first, only invoices dated on or after the cut day
  const same = (r, inv) => (inv.codes || []).some((k) => code(k) === r.code || (r.digits && digitsOf(k) === r.digits));
  if (invoiced) {
    const pool = invoiced.map((inv) => ({ ...inv, rest: Number(inv.qty) || 0 }));
    for (const r of [...rows].sort((a, b) => a.at - b.at)) {
      if (r.left <= 0.001) continue;
      for (const inv of pool) {
        if (inv.rest <= 0.001 || !same(r, inv) || inv.at < r.at - DAY) continue;
        const take = Math.min(inv.rest, r.left); inv.rest -= take; r.left -= take; r.by = r.by || { number: inv.number, at: inv.at };
        if (r.left <= 0.001) break;
      }
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
    const open = mine.filter((r) => r.left > 0.001);
    const done = mine.filter((r) => r.left <= 0.001);
    if (!mine.length) problems.push(`${shown}: no order found`);
    else if (!open.length) { if (invoiced || done[0].tracked) problems.push(`${shown}: already invoiced${done[0].by?.number ? ` (${done[0].by.number})` : ''} on ${dm(done[0].by?.at || done[0].at, timeZone)}`); }
    else if (open.every((r) => r.unit === 'm')) { // meters against meters only: a count of pieces is another measure
      const total = open.reduce((x, r) => x + r.left, 0);
      if (Math.abs(total - Number(ln.qty)) > 0.001) problems.push(`${shown}: cut ${amount(total, 'm')} on ${dm(open[0].at, timeZone)}, invoice has ${ln.qty}`);
    }
  }
  if (invoiced) { // orders cut for this customer that no invoice (the office's or ours) carries and no line of this invoice takes
    const missing = new Map();
    for (const r of rows) if (r.left > 0.001 && !taken.has(r)) missing.set(r.code, [...(missing.get(r.code) || []), r]);
    for (const [k, list] of missing) problems.push(`${k}: cut ${amount(list.reduce((x, r) => x + r.left, 0), list[0].unit)} on ${dm(list[0].at, timeZone)}, not invoiced`);
  }
  return { problems: problems.slice(0, max), more: Math.max(0, problems.length - max) };
}

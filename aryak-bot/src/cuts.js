// The final CUT of an order is posted in the cutting group («ART NO 220 NUQOOSH 12M»); the tracker records it. The office issues the invoice after the cut, so an invoice
// preview looks the cut up for each line: shown beside the line, a warning when the quantity differs or no cut is recorded, and the cut quantity proposed when the
// owner gave no quantity. When the invoice is created its cut lines are marked with the invoice number, so they are offered once, and a later report can list the
// cuts that have no invoice. Read only: nothing is ever posted in the group.

import { productCode } from './codes.js';
import { sameCustomer } from './tracker.js';

const DAY = 24 * 3600 * 1000;
const FA = '۰۱۲۳۴۵۶۷۸۹';
export const faDigits = (s) => String(s).replace(/\d/g, (d) => FA[d]);
const code = (c) => productCode(c) || String(c || '').trim().toUpperCase();
const unitOf = (u) => ({ m: 'm', mtr: 'm', meter: 'm', متر: 'm', roll: 'roll', رول: 'roll' }[String(u || '').trim().toLowerCase()] || String(u || '').trim().toLowerCase());

/** The cut lines of [customer] for [codes] that no invoice has taken yet, newest first: [{ ref, index, qty, unit, at }]. */
export function cutRecords(tracker, customer, codes, { now = Date.now(), windowDays = 30 } = {}) {
  const wanted = new Set([].concat(codes).filter(Boolean).map(code));
  if (!wanted.size || !customer) return [];
  const out = [];
  for (const e of tracker.events) {
    if (e.type !== 'cut' || e.internal || e.at < now - windowDays * DAY || !sameCustomer(e.customer, customer)) continue;
    (e.lines || []).forEach((l, index) => {
      if (l.invoiced || !wanted.has(code(l.code)) || !(Number(l.quantity) > 0)) return;
      out.push({ ref: e.ref, index, qty: Number(l.quantity), unit: unitOf(l.unit) || 'm', at: e.at });
    });
  }
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
  const unit = total.unit === 'm' ? 'متر' : total.unit === 'roll' ? 'رول' : total.unit;
  return `برش: ${faDigits(total.qty)} ${unit}، ${persianDay(total.at, timeZone)}، ${label}`;
}

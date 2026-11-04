// What can be checked on an invoice without asking anyone: the arithmetic, VAT, the prices against the owner's list
// (and a customer's special price), the invoice number (a repeat, a gap). The model only READS the invoice into lines
// and totals; every comparison here is plain arithmetic. The result is a list of problems; nothing is ever changed.

import { compareLine, normUnit } from './prices.js';
import { normalizeDigits } from './text.js';

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const has = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));
// Amounts are dirhams with two decimals, as on a UAE invoice.
const money = (n) => round2(n).toFixed(2);
const DIRHAM = /^(aed|dhs?|dirhams?|د\.إ|درهم)$/i;

/** "inv-9919" -> { prefix: 'inv-', n: 9919 }; null when there is no trailing number. */
export function splitNumber(number) {
  const m = /^(.*?)(\d+)$/.exec(normalizeDigits(String(number || '')).toLowerCase().replace(/\s+/g, ''));
  return m ? { prefix: m[1], n: Number(m[2]) } : null;
}

/**
 * The invoice number against the invoices seen before ([seen]: their numbers). A repeat is urgent; a jump over numbers
 * never seen (at most 20 ahead of the highest known) is only a note, because the missing ones may simply not have been
 * posted in this group.
 */
export function checkNumber(number, seen) {
  const cur = splitNumber(number);
  if (!cur) return [];
  const same = seen.map(splitNumber).filter((s) => s && s.prefix === cur.prefix);
  if (same.some((s) => s.n === cur.n)) {
    return [{ kind: 'duplicate', item: String(number), requested: '', invoiced: String(number), note: 'این شماره پیش‌تر هم فرستاده شده است', severity: 'urgent' }];
  }
  const max = same.reduce((m, s) => Math.max(m, s.n), 0);
  if (max && cur.n > max + 1 && cur.n - max <= 20) {
    const missing = Array.from({ length: cur.n - max - 1 }, (_, i) => `${cur.prefix}${max + 1 + i}`);
    return [{ kind: 'gap', item: String(number), requested: missing.slice(0, 5).join('، '), invoiced: '', note: `شماره‌های ${missing.length} فاکتور بین این و فاکتور قبلی دیده نشد`, severity: 'info' }];
  }
  return [];
}

/**
 * [invoice]: { number, customer, lines: [{ code, quantity, unit, unit_price, line_total }], subtotal, vat, total }.
 * [book]: the PriceBook (may be empty), [day]: the invoice day, [vatRate]: percent, [tol]: money tolerance for rounding.
 */
export function auditInvoice(invoice, { book, day = '', vatRate = 5, tol = 0.05, customer = '', sheetUnits = {} } = {}) {
  const problems = [];
  const lines = Array.isArray(invoice?.lines) ? invoice.lines : [];
  // The currency is always the dirham: anything else printed is a mistake.
  const cur = String(invoice?.currency || '').trim();
  if (cur && !DIRHAM.test(cur)) problems.push({ kind: 'currency', item: '', requested: 'AED', invoiced: cur, note: 'واحد پول فاکتور باید درهم باشد', severity: 'urgent' });
  const who = customer || invoice?.customer || '';
  for (const l of lines) {
    const code = String(l.code || '').trim();
    if (!code) continue;
    if (has(l.quantity) && has(l.unit_price) && has(l.line_total)) {
      const expected = round2(Number(l.quantity) * Number(l.unit_price));
      if (Math.abs(expected - Number(l.line_total)) > tol) {
        problems.push({ kind: 'line-total', item: code, requested: `${l.quantity} × ${l.unit_price} = ${money(expected)}`, invoiced: money(l.line_total), note: 'مبلغ ردیف با مقدار ضربدر قیمت نمی‌خواند', severity: 'urgent' });
      }
    }
    // The unit of the line against the item's own unit in the stock sheet: metres for film, pieces for hardware.
    const own = sheetUnits[code.toUpperCase()] || '';
    if (own && l.unit && normUnit(own) !== normUnit(l.unit)) {
      problems.push({ kind: 'unit-sheet', item: code, requested: String(own), invoiced: String(l.unit), note: 'واحد این ردیف با واحد کالا در برگه موجودی فرق دارد (مثلاً متر به جای عدد)', severity: 'urgent' });
    }
    if (book?.loaded) {
      const c = compareLine(book, l, who, day, { sheetUnit: own });
      const seen = c.source === 'exception' ? ' (قیمت استثنای مشتری)' : '';
      if (c.status === 'below') {
        problems.push({ kind: 'price-below', item: code, requested: money(c.expected), invoiced: money(l.unit_price), note: `قیمت ${Math.abs(c.pct)} درصد کمتر از لیست است${seen}${c.anomaly ? '، فاصله غیرعادی' : ''}`, severity: 'urgent' });
      } else if (c.status === 'above') {
        problems.push({ kind: 'price-above', item: code, requested: money(c.expected), invoiced: money(l.unit_price), note: `قیمت ${c.pct} درصد بیشتر از لیست است${seen}${c.anomaly ? '، فاصله غیرعادی' : ''}`, severity: 'info' });
      } else if (c.status === 'unit') {
        problems.push({ kind: 'unit', item: code, requested: `${money(c.expected)} / ${c.expectedUnit}`, invoiced: `${l.unit_price} / ${l.unit || '—'}`, note: 'واحد قیمت با لیست فرق دارد', severity: 'urgent' });
      } else if (c.status === 'missing') {
        problems.push({ kind: 'price-missing', item: code, requested: money(c.expected), invoiced: '', note: 'قیمتی روی این ردیف چاپ نشده است', severity: 'info' });
      }
    }
  }
  const withTotals = lines.filter((l) => has(l.line_total));
  if (has(invoice?.subtotal) && withTotals.length && withTotals.length === lines.length) {
    const sum = round2(withTotals.reduce((s, l) => s + Number(l.line_total), 0));
    if (Math.abs(sum - Number(invoice.subtotal)) > tol) problems.push({ kind: 'subtotal', item: '', requested: money(sum), invoiced: money(invoice.subtotal), note: 'جمع ردیف‌ها با جمع جزء فاکتور نمی‌خواند', severity: 'urgent' });
  }
  if (has(invoice?.vat) && has(invoice?.subtotal)) {
    if (invoice.prices_include_vat === true) {
      // The prices on the lines already hold the VAT: the lines add up to the grand total, the VAT is the share inside it.
      if (has(invoice.total)) {
        const inside = round2((Number(invoice.total) * vatRate) / (100 + vatRate));
        if (Math.abs(inside - Number(invoice.vat)) > tol) problems.push({ kind: 'vat', item: '', requested: money(inside), invoiced: money(invoice.vat), note: `مالیات ${vatRate} درصدِ داخل جمع کل نمی‌شود`, severity: 'urgent' });
        if (Math.abs(Number(invoice.subtotal) - Number(invoice.total)) > tol) problems.push({ kind: 'total', item: '', requested: money(invoice.subtotal), invoiced: money(invoice.total), note: 'قیمت‌ها با مالیات است؛ جمع ردیف‌ها باید برابر جمع کل باشد', severity: 'urgent' });
      }
    } else {
      const expected = round2((Number(invoice.subtotal) * vatRate) / 100);
      if (Math.abs(expected - Number(invoice.vat)) > tol) problems.push({ kind: 'vat', item: '', requested: money(expected), invoiced: money(invoice.vat), note: `مالیات ${vatRate} درصد از جمع جزء نمی‌شود`, severity: 'urgent' });
      if (has(invoice?.total)) {
        const total = round2(Number(invoice.subtotal) + Number(invoice.vat));
        if (Math.abs(total - Number(invoice.total)) > tol) problems.push({ kind: 'total', item: '', requested: money(total), invoiced: money(invoice.total), note: 'جمع کل با جمع جزء به‌اضافهٔ مالیات نمی‌خواند', severity: 'urgent' });
      }
    }
  }
  return problems;
}

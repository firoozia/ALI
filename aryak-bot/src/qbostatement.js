// A CUSTOMER STATEMENT built from QuickBooks data (the API has no statement entity and no send-statement action). Open invoices, payments, credit
// memos and the customer's balance come from the API; every amount is kept in fils (whole numbers), so the totals equal QuickBooks to the fil. The
// closing balance is the sum of the open invoices less unapplied payments and credit memo balances, and it is checked against QuickBooks' own balance
// of the customer. The opening balance is closing minus the activity of the period, so nothing outside the listed lines can break the arithmetic.
// One A4 page (more pages when the lines need them): company header, customer, period, opening balance, lines, closing balance, ageing buckets.

import fs from 'node:fs';
import path from 'node:path';
import { MiniPdf, readImage, textWidth } from './minipdf.js';
import { qboEscape } from './qbo.js';

const fils = (x) => Math.round(Number(x || 0) * 100);
const DAY = 86400000;
const dayNum = (iso) => Math.floor(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / DAY);

/** 123456 -> "1,234.56"; -50 -> "-0.50". */
export function money(f) {
  const n = Math.abs(f);
  const s = `${Math.floor(n / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(n % 100).padStart(2, '0')}`;
  return f < 0 ? `-${s}` : s;
}

const addr = (a) => (a ? [a.Line1, a.Line2, a.Line3, [a.City, a.CountrySubDivisionCode].filter(Boolean).join(' '), a.Country].filter(Boolean) : []);

/**
 * The statement as plain data. [company]: CompanyInfo; [customer]: Customer; [invoices], [payments], [credits]: all the customer's rows;
 * [today]: yyyy-mm-dd; [days]: the length of the period.
 */
export function buildStatementData({ company, customer, preferences = null, invoices = [], payments = [], credits = [], today, days = 90, from = '', to = '' }) {
  // [from], [to]: a chosen period (yyyy-mm-dd). The balance at its end is today's balance less what happened after it; the opening balance is that
  // closing less the activity of the period. A period that ends today (or later) is the ordinary statement.
  const historical = !!to && dayNum(to) < dayNum(today);
  const end = historical ? dayNum(to) : dayNum(today);
  const start = from ? dayNum(from) : end - days;
  const startIso = new Date(start * DAY).toISOString().slice(0, 10);
  const open = invoices.filter((i) => fils(i.Balance) !== 0);
  const unappliedPayments = payments.reduce((s, p) => s + fils(p.UnappliedAmt), 0);
  const creditBalance = credits.reduce((s, c) => s + fils(c.Balance), 0);
  const closingNow = open.reduce((s, i) => s + fils(i.Balance), 0) - unappliedPayments - creditBalance;
  const after = historical
    ? invoices.filter((t) => dayNum(t.TxnDate) > end).reduce((s, t) => s + fils(t.TotalAmt), 0)
      - payments.filter((t) => dayNum(t.TxnDate) > end).reduce((s, t) => s + fils(t.TotalAmt), 0)
      - credits.filter((t) => dayNum(t.TxnDate) > end).reduce((s, t) => s + fils(t.TotalAmt), 0)
    : 0;
  const closing = closingNow - after;
  const inPeriod = (t) => { const d = dayNum(t.TxnDate); return d >= start && d <= end; };
  const lines = [
    ...invoices.filter(inPeriod).map((t) => ({ date: t.TxnDate, type: 'Invoice', ref: t.DocNumber || '', due: t.DueDate || '', amount: fils(t.TotalAmt) })),
    ...payments.filter(inPeriod).map((t) => ({ date: t.TxnDate, type: 'Payment', ref: t.PaymentRefNum || t.DocNumber || '', due: '', amount: -fils(t.TotalAmt) })),
    ...credits.filter(inPeriod).map((t) => ({ date: t.TxnDate, type: 'Credit memo', ref: t.DocNumber || '', due: '', amount: -fils(t.TotalAmt) })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type < b.type ? -1 : 1));
  const activity = lines.reduce((s, l) => s + l.amount, 0);
  const opening = closing - activity;
  let run = opening;
  for (const l of lines) { run += l.amount; l.balance = run; }
  const ageing = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91: 0 };
  for (const i of open) {
    const past = end - dayNum(i.DueDate || i.TxnDate);
    const k = past <= 0 ? 'current' : past <= 30 ? 'd1_30' : past <= 60 ? 'd31_60' : past <= 90 ? 'd61_90' : 'd91';
    ageing[k] += fils(i.Balance);
  }
  // the open invoices one by one, so every bucket can be checked against its own invoice
  const openItems = open.map((i) => ({ ref: i.DocNumber || '', due: i.DueDate || i.TxnDate || '', past: end - dayNum(i.DueDate || i.TxnDate), balance: fils(i.Balance) })).sort((a, b) => (a.due < b.due ? -1 : 1));
  const credit = -(unappliedPayments + creditBalance);
  // The currency is the company's own (Preferences HomeCurrency; the country only if that cannot be read); a customer with his own currency
  // (multicurrency on) uses it, and then every amount of his is in it.
  const home = preferences?.CurrencyPrefs?.HomeCurrency?.value || ({ AE: 'AED', US: 'USD', GB: 'GBP', SA: 'SAR', OM: 'OMR' })[company?.Country] || '';
  const currency = customer?.CurrencyRef?.value || home;
  const foreign = [...invoices, ...payments, ...credits].some((t) => t.CurrencyRef?.value && currency && t.CurrencyRef.value !== currency);
  const qbBalance = customer?.Balance === undefined ? null : fils(customer.Balance);
  return {
    company: { name: company?.CompanyName || company?.LegalName || '', lines: addr(company?.CompanyAddr), email: company?.Email?.Address || '', web: company?.WebAddr?.URI || '' },
    customer: { name: customer?.DisplayName || customer?.CompanyName || '', lines: addr(customer?.BillAddr), phone: customer?.PrimaryPhone?.FreeFormNumber || customer?.Mobile?.FreeFormNumber || '' },
    // the QuickBooks app's transaction statement: one row per invoice dated in the period, its total and what was received on it so far
    txn: invoices.filter(inPeriod).map((t) => ({ date: t.TxnDate, ref: t.DocNumber || '', amount: fils(t.TotalAmt), received: fils(t.TotalAmt) - fils(t.Balance) }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)),
    today, start: startIso, periodEnd: new Date(end * DAY).toISOString().slice(0, 10), historical, currency, opening, lines, closing, ageing, credit, openItems,
    ageingTotal: Object.values(ageing).reduce((s, v) => s + v, 0) + credit,
    balanceCheck: { qbo: qbBalance, matches: historical || qbBalance === null ? null : qbBalance === closing },
    warnings: [...(historical ? ['Balance at the end of the period = today\'s balance less the invoices, payments and credit memos dated after it.'] : []), ...(foreign ? [`Some transactions are in another currency than ${currency}; their amounts are in the transaction currency.`] : [])],
  };
}

const dmy = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

/** The company logo from a file on the server (png or jpg beside the auth files): a picture for MiniPdf, or null (the space stays empty). Never part of the repository. */
export function loadLogo(dir) {
  for (const name of ['statement-logo.png', 'statement-logo.jpg', 'statement-logo.jpeg', 'logo.png', 'logo.jpg']) {
    try { const img = readImage(fs.readFileSync(path.join(dir, name))); if (img) return img; } catch (e) { /* not there: try the next */ }
  }
  return null;
}

/** Words of [text] on lines no wider than [max] points; one word wider than that is cut. */
export function wrapText(text, size, max, bold = false) {
  const out = []; let cur = '';
  for (let w of String(text || '').split(/\s+/).filter(Boolean)) {
    while (textWidth(w, size, bold) > max && w.length > 1) {
      let k = w.length - 1;
      while (k > 1 && textWidth(w.slice(0, k), size, bold) > max) k -= 1;
      if (cur) { out.push(cur); cur = ''; }
      out.push(w.slice(0, k)); w = w.slice(k);
    }
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, size, bold) <= max) cur = next; else { if (cur) out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

const BLUE = [0.36, 0.62, 0.86]; const BAND = [0.86, 0.92, 0.98]; const BLUE_TEXT = [0.13, 0.38, 0.68];

/** The lines of the first page's top block, measured once so the drawing and the page count agree. */
function firstPageBlock(data) {
  const top = [];
  wrapText((data.company.name || '').toUpperCase(), 12, 270, true).slice(0, 3).forEach((t) => top.push({ t, size: 12, bold: true }));
  data.company.lines.slice(0, 4).forEach((l) => wrapText(l.toUpperCase(), 9, 270).slice(0, 2).forEach((t) => top.push({ t, size: 9, gray: 0.3 })));
  if (data.company.email) top.push({ t: data.company.email.toUpperCase().slice(0, 60), size: 9, gray: 0.3 });
  if (data.company.web) top.push({ t: String(data.company.web).replace(/^https?:\/\//i, '').toUpperCase().slice(0, 60), size: 9, gray: 0.3 });
  let y = 50;
  for (const r of top) y += r.size + 4;
  const titleY = Math.max(y + 30, 150);
  const left = [{ t: 'TO', size: 8, bold: true, blue: true }];
  wrapText(data.customer.name || '-', 11, 280, true).slice(0, 4).forEach((t) => left.push({ t, size: 11, bold: true }));
  if (data.customer.phone) left.push({ t: data.customer.phone, size: 10 });
  data.customer.lines.slice(0, 3).forEach((l) => wrapText(l, 10, 280).slice(0, 2).forEach((t) => left.push({ t, size: 10 })));
  let ly = titleY + 34;
  for (const r of left) ly += r.size + 5;
  return { top, left, titleY, bandY: Math.max(ly, titleY + 70) + 14 };
}

/** What each layout puts in the table and under it; the header and the styling are the same code for both (drawStatement). */
function layoutSpec(data, style) {
  const currency = data.currency || '';
  const cur = currency ? `${currency} ` : ''; // an unknown currency prints no code at all
  if (style === 'balance') { // like the QuickBooks app's Balance Forward statement
    const rows = [{ date: dmy(data.start), desc: 'Balance forward', c3: '', c4: money(data.opening) }];
    for (const l of data.lines) {
      const ref = l.ref ? String(l.ref) : '';
      const desc = l.type === 'Invoice' ? 'Invoice No.' + ref : l.type === 'Payment' ? 'Payment' + (ref ? ' ' + ref : '') : 'Credit memo' + (ref ? ' No.' + ref : '');
      rows.push({ date: dmy(l.date), desc, c3: money(l.amount), c4: money(l.balance) });
    }
    return { heads: ['DATE', 'DESCRIPTION', 'AMOUNT', 'BALANCE'], rows, totals: [['BALANCE DUE', cur + money(data.closing)]], empty: '' };
  }
  const rows = data.txn.map((r) => ({ date: dmy(r.date), desc: 'Invoice No.' + r.ref, c3: money(r.amount), c4: money(r.received) }));
  const amount = data.txn.reduce((n, r) => n + r.amount, 0); const received = data.txn.reduce((n, r) => n + r.received, 0);
  return { heads: ['DATE', 'DESCRIPTION', 'AMOUNT', 'RECEIVED'], rows, totals: [['TOTAL AMOUNT', cur + money(amount)], ['TOTAL RECEIVED', cur + money(received)]], empty: 'No invoice dated in this period.' };
}

/**
 * The statement in the QuickBooks app's look, for BOTH layouts: company block and logo, the big title, TO, DATE and PERIOD, the table with its light-blue band
 * (repeated on every page), the dotted line and the totals. [style]: 'transaction' (the app's Transaction statement, the default) or 'balance' (its Balance Forward).
 * Only the table's columns and the totals differ; the header is one function, so the two cannot drift apart. [logo]: a picture from loadLogo or null.
 * The app's statement number is not printed: QuickBooks numbers its own and the API cannot make one.
 */
export function drawStatement(data, { sandbox = false, logo = null, style = 'transaction' } = {}) {
  const pdf = new MiniPdf();
  const L = 40; const R = 555; const W = pdf.width;
  const spec = layoutSpec(data, style);
  const cx = { date: L + 6, desc: L + 100, c3: R - 120, c4: R - 6 };
  const blk = firstPageBlock(data);
  const band = (y) => {
    pdf.box(L, y - 12, R - L, 20, 0, BAND);
    pdf.text(cx.date, y + 2, spec.heads[0], { size: 9, bold: true, rgb: BLUE_TEXT });
    pdf.text(cx.desc, y + 2, spec.heads[1], { size: 9, bold: true, rgb: BLUE_TEXT });
    pdf.text(cx.c3, y + 2, spec.heads[2], { size: 9, bold: true, rgb: BLUE_TEXT, align: 'right' });
    pdf.text(cx.c4, y + 2, spec.heads[3], { size: 9, bold: true, rgb: BLUE_TEXT, align: 'right' });
    return y + 24;
  };
  const head = () => {
    let y = 50;
    for (const r of blk.top) { pdf.text(L, y, r.t, { size: r.size, bold: r.bold, gray: r.gray || 0 }); y += r.size + 4; }
    if (logo) pdf.image(logo, R - 150, 30, 150, 70);
    pdf.text(L, blk.titleY, 'Statement', { size: 28, rgb: BLUE });
    let ly = blk.titleY + 34;
    for (const r of blk.left) { pdf.text(L, ly, r.t, { size: r.size, bold: r.bold, rgb: r.blue ? BLUE_TEXT : null }); ly += r.size + 5; }
    pdf.text(R - 150, blk.titleY + 34, 'DATE', { size: 8, bold: true, rgb: BLUE_TEXT });
    pdf.text(R, blk.titleY + 34, dmy(data.today), { size: 10, align: 'right' });
    pdf.text(R - 150, blk.titleY + 52, 'PERIOD', { size: 8, bold: true, rgb: BLUE_TEXT });
    pdf.text(R, blk.titleY + 52, `${dmy(data.start)} - ${dmy(data.periodEnd || data.today)}`, { size: 10, align: 'right' });
  };
  // pages: how many rows fit (the first page starts lower); the totals need room too, else they go on a page of their own
  const rowH = 17; const bottom = 780; const totalsH = 24 + 18 * spec.totals.length;
  const rows = spec.rows;
  const pageRows = [];
  let y = blk.bandY + 24; let i = 0;
  do {
    const cap = Math.max(1, Math.floor((bottom - y) / rowH));
    pageRows.push(rows.slice(i, i + cap)); i += cap; y = 60 + 24;
  } while (i < rows.length);
  const lastStart = pageRows.length === 1 ? blk.bandY + 24 : 84;
  if (lastStart + pageRows[pageRows.length - 1].length * rowH + totalsH > bottom + 10) pageRows.push([]);
  const total = pageRows.length;
  pageRows.forEach((chunk, idx) => {
    pdf.addPage();
    let yy;
    if (idx === 0) { head(); yy = band(blk.bandY); } else yy = band(60);
    for (const r of chunk) {
      pdf.text(cx.date, yy, r.date, { size: 9 });
      pdf.text(cx.desc, yy, r.desc.slice(0, 40), { size: 9 });
      if (r.c3) pdf.text(cx.c3, yy, r.c3, { size: 9, align: 'right' });
      pdf.text(cx.c4, yy, r.c4, { size: 9, align: 'right' });
      yy += rowH;
    }
    if (idx === total - 1) {
      pdf.line(L, yy - 6, R, yy - 6, 0.8, 0.4, [1, 3]);
      spec.totals.forEach(([label, value], k) => {
        pdf.text(R - 150, yy + 12 + 18 * k, label, { size: 9, bold: true, rgb: BLUE_TEXT, align: 'right' });
        pdf.text(R, yy + 12 + 18 * k, value, { size: 10, bold: true, align: 'right' });
      });
      if (!rows.length && spec.empty) pdf.text(L + 6, yy + 12, spec.empty, { size: 9, gray: 0.4 });
    }
    pdf.text(W / 2, 826, `Page ${idx + 1} of ${total}`, { size: 8, align: 'center', gray: 0.5 });
    if (sandbox) pdf.text(W / 2, 812, 'test, built by Atossa', { size: 10, bold: true, align: 'center', gray: 0.3 });
  });
  return pdf.build();
}

/** The statement as a PDF (bytes): the app's transaction statement by default, or with { style: 'balance' } its balance-forward statement, in the same look. */
export function statementPdf(data, { sandbox = false, style = 'transaction', logo = null } = {}) {
  return drawStatement(data, { sandbox, logo, style: style === 'balance' ? 'balance' : 'transaction' });
}
export const transactionPdf = (data, opts = {}) => drawStatement(data, { ...opts, style: 'transaction' });

/** All the rows QuickBooks holds for one customer, as read-only queries. */
export async function loadCustomerData(qbo, customerId) {
  const id = qboEscape(customerId);
  const [customers, invoices, payments, credits, company, preferences] = await Promise.all([
    qbo.query(`select * from Customer where Id = '${id}'`),
    qbo.query(`select * from Invoice where CustomerRef = '${id}'`),
    qbo.query(`select * from Payment where CustomerRef = '${id}'`),
    qbo.query(`select * from CreditMemo where CustomerRef = '${id}'`),
    qbo.companyInfo(),
    qbo.get('preferences').then((j) => j?.Preferences || null).catch(() => null), // the company's home currency; the country is the fallback
  ]);
  return { company, customer: customers[0] || null, preferences, invoices, payments, credits };
}

export { textWidth };

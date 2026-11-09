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

/**
 * The statement like the QuickBooks app's transaction statement (the default): company and logo, the big title, the customer and the date, then
 * DATE | DESCRIPTION | AMOUNT | RECEIVED, one row per invoice of the period, and the two totals. The table header band repeats on every page.
 * [logo]: a picture from loadLogo or null. The app's statement number is not printed: QuickBooks numbers its own and the API cannot make one.
 */
export function transactionPdf(data, { sandbox = false, logo = null } = {}) {
  const pdf = new MiniPdf();
  const L = 40; const R = 555; const W = pdf.width;
  const currency = data.currency || 'AED';
  const cx = { date: L + 6, desc: L + 100, amount: R - 120, received: R - 6 };
  const blk = firstPageBlock(data);
  const band = (y) => {
    pdf.box(L, y - 12, R - L, 20, 0, BAND);
    pdf.text(cx.date, y + 2, 'DATE', { size: 9, bold: true, rgb: BLUE_TEXT });
    pdf.text(cx.desc, y + 2, 'DESCRIPTION', { size: 9, bold: true, rgb: BLUE_TEXT });
    pdf.text(cx.amount, y + 2, 'AMOUNT', { size: 9, bold: true, rgb: BLUE_TEXT, align: 'right' });
    pdf.text(cx.received, y + 2, 'RECEIVED', { size: 9, bold: true, rgb: BLUE_TEXT, align: 'right' });
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
  const rowH = 17; const bottom = 780; const totalsH = 62;
  const rows = data.txn;
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
      pdf.text(cx.date, yy, dmy(r.date), { size: 9 });
      pdf.text(cx.desc, yy, `Invoice No.${r.ref}`.slice(0, 40), { size: 9 });
      pdf.text(cx.amount, yy, money(r.amount), { size: 9, align: 'right' });
      pdf.text(cx.received, yy, money(r.received), { size: 9, align: 'right' });
      yy += rowH;
    }
    if (idx === total - 1) {
      pdf.line(L, yy - 6, R, yy - 6, 0.8, 0.4, [1, 3]);
      const amount = rows.reduce((n, r) => n + r.amount, 0); const received = rows.reduce((n, r) => n + r.received, 0);
      pdf.text(R - 150, yy + 12, 'TOTAL AMOUNT', { size: 9, bold: true, rgb: BLUE_TEXT, align: 'right' });
      pdf.text(R, yy + 12, `${currency} ${money(amount)}`, { size: 10, bold: true, align: 'right' });
      pdf.text(R - 150, yy + 30, 'TOTAL RECEIVED', { size: 9, bold: true, rgb: BLUE_TEXT, align: 'right' });
      pdf.text(R, yy + 30, `${currency} ${money(received)}`, { size: 10, bold: true, align: 'right' });
      if (!rows.length) pdf.text(L + 6, yy + 12, 'No invoice dated in this period.', { size: 9, gray: 0.4 });
    }
    pdf.text(W / 2, 826, `Page ${idx + 1} of ${total}`, { size: 8, align: 'center', gray: 0.5 });
    if (sandbox) pdf.text(W / 2, 812, 'test, built by Atossa', { size: 10, bold: true, align: 'center', gray: 0.3 });
  });
  return pdf.build();
}

/** The statement as a PDF (bytes): the QuickBooks app's transaction statement, or with { style: 'balance' } the older layout with a running balance. [sandbox]: the test footer is printed. */
export function statementPdf(data, { sandbox = false, style = 'transaction', logo = null } = {}) {
  return style === 'balance' ? balancePdf(data, { sandbox, logo }) : transactionPdf(data, { sandbox, logo });
}

/** The balance-forward layout: opening balance, every invoice, payment and credit memo with a running balance, ageing. */
function balancePdf(data, { sandbox = false, logo = null } = {}) {
  const currency = data.currency || '';
  const cur = currency ? ` (${currency})` : '';
  const pdf = new MiniPdf();
  const L = 40; const R = 555;
  // the company name is wrapped to the room left of the title (never over it); every block below starts under the one above
  const nameLines = wrapText(data.company.name || 'Company', 16, 360, true).slice(0, 3);
  const headLines = [...nameLines.map((t) => ({ t, size: 16, bold: true, step: 19 })), ...data.company.lines.slice(0, 4).flatMap((l) => wrapText(l, 9, 360).slice(0, 2).map((t) => ({ t, size: 9, gray: 0.3, step: 12 }))), ...(data.company.email ? [{ t: data.company.email, size: 9, gray: 0.3, step: 12 }] : [])];
  const headBottom = Math.max(logo ? 140 : 125, 50 + headLines.reduce((n, r) => n + r.step, 0) + 4);
  const extra = headBottom - 125; // how much lower than the old fixed layout everything starts
  const page = (n, total) => {
    pdf.addPage();
    let hy = 50;
    for (const r of headLines) { pdf.text(L, hy, r.t, { size: r.size, bold: r.bold, gray: r.gray || 0 }); hy += r.step; }
    const ty = logo ? 100 : 50; // with a logo the title block moves under it (top right), never over it
    if (logo) pdf.image(logo, R - 150, 24, 150, 54);
    pdf.text(R, ty, 'STATEMENT', { size: 18, bold: true, align: 'right' });
    pdf.text(R, ty + 18, `Date: ${dmy(data.today)}`, { size: 10, align: 'right' });
    pdf.text(R, ty + 32, `Page ${n} of ${total}`, { size: 9, align: 'right', gray: 0.4 });
    pdf.line(L, headBottom, R, headBottom, 1);
    if (sandbox) pdf.text(W / 2, 822, 'test, built by Atossa', { size: 10, bold: true, align: 'center', gray: 0.3 }); // every page of a sandbox statement
  };
  const W = pdf.width;
  const custLines = wrapText(data.customer.name || '-', 12, 270, true).slice(0, 3);
  const custExtra = (custLines.length - 1) * 14;
  const perFirst = Math.max(8, 28 - Math.ceil((extra + custExtra) / 14)); const perNext = 48;
  const chunks = [data.lines.slice(0, perFirst)];
  for (let i = perFirst; i < data.lines.length; i += perNext) chunks.push(data.lines.slice(i, i + perNext));
  const total = chunks.length;
  chunks.forEach((chunk, idx) => {
    page(idx + 1, total);
    let y = headBottom + 20;
    if (idx === 0) {
      pdf.text(L, y, 'To', { size: 9, gray: 0.4 });
      custLines.forEach((t, i) => pdf.text(L, y + 14 + i * 14, t, { size: 12, bold: true }));
      data.customer.lines.slice(0, 4).forEach((l, i) => pdf.text(L, y + 28 + custExtra + i * 12, l.slice(0, 60), { size: 9, gray: 0.3 }));
      pdf.text(R, y, 'Statement period', { size: 9, gray: 0.4, align: 'right' });
      pdf.text(R, y + 14, `${dmy(data.start)} to ${dmy(data.periodEnd || data.today)}`, { size: 10, align: 'right' });
      pdf.box(330, y + 28, R - 330, 44, 0.94);
      pdf.text(340, y + 44, `Balance due${cur}`, { size: 9, gray: 0.35 });
      pdf.text(R - 10, y + 64, money(data.closing), { size: 15, bold: true, align: 'right' });
      y += 100 + custExtra;
    }
    // table header
    const cols = { date: L + 4, type: L + 70, ref: L + 140, due: L + 235, amount: R - 95, balance: R - 4 };
    pdf.box(L, y - 11, R - L, 16, 0.9);
    pdf.text(cols.date, y, 'Date', { size: 9, bold: true });
    pdf.text(cols.type, y, 'Type', { size: 9, bold: true });
    pdf.text(cols.ref, y, 'No.', { size: 9, bold: true });
    pdf.text(cols.due, y, 'Due', { size: 9, bold: true });
    pdf.text(cols.amount, y, 'Amount', { size: 9, bold: true, align: 'right' });
    pdf.text(cols.balance, y, 'Balance', { size: 9, bold: true, align: 'right' });
    y += 16;
    if (idx === 0) {
      pdf.text(cols.type, y, 'Balance brought forward', { size: 9 });
      pdf.text(cols.balance, y, money(data.opening), { size: 9, align: 'right' });
      y += 14;
    }
    for (const l of chunk) {
      pdf.text(cols.date, y, dmy(l.date), { size: 9 });
      pdf.text(cols.type, y, l.type, { size: 9 });
      pdf.text(cols.ref, y, String(l.ref).slice(0, 18), { size: 9 });
      pdf.text(cols.due, y, l.due ? dmy(l.due) : '', { size: 9 });
      pdf.text(cols.amount, y, money(l.amount), { size: 9, align: 'right' });
      pdf.text(cols.balance, y, money(l.balance), { size: 9, align: 'right' });
      y += 14;
    }
    if (idx === total - 1) {
      pdf.line(L, y - 6, R, y - 6, 0.6);
      pdf.text(cols.type, y + 6, data.historical ? 'Balance at end of period' : 'Balance due', { size: 10, bold: true });
      pdf.text(cols.balance, y + 6, `${currency ? `${currency} ` : ''}${money(data.closing)}`, { size: 10, bold: true, align: 'right' });
      y += 36;
      if (data.historical) { for (const [i, w] of data.warnings.entries()) pdf.text(L, y + i * 11, w, { size: 8, gray: 0.4 }); return; } // no ageing for a past period
      const a = data.ageing;
      const heads = ['Current', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days', 'Total'];
      const vals = [a.current, a.d1_30, a.d31_60, a.d61_90, a.d91, data.ageingTotal];
      const cw = (R - L) / 6;
      pdf.box(L, y - 11, R - L, 16, 0.9);
      heads.forEach((h, i) => pdf.text(L + cw * (i + 1) - 6, y, h, { size: 9, bold: true, align: 'right' }));
      vals.forEach((v, i) => pdf.text(L + cw * (i + 1) - 6, y + 16, money(v), { size: 9, align: 'right', bold: i === 5 }));
      y += 34;
      if (data.credit) pdf.text(L, y, `Ageing includes unapplied payments and credit memos: ${money(data.credit)}`, { size: 8, gray: 0.4 });
      if (data.balanceCheck.matches === false) pdf.text(L, y + 12, `QuickBooks shows a customer balance of ${money(data.balanceCheck.qbo)}; this statement differs.`, { size: 8, bold: true });
      for (const [i, w] of data.warnings.entries()) pdf.text(L, y + 24 + i * 11, w, { size: 8, gray: 0.4 });
      // the open invoices with their days overdue (zero or less = not yet due), when there is room on the page
      const items = data.openItems.slice(0, 10);
      const top = y + 40 + data.warnings.length * 11;
      if (items.length && top + 12 + items.length * 12 < 805) {
        pdf.text(L, top, 'Open invoices', { size: 9, bold: true });
        pdf.text(L + 150, top, 'Due', { size: 8, gray: 0.4 });
        pdf.text(L + 230, top, 'Days overdue', { size: 8, gray: 0.4 });
        pdf.text(R - 4, top, 'Balance', { size: 8, gray: 0.4, align: 'right' });
        items.forEach((it, k) => {
          const yy = top + 12 * (k + 1);
          pdf.text(L, yy, String(it.ref).slice(0, 18), { size: 8 });
          pdf.text(L + 150, yy, dmy(it.due), { size: 8 });
          pdf.text(L + 230, yy, it.past > 0 ? String(it.past) : 'not yet due', { size: 8 });
          pdf.text(R - 4, yy, money(it.balance), { size: 8, align: 'right' });
        });
      }
    }
  });
  return pdf.build();
}

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

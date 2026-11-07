// A CUSTOMER STATEMENT built from QuickBooks data (the API has no statement entity and no send-statement action). Open invoices, payments, credit
// memos and the customer's balance come from the API; every amount is kept in fils (whole numbers), so the totals equal QuickBooks to the fil. The
// closing balance is the sum of the open invoices less unapplied payments and credit memo balances, and it is checked against QuickBooks' own balance
// of the customer. The opening balance is closing minus the activity of the period, so nothing outside the listed lines can break the arithmetic.
// One A4 page (more pages when the lines need them): company header, customer, period, opening balance, lines, closing balance, ageing buckets.

import { MiniPdf, textWidth } from './minipdf.js';
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
export function buildStatementData({ company, customer, invoices = [], payments = [], credits = [], today, days = 90 }) {
  const end = dayNum(today);
  const start = end - days;
  const startIso = new Date(start * DAY).toISOString().slice(0, 10);
  const open = invoices.filter((i) => fils(i.Balance) !== 0);
  const unappliedPayments = payments.reduce((s, p) => s + fils(p.UnappliedAmt), 0);
  const creditBalance = credits.reduce((s, c) => s + fils(c.Balance), 0);
  const closing = open.reduce((s, i) => s + fils(i.Balance), 0) - unappliedPayments - creditBalance;
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
  const credit = -(unappliedPayments + creditBalance);
  const home = company?.Country === 'AE' ? 'AED' : '';
  const foreign = [...invoices, ...payments, ...credits].some((t) => t.CurrencyRef?.value && home && t.CurrencyRef.value !== home);
  const qbBalance = customer?.Balance === undefined ? null : fils(customer.Balance);
  return {
    company: { name: company?.CompanyName || company?.LegalName || '', lines: addr(company?.CompanyAddr), email: company?.Email?.Address || '' },
    customer: { name: customer?.DisplayName || customer?.CompanyName || '', lines: addr(customer?.BillAddr) },
    today, start: startIso, opening, lines, closing, ageing, credit,
    ageingTotal: Object.values(ageing).reduce((s, v) => s + v, 0) + credit,
    balanceCheck: { qbo: qbBalance, matches: qbBalance === null ? null : qbBalance === closing },
    warnings: foreign ? ['Some transactions are in another currency; the amounts are in the transaction currency.'] : [],
  };
}

const dmy = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

/** The statement as a PDF (bytes). [sandbox]: the test footer is printed. */
export function statementPdf(data, { sandbox = false, currency = 'AED' } = {}) {
  const pdf = new MiniPdf();
  const L = 40; const R = 555;
  const page = (n, total) => {
    pdf.addPage();
    pdf.text(L, 50, data.company.name || 'Company', { size: 16, bold: true });
    data.company.lines.slice(0, 4).forEach((l, i) => pdf.text(L, 66 + i * 12, l, { size: 9, gray: 0.3 }));
    if (data.company.email) pdf.text(L, 66 + Math.min(4, data.company.lines.length) * 12, data.company.email, { size: 9, gray: 0.3 });
    pdf.text(R, 50, 'STATEMENT', { size: 18, bold: true, align: 'right' });
    pdf.text(R, 68, `Date: ${dmy(data.today)}`, { size: 10, align: 'right' });
    pdf.text(R, 82, `Page ${n} of ${total}`, { size: 9, align: 'right', gray: 0.4 });
    pdf.line(L, 125, R, 125, 1);
    if (sandbox) pdf.text(W / 2, 826, 'test, built by Atossa', { size: 9, align: 'center', gray: 0.45 });
  };
  const W = pdf.width;
  const perFirst = 28; const perNext = 48;
  const chunks = [data.lines.slice(0, perFirst)];
  for (let i = perFirst; i < data.lines.length; i += perNext) chunks.push(data.lines.slice(i, i + perNext));
  const total = chunks.length;
  chunks.forEach((chunk, idx) => {
    page(idx + 1, total);
    let y = 145;
    if (idx === 0) {
      pdf.text(L, y, 'To', { size: 9, gray: 0.4 });
      pdf.text(L, y + 14, data.customer.name || '-', { size: 12, bold: true });
      data.customer.lines.slice(0, 4).forEach((l, i) => pdf.text(L, y + 28 + i * 12, l, { size: 9, gray: 0.3 }));
      pdf.text(R, y, 'Statement period', { size: 9, gray: 0.4, align: 'right' });
      pdf.text(R, y + 14, `${dmy(data.start)} to ${dmy(data.today)}`, { size: 10, align: 'right' });
      pdf.box(330, y + 28, R - 330, 44, 0.94);
      pdf.text(340, y + 44, `Balance due (${currency})`, { size: 9, gray: 0.35 });
      pdf.text(R - 10, y + 64, money(data.closing), { size: 15, bold: true, align: 'right' });
      y += 100;
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
      pdf.text(cols.type, y + 6, 'Balance due', { size: 10, bold: true });
      pdf.text(cols.balance, y + 6, `${currency} ${money(data.closing)}`, { size: 10, bold: true, align: 'right' });
      y += 36;
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
    }
  });
  return pdf.build();
}

/** All the rows QuickBooks holds for one customer, as read-only queries. */
export async function loadCustomerData(qbo, customerId) {
  const id = qboEscape(customerId);
  const [customers, invoices, payments, credits, company] = await Promise.all([
    qbo.query(`select * from Customer where Id = '${id}'`),
    qbo.query(`select * from Invoice where CustomerRef = '${id}'`),
    qbo.query(`select * from Payment where CustomerRef = '${id}'`),
    qbo.query(`select * from CreditMemo where CustomerRef = '${id}'`),
    qbo.companyInfo(),
  ]);
  return { company, customer: customers[0] || null, invoices, payments, credits };
}

export { textWidth };

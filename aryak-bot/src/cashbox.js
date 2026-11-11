// The company CASH BOX. Cash leaves it in three ways: the cash expenses of the expenses group, cash handed to the boss, and salary advances. The last two are posted in the Confirmation group
// («18000 deposit to boss», «advance 500 RAJU»); they are recorded silently as their own kinds (never a customer payment) and are recorded in QuickBooks as a Transfer, which this module only
// COMPARES with (read only). The month report: cash in (customers' CASH receipts only), cash out, what remains; the opening balance is asked once, then the month-end balance carries on.
import fs from 'node:fs';
import path from 'node:path';
import { SEP } from './separator.js';
import { normalizeDigits } from './text.js';

export const CASH_OUT_KINDS = ['cash_to_boss', 'salary_advance', 'cash_unclear'];
const AMOUNT = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/;
const BOSS = /(?:^|[^a-z])boss(?![a-z])|رئیس|رییس|مدیرعامل|آقای\s*مدیر/i;
const ADVANCE = /(?:^|[^a-z])(?:advance|salary)(?![a-z])|سلف|مساعده/i;
const UNCLEAR = /(?:^|[^a-z])(?:handed|gave|given|withdraw|withdrawal|loan)(?![a-z])/i;
const NOISE = new Set(['advance', 'salary', 'to', 'for', 'cash', 'deposit', 'aed', 'dhs', 'dh', 'the', 'of', 'and', 'paid', 'pay', 'given', 'gave', 'handed', 'boss', 'سلف', 'مساعده', 'درهم']);

/** A caption of cash leaving the cash box: { kind: 'cash_to_boss' | 'salary_advance' | 'cash_unclear', amount, employee } or null. */
export function cashOutKind(text) {
  const t = normalizeDigits(String(text || '')).replace(/٫/g, '.').replace(/٬/g, ',');
  const m = AMOUNT.exec(t);
  const amount = m ? Math.round(Number(m[1].replace(/,/g, '')) * 100) / 100 : 0;
  if (!(amount > 0)) return null;
  const rest = t.replace(AMOUNT, ' ').split(/[^\p{L}\p{N}]+/u).filter((w) => w && !NOISE.has(w.toLowerCase()));
  if (BOSS.test(t)) return { kind: 'cash_to_boss', amount, employee: '' };
  if (ADVANCE.test(t)) return { kind: 'salary_advance', amount, employee: rest.join(' ').toUpperCase().slice(0, 40) };
  if (UNCLEAR.test(t)) return { kind: 'cash_unclear', amount, employee: rest.join(' ').toUpperCase().slice(0, 40) };
  return null;
}

/** The opening balances (a file on the server): { 'yyyy-mm': amount }. Asked once, then the month-end balance carries on; the owner can override. */
export class CashBoxStore {
  constructor(dir = '') {
    this.file = dir ? path.join(dir, 'cashbox.json') : '';
    this.d = { opening: {}, asked: {}, sent: {} };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first start */ }
  }

  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  setOpening(month, amount) { this.d.opening[month] = Math.round(Number(amount) * 100) / 100; this.save(); }
}

/** «cash box» / «صندوق» (month to date) and «cash box opening 01/11 2000» -> { op: 'report' } | { op: 'opening', month, amount } | null. */
export function parseCashBoxCommand(text, today = new Date()) {
  const t = normalizeDigits(String(text || '')).replace(/\s+/g, ' ').trim().replace(/^(?:atossa|atosa|آتوسا)[ ,:]+/i, '').replace(/[.!؟?]+$/, '');
  if (/^(?:cash ?box|صندوق)$/i.test(t)) return { op: 'report' };
  const m = /^cash ?box opening (\d{1,2})\/(\d{1,2}) (\d[\d,]*(?:\.\d+)?)$/i.exec(t);
  if (m) {
    const month = Number(m[2]); const year = today.getUTCFullYear() - (month > today.getUTCMonth() + 1 ? 1 : 0);
    return { op: 'opening', month: year + '-' + String(month).padStart(2, '0'), amount: Number(m[3].replace(/,/g, '')) };
  }
  return null;
}

const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dm = (ms, tz) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-'); return p[2] + '/' + p[1]; };
const dayNum = (ms, tz) => Math.floor(Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)) + 'T00:00:00Z') / 86400000);
const cell = (label, amount) => label.padEnd(30) + money(amount).padStart(9);
const row = (ms, amount, tz, tail) => dm(ms, tz) + money(amount).padStart(12) + tail;

/**
 * The cash box report of one month.
 * [monthStart] 'yyyy-mm-01'; [opening] the opening balance (null = not known: asked once); [cashIn] the customers' cash receipts of the month [{ amount }];
 * [expenses] the cash-box expenses of the month [{ amount, type }]; [outs] the boss / advance events [{ kind, amount, at, employee }]; [transfers] the QuickBooks Transfer rows [{ TxnDate, Amount }].
 * Returns { text, remaining } (remaining = opening + in - out).
 */
export function cashBoxReport({ month, opening, cashIn, expenses, outs, transfers = [], timeZone = 'Asia/Dubai', typeLabel = (t) => t }) {
  const label = month.slice(5, 7) + '/' + month.slice(0, 4);
  const first = '01/' + month.slice(5, 7);
  const inFrom = cashIn.reduce((n, x) => n + Number(x.amount), 0);
  const expTotal = expenses.reduce((n, x) => n + Number(x.amount), 0);
  const byType = {};
  for (const e of expenses) byType[e.type] = (byType[e.type] || 0) + Number(e.amount);
  const used = new Set();
  const matched = (o) => { // a QuickBooks Transfer of the same amount (±1 AED) within ±3 days
    const at = transfers.findIndex((t, i) => !used.has(i) && Math.abs(Number(t.Amount) - Number(o.amount)) <= 1 && Math.abs(Math.floor(Date.parse(t.TxnDate + 'T00:00:00Z') / 86400000) - dayNum(o.at, timeZone)) <= 3);
    if (at >= 0) { used.add(at); return true; }
    return false;
  };
  const section = (head, list, who) => {
    const total = list.reduce((n, o) => n + Number(o.amount), 0);
    return [cell(head, total), ...list.map((o) => {
      const ok = matched(o);
      return (ok ? '🟢 ' : '🔴 ') + row(o.at, o.amount, timeZone, (who && o.employee ? '   ' + o.employee : '') + (ok ? '' : '  (not in QuickBooks)'));
    })].join('\n');
  };
  const boss = outs.filter((o) => o.kind === 'cash_to_boss').sort((a, b) => a.at - b.at);
  const adv = outs.filter((o) => o.kind === 'salary_advance').sort((a, b) => a.at - b.at);
  const bossText = boss.length ? section('👔 *Cash to boss*', boss, false) : '';
  const advText = adv.length ? section('👷 *Salary advances*', adv, true) : '';
  const all = [...boss, ...adv];
  const matchedCount = used.size;
  const totalOut = expTotal + all.reduce((n, o) => n + Number(o.amount), 0);
  const totalIn = (opening || 0) + inFrom;
  const remaining = Math.round((totalIn - totalOut) * 100) / 100;
  const expLines = expenses.length ? [cell('🧾 *Company expenses (cash)*', expTotal), '     ↳ ' + Object.keys(byType).map((k) => typeLabel(k) + ' ' + money(byType[k])).join(' | ')].join('\n') : '';
  const outBlocks = [expLines, bossText, advText].filter(Boolean);
  const text = [
    '📦 *Cash box — ' + label + '*', SEP, SEP,
    '💵 *Cash in*', cell('Opening balance (' + first + ')', opening || 0), cell('Cash from customers', inFrom), SEP, SEP,
    '💸 *Cash out*', '', outBlocks.length ? outBlocks.join('\n' + SEP + '\n') : 'Nothing left the cash box.', SEP, SEP,
    '*Total in:  ' + money(totalIn) + ' AED*', '*Total out: ' + money(totalOut) + ' AED*', '*Remaining in cash box: ' + money(remaining) + ' AED*',
    '🟢 In QuickBooks: ' + matchedCount + '    🔴 Not yet: ' + (all.length - matchedCount),
    ...(opening === null ? ['', 'The opening balance is not known yet. Write: cash box opening ' + first + ' <amount>'] : []),
  ].join('\n');
  return { text, remaining };
}

// The company CASH BOX. Cash leaves it in three ways: the cash expenses of the expenses group, cash handed to the boss, and salary advances. The last two are posted in the Confirmation group
// («18000 deposit to boss», «advance 500 RAJU»); they are recorded silently as their own kinds (never a customer payment) and are recorded in QuickBooks as a Transfer, which this module only
// COMPARES with (read only). The month report: cash in (customers' CASH receipts only), cash out, what remains; the opening balance is asked once, then the month-end balance carries on.
import fs from 'node:fs';
import path from 'node:path';
import { SEP } from './separator.js';
import { normalizeDigits } from './text.js';
import { sameCutCustomer } from './cuts.js';
import { typedFitsName } from './qboname.js';

export const CASH_OUT_KINDS = ['cash_to_boss', 'salary_advance', 'cash_unclear', 'cash_expense'];
const AMOUNT = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/;
const BOSS = /(?:^|[^a-z])boss(?![a-z])|رئیس|رییس|مدیرعامل|آقای\s*مدیر/i;
const ADVANCE = /(?:^|[^a-z])(?:advance|salary)(?![a-z])|سلف|مساعده/i;
// «Pay by cash 157 aed for garbage box»: a cash EXPENSE of the company (never customer cash). An invoice, «from …» or «received» makes it a customer's payment instead.
const PAYFOR = /(?:^|[^a-z])(?:pay|pays|paid|payment)(?![a-z])[\s\S]*?(?:^|[^a-z])for(?![a-z])\s+(.+)$/i;
const NOT_EXPENSE = /invoice|(?:^|[^a-z])inv[-\s#]?\d|(?:^|[^a-z])(?:from|received|receipt|customer|cheque|check)(?![a-z])/i;
const VERB_ONLY = /^(?:pay|pays|paid|paying|payment|for|by)$/i;
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
  { const pf = PAYFOR.exec(t); if (pf && !NOT_EXPENSE.test(t) && !BOSS.test(t) && !ADVANCE.test(t)) return { kind: 'cash_expense', amount, employee: pf[1].replace(AMOUNT, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 40) }; } // the description after «for»
  if (UNCLEAR.test(t)) return { kind: 'cash_unclear', amount, employee: rest.join(' ').toUpperCase().slice(0, 40) };
  return null;
}

/**
 * An OLD stored payment row (made before the cash-out kinds existed) re-read: «18000 deposit to boss», «to boss», «advance 500 RAJU», «سلف …» in its text or its name make it cash to the boss / a salary
 * advance. Stricter than a new caption: only «to boss» (a customer named BOSS is not the boss). Returns the row itself when nothing changes, else a changed copy.
 */
export function rederiveCashOut(e) {
  if (!e || e.type !== 'payment' || CASH_OUT_KINDS.includes(e.kind) || e.kind === 'cheque' || e.kind === 'transfer') return e;
  const words = [e.text, e.customerTyped, e.customer].filter(Boolean).join(' ');
  // An old row that kept only the first word of «Pay by cash 157 aed for garbage box» («Pay»): a verb is no customer, so it is a cash expense of the company.
  if (e.kind === 'cash' && !e.text && VERB_ONLY.test(String(e.customerTyped || e.customer || '').trim())) return { ...e, kind: 'cash_expense', employee: '', customer: '', customerTyped: '', pendingName: false, reclassified: true };
  if (!/(?:^|[^a-z])to\s+boss(?![a-z])|^\s*boss(?![a-z])/i.test(words) && !ADVANCE.test(words) && !(PAYFOR.test(words) && !NOT_EXPENSE.test(words))) return e;
  const amount = Number(e.amount) > 0 ? Number(e.amount) : null;
  const out = cashOutKind(e.text ? e.text : words + ' ' + (amount || '')); // the posted words as they are; with none, the name and the amount
  if (!out || out.kind === 'cash_unclear') return e;
  if (out.kind === 'cash_expense') return { ...e, kind: out.kind, employee: out.employee, customer: '', customerTyped: '', pendingName: false, reclassified: true };
  return { ...e, kind: out.kind, ...(out.employee ? { employee: out.employee } : {}), customer: '', customerTyped: '', pendingName: false, reclassified: true };
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
  const totalIn = inFrom; // the month's own movements only: no opening balance
  const remaining = Math.round((totalIn - totalOut) * 100) / 100; // the net of the month
  const expLines = expenses.length ? [cell('🧾 *Company expenses (cash)*', expTotal), '     ↳ ' + Object.keys(byType).map((k) => typeLabel(k) + ' ' + money(byType[k])).join(' | ')].join('\n') : '';
  const outBlocks = [expLines, bossText, advText].filter(Boolean);
  const text = [
    '📦 *Cash box — ' + label + '*', SEP, SEP,
    '💵 *Cash in*', cell('Cash from customers', inFrom), SEP, SEP,
    '💸 *Cash out*', '', outBlocks.length ? outBlocks.join('\n' + SEP + '\n') : 'Nothing left the cash box.', SEP, SEP,
    '*Total in (month): ' + money(totalIn) + ' AED*', '*Total out (month): ' + money(totalOut) + ' AED*', '*Net for the month: ' + money(remaining) + ' AED*',
    '🟢 In QuickBooks: ' + matchedCount + '    🔴 Not yet: ' + (all.length - matchedCount),
  ].join('\n');
  return { text, remaining };
}

// ---- QuickBooks as the source (owner decision): the Petty Cash account, cash payments only, read only ----------------------------------------------------------------------------------------

const walkRows = (rows, fn) => { for (const r of rows || []) { fn(r); if (r.Rows?.Row) walkRows(r.Rows.Row, fn); } };
/** The balance of an account in a QuickBooks BalanceSheet report ("Petty Cash" -> 116742.13), or null when the report has no such line. */
export function balanceFromReport(report, accountName) {
  let found = null;
  const want = String(accountName).toLowerCase();
  walkRows(report?.Rows?.Row, (r) => {
    const cols = r.ColData || r.Summary?.ColData || r.Header?.ColData;
    if (found === null && cols && String(cols[0]?.value || '').toLowerCase() === want && cols[1]?.value !== undefined && cols[1].value !== '') found = Number(String(cols[1].value).replace(/,/g, ''));
  });
  return found;
}

/** What QuickBooks has for the cash box between two days: the Petty Cash opening and closing balance, the CASH payments deposited there, the transfers in and out, the purchases paid from it. */
export async function fetchCashBoxQbo(qbo, { from, to, accountName = 'Petty Cash' }) {
  const accounts = await qbo.query("select * from Account where Name = '" + String(accountName).replace(/'/g, '') + "'");
  const acc = accounts[0];
  if (!acc) return null;
  const id = String(acc.Id);
  const range = "TxnDate >= '" + from + "' and TxnDate <= '" + to + "'";
  const methods = new Map((await qbo.query('select * from PaymentMethod').catch(() => [])).map((m) => [String(m.Id), String(m.Name || '')]));
  const isCash = (r) => String(r.DepositToAccountRef?.value) === id && /cash/i.test(methods.get(String(r.PaymentMethodRef?.value)) || '');
  const every = [...await qbo.query('select * from Payment where ' + range), ...await qbo.query('select * from SalesReceipt where ' + range)];
  const received = every.filter(isCash).map((r) => ({ amount: Number(r.TotalAmt), date: r.TxnDate, name: r.CustomerRef?.name || '', lines: (r.Line || []).filter((l) => Number(l.Amount) > 0 && (l.LinkedTxn || []).length).map((l) => Number(l.Amount)) })); // the lines: what the payment paid on each invoice
  const accountNames = new Map((await qbo.query('select * from Account').catch(() => [])).map((a) => [String(a.Id), String(a.Name || '')]));
  const elsewhere = every.filter((r) => !isCash(r)).map((r) => ({ amount: Number(r.TotalAmt), date: r.TxnDate, name: r.CustomerRef?.name || '', account: accountNames.get(String(r.DepositToAccountRef?.value)) || 'another account' })); // recorded, but not in this account
  const transfers = (await qbo.query('select * from Transfer where ' + range)).filter((t) => String(t.FromAccountRef?.value) === id || String(t.ToAccountRef?.value) === id);
  const purchases = (await qbo.query('select * from Purchase where ' + range)).filter((p) => String(p.AccountRef?.value) === id)
    .map((p) => ({ amount: Number(p.TotalAmt), date: p.TxnDate, vendor: p.EntityRef?.name || '', category: p.Line?.find((l) => l.AccountBasedExpenseLineDetail)?.AccountBasedExpenseLineDetail?.AccountRef?.name || 'Other' }));
  const before = new Date(Date.parse(from + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const balance = async (day) => balanceFromReport(await qbo.get('reports/BalanceSheet', { start_date: day, end_date: day, accounting_method: 'Accrual' }), accountName);
  return {
    id, opening: null, closing: null, received, elsewhere, purchases, // the balances are not read any more: the report shows only the month's own movements
    transfersOut: transfers.filter((t) => String(t.FromAccountRef?.value) === id).map((t) => ({ amount: Number(t.Amount), date: t.TxnDate, to: t.ToAccountRef?.name || '', note: t.PrivateNote || '' })),
    transfersIn: transfers.filter((t) => String(t.ToAccountRef?.value) === id).map((t) => ({ amount: Number(t.Amount), date: t.TxnDate, from: t.FromAccountRef?.name || '' })),
  };
}

/**
 * The cash box report with QuickBooks as the source. Every QBO line is compared with the WhatsApp posts (amount +-1 AED, date +-3 days): 🟢 posted and in QuickBooks; ⚪ in QuickBooks with no post;
 * 🔴 posted and not in QuickBooks. [posts]: { cashIn: [{ amount, at }], outs: [{ kind, amount, at, employee }], expenses: [{ amount, at, vendor }] }.
 */
export function cashBoxReportQbo({ month, data, posts, openingOverride = null, checkedAt = '', timeZone = 'Asia/Dubai', swapCodeOf = () => '', accountName = 'Petty Cash', swapInfoOf = () => null, isCustomer = null }) {
  const label = month.slice(5, 7) + '/' + month.slice(0, 4); const first = '01/' + month.slice(5, 7);
  const dayOfIso = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);
  const isoOf = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const claim = (pool, amount, iso) => { // one post for one QuickBooks line
    const at = pool.findIndex((p) => !p.used && Math.abs(Number(p.amount) - Number(amount)) <= 1 && Math.abs(dayNum(p.at, timeZone) - dayOfIso(iso)) <= (p.days || 3));
    if (at < 0) return null;
    pool[at].used = true; return pool[at];
  };
  const bossPosts = posts.outs.filter((o) => o.kind === 'cash_to_boss').map((o) => ({ ...o }));
  const advPosts = posts.outs.filter((o) => o.kind === 'salary_advance').map((o) => ({ ...o }));
  const expPosts = posts.expenses.map((o) => ({ ...o }));
  const inPosts = posts.cashIn.map((o) => ({ ...o }));
  // An item the OWNER added absorbs a posted row of the same kind (amount +-1 AED, date +-7 days): they are the same thing, shown once as «(added by owner; also posted 05/11)», never as «not in QuickBooks».
  for (const pool of [bossPosts, advPosts, expPosts]) {
    for (const a of pool.filter((x) => x.added)) {
      const twin = pool.find((q) => !q.added && !q.used && Math.abs(Number(q.amount) - Number(a.amount)) <= 1 && Math.abs(dayNum(q.at, timeZone) - dayNum(a.at, timeZone)) <= 7);
      if (twin) { twin.used = true; a.also = isoOf(twin.at); }
    }
  }
  const addedTail = (p) => (p.added ? '  (added by owner' + (p.also ? '; also posted ' + p.also.slice(8, 10) + '/' + p.also.slice(5, 7) : '') + ')' : '');
  const lineDate = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  const dline = (icon, iso, amount, tail) => icon + ' ' + lineDate(iso) + money(amount).padStart(12) + (tail || '');
  let green = 0; let red = 0; let white = 0; let yellow = 0; let stars = 0; let starTotal = 0;
  const mark = (icon) => { if (icon === '🟢') green += 1; else if (icon === '🔴') red += 1; else white += 1; return icon; };
  const unmatchedLines = (pool, tailOf) => pool.filter((p) => !p.used).map((p) => dline(mark('🔴'), isoOf(p.at), p.amount, tailOf(p) + addedTail(p) + '  (posted, not in QuickBooks)'));
  // cash in
  const cashFromCustomers = data.received.reduce((n, r) => n + r.amount, 0);
  const transfersInTotal = data.transfersIn.reduce((n, r) => n + r.amount, 0);
  const noPost = [];
  const sameName0 = (a, b) => !a || !b || sameCutCustomer(a, b);
  const purchaseTaken = new Set();
  for (const r of data.received) {
    // one QuickBooks payment can stand for several posts: the post of the same amount; else posts of ONE customer within a day whose SUM is the payment; else the posts of its invoice lines (each line its own)
    if (claim(inPosts, r.amount, r.date)) { green += 1; continue; }
    const near = inPosts.filter((p) => !p.used && p.customer && Math.abs(dayNum(p.at, timeZone) - dayOfIso(r.date)) <= 1 && sameName0(r.name, p.customer));
    let group = null;
    for (let i = 0; i < near.length && !group; i++) for (let j = i + 1; j < near.length && !group; j++) {
      if (Math.abs(near[i].amount + near[j].amount - r.amount) <= 1) group = [near[i], near[j]];
      else for (let k = j + 1; k < near.length && !group; k++) if (Math.abs(near[i].amount + near[j].amount + near[k].amount - r.amount) <= 1) group = [near[i], near[j], near[k]];
    }
    if (group) { for (const p of group) p.used = true; green += group.length; continue; }
    let hit = 0;
    for (const a of r.lines || []) if (claim(inPosts, a, r.date)) hit += 1;
    if (hit) green += hit; else noPost.push(r);
  }
  // A post left over whose name is NOT a customer («garbage box») but that fits a Petty Cash purchase (+-1 AED, +-7 days) is a cash EXPENSE posted in the Confirmation group, whatever its stored kind:
  // it moves to the expense posts and is matched with that purchase there (also for an old row whose «pay … for …» words were not kept).
  if (isCustomer) {
    for (const p of inPosts.filter((x) => !x.used && x.customer)) {
      if (isCustomer(p.customer)) continue;
      const hit = data.purchases.find((pu) => !purchaseTaken.has(pu) && Math.abs(pu.amount - p.amount) <= 1 && Math.abs(dayOfIso(pu.date) - dayNum(p.at, timeZone)) <= 7);
      if (!hit) continue;
      purchaseTaken.add(hit); p.used = true; expPosts.push({ amount: p.amount, at: p.at, vendor: p.customer, method: 'cash', days: 7 });
    }
  }
  const inExtra = [];
  if (noPost.length) { white += noPost.length; inExtra.push('     ↳ ⚪ ' + noPost.length + ' receipt' + (noPost.length === 1 ? '' : 's') + ' (' + money(noPost.reduce((n, r) => n + r.amount, 0)) + ') with no post in the group'); }
  const sameName = (a, b) => !a || !b || sameCutCustomer(a, b);
  for (const p of inPosts.filter((x) => !x.used)) { // posted, but not among the Petty Cash cash payments: in another account (🟡), a swapped-digit question (❓), or not in QuickBooks at all (🔴)
    const iso = isoOf(p.at);
    if (p.noInvoice) { stars += 1; starTotal += Number(p.amount); inExtra.push(dline('⭐', iso, p.amount, '  no invoice needed')); continue; } // marked with a star: counted in the cash in, never flagged
    const elsewhere = (data.elsewhere || []).find((r) => !r.used && Math.abs(r.amount - p.amount) <= 1 && Math.abs(dayOfIso(r.date) - dayNum(p.at, timeZone)) <= 3 && sameName(r.name, p.customer));
    if (elsewhere) { elsewhere.used = true; yellow += 1; inExtra.push(dline('🟡', iso, p.amount, '  (in QuickBooks, deposited to ' + elsewhere.account + ', not ' + accountName + ')')); }
    else if (p.accepted) { green += 1; inExtra.push(dline('🟢', iso, p.amount, '  (accepted by you: ' + p.accepted.text + ')')); }
    else if (swapInfoOf(p.ref) || swapCodeOf(p.ref)) { red += 1; const si = swapInfoOf(p.ref) || { code: swapCodeOf(p.ref) }; inExtra.push(dline('❓', iso, p.amount, '  (digits swapped? QuickBooks has ' + (si.qboAmount ? money(si.qboAmount) : 'another amount') + (si.name ? ' for ' + si.name : '') + ': answer 1 = same payment, 2 = different, with #' + si.code + ')')); }
    else inExtra.push(dline(mark('🔴'), iso, p.amount, '  (posted, not in QuickBooks)'));
  }
  // cash out
  const expTotal = data.purchases.reduce((n, p) => n + p.amount, 0);
  const byCat = {};
  for (const p of data.purchases) byCat[p.category] = (byCat[p.category] || 0) + p.amount;
  // the same expense <-> QuickBooks match as the weekly check: the expense's own (receipt) date, up to 14 days apart, the amount, the vendor when both have one
  const vendorsAgree = (a, b) => !a || !b || typedFitsName(a, b) || typedFitsName(b, a);
  const claimExp = (pu) => {
    const at = expPosts.findIndex((q) => !q.used && Math.abs(Number(q.amount) - Number(pu.amount)) <= (q.strict ? 0.01 : 1) && Math.abs(dayNum(q.at, timeZone) - dayOfIso(pu.date)) <= (q.days || 3) && (!q.strict || vendorsAgree(q.vendor, pu.vendor)));
    if (at < 0) return null;
    expPosts[at].used = true; return expPosts[at];
  };
  const expLines = data.purchases.map((p) => { const post = claimExp(p); return dline(mark(post ? '🟢' : '⚪'), p.date, p.amount, '   ' + (p.vendor || p.category) + (post ? (post.method === 'card' ? '  ⚠ method differs: posted card, QuickBooks Petty Cash (cash)' : '') + addedTail(post) : '  (no post in the group)')); });
  expLines.push(...unmatchedLines(expPosts.filter((p) => p.method !== 'card'), (p) => '   ' + (p.vendor || '')));
  const bossT = data.transfersOut.filter((t) => /owner/i.test(t.to));
  const advT = data.transfersOut.filter((t) => /advance/i.test(t.to));
  const otherT = data.transfersOut.filter((t) => !bossT.includes(t) && !advT.includes(t));
  const tLines = (list, pool, who) => {
    const lines = list.map((t) => { const post = claim(pool, t.amount, t.date); return dline(mark(post ? '🟢' : '⚪'), t.date, t.amount, (who ? '   ' + ((post && post.employee) || t.note || '') : '') + (post ? addedTail(post) : '  (no post in the group)')); });
    lines.push(...unmatchedLines(pool, (p) => (who && p.employee ? '   ' + p.employee : '')));
    return lines;
  };
  const sum = (l) => l.reduce((n, t) => n + t.amount, 0);
  const blocks = [];
  if (data.purchases.length || expPosts.some((p) => !p.used && p.method !== 'card')) blocks.push([cell('🧾 *Company expenses (cash)*', expTotal), ...(data.purchases.length ? ['     ↳ ' + Object.keys(byCat).map((k) => k + ' ' + money(byCat[k])).join(' | ')] : []), ...expLines].join('\n'));
  const bossL = tLines(bossT, bossPosts, false);
  if (bossT.length || bossPosts.length) blocks.push([bossT.length ? cell('👔 *Cash to boss*', sum(bossT)) : '👔 *Cash to boss*: none recorded in QuickBooks this month', ...bossL].join('\n')); // kept visible when a post says it happened
  const advL = tLines(advT, advPosts, true);
  if (advT.length || advPosts.some((p) => !p.used)) blocks.push([cell('👷 *Salary advances*', sum(advT)), ...advL].join('\n'));
  for (const n of [...new Set(otherT.map((t) => t.to))]) { const l = otherT.filter((t) => t.to === n); blocks.push([cell('↔️ *' + n + '*', sum(l)), ...l.map((t) => dline(mark('⚪'), t.date, t.amount, ''))].join('\n')); }
  const totalIn = cashFromCustomers + transfersInTotal + starTotal;
  const totalOut = expTotal + sum(data.transfersOut);
  const remaining = Math.round((totalIn - totalOut) * 100) / 100;
  const text = [
    '📦 *Cash box — ' + label + '*', ...(checkedAt ? ['checked now ' + checkedAt] : []), SEP, SEP,
    '💵 *Cash in*', cell('Cash from customers', cashFromCustomers), ...(starTotal ? [cell('⭐ No invoice needed', starTotal)] : []), ...(transfersInTotal ? [cell('Transfers in', transfersInTotal)] : []), ...inExtra, SEP, SEP,
    '💸 *Cash out*', '', blocks.length ? blocks.join('\n' + SEP + '\n') : 'Nothing left the cash box.', SEP, SEP,
    '*Total in (month): ' + money(totalIn) + ' AED*', '*Total out (month): ' + money(totalOut) + ' AED*', '*Net for the month: ' + money(remaining) + ' AED*',
    '🟢 Posted and in QuickBooks: ' + green + '    🔴 Not in QuickBooks: ' + red + '    ⚪ No post: ' + white + (yellow ? '    🟡 Other account: ' + yellow : '') + (stars ? '    ⭐ No invoice needed: ' + stars : ''),
  ].join('\n');
  return { text, remaining };
}

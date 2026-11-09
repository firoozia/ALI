// Payments seen in the Confirmation group (a bank credit message, «<customer> 500 received», cash, a cheque) matched against the customer's OPEN invoices in QuickBooks.
// A PROPOSAL only, read only: nothing is ever recorded in QuickBooks from here (recording a payment would be its own owner-approved job). The account numbers of the bank messages are
// never kept: only the amount.

import fs from 'node:fs';
import path from 'node:path';
import { withSeparators } from './separator.js';
import { matchCod, stripPaymentWords } from './captions.js';
import { sameCutCustomer } from './cuts.js';

const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dm = (ms, timeZone) => { const [, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-'); return `${d}/${m}`; };
const label = (i) => `${i.DocNumber || `#${i.Id}`} ${money(i.Balance)}`;

const refOf = (e) => String(e.ref || `${e.at}|${e.amount}`);

/** What the owner said about two payments with the same amount and customer: «dup» (count once) or «separate» (two payments). Kept on the server, so he is not asked again. */
export class PaymentDups {
  constructor(dir = '') {
    this.file = dir ? path.join(dir, 'qbo-payment-dups.json') : '';
    this.d = { n: 0, open: {}, answers: {} };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ }
  }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  key(first, second) { return `${refOf(first)}|${refOf(second)}`; }
  /** 'dup', 'separate' or '' (not answered yet) for the pair. */
  state(first, second) { return this.d.answers[this.key(first, second)] || ''; }
  /** The code D1, D2 … of the question for this pair (the same pair keeps its code). */
  ask(first, second) {
    const key = this.key(first, second);
    const known = Object.entries(this.d.open).find(([, v]) => v === key);
    if (known) return known[0];
    this.d.n += 1; const id = `D${this.d.n}`; this.d.open[id] = key; this.save(); return id;
  }
  decide(id, verb) {
    const code = String(id || '').toUpperCase(); const key = this.d.open[code];
    if (!key) return { error: 'not found' };
    this.d.answers[key] = verb === 'dup' ? 'dup' : 'separate'; delete this.d.open[code]; this.save();
    return { verb: this.d.answers[key] };
  }
}

const cleaned = (raw) => { const clean = raw.customer ? stripPaymentWords(raw.customer) : ''; return raw.customer && !clean ? { ...raw, customer: '', pendingName: true } : { ...raw, customer: clean }; };
const recordedId = (x) => String(x.Id || `${x.TxnDate}|${x.CustomerRef?.name || ''}|${x.TotalAmt}`);

/** The QuickBooks payment the office already recorded for this message: about this amount (within 1) within 7 days before or after it, of this customer when he is named; or null. */
export function findRecorded(raw, payments, aliasOf = () => '', { unique = false } = {}) {
  const event = cleaned(raw); const amount = Number(event.amount) || 0;
  const hits = payments.filter((x) => Math.abs(Number(x.TotalAmt) - amount) <= 1 && Math.abs(Date.parse(`${x.TxnDate}T00:00:00Z`) - event.at) <= 7 * 24 * 3600 * 1000
    && (!event.customer || event.pendingName || event.customer.split(' + ').some((one) => sameCutCustomer(one, x.CustomerRef?.name || '') || (!!aliasOf(one) && sameCutCustomer(aliasOf(one), x.CustomerRef?.name || '')))));
  return unique && hits.length > 1 && (!event.customer || event.pendingName) ? null : hits[0] || null; // for the duplicate rule a nameless message must fit ONE payment, not several
}

/** The same amount (to the fil) on the same day, and the same named customer OR both messages resolved to the SAME QuickBooks payment; a missing or different customer is otherwise never a duplicate. */
function repeats(a, b, timeZone, payments = [], aliasOf = () => '') {
  if (Math.round(Number(a.amount) * 100) !== Math.round(Number(b.amount) * 100)) return false;
  const ca = a.customer ? stripPaymentWords(a.customer) : ''; const cb = b.customer ? stripPaymentWords(b.customer) : '';
  if (dm(a.at, timeZone) !== dm(b.at, timeZone) || Math.abs(a.at - b.at) >= 3 * 24 * 3600 * 1000) return false;
  if (ca && cb && !a.pendingName && !b.pendingName && sameCutCustomer(ca, cb)) return true;
  const ra = payments.length ? findRecorded(a, payments, aliasOf, { unique: true }) : null; const rb = payments.length ? findRecorded(b, payments, aliasOf, { unique: true }) : null;
  return !!(ra && rb && recordedId(ra) === recordedId(rb)); // one of them without a name: both are the receipt the office recorded once
}

/**
 * [event]: a payment event of the tracker ({ amount, kind, customer, at }). [invoices]: the OPEN invoices (Balance above zero) with CustomerRef.name. Returns the proposal as lines.
 * With a customer named: his open invoices that add up to the amount (up to four); else his open list. Without a name (a bank credit): the customers with an exact match.
 */
export function proposePayment({ event: raw, invoices, payments = [], aliasOf = () => '', timeZone = 'Asia/Dubai' }) {
  const clean = raw.customer ? stripPaymentWords(raw.customer) : '';
  const event = raw.customer && !clean ? { ...raw, customer: '', pendingName: true } : { ...raw, customer: clean }; // an event kept with «receipt + clear» as its name is a payment without a name
  const amount = Number(event.amount) || 0;
  const how = `${money(amount)} ${event.currency || 'AED'} — ${event.kind === 'transfer' ? 'bank credit' : event.kind || 'payment'}${event.customer ? ` from ${event.customer}` : ''} (${dm(event.at, timeZone)})`;
  const recorded = findRecorded(event, payments, aliasOf);
  if (recorded) return [how, `→ already recorded in QuickBooks (payment of ${dm(Date.parse(`${recorded.TxnDate}T00:00:00Z`), timeZone)}${recorded.CustomerRef?.name ? `, ${recorded.CustomerRef.name}` : ''})`];
  const open = invoices.filter((i) => Number(i.Balance) > 0);
  const named = event.customer && !event.pendingName;
  const sameNamed = (inv) => event.customer.split(' + ').some((one) => sameCutCustomer(one, inv.CustomerRef?.name || '') || (!!aliasOf(one) && sameCutCustomer(aliasOf(one), inv.CustomerRef?.name || '')));
  if (named) {
    const his = open.filter(sameNamed);
    if (!his.length) return [how, '→ not found in QuickBooks payments (±7 days) and this customer has no open invoice'];
    const hit = matchCod(amount, his.map((i) => i.Balance), 1);
    if (hit) { const sum = hit.reduce((x, k) => x + Number(his[k].Balance), 0); return [how, `→ pays ${hit.map((k) => label(his[k])).join(' + ')}${Math.abs(sum - amount) > 0.05 ? ` (rounded: ${money(sum)})` : ''}`]; }
    return [how, `→ not found in QuickBooks payments (±7 days) and no open invoice of this amount. Open invoices of this customer: ${his.slice(0, 5).map(label).join(', ')}${his.length > 5 ? ` and ${his.length - 5} more` : ''}.`];
  }
  const byCustomer = new Map();
  for (const inv of open) byCustomer.set(inv.CustomerRef?.name || '?', [...(byCustomer.get(inv.CustomerRef?.name || '?') || []), inv]);
  // no name in the message: the customers whose open invoices add up to the amount, one per line, the best first (the exact amount before one dirham off, one invoice before several)
  const found = [];
  for (const [customer, list] of byCustomer) {
    const hit = matchCod(amount, list.map((i) => i.Balance), 1);
    if (hit) { const sum = hit.reduce((x, k) => x + Number(list[k].Balance), 0); found.push({ customer, text: `${hit.map((k) => label(list[k])).join(' + ')}${hit.length > 1 ? ` = ${money(sum)}` : ''}`, exact: Math.abs(sum - amount) <= 0.005, count: hit.length, diff: Math.abs(sum - amount) }); }
  }
  if (!found.length) return [how, '→ no customer name in the message, and no customer has open invoices adding up to this amount'];
  found.sort((x, y) => (x.exact === y.exact ? x.count - y.count || x.diff - y.diff || x.customer.localeCompare(y.customer) : x.exact ? -1 : 1));
  return [how, '→ no customer name in the message. Possible matches:', ...found.slice(0, 3).map((f) => `• ${f.customer} — ${f.text}`), ...(found.length > 3 ? [`• and ${found.length - 3} other customer${found.length - 3 === 1 ? '' : 's'}`] : [])];
}

/** The report: [events] with an amount, newest first, at most [max] proposals; the footer says nothing was recorded. */
export function paymentsText({ events, invoices, payments = [], aliasOf, timeZone, now = Date.now(), days = 14, max = 10, dups = new PaymentDups(''), only = '' }) {
  const recent = events.filter((e) => e.type === 'payment' && Number(e.amount) > 0 && !e.simulated && e.at >= now - days * 24 * 3600 * 1000).sort((a, b) => b.at - a.at);
  if (!recent.length) return `No payment was seen in the Confirmation group in the last ${days} days.`;
  // two payments with the same amount and customer: the first one is listed; the second is marked and the owner is asked (his answer is kept on the server)
  const marked = new Map(); const dropped = new Set();
  recent.forEach((e, idx) => {
    const original = recent.slice(idx + 1).find((o) => repeats(e, o, timeZone, payments, aliasOf));
    if (!original) return;
    const answer = dups.state(original, e);
    if (answer === 'dup') dropped.add(e); else if (answer !== 'separate') marked.set(e, { original, id: dups.ask(original, e) });
  });
  const visible = recent.filter((e) => !dropped.has(e));
  const ordered = [];
  for (const e of visible) { // the first one of a pair, then its marked repeat right under it
    if (marked.has(e)) continue;
    ordered.push(e, ...visible.filter((x) => marked.get(x)?.original === e));
  }
  for (const e of visible) if (!ordered.includes(e)) ordered.push(e);
  const shown = only ? ordered.filter((e) => refOf(e) === String(only)) : ordered;
  if (!shown.length) return '';
  const blocks = shown.slice(0, max).map((event, i) => {
    const mark = marked.get(event);
    if (!mark) return `${i + 1}. ${proposePayment({ event, invoices, payments, aliasOf, timeZone }).join('\n   ')}`;
    const at = shown.indexOf(mark.original);
    const same = `${at >= 0 && at < max ? `#${at + 1}` : 'an earlier payment'} (${dm(mark.original.at, timeZone)})`;
    return `${i + 1}. ${[proposePayment({ event, invoices, payments, aliasOf, timeZone })[0], `⚠ Duplicate? same amount and customer as ${same}`, `Reply: dup #${mark.id} (count once) / separate #${mark.id} (two payments)`].join('\n   ')}`;
  });
  return [`Payments to match (${shown.length}):`, withSeparators(blocks), ...(shown.length > max ? [`and ${shown.length - max} more payments`] : []), 'Proposal only — nothing was recorded in QuickBooks.'].join('\n');
}

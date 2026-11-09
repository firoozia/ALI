// Payments seen in the Confirmation group (a bank credit message, «<customer> 500 received», cash, a cheque) matched against the customer's OPEN invoices in QuickBooks.
// A PROPOSAL only, read only: nothing is ever recorded in QuickBooks from here (recording a payment would be its own owner-approved job). The account numbers of the bank messages are
// never kept: only the amount.

import { matchCod } from './captions.js';
import { sameCutCustomer } from './cuts.js';

const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dm = (ms, timeZone) => { const [, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-'); return `${d}/${m}`; };
const label = (i) => `${i.DocNumber || `#${i.Id}`} ${money(i.Balance)}`;

/**
 * [event]: a payment event of the tracker ({ amount, kind, customer, at }). [invoices]: the OPEN invoices (Balance above zero) with CustomerRef.name. Returns the proposal as lines.
 * With a customer named: his open invoices that add up to the amount (up to four); else his open list. Without a name (a bank credit): the customers with an exact match.
 */
export function proposePayment({ event, invoices, aliasOf = () => '', timeZone = 'Asia/Dubai' }) {
  const amount = Number(event.amount) || 0;
  const how = `${money(amount)} ${event.currency || 'AED'} — ${event.kind === 'transfer' ? 'bank credit' : event.kind || 'payment'}${event.customer ? ` from ${event.customer}` : ''} (${dm(event.at, timeZone)})`;
  const open = invoices.filter((i) => Number(i.Balance) > 0);
  const named = event.customer && !event.pendingName;
  const sameNamed = (inv) => event.customer.split(' + ').some((one) => sameCutCustomer(one, inv.CustomerRef?.name || '') || (!!aliasOf(one) && sameCutCustomer(aliasOf(one), inv.CustomerRef?.name || '')));
  if (named) {
    const his = open.filter(sameNamed);
    if (!his.length) return [how, '→ no open invoice found for this customer'];
    const hit = matchCod(amount, his.map((i) => i.Balance), 0.05);
    if (hit) return [how, `→ pays ${hit.map((k) => label(his[k])).join(' + ')}`];
    const total = his.reduce((s, i) => s + Number(i.Balance), 0);
    return [how, `→ no exact match; open: ${his.slice(0, 5).map(label).join(', ')}${his.length > 5 ? ` +${his.length - 5}` : ''} (total ${money(total)})${amount < total ? '; a part payment or an advance' : ''}`];
  }
  const byCustomer = new Map();
  for (const inv of open) byCustomer.set(inv.CustomerRef?.name || '?', [...(byCustomer.get(inv.CustomerRef?.name || '?') || []), inv]);
  const found = [];
  for (const [customer, list] of byCustomer) { const hit = matchCod(amount, list.map((i) => i.Balance), 0.05); if (hit) found.push(`${customer}: ${hit.map((k) => label(list[k])).join(' + ')}`); }
  if (!found.length) return [how, '→ no customer has open invoices adding up to this amount; the name is needed'];
  return [how, found.length === 1 ? `→ most likely ${found[0]}` : `→ could be: ${found.slice(0, 3).join(' | ')}${found.length > 3 ? ` +${found.length - 3}` : ''}`];
}

/** The report: [events] with an amount, newest first, at most [max] proposals; the footer says nothing was recorded. */
export function paymentsText({ events, invoices, aliasOf, timeZone, now = Date.now(), days = 14, max = 6 }) {
  const recent = events.filter((e) => e.type === 'payment' && Number(e.amount) > 0 && !e.simulated && e.at >= now - days * 24 * 3600 * 1000).sort((a, b) => b.at - a.at);
  if (!recent.length) return `No payment was seen in the Confirmation group in the last ${days} days.`;
  const blocks = recent.slice(0, max).map((event, i) => `${i + 1}. ${proposePayment({ event, invoices, aliasOf, timeZone }).join('\n   ')}`);
  return [`Payments to match (${recent.length}):`, ...blocks, ...(recent.length > max ? [`+${recent.length - max} more`] : []), 'Proposal only: nothing was recorded in QuickBooks.'].join('\n');
}

// Plain-words helpers of the staff chat: what a simulated post was understood as (shown in full, so a test can check it), «where is <customer> order?» answered from the tracker's cut and
// delivery posts, and plain questions of the owner («how much money came in today?», «recieved today») routed to the reports that already exist. Pure functions.
import { parseCashBoxCommand } from './cashbox.js';
import { sameCutCustomer } from './cuts.js';

const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const KIND_TEXT = {
  cash: 'cash from a customer', cheque: 'cheque', transfer: 'bank transfer', cash_to_boss: 'cash to the boss (not customer money)', salary_advance: 'salary advance (not customer money)',
  cash_expense: 'company cash expense (not customer money)', cash_unclear: 'cash out, kind unclear (the owner is asked)',
};
const dmy = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');
const when = (ms, timeZone = 'Asia/Dubai') => new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));

/** One tracker event as a line a tester can check: its kind, amount, name, cheque date, star, invoices, driver cash. */
export function describeEvent(ev) {
  if (!ev) return '';
  if (ev.type === 'payment') {
    const parts = [KIND_TEXT[ev.kind] || String(ev.kind || 'payment'), money(ev.amount || 0) + ' ' + (ev.currency || 'AED')];
    const who = ev.customer || ev.employee || '';
    parts.push(ev.kind === 'cash_expense' ? 'for ' + (ev.employee || '?') : ev.kind === 'salary_advance' ? 'to ' + (ev.employee || '?') : who ? 'from ' + who : (ev.kind === 'cash_to_boss' ? '' : 'from nobody named (the owner is asked: from whom?)'));
    if (ev.chequeDate) parts.push('cheque date ' + dmy(ev.chequeDate));
    if (ev.noInvoice) parts.push('⭐ no invoice needed');
    if (ev.invoices?.length) parts.push('invoices ' + ev.invoices.join(', '));
    if (ev.unknownCustomer) parts.push('not our customer? — check');
    return 'payment: ' + parts.filter(Boolean).join(', ');
  }
  if (ev.type === 'delivery') return 'delivery: ' + (ev.customer || '-') + (ev.status ? ', ' + ev.status : '') + (ev.delivered ? ', ' + ev.delivered.quantity + ' ' + (ev.delivered.unit || '') : '') + (ev.cod ? ', COD ' + money(ev.cod) : '') + (ev.collected ? ', driver collected ' + money(ev.collected) + ' AED cash (kept as driver cash)' : '') + (ev.by ? ', by ' + ev.by : '');
  if (ev.type === 'cut') {
    const same = !ev.customerTyped || String(ev.customerTyped).toLowerCase() === String(ev.customer || '').toLowerCase();
    const lines = (ev.lines || []).map((l) => l.code + ' = ' + l.quantity + ' ' + (l.unit || 'm') + (l.note ? ' (' + l.note + ')' : ''));
    return 'cut' + (ev.internal ? ' (internal)' : '') + ': customer ' + (ev.customer || '-') + (same ? '' : ' (typed "' + ev.customerTyped + '")') + '; ' + (lines.length ? lines.length + ' line' + (lines.length === 1 ? '' : 's') + ': ' + lines.join('; ') : 'no lines were read');
  }
  return String(ev.type) + ': ' + (ev.customer || '-');
}

/** «where is master wood order?» / «status of X» / «what happened to X order»: the customer's name, or ''. */
export function parseOrderWhere(text) {
  const t = String(text || '').replace(/^\s*(?:atossa|atosa|atousa|آتوسا|اتوسا)[ ,:]+/i, '').replace(/[?!.]+\s*$/, '').trim();
  const m = /^(?:where(?:'s| is)|what(?:'s| is) the status of|status of|what happened to|how is)\s+(?:the\s+)?(.{2,60}?)(?:'s)?\s+(?:order|orders|cut|delivery|goods)$/i.exec(t);
  return m ? m[1].trim() : '';
}

/** The cut and delivery posts of a customer, newest last: [events] the tracker's (the TEST memory in the test group). */
export function orderWhereText(events, name, timeZone = 'Asia/Dubai', memory = '') {
  const mine = (events || []).filter((e) => (e.type === 'cut' || e.type === 'delivery') && !e.internal && !e.cancelled && [e.customer, e.customerTyped].some((c) => c && sameCutCustomer(name, c)));
  if (!mine.length) return 'No cut or delivery post of ' + name.toUpperCase() + ' was found' + (memory ? ' in the ' + memory : '') + '.';
  const last = mine.slice(-6);
  const delivered = mine.filter((e) => e.type === 'delivery' && e.status === 'delivered').length;
  return ['📦 ' + name.toUpperCase() + (memory ? ' (' + memory + ')' : ''), ...last.map((e) => when(e.at, timeZone) + '  ' + describeEvent(e)),
    delivered ? '✅ ' + delivered + ' delivery post' + (delivered === 1 ? '' : 's') + ' marked delivered.' : 'Not delivered yet (no delivered post).'].join('\n');
}

const RANGE_WORDS = /\b(?:today|yesterday|this week|week|weekly|this month|month)\b|دیروز|امروز/i;
const rangeOf = (t) => { const w = (RANGE_WORDS.exec(t) || [])[0] || 'today'; return /yesterday|دیروز/i.test(w) ? 'yesterday' : /month/i.test(w) ? 'month' : /week/i.test(w) ? 'week' : 'today'; };
/** A plain question or a typo of the owner, routed to a report that exists: { type, ... } (the same shape the owner's commands use) or null. */
export function plainReportAsk(text) {
  const t = String(text || '').replace(/^\s*(?:atossa|atosa|atousa|آتوسا|اتوسا)[ ,:]+/i, '').replace(/[?!.]+\s*$/, '').trim().toLowerCase();
  if (!t || t.length > 90 || /\d{3,}/.test(t)) return null;
  const ask = /^(?:how|what|which|show|tell|give|list|any|is there|are there|do we|did)\b/.test(t);
  if (/^(?:money\s+)?(?:rec(?:ie|ei|e)?v\w*\s+)?(?:today|yesterday|this week|week|this month|month)$/.test(t) && /rec\w*v|^money/.test(t) || /^دریافتی\s*(?:ها)?\s+(?:امروز|دیروز)$/.test(t) || (ask && /\b(?:money|cash|payments?)\b.*\b(?:came|come|coming|received|recieved|in)\b|\b(?:received|recieved)\b/.test(t) && !/\bcash\s*box\b|\bpetty\b|\bin the box\b/.test(t))) return { type: 'received_report', range: rangeOf(t) };
  if (ask && (/\bcash\s*box\b|\bpetty\b|\bin the box\b|\bhow much cash\b/.test(t))) return { type: 'cash_box', cmd: parseCashBoxCommand('cash box') };
  if (ask && (/\bnot\s+(?:yet\s+)?(?:invoiced|billed)\b|\bunbilled\b|\buninvoiced\b|\bwithout (?:an )?invoice\b/.test(t))) return { type: 'unbilled' };
  if (/^(?:weekly|week) check$/.test(t) || (ask && /\bweekly check\b|\bnot in quickbooks\b/.test(t))) return { type: 'weekly_check' };
  if (ask && /\bexpen[cs]es?\b|\bspent\b/.test(t)) return { type: 'expenses_report', range: rangeOf(t) };
  return null;
}

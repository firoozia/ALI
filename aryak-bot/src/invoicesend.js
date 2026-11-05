// SENDING A CUSTOMER'S INVOICE INTO THE CUSTOMER'S OWN GROUP: the first path that writes to a customer group. Only the OWNER can order it
// (a message typed on this account, never one the program sent itself, never a forwarded one), only in the Invoices group, the test group
// or the owner's own chat, and nothing is sent without his "yes" for this one invoice and this one group within ten minutes. The guard's
// single narrow exception is a one-shot token bound to the exact group and to the exact PDF message, created only by the approved flow
// and used up by the send; no text can pass through it.

import { sameName } from './sheetcheck.js';
import { shadowGroup } from './guard.js';
import { readableFileName } from './nameline.js';
import { answerKind } from './voice.js';
import { normalizeLetters } from './text.js';

// ---------------------------------------------------------------------------------------------------------------- who may order it
/** True only for a message typed on this very account: fromMe, not one the program sent (by its id or the robot sign), not forwarded. */
export function isOwnerCommand({ fromMe, id, text = '', sentIds, forwarded = false }) {
  if (!fromMe || forwarded) return false;
  if (sentIds?.has(id)) return false; // her own message coming back can never be a command
  if (String(text).trimStart().startsWith('🤖')) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------- the words
const SEND_WORDS = /ارسال\s*کن|ارسال\s*کنید|بفرست|بفرستید|بفرس|بزار\s+داخل|بذار\s+داخل|\bsend\b|\bforward\b|\bpost\b|أرسل|ارسل|ابعث/iu;
const INVOICE_WORDS = /فاکتور|فاكتور|فاتورة|الفاتورة|\binvoices?\b/iu;
const FILLER = new Set(['آتوسا', 'atossa', 'فاکتور', 'فاكتور', 'invoice', 'invoices', 'the', 'of', 'for', 'to', 'its', 'his', 'her', 'their', 'group', 'into', 'in', 'گروه', 'داخل', 'خود', 'مشتری', 'customer', 'customers', 'رو', 'را', 'ارسال', 'کن', 'کنید', 'بفرست', 'بفرستید', 'send', 'forward', 'post', 'please', 'pls', 'لطفا', 'لطفاً', 'فاتورة', 'الفاتورة', 'أرسل', 'ارسل', 'مجموعة', 'الى', 'إلى', 'في', 'عميل', 'this', 'that', 'it', 'همین', 'این', 'همان', 'آخرین', 'latest', 'last', 'one', 'هذه', 'هذا', 'و', 'به', 'برای', 'از', 'یک', 'هم', 'also']);

/** "آتوسا فاکتور nuqoosh رو ارسال کن داخل گروه خود مشتری" -> { customer: 'nuqoosh' }; no verb or no invoice word -> null; "send this invoice" -> { customer: '' }. */
export function parseSendCommand(text) {
  const s = String(text || '');
  if (!SEND_WORDS.test(s) || !INVOICE_WORDS.test(s)) return null;
  const words = s.replace(/[؟?!.,،:;()«»"']/g, ' ').split(/\s+/).filter(Boolean).filter((w) => !FILLER.has(w.toLowerCase()) && !/^\d+$/.test(w));
  return { customer: words.join(' ').trim() };
}

/** A loose match of a spoken customer name against a name on an invoice or a group: shared distinctive word, near spelling or a shared start. */
export function looseName(a, b) {
  if (sameName(a, b)) return true;
  const tok = (x) => normalizeLetters(String(x || '')).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((t) => t.length >= 4 && !GENERIC.has(t));
  const ta = tok(a); const tb = tok(b);
  return ta.some((x) => tb.some((y) => x === y || editDistance(x, y) <= 2 || (x.slice(0, 4) === y.slice(0, 4) && Math.min(x.length, y.length) >= 5)));
}
const GENERIC = new Set(['aryak', 'kitchen', 'kitchens', 'door', 'doors', 'wood', 'trading', 'industries', 'ind', 'llc', 'furniture', 'carpentry', 'decor', 'group', 'company', 'work', 'works']);

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// ---------------------------------------------------------------------------------------------------------------- finding things
/** The newest kept PDF whose stored read names this customer. [entries]: newest first; [recall](id) -> { number, customer, ... } or null. */
export function findInvoice(customer, entries, recall) {
  for (const e of entries) {
    const r = recall(e.id);
    if (r?.number && r?.customer && (!customer || looseName(customer, r.customer))) return { entry: e, read: r };
  }
  return null;
}

/** Is this the name of the test customer (an invoice that goes to the test group)? */
export const isTestCustomer = (name, word = 'test customer') => String(name || '').toLowerCase().includes(String(word).toLowerCase());

/**
 * The groups an invoice may go to: customer groups of the SHADOW list (not internal) whose name matches the customer on the invoice;
 * for the test customer, the test group. [groups]: { id, subject }. Never a group outside these.
 */
export function targetGroups(customer, groups, config) {
  if (isTestCustomer(customer, config.testCustomerName)) return groups.filter((g) => (config.testGroupNames || []).some((w) => String(g.subject).toLowerCase().includes(String(w).toLowerCase())));
  return groups.filter((g) => shadowGroup(g.subject, config) && looseName(customer, String(g.subject).replace(/aryak/gi, ' ')));
}

// ---------------------------------------------------------------------------------------------------------------- the confirmation
export function confirmText({ read, fileName, group, alreadySent }) {
  const lines = [];
  if (read.urgent > 0) lines.push(`⚠️ This invoice has ${read.urgent} unresolved urgent problem${read.urgent === 1 ? '' : 's'}.`);
  if (read.noOrder) lines.push('⚠️ No matching purchase order was found for this invoice.');
  if (alreadySent) lines.push(`⚠️ This invoice was already sent to this group (${alreadySent}).`);
  lines.push(`Invoice ${read.number} — ${read.customer}`);
  lines.push(`Total with VAT: ${read.total != null ? `AED ${Number(read.total).toFixed(2)}` : 'not read'}`);
  lines.push(`File: ${fileName}`);
  lines.push(`Group: ${group}`);
  lines.push('Send? yes / no (valid 10 minutes, for this invoice and this group only)');
  return lines.join('\n');
}

export const chooseText = (groups) => `Which group? Reply with the number:\n${groups.map((g, i) => `${i + 1}) ${g.subject}`).join('\n')}`;

/** The readable file name of the invoice, from what is printed on it. */
export const sendFileName = (read) => readableFileName(read.number, read.customer);

// ---------------------------------------------------------------------------------------------------------------- the approval
export class SendDesk {
  constructor({ now = () => Date.now(), ttlMs = 10 * 60 * 1000 } = {}) { Object.assign(this, { now, ttlMs }); this.map = new Map(); }

  /** A pending order for a chat (replaces an older one). [state]: { step: 'choose' | 'confirm', invoice, groups, group }. */
  start(chatId, state) { this.map.set(chatId, { ...state, at: this.now() }); }
  get(chatId) {
    const p = this.map.get(chatId);
    if (!p) return null;
    if (this.now() - p.at > this.ttlMs) { this.map.delete(chatId); return null; }
    return p;
  }
  clear(chatId) { this.map.delete(chatId); }

  /**
   * The owner's next message in the chat while an order waits: { type: 'choose', index } (a number), { type: 'yes' }, or { type: 'cancel' }
   * (any other answer cancels). Null when nothing waits or the sender is not the owner (their message is not an answer at all).
   */
  answer(chatId, text, fromOwner) {
    const p = this.get(chatId);
    if (!p || !fromOwner) return null;
    const t = String(text || '').trim();
    if (p.step === 'choose') {
      const n = Number(normalizeLetters(t).replace(/\D/g, ''));
      if (/^\d{1,2}$/.test(normalizeLetters(t).trim()) && n >= 1 && n <= p.groups.length) return { type: 'choose', index: n - 1 };
      this.clear(chatId);
      return { type: 'cancel' };
    }
    if (answerKind(t) === 'yes') return { type: 'yes' };
    this.clear(chatId);
    return { type: 'cancel' };
  }
}

// ---------------------------------------------------------------------------------------------------------------- the one-shot token
/** A token for ONE document message to ONE group: created by the approved flow, used up by the send. No text can use it. */
export class OneShot {
  constructor() { this.tokens = new WeakMap(); }

  grant(jid, content) {
    if (!content || typeof content !== 'object' || content.text !== undefined || !content.document || content.mimetype !== 'application/pdf') return false;
    this.tokens.set(content, jid);
    return true;
  }

  /** True once for the exact (group, content) it was granted for; every other send, and every second try, is refused. */
  consume(jid, content) {
    if (!content || typeof content !== 'object' || this.tokens.get(content) !== jid) return false;
    this.tokens.delete(content);
    return true;
  }
}

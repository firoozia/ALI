// SOURCING: sometimes our own staff writes in a customer's group asking whether THEY have a code that we are out of, in some
// quantity, so that we can buy it from them and supply another customer. The direction is reversed: staff asks, the customer
// is the supplier. Such a message is never a customer order, never an order on behalf, never a sale; the customer's "yes, 20 m"
// is not an order either. It is kept as an open sourcing event (type 'sourcing' in the tracker) and shown in the daily digest;
// when the goods arrive or an invoice for the other customer appears, it is said that sourcing covered it.
// The wording rules are plain lists below: add phrases there. Examples are in docs/SOURCING_EXAMPLES.md.

import { orderLinesOf } from './orderlines.js';
import { productCode } from './codes.js';
import { answerKind, answerLead } from './voice.js';
import { normalizeDigits } from './text.js';

/** Words by which our staff asks a customer whether they have something. Extend freely (lower case). */
export const ASK_PHRASES = [
  'do you have', 'have you got', 'do u have', 'you have any', 'available with you', 'available at you', 'with you available',
  'can you give', 'can you supply', 'can you send us', 'can you sell', 'can we buy', 'can we take', 'we need from you', 'we want to buy',
  'عندكم', 'عندك', 'هل لديكم', 'هل يوجد عندكم', 'ممكن تعطونا', 'نشتري منكم',
  'دارید', 'دارین', 'دارید؟', 'می‌توانید بدهید', 'می‌خواهیم از شما', 'از شما بخریم',
];

const norm = (s) => normalizeDigits(String(s || '')).toLowerCase().replace(/\s+/g, ' ').trim();

/** "for Bahar", "for the customer Bahar", "لـ بهار" -> the other customer when stated. */
export function forWhom(text) {
  const m = /\b(?:it\s+is\s+)?for\s+(?:customer\s+|the\s+customer\s+)?([a-z][a-z .&'-]{1,40})$/i.exec(norm(text).replace(/[?.!]+$/g, ''));
  return m ? m[1].trim() : '';
}

/** The first code in a message (with its quantity when it has one): { code, quantity, unit } or null. */
export function codeOf(text) {
  const t = norm(text);
  // a code with its quantity anywhere in the sentence ("do you have 603 - 20 mtr?"): read from each number onwards
  for (const m of t.matchAll(/(?:^|[^\d])(\d{2,5})(?=[^\d]|$)/g)) {
    const line = orderLinesOf(t.slice(m.index + (m[0].length - m[1].length)))[0];
    if (line) return { code: productCode(line.code), quantity: line.quantity, unit: line.unit };
  }
  const m = /(?:^|[^\d])(\d{2,5})(?:\s?([a-z])(?![a-z]))?(?=[^\d]|$)/i.exec(t);
  return m ? { code: productCode(m[2] ? `${m[1]} ${m[2]}` : m[1]), quantity: null, unit: '' } : null;
}

/**
 * Is a message of OUR staff in a customer group a sourcing request? Yes when it asks ("do you have ...", "عندكم ..."), or when
 * it names a code with a quantity that no customer asked about in the last [recent] list (a staff answer to a customer
 * repeats the code the customer just asked, so it is not a request). [recentCodes]: codes customers wrote lately.
 */
export function isSourcingRequest(text, recentCodes = []) {
  const t = norm(text);
  if (!t) return false;
  if (ASK_PHRASES.some((p) => t.includes(p))) return !!codeOf(text) || true;
  const lines = orderLinesOf(text);
  if (!lines.length) return false;
  const known = new Set(recentCodes.map((c) => productCode(c)));
  return lines.every((l) => !known.has(productCode(l.code)));
}

/** The event for a request ({ code, quantity, unit, for }) or null when no code can be read. */
export function sourcingEvent(text) {
  const c = codeOf(text);
  if (!c) return null;
  return { type: 'sourcing', status: 'open', code: c.code, quantity: c.quantity, unit: c.unit, for: forWhom(text), answer: '' };
}

/**
 * The customer's answer to an open request in the same group: "yes", "yes, 20 m", "no", "603 - 20 m". Returns
 * { status: 'answered'|'declined', answer, quantity } or null when the message is not an answer.
 */
export function sourcingAnswer(text, event) {
  const t = norm(text);
  if (!t) return null;
  const kind = answerKind(t) !== 'other' ? answerKind(t) : answerLead(t);
  const q = /(\d+(?:\.\d+)?)\s*(?:m|mtr|meters?|metres?|rolls?|متر|رول)?/i.exec(t);
  const line = orderLinesOf(text)[0];
  const sameCode = line && productCode(line.code) === productCode(event.code);
  if (kind === 'no') return { status: 'declined', answer: 'no', quantity: null };
  if (kind === 'yes' || sameCode || (q && /^(?:\W*)(?:yes|ok|okay|available|have)/i.test(t))) {
    const quantity = sameCode ? line.quantity : q ? Number(q[1]) : event.quantity;
    return { status: 'answered', answer: 'yes', quantity };
  }
  if (/\bnot\s+available\b|\bno\s+stock\b|ما\s+عندنا|غير\s+متوفر|ندارم|ندارد|نداریم/.test(t)) return { status: 'declined', answer: 'no', quantity: null };
  return null;
}

/** Open requests of a group not older than [maxAgeMs]. */
export function openSourcing(tracker, groupId, { now = Date.now(), maxAgeMs = 3 * 3600 * 1000 } = {}) {
  return tracker.events.filter((e) => e.type === 'sourcing' && e.status === 'open' && e.group === groupId && now - e.at <= maxAgeMs);
}

/** Goods that arrived ("received"): the answered requests for the code become 'received'. */
export function markSourcingReceived(tracker, code) {
  let n = 0;
  for (const e of tracker.events) {
    if (e.type === 'sourcing' && e.status === 'answered' && productCode(e.code) === productCode(code)) { e.status = 'received'; n++; }
  }
  if (n) tracker.persist('events');
  return n;
}

/** Notes for an invoice: a line whose code was covered by an answered or received sourcing for that customer (or any, when not stated). */
export function sourcingCover(tracker, inv, { windowDays = 30 } = {}) {
  const since = (inv.at || Date.now()) - windowDays * 86400000;
  const out = [];
  for (const l of inv.lines || []) {
    const hit = tracker.events.find((e) => e.type === 'sourcing' && ['answered', 'received'].includes(e.status) && e.at >= since
      && productCode(e.code) === productCode(l.code) && (!e.for || !inv.customer || norm(e.for).includes(norm(inv.customer).slice(0, 4)) || norm(inv.customer).includes(norm(e.for).slice(0, 4))));
    if (hit) out.push({ kind: 'sourcing-cover', item: productCode(l.code), requested: '', invoiced: '', note: `Covered by sourcing from ${hit.customer || 'a customer'} (${hit.status}), not from our own stock`, severity: 'info' });
  }
  return out;
}

/** Lines for the daily digest. */
export function sourcingDigest(events) {
  const s = events.filter((e) => e.type === 'sourcing');
  const open = s.filter((e) => e.status === 'open').length;
  const answered = s.filter((e) => e.status === 'answered').length;
  const declined = s.filter((e) => e.status === 'declined').length;
  const received = s.filter((e) => e.status === 'received').length;
  return s.length ? [`Sourcing from customers: ${open} waiting for an answer, ${answered} promised, ${declined} declined, ${received} received`] : [];
}

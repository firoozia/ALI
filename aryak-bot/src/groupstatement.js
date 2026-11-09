// Statements asked for in a WHATSAPP GROUP.
//  - An internal group (information, confirmation, invoices, accounting, staff, command, test): the owner or an authorized person asks, the PDF comes back in that
//    group (same flow, same guesses and numbered choice; the choice belongs to the person who asked).
//  - A customer group: only the OWNER's request counts and it means «send it to this customer». Nothing goes to the group by itself: the statement is built, shown to
//    the owner in his own chat as «بله #S3», and only his yes sends it (one-shot token, like the owner's invoice send). A colleague's request there is ignored.

import { parseInvoiceCommand } from './qboinvoice.js';
import { parseQboCommand } from './qbodesk.js';
import { withoutBotNames } from './staff.js';

/** A statement request in a text: { customer, period, unsupported } or null. */
export function statementAsk(text) {
  const ic = parseInvoiceCommand(text);
  if (ic?.type === 'statement_nl') return { customer: ic.customer, period: ic.period || null, unsupported: ic.unsupported || '', style: ic.style || '' };
  const qc = parseQboCommand(text);
  if (qc?.type === 'statement') return { customer: qc.name, period: null, unsupported: '' };
  return null;
}

/**
 * The text to read for a request. When the message is only her name («ATOSSA») and it quotes another message, the quoted message is the request.
 * [quotedText]: the text of the quoted message ('' if none or if it is her own).
 */
export function effectiveRequest(text, quotedText, names = []) {
  const rest = withoutBotNames(text, names).replace(/[.!؟?،,\s]+/g, ' ').trim();
  if (!rest && quotedText) return String(quotedText);
  return String(text || '');
}

const TTL_MS = 30 * 60 * 1000;

/** Statements built for a customer group and waiting for the owner's yes: «S1», «S2» … (kept in memory only; a restart drops them). */
export class GroupStatements {
  constructor({ now = () => Date.now(), ttlMs = TTL_MS } = {}) { Object.assign(this, { now, ttlMs }); this.map = new Map(); this.n = 0; }

  /** The next «S» number (the style previews of StatementPreviews share it, so a code means one thing). */
  nextId() { this.n += 1; return `S${this.n}`; }

  /** Keep a built statement for a group; returns its id. */
  add({ groupId, subject, held, name, period = null, kind = 'group', by = 'owner', notify = '' }) {
    this.n += 1;
    const id = `S${this.n}`;
    this.map.set(id, { id, groupId, subject, held, name, period, kind, by, notify, at: this.now() });
    return id;
  }

  get(id) {
    const p = this.map.get(id);
    if (!p) return null;
    if (this.now() - p.at > this.ttlMs) { this.map.delete(id); return null; }
    return p;
  }

  /** The waiting ids; with [by] only those asked for by that person (the owner sees all). */
  openIds(by = '') { return [...this.map.keys()].filter((id) => this.get(id) && (!by || this.get(id).by === by)); }
  clear(id) { this.map.delete(id); }
}

/** The line the owner reads in his own chat. */
export const askLine = ({ name, subject, id, period, kind = 'group' }) => `صورت‌حساب «${name}»${period ? ` از ${period.from} تا ${period.to}` : ''} برای ${kind === 'private' ? subject : `گروه «${subject}»`} آماده است؛ بفرستم؟ بله #${id}`;

/**
 * A statement asked for and not yet built: «S5» waits for the person's «1» (balance forward) or «2» (transaction statement), or «no». Memory only; half an hour.
 * [run(style)] builds and sends it where the request came from.
 */
export class StatementPreviews {
  constructor({ nextId, now = () => Date.now(), ttlMs = TTL_MS }) { Object.assign(this, { nextId, now, ttlMs }); this.map = new Map(); }
  add({ by, name, from, to, typed = '', guessed = false, run }) { const id = this.nextId(); this.map.set(id, { id, by, name, from, to, typed, guessed, run, at: this.now() }); return id; }
  get(id) { const p = this.map.get(String(id || '').toUpperCase()); if (!p) return null; if (this.now() - p.at > this.ttlMs) { this.map.delete(p.id); return null; } return p; }
  /** The waiting ids of one person; the owner (by 'owner') sees all of them. */
  openIds(by = '') { return [...this.map.keys()].filter((id) => this.get(id) && (!by || by === 'owner' || this.get(id).by === by)); }
  clear(id) { this.map.delete(String(id || '').toUpperCase()); }
}

const dmy = (iso) => String(iso).split('-').reverse().join('/');

/** The preview shown first: the customer, the exact period and the two layouts to choose from. [several]: more than one waits, so every reply carries its code. */
export function previewText({ id, name, from, to, typed = '', guessed = false, several = false }, fa = false) {
  const tag = (x) => (several ? `${x} #${id}` : x);
  if (fa) return `*صورت‌حساب* #${id}\nمشتری: *${name}*${guessed ? ` (حدس از «${typed}»)` : ''}\nبازه: ${dmy(from)} – ${dmy(to)}\n۱. با مانده انتقالی\n۲. صورت‌حساب تراکنشی\nپاسخ ${tag('۱')} یا ${tag('۲')} (یا ${tag('نه')})`;
  return `*Statement* #${id}\nCustomer: *${name}*${guessed ? ` (guessed from "${typed}")` : ''}\nPeriod: ${dmy(from)} – ${dmy(to)}\n1. Balance forward\n2. Transaction statement\nReply ${tag('1')} or ${tag('2')} (or ${tag('No')})`;
}

/** «1», «2», «1 #S5», «2 S5», «no», «No #S5», «نه»: the answer to a preview, or null. */
export function parseStyleReply(text) {
  const t = String(text || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
  let m = /^([12])\s*(?:#?\s*(S\d+))?\s*[.!]?$/i.exec(t);
  if (m) return { kind: 'style', style: m[1] === '1' ? 'balance' : 'transaction', id: (m[2] || '').toUpperCase() };
  if ((m = /^(?:no|نه|لغو|cancel)\s*(?:#?\s*(S\d+))?\s*[.!]?$/i.exec(t))) return { kind: 'no', id: (m[1] || '').toUpperCase() };
  return null;
}

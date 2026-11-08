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
  if (ic?.type === 'statement_nl') return { customer: ic.customer, period: ic.period || null, unsupported: ic.unsupported || '' };
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

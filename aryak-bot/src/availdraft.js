// A customer asks in his own group «209 available?». The assistant looks the code up in the ZINAX sheet and prepares a DRAFT answer that goes PRIVATELY to the sales manager (or the
// owner), with the real figures for him. Nothing goes to the customer group by itself: only the manager's «yes #V1» posts the draft there (one token, this group, this text), «no #V1»
// drops it. A customer never gets a quantity, a minimum or a reserved figure: the draft says available or not available, and asks how many when it is available.

const ASK = /(?:\bavailab\w*|\bin\s+stock\b|\bhave\s+you\b|\bdo\s+you\s+have\b|موجود\w*|متوف\w*|هل\s+(?:يوجد|لديكم|عندكم)|دارید|دارین|هست)/i;
const CODE = /(?<![\w.])([A-Za-z]{0,3}\d{2,5}[A-Za-z]?)(?![\w.]*\d)/g;
const QTY = /(\d+(?:\.\d+)?)\s*(?:m|mtr|mtrs|meters?|metres?|متر)\b/i;

/** The codes (at most three) and the quantity asked of a message like «209 available?» / «هل 209 متوفر؟» / «do you have 215 20m», or null when it is no such question. */
export function parseAvailabilityAsk(text) {
  const s = String(text || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).trim();
  if (!s || s.length > 200) return null;
  const qty = QTY.exec(s);
  const without = qty ? s.replace(qty[0], ' ') : s;
  const codes = [...new Set([...without.matchAll(CODE)].map((m) => m[1].replace(/^[A-Za-z]{1,3}(?=\d)/, '').toUpperCase()).filter((c) => /^\d{2,5}[A-Z]?$/.test(c)))].slice(0, 3);
  if (!codes.length) return null;
  const asks = ASK.test(s) || (/[?؟]\s*$/.test(s) && without.replace(/[\d\s?؟,،.+-]/g, '').length <= 3); // «209?» alone counts; a long question with a number does not
  return asks ? { codes, quantity: qty ? Number(qty[1]) : 0 } : null;
}

/** One code's answer from the sheet's result: { code, state: 'yes' | 'no' | 'part' | 'ambiguous', free } (the figures are for the manager only). */
export function stateOf(code, result, quantity = 0, remnantBelow = 10) {
  if (result?.ambiguous) return { code, state: 'ambiguous', free: 0, categories: result.categories || [] };
  if (!result?.found) return { code, state: 'no', free: 0 };
  const free = Number(result.free) || 0;
  if (free <= 0) return { code, state: 'no', free };
  const unit = result.unit || 'm';
  if (quantity > 0 && free < quantity) return { code, state: 'part', free, unit };
  // a tiny remnant is never «available»: the customer is told what is left and asked how many meters he needs
  if (unit === 'm' && remnantBelow > 0 && free < remnantBelow) return { code, state: 'remnant', free, unit };
  return { code, state: 'yes', free, unit };
}

/** The draft for the customer: no figures. An ambiguous code is left to the manager. */
export function draftText(states, quantity = 0) {
  const yes = states.filter((x) => x.state === 'yes'); const no = states.filter((x) => x.state === 'no' || x.state === 'part');
  const lines = [];
  for (const x of states.filter((y) => y.state === 'remnant')) lines.push(`Only ${x.free} m left of code ${x.code} (remnant). How many meters do you need?`);
  if (yes.length) lines.push(`Yes, ${yes.length === 1 ? 'code' : 'codes'} ${yes.map((x) => x.code).join(', ')} ${yes.length === 1 ? 'is' : 'are'} available.${quantity > 0 ? '' : ' How many meters do you need?'}`);
  if (no.length) lines.push(`Sorry, ${no.length === 1 ? 'code' : 'codes'} ${no.map((x) => x.code).join(', ')} ${no.length === 1 ? 'is' : 'are'} not available at the moment.`);
  return lines.join('\n');
}

/** What the manager reads: who asked, what, the draft, and the real figures. */
export function managerText({ id, subject, asked, states, draft, simulated }) {
  const figures = states.map((x) => `${x.code}: ${x.state === 'ambiguous' ? `in more than one group: ${(x.categories || []).join(', ')}` : x.state === 'no' ? 'not available' : `free ${x.free} ${x.unit || 'm'}${x.state === 'part' ? ' (less than asked)' : x.state === 'remnant' ? ' (a remnant: the draft says what is left, not available)' : ''}`}`).join('; ');
  return [
    `${simulated ? 'SIMULATION: ' : ''}Customer group "${subject}" asks: "${asked}"`,
    `Sheet: ${figures}`,
    draft ? `Draft for the group:\n${draft}` : 'No draft (a code is in several groups: answer it yourself).',
    ...(draft ? [`Reply yes #${id} to post the draft in the group${simulated ? ' (simulation: nothing will be posted)' : ''}, or no #${id} to drop it.`] : []),
  ].join('\n');
}

export class AvailabilityDrafts {
  constructor({ now = () => Date.now(), ttlMs = 30 * 60 * 1000 } = {}) { Object.assign(this, { now, ttlMs }); this.map = new Map(); this.n = 0; }
  add({ groupId, subject, draft, simulated = false }) { this.n += 1; const id = `V${this.n}`; this.map.set(id, { id, groupId, subject, draft, simulated, at: this.now() }); return id; }
  get(id) { const d = this.map.get(String(id).toUpperCase()); if (!d) return null; if (this.now() - d.at > this.ttlMs) { this.map.delete(d.id); return null; } return d; }
  openIds() { return [...this.map.keys()].filter((id) => this.get(id)); }
  clear(id) { this.map.delete(String(id).toUpperCase()); }
}

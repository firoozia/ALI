// A voice note of the owner or of a colleague: its transcript is echoed first («شنیدم: ...»). What only asks (the stock of a code, a status, a report) runs at
// once, as if it had been typed. What CHANGES something (an invoice, a price, a bulk job in QuickBooks, a send to a customer, teaching, a hold, a yes or
// no to an open question) waits: nothing is done until the speaker writes «بله», and a corrected text sent instead replaces the transcript.
// The transcript of a customer's voice note is never handled here (that stays a question asked back, nothing is sent to the customer).

import { parseInvoiceCommand, looksLikeInvoiceRequest } from './qboinvoice.js';
import { parseTrackerCommand } from './tracker.js';
import { parsePriceCommand } from './prices.js';
import { looksLikeTeaching } from './teach.js';
import { answerKind } from './voice.js';

const READ_ONLY = new Set(['audit', 'tax_list', 'auth_list', 'cost_report', 'price_list']);
const SEND = /(?:ارسال|بفرست|بفرستید|بفرستین|send|forward)/iu;
const INVOICE = /(?:فاکتور|invoice|صورت\s*حساب)/iu;

/** Does the transcript ask for something that changes anything? (A plain question does not.) */
export function voiceChangesSomething(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const kind = answerKind(t);
  if (kind === 'yes' || kind === 'no') return true; // a spoken yes or no never approves anything by itself
  const ic = parseInvoiceCommand(t);
  if (ic) return !READ_ONLY.has(ic.type);
  if (looksLikeInvoiceRequest(t)) return true;
  if (SEND.test(t) && INVOICE.test(t)) return true; // send an invoice to a customer
  try { const pc = parsePriceCommand(t); if (pc && pc.type !== 'show') return true; } catch { /* not a price command */ }
  const tc = parseTrackerCommand(t);
  if (tc && ['hold', 'release'].includes(tc.type)) return true;
  if (looksLikeTeaching(t)) return true;
  return false;
}

/** «شنیدم: ...» in the speaker's language. */
export function heardText(lang, transcript) {
  const t = String(transcript || '').trim();
  if (lang === 'ar') return `سمعت: ${t}`;
  if (lang === 'en' || lang === 'hi') return `I heard: ${t}`;
  return `شنیدم: ${t}`;
}

export function gatePrompt(lang) {
  if (lang === 'ar') return 'للتنفيذ اكتب «نعم»، أو أرسل النص الصحيح ليحل محله.';
  if (lang === 'en' || lang === 'hi') return 'To go ahead, reply "yes", or send the corrected text and it replaces this.';
  return 'برای اجرا بنویسید «بله»؛ یا متن درست را بفرستید تا جای این بنشیند.';
}

/**
 * What to do with a transcript. [explicit]: the note was addressed to the assistant or answers her; [named]: her name was heard in it;
 * [priv]: a private chat (the owner's own chat counts). In a group a note that is not for her is left alone as before.
 * Returns { mode: 'old' } (the earlier handling), or { mode: 'run' | 'ask', echo, prompt }.
 */
export function planVoice({ transcript, lang, explicit = false, named = false, priv = false, unclear = false }) {
  const t = String(transcript || '').trim();
  if (!t || !(priv || explicit || named)) return { mode: 'old' };
  const changes = unclear || voiceChangesSomething(t); // a transcript the recogniser was unsure of is never acted on without a yes
  return { mode: changes ? 'ask' : 'run', echo: heardText(lang, t), prompt: changes ? gatePrompt(lang) : '' };
}

/** What is waiting for the speaker's «بله»: one transcript per person and chat. */
export class VoiceGate {
  constructor({ ttlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) { this.ttlMs = ttlMs; this.now = now; this.map = new Map(); }
  set(key, text) { this.map.set(key, { text, at: this.now() }); if (this.map.size > 200) this.map.delete(this.map.keys().next().value); }
  get(key) { const v = this.map.get(key); if (!v) return null; if (this.now() - v.at > this.ttlMs) { this.map.delete(key); return null; } return v; }
  clear(key) { this.map.delete(key); }
}

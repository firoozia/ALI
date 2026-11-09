// A voice note of the owner or of a colleague: its transcript is echoed first («شنیدم: ...»). What only asks (the stock of a code, a status, a report) runs at
// once, as if it had been typed. What CHANGES something (an invoice, a price, a bulk job in QuickBooks, a send to a customer, teaching, a hold, a yes or
// no to an open question) waits: nothing is done until the speaker writes «بله», and a corrected text sent instead replaces the transcript.
// The transcript of a customer's voice note is never handled here (that stays a question asked back, nothing is sent to the customer).

import { isEnglishOut } from './outlang.js';
import { parseInvoiceCommand, looksLikeInvoiceRequest } from './qboinvoice.js';
import { parseTrackerCommand } from './tracker.js';
import { parsePriceCommand } from './prices.js';
import { looksLikeTeaching } from './teach.js';
import { answerKind } from './voice.js';
import { parseStatementRequest } from './period.js';
import { parseQboCommand } from './qbodesk.js';

const READ_ONLY = new Set(['audit', 'tax_list', 'auth_list', 'cost_report', 'price_list', 'statement_nl', 'persian_list', 'details', 'compare', 'dry_run', 'tax_inclusive', 'tax_inclusive_undo', 'stock_diff', 'alias_propose', 'unbilled', 'payments']);
const dubaiToday = () => new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
const SEND = /(?:ارسال|بفرست|بفرستید|بفرستین|send|forward)/iu;
const INVOICE = /(?:فاکتور|invoice|صورت\s*حساب)/iu;

/** Does the transcript ask for something that changes anything? (A plain question does not.) */
export function voiceChangesSomething(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const kind = answerKind(t);
  if (kind === 'yes' || kind === 'no') return true; // a spoken yes or no never approves anything by itself
  // a statement or a report only READS (the statement goes to the asker's own chat): it runs after the echo, no yes needed
  if (parseStatementRequest(t, dubaiToday())) return false;
  const qc = parseQboCommand(t);
  if (qc && ['status', 'statement'].includes(qc.type)) return false;
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
  if (isEnglishOut()) return `Heard: ${t}`; // English mode: her words are English, what the person said stays as it was said
  if (lang === 'ar') return `سمعت: ${t}`;
  if (lang === 'ur') return `میں نے سنا: ${t}`;
  if (lang === 'hi') return `मैंने सुना: ${t}`;
  if (lang === 'en') return `Heard: ${t}`;
  return `شنیدم: ${t}`;
}

export function gatePrompt(lang) {
  if (lang === 'ar') return 'للتنفيذ اكتب «نعم»، أو أرسل النص الصحيح ليحل محله.';
  if (lang === 'ur') return 'آگے بڑھنے کے لیے «ہاں» لکھیں، یا درست متن بھیجیں۔';
  if (lang === 'hi') return 'आगे बढ़ने के लिए «हाँ» लिखें, या सही पाठ भेजें।';
  if (lang === 'en') return 'To go ahead, reply "yes", or send the corrected text and it replaces this.';
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

/**
 * A text that corrects a request read from a photo or a voice note: lines like "508 = 50m", "AR105 20 m", "108: 30" (a code, then a quantity with an
 * optional unit). It answers the photo question; no other pending flow may take it.
 */
export function looksLikeCorrection(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length || lines.length > 12) return false;
  return lines.every((l) => /^[A-Za-z]{0,4}[\s-]*\d{2,5}\s*(?:=|:|-|,|\s)\s*\d+(?:[.,]\d+)?\s*(?:m|mtr|mtrs|meters?|metres?|rolls?|pcs?|pieces?|ctn|cartons?|متر|رول|عدد|کارتن)?\s*$/iu.test(l));
}

/** What is waiting for the speaker's «بله»: one transcript per person and chat. */
export class VoiceGate {
  constructor({ ttlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) { this.ttlMs = ttlMs; this.now = now; this.map = new Map(); }
  /** [kind]: 'ask' (a request waiting for its yes) or 'clarify' (a request that ran and needs one more answer, such as which customer). */
  set(key, text, kind = 'ask') { this.map.set(key, { text, kind, at: this.now() }); if (this.map.size > 200) this.map.delete(this.map.keys().next().value); }
  get(key) { const v = this.map.get(key); if (!v) return null; if (this.now() - v.at > this.ttlMs) { this.map.delete(key); return null; } return v; }
  clear(key) { this.map.delete(key); }
}

/** A bare «بله» or «نه» (no preview id) belongs to the question the assistant asked last in this chat, when there is one; only without one does it look at the open previews. */
export const bareAnswerYieldsToPending = (ic, hasPending) => !!(ic && ['yes', 'no'].includes(ic.type) && !ic.id && hasPending);

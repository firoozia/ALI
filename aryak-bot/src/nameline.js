// An invoice whose file name says nothing (a GUID) gets a readable name, taken ONLY from what is printed on the invoice itself:
// its number and the BILL TO customer. WhatsApp cannot rename a sent file, so she re-posts the same bytes as a reply to the original
// with the readable file name ("inv-9919 MASTER WOOD.pdf"), or, when that fails, writes one line ("Invoice inv-9919 - MASTER WOOD").
// Her own re-post is recognised and ignored (no check, no tracker event, no paid read, no second rename).

import fs from 'node:fs';
import path from 'node:path';

const GUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** A file name that tells nothing: a GUID, or a name with no word of three letters in it (digits, dashes, dates). Narrow on purpose. */
export function meaninglessName(fileName) {
  const base = String(fileName || '').trim().replace(/\.pdf$/i, '');
  if (!base) return true;
  if (GUID.test(base)) return true;
  return !/[A-Za-z؀-ۿ]{3,}/u.test(base);
}

const clean = (s) => String(s || '').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/[^\p{L}\p{N} _.&-]/gu, ' ').replace(/\s+/g, ' ').trim();

/** "inv-9919", "MASTER WOOD" -> "inv-9919 MASTER WOOD.pdf" (safe characters only); '' when the number or the customer is missing. */
export function readableFileName(number, customer) {
  const n = clean(number).toLowerCase().replace(/\s+/g, '-');
  const c = clean(customer).toUpperCase().replace(/\.+$/, '');
  return n && c ? `${n} ${c}.pdf` : '';
}

/** "Invoice inv-9919 - MASTER WOOD", or '' when the number or the customer is missing. */
export function nameLineText(number, customer) {
  const n = clean(number).toLowerCase().replace(/\s+/g, '-');
  const c = clean(customer).toUpperCase().replace(/\.+$/, '');
  return n && c ? `Invoice ${n} - ${c}` : '';
}

/** What was named already (by message and by invoice number), what was read, and the names she posted herself; kept on disk. */
export class NameStore {
  constructor(dir = '', now = () => Date.now()) {
    this.file = dir ? path.join(dir, 'invoice-names.json') : '';
    this.now = now;
    this.d = { messages: [], numbers: [], reads: {}, own: [] };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first start */ }
  }

  save() {
    if (!this.file) return;
    this.d.messages = this.d.messages.slice(-400); this.d.numbers = this.d.numbers.slice(-400); this.d.own = this.d.own.slice(-100);
    const ids = Object.keys(this.d.reads); for (const k of ids.slice(0, Math.max(0, ids.length - 300))) delete this.d.reads[k];
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d)); } catch { /* best effort */ }
  }

  /** True when this message or this invoice number was already named (nothing more is written). */
  named(messageId, number) { return this.d.messages.includes(messageId) || (!!number && this.d.numbers.includes(String(number).toLowerCase())); }
  markNamed(messageId, number, fileName) {
    this.d.messages.push(messageId);
    if (number) this.d.numbers.push(String(number).toLowerCase());
    if (fileName) this.d.own.push({ name: fileName, at: this.now() });
    this.save();
  }

  /** The read of an invoice message (number and customer), kept so a later "rename" needs no new read. */
  remember(messageId, number, customer) { if (messageId && number && customer) { this.d.reads[messageId] = { number, customer }; this.save(); } }
  recall(messageId) { return this.d.reads[messageId] || null; }

  /** Is this file name one she gave herself, in the last day? (her own re-post coming back) */
  isOwnName(fileName) { const cut = this.now() - 24 * 3600 * 1000; return this.d.own.some((o) => o.name === fileName && o.at >= cut); }
}

/**
 * Words by which a colleague asks her to name invoices from what is printed on them: "rename", "change the name", "تغییر نام", "هم نام
 * ... کن", "اسم ... عوض", "اسم بزار", and the Arabic ways to say it. The caller requires that she is addressed by name.
 */
export function wantsRename(text) {
  const s = String(text || '');
  return /\brename\b|\bchange\s+(?:the\s+)?(?:file\s+)?names?\b|\bname\s+(?:the\s+)?(?:invoices?|files?)\b/i.test(s)
    || /تغییر\s*(?:دادن\s*)?(?:نام|اسم)|هم\s*نام|(?:نام|اسم)[^\n]{0,40}(?:عوض|تغییر|بزار|بذار|بگذار)|(?:نام|اسم)\s*(?:بزار|بذار|بگذار)/u.test(s)
    || /(?:غي[رّ]|تغيير|بدّ?ل)\s*(?:ال)?(?:اسم|إسم)|(?:اسم|إسم)[^\n]{0,30}(?:غي[رّ]|بدّ?ل)|(?:إعادة|اعادة|أعد|اعد)\s*تسمية/u.test(s);
}

/** The PDF messages seen in a group (the last [max] on disk: the message proto only), so invoices already sent can be named later. */
export class MediaKeep {
  constructor(dir = '', { replacer, reviver, max = 50 } = {}) {
    this.file = dir ? path.join(dir, 'invoice-media.json') : '';
    Object.assign(this, { replacer, reviver, max });
    this.list_ = [];
    try { if (this.file) this.list_ = JSON.parse(fs.readFileSync(this.file, 'utf8'), reviver); } catch { /* none yet */ }
  }

  add(entry) {
    if (!entry?.id || this.list_.some((e) => e.id === entry.id)) return false;
    this.list_.push(entry);
    this.list_ = this.list_.slice(-this.max);
    this.save();
    return true;
  }

  /** Newest first, for one group. */
  list(groupId) { return this.list_.filter((e) => !groupId || e.groupId === groupId).slice().reverse(); }

  save() {
    if (!this.file) return;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.list_, this.replacer)); } catch { /* best effort */ }
  }
}

/** The switch: 'file' (re-post with the readable name, the default), 'line' (only the text line) or 'off'. */
export function nameMode(value) {
  const v = String(value ?? 'file').trim().toLowerCase();
  if (['off', '0', 'false', 'no'].includes(v)) return 'off';
  if (v === 'line') return 'line';
  return 'file';
}

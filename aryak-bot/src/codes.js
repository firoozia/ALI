// Shared reading of product codes and units in customers' messages.

import { normalizeDigits } from './text.js';

/**
 * "AR102", "ARY 102", "Aryak 505", "Arek 505", "ارياك 505": AR is short for ARYAK, not part of the code. Returns the code
 * without that prefix, or the same text when there is none. The caller looks the exact code up first (the sheet may really
 * hold a code that starts with AR) and the stripped one second.
 */
export function stripBrand(code) {
  const s = normalizeDigits(String(code || '')).trim();
  const m = /^(?:ary?a?k|arek|ar|ary|ارياك|اريك|آریاک|اریاک)[\s\-_.]*(\d.*)$/iu.exec(s);
  return m ? m[1].toUpperCase() : s;
}

/** The brand written as a word before a code ("Aryak 505", "Arek 505") is removed from a whole line; "AR102" stays for the lookup. */
export const dropBrandWord = (line) => String(line || '').replace(/(^|[\s,:;(])(?:aryak|arek|ary|ارياك|اريك|آریاک|اریاک)\s+(?=\d)/giu, '$1');

const UNIT_KIND = [[/^(m|mt|mtr|mtrs|met\w*|metre\w*|meter\w*)$/i, 'm'], [/^rolls?$/i, 'roll'], [/^(pc|pcs|piece|pieces)$/i, 'pcs'], [/^(carton|cartons|ctn)$/i, 'carton']];
/** "mete", "MTR", "Meters" -> "m"; "rolls" -> "roll". */
export function unitOf(word) {
  const w = String(word || '').trim();
  for (const [re, kind] of UNIT_KIND) if (re.test(w)) return kind;
  return w.toLowerCase();
}

export const UNIT_RE = '(m|mtrs?|met\\w{0,5}|metres?|rolls?|pcs?|pieces?|cartons?|ctn)';

const NOT_NAMES = new Set(['hi', 'hello', 'please', 'pls', 'add', 'also', 'code', 'ok', 'okay', 'yes', 'no', 'new', 'order', 'thanks', 'thank', 'you', 'send', 'check', 'available', 'avail', 'when', 'coming', 'hold', 'cancel', 'bill', 'need', 'more', 'color', 'colour', 'this', 'that', 'or', 'and', 'the', 'in', 'only', 'pvc', 'سلام', 'لطفا', 'موجود', 'متوفر']);

/** The text after an order line ("al ebda", "nuqoosh") when it can be a customer's name; '' otherwise. */
export function tailName(rest) {
  const s = String(rest || '').replace(/^[\s)\]:;,.\-–—]+/, '').replace(/[\s?؟!.,;]+$/u, '').trim();
  if (!/^[\p{L} ]{2,30}$/u.test(s)) return '';
  const words = s.toLowerCase().split(/\s+/);
  return words.length <= 3 && !words.some((w) => NOT_NAMES.has(w)) ? s : '';
}

/**
 * Who is billed for a batch of messages of one group. The words after an order line ("234=12m al ebda") or a message that is
 * only a name next to a handwritten photo ("Nuqoosh") name the customer; the group is not one customer. '' when none is named.
 * [messages]: { text, hasImage }.
 */
export function customerFromMessages(messages, parseLines) {
  const photo = messages.some((m) => m.hasImage);
  for (const m of [...messages].reverse()) {
    const text = String(m.text || '').trim();
    if (!text) continue;
    const named = parseLines(text).find((l) => l.customer);
    if (named) return named.customer;
    if (photo && !/\d/.test(text)) { const bare = tailName(text); if (bare) return bare; }
  }
  return '';
}

// "Zena" / "زينه" is the company manager's first name, used in a friendly way to call her ("Zena, is it available?").
// It is an attention word: never a code, a colour or a customer.
const ZENA = '(?:zen+a+h?|zeina+h?|zaina+b?|zeyna+h?|زين[ةه]|زینه|زينب|زینب)';
const ZENA_WORD = new RegExp(`(^|[\\s,،:;!؟?.(])${ZENA}(?=$|[\\s,،:;!؟?.)])`, 'giu');

/** The line without the attention word. */
export const dropAttention = (line) => String(line || '').replace(ZENA_WORD, '$1').replace(/^[\s,،:;!]+/u, '').replace(/\s+/g, ' ').trim();

/** A message that is only a call for an answer: "?", "??", "Zena", "زينه ؟". It says someone is waiting. */
export const isNudge = (text) => {
  const s = dropAttention(String(text || '')).replace(/[\s?؟!.،,]+/g, '');
  return String(text || '').trim() !== '' && s === '';
};

// The language of everything she WRITES in WhatsApp: one switch, REPLY_LANGUAGE (en by default, fa to go back). Her fixed sentences were written in
// Persian; in English mode every outgoing text that still holds a Persian or Arabic letter is turned into English right before it is sent:
// first by the line table (english.js), then, for what the table does not know, by one small model call per message (kept in a short memory so a
// repeated sentence costs nothing). What the table or the model cannot do is sent as it is, never dropped. Text the person said (the transcript
// after «Heard:») is quoted, not translated. Inputs are understood in every language exactly as before.

import { toEnglish } from './english.js';

const state = { lang: 'en' };
export const setOutLang = (lang) => { state.lang = lang === 'fa' ? 'fa' : 'en'; };
export const outLang = () => state.lang;
export const isEnglishOut = () => state.lang === 'en';

const LETTER = /[؀-ۿ]/;
const PERSIAN_DIGITS = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').replace(/،/g, ',').replace(/؛/g, ';').replace(/؟/g, '?');
const QUOTED = /^\s*(?:🤖\s*)?(?:Heard:|Persian name:)/; // what the person said, and the Persian spellings of customer names, are data
const memory = new Map();

/**
 * [text] in English. [viaModel](chunk) -> the translated chunk (same lines, same order). Resolves to the text unchanged when nothing needs doing
 * or when the model fails.
 */
export async function englishOut(text, viaModel) {
  const first = toEnglish(String(text ?? ''));
  if (!LETTER.test(first)) return first;
  const lines = first.split('\n');
  const idx = lines.map((l, i) => (LETTER.test(l) && !QUOTED.test(l) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return first;
  const chunk = idx.map((i) => PERSIAN_DIGITS(lines[i])).join('\n');
  let done = memory.get(chunk);
  if (done === undefined) {
    try { done = String(await viaModel(chunk) || ''); } catch { done = ''; }
    const back = done.split('\n');
    if (back.length !== idx.length) {
      if (idx.length === 1 && done.trim()) done = done.trim().replace(/\n+/g, ' '); // one line asked: one line back
      else done = '';
    }
    if (done) { memory.set(chunk, done); if (memory.size > 300) memory.delete(memory.keys().next().value); }
  }
  if (!done) return first;
  const back = done.split('\n');
  idx.forEach((i, k) => { lines[i] = back[k] ?? lines[i]; });
  return lines.join('\n');
}

export const TRANSLATE_SYSTEM = `You translate short WhatsApp messages of a company assistant from Persian (or Arabic) into plain, natural English. Rules:
- Return exactly the same number of lines, in the same order, one output line per input line. No extra text, no quotes, no explanation.
- Keep every number, price, code, id (like #Q8, #S3, #N1), product code, customer name, company name, file name, emoji, bullet and symbol exactly as written.
- Keep WhatsApp formatting (*bold*, _italic_). Keep line-leading numbers and bullets.
- A phrase in «guillemets» that is a command the person types (for example «بله #Q8», «نه #Q8») becomes the English command in quotes: "yes #Q8", "no #Q8". «بله همه» is "yes all".
- Money is written with its currency code, for example 504.00 AED. Dates like «8 Nov 2026» stay in that form; a Persian-calendar date is written as its Persian-calendar day and month name in English letters.
- The assistant speaks in the first person as a woman and is polite and short.`;

export const _memorySize = () => memory.size;

// A numbered question the assistant just asked («چند مشتری … ۱. … ۲. …») waits for its answer for 30 minutes, kept on disk so a restart does not lose it. The
// next message of the same person is the choice if it is a number («1», «۱», «یک», «اولی», «شماره یک», «شماره یک درست است», «۱ درست است») or the name itself
// («Al afeef kitchen»); such an answer never goes to the general model or to the stock flow while the choice is waiting.

import fs from 'node:fs';
import path from 'node:path';
import { looseKey, looseWords } from './namekey.js';

const TTL_MS = 30 * 60 * 1000;
const DIGITS = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const ORD = { 1: ['یک', 'یکم', 'اول', 'اولی', 'یکمی', 'one', 'first', '1st'], 2: ['دو', 'دوم', 'دومی', 'two', 'second', '2nd'], 3: ['سه', 'سوم', 'سومی', 'three', 'third', '3rd'], 4: ['چهار', 'چهارم', 'چهارمی', 'four', 'fourth', '4th'], 5: ['پنج', 'پنجم', 'پنجمی', 'five', 'fifth', '5th'] };
const FILLER = new Set(['شماره', 'گزینه', 'درست', 'است', 'هست', 'همان', 'همین', 'آن', 'این', 'را', 'ببین', 'بفرست', 'لطفا', 'number', 'option', 'is', 'the', 'correct', 'right', 'this', 'please', 'ok', 'okay', 'بله', 'آره', 'اره', 'yes', 'اوکی', 'خب', 'خوب']);
const norm = (s) => DIGITS(String(s || '')).replace(/[‌‎‏]/g, ' ').replace(/[أإ]/g, 'ا').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[.,،؛;:!؟?)(«»"']/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The index (0-based) of the option the reply picks, or -1. A number or an ordinal word (with filler words around it) picks by position; otherwise the reply
 * is a name: the one option whose words hold all the words of the reply (case, dots and L.L.C do not matter). Two such options, or none, is no choice.
 */
export function parseChoice(text, options) {
  const t = norm(text);
  if (!t || !options?.length) return -1;
  const words = t.split(' ').filter((w) => w && !FILLER.has(w));
  if (words.length === 1) {
    const w = words[0];
    if (/^\d+$/.test(w)) { const n = Number(w); return n >= 1 && n <= options.length ? n - 1 : -1; }
    for (const [n, names] of Object.entries(ORD)) if (names.includes(w) && Number(n) <= options.length) return Number(n) - 1;
  }
  if (!words.length) return -1;
  const want = looseWords(words.join(' '));
  const hit = options.map((o, i) => ({ i, set: new Set(looseWords(o)) })).filter((o) => want.length && want.every((w) => o.set.has(w)));
  if (hit.length === 1) return hit[0].i;
  const exact = options.findIndex((o) => looseKey(o) === looseKey(words.join(' ')));
  return hit.length > 1 ? exact : (exact >= 0 ? exact : -1);
}

export class PendingChoice {
  constructor({ file = '', now = () => Date.now(), ttlMs = TTL_MS } = {}) {
    Object.assign(this, { file, now, ttlMs });
    this.d = {};
    try { if (file) this.d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
  }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  set(key, value) { this.d[key] = { ...value, at: this.now() }; this.save(); }
  get(key) { const v = this.d[key]; if (!v) return null; if (this.now() - v.at > this.ttlMs) { delete this.d[key]; this.save(); return null; } return v; }
  clear(key) { if (this.d[key]) { delete this.d[key]; this.save(); } }
}

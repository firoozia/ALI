// "Correct the assistant": a colleague replies to one of its messages with "غلط" (wrong) and the right answer. The
// correction is only stored, in a file the owner reviews. The assistant never changes its own behaviour from it; the
// owner moves good ones into kb/05-style-examples.md, which is read into every prompt.

import fs from 'node:fs';
import path from 'node:path';

const START = /^(?:غلط ہے|غلط|اشتباه|wrong|incorrect|خطأ|galat)(?![\p{L}])\s*[:,،\-–]?\s*([\s\S]*)$/iu;

/** "غلط، موجودی کافی است" -> { right: 'موجودی کافی است' }; "wrong" alone -> { right: '' }; anything else null. */
export function parseCorrection(text) {
  const m = START.exec(String(text || '').trim());
  return m ? { right: m[1].trim() } : null;
}

const file = (dir) => path.join(dir, 'corrections.jsonl');

/** Adds one line to the file. [entry]: { at, where, role, wrong, right }. Never throws. */
export function appendCorrection(dir, entry) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file(dir), `${JSON.stringify(entry)}\n`);
    return true;
  } catch { return false; }
}

/** The latest [n] corrections, newest first. */
export function readCorrections(dir, n = 5) {
  try {
    return fs.readFileSync(file(dir), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).slice(-n).reverse();
  } catch { return []; }
}

/** For the owner's command: one short line per correction. */
export function formatCorrections(list) {
  if (!list.length) return 'اصلاحی ثبت نشده است.';
  return list.map((c, i) => `${i + 1}. ${String(c.wrong).replace(/\s+/g, ' ').slice(0, 90)}\n   ⟵ ${c.right || '(پاسخ درست نوشته نشده)'}`).join('\n');
}

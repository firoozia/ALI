// Matching a short free-text answer to the options the assistant listed ("1) PVC film  2) Edge banding").
// People answer with the number, the name in Latin or Persian, or the name with a stray letter stuck to it.

import { normalizeLetters } from './text.js';

/** Other ways to name a product group, keyed by its sheet name in lower case. */
const ALIASES = {
  'pvc film': ['pvc', 'پیویسی', 'پی وی سی', 'فیلم', 'فیلم پی وی سی', 'فیلم pvc'],
  'edge banding': ['edge', 'banding', 'لبه', 'لبه چسب', 'نوار لبه', 'لبه‌چسب'],
  rail: ['ریل'], hinge: ['لولا'], glue: ['چسب'], glues: ['چسب'], hardware: ['یراق', 'یراق آلات', 'یراق‌آلات'],
};

const compact = (s) => normalizeLetters(s).replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Index of the option the [text] means, or -1. A number (1, ۲, "2)") picks by position. Otherwise the longest
 * name or alias found in the text (or containing it, for a short answer) wins; a tie between options is no match.
 */
export function matchOption(text, options) {
  const bare = normalizeLetters(text).replace(/[\s).،.:-]/g, '');
  if (/^\d{1,2}$/.test(bare)) {
    const i = Number(bare) - 1;
    return i >= 0 && i < options.length ? i : -1;
  }
  const t = compact(text);
  if (t.length < 2) return -1;
  const scores = options.map((o) => {
    const names = [o, ...(ALIASES[normalizeLetters(o).trim()] || [])].map(compact).filter(Boolean);
    let best = 0;
    for (const n of names) {
      if (t.includes(n)) best = Math.max(best, n.length);
      else if (t.length >= 3 && n.includes(t)) best = Math.max(best, t.length);
    }
    return best;
  });
  const top = Math.max(...scores);
  if (top <= 0 || scores.filter((s) => s === top).length !== 1) return -1;
  return scores.indexOf(top);
}

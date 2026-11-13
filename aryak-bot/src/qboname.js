// A name written in a group post -> the QuickBooks customer it is, so every report groups by the QuickBooks name.
// Tiers, so that two real customers with alike names stay apart (AL AFEEFI / AL AFEEF): the approved alias; the exact name (case and runs of spaces ignored); the plain customer rules
// and a doubled letter or plural; only when none of those fits, one letter wrong in every brand word (AFFEFI / AFEEFI). An answer that fits two customers is no answer: the posted name stays.
import { brandWords, nearWord } from './cutaliases.js';
import { sameCutCustomer } from './cuts.js';
import { looseKey } from './namekey.js';
import { sameBrandForm } from './expenses.js';
import { memoString } from './memo.js';

const squeeze = memoString((n) => String(n ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim());

/** One letter more or less in each brand word, in order (AHALIA / AHLIA): a weaker match, used only when nothing stronger fits. */
export const nearBrand = (a, b) => { const x = brandWords(a); const y = brandWords(b); return x.length > 0 && x.length === y.length && x.every((w, i) => nearWord(w, y[i])); };

/** The letters only, a doubled letter as one («AL AFFEFI KITCHEN» and «ALAFEEFI KITCHEN» are the same letters; «AL AFEEF KITCHEN» is not). */
const letters = memoString((n) => looseKey(n).replace(/[^a-z0-9\u0600-\u06ff]/g, '').replace(/(.)\1+/g, '$1'));

/** A post name without what is not the name: «(IBN AJMI)», «— ARYAK», «BD REPAIRED», a trailing number. */
const tidy = (n) => String(n).replace(/\(.*?\)/g, ' ').replace(/[—–-]\s*ARYAK\b.*$/i, ' ').replace(/\b(?:BD|B\.D|REPAIR\w*|RETURN\w*|REPLACE\w*|FREE|SAMPLE\w*|EXTRA|OK)\b.*$/i, ' ').replace(/\s+\d+\s*$/, ' ').replace(/\s+/g, ' ').trim();

/** The exact QuickBooks name, or '' when the posted name fits none of them or more than one. */
export function qboNameFor(post, names, aliasOf = () => '') {
  const direct = qboNameOnce(post, names, aliasOf);
  if (direct) return direct;
  const clean = tidy(post || '');
  return clean && clean !== post ? qboNameOnce(clean, names, aliasOf) : '';
}

const STOP = new Set(['al', 'el', 'the', 'and', 'llc', 'l', 'c', 'trading', 'co', 'company', 'est', 'fze', 'fzco', 'ind', 'ltd', 'of', 'for']);
const GENERIC = new Set(['kitchen', 'kitchens', 'door', 'doors', 'wood', 'works', 'work', 'design', 'designs', 'furniture', 'carpentry', 'group', 'industries', 'industrial', 'international', 'intl', 'general', 'contracting']); // words a poster may add or drop: never decisive on their own
const subseq = (w, c) => { let i = 0; for (const ch of c) if (ch === w[i]) i += 1; return i === w.length; };
const lcs = (a, b) => { const m = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0)); for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = a[i - 1] === b[j - 1] ? m[i - 1][j - 1] + 1 : Math.max(m[i - 1][j], m[i][j - 1]); return m[a.length][b.length]; };
const lev1 = (a, b) => { if (Math.abs(a.length - b.length) > 1) return false; let i = 0; let j = 0; let miss = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; } else { miss++; if (miss > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } } } return miss + (a.length - i) + (b.length - j) <= 1; };
/** Does the name as TYPED fit the customer, word by word? «Al masar» fits «AL MASAR AL SAI», never «MASTER WOOD»: each significant typed word must be (the start of, the end of, one letter away from, or inside) a word of the customer. */
export function typedFitsName(typed, candidate) {
  const words = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const significant = words(typed).filter((w) => !STOP.has(w) && !/^\d+$/.test(w));
  const decisive = significant.filter((w) => !GENERIC.has(w));
  const mine = decisive.length ? decisive : significant; // «Nova kitchens ind»: «kitchens» is not decisive, «nova» and «ind» are
  if (!mine.length) return true;
  const theirs = words(candidate); const glued = theirs.join('');
  return mine.every((w) => theirs.some((c) => c === w || (w.length >= 3 && c.length >= 3 && (c.startsWith(w) || c.endsWith(w) || w.startsWith(c) || w.endsWith(c))) || (w.length >= 5 && c.length >= 5 && lev1(w, c)) || (w.length >= 3 && c.length > w.length && w[0] === c[0] && subseq(w, c)) || (w.length >= 6 && c.length >= 6 && lcs(w, c) / Math.min(w.length, c.length) >= 0.8)) || (w.length >= 4 && glued.includes(w)));
}

function qboNameOnce(post, names, aliasOf) {
  if (!post || !names.length) return '';
  const told = aliasOf(post);
  if (told) return names.find((q) => squeeze(q) === squeeze(told)) || told;
  const exact = names.find((q) => q === post) || names.find((q) => squeeze(q) === squeeze(post));
  if (exact) return exact;
  const strong = names.filter((q) => (sameCutCustomer(post, q) || sameBrandForm(post, q) || (letters(post).length >= 6 && letters(post) === letters(q))) && typedFitsName(post, q));
  if (strong.length === 1) return strong[0];
  if (strong.length > 1) { const same = strong.filter((q) => looseKey(q) === looseKey(post)); return same.length === 1 ? same[0] : ''; }
  const near = names.filter((q) => nearBrand(post, q) && typedFitsName(post, q));
  return near.length === 1 ? near[0] : '';
}

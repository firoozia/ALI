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

function qboNameOnce(post, names, aliasOf) {
  if (!post || !names.length) return '';
  const told = aliasOf(post);
  if (told) return names.find((q) => squeeze(q) === squeeze(told)) || told;
  const exact = names.find((q) => q === post) || names.find((q) => squeeze(q) === squeeze(post));
  if (exact) return exact;
  const strong = names.filter((q) => sameCutCustomer(post, q) || sameBrandForm(post, q) || (letters(post).length >= 6 && letters(post) === letters(q)));
  if (strong.length === 1) return strong[0];
  if (strong.length > 1) { const same = strong.filter((q) => looseKey(q) === looseKey(post)); return same.length === 1 ? same[0] : ''; }
  const near = names.filter((q) => nearBrand(post, q));
  return near.length === 1 ? near[0] : '';
}

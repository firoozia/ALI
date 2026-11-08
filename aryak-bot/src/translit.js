// A customer said aloud in Persian ("پالم برد") against names written in Latin in QuickBooks ("PALM BIRD TRADING LLC"). Both are reduced to a SKELETON of
// consonant classes (vowels dropped, letters that sound alike merged), and the names are ranked by how well the spoken words fit the words of each name.
// It only ranks; a single clear winner is used, several are asked about, none gives the nearest three. Nothing is guessed silently.

const PERSIAN = {
  ب: 'b', پ: 'p', ت: 't', ط: 't', د: 't', ث: 's', س: 's', ص: 's', ذ: 's', ز: 's', ض: 's', ظ: 's', ج: 'j', چ: 'j', ژ: 'j', ش: 'j', ح: 'h', ه: 'h', خ: 'h',
  ر: 'r', ل: 'l', م: 'm', ن: 'n', ف: 'f', و: 'f', ق: 'k', ک: 'k', گ: 'k', غ: 'k', ع: '', ء: '', ئ: '', ی: '', ا: '', آ: '', ة: 'h', ك: 'k', ي: '',
};
const LATIN = { b: 'b', p: 'p', t: 't', d: 't', c: 'k', k: 'k', q: 'k', g: 'k', x: 'ks', s: 's', z: 's', j: 'j', h: 'h', r: 'r', l: 'l', m: 'm', n: 'n', f: 'f', v: 'f', w: 'f' };
const NOISE = new Set(['llc', 'l', 'c', 'ltd', 'co', 'company', 'trading', 'tr', 'ind', 'industries', 'industrial', 'est', 'establishment', 'fze', 'fzco', 'general', 'the', 'and', 'of', 'شرکت', 'موسسه', 'مؤسسه', 'تجارت', 'بازرگانی', 'صنعتی', 'کارخانه']);

const clean = (s) => String(s || '').normalize('NFKC').replace(/[‌‎‏]/g, ' ').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** One word to its consonant skeleton ("پالم" and "palm" both give "plm"; "برد" and "bird" both give "brt"). */
export function skeleton(word) {
  const w = clean(word).replace(/\s+/g, '');
  if (!w) return '';
  let out = '';
  if (/[a-z]/.test(w)) {
    const t = w.replace(/ph/g, 'f').replace(/kh/g, 'h').replace(/ch/g, 'j').replace(/sh/g, 'j').replace(/th/g, 't').replace(/gh/g, 'k').replace(/ck/g, 'k').replace(/(.)\1+/g, '$1');
    for (const ch of t) out += LATIN[ch] ?? '';
  } else {
    for (const ch of w) out += PERSIAN[ch] ?? '';
    out = out.replace(/(.)\1+/g, '$1');
  }
  return out;
}

function lev(a, b) {
  const m = a.length; const n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
/** 1 for equal skeletons, 0 for nothing alike. */
export const sim = (a, b) => (!a || !b ? 0 : 1 - lev(a, b) / Math.max(a.length, b.length));

const tokensOf = (s) => clean(s).split(' ').filter((t) => t && !NOISE.has(t));

/**
 * How well the spoken words fit one name: every spoken word is matched to its best word in the name (or to two joined words: "بردپالم"); the score is the
 * mean, lowered a little for each word of the name that was not spoken (a name with TRADING LLC after it is still the same company).
 */
export function scoreName(spoken, name) {
  const st = tokensOf(spoken).map(skeleton).filter(Boolean);
  const nt = tokensOf(name).map(skeleton).filter(Boolean);
  if (!st.length || !nt.length) return 0;
  const joined = nt.length > 1 ? [nt.join(''), ...nt.slice(0, -1).map((t, i) => t + nt[i + 1])] : [];
  let total = 0;
  for (const s of st) total += Math.max(...nt.map((t) => sim(s, t)), ...joined.map((t) => sim(s, t) * 0.97));
  let score = total / st.length;
  const extra = Math.max(0, nt.length - st.length);
  score *= 1 - Math.min(0.2, extra * 0.05);
  if (st.length > nt.length) score *= 0.85; // more words spoken than the name has
  return score;
}

/** The names ranked for a spoken name: [{ name, score }] best first. [names]: strings, or { name, alts: [] } (the best of the alternatives counts). */
export function rankNames(spoken, names) {
  const ranked = (names || []).map((n) => {
    const all = typeof n === 'string' ? [n] : [n.name, ...(n.alts || [])].filter(Boolean);
    return { name: typeof n === 'string' ? n : n.name, key: n, score: Math.max(0, ...all.map((x) => scoreName(spoken, x))) };
  }).filter((r) => r.name);
  return ranked.sort((a, b) => b.score - a.score);
}

/**
 * Decides: { kind: 'one', best } when one name clearly fits; { kind: 'many', candidates } when several fit about equally; { kind: 'none', nearest: [3] } otherwise.
 * [strong]: a score from which a name counts; [gap]: how far the winner must lead.
 */
export function pickSpoken(spoken, names, { strong = 0.72, gap = 0.12 } = {}) {
  const ranked = rankNames(spoken, names);
  const fits = ranked.filter((r) => r.score >= strong);
  if (fits.length === 1 || (fits.length > 1 && fits[0].score - fits[1].score >= gap)) return { kind: 'one', best: fits[0], ranked };
  if (fits.length > 1) return { kind: 'many', candidates: fits.slice(0, 5), ranked };
  return { kind: 'none', nearest: ranked.slice(0, 3), ranked };
}

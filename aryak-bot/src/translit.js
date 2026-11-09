// A customer said aloud in Persian ("پالم برد") against names written in Latin in QuickBooks ("PALM BIRD TRADING LLC"). Both are reduced to a SKELETON of
// consonant classes (vowels dropped, letters that sound alike merged), and the names are ranked by how well the spoken words fit the words of each name.
// It only ranks; a single clear winner is used, several are asked about, none gives the nearest three. Nothing is guessed silently.

const PERSIAN = {
  ب: 'b', پ: 'p', ت: 't', ط: 't', د: 't', ث: 's', س: 's', ص: 's', ذ: 's', ز: 's', ض: 's', ظ: 's', ج: 'j', چ: 'j', ژ: 'j', ش: 'j', ح: 'h', ه: 'h', خ: 'h',
  ر: 'r', ل: 'l', م: 'm', ن: 'n', ف: 'f', و: 'f', ق: 'k', ک: 'k', گ: 'k', غ: 'k', ع: '', ء: '', ئ: '', ی: '', ا: '', آ: '', ة: 'h', ك: 'k', ي: '',
};
const LATIN = { b: 'b', p: 'p', t: 't', d: 't', c: 'k', k: 'k', q: 'k', g: 'k', x: 'ks', s: 's', z: 's', j: 'j', h: 'h', r: 'r', l: 'l', m: 'm', n: 'n', f: 'f', v: 'f', w: 'f' };
const NOISE = new Set(['llc', 'l', 'c', 'ltd', 'co', 'company', 'trading', 'tr', 'trd', 'trdg', 'ind', 'industries', 'industrial', 'est', 'establishment', 'fze', 'fzco', 'general', 'the', 'and', 'of', 'شرکت', 'موسسه', 'مؤسسه', 'تجارت', 'بازرگانی', 'صنعتی', 'کارخانه']);

const clean = (s) => String(s || '').normalize('NFKC').replace(/[‌‎‏]/g, ' ').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** One word to its consonant skeleton ("پالم" and "palm" both give "plm"; "برد" and "bird" both give "brt"). */
export function skeleton(word) {
  const w = clean(word).replace(/\s+/g, '');
  if (!w) return '';
  let out = '';
  if (/[a-z]/.test(w)) {
    const t = w.replace(/ph/g, 'f').replace(/kh/g, 'h').replace(/ch/g, 'j').replace(/sh/g, 'j').replace(/th/g, 't').replace(/gh/g, 'k').replace(/ck/g, 'k').replace(/(.)\1+/g, '$1');
    for (const ch of t) out += LATIN[ch] ?? '';
    out = out.replace(/(.)\1+/g, '$1'); // doubled sounds after the vowels are gone (HRAYER = h-r-r -> h-r, like the Persian spelling)
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

const SUN = new Set([...'تثدذرزسشصضطظلن']);
/** The words of a name without the noise words; a standalone Arabic article («ال راد») is joined to the word after it («الراد»). */
const tokensOf = (s) => {
  const raw = clean(s).split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === 'ال' && raw[i + 1]) { out.push(`ال${raw[i + 1]}`); i += 1; } else out.push(raw[i]);
  }
  return out.filter((t) => t && !NOISE.has(t));
};

/**
 * The skeletons a spoken word can stand for. Persian «ال» + a sun letter is spoken as the letter («الراد» = AR-RAD, «الشباب» = ASH-SHABAB): besides the plain
 * skeleton there is one with the article dropped and the first sound doubled (the Latin side joins «AR» + «RAD» to the same).
 */
export function skeletonVariants(word) {
  const plain = skeleton(word);
  const w = clean(word).replace(/\s+/g, '');
  if (/[a-z]/.test(w) || !w.startsWith('ال') || w.length < 4 || !SUN.has(w[2])) return [plain];
  const rest = skeleton(w.slice(2));
  return rest ? [plain, rest[0] + rest] : [plain];
}

/**
 * How well the spoken words fit one name: every spoken word is matched to its best word in the name (or to two joined words: "بردپالم"); the score is the
 * mean, lowered a little for each word of the name that was not spoken (a name with TRADING LLC after it is still the same company).
 */
export function scoreName(spoken, name) { return scoreDetail(spoken, name).score; }

/** { score, raw }: [raw] is the match of the spoken words before the penalty for the words of the name that were not spoken (1 = every spoken word fits a word of the name exactly). */
export function scoreDetail(spoken, name) {
  const spokenWords = tokensOf(spoken).filter((t) => skeleton(t));
  const nt = tokensOf(name).map(skeleton).filter(Boolean);
  if (!spokenWords.length || !nt.length) return { score: 0, raw: 0 };
  const used = new Set();
  let total = 0;
  for (const word of spokenWords) { // every spoken word takes its best word of the name (or two joined: «بردپالم», «AR»+«RAD»); a word of the name is used once
    const variants = skeletonVariants(word);
    let best = 0; let take = [];
    nt.forEach((t, i) => { if (!used.has(i)) for (const v of variants) { const sc = sim(v, t); if (sc > best) { best = sc; take = [i]; } } });
    for (let i = 0; i < nt.length - 1; i += 1) {
      if (used.has(i) || used.has(i + 1)) continue;
      for (const v of variants) { const sc = sim(v, nt[i] + nt[i + 1]) * 0.97; if (sc > best) { best = sc; take = [i, i + 1]; } }
    }
    if (nt.length > 2 && !used.size) for (const v of variants) { const sc = sim(v, nt.join('')) * 0.97; if (sc > best) { best = sc; take = nt.map((_, i) => i); } }
    take.forEach((i) => used.add(i));
    total += best;
  }
  const raw = total / spokenWords.length;
  let score = raw;
  const extra = Math.max(0, nt.length - spokenWords.length);
  score *= 1 - Math.min(0.2, extra * 0.05);
  if (spokenWords.length > nt.length) score *= 0.85; // more words spoken than the name has
  return { score, raw };
}

/** The names ranked for a spoken name: [{ name, score }] best first. [names]: strings, or { name, alts: [] } (the best of the alternatives counts). */
export function rankNames(spoken, names) {
  const ranked = (names || []).map((n) => {
    const all = typeof n === 'string' ? [n] : [n.name, ...(n.alts || [])].filter(Boolean);
    const best = all.map((x) => scoreDetail(spoken, x)).sort((a, b) => b.score - a.score)[0] || { score: 0, raw: 0 };
    return { name: typeof n === 'string' ? n : n.name, key: n, score: Math.max(0, best.score), raw: best.raw };
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
  // one name fits every spoken word EXACTLY (AR + RAD) and no other does: it wins, even if a longer name is still fairly close
  if (fits.length > 1 && fits[0].raw >= 0.96 && fits[1].raw < 0.96) return { kind: 'one', best: fits[0], ranked };
  if (fits.length === 1 || (fits.length > 1 && fits[0].score - fits[1].score >= gap)) return { kind: 'one', best: fits[0], ranked };
  if (fits.length > 1) return { kind: 'many', candidates: fits.slice(0, 5), ranked };
  return { kind: 'none', nearest: ranked.slice(0, 3), ranked };
}

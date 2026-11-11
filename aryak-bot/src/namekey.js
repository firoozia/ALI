// One way to compare names of customers and items: "MICE INTERIORS DECORATION L.L.C", "Mice Interiors Decoration LLC", "L L C" and "llc." are the same. Case, dots,
// commas, hyphens, underscores, an ampersand and extra spaces do not matter, and a run of single Latin letters ("L L C", "L.L.C") is one word. Words such as
// CO, TRADING or FZE stay words. This key is only for comparing; stored keys elsewhere are not changed.

const keyMemo = new Map(); // a pure function called very often on the same few hundred names
export function looseKey(name) {
  const memo = String(name ?? '');
  if (keyMemo.has(memo)) return keyMemo.get(memo);
  const made = looseKeyOnce(name);
  if (keyMemo.size > 20000) keyMemo.clear();
  keyMemo.set(memo, made);
  return made;
}

function looseKeyOnce(name) {
  let s = String(name ?? '').normalize('NFKC').toLowerCase().replace(/&/g, ' and ');
  s = s.replace(/(?<![\p{L}\p{N}])((?:[a-z]\.)+[a-z]?)(?![\p{L}\p{N}])/gu, (m) => m.replace(/\./g, '')); // L.L.C -> LLC
  s = s.replace(/[.,;:_\-–—()'"`/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
  const out = [];
  let run = '';
  for (const tok of s.split(' ').filter(Boolean)) {
    if (/^[a-z]$/.test(tok)) { run += tok; continue; }
    if (run) { out.push(run); run = ''; }
    out.push(tok);
  }
  if (run) out.push(run);
  return out.join(' ');
}

/** The words of a loose key. */
const wordsMemo = new Map();
export const looseWords = (name) => { const k = String(name ?? ''); if (!wordsMemo.has(k)) { if (wordsMemo.size > 20000) wordsMemo.clear(); wordsMemo.set(k, looseKey(name).split(' ').filter(Boolean)); } return wordsMemo.get(k); }; // a shared array: callers only read it

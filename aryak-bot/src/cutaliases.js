// The names the cutting and delivery groups use for a customer are not always the QuickBooks name («HAMID TRD» for HAMED TRADING, «AR RAD» for AR-RAD INTERNATIONAL…). From the
// history of the posts, a list of PROPOSED aliases is made for the owner; only what he approves with his YES is used by the cross-check and the evening report. Kept on the
// server only (never in the repository). Nothing here writes to QuickBooks or to any group.

import fs from 'node:fs';
import path from 'node:path';
import { rankNames } from './translit.js';
import { nameKey } from './customergroups.js';
import { GENERIC, sameCutCustomer } from './cuts.js';

const DAY = 24 * 3600 * 1000;

/**
 * [postNames]: the names written in the posts, [qboNames]: the QuickBooks customers. A proposal is a post name that no QuickBooks customer already matches by the plain rules
 * (sameCutCustomer) and that one customer fits clearly by sound and spelling. [skip](key) -> true for a name already settled. Returns [{ post, qbo, score }].
 */
/** The words that say WHICH company (not what it does or where): «AILA WOOD PRESSING» -> aila, pressing. */
export const brandWords = (name) => nameKey(name).split(/\s+/).filter((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w));
/** One letter wrong, missing, extra or swapped (Aila / Alia, Hamid / Hamed, Wahadan / Wahdan). */
export function nearWord(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 3) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length] <= 1;
}
export const sameBrand = (post, qbo) => { const pw = brandWords(post); const qw = brandWords(qbo); return pw.some((w) => qw.some((v) => nearWord(w, v))); };

export function proposeAliases({ postNames, qboNames, skip = () => false, exclude = () => false }) {
  const out = []; const seen = new Set();
  for (const post of postNames) {
    const key = nameKey(post);
    if (!key || seen.has(key) || skip(key) || exclude(post)) continue;
    seen.add(key);
    if (qboNames.some((q) => sameCutCustomer(post, q))) continue; // already the same customer by the plain rules: no alias needed
    const ranked = rankNames(post, qboNames);
    let close = ranked.filter((x) => x.score >= 0.8 && ranked[0].score - x.score < 0.1);
    // the brand word decides: a customer whose brand word is the post's (one letter off) beats one that only shares generic words (a different brand is never proposed)
    if (brandWords(post).length) { const same = close.filter((x) => sameBrand(post, x.name)); close = same.length ? same : ranked.filter((x) => x.score >= 0.8 && sameBrand(post, x.name)); }
    if (!close.length) continue;
    const edit = (x) => { const a = nameKey(post); const b = nameKey(x.name); const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
    const byEdit = [...close].sort((x, y) => edit(x) - edit(y));
    if (byEdit.length > 1 && edit(byEdit[0]) === edit(byEdit[1])) continue; // two names equally near: not guessed
    out.push({ post, qbo: byEdit[0].name, score: Math.round(byEdit[0].score * 100) });
  }
  return out;
}

export class CutAliases {
  constructor(dir = '', now = () => Date.now()) {
    this.file = dir ? path.join(dir, 'qbo-cut-aliases.json') : ''; this.now = now;
    this.d = { approved: {}, declined: [], proposals: {}, n: 0 };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ }
  }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  /** The QuickBooks name an approved alias stands for, or ''. */
  resolve(name) { return this.d.approved[nameKey(name)]?.qbo || ''; }
  settled(key) { return !!this.d.approved[key] || this.d.declined.includes(key); }
  list() { return Object.values(this.d.approved); }

  /** A new proposal (id A1, A2 …) from [pairs]; replaces nothing. */
  propose(pairs) {
    this.d.n += 1; const id = `A${this.d.n}`;
    this.d.proposals[id] = { id, pairs, status: 'pending', at: this.now() };
    this.save(); return this.d.proposals[id];
  }
  get(id) { const p = this.d.proposals[String(id).toUpperCase()]; if (!p) return null; if (p.status === 'pending' && this.now() - p.at > DAY) { p.status = 'expired'; this.save(); } return p; }
  openIds() { return Object.values(this.d.proposals).filter((p) => p.status === 'pending' && this.now() - p.at <= DAY).map((p) => p.id); }
  drop(id, numbers) { const p = this.get(id); if (!p || p.status !== 'pending') return 0; const drop = new Set(numbers.map(Number)); const before = p.pairs.length; p.pairs = p.pairs.filter((_, i) => !drop.has(i + 1)); this.save(); return before - p.pairs.length; }
  /** The owner's yes: every pair of the proposal becomes an alias; his no: they are remembered as declined and never proposed again. */
  decide(id, verb) {
    const p = this.get(id);
    if (!p) return { error: 'not found' };
    if (p.status !== 'pending') return { error: p.status };
    for (const pair of p.pairs) {
      const key = nameKey(pair.post);
      if (verb === 'yes') this.d.approved[key] = { post: pair.post, qbo: pair.qbo, at: this.now() }; else if (!this.d.declined.includes(key)) this.d.declined.push(key);
    }
    p.status = verb === 'yes' ? 'approved' : 'declined'; this.save();
    return { count: p.pairs.length };
  }
}

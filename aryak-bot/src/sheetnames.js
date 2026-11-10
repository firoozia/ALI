// The customer names of the ZINAX stock sheet, made EXACTLY the QuickBooks customer names (owner's explicit exception, 2026-11-10).
// Where they live: the Customers tab (column Name) and the Movements tab (column Customer) of the outgoing rows (OUT and CUT). Nothing else is ever read as a name or written.
// Three steps, all started by the owner in his own chat: a preview (read only), then «yes #H1» = a full backup copy of the sheet FIRST, then only those name cells, logged for «undo names #H1».
import fs from 'node:fs';
import path from 'node:path';
import { askSheet } from './stock.js';
import { sameCutCustomer } from './cuts.js';
import { looseKey } from './namekey.js';
import { sameBrandForm } from './expenses.js';
import { brandWords, nearWord } from './cutaliases.js';
import { SEP } from './separator.js';

const BATCH = 100; // cells per request (the sheet's own limit is 200)
const key = (n) => looseKey(n);
const squeeze = (n) => String(n ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** The QuickBooks name the owner typed: found with case and runs of spaces ignored on BOTH sides (WhatsApp squeezes spaces, QuickBooks may hold two); the name returned is the EXACT QuickBooks one. */
export function findQboName(qboNames, typed) {
  const t = squeeze(typed);
  return qboNames.find((n) => n === typed) || qboNames.find((n) => squeeze(n) === t) || '';
}

/** One letter more or less in each brand word, in order (AHALIA / AHLIA): a weaker match, used only when nothing stronger fits. */
const nearBrand = (a, b) => { const x = brandWords(a); const y = brandWords(b); return x.length > 0 && x.length === y.length && x.every((w, i) => nearWord(w, y[i])); };
const day = (ms) => new Date(ms + 4 * 3600 * 1000).toISOString().slice(0, 10);

/** The sheet's names as [{ tab, column, name, rows }] and the QuickBooks names as [string] -> { same, rename, unclear } (the cells of a rename are kept for the apply). */
export function planSheetNames({ sheetNames, qboNames, aliasOf = () => '', overrides = {}, leave = {} }) {
  const exact = new Set(qboNames);
  const byName = new Map();
  for (const e of sheetNames) {
    const g = byName.get(e.name) || { name: e.name, uses: [], rows: 0 };
    g.uses.push({ tab: e.tab, column: e.column, rows: e.rows }); g.rows += e.rows.length; byName.set(e.name, g);
  }
  const out = { same: [], rename: [], unclear: [], left: [] };
  for (const g of byName.values()) {
    if (exact.has(g.name)) { out.same.push(g); continue; }
    if (leave[key(g.name)]) { out.left.push(g); continue; } // the owner said: leave it as it is
    const told = overrides[key(g.name)];
    let candidates;
    if (told && exact.has(told)) candidates = [told];
    else {
      const all = qboNames.filter((q) => key(q) === key(g.name) || sameCutCustomer(g.name, q) || (!!aliasOf(g.name) && sameCutCustomer(aliasOf(g.name), q)) || sameBrandForm(g.name, q));
      const same = all.filter((q) => key(q) === key(g.name)); // one that differs only in case, spaces or punctuation beats the looser ones
      candidates = same.length === 1 ? same : all;
      if (!candidates.length) candidates = qboNames.filter((q) => nearBrand(g.name, q)); // only when nothing stronger fits
    }
    if (candidates.length === 1) out.rename.push({ ...g, to: candidates[0] }); else out.unclear.push({ ...g, candidates: candidates.slice(0, 4) });
  }
  const byRows = (a, b) => b.rows - a.rows || (a.name < b.name ? -1 : 1);
  out.rename.sort(byRows); out.unclear.sort(byRows);
  return out;
}

const rowsWord = (n) => `${n} row${n === 1 ? '' : 's'}`;
const tabsLine = (uses) => uses.map((u) => `${u.tab}: ${u.rows.length}`).join(', ');

/** The owner's preview: counts, one line per rename, one per unclear name with its candidates, and how to answer. */
export function sheetPreviewText(plan, id, { namesIn = [] } = {}) {
  const head = `*Sheet customer names → QuickBooks* (preview #${id})${namesIn.length ? `\nRead: ${namesIn.join('; ')}` : ''}`;
  const same = `✔ already identical: ${plan.same.length}`;
  const rename = plan.rename.length ? `✎ will rename (${plan.rename.length}):\n${plan.rename.map((r, i) => `${i + 1}. ${r.name} → ${r.to} (${rowsWord(r.rows)}; ${tabsLine(r.uses)})`).join('\n')}` : '✎ nothing to rename.';
  const unclear = plan.unclear.length ? `❓ unclear (${plan.unclear.length}), never changed until you tell me the right name:\n${plan.unclear.map((r, i) => `${i + 1}. ${r.name} (${rowsWord(r.rows)}) — ${r.candidates.length ? `candidates: ${r.candidates.join(' | ')}` : 'no QuickBooks customer fits'}`).join('\n')}\nTell me the right name: name ${plan.unclear[0].name} → <QuickBooks name>` : '';
  const left = plan.left?.length ? `↷ left as is by you (${plan.left.length}): ${plan.left.map((g) => g.name).join(', ')}` : '';
  const ask = plan.rename.length ? `Reply yes #${id} to rename the ✎ names only (a backup copy of the sheet is made first), or no #${id}.` : 'Nothing to apply.';
  return [`${head}\n${same}`, rename, unclear, left, ask].filter(Boolean).join(`\n${SEP}\n`);
}

/** The cells of the ✎ names: [{ tab, row, old, new }]. */
export const cellsOf = (plan) => plan.rename.flatMap((r) => r.uses.flatMap((u) => u.rows.map((row) => ({ tab: u.tab, row, old: r.name, new: r.to }))));

/** One request to the Apps Script web app's names action (the bot token; the script refuses a write unless the owner switched it on there). */
export async function sheetCall(config, payload, fetchImpl = fetch, opts = {}) {
  return askSheet(config, JSON.stringify({ action: 'botNames', token: config.botToken, ...payload }), `sheet names ${payload.mode}`, fetchImpl, { tries: 2, timeoutMs: [60000, 60000], ...opts });
}

/** The words for a refusal of the sheet, with what the owner must do. */
export function sheetProblem(e) {
  const m = String(e?.message || e);
  if (/Unknown action/i.test(m)) return "The sheet's script does not know this action yet: paste the new Code.gs into Apps Script and deploy a NEW version of the web app (Deploy > Manage deployments > edit > New version).";
  if (/Name changes are off/i.test(m)) return "Name changes are switched off in the sheet's script: in Apps Script > Project Settings > Script properties add ZINAX_NAMES_WRITE = on, then say yes again (remove the property when done). Nothing was changed.";
  return `The sheet answered: ${m}`;
}

/** The memory of this feature: the number of previews, the names the owner told, and the log of every changed cell (for the undo). Only on the server. */
export class SheetNameStore {
  constructor(dir = '') {
    this.file = dir ? path.join(dir, 'sheet-names.json') : '';
    this.d = { n: 0, overrides: {}, runs: {} };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* new */ }
  }

  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  nextId() { this.d.n += 1; this.save(); return `H${this.d.n}`; }
  tell(oldName, to) { this.d.overrides[key(oldName)] = to; delete (this.d.leave ||= {})[key(oldName)]; this.save(); }
  leaveAlone(oldName) { (this.d.leave ||= {})[key(oldName)] = true; delete this.d.overrides[key(oldName)]; this.save(); }
  openRun(id, at, backup) { this.d.runs[id] = { id, at, backup, applied: [], undone: false }; this.save(); return this.d.runs[id]; }
  logApplied(id, cells) { this.d.runs[id].applied.push(...cells); this.save(); }
  run(id) { return this.d.runs[String(id).toUpperCase()] || null; }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

/** Applies [cells] in paced batches. [onApplied](cells) is called after each batch with the cells that really changed; returns { applied, skipped }. */
export async function applyCells(config, cells, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch; const gapMs = opts.gapMs ?? 1500; const wait = opts.sleep || pause; const report = opts.onApplied || (() => {});
  let applied = 0; const skipped = [];
  for (const [i, batch] of chunks(cells, BATCH).entries()) {
    if (i) await wait(gapMs);
    const res = await sheetCall(config, { mode: 'apply', cells: batch }, fetchImpl);
    const done = new Set((res.applied || []).map((a) => `${a.tab}#${a.row}`));
    const changed = batch.filter((c) => done.has(`${c.tab}#${c.row}`));
    applied += changed.length; skipped.push(...(res.skipped || []));
    report(changed);
  }
  return { applied, skipped };
}

export const backupName = (now = Date.now()) => `ZINAX stock backup ${day(now)} before names`;

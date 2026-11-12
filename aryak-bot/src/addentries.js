// The owner enters items the bot never saw (posted before the group was set up): «add expense 140.07 fuel 10/11 cash ENOC», «add cash to boss 18000 04/11», «add advance 500 RAJU 06/11».
// Several lines in one message give ONE preview and one 1 / 2; each batch is logged (#AD1) and can be undone. They count in the reports exactly like group posts, marked «(added by owner)».
import { methodFromWords, typeFromWords } from './expenses.js';
import { normalizeDigits } from './text.js';

const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const num = (s) => Math.round(Number(String(s).replace(/,/g, '')) * 100) / 100;
const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TYPE_NAMES = { fuel: 'Fuel', food: 'Food', office: 'Office supplies', vehicles: 'Car', other: 'Other' };

/** «10/11» -> '2026-11-10' (the year of today; a month still ahead of today is last year's). */
export function dayFrom(token, today) {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(token || '');
  if (!m) return '';
  const year = Number(today.slice(0, 4)) - (Number(m[2]) > Number(today.slice(5, 7)) ? 1 : 0);
  return year + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
}

/** The lines of an «add …» message. Returns { entries, bad } or null when the first line is no add command. entries: { kind: 'expense' | 'cash_to_boss' | 'salary_advance', amount, day, type, method, vendor, employee }. */
export function parseAddEntries(text, today = new Date().toISOString().slice(0, 10)) {
  const lines = normalizeDigits(String(text || '')).replace(/\r/g, '').split('\n').map((l) => l.trim().replace(/^(?:atossa|atosa|آتوسا)[ ,:]+/i, '')).filter(Boolean);
  if (!lines.length || !/^add\s+(?:expense|cash\s+to\s+boss|advance)\b/i.test(lines[0])) return null;
  const entries = []; const bad = [];
  for (const line of lines) {
    let m;
    const take = (rest) => { const words = rest.split(/\s+/).filter(Boolean); const date = words.find((w) => /^\d{1,2}\/\d{1,2}$/.test(w)); return { day: date ? dayFrom(date, today) : today, words: words.filter((w) => w !== date) }; };
    if ((m = new RegExp('^add\\s+expense\\s+' + AMOUNT + '(?:\\s+(.*))?$', 'i').exec(line)) && num(m[1]) > 0) {
      const { day, words } = take(m[2] || '');
      const type = words.map(typeFromWords).find(Boolean) || 'other'; const method = words.map(methodFromWords).find(Boolean) || 'cash';
      const typeAt = words.findIndex((w) => typeFromWords(w)); // only the FIRST type word is the type; «ENOC» after it is the vendor
      const vendor = words.filter((w, i) => i !== typeAt && !methodFromWords(w) && !/^(?:aed|dhs?)$/i.test(w)).join(' ').slice(0, 40);
      entries.push({ kind: 'expense', amount: num(m[1]), day, type, method, vendor });
    } else if ((m = new RegExp('^add\\s+cash\\s+to\\s+boss\\s+' + AMOUNT + '(?:\\s+(.*))?$', 'i').exec(line)) && num(m[1]) > 0) {
      entries.push({ kind: 'cash_to_boss', amount: num(m[1]), day: take(m[2] || '').day });
    } else if ((m = new RegExp('^add\\s+advance\\s+' + AMOUNT + '(?:\\s+(.*))?$', 'i').exec(line)) && num(m[1]) > 0) {
      const { day, words } = take(m[2] || '');
      entries.push({ kind: 'salary_advance', amount: num(m[1]), day, employee: words.join(' ').toUpperCase().slice(0, 40) });
    } else bad.push(line);
  }
  return { entries, bad };
}

const dm = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const line = (e) => {
  if (e.kind === 'expense') return dm(e.day) + '  Expense ' + money(e.amount) + '  ' + (TYPE_NAMES[e.type] || 'Other') + '  ' + e.method + (e.vendor ? '  ' + e.vendor : '');
  if (e.kind === 'cash_to_boss') return dm(e.day) + '  Cash to boss ' + money(e.amount);
  return dm(e.day) + '  Salary advance ' + money(e.amount) + (e.employee ? '  ' + e.employee : '');
};

/** The one preview for a message: nothing is added until the owner's 1. [store]: the expense store (keeps the waiting batch and the log). */
export function requestAdd(store, parsed, key) {
  if (!parsed.entries.length) return 'Nothing to add. Write: add expense 140.07 fuel 10/11 cash ENOC, add cash to boss 18000 04/11, add advance 500 RAJU 06/11' + (parsed.bad.length ? '\nNot understood: ' + parsed.bad.join('; ') : '');
  store.d.added = store.d.added || { n: 0, batches: {}, pending: {} };
  store.d.added.pending[key] = { entries: parsed.entries, at: store.now() }; store.save();
  return ['➕ Add ' + parsed.entries.length + ' item' + (parsed.entries.length === 1 ? '' : 's') + ' (added by owner)', ...parsed.entries.map(line), ...(parsed.bad.length ? ['Not understood: ' + parsed.bad.join('; ')] : []), 'They count in the reports like group posts. Nothing is written to QuickBooks.', '1. Yes, add them', '2. No'].join('\n');
}

/** The owner's 1 / 2 on a waiting batch: [apply](entries, batchId) records them and returns their references; null when none waits. */
export function answerAdd(store, key, pick, apply) {
  const a = store.d.added; const p = a?.pending?.[key];
  if (!p || store.now() - p.at > 10 * 60 * 1000) return null;
  delete a.pending[key];
  if (String(pick) !== '1') { store.save(); return 'Nothing was added.'; }
  a.n += 1; const id = 'AD' + a.n;
  a.batches[id] = { at: store.now(), entries: p.entries, refs: apply(p.entries, id), undone: false };
  store.save();
  return 'Added #' + id + ': ' + p.entries.length + ' item' + (p.entries.length === 1 ? '' : 's') + ' (added by owner). To take them back: undo add #' + id;
}

/** «undo add #AD1»: [remove](refs) takes the batch away again. */
export function parseUndoAdd(text) {
  const m = /^(?:atossa[ ,:]+)?undo\s+add\s+#?(AD\d+)$/i.exec(normalizeDigits(String(text || '')).trim());
  return m ? m[1].toUpperCase() : '';
}
export function undoAdd(store, id, remove) {
  const b = store.d.added?.batches?.[id];
  if (!b || b.undone) return 'There is no batch #' + id + ' to take back.';
  remove(b.refs); b.undone = true; store.save();
  return 'Taken back #' + id + ': its ' + b.entries.length + ' item' + (b.entries.length === 1 ? ' is' : 's are') + ' gone from the reports.';
}

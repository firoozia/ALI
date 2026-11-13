// Expenses: the 19:00 report in the style of «Money received», and editing / deleting an expense by its number with a preview, the owner's 1 / 2 and an undo. Nothing is ever written to QuickBooks.
import { SEP } from './separator.js';
import { TYPES, matchExpenses, methodFromWords, qbKindOf, typeFromWords } from './expenses.js';
import { normalizeDigits } from './text.js';

const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/');
const methodName = (m) => (m === 'card' ? 'card' : 'cash');
const typeLabel = (t) => TYPES[t]?.label || 'Other';

/** The expenses report: a block per type, a line per expense (🟢 matched to a QuickBooks expense: vendor + amount ±1 + date ±3 days; 🔴 not yet), then the totals. [records]: the QuickBooks Purchase rows. */
export function expensesReport(entries, records, title, checkedAt = '') {
  if (!entries.length) return '🧾 *Expenses — ' + title + '*\nNo expense was recorded.';
  const matched = matchExpenses(entries, records || []);
  const matches = matched.found;
  const hintOf = new Map((matched.hints || []).map((h) => [h.entry, h.record]));
  const found = new Set(matches.map((x) => x.entry));
  const recordOf = new Map(matches.map((x) => [x.entry, x.record]));
  const toFix = [];
  const blocks = [];
  for (const key of Object.keys(TYPES)) {
    const list = entries.filter((e) => (TYPES[e.type] ? e.type : 'other') === key);
    if (!list.length) continue;
    blocks.push([TYPES[key].emoji + ' *' + TYPES[key].label + '*', ...list.map((e) => {
      const who = String(e.vendor || (e.note || ''));
      const rec = recordOf.get(e); const kind = rec ? qbKindOf(rec) : '';
      const acct = rec && rec.AccountRef?.name ? '  (QuickBooks: ' + rec.AccountRef.name + ')' : '';
      const wrong = kind && e.method && kind !== e.method ? '  ⚠ posted ' + e.method + ', QuickBooks ' + (rec.AccountRef?.name || 'account') + ' (' + kind + ') — please fix' : '';
      if (wrong) toFix.push('#' + e.id + ' posted ' + e.method + ', QuickBooks ' + (rec.AccountRef?.name || 'account') + ' (' + kind + ')');
      return (found.has(e) ? '🟢 ' : '🔴 ') + money(e.amount).padEnd(8) + methodName(e.method).padEnd(7) + who.padEnd(10) + (who.length >= 10 ? ' ' : '') + '#' + e.id + (e.addedByOwner ? ' (added by owner)' : '') + (found.has(e) ? acct : '') + wrong + (hintOf.has(e) ? '\n     ↳ this looks like the amount before VAT of ' + (hintOf.get(e).EntityRef?.name || 'a QuickBooks expense') + ' ' + hintOf.get(e).TxnDate.slice(8, 10) + '/' + hintOf.get(e).TxnDate.slice(5, 7) + ' ' + money(hintOf.get(e).TotalAmt) : '');
    })].join('\n'));
  }
  const total = entries.reduce((n, e) => n + Number(e.amount), 0);
  const card = entries.filter((e) => e.method === 'card').reduce((n, e) => n + Number(e.amount), 0);
  const cash = total - card;
  return ['🧾 *Expenses — ' + title + '*', ...(checkedAt ? ['checked now ' + checkedAt] : []), SEP, SEP, blocks.join('\n' + SEP + '\n'), SEP, SEP, '*Total: ' + money(total) + ' AED*', 'Cash box ' + money(cash) + ' | Bank card ' + money(card), '🟢 In QuickBooks: ' + found.size + '    🔴 Not yet: ' + (entries.length - found.size), ...(toFix.length ? [SEP, '⚠ *To fix*', ...toFix] : [])].join('\n');
}

/**
 * «Atossa edit #E8» + one change per line («card», «cash», «amount 42.50», «type car», «note …»), or one line «Atossa edit #E8 cash»; «Atossa delete #E8»; «Atossa undo #E8».
 * Returns { op: 'edit', id, changes } | { op: 'delete', id } | { op: 'undo', id } or null.
 */
export function parseExpenseEdit(text) {
  const lines = normalizeDigits(String(text || '')).replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const head = /^((?:atossa|atosa|atousa|آتوسا|اتوسا)[ ,:]+)?(edit|change|delete|remove|undo)\s+(expense\s+)?#?(E\d+)\b\s*(.*)$/i.exec(lines[0]);
  if (!head) return null;
  const verb = head[2].toLowerCase(); const id = head[4].toUpperCase();
  if ((verb === 'delete' || verb === 'remove') && !head[1]) return null; // a bare «delete #E1» stays the owner's old hard delete
  if (verb === 'delete' || verb === 'remove') return { op: 'delete', id };
  if (verb === 'undo') return { op: 'undo', id };
  const changes = {}; const bad = [];
  for (const line of [head[5], ...lines.slice(1)].map((l) => String(l || '').trim()).filter(Boolean)) {
    let m;
    if ((m = /^amount\s*[:=]?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:aed|dhs?)?$/i.exec(line)) && Number(m[1].replace(/,/g, '')) > 0) changes.amount = Math.round(Number(m[1].replace(/,/g, '')) * 100) / 100;
    else if ((m = /^type\s*[:=]?\s*(.+)$/i.exec(line)) && typeFromWords(m[1])) changes.type = typeFromWords(m[1]);
    else if ((m = /^note\s*[:=]?\s*(.+)$/i.exec(line))) changes.note = m[1].slice(0, 60);
    else if (methodFromWords(line) && line.split(/\s+/).length <= 2) changes.method = methodFromWords(line);
    else bad.push(line);
  }
  return { op: 'edit', id, changes, bad };
}

const FIELD_LINES = [['method', 'Payment:  ', (v) => methodName(v)], ['amount', 'Amount:   ', (v) => money(v)], ['type', 'Type:     ', (v) => typeLabel(v)], ['note', 'Note:     ', (v) => v || '—']];
/** How QuickBooks paid a matched purchase: 'cash' | 'card' | '' (unknown). */
const qbMethodOf = (rec) => (rec.PaymentType === 'CreditCard' ? 'card' : rec.PaymentType === 'Cash' ? 'cash' : /petty|cash/i.test(String(rec.AccountRef?.name || '')) ? 'cash' : '');
/** The line about QuickBooks for an edit: when the edited method / amount equal the matched QuickBooks purchase, the edit only makes the post match it; otherwise QuickBooks needs the same fix. [qb]: the matched purchase or null. */
function qbLine(e, changes, who) {
  if (who.qb) {
    const method = changes.method !== undefined ? changes.method : e.method; const amount = changes.amount !== undefined ? changes.amount : e.amount;
    const qm = qbMethodOf(who.qb);
    const same = (!qm || qm === method) && Math.abs(Number(who.qb.TotalAmt) - Number(amount)) <= 1;
    return same ? ['✔ now matches QuickBooks.'] : ['This expense is already 🟢 in QuickBooks: also fix it in QuickBooks.'];
  }
  return who.inQb ? ['This expense is already 🟢 in QuickBooks: also fix it in QuickBooks.'] : [];
}
const keyOf = (chat, sender) => String(chat) + '|' + String(sender);

/** The preview of an edit or delete; the change waits for the person's 1 / 2. [inQb]: the expense is already 🟢 in QuickBooks. */
export function requestExpenseEdit(store, cmd, who) {
  const e = store.get(cmd.id);
  if (!e || e.state === 'cancelled') return 'No expense #' + cmd.id + ' was found.';
  const head = (cmd.op === 'delete' ? '🗑 Delete expense #' : '✏️ Edit expense #') + e.id + ' — ' + dmy(e.date || e.day) + (e.vendor ? ', ' + e.vendor : '');
  store.d.pending = store.d.pending || {};
  if (cmd.op === 'delete') {
    store.d.pending[keyOf(who.chat, who.sender)] = { id: e.id, op: 'delete', at: store.now() }; store.save();
    return [head, 'Amount:   ' + money(e.amount) + ', ' + typeLabel(e.type) + ', ' + methodName(e.method), 'Nothing is changed in QuickBooks.', ...(who.qb || who.inQb ? ['This expense is already 🟢 in QuickBooks: also delete it in QuickBooks yourself.'] : []), '1. Yes, delete it', '2. No, keep it'].join('\n');
  }
  const changed = FIELD_LINES.filter((f) => cmd.changes[f[0]] !== undefined && cmd.changes[f[0]] !== e[f[0]]);
  if (!changed.length) return 'Nothing to change on #' + e.id + '. Write: edit #' + e.id + ' then card / cash / amount 42.50 / type car / note …' + ((cmd.bad || []).length ? '\nNot understood: ' + cmd.bad.join('; ') : '');
  store.d.pending[keyOf(who.chat, who.sender)] = { id: e.id, op: 'edit', changes: cmd.changes, at: store.now() }; store.save();
  return [head, ...changed.map((f) => f[1] + f[2](e[f[0]]) + ' → *' + f[2](cmd.changes[f[0]]) + '*'), ...((cmd.bad || []).length ? ['Not understood: ' + cmd.bad.join('; ')] : []), 'Nothing is changed in QuickBooks.', ...qbLine(e, cmd.changes, who), '1. Yes, change it', '2. No, keep it'].join('\n');
}

/** The person's 1 / 2 on the waiting preview; null when none waits (the digit is not ours). Logged on the expense, with its undo. */
export function answerExpenseEdit(store, chat, sender, pick) {
  const k = keyOf(chat, sender); const p = (store.d.pending || {})[k];
  if (!p || store.now() - p.at > 10 * 60 * 1000) return null;
  delete store.d.pending[k];
  const e = store.get(p.id);
  if (!e) { store.save(); return 'No expense #' + p.id + ' was found.'; }
  if (String(pick) !== '1') { store.save(); return 'Kept #' + e.id + ' as it is.'; }
  e.history = e.history || [];
  if (p.op === 'delete') { e.history.push({ at: store.now(), before: { state: e.state } }); e.state = 'cancelled'; store.save(); return 'Deleted #' + e.id + '. To bring it back: undo #' + e.id; }
  const before = {}; for (const f of Object.keys(p.changes)) before[f] = e[f];
  e.history.push({ at: store.now(), before }); Object.assign(e, p.changes); store.save();
  return 'Changed #' + e.id + '. To put it back: undo #' + e.id;
}

/** Puts the last change of an expense back (also a deletion). */
export function undoExpense(store, id) {
  const e = store.get(id);
  if (!e || !(e.history || []).length) return 'There is nothing to undo on #' + String(id).toUpperCase() + '.';
  const last = e.history.pop(); Object.assign(e, last.before); store.save();
  return 'Undone: #' + e.id + ' is back as it was.';
}

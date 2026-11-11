// The owner corrects OLD stored cut rows by message, with a preview and his yes (nothing is written before it, everything is logged, every change can be undone):
//   cuts 215 08/11          lists the stored cuts of that code (and day) with short ids #Z1, #Z2 ...
//   cut #Z12 customer NAME  sets the customer          cut #Z12 merge #Z13  adds #Z13 into #Z12 (one cut)
//   cut #Z12 cancel         the cut was cancelled      cut #Z12 drop  the row is no cut at all
//   yes #X3 / no #X3        applies / refuses the preview      undo cut #X3  puts the rows back as they were
import fs from 'node:fs';
import path from 'node:path';
import { SEP } from './separator.js';

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const dayParts = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-');
const dm = (ms, tz) => { const p = dayParts(ms, tz); return p[2] + '/' + p[1]; };
const hm = (ms, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
const codeOf = (l) => String(l.code).replace(/\D/g, '');

/** The command, or null. { op: 'list', code, day } | { op: 'customer' | 'merge' | 'cancel' | 'drop', row, name, other } | { op: 'undo', id } */
export function parseCutCommand(text) {
  const t = String(text || '').replace(/\r/g, '').split('\n')[0].normalize('NFKC').replace(/^\s*(?:atossa|atosa|atousa|آتوسا)[ ,:]+/i, '').replace(/[.!؟?]+$/, '').trim();
  let m = /^cuts\s+(\d{2,5})(?:\s+(\d{1,2})\/(\d{1,2}))?$/i.exec(t);
  if (m) return { op: 'list', code: m[1], day: m[2] ? String(m[3]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0') : '' };
  m = /^cut\s+#?Z(\d+)\s+customer\s+(.{2,80})$/i.exec(t); if (m) return { op: 'customer', row: 'Z' + m[1], name: m[2].trim() };
  m = /^cut\s+#?Z(\d+)\s+merge\s+#?Z(\d+)$/i.exec(t); if (m) return { op: 'merge', row: 'Z' + m[1], other: 'Z' + m[2] };
  m = /^cut\s+#?Z(\d+)\s+(cancel|drop)$/i.exec(t); if (m) return { op: m[2].toLowerCase(), row: 'Z' + m[1] };
  m = /^undo\s+cut\s+#?X(\d+)$/i.exec(t); if (m) return { op: 'undo', id: 'X' + m[1] };
  return null;
}

export class CutEdits {
  constructor(dir = '', now = () => Date.now()) {
    this.file = dir ? path.join(dir, 'qbo-cut-edits.json') : ''; this.now = now;
    this.d = { n: 0, z: 0, rows: {}, edits: {}, log: [] };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first start */ }
  }

  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  handle(ref) {
    const known = Object.entries(this.d.rows).find((x) => x[1] === ref);
    if (known) return known[0];
    this.d.z += 1; this.d.rows['Z' + this.d.z] = ref; this.save(); return 'Z' + this.d.z;
  }

  openIds() { return Object.values(this.d.edits).filter((e) => e.status === 'pending' && this.now() - e.at <= 24 * 3600 * 1000).map((e) => e.id); }
  get(id) { return this.d.edits[String(id).toUpperCase()] || null; }
}

const linesText = (e) => (e.lines || []).map((l) => l.code + ' ' + r2(l.quantity) + ' ' + (l.unit || 'm')).join(', ') || '—';
const stateText = (e) => (e.cancelled ? ' (cancelled)' : e.dropped ? ' (dropped)' : e.internal ? ' (internal)' : '');
const rowText = (store, e, tz) => '#' + store.handle(e.ref) + '  ' + dm(e.at, tz) + ' ' + hm(e.at, tz) + '  ' + (e.customerTyped || e.customer || '—').toUpperCase() + '  ' + linesText(e) + stateText(e);

/** The stored cuts of a code (and a day «MM-DD») for the owner, newest first. */
export function listCuts(store, events, options) {
  const code = options.code; const day = options.day || ''; const timeZone = options.timeZone || 'Asia/Dubai';
  const dayName = day ? day.slice(3) + '/' + day.slice(0, 2) : '';
  const rows = events.filter((e) => e.type === 'cut' && !e.simulated && (e.lines || []).some((l) => codeOf(l) === code) && (!day || dayParts(e.at, timeZone).slice(1).join('-') === day)).sort((a, b) => b.at - a.at).slice(0, 15);
  if (!rows.length) return 'No stored cut of code ' + code + (day ? ' on ' + dayName : '') + '.';
  return ['Stored cuts of ' + code + (day ? ' on ' + dayName : '') + ' (' + rows.length + ')', ...rows.map((e) => rowText(store, e, timeZone)), SEP, 'Fix one: cut #Z1 customer <name>, cut #Z1 merge #Z2, cut #Z1 cancel, cut #Z1 drop. Each shows a preview and waits for your yes.'].join('\n');
}

/** A preview for one command: nothing is changed until the owner's yes. Returns the text. */
export function requestCutEdit(store, tracker, cmd, options = {}) {
  const canon = options.canon || ((n) => n); const timeZone = options.timeZone || 'Asia/Dubai';
  const find = (h) => { const ref = store.d.rows[String(h).toUpperCase()]; return ref ? tracker.events.find((e) => e.ref === ref) : null; };
  const e = find(cmd.row);
  if (!e) return '#' + cmd.row + ' is not a stored cut. List them first: cuts <code> [dd/mm].';
  const changes = []; let note;
  if (cmd.op === 'customer') {
    const name = canon(cmd.name) || cmd.name;
    changes.push({ ref: e.ref, patch: { customer: name, customerTyped: name } });
    note = 'customer ' + (e.customerTyped || e.customer || '—').toUpperCase() + ' -> ' + name.toUpperCase();
  } else if (cmd.op === 'cancel') {
    changes.push({ ref: e.ref, patch: { internal: true, cancelled: { at: store.now(), text: 'cancelled by the owner' } } });
    note = 'cancelled: it is no cut any more and goes to the cancel check';
  } else if (cmd.op === 'drop') {
    changes.push({ ref: e.ref, patch: { internal: true, dropped: { at: store.now() } } });
    note = 'dropped: it is no cut at all';
  } else if (cmd.op === 'merge') {
    const o = find(cmd.other);
    if (!o || o.ref === e.ref) return '#' + cmd.other + ' is not another stored cut.';
    const by = new Map();
    for (const l of [...(e.lines || []), ...(o.lines || [])]) {
      const k = codeOf(l) + '|' + (l.unit || 'm'); const have = by.get(k);
      if (have) have.quantity = r2(Number(have.quantity) + Number(l.quantity)); else by.set(k, { ...l, quantity: Number(l.quantity) });
    }
    changes.push({ ref: e.ref, patch: { lines: [...by.values()] } }, { ref: o.ref, patch: { internal: true, dropped: { at: store.now(), into: e.ref } } });
    note = '#' + cmd.other + ' is added into #' + cmd.row + ': ' + [...by.values()].map((l) => l.code + ' ' + r2(l.quantity) + ' ' + (l.unit || 'm')).join(', ') + '; #' + cmd.other + ' is dropped';
  } else return null;
  store.d.n += 1; const id = 'X' + store.d.n;
  store.d.edits[id] = {
    id, op: cmd.op, row: cmd.row, note, at: store.now(), status: 'pending',
    changes: changes.map((c) => ({ ref: c.ref, patch: c.patch, before: Object.fromEntries(Object.keys(c.patch).map((k) => [k, (tracker.events.find((x) => x.ref === c.ref) || {})[k]])) })),
  };
  store.save();
  return ['Cut edit #' + id, rowText(store, e, timeZone), 'Change: ' + note, 'Nothing is changed in QuickBooks or the sheet.', 'yes #' + id + ' / no #' + id].join('\n');
}

/** The owner's answer: verb 'yes' | 'no' | 'undo'. */
export function decideCutEdit(store, tracker, verb, id, options = {}) {
  const log = options.log || (() => {});
  const x = store.get(id);
  if (!x) return ['#' + id + ' is not waiting any more.'];
  if (verb === 'undo') {
    if (x.status !== 'applied') return ['#' + id + ' was not applied: nothing to undo.'];
    for (const c of x.changes) tracker.update(c.ref, c.before);
    x.status = 'undone'; store.d.log.push({ id, event: 'undo', at: store.now() }); store.save(); log('cut edit ' + id + ' undone');
    return ['Undone #' + id + ': the stored cuts are back as they were.'];
  }
  if (x.status !== 'pending') return ['#' + id + ' is not waiting any more.'];
  if (verb !== 'yes') { x.status = 'refused'; store.save(); return ['Refused #' + id + ': nothing was changed.']; }
  for (const c of x.changes) tracker.update(c.ref, c.patch);
  x.status = 'applied'; store.d.log.push({ id, event: 'apply', at: store.now(), note: x.note }); store.save(); log('cut edit ' + id + ' applied: ' + x.note);
  return ['Done #' + id + ': ' + x.note + '. To put it back: undo cut #' + id];
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { SheetNameStore, applyCells, backupName, cellsOf, findQboName, planSheetNames, sheetCall, sheetPreviewText, sheetProblem } from '../src/sheetnames.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';

// Invented names and rows only.
const QBO = ['DELTAA LIONS FOR KITCHENS- LLC-S.P.C', 'OMEGA WOOD PRESSING L.L.C', 'ALAFEEFI KITCHEN', 'AL AFEEF KITCHEN', 'SIGMA TRADING', 'SIGMA STEEL'];
const names = [
  { tab: 'Customers', column: 'Name', name: 'OMEGA WOOD PRESSING L.L.C', rows: [2] }, // identical
  { tab: 'Customers', column: 'Name', name: 'Delta lion', rows: [3] },
  { tab: 'Movements', column: 'Customer', name: 'Delta lion', rows: [10, 11, 12] },
  { tab: 'Customers', column: 'Name', name: 'AL AFEEFI KITCHEN', rows: [4] },
  { tab: 'Customers', column: 'Name', name: 'Sigma', rows: [5] }, // two candidates
  { tab: 'Movements', column: 'Customer', name: 'Zeta Doors', rows: [13] }, // none
];

test('the plan: identical, rename (one candidate), unclear (none or several); two like customers stay apart', () => {
  const plan = planSheetNames({ sheetNames: names, qboNames: QBO });
  assert.deepEqual(plan.same.map((g) => g.name), ['OMEGA WOOD PRESSING L.L.C']);
  const ren = Object.fromEntries(plan.rename.map((r) => [r.name, [r.to, r.rows]]));
  assert.deepEqual(ren['Delta lion'], ['DELTAA LIONS FOR KITCHENS- LLC-S.P.C', 4]); // the Customers row and the three outgoing rows
  assert.equal(ren['AL AFEEFI KITCHEN'][0], 'ALAFEEFI KITCHEN'); // never the other customer AL AFEEF KITCHEN
  assert.deepEqual(plan.unclear.map((u) => u.name).sort(), ['Sigma', 'Zeta Doors']);
  assert.ok(plan.unclear.find((u) => u.name === 'Sigma').candidates.length === 2); assert.deepEqual(plan.unclear.find((u) => u.name === 'Zeta Doors').candidates, []);
  // the owner tells the right name: it is a rename now, and only a real QuickBooks name is accepted
  const told = planSheetNames({ sheetNames: names, qboNames: QBO, overrides: { sigma: 'SIGMA STEEL' } });
  assert.equal(told.rename.find((r) => r.name === 'Sigma').to, 'SIGMA STEEL');
  assert.ok(planSheetNames({ sheetNames: names, qboNames: QBO, overrides: { sigma: 'NOT A CUSTOMER' } }).unclear.some((u) => u.name === 'Sigma'));
});

test('the cells and the preview: only the renamed names, every row once; the unclear are asked about, never changed', () => {
  const plan = planSheetNames({ sheetNames: names, qboNames: QBO });
  const cells = cellsOf(plan);
  assert.ok(cells.every((c) => c.old !== c.new && ['Customers', 'Movements'].includes(c.tab)));
  assert.equal(cells.length, 5); assert.ok(!cells.some((c) => c.old === 'Sigma' || c.old === 'Zeta Doors'));
  const text = sheetPreviewText(plan, 'H1', { namesIn: ['Customers 4 names'] });
  assert.match(text, /\(preview #H1\)/); assert.match(text, /✔ already identical: 1/); assert.match(text, /✎ will rename \(2\):\n1\. Delta lion → DELTAA LIONS FOR KITCHENS- LLC-S\.P\.C \(4 rows; Customers: 1, Movements: 3\)/);
  assert.match(text, /❓ unclear \(2\)[^\n]*\n1\. Sigma \(1 row\) — candidates: SIGMA TRADING \| SIGMA STEEL/); assert.match(text, /Zeta Doors \(1 row\) — no QuickBooks customer fits/);
  assert.match(text, /Reply yes #H1 to rename the ✎ names only \(a backup copy of the sheet is made first\), or no #H1\./);
  assert.match(sheetPreviewText(planSheetNames({ sheetNames: [names[0]], qboNames: QBO }), 'H2'), /Nothing to apply\./);
});

test('the commands: «sheet names», «name OLD → NEW», «undo names #H1», and «yes #H1» / «no #H1»', () => {
  assert.deepEqual(parseInvoiceCommand('sheet names'), { type: 'sheet_names' });
  assert.deepEqual(parseInvoiceCommand('name ALIA → ALIA WOOD PRESSING L.L.C'), { type: 'sheet_name_set', from: 'ALIA', to: 'ALIA WOOD PRESSING L.L.C' });
  assert.deepEqual(parseInvoiceCommand('name ALIA -> ALIA WOOD'), { type: 'sheet_name_set', from: 'ALIA', to: 'ALIA WOOD' });
  assert.deepEqual(parseInvoiceCommand('undo names #H2'), { type: 'sheet_names_undo', id: 'H2' });
  assert.deepEqual(parseInvoiceCommand('yes #H1'), { type: 'yes', id: 'H1' }); assert.deepEqual(parseInvoiceCommand('no #H1'), { type: 'no', id: 'H1' });
  assert.notEqual(parseInvoiceCommand('name ALIA')?.type, 'sheet_name_set');
});

const config = { sheetUrl: 'https://sheet.invalid/exec', botToken: 'tok', log: () => {}, logInfo: () => {} };
const fakeFetch = (reply, seen = []) => async (url, init) => { const body = JSON.parse(init.body); seen.push(body); return { status: 200, ok: true, headers: { get: () => null }, json: async () => reply(body) }; };

test('the apply: paced batches of 100, the bot token, each batch logged as it lands, only cells that really changed are logged; the backup name is dated', async () => {
  const cells = Array.from({ length: 250 }, (_, i) => ({ tab: 'Movements', row: 10 + i, old: 'Delta lion', new: 'DELTAA LIONS' }));
  const seen = []; const logged = []; const waits = [];
  const f = fakeFetch((b) => ({ ok: true, applied: b.cells.filter((c) => c.row % 50 !== 0).map((c) => ({ tab: c.tab, row: c.row })), skipped: b.cells.filter((c) => c.row % 50 === 0).map((c) => ({ tab: c.tab, row: c.row, why: 'changed' })) }), seen);
  const r = await applyCells(config, cells, { fetchImpl: f, sleep: async (ms) => waits.push(ms), onApplied: (d) => logged.push(...d) });
  assert.deepEqual(seen.map((b) => b.cells.length), [100, 100, 50]); assert.ok(seen.every((b) => b.action === 'botNames' && b.mode === 'apply' && b.token === 'tok'));
  assert.deepEqual(waits, [1500, 1500]); assert.equal(r.applied + r.skipped.length, 250); assert.equal(logged.length, r.applied); assert.ok(logged.every((c) => c.row % 50 !== 0));
  assert.equal(backupName(Date.parse('2026-11-10T08:00:00Z')), 'ZINAX stock backup 2026-11-10 before names');
  assert.match(sheetProblem(new Error('Unknown action')), /deploy a NEW version/); assert.match(sheetProblem(new Error('Name changes are off. In Apps Script')), /ZINAX_NAMES_WRITE = on[\s\S]*Nothing was changed/);
  assert.equal((await sheetCall(config, { mode: 'read' }, fakeFetch(() => ({ ok: true, names: [] })))).names.length, 0);
});

test('the log: every changed cell is kept for the undo; the owner\'s told names are remembered', () => {
  const dir = fs.mkdtempSync(path.join(import.meta.dirname, 'sn-')); try {
    const s = new SheetNameStore(dir); const id = s.nextId(); assert.equal(id, 'H1');
    s.openRun(id, 1, 'copy'); s.logApplied(id, [{ tab: 'Customers', row: 3, old: 'Delta lion', new: 'DELTAA LIONS' }]); s.tell('Sigma', 'SIGMA STEEL');
    const again = new SheetNameStore(dir); assert.equal(again.run('h1').applied[0].old, 'Delta lion'); assert.equal(again.d.overrides.sigma, 'SIGMA STEEL'); assert.equal(again.nextId(), 'H2');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the wiring: owner only; the backup comes BEFORE the first write; unclear names are never in the cells; the bot has no other way to write the sheet', () => {
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  const part = index.slice(index.indexOf('async function decideSheetNames'), index.indexOf('async function sheetNamesUndo'));
  assert.ok(part.indexOf("mode: 'backup'") < part.indexOf('applyCells(')); assert.match(part, /return \[`The backup copy of the sheet failed, so NOTHING was changed/);
  assert.match(index, /'received_check', 'sheet_names', 'sheet_name_set', 'sheet_name_set_many', 'sheet_names_undo'/); // typed in a group: «use your own chat»
  assert.match(index, /id\.startsWith\('H'\) \? decideSheetNames\(ic\.type, id\)/);
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'sheetnames.js'), 'utf8');
  assert.doesNotMatch(src, /delete|clear|remove|insertRow|deleteRow/i.source ? /\b(deleteRow|insertRow|clearContents|setTrashed)\b/ : /x/);
});

// ---- the sheet's own script (Code.gs) against a mocked spreadsheet
function sheetScript(writeOn) {
  const code = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'zinax-stock', 'apps-script', 'Code.gs'), 'utf8');
  const tabs = {};
  const make = (name) => ({ cells: [], getName: () => name, getLastRow() { return this.cells.length; }, getLastColumn() { return Math.max(0, ...this.cells.map((r) => r.length)); }, getMaxRows: () => 1000,
    getRange(r, c, nr = 1, nc = 1) { const sh = this; return { getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (sh.cells[r - 1 + i] || [])[c - 1 + j] ?? '')); }, getValue() { return (sh.cells[r - 1] || [])[c - 1] ?? ''; },
      setValue(v) { sh.cells[r - 1] = sh.cells[r - 1] || []; sh.cells[r - 1][c - 1] = v; sh.writes.push([name, r, c, v]); return this; }, setValues(v) { for (let i = 0; i < nr; i++) { sh.cells[r - 1 + i] = sh.cells[r - 1 + i] || []; for (let j = 0; j < nc; j++) sh.cells[r - 1 + i][c - 1 + j] = v[i][j]; } return this; }, setFontWeight() { return this; }, setNumberFormat() { return this; } }; },
    setFrozenRows() {}, writes: [] });
  const ss = { getSheetByName: (n) => tabs[n] || null, insertSheet: (n) => (tabs[n] = make(n)), getId: () => 'x', getName: () => 'Zinax Stock Data', getSpreadsheetTimeZone: () => 'Asia/Dubai' };
  const props = { ZINAX_BOT_TOKEN: 'tok', ...(writeOn ? { ZINAX_NAMES_WRITE: 'on' } : {}) };
  const copies = [];
  const ctx = { SpreadsheetApp: { getActive: () => ss, flush() {} }, ScriptApp: { WeekDay: {} }, PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k], setProperty() {} }) }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: () => '2026-11-10', getUuid: () => 'u' }, ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ t, setMimeType() { return this; } }) }, Logger: { log() {} },
    DriveApp: { getFoldersByName: () => ({ hasNext: () => true, next: () => ({}) }), getFileById: () => ({ makeCopy: (name) => { copies.push(name); return { getName: () => name, getUrl: () => `https://drive.invalid/${name}` }; } }) }, Date, JSON, Number, String, isNaN, Object, Math, Array };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const post = (b) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token: 'tok', action: 'botNames', ...b }) } }).t);
  // Customers: ID, Name, ...; Movements: ID, ItemID, Type, Qty, Unit, Code, Size, Reference, At, Device, ServerAt, User, Customer, Invoice
  const C = vm.runInContext('SHEETS', ctx);
  const cust = ctx.SpreadsheetApp.getActive().insertSheet('Customers'); cust.cells = [C.Customers, ['c1', 'Delta lion', 1, 'x', false, 1, 1], ['c2', 'OMEGA WOOD', 1, 'x', false, 1, 1]];
  const mov = ctx.SpreadsheetApp.getActive().insertSheet('Movements');
  const m = (id, type, who) => { const r = Array(C.Movements.length).fill(''); r[0] = id; r[2] = type; r[12] = who; return r; };
  const items = ctx.SpreadsheetApp.getActive().insertSheet('Items'); const it = (id, who) => { const r = Array(C.Items.length).fill(''); r[0] = id; r[18] = who; return r; }; items.cells = [C.Items, it('i1', 'Delta lion'), it('i2', '')];
  mov.cells = [C.Movements, m('m1', 'OUT', 'Delta lion'), m('m2', 'IN', 'Delta lion'), m('m3', 'CUT', 'Delta lion'), m('m4', 'OUT', '')];
  return { post, cust, mov, items, copies };
}

test('the sheet script: read lists the names with their rows (outgoing only); backup copies the whole sheet; apply changes only matching name cells and only when switched on', () => {
  const off = sheetScript(false);
  const read = off.post({ mode: 'read' });
  assert.deepEqual(read.names.map((n) => [n.tab, n.name, n.rows]), [['Customers', 'Delta lion', [2]], ['Customers', 'OMEGA WOOD', [3]], ['Items', 'Delta lion', [2]], ['Movements', 'Delta lion', [2, 4]]]); // the IN row and the empty name are not outgoing names
  assert.equal(off.post({ mode: 'backup', name: 'ZINAX stock backup 2026-11-10 before names' }).name, 'ZINAX stock backup 2026-11-10 before names'); assert.deepEqual(off.copies, ['ZINAX stock backup 2026-11-10 before names']);
  const refused = off.post({ mode: 'apply', cells: [{ tab: 'Customers', row: 2, old: 'Delta lion', new: 'DELTAA LIONS' }] });
  assert.equal(refused.ok, false); assert.match(refused.error, /ZINAX_NAMES_WRITE = on/); assert.deepEqual(off.cust.writes, []); // switched off: not one cell written
  assert.equal(off.post({ action: 'botNames', mode: 'read', token: 'bad' }).ok, false);

  const on = sheetScript(true);
  const res = on.post({ mode: 'apply', cells: [
    { tab: 'Customers', row: 2, old: 'Delta lion', new: 'DELTAA LIONS' }, { tab: 'Movements', row: 2, old: 'Delta lion', new: 'DELTAA LIONS' },
    { tab: 'Movements', row: 4, old: 'Someone else', new: 'DELTAA LIONS' }, // the cell holds another value now: left alone
    { tab: 'Items', row: 2, old: 'Delta lion', new: 'DELTAA LIONS' }, { tab: 'Shipments', row: 2, old: 'x', new: 'y' }, { tab: 'Customers', row: 1, old: 'Name', new: 'Z' }, // an Items reservation / not a name tab / the header row
  ] });
  assert.equal(res.ok, true); assert.deepEqual(res.applied, [{ tab: 'Customers', row: 2 }, { tab: 'Movements', row: 2 }, { tab: 'Items', row: 2 }]); assert.equal(res.skipped.length, 3);
  const w = [...on.cust.writes, ...on.items.writes, ...on.mov.writes].map((x) => x.slice(0, 3).join('#'));
  assert.deepEqual(w, ['Customers#2#2', 'Customers#2#6', 'Customers#2#7', 'Items#2#19', 'Items#2#16', 'Items#2#17', 'Movements#2#13']); // the name cells, and the renamed customer's UpdatedAt and ServerAt (as a hand edit does) so the phones pull it; nothing else
  assert.equal(on.cust.writes[0][3], 'DELTAA LIONS'); assert.ok(on.cust.writes[2][3] > 1e12);
  assert.equal(on.mov.cells[3][12], 'Delta lion'); // the IN row untouched
  assert.equal(on.post({ mode: 'apply', cells: Array(201).fill({ tab: 'Customers', row: 2, old: 'a', new: 'b' }) }).ok, false); // a batch over 200
});

test('a QuickBooks name with two spaces: found with spaces and case ignored on both sides, the EXACT name kept; one letter more or less fits only when nothing stronger does', () => {
  const qbo = ['AL  AHLIA KITCHEN', 'OMEGA WOOD PRESSING L.L.C', 'ALAFEEFI KITCHEN', 'AL AFEEF KITCHEN'];
  assert.equal(findQboName(qbo, 'al ahlia kitchen'), 'AL  AHLIA KITCHEN'); assert.equal(findQboName(qbo, 'AL  AHLIA KITCHEN'), 'AL  AHLIA KITCHEN'); assert.equal(findQboName(qbo, 'AL AHLIA KITCHENS'), '');
  const mk = (name) => [{ tab: 'Customers', column: 'Name', name, rows: [2] }];
  const near = planSheetNames({ sheetNames: mk('AL AHALIA KITCHEN'), qboNames: qbo }); // the extra A
  assert.deepEqual(near.rename.map((r) => [r.name, r.to]), [['AL AHALIA KITCHEN', 'AL  AHLIA KITCHEN']]);
  assert.deepEqual(planSheetNames({ sheetNames: mk('AL AHLIA KITCHEN'), qboNames: qbo }).rename.map((r) => r.to), ['AL  AHLIA KITCHEN']); // only the spaces differ: renamed to the exact one
  assert.deepEqual(planSheetNames({ sheetNames: mk('AL AFEEFI KITCHEN'), qboNames: qbo }).rename.map((r) => r.to), ['ALAFEEFI KITCHEN']); // the stronger match, not the near AL AFEEF
  assert.deepEqual(cellsOf(near).map((c) => c.new), ['AL  AHLIA KITCHEN']); // written with its double space
});

test('left as is: the owner\'s names are not unclear any more, not changed, and told in the preview', () => {
  const sheet = [{ tab: 'Movements', column: 'Customer', name: 'Cut In Roll', rows: [5, 6] }, { tab: 'Movements', column: 'Customer', name: '207', rows: [7] }];
  const plan = planSheetNames({ sheetNames: sheet, qboNames: ['OMEGA WOOD'], leave: { 'cut in roll': true, 207: true } });
  assert.deepEqual([plan.unclear.length, plan.rename.length, plan.left.map((g) => g.name)], [0, 0, ['Cut In Roll', '207']]);
  assert.match(sheetPreviewText(plan, 'H3'), /↷ left as is by you \(2\): Cut In Roll, 207/); assert.equal(cellsOf(plan).length, 0);
  const dir = fs.mkdtempSync(path.join(import.meta.dirname, 'sn-')); try {
    const s = new SheetNameStore(dir); s.leaveAlone('Open roll'); s.tell('Open roll', 'OMEGA WOOD'); assert.ok(!s.d.leave['open roll']); s.leaveAlone('Open roll'); assert.ok(s.d.leave['open roll'] && !s.d.overrides['open roll']);
    assert.ok(new SheetNameStore(dir).d.leave['open roll']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('one message with many corrections: a line each, with or without «name», an optional (N), the leave words; a single line still works; plain text is not one', () => {
  const t = 'Cut In Roll (4) -> cancel is wrong\nname 207 -> none\nNew Customer → leave\nAL AHALIA KITCHEN (3) -> AL AHLIA KITCHEN';
  assert.deepEqual(parseInvoiceCommand(t), { type: 'sheet_name_set_many', pairs: [
    { from: 'Cut In Roll', to: 'cancel is wrong', leave: true }, { from: '207', to: 'none', leave: true }, { from: 'New Customer', to: 'leave', leave: true }, { from: 'AL AHALIA KITCHEN', to: 'AL AHLIA KITCHEN', leave: false }] });
  assert.deepEqual(parseInvoiceCommand('name ALIA (2) -> ALIA WOOD'), { type: 'sheet_name_set', from: 'ALIA', to: 'ALIA WOOD' });
  assert.notEqual(parseInvoiceCommand('hello there\nsee you -> soon but this line is plain')?.type, 'sheet_name_set_many'); // the first line is not a pair
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  const many = index.slice(index.indexOf('async function sheetNameSetMany'), index.indexOf('async function decideSheetNames'));
  assert.equal((many.match(/sheetNamesPreview\(\)/g) || []).length, 1); assert.doesNotMatch(many, /sheetCall|applyCells/); // ONE preview, and no write at all
});

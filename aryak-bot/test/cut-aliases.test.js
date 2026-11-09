import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CutAliases, proposeAliases } from '../src/cutaliases.js';
import { crossCheck } from '../src/cuts.js';
import { Tracker } from '../src/tracker.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';

// Invented customers only (the real alias list lives on the server, never here).
const QBO = ['HAMED TRADING', 'AL AHLIA KITCHEN', 'WAHDAN ALUMINIUM AND KITCHENS WORKS', 'ALWAN ALSHAM', 'ZED CARPENTRY', 'AR-RAD INTERNATIONAL FOR TRADE'];
const NOW = Date.parse('2026-11-08T08:00:00Z'); const DAY = 24 * 3600 * 1000;

test('proposals: a post name that no customer matches by the plain rules but one fits by sound and spelling; plain matches, exact names and strangers are left out', () => {
  const pairs = proposeAliases({ postNames: ['HAMID TRD', 'AL AHALIA KITCHEN', 'WAHADAN ALUMINUM', 'ALWAN AL SHAM', 'RANDOM STRANGER', 'AR RAD', 'HAMED TRADING'], qboNames: QBO });
  const by = Object.fromEntries(pairs.map((x) => [x.post, x.qbo]));
  assert.equal(by['HAMID TRD'], 'HAMED TRADING'); assert.equal(by['AL AHALIA KITCHEN'], 'AL AHLIA KITCHEN');
  assert.equal(by['WAHADAN ALUMINUM'], 'WAHDAN ALUMINIUM AND KITCHENS WORKS'); assert.ok(!('AR RAD' in by)); // AR RAD = AR-RAD: the plain rules take it
  assert.ok(!('ALWAN AL SHAM' in by)); // the plain rules already take it
  assert.ok(!('HAMED TRADING' in by)); assert.ok(!('RANDOM STRANGER' in by));
  assert.ok(pairs.every((x) => x.score >= 80));
  // a settled name is not proposed again
  assert.equal(proposeAliases({ postNames: ['HAMID TRD'], qboNames: QBO, skip: (k) => k === 'hamid trd' }).length, 0);
});

test('the owner decides: nothing is used before his yes; a yes approves the lines left; a no is remembered and never proposed again; kept on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-'));
  const store = new CutAliases(dir, () => NOW);
  const p = store.propose([{ post: 'HAMID TRD', qbo: 'HAMED TRADING', score: 100 }, { post: 'AR RAD', qbo: 'AR-RAD INTERNATIONAL FOR TRADE', score: 85 }, { post: 'ZED', qbo: 'ZED CARPENTRY', score: 95 }]);
  assert.equal(p.id, 'A1'); assert.deepEqual(store.openIds(), ['A1']);
  assert.equal(store.resolve('HAMID TRD'), ''); // proposed only: not used
  assert.equal(store.drop('A1', [3]), 1); // the owner removes line 3
  assert.deepEqual(store.decide('A1', 'yes'), { count: 2 });
  assert.equal(store.resolve('Hamid  TRD'), 'HAMED TRADING'); assert.equal(store.resolve('AR RAD'), 'AR-RAD INTERNATIONAL FOR TRADE'); assert.equal(store.resolve('ZED'), '');
  assert.equal(new CutAliases(dir, () => NOW).resolve('AR RAD'), 'AR-RAD INTERNATIONAL FOR TRADE'); // kept on disk
  assert.deepEqual(store.decide('A1', 'yes'), { error: 'approved' }); // not twice
  const q = store.propose([{ post: 'XYZ', qbo: 'ZED CARPENTRY', score: 90 }]);
  assert.deepEqual(store.decide(q.id, 'no'), { count: 1 }); assert.equal(store.settled('xyz'), true); assert.equal(store.resolve('XYZ'), '');
  let later = NOW + 2 * DAY; const expiring = new CutAliases('', () => later); const e = expiring.propose([{ post: 'A', qbo: 'B', score: 90 }]); later += 2 * DAY;
  assert.deepEqual(expiring.decide(e.id, 'yes'), { error: 'expired' });
  assert.deepEqual(store.decide('A99', 'yes'), { error: 'not found' });
});

test('an approved alias makes the cross-check count a post of that name for the QuickBooks customer; an unapproved one does not', () => {
  const tr = new Tracker({ dir: '' });
  tr.add({ type: 'cut', at: NOW - DAY, customer: 'HAMID TRD', customerTyped: 'HAMID TRD', lines: [{ code: '303', quantity: 6, unit: 'm' }], ref: 'h1' });
  const without = crossCheck(tr, 'HAMED TRADING', [{ code: '303', qty: 6 }], { now: NOW, invoiced: [] }).problems;
  assert.deepEqual(without, ['303: no order found']);
  const store = new CutAliases('', () => NOW); store.decide(store.propose([{ post: 'HAMID TRD', qbo: 'HAMED TRADING', score: 100 }]).id, 'yes');
  assert.deepEqual(crossCheck(tr, 'HAMED TRADING', [{ code: '303', qty: 6 }], { now: NOW, invoiced: [], aliasOf: (n) => store.resolve(n) }).problems, []);
  assert.deepEqual(crossCheck(tr, 'ZED CARPENTRY', [{ code: '303', qty: 6 }], { now: NOW, invoiced: [], aliasOf: (n) => store.resolve(n) }).problems, ['303: no order found']); // another customer is not affected
});

test('the words and the wiring: «cut aliases», «drop 2,3 #A1», «yes #A1»; the alias list stays on the server', () => {
  assert.deepEqual(parseInvoiceCommand('cut aliases'), { type: 'alias_propose' }); assert.deepEqual(parseInvoiceCommand('نام‌های مستعار برش'), { type: 'alias_propose' });
  assert.deepEqual(parseInvoiceCommand('drop 2,3 #A1'), { type: 'alias_drop', numbers: [2, 3], id: 'A1' });
  assert.deepEqual(parseInvoiceCommand('yes #A1'), { type: 'yes', id: 'A1' }); assert.deepEqual(parseInvoiceCommand('no A2'), { type: 'no', id: 'A2' });
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(index, /new CutAliases\(path\.join\(config\.authDir, 'qbo'\)\)/); // the server's own folder
  assert.match(index, /aliasOf: \(n\) => cutAliases\.resolve\(n\)/);
  assert.match(index, /id\.startsWith\('A'\) \? decideAlias\(ic\.type, id\)/);
  assert.match(index, /\.\.\.cutAliases\.openIds\(\)/); // a bare yes counts the open proposal
});

test('two close names: the nearer spelling wins, an equal pair is left to the owner; a note after the customer in a cut post is not part of the name', async () => {
  const qbo = ['NUQOOSH IND . LLC', 'NUQOOSH TRADING LLC', 'AL AHLIA KITCHEN', 'AL AHLIA KITCHENS TRADING'];
  const by = Object.fromEntries(proposeAliases({ postNames: ['NUQOOSH kitchens ind . llc', 'AL AHALIA KITCHEN'], qboNames: qbo }).map((x) => [x.post, x.qbo]));
  assert.ok(by['AL AHALIA KITCHEN'] === 'AL AHLIA KITCHEN');
  const { parseCutCaption } = await import('../src/captions.js');
  const r = parseCutCaption('ART NO 105 AL AHALIA KITCHEN BD REPAIRED 6M');
  assert.equal((r.customer || '').toUpperCase(), 'AL AHALIA KITCHEN');
});

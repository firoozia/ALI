import test from 'node:test';
import assert from 'node:assert/strict';
import { differences, reconcileSheet, sameName, sheetFindingText } from '../src/sheetcheck.js';
import { Tracker, reconcileCuts } from '../src/tracker.js';

const cap = (customer, code, quantity, extra = {}) => ({ customer, lines: [{ code, quantity, unit: 'm' }], ...extra });
const row = (customer, code, qty, type = 'OUT') => ({ customer, code, qty, unit: 'm', type });

// 3 and 4 November, caption -> sheet, as compared by hand
const PAIRS = [
  ['DANDY', '410', 6, 6.2], ['PVC WORKS', '108 C', 40, 40.2], ['PVC WORKS', '511', 35, 35.2], ['GR DECENT', '511', 120, 120], ['MASTER WOOD', '505', 120, 120],
  ['AWAB WOOD', '505', 3, 3.1], ['HAMID', '124', 36, 36.2], ['DESIGNER', '303', 80, 80], ['MASTER', '215', 8, 8], ['DESIGNER', '201', 25, 25.2],
  ['DANDY', '503', 8, 8.2], ['PALM BOARD', '122', 40, 40], ['AL EBDA', '209', 26, 26.2], ['DANDY', '232', 10, 10], ['CORDOBA', '233', 1, 1],
  ['HIGH POINT', '502', 6, 6.2], ['AR RAD', '602', 5, 5.2], ['KITCHEN PALACE', '220', 22, 22.2],
];

test('the real pairs of two days agree: the extra 0.1 to 0.2 m of an open roll is not a difference', () => {
  const r = reconcileSheet({ cuts: PAIRS.map(([c, code, q]) => cap(c, code, q)), rows: PAIRS.map(([c, code, , s]) => row(c, code, s)), tol: 0.5 });
  assert.equal(differences(r), 0);
  assert.equal(r.agree, PAIRS.length);
  assert.equal(sheetFindingText('2026-11-04', r), '');
});

test('three operations of one customer: 18+12 against 30.8 is within the tolerance per operation, a big difference is not', () => {
  const cuts = [cap('DESIGNER', '220', 18), cap('DESIGNER', '220', 12)];
  const ok = reconcileSheet({ cuts, rows: [row('DESIGNER', '220', 10.3), row('DESIGNER', '220', 10.2), row('DESIGNER', '220', 10.3)], tol: 0.5 });
  assert.equal(differences(ok), 0); // 0.8 over 3 operations
  const bad = reconcileSheet({ cuts, rows: [row('DESIGNER', '220', 32)], tol: 0.5 });
  assert.deepEqual(bad.mismatch.map((m) => [m.code, m.cut, m.out]), [['220', 30, 32]]);
});

test('a cut with no OUT, an OUT with no cut, a damage caption and an OUT with no customer', () => {
  const r = reconcileSheet({
    cuts: [cap('HIGH POINT', '402', 3, { kind: 'damage', internal: true }), cap('PVC WORKS', '108 C', 40), cap('X', '300', 5, { internal: true, kind: 'open-roll' })],
    rows: [row('MASTER', '215', 8), row('', '999', 4)], tol: 0.5,
  });
  assert.equal(r.damage, 1); // a note, not a mismatch
  assert.deepEqual(r.cutNoOut.map((m) => [m.customer, m.code, m.cut]), [['PVC WORKS', '108 C', 40]]);
  assert.deepEqual(r.outNoCut.map((m) => [m.customer, m.code, m.out]), [['MASTER', '215', 8]]);
  const text = sheetFindingText('2026-11-04', r, 'Atossa');
  assert.match(text, /Cut photo but no OUT scanned in the sheet: PVC WORKS, code 108 C, 40 m/);
  assert.match(text, /OUT in the sheet but no cut photo: MASTER, code 215, 8 m/);
  assert.equal(text.split('\n').filter((l) => l.startsWith('⚠️')).length, 1); // one message
});

test('the names of the two sources meet: case, spelling and generic words', () => {
  for (const [a, b] of [['dandy Door', 'DANDY DOOR'], ['AL AHALIA KITCHEN', 'Al ahlia'], ['AL AHLIA', 'AL AHALIA KITCHEN'], ['DESIGNER', 'DESIGNER WOOD'], ['dandy', 'DANDY DOOR']]) assert.equal(sameName(a, b), true, `${a} / ${b}`);
  for (const [a, b] of [['MASTER WOOD', 'AWAB WOOD'], ['HIGH POINT', 'PALM BOARD'], ['AL EBDA', 'AL AHLIA']]) assert.equal(sameName(a, b), false, `${a} / ${b}`);
  const r = reconcileSheet({ cuts: [cap('dandy Door', '410', 6)], rows: [row('DANDY DOOR', '410', 6.2)], tol: 0.5 });
  assert.equal(differences(r), 0);
});

test('an invoice is satisfied by a scanned OUT of its quantity even without a cut photo; a short OUT is still a finding', () => {
  const NOW = Date.parse('2026-11-08T08:00:00Z');
  const DAY = 86400000;
  const t = new Tracker();
  t.startedAt = NOW - 20 * DAY;
  t.add({ type: 'invoice', at: NOW - 5 * DAY, ref: 'i1', number: 'inv-1', customer: 'DANDY DOOR', lines: [{ code: '410', quantity: 6, unit: 'm' }, { code: '503', quantity: 8, unit: 'm' }] });
  t.add({ type: 'out', at: NOW - 4 * DAY, customer: 'dandy Door', code: '410', qty: 6.2, unit: 'm', ref: 'o1' });
  t.add({ type: 'out', at: NOW - 4 * DAY, customer: 'dandy Door', code: '503', qty: 5, unit: 'm', ref: 'o2' });
  const f = reconcileCuts(t, 'DANDY DOOR', { now: NOW });
  assert.deepEqual(f.map((x) => [x.code, x.kind, x.invoiced, x.cut]), [['503', 'cut-short', 8, 5]]); // 410 is satisfied by 6.2
});

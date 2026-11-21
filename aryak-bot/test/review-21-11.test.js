import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pickItem } from '../src/qboinvoice.js';
import { crossCheck, cutRecords } from '../src/cuts.js';

const items = [
  { Id: '183', Name: 'EDGE BAND 0.8x22 - 1806', Sku: 'EDGE22-1806', Type: 'Inventory', Active: true, UnitPrice: 100 },
  { Id: '259', Name: 'EDGE BAND 0.8x50 - 1806', Sku: 'EDGE50-1806', Type: 'Inventory', Active: true },
  { Id: '160', Name: 'PVC 1806', Sku: 'PVC-1806', Type: 'Inventory', Active: true, UnitPrice: 14 },
  { Id: '30', Name: 'PVC FILM122', Sku: 'PVC-122', Type: 'Inventory', Active: true },
];

test('a bare code is its PVC film, never edge banding from the history, and a yes never teaches it as edge banding (the owner, 21/11: «1806 4m» became EDGE BAND 0.8x22 - 1806)', () => {
  const edge = items[0];
  assert.equal(pickItem('1806', { items }).item.Id, '160');
  assert.equal(pickItem('1806', { items, taught: () => edge }).item.Id, '183', 'what the owner taught by a command still wins');
  assert.equal(pickItem('1806', { items, history: new Set(['183']) }).item.Id, '160', 'nor the history');
  assert.equal(pickItem('1806 E22', { items }).item.Id, '183', 'E22 still names the edge banding');
  assert.equal(pickItem('122', { items, taught: () => items[3] }).item.Id, '30');
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'qboinvoice.js'), 'utf8');
  assert.match(src, /a yes never teaches a bare code as edge banding/);
});

test('a cut posted for one customer and filed under another is not in the other\'s cross-check (the owner, 21/11: AL MASAR under MASTER WOOD, AL EBDA under NUQOOSH)', () => {
  const now = Date.parse('2026-11-21T10:00:00Z');
  const tracker = { events: [
    { type: 'cut', ref: 'a', at: now - 9 * 86400000, customer: 'MASTER WOOD', customerTyped: 'AL MASAR', lines: [{ code: '229', quantity: 30, unit: 'm' }] },
    { type: 'cut', ref: 'b', at: now - 2 * 3600000, customer: 'MASTER WOOD', customerTyped: 'MASTER WOOD', lines: [{ code: '213', quantity: 10, unit: 'm' }] },
    { type: 'cut', ref: 'c', at: now - 9 * 86400000, customer: 'NUQOOSH kitchens ind . llc', customerTyped: 'AL EBDA', lines: [{ code: '505', quantity: 14.5, unit: 'm' }] },
  ] };
  const today = { 'AL MASAR': 'AL MASAR SAHIH', 'AL EBDA': 'AL EBDA AL MALKI KITCHEN', 'MASTER WOOD': 'MASTER WOOD' };
  const nameOf = (typed, filed) => today[typed] || filed;
  const r = crossCheck(tracker, 'MASTER WOOD', [{ code: '213', qty: 10 }], { now, invoiced: [], nameOf });
  assert.ok(!r.problems.some((p) => /229/.test(p)), r.problems.join(' / '));
  assert.ok(r.covered.some((p) => /213/.test(p)));
  const n = crossCheck(tracker, 'NUQOOSH IND . LLC', [{ code: '511', qty: 5 }], { now, invoiced: [], nameOf });
  assert.ok(!n.problems.some((p) => /505/.test(p)), n.problems.join(' / '));
  const e = crossCheck(tracker, 'AL EBDA AL MALKI KITCHEN', [{ code: '505', qty: 14 }], { now, invoiced: [], nameOf });
  assert.ok(e.covered.some((p) => /505/.test(p)), 'the cut is in its own customer\'s check');
  assert.equal(cutRecords(tracker, 'MASTER WOOD', ['229'], { now, nameOf }).length, 0);
  // without the resolver (old callers) nothing changes
  assert.ok(crossCheck(tracker, 'MASTER WOOD', [{ code: '213', qty: 10 }], { now, invoiced: [] }).problems.some((p) => /229/.test(p)));
});

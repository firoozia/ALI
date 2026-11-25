import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCutCaption } from '../src/captions.js';
import { eventsFromCaption } from '../src/captionevents.js';
import { crossCheck } from '../src/cuts.js';

const DAY = 86400000;
const NOW = Date.parse('2026-11-25T07:00:00Z');

test('SMPL before or after the name is a sample: free, listed with a green tick, never «not invoiced» (the owner, 25/11)', () => {
  for (const t of ['ART NO 608 HIGH POINT SMPL 0.5M', 'ART NO 608 SMPL HIGH POINT 0.5M', 'ART NO 608 HIGH POINT 0.5M SAMPLE']) {
    const c = parseCutCaption(t);
    assert.equal(c.sample, true, t); assert.equal(c.customer, 'HIGH POINT', t); assert.equal(c.quantity, 0.5, t);
    assert.equal(eventsFromCaption('cut', t).events[0].sample, true, t);
  }
  const tracker = { events: [
    { type: 'cut', ref: 's', at: NOW - DAY, customer: 'HIGH POINT', sample: true, lines: [{ code: '608', quantity: 0.5, unit: 'm' }] },
    { type: 'cut', ref: 'c', at: NOW - 3600000, customer: 'HIGH POINT', lines: [{ code: '209', quantity: 31, unit: 'm' }] },
  ] };
  const r = crossCheck(tracker, 'HIGH POINT', [{ code: '209', qty: 31 }], { now: NOW, invoiced: [] });
  assert.ok(!r.problems.some((p) => /608/.test(p)), r.problems.join(' / '));
  assert.deepEqual(r.samples, ['608: sample 0.5m on 24/11, no invoice needed']);
});

test('an invoice line dated long BEFORE the cut is another order (live 25/11: MASTER WOOD 214 cut today was paired with a 214 line of 12/11: an invoice more than a week before the cut is another order)', () => {
  const tracker = { events: [{ type: 'cut', ref: 'm', at: NOW - 3600000, customer: 'MASTER WOOD', lines: [{ code: '214', quantity: 8, unit: 'm' }] }] };
  const old = [{ codes: ['214', 'PVC FILM214'], qty: 1, number: 'inv-10023', at: NOW - 13 * DAY }];
  const r = crossCheck(tracker, 'MASTER WOOD', [{ code: '214', qty: 8 }], { now: NOW, invoiced: old });
  assert.ok(r.covered.some((x) => /^214: cut today/.test(x)), JSON.stringify(r));
  assert.ok(!r.problems.some((x) => /214/.test(x)), JSON.stringify(r));
  const dayBefore = [{ codes: ['214'], qty: 8, number: 'inv-1', at: NOW - DAY }];
  assert.equal(crossCheck(tracker, 'MASTER WOOD', [], { now: NOW, invoiced: dayBefore }).problems.length, 0, 'an invoice the day before the cut still takes it');
});

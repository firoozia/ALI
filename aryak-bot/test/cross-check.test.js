import test from 'node:test';
import assert from 'node:assert/strict';
import { Tracker } from '../src/tracker.js';
import { crossCheck, markCutsInvoiced } from '../src/cuts.js';
import { parseEnglishInvoice } from '../src/qboinvoice.js';

// Invented customers, codes and quantities only.
const NOW = Date.parse('2026-11-08T08:00:00Z');
const DAY = 24 * 3600 * 1000;
const cut = (tr, ref, customer, code, quantity, daysAgo, extra = {}) => tr.add({ type: 'cut', at: NOW - daysAgo * DAY, customer, customerTyped: customer, lines: [{ code, quantity, unit: 'm' }], ref, ...extra });

test('the price in the request: «/10aed», «/10 aed», «@10» makes the line exact (code, quantity, price); a code without a price keeps the system price', () => {
  assert.deepEqual(parseEnglishInvoice('Atossa invoice MASTER WOOD 505=10m 211=20 /10aed'), { customer: 'MASTER WOOD', lines: ['505 10', '211, 20, 10'] });
  assert.deepEqual(parseEnglishInvoice('Atossa invoice for MASTER WOOD 505=10m /10 aed, 211=20 @12.5'), { customer: 'MASTER WOOD', lines: ['505, 10, 10', '211, 20, 12.5'] });
  assert.deepEqual(parseEnglishInvoice('invoice for MASTER WOOD\n505 = 10 mtr /10AED\n211 = 20'), { customer: 'MASTER WOOD', lines: ['505, 10, 10', '211 20'] });
  assert.deepEqual(parseEnglishInvoice('invoice for MASTER WOOD 505=10m'), { customer: 'MASTER WOOD', lines: ['505 10'] }); // nothing changes without a price
});

test('the cross-check with the cutting group: no order, already invoiced, a different quantity, orders cut but missing from the invoice; all matching says nothing', () => {
  const tr = new Tracker({ dir: '' });
  cut(tr, 'c1', 'MASTER WOOD', 'ART NO 505', 10, 1);      // matches the invoice line 505 = 10
  cut(tr, 'c2', 'MASTER WOOD', '503', 8, 1);              // cut for him, not on the invoice
  cut(tr, 'c3', 'MASTER WOOD', '507', 5, 2);              // invoiced before
  cut(tr, 'c4', 'MASTER WOOD', '509', 12, 2);             // a different quantity
  cut(tr, 'c5', 'OTHER CUSTOMER', '211', 20, 1);          // another customer's cut is never his
  markCutsInvoiced(tr, [{ ref: 'c3', index: 0 }], 'inv-9981', NOW - DAY);
  const lines = [
    { code: '505', qty: 10 }, { code: '211', qty: 20 }, { code: '507', qty: 5 }, { code: '509', qty: 10 },
  ];
  const { problems } = crossCheck(tr, 'MASTER WOOD', lines, { now: NOW, invoiced: [] }); // QuickBooks read: no invoice line carries any of these cuts
  assert.deepEqual(problems, [
    '211: no order found',
    '507: already invoiced (inv-9981) on 07/11',
    '509: cut 12m on 06/11, invoice has 10',
    '503: cut 8m on 07/11, not invoiced',
  ]);
  const clean = new Tracker({ dir: '' });
  cut(clean, 'k1', 'MASTER WOOD', '505', 10, 1);
  assert.deepEqual(crossCheck(clean, 'MASTER WOOD', [{ code: '505', qty: 10 }], { now: NOW, invoiced: [] }).problems, []);
  assert.deepEqual(crossCheck(new Tracker({ dir: '' }), 'MASTER WOOD', [{ code: '505', qty: 10 }], { now: NOW, invoiced: [] }).problems, ['505: no order found']);
  // old cuts (outside the window) and the team's internal entries are not orders
  const old = new Tracker({ dir: '' });
  cut(old, 'o1', 'MASTER WOOD', '505', 10, 90); cut(old, 'o2', 'MASTER WOOD', '505', 10, 1, { internal: true });
  assert.deepEqual(crossCheck(old, 'MASTER WOOD', [{ code: '505', qty: 10 }], { now: NOW }).problems, ['505: no order found']);
});

test('«not invoiced» looks at ALL of the customer\'s QuickBooks invoices (the office\'s on the screen too): a cut is invoiced when the invoices of its code since the cut day carry its quantity', () => {
  const tr = new Tracker({ dir: '' });
  cut(tr, 'a1', 'MASTER WOOD', '216', 12, 5); cut(tr, 'a2', 'MASTER WOOD', '235', 6, 4); cut(tr, 'a3', 'MASTER WOOD', '203', 9, 3); cut(tr, 'a4', 'MASTER WOOD', '512', 7, 2); cut(tr, 'a5', 'MASTER WOOD', '410', 4, 1);
  const at = (daysAgo) => NOW - daysAgo * DAY;
  const invoiced = [
    { codes: ['216', 'PVC FILM216'], qty: 12, number: 'inv-9906', at: at(4) },   // the office, on the screen: the whole cut
    { codes: ['235', 'PVC FILM235'], qty: 4, number: 'inv-9918', at: at(3) },    // only part of the cut
    { codes: ['203', 'PVC FILM203'], qty: 9, number: 'inv-9929', at: at(10) },   // dated BEFORE the cut: another order
  ];
  const { problems } = crossCheck(tr, 'MASTER WOOD', [], { now: NOW, invoiced });
  assert.deepEqual(problems, ['235: cut 2m on 04/11, not invoiced', '203: cut 9m on 05/11, not invoiced', '512: cut 7m on 06/11, not invoiced', '410: cut 4m on 07/11, not invoiced']); // 216 is invoiced: not listed
  // QuickBooks could not be read: nothing is claimed about «not invoiced»
  assert.deepEqual(crossCheck(tr, 'MASTER WOOD', [], { now: NOW, invoiced: null }).problems, []);
  // a line the office already invoiced is a double-invoice warning that names its number
  assert.deepEqual(crossCheck(tr, 'MASTER WOOD', [{ code: '216', qty: 12 }], { now: NOW, invoiced }).problems.slice(0, 1), ['216: already invoiced (inv-9906) on 04/11']);
});

test('at most five problem lines, then the count of the rest; meters are compared with meters only', () => {
  const tr = new Tracker({ dir: '' });
  for (let i = 0; i < 9; i += 1) cut(tr, `m${i}`, 'MASTER WOOD', `4${i}0`, 3 + i, 1);
  const r = crossCheck(tr, 'MASTER WOOD', [], { now: NOW, invoiced: [] });
  assert.equal(r.problems.length, 5); assert.equal(r.more, 4);
  const pieces = new Tracker({ dir: '' });
  pieces.add({ type: 'cut', at: NOW - DAY, customer: 'MASTER WOOD', customerTyped: 'MASTER WOOD', lines: [{ code: '211', quantity: 2, unit: 'roll' }], ref: 'p1' });
  assert.deepEqual(crossCheck(pieces, 'MASTER WOOD', [{ code: '211', qty: 20 }], { now: NOW, invoiced: [] }).problems, []); // 2 rolls against 20 (meters): not a mismatch
});

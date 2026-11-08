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
  const { problems } = crossCheck(tr, 'MASTER WOOD', lines, { now: NOW });
  assert.deepEqual(problems, [
    '211: no order found',
    '507: already invoiced (inv-9981) on 06/11',
    '509: cut 12m on 06/11, invoice has 10',
    '503: cut 8m on 07/11, not invoiced',
  ]);
  const clean = new Tracker({ dir: '' });
  cut(clean, 'k1', 'MASTER WOOD', '505', 10, 1);
  assert.deepEqual(crossCheck(clean, 'MASTER WOOD', [{ code: '505', qty: 10 }], { now: NOW }).problems, []);
  assert.deepEqual(crossCheck(new Tracker({ dir: '' }), 'MASTER WOOD', [{ code: '505', qty: 10 }], { now: NOW }).problems, ['505: no order found']);
  // old cuts (outside the window) and the team's internal entries are not orders
  const old = new Tracker({ dir: '' });
  cut(old, 'o1', 'MASTER WOOD', '505', 10, 90); cut(old, 'o2', 'MASTER WOOD', '505', 10, 1, { internal: true });
  assert.deepEqual(crossCheck(old, 'MASTER WOOD', [{ code: '505', qty: 10 }], { now: NOW }).problems, ['505: no order found']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { migrateOldPayments, proposePayment } from '../src/payments.js';

// Invented customers and invoices only.
const NOW = Date.parse('2026-11-07T17:31:00Z');
const rows = [{ DocNumber: 'inv-9940', TotalAmt: 504, Balance: 0, CustomerRef: { name: 'MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C' } }, { DocNumber: 'inv-9700', TotalAmt: 300, Balance: 300, CustomerRef: { name: 'ZED CARPENTRY' } }];

test('a stored name that still carries the payment words of the old reading («clear MUNICH DOOR KITCHEN inv») is compared without them: the row is the invoice', () => {
  const why = [];
  const stored = { type: 'payment', kind: 'cash', customer: 'clear MUNICH DOOR KITCHEN inv', amount: 9940, ref: 'ab12cd34ef', at: NOW };
  const out = migrateOldPayments({ events: [stored], invoiceRows: rows, onRow: (e, w) => why.push(w) });
  assert.deepEqual(out, [{ ref: 'ab12cd34ef', patch: { amount: 0, noAmount: true, invoices: ['inv-9940'], reparsed: true, customer: 'MUNICH DOOR KITCHEN', pendingName: false } }]); // and the name is cleaned
  assert.match(why[0], /^read as the invoice inv-9940 of "MUNICH DOOR KITCHEN TRADING L\.L\.C- S\.P\.C"$/);
  // a clean name works as before
  assert.equal(migrateOldPayments({ events: [{ ...stored, customer: 'MUNICH DOOR KITCHEN' }], invoiceRows: rows }).length, 1);
});

test('every row says why it was left as it is, so the log shows which condition held a row back', () => {
  const reasons = {};
  const ev = (ref, extra) => ({ type: 'payment', kind: 'cash', customer: 'MUNICH DOOR KITCHEN', amount: 9940, ref, at: NOW, ...extra });
  const events = [ev('r1'), ev('r2', { customer: 'ZED CARPENTRY' }), ev('r3', { amount: 9940.5 }), ev('r4', { amount: 8888 }), ev('r5', { kind: 'transfer' }), ev('r6', { reparsed: true }), ev('r7', { source: 'pdf' }), ev('r8', { invoices: ['inv-1'] }), ev('r9', { customer: '' }), ev('r10', { text: 'cash 9940 from MUNICH DOOR KITCHEN' })];
  migrateOldPayments({ events, invoiceRows: rows, parse: () => null, onRow: (e, w) => { reasons[e.ref] = w; } });
  assert.match(reasons.r1, /^read as the invoice inv-9940/);
  assert.equal(reasons.r2, 'invoice inv-9940 is of "MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C", not of "ZED CARPENTRY"');
  assert.equal(reasons.r3, 'amount 9940.5 is not a whole number from 100'); assert.equal(reasons.r4, 'no invoice inv-8888 in QuickBooks');
  assert.equal(reasons.r5, 'kind is transfer, not cash'); assert.equal(reasons.r6, 'already re-read'); assert.equal(reasons.r7, 'a receipt entry'); assert.equal(reasons.r8, 'already has an invoice number');
  assert.equal(reasons.r9, 'no customer to compare with the invoice'); assert.equal(reasons.r10, 'kept words give the same reading');
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(index, /onRow: \(e, why\) => logger\.info\(`payments: row \$\{String\(e\.ref\)\.slice\(0, 8\)\} amount \$\{e\.amount\} customer/);
});

test('the report line of the migrated row: the customer, the invoice with its total, paid in QuickBooks, and when it was cleared', () => {
  const lookup = new Map(rows.map((r) => [r.DocNumber.toLowerCase(), r]));
  const migrated = { type: 'payment', kind: 'cash', currency: 'AED', customer: 'MUNICH DOOR KITCHEN', amount: 0, noAmount: true, invoices: ['inv-9940'], cleared: true, at: NOW, ref: 'x' };
  const p = proposePayment({ event: migrated, invoices: [], lookup, timeZone: 'Asia/Dubai' });
  assert.equal(p[0], 'amount not read — cash for inv-9940 from MUNICH DOOR KITCHEN (07/11)');
  assert.equal(p[1], '→ inv-9940 (MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C, total 504.00) — paid (cleared 07/11)');
  assert.equal(proposePayment({ event: { ...migrated, cleared: false }, invoices: [], lookup })[1], '→ inv-9940 (MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C, total 504.00) — paid');
});

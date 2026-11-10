import test from 'node:test';
import assert from 'node:assert/strict';
import { matchReceipts, whyNotFound, expandRecords } from '../src/expenses.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';

// Invented names and amounts only.
const item = (customer, amount, day = '2026-11-09') => ({ customer, amount, day });
const rec = (name, total, day, extra = {}) => ({ TxnDate: day, TotalAmt: total, CustomerRef: { name }, ...extra });

test('the brand matches with a letter more or less, singular or plural: «Delta lion» is «DELTAA LIONS FOR KITCHENS- LLC-S.P.C»', () => {
  const it = item('Delta lion', 199.5);
  assert.ok(matchReceipts([it], [rec('DELTAA LIONS FOR KITCHENS- LLC-S.P.C', 199.5, '2026-11-10')]).has(it));
  const other = item('Delta lion', 199.5);
  assert.ok(!matchReceipts([other], [rec('OMEGA WOOD LLC', 199.5, '2026-11-10')]).has(other)); // another brand never matches
});

test('a Payment, a SalesReceipt (cash sale) or a Deposit: the total or a line of a bigger one, within three days', () => {
  const sr = item('Delta lion', 199.5);
  assert.ok(matchReceipts([sr], [rec('DELTAA LIONS', 199.5, '2026-11-11', { _type: 'SalesReceipt' })]).has(sr));
  const line = item('Delta lion', 199.5);
  const big = rec('DELTAA LIONS', 1500, '2026-11-09', { Line: [{ Amount: 1300.5 }, { Amount: 199.5 }] });
  assert.ok(matchReceipts([line], [big]).has(line));
  const dep = item('Delta lion', 199.5);
  assert.ok(matchReceipts([dep], [{ TxnDate: '2026-11-10', TotalAmt: 700, Line: [{ Amount: 199.5, DepositLineDetail: { Entity: { name: 'DELTAA LIONS' } } }, { Amount: 500 }] }]).has(dep));
  const late = item('Delta lion', 199.5);
  assert.ok(!matchReceipts([late], [rec('DELTAA LIONS', 199.5, '2026-11-20')]).has(late)); // outside the window
  assert.equal(expandRecords([rec('X', 100, '2026-11-09', { Line: [{ Amount: 100 }] })]).length, 1); // a line equal to the total is not repeated
});

test('why not found: the types and window searched, the same amount of another customer, the same customer with other amounts', () => {
  const it = item('Delta lion', 199.5);
  const text = whyNotFound(it, [rec('OMEGA WOOD', 199.5, '2026-11-09', { _type: 'Payment' }), rec('DELTAA LIONS', 250, '2026-11-08', { _type: 'Payment' })]);
  assert.match(text, /searched Payment, SalesReceipt, Deposit from 06\/11\/2026 to 12\/11\/2026/);
  assert.match(text, /same amount, another customer: Payment 09\/11\/2026 199\.50 OMEGA WOOD/);
  assert.match(text, /same customer \(±14 days\), other amounts: Payment 08\/11\/2026 250\.00 DELTAA LIONS/);
  assert.match(whyNotFound(item('Nobody', 5), []), /same amount, another customer: none; same customer \(±14 days\), other amounts: none/);
});

test('the owner command «check received <name>» is parsed', () => {
  assert.deepEqual(parseInvoiceCommand('check received Delta lion'), { type: 'received_check', name: 'Delta lion' });
  assert.deepEqual(parseInvoiceCommand('بررسی دریافتی دلتا'), { type: 'received_check', name: 'دلتا' });
});

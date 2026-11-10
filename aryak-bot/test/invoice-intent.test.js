import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { invoiceIntent, parseEnglishInvoice, parseInvoiceCommand, partialText } from '../src/qboinvoice.js';

// Invented customer and codes only.
const EXACT = 'Atossa invoice master wood\n505 =120m 10aed\n232 =22m\n211=5m';
const src = (name) => fs.readFileSync(path.join(import.meta.dirname, '..', 'src', name), 'utf8');

test('the owner\'s exact four-line message is ONE invoice request: the customer on the first line, one item per line, «505 =120m 10aed» is 120 m at 10 AED, the others at the system price', () => {
  const ic = parseInvoiceCommand(EXACT);
  assert.equal(ic.type, 'request'); assert.equal(ic.customer, 'master wood'); assert.deepEqual(ic.lines, ['505, 120, 10', '232 22', '211 5']);
  assert.deepEqual(parseEnglishInvoice(EXACT), { customer: 'master wood', lines: ['505, 120, 10', '232 22', '211 5'] });
  // every way to write the quantity, the unit and the price
  for (const [row, line] of [['505 =120m 10aed', '505, 120, 10'], ['505 = 120 m 10 aed', '505, 120, 10'], ['505=120m/10aed', '505, 120, 10'], ['505 = 120 mtr @10', '505, 120, 10'], ['505: 120 meters /10 aed', '505, 120, 10'], ['505 =120m 10.5aed', '505, 120, 10.5'], ['211=5m', '211 5'], ['211 = 5 mtr', '211 5'], ['211=5 pcs 3aed', '211, 5, 3'], ['232 =22m', '232 22']]) {
    assert.deepEqual(parseEnglishInvoice(`invoice master wood\n${row}`)?.lines, [line], row);
  }
  assert.equal(parseEnglishInvoice('invoice master wood\n505 120 10'), null); // a bare second number is not read as a price: the line is not understood
});

test('a message that opens with «invoice» is the invoice path and no other, in any wording and line layout', () => {
  for (const t of ['Atossa invoice master wood\n505=1m', 'invoice for master wood', 'Invoice master wood 505=10m', 'inv for master wood\n505=1m', 'inv to master wood', 'Hi Atossa, please invoice master wood', 'Atossa make an invoice for master wood', 'اینویس بزن برای مستر وود', 'فاکتور بساز مستر وود', 'آتوسا فاکتور مستر وود\n505 10', '\n\n  atossa   INVOICE   master wood']) assert.equal(invoiceIntent(t), true, t);
  for (const t of ['send the invoice of master wood', 'invoice status?', 'how is the invoice', 'master wood invoice', '505 invoice', 'کدام فاکتور؟', 'inv 9940', 'stock 505', '']) assert.equal(invoiceIntent(t), false, t);
});

test('a line that cannot be read: nothing is guessed and nothing falls to another path; what was read, the line number and the text, and that nothing was made', () => {
  const bad = 'Atossa invoice master wood\n505 =120m 10aed\n232 about twenty two meters\n211=5m';
  const ic = parseInvoiceCommand(bad);
  assert.equal(ic.type, 'request_partial'); assert.equal(ic.customer, 'master wood'); assert.deepEqual(ic.lines, ['505, 120, 10', '211 5']); assert.deepEqual(ic.unread, [{ n: 3, text: '232 about twenty two meters' }]);
  assert.equal(parseEnglishInvoice(bad), null); // the strict reader does not take a half list
  assert.equal(partialText(ic), [
    'Invoice request for master wood was NOT made: a line could not be read.', 'Read so far:', '• 505 — 120, price 10.00 AED', '• 211 — 5, system price',
    '⚠ line 3 not understood: "232 about twenty two meters"', 'Nothing was created, reserved or sent to anyone. Correct it and send the whole request again (customer on the first line, then one item per line: code = quantity, price optional).',
  ].join('\n'));
  // two bad lines are both said; a PO line is not a bad line; a head with no items says so
  const two = parseInvoiceCommand('invoice for zed\n505 ==5\nPO 1029\nhello there');
  assert.deepEqual(two.unread.map((u) => u.n), [2, 4]);
  assert.equal(parseInvoiceCommand('invoice for zed').type, 'request_partial'); assert.match(partialText(parseInvoiceCommand('invoice for zed')), /no item line was found/);
  // the head cannot be read: still the invoice path, with the first line said
  const noHead = parseInvoiceCommand('invoice inv-9940 please\n505=1m'); assert.equal(noHead.type, 'request_partial'); assert.deepEqual(noHead.unread, [{ n: 1, text: 'invoice inv-9940 please' }]);
});

test('the wiring: an invoice message never reaches the customer-order path, the stock path or the sales manager; the partial reply makes nothing', () => {
  const index = src('index.js');
  assert.match(index, /const ob = invoiceIntent\(text\) \? null : parseOnBehalf\(text\);/);
  assert.match(index, /case 'request': case 'request_partial': \{ const r = await qboInvoices\.request\(/);
  assert.match(index, /ic\?\.type === 'request' \|\| ic\?\.type === 'request_partial'/);
  const inv = src('qboinvoice.js');
  assert.doesNotMatch(inv, /managerMessage|salesManager|sock\.sendMessage/); // the invoice desk never writes to the sales manager or anyone
  assert.match(inv, /if \(cmd\?\.type === 'request_partial'\) return \{ requester: partialText\(cmd\)/); // answered before any preview, reservation or QuickBooks call
  const at = inv.indexOf("if (cmd?.type === 'request_partial')"); assert.ok(at > 0 && at < inv.indexOf('makePreview(', at));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { PriceBook, compareLine } from '../src/prices.js';
import { auditInvoice, mergeProblems } from '../src/audit.js';
import { productCode } from '../src/codes.js';
import { reportText } from '../src/invoice.js';

const book = () => {
  const b = new PriceBook('');
  b.save({ items: { 511: { price: 12, unit: 'm', category: 'PVC film' }, 107: { price: 13, unit: 'm', category: 'PVC film' }, 1806: { price: 8, unit: 'm', category: 'PVC film' }, 'E 1803': { price: 5, unit: 'm', category: '' } }, exceptions: [] });
  return b;
};
const line = (code, quantity, unit_price, line_total, unit = 'm') => ({ code, quantity, unit, unit_price, line_total });

test('the product code is the bare code, real letter codes stay', () => {
  for (const [a, b] of [['PVC FILM511', '511'], ['PVC FILM 511', '511'], ['FILM511', '511'], ['511 ARYAK', '511'], ['PVC 1806', '1806'], ['AR511', '511'], ['pvc film107', '107'],
    ['108 C', '108 C'], ['702 A', '702 A'], ['E 1803', 'E 1803'], ['TS 840', 'TS 840'], ['KG10-300', 'KG10-300'], ['ACCESSORIES-0453', 'ACCESSORIES-0453'], ['511', '511']]) assert.equal(productCode(a), b, a);
});

test('REGRESSION: a price below the list is caught on the codes as the real invoice prints them', () => {
  const b = book();
  for (const code of ['PVC FILM511', 'PVC FILM 511', 'FILM511', '511 ARYAK', '511']) {
    assert.equal(compareLine(b, { code, unit_price: 9, unit: 'm' }, '', '').status, 'below', code);
    const out = auditInvoice({ lines: [line(code, 10, 9, 90)], subtotal: 90, vat: 4.5, total: 94.5 }, { book: b, customer: 'x' });
    assert.deepEqual(out.map((p) => p.kind), ['price-below'], code);
  }
  // the thickness article of the real invoice: code 1806 is priced too
  assert.equal(compareLine(b, { code: 'PVC 1806', unit_price: 8, unit: 'm' }, '', '').status, 'ok');
  assert.equal(compareLine(b, { code: 'E 1803', unit_price: 5, unit: 'm' }, '', '').status, 'ok'); // the exact code first
});

test('a line that cannot be priced is said, and no list at all is said once', () => {
  const b = book();
  const out = auditInvoice({ lines: [line('PVC FILM999', 10, 9, 90)], subtotal: 90, vat: 4.5, total: 94.5 }, { book: b, customer: 'x' });
  assert.deepEqual(out.map((p) => [p.kind, p.severity]), [['price-unknown', 'info']]);
  assert.match(out[0].note, /در لیست نیست/);
  const none = auditInvoice({ lines: [line('511', 10, 9, 90), line('107', 5, 13, 65)] }, { book: new PriceBook(''), customer: 'x' });
  assert.deepEqual(none.map((p) => p.kind), ['prices-unchecked']);
});

test('one mistake is reported once: a wrong line, a wrong VAT, the model repeating a figure', () => {
  const b = book();
  // line 3 x 9 = 27 printed as 28: the line, not the subtotal or the total
  const wrongLine = { lines: [line('511', 3, 12, 37), line('107', 5, 13, 65)], subtotal: 102, vat: 5.1, total: 107.1 };
  assert.deepEqual(auditInvoice(wrongLine, { book: b, customer: 'x' }).map((p) => p.kind), ['line-total']);
  // VAT printed wrong while the total is right for the right VAT: only the VAT
  const wrongVat = { lines: [line('511', 10, 12, 120)], subtotal: 120, vat: 7, total: 126 };
  assert.deepEqual(auditInvoice(wrongVat, { book: b, customer: 'x' }).map((p) => p.kind), ['vat']);
  // the model said "total" for the same mistake the plain check found
  const plain = auditInvoice(wrongVat, { book: b, customer: 'x' });
  const merged = mergeProblems([{ kind: 'total', item: 'x', severity: 'urgent' }, { kind: 'vat', item: 'y', severity: 'urgent' }, { kind: 'quantity', item: '511', severity: 'urgent' }], plain);
  assert.deepEqual(merged.map((p) => p.kind), ['quantity', 'vat']);
});

test('the report never prints an empty "right" value', () => {
  const text = reportText({ verdict: 'mismatch', request_customer: 'x', problems: [{ kind: 'price-unknown', item: '999', requested: '', invoiced: '', note: 'قیمت این کد در لیست نیست، سنجیده نشد', severity: 'info' }, { kind: 'vat', item: '', requested: '5.00', invoiced: '7.00', note: '', severity: 'urgent' }] }, { groupName: 'g' });
  assert.ok(!text.includes('درست: —'));
  assert.match(text, /درست: 5.00 \| فاکتور: 7.00/);
  assert.match(text, /قیمت در لیست نیست: 999/);
});

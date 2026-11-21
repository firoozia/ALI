import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseDeliveryCaption, parseCutCaption, parsePaymentCaption } from '../src/captions.js';
import { supersedeRunningTotal } from '../src/tracker.js';
import { buildDigest } from '../src/digest.js';

test('goods in a delivery post are never customers (the owner, 21/11: «2 GALLON GLUE» and «5 BOX HINGES» were listed as customers)', () => {
  const d = parseDeliveryCaption('HAMID TRADING 2 ROLLS, 2 GALLON GLUE & 5 BOX HINGES PICKED UP BY MR HAMID');
  assert.deepEqual(d.customers.map((c) => c.customer), ['HAMID TRADING']);
  assert.deepEqual(d.goods, ['2 GALLON GLUE', '5 BOX HINGES']);
  assert.equal(parseDeliveryCaption('HINGES 2 BOX TYPE A DISPATCHED').customers.length, 0);
  assert.deepEqual(parseDeliveryCaption('MICE INTERIORS GLUE DISPATCHED').customers.map((c) => c.customer), ['MICE INTERIORS']);
  assert.deepEqual(parseDeliveryCaption('DESIGNER WOOD 1 ROLL & DADDY DOOR 2 ROLLS PICKED UP NASIX COURIER').customers.map((c) => c.customer), ['DESIGNER WOOD', 'DADDY DOOR']);
});

test('a length with no unit at the end of a cut post is metres, not part of the name (live 21/11: «ART NO 201 DESIGNER WOOD 30.»)', () => {
  const c = parseCutCaption('ART NO 201 DESIGNER WOOD 30.');
  assert.equal(c.quantity, 30); assert.equal(c.customer, 'DESIGNER WOOD'); assert.equal(c.code, '201');
  assert.equal(parseCutCaption('ART NO 213 MASTER WOOD 10M').quantity, 10);
  assert.equal(parseCutCaption('ART NO 228 DANDY DOOR 20.7+25=44.7M').quantity, 44.7);
  assert.deepEqual(parseDeliveryCaption('AL AFEEF 2 PCS DELIVERED').customers.map((x) => x.customer), ['AL AFEEF'], 'a count of pieces stays with the customer');
});

test('a running total takes the place of the earlier post of its first pieces (live 21/11: 20.7M, then 20.7+25=44.7M)', () => {
  const now = Date.parse('2026-11-21T08:00:00Z');
  const events = [
    { type: 'cut', ref: 'a', at: now, customer: 'DANDY DOORS', customerTyped: 'DANDY DOOR', lines: [{ code: '228', quantity: 20.7, unit: 'm' }] },
    { type: 'cut', ref: 'o', at: now, customer: 'OTHER', customerTyped: 'OTHER', lines: [{ code: '228', quantity: 20.7, unit: 'm' }] },
    { type: 'cut', ref: 'i', at: now, customer: 'DANDY DOORS', customerTyped: 'DANDY DOOR', lines: [{ code: '228', quantity: 25, unit: 'm', invoiced: { number: 'inv-1' } }] },
  ];
  const ev = { type: 'cut', ref: 'b', at: now + 14 * 60000, customer: 'DANDY DOORS', customerTyped: 'DANDY DOOR', pieces: [20.7, 25], lines: [{ code: '228', quantity: 44.7, unit: 'm' }] };
  assert.equal(supersedeRunningTotal(events, ev), 1);
  assert.equal(events[0].supersededBy, 'b'); assert.equal(events[0].lines[0].quantity, 0); assert.equal(events[0].lines[0].was, 20.7);
  assert.equal(events[1].lines[0].quantity, 20.7, 'another customer is untouched');
  assert.equal(events[2].lines[0].quantity, 25, 'an invoiced line is untouched');
  const later = [{ type: 'cut', ref: 'x', at: now, customer: 'DANDY DOORS', lines: [{ code: '409', quantity: 4, unit: 'm' }] }];
  assert.equal(supersedeRunningTotal(later, { type: 'cut', ref: 'y', at: now + 5 * 60000, customer: 'DANDY DOORS', pieces: [12, 4], lines: [{ code: '409', quantity: 16, unit: 'm' }] }), 1, 'the last piece too (15/11: 4M, then 12+4=16M)');
  // the summary counts it once, no opened roll, no dispatch as a delivery
  const day = '2026-11-21';
  const all = [...events.slice(0, 1), ev,
    { type: 'cut', internal: true, at: now, lines: [{ code: '204', quantity: 140 }] },
    { type: 'delivery', status: 'dispatched', at: now, customer: 'A' }, { type: 'delivery', status: 'delivered', at: now, customer: 'A' }, { type: 'delivery', status: 'picked-up', at: now, customer: 'B' }];
  const text = buildDigest({ history: [], requests: [], day, events: all });
  assert.match(text, /برش‌های ثبت‌شده: 1\n/);
  assert.match(text, /تحویل‌ها: 2\n/);
});

test('the summary\'s «cuts with no invoice» comes from QuickBooks, and it names the invoices Atossa made (the owner, 21/11)', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(src, /async function cutsNoInvoiceCount\(\)/);
  assert.match(src, /Cuts with no invoice in QuickBooks yet \(a day old or more\)/);
  assert.match(src, /Invoices made by Atossa in QuickBooks: \$\{made\.length\}/);
});

test('a month number and a stock question are never money (the owner, 21/11: «Al ebda month 10» was a payment of 10 AED)', () => {
  const m = parsePaymentCaption('Al ebda month 10');
  assert.ok(!m || !(Number(m.amount) > 0), JSON.stringify(m));
  assert.equal(parsePaymentCaption('307 available one roll in China stock?'), null);
  assert.equal(parsePaymentCaption('AL EBDA 5000 cheque for month 10').amount, 5000);
  assert.equal(parsePaymentCaption('Cash from pvc work 789.5 aed').amount, 789.5);
  const text = buildDigest({ history: [], requests: [], day: '2026-11-21', events: [
    { type: 'payment', kind: 'transfer', amount: 0, noAmount: true, at: Date.parse('2026-11-10T10:00:00Z') },
    { type: 'payment', kind: 'cash', amount: 500, at: Date.parse('2026-11-10T10:00:00Z') }] });
  assert.match(text, /\(«CLEARED» نخورده\): 1/);
});

test('an amount is money only with AED beside it; otherwise nothing is recorded and the group is asked (the owner, 21/11)', async () => {
  const { eventsFromCaption, aedBeside } = await import('../src/captionevents.js');
  const ask = eventsFromCaption('payment', 'Cash received from Alia wood 176.40');
  assert.deepEqual(ask.askAed, { amount: 176.4, customers: ['Alia wood'] });
  assert.equal(ask.events, undefined, 'nothing recorded');
  for (const t of ['Cash received from Alia wood 176.40 AED', 'Cash received from Alia wood AED 176.40', 'Cash received from Alia wood 176.40aed', 'نقد از الیا وود ۱۷۶٫۴۰ درهم']) {
    const r = eventsFromCaption('payment', t.replace('٫', '.'));
    assert.equal(r.events?.[0]?.amount, 176.4, t);
  }
  assert.equal(aedBeside('AED 3,500 from Zeta', 3500), true);
  assert.equal(aedBeside('3500 Zeta 10 AED', 3500), false, 'AED beside another number does not count');
  assert.ok(eventsFromCaption('payment', 'AL AFEEFI KITCHEN OMR = 567').events, 'a foreign currency keeps its own rule');
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(src, /Please write the amount with AED beside it, for example/);
  assert.match(src, /officeAsked\.has\('aed\|' \+ raw\.key\.id\)/, 'asked once per message');
});

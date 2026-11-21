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
  // the owner, 21/11: the money shape without AED is asked again with AED (the shape reader gives no customer list with it)
  const ask = eventsFromCaption('payment', 'CASH RECEIVED FROM Alia wood 176.40');
  assert.equal(ask.askAed?.amount, 176.4);
  assert.equal(ask.events, undefined, 'nothing recorded');
  for (const t of ['CASH RECEIVED FROM Alia wood 176.40 AED', 'CASH RECEIVED FROM Alia wood AED 176.40', 'CASH RECEIVED FROM Alia wood 176.40aed', 'Cash received from Alia wood 176.40 AED', 'CASH RECEIVED FROM Alia wood ۱۷۶٫۴۰ درهم']) {
    const r = eventsFromCaption('payment', t);
    assert.equal(r.events?.[0]?.amount, 176.4, t);
    assert.equal(r.events[0].customer, 'Alia wood', t);
  }
  // the owner, 21/11: only the fixed money shapes are money; anything else is asked
  assert.equal(eventsFromCaption('payment', 'نقد از الیا وود ۱۷۶٫۴۰ درهم').askWhat, 'confirmation');
  assert.equal(aedBeside('AED 3,500 from Zeta', 3500), true);
  assert.equal(aedBeside('3500 Zeta 10 AED', 3500), false, 'AED beside another number does not count');
  assert.ok(eventsFromCaption('payment', 'AL AFEEFI KITCHEN OMR = 567').events, 'a foreign currency keeps its own rule');
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(src, /Please write the amount with AED beside it, for example/);
  assert.match(src, /officeAsked\.has\('aed\|' \+ raw\.key\.id\)/, 'asked once per message');
});

test('money is written in the fixed shapes with AED; a small slip in the opening words is read as meant; anything else with an amount is asked (the owner, 21/11)', async () => {
  const { eventsFromCaption } = await import('../src/captionevents.js');
  const { readMoneyShape } = await import('../src/moneyshape.js');
  const one = (t) => eventsFromCaption('payment', t)?.events?.[0];
  for (const [text, kind, amount, who] of [
    ['CASH RECEIVED FROM master wood 500 AED', 'cash', 500, 'master wood'],
    ['cash recived form master wood 500 aed', 'cash', 500, 'master wood'], // two slips: RECIVED, FORM
    ['TRANSFER BANK FROM master wood 2500 AED', 'transfer', 2500, 'master wood'],
    ['BANK TRANSFER FROM master wood 2500 AED', 'transfer', 2500, 'master wood'],
    ['CHEQUE RECEIVED FROM master wood 3000 AED', 'cheque', 3000, 'master wood'],
    ['TRANSFER TO BOSS 18000 AED', 'cash_to_boss', 18000, ''],
    ['TRANSFAR TO BOS 18000 AED', 'cash_to_boss', 18000, ''], // two slips: TRANSFAR, BOS
  ]) {
    const e = one(text);
    assert.equal(e?.kind, kind, text); assert.equal(e.amount, amount, text); assert.equal(e.customer, who, text); assert.equal(e.currency, 'AED', text);
  }
  const chq = one('CHEQUE RECEIVED FROM master wood 3000 AED dated 20/12');
  assert.equal(chq.kind, 'cheque'); assert.equal(chq.customer, 'master wood'); assert.match(chq.chequeDate, /-12-20$/);
  const adv = one('ADVANCE TO Raju 500 AED');
  assert.equal(adv.kind, 'salary_advance'); assert.equal(adv.amount, 500); assert.equal(adv.employee, 'Raju'); assert.equal(adv.customer, '');
  // not a shape: nothing recorded, the group is asked what it is for
  for (const t of ['Zeta 1500', 'Al ebda month 10']) {
    const r = eventsFromCaption('payment', t);
    assert.equal(r?.askWhat, 'confirmation', t); assert.equal(r.events, undefined, t);
  }
  // the shape without AED: asked to write it again with AED
  const noAed = eventsFromCaption('payment', 'CASH RECEIVED FROM Alia wood 176.40');
  assert.equal(noAed.askAed?.amount, 176.4); assert.equal(noAed.events, undefined);
  // a clearing and the bank's own message keep their own reading
  assert.equal(eventsFromCaption('payment', 'CLEARED').cleared, true);
  const sms = one('Your AC No: XXXXXXXX1234 is credited with AED 708.75 for Aani Instant Payments. Login to Online Banking for details.');
  assert.equal(sms.kind, 'transfer'); assert.equal(sms.amount, 708.75); assert.equal(sms.customer, '');
  // the expenses group's own shape
  const exp = readMoneyShape('CASH PAID FOR water 200 AED', 'expenses');
  assert.equal(exp.kind, 'cash_expense'); assert.equal(exp.amount, 200);
});

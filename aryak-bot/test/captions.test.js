import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCutCaption, parseDeliveryCaption, matchCod, parsePaymentCaption, parseGoodsCaption,
  codeFromItem, variantOf, invoiceFileInfo, deletedInvoice, trnNote, unitConflict,
} from '../src/captions.js';

test('cut group captions: a sale, a letter variant, two pieces, an opened roll, a damaged piece, a bare name', () => {
  assert.deepEqual(parseCutCaption('ART NO 410 DANDY DOOR 6M'), { code: '410', customer: 'DANDY DOOR', quantity: 6, unit: 'm', kind: 'cut' });
  const v = parseCutCaption('ART NO 108 C PVC WORKS 40M');
  assert.deepEqual([v.kind, v.code, v.customer, v.quantity], ['cut', '108 C', 'PVC WORKS', 40]);
  assert.deepEqual([parseCutCaption('ART NO 409 MUNICH DOOR KITCHEN 40M').customer, parseCutCaption('ART NO 409 MUNICH DOOR KITCHEN 40M').quantity], ['MUNICH DOOR KITCHEN', 40]);
  const two = parseCutCaption('ART NO 408 BAHAR 18+12 = 30M');
  assert.deepEqual([two.quantity, two.pieces, two.customer], [30, [18, 12], 'BAHAR']);
  for (const t of ['ART NO 303 120M FOR CUT.', 'ART NO 220 120M FOR CUT.']) {
    const r = parseCutCaption(t);
    assert.deepEqual([r.kind, r.quantity, r.customer], ['open-roll', 120, ''], t); // not a customer's order
  }
  const d = parseCutCaption('ART NO 402 HIGH POINT 3M DAMAGED PIECE');
  assert.deepEqual([d.kind, d.customer, d.quantity], ['damage', 'HIGH POINT', 3]);
  assert.deepEqual(parseCutCaption('AL AFFEFI KITCHEN'), { kind: 'name', customer: 'AL AFFEFI KITCHEN' });
  assert.equal(parseCutCaption('ok thanks'), null);
});

test('delivery captions: cash on delivery, several customers in one line, statuses; the courier is dropped', () => {
  const c = parseDeliveryCaption('PVC WORKS (COD 908.25)');
  assert.deepEqual([c.customers[0].customer, c.cod], ['PVC WORKS', 908.25]);
  assert.equal(parseDeliveryCaption('GR DECENT TIMBER (COD 1,386)').cod, 1386);
  const s = parseDeliveryCaption('MUNICH DOOR KITCHEN 1 ROLL, DESIGNER WOOD 1 ROLL, DANDY DOOR 1 ROLL & PVC WORKS 1 ROLL PICKED UP BY AHMED');
  assert.equal(s.status, 'picked-up');
  assert.deepEqual(s.customers.map((x) => [x.customer, x.quantity, x.unit]), [['MUNICH DOOR KITCHEN', 1, 'roll'], ['DESIGNER WOOD', 1, 'roll'], ['DANDY DOOR', 1, 'roll'], ['PVC WORKS', 1, 'roll']]);
  assert.equal(s.by, 'AHMED'); assert.ok(!s.customers.some((x) => JSON.stringify(x).includes('AHMED'))); // the courier is kept as the one it was handed to, never as a customer
  assert.equal(parseDeliveryCaption('AL AHLIA delivered').status, 'delivered');
  assert.equal(parseDeliveryCaption('GR DISPATCHED').status, 'dispatched');
  assert.equal(parseDeliveryCaption('PICKED UP BY CLIENT DRIVER').customers.length, 0);
  assert.equal(parseDeliveryCaption('hello'), null);
});

test('a COD amount is one open invoice total or a few together; otherwise it is a note', () => {
  assert.deepEqual(matchCod(908.25, [865 * 1.05]), [0]); // 865 plus 5 percent
  assert.deepEqual(matchCod(1386, [500, 840, 546]), [0, 1, 2].filter((i) => [840, 546].includes([500, 840, 546][i])));
  assert.equal(matchCod(999, [865 * 1.05, 100]), null);
  assert.equal(matchCod(100, []), null);
});

test('money group captions in all the shapes seen', () => {
  const cases = [
    ['1500 dandy', ['dandy']], ['1500 from dandy', ['dandy']], ['dandy 1500 Received', ['dandy']], ['Dandy 1500 RECEIVED BY KHAN', ['Dandy']],
    ['1500 cash received from dandy', ['dandy']], ['1500 RECEIVED dandy', ['dandy']], ['cash from atlas + aliwood 2000', ['atlas', 'aliwood']],
  ];
  for (const [t, who] of cases) {
    const r = parsePaymentCaption(t);
    assert.equal(r.kind, 'cash', t);
    assert.deepEqual(r.customers, who, t);
  }
  assert.equal(parsePaymentCaption('1,250.50 al ahlia').amount, 1250.5);
  assert.equal(parsePaymentCaption('Your AC No: XXXXXXXX1234 is credited with AED 5,000.00 for Outward Cheque Clearing').amount, 5000);
  assert.ok(!JSON.stringify(parsePaymentCaption('Your AC No: XXXXXXXX1234 is credited with AED 5,000.00 for Outward Cheque Clearing')).includes('1234'));
  assert.deepEqual(parsePaymentCaption('clear inv 9808 / 9809 / 9810'), { kind: 'clear-invoices', invoices: ['inv-9808', 'inv-9809', 'inv-9810'] });
  for (const t of ['CLEARED', 'cleared', 'CLEARED TWO CUSTOMER']) assert.equal(parsePaymentCaption(t).kind, 'cleared', t);
  assert.equal(parsePaymentCaption('300 sell car').kind, 'expense');
  assert.deepEqual(parsePaymentCaption('Dandy'), { kind: 'name', customer: 'Dandy' });
});

test('goods groups: counted items for a customer, and stock that arrives', () => {
  const a = parseGoodsCaption('HINGES TYPE A 20 BOX FOR SHJ CUSTOMER');
  assert.deepEqual([a.kind, a.item, a.quantity, a.unit, a.customer], ['goods', 'HINGES TYPE A', 20, 'box', 'SHJ CUSTOMER']);
  const b = parseGoodsCaption('SLIDE DRAWER SIZE 35 SOFT CLOSE 4 BOX');
  assert.deepEqual([b.quantity, b.unit], [4, 'box']);
  assert.equal(parseGoodsCaption('SLIDE DRAWER SIZE 45 NORMAL 4BOX').quantity, 4);
  const c = parseGoodsCaption('SAW BLADE 2 NOS SIZE 120 FOR HAMID TRD');
  assert.deepEqual([c.quantity, c.unit, c.customer], [2, 'pcs', 'HAMID TRD']);
  assert.equal(parseGoodsCaption('JOWAT GILLU HIGH POINT 4 GALLEN').unit, 'gallon');
  assert.equal(parseGoodsCaption('Lipping glue 2 bag for al afeefi').customer, 'al afeefi');
  for (const t of ['JUWAT 10 GALLEN RECEIVED', '250 Bags Received']) { const r = parseGoodsCaption(t); assert.deepEqual([r.kind, r.customer], ['received', ''], t); }
  assert.match(parseGoodsCaption('JUWAT 10 GALLEN RECEIVED').item, /JOWAT/); // spelling variants of the glue name meet
  assert.equal(parseGoodsCaption('hello'), null);
});

test('invoice items, variants, file names, deleted numbers, TRN and unit notes', () => {
  assert.equal(codeFromItem('PVC FILM107'), '107');
  assert.equal(codeFromItem('PVC 1806'), '1806');
  assert.equal(codeFromItem('108 ARYAK'), '108');
  assert.equal(codeFromItem('108 C'), '108 C');
  assert.equal(codeFromItem('KG10-300'), 'KG10-300');
  assert.equal(codeFromItem('ACCESSORIES-0453'), 'ACCESSORIES-0453');
  assert.deepEqual(variantOf('108 C'), { base: '108', letter: 'C' });
  assert.equal(variantOf('108'), null);
  assert.deepEqual(invoiceFileInfo('Invoice inv-9903 dandy.pdf'), { number: 'inv-9903', customer: 'dandy', extra: '' });
  assert.deepEqual(invoiceFileInfo('inv-8216 nuqoosh 309 11 rolls.pdf'), { number: 'inv-8216', customer: 'nuqoosh', extra: '309 11 rolls' });
  assert.deepEqual(invoiceFileInfo('Invoice inv-9063 (1).pdf'), { number: 'inv-9063', customer: '', extra: '' });
  assert.equal(invoiceFileInfo('Invoice inv-9900 kitchen palace.pdf').customer, 'kitchen palace');
  assert.equal(deletedInvoice('Invoice inv-9910 delete this one for Bahar'), 'inv-9910');
  assert.equal(deletedInvoice('thanks'), null);
  assert.equal(trnNote('808445'), 'شمارهٔ مالیاتی مشتری 6 رقم دارد و باید 15 رقم باشد');
  assert.equal(trnNote('100123456789012'), '');
  assert.equal(trnNote(''), '');
  assert.match(unitConflict('ARY VACRONE PVC GLUE 25KG', 1, 'Kilogram'), /۲۵|25/);
  assert.equal(unitConflict('PVC FILM', 1, 'Kilogram'), '');
});

// ---------------------------------------------------------------------------------------------------- the tracker side
import { Tracker, checkCod, checkInvoiceAgainstCuts, markCleared, unclearedPayments } from '../src/tracker.js';
import { checkNumber } from '../src/audit.js';
import { buildDigest } from '../src/digest.js';
import { eventsFromCaption } from '../src/captionevents.js';

test('captions become events: an opened roll is internal, several customers in one delivery line, bank SMS keeps no account', () => {
  assert.equal(eventsFromCaption('cut', 'ART NO 303 120M FOR CUT.').events[0].internal, true);
  assert.equal(eventsFromCaption('cut', 'ART NO 410 DANDY DOOR 6M').events[0].customer, 'DANDY DOOR');
  const d = eventsFromCaption('delivery', 'DANDY DOOR 1 ROLL & PVC WORKS 1 ROLL PICKED UP BY X');
  assert.deepEqual(d.events.map((e) => e.customer), ['DANDY DOOR', 'PVC WORKS']);
  assert.equal(eventsFromCaption('payment', '300 sell car').ignore, true);
  assert.equal(eventsFromCaption('payment', 'CLEARED').cleared, true);
  assert.ok(!JSON.stringify(eventsFromCaption('payment', 'Your AC No: XXXX9999 is credited with AED 10.00')).includes('9999'));
  assert.equal(eventsFromCaption('goods', 'JUWAT 10 GALLEN RECEIVED'), null); // goods arriving are kept by received.js
  assert.equal(eventsFromCaption('cut', 'good morning'), null);
});

test('an opened roll never counts as a sale against an invoice; a cash item stays open until CLEARED', () => {
  const t = new Tracker();
  const now = Date.parse('2026-11-05T08:00:00Z');
  t.add({ type: 'cut', at: now - 3600000, customer: 'Dandy', lines: [{ code: '410', quantity: 6, unit: 'm' }], ref: 'c1' });
  t.add({ type: 'cut', at: now - 3000000, customer: '', internal: true, lines: [{ code: '303', quantity: 120, unit: 'm' }], ref: 'c2' });
  const inv = { at: now, customer: 'Dandy', lines: [{ code: '303', quantity: 120, unit: 'm' }, { code: '410', quantity: 6, unit: 'm' }] };
  const out = checkInvoiceAgainstCuts(t, inv);
  assert.equal(out.length, 1);
  assert.match(out[0], /303/);
  t.add({ type: 'payment', kind: 'cash', at: now - 7200000, customer: 'Dandy', amount: 100, ref: 'p1' });
  t.add({ type: 'payment', kind: 'cash', at: now - 3600000, customer: 'Atlas', amount: 50, ref: 'p2' });
  assert.equal(unclearedPayments(t, { now }).length, 2);
  assert.match(buildDigest({ history: [], requests: [], day: '2026-11-05', events: t.events }), /تأییدنشده.*: 2/);
  assert.equal(markCleared(t, 'p2').ref, 'p2'); // the reply names the item
  assert.equal(markCleared(t).ref, 'p1'); // else the oldest open one
  assert.equal(markCleared(t), null);
});

test('cash on delivery against the invoices of the customer, and a deleted invoice number is not a gap', () => {
  const t = new Tracker();
  const now = Date.parse('2026-11-05T08:00:00Z');
  t.add({ type: 'invoice', at: now - 86400000, customer: 'PVC WORKS', total: 908.25, ref: 'i1' });
  assert.deepEqual(checkCod(t, { at: now, customer: 'PVC WORKS', cod: 908.25 }), []);
  assert.equal(checkCod(t, { at: now, customer: 'PVC WORKS', cod: 500 }).length, 1);
  assert.deepEqual(checkCod(t, { at: now, customer: 'Nobody', cod: 500 }), []);
  assert.equal(checkNumber('inv-9912', ['inv-9910']).length, 1);
  assert.deepEqual(checkNumber('inv-9912', ['inv-9910'], new Set(['inv-9911'])), []);
  t.markDeleted('inv-9911');
  assert.ok(new Tracker().deleted.size === 0 && t.deleted.has('inv-9911'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Tracker } from '../src/tracker.js';
import { crossCheck, markCutsInvoiced, sameCutCustomer } from '../src/cuts.js';
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
    '503: cut 8m on 07/11, not invoiced',
  ]); // 509: cut 12m against an invoice of 10 is normal (the invoice follows the order, not the cut)
  const clean = new Tracker({ dir: '' });
  cut(clean, 'k1', 'MASTER WOOD', '505', 10, 1);
  assert.deepEqual(crossCheck(clean, 'MASTER WOOD', [{ code: '505', qty: 10 }], { now: NOW, invoiced: [] }).problems, []);
  assert.deepEqual(crossCheck(new Tracker({ dir: '' }), 'MASTER WOOD', [{ code: '505', qty: 10 }], { now: NOW, invoiced: [] }).problems, ['505: no order found']);
  // old cuts (outside the window) and the team's internal entries are not orders
  const old = new Tracker({ dir: '' });
  cut(old, 'o1', 'MASTER WOOD', '505', 10, 90); cut(old, 'o2', 'MASTER WOOD', '505', 10, 1, { internal: true });
  assert.deepEqual(crossCheck(old, 'MASTER WOOD', [{ code: '505', qty: 10 }], { now: NOW }).problems, ['505: no order found']);
});

test('the owner\'s rule: an invoice line of the same customer and code on or after the cut day counts as invoiced WHATEVER its quantity; a cut larger than the invoice is never a warning; an invoice larger than the cut is', () => {
  const tr = new Tracker({ dir: '' });
  cut(tr, 'a1', 'MASTER WOOD', '216', 12, 5); cut(tr, 'a2', 'MASTER WOOD', '235', 6, 4); cut(tr, 'a3', 'MASTER WOOD', '203', 9, 3); cut(tr, 'a4', 'MASTER WOOD', '512', 7, 2); cut(tr, 'a5', 'MASTER WOOD', '410', 4, 1);
  const at = (daysAgo) => NOW - daysAgo * DAY;
  const invoiced = [
    { codes: ['216', 'PVC FILM216'], qty: 12, number: 'inv-9906', at: at(4) },   // the office, on the screen: the whole cut
    { codes: ['235', 'PVC FILM235'], qty: 4, number: 'inv-9918', at: at(3) },    // a smaller quantity than the cut: the order was 4, still invoiced
    { codes: ['203', 'PVC FILM203'], qty: 9, number: 'inv-9929', at: at(10) },   // dated BEFORE the cut: another order
  ];
  const { problems } = crossCheck(tr, 'MASTER WOOD', [], { now: NOW, invoiced });
  assert.deepEqual(problems, ['203: cut 9m on 05/11, not invoiced', '512: cut 7m on 06/11, not invoiced', '410: cut 4m on 07/11, not invoiced']); // 216 and 235 are invoiced
  assert.deepEqual(crossCheck(tr, 'MASTER WOOD', [], { now: NOW, invoiced: null }).problems, []); // QuickBooks could not be read: nothing claimed
  assert.deepEqual(crossCheck(tr, 'MASTER WOOD', [{ code: '216', qty: 12 }], { now: NOW, invoiced }).problems.slice(0, 1), ['216: already invoiced (inv-9906) on 04/11']); // a double invoice names its number
  // a cut larger than the invoice (a margin, the end of a roll) is normal
  const margin = new Tracker({ dir: '' });
  cut(margin, 'm1', 'MASTER WOOD', '303', 6.4, 1); cut(margin, 'm2', 'MASTER WOOD', '702', 4.4, 1);
  assert.deepEqual(crossCheck(margin, 'MASTER WOOD', [{ code: '303', qty: 6 }, { code: '702', qty: 4 }], { now: NOW, invoiced: [] }).problems, []);
  // an invoice larger than the cut is charged for more than was cut
  assert.deepEqual(crossCheck(margin, 'MASTER WOOD', [{ code: '303', qty: 7 }], { now: NOW, invoiced: [] }).problems.slice(0, 1), ['303: invoice has 7, cut 6.4m on 07/11']);
  // the invoice a few days later still takes the cut; an invoice dated before the cut does not
  const later = new Tracker({ dir: '' });
  cut(later, 'l1', 'MASTER WOOD', '215', 11, 4);
  assert.deepEqual(crossCheck(later, 'MASTER WOOD', [], { now: NOW, invoiced: [{ codes: ['PVC FILM215'], qty: 3, number: 'inv-1', at: at(1) }] }).problems, []);
  assert.equal(crossCheck(later, 'MASTER WOOD', [], { now: NOW, invoiced: [{ codes: ['PVC FILM215'], qty: 11, number: 'inv-0', at: at(9) }] }).problems.length, 1);
});

test('the customer of a post must be THIS customer: a trade word shared with another customer (door, kitchen, wood, trading, LLC) never joins them; the brand word does', () => {
  const tr = new Tracker({ dir: '' });
  const post = (ref, customer, code, daysAgo) => cut(tr, ref, customer, code, 5, daysAgo);
  post('p1', 'Munich door', '303', 1);                       // the caption names Munich
  post('p2', 'AL NOOR DOOR KITCHEN TRADING LLC', '215', 1);  // another customer that shares «door kitchen trading llc»
  post('p3', 'HIGH POINT WOOD DOOR', '702', 1);              // and another
  post('p4', 'MUNICH DOOR KITCHEN', '220', 1);               // the same customer, written longer
  const books = 'MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C';
  const log = [];
  const { problems } = crossCheck(tr, books, [{ code: '303', qty: 5 }], { now: NOW, invoiced: [], log: (x) => log.push(x) });
  assert.deepEqual(problems, ['220: cut 5m on 07/11, not invoiced']); // 215 and 702 belong to other customers: not listed
  assert.ok(log.some((l) => l.includes('posts named: Munich door')));
  assert.ok(!log.some((l) => l.includes('AL NOOR')));
  for (const [a, b, want] of [['Munich door', books, true], ['NUQOOSH', 'NUQOOSH IND . LLC', true], ['AL NOOR DOOR KITCHEN TRADING LLC', books, false], ['HIGH POINT WOOD DOOR', 'HIGH POINT TRADING', true], ['AL BURTOMANI NATIONAL', 'ARABIAN NATIONAL', false], ['DOOR TRADING', books, false]]) assert.equal(sameCutCustomer(a, b), want, `${a} / ${b}`);
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

// ------------------------------------------------------------------------------------------------ the shapes of the real cut posts (invented customers)
import { parseCutCaption } from '../src/captions.js';
import { eventsFromCaption } from '../src/captionevents.js';
import fs from 'node:fs';
import path from 'node:path';

test('cut posts: several pieces added, a stated total kept, 1.8×2 as two pieces, «INVOICE 14.5M» is the invoiced quantity; a roll «FOR CUT» is never a customer\'s cut', () => {
  assert.deepEqual(parseCutCaption('ART NO 105 AR RAD 6+3.5+3.2+2.7= INVOICE 14.5M'), { code: '105', customer: 'AR RAD', quantity: 15.4, unit: 'm', pieces: [6, 3.5, 3.2, 2.7], invoiceQuantity: 14.5, kind: 'cut' });
  assert.deepEqual(parseCutCaption('ART NO 105 AR RAD 19+11+2.5=32.7M'), { code: '105', customer: 'AR RAD', quantity: 32.7, unit: 'm', pieces: [19, 11, 2.5], kind: 'cut' });
  assert.deepEqual(parseCutCaption('ART NO 108 AR RAD 1.8×2 M'), { code: '108', customer: 'AR RAD', quantity: 3.6, unit: 'm', pieces: [1.8, 1.8], kind: 'cut' });
  assert.deepEqual(parseCutCaption('ART NO 410 DANDY DOOR 18+12 = 30M'), { code: '410', customer: 'DANDY DOOR', quantity: 30, unit: 'm', pieces: [18, 12], kind: 'cut' });
  assert.equal(parseCutCaption('ART NO 303 MUNICH DOOR KITCHEN 6.4M').quantity, 6.4);
  assert.deepEqual(parseCutCaption('ART NO 235 120M FOR CUT'), { code: '235', customer: '', quantity: 120, unit: 'm', kind: 'open-roll' });
  const roll = eventsFromCaption('cut', 'ART NO 235 120M FOR CUT').events[0];
  assert.equal(roll.internal, true); assert.equal(roll.customer, '');
  const event = eventsFromCaption('cut', 'ART NO 105 AR RAD 6+3.5+3.2+2.7= INVOICE 14.5M').events[0];
  assert.equal(event.lines[0].quantity, 15.4); assert.equal(event.lines[0].invoiceQuantity, 14.5);
  // the roll prepared for cutting is never a customer's cut in the cross-check
  const tr = new Tracker({ dir: '' });
  tr.add({ type: 'cut', at: NOW - DAY, ...roll, ref: 'r1' }); tr.add({ type: 'cut', at: NOW - DAY, ...event, ref: 'r2' });
  assert.deepEqual(crossCheck(tr, 'AR-RAD INTERNATIONAL', [{ code: '235', qty: 20 }], { now: NOW, invoiced: [] }).problems, ['235: no order found']);
  // the post says 14.5 was invoiced: an invoice of 14.5 or less is fine, more than that is not
  assert.deepEqual(crossCheck(tr, 'AR RAD', [{ code: '105', qty: 14.5 }], { now: NOW, invoiced: [] }).problems, []);
  assert.deepEqual(crossCheck(tr, 'AR RAD', [{ code: '105', qty: 15 }], { now: NOW, invoiced: [] }).problems, ['105: invoice has 15, cut 14.5m on 07/11']);
});

test('a voice note the person replies to («this one») goes the same way as a sent one', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const at = src.indexOf('the quoted voice note goes the same way a sent one does');
  const block = src.slice(at - 100, at + 1100);
  assert.match(block, /!audio && !image && addressed && config\.voiceEnabled && ctx\.quotedMessage && ctx\.stanzaId/);
  assert.match(block, /audioRaw = \{ key: \{ remoteJid: chatId, id: ctx\.stanzaId, participant: ctx\.participant \}, message: ctx\.quotedMessage \}/);
  assert.match(src, /downloadMediaMessage\(audioRaw, 'buffer', \{\}\), audio\.seconds/); // the quoted message is the one downloaded
  assert.match(src, /let audio = config\.voiceEnabled \? content\?\.audioMessage : null;\s*let audioRaw = raw;/);
});

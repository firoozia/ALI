import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpenseStore, expenseAsk, expensesText } from '../src/expenses.js';
import { parseCutCaption } from '../src/captions.js';
import { Tracker, reconcileCuts, settleCuts } from '../src/tracker.js';
import { cutFindingText } from '../src/finding.js';

// Invented customers and amounts only.
const DAY = 86400000;
const T0 = Date.parse('2026-11-10T08:00:00Z');
const cutEv = (customer, code, qty, at, ref, pieces) => ({ type: 'cut', at, customer, ref, lines: [{ code, quantity: qty, unit: 'm' }], ...(pieces ? { pieces } : {}) });

test('a question to Atossa in the expenses group: her name alone = today; name + expenses + a word of asking = the period; other talk is not it', () => {
  assert.equal(expenseAsk('Atossa'), 'today'); assert.equal(expenseAsk('Atossa?'), 'today'); assert.equal(expenseAsk('آتوسا'), 'today');
  assert.equal(expenseAsk('Atossa check all expenses in this group'), 'all'); assert.equal(expenseAsk('Atossa show expenses of the week'), 'week');
  assert.equal(expenseAsk('atossa expenses report this month'), 'month'); assert.equal(expenseAsk('Atossa list the expenses'), 'today');
  for (const t of ['85.5 fuel', 'check all expenses', 'Atossa what time is it', 'thanks Atossa for the receipt']) assert.equal(expenseAsk(t), null, t);
});

test('an expense made in the test group before test data was kept apart is marked once and is then in no real report', () => {
  const s = new ExpenseStore('');
  s.add({ state: 'done', day: '2026-11-10', amount: 85.5, category: 'fuel', by: 'x' }); s.add({ state: 'done', day: '2026-11-10', amount: 20, category: 'food', by: 'x' });
  const range = { from: '2026-11-10', to: '2026-11-10', label: '10/11' };
  assert.equal(s.done(range).length, 2);
  assert.equal(s.markTestOnce('m1', ['E1', 'E9']), 1); assert.equal(s.done(range).length, 1); assert.doesNotMatch(expensesText(s.done(range), '10/11'), /85\.50/);
  assert.equal(s.markTestOnce('m1', ['E2']), 0); assert.equal(s.done(range).length, 1); // once only
});

test('the plus lost in WhatsApp text: «1510=25M» is 15+10=25M; a normal cut is untouched', () => {
  const a = parseCutCaption('ART NO 229 ZETA WOOD 1510=25M');
  assert.deepEqual([a.quantity, a.pieces, a.customer], [25, [15, 10], 'ZETA WOOD']);
  assert.deepEqual(parseCutCaption('ART NO 229 ZETA WOOD 15+10=25M').pieces, [15, 10]);
  const plain = parseCutCaption('ART NO 229 ZETA WOOD 10M'); assert.equal(plain.quantity, 10); assert.equal(plain.pieces, undefined);
  assert.equal(parseCutCaption('ART NO 303 120M FOR CUT.').kind, 'open-roll');
  assert.equal(parseCutCaption('ART NO 229 ZETA WOOD 1510=26M').quantity, 26); // the parts do not add up: left as written
});

test('a cut counts once: a repeated post, and the earlier part that a total post already includes', () => {
  const twice = [cutEv('SAJ TEST', '502', 17.2, T0, 'a'), cutEv('SAJ TEST', '502', 17.2, T0 + 120000, 'b')];
  assert.equal(settleCuts(twice).length, 1);
  assert.equal(settleCuts([cutEv('SAJ TEST', '502', 17.2, T0, 'a'), cutEv('SAJ TEST', '502', 17.2, T0 + 3 * 3600000, 'c')]).length, 2); // hours apart: two cuts
  const parts = [cutEv('ZETA WOOD', '229', 10, T0, 'p1'), cutEv('ZETA WOOD', '229', 25, T0 + 3600000, 'p2', [15, 10])];
  assert.deepEqual(settleCuts(parts).map((e) => e.ref), ['p2']);
  const t = new Tracker(); t.startedAt = T0 - 20 * DAY;
  t.add({ type: 'invoice', at: T0 - 3600000, ref: 'i1', number: 'inv-1', customer: 'ZETA WOOD', lines: [{ code: '229', quantity: 25, unit: 'm' }] });
  parts.forEach((e) => t.add(e));
  assert.deepEqual(reconcileCuts(t, 'ZETA WOOD', { now: T0 + DAY }), []); // 25 invoiced, 25 cut (not 35)
});

test('a new cut long after an old invoice is a cut with no invoice yet, not a mismatch on the old invoice; the finding says where the cut figure came from', () => {
  const t = new Tracker(); t.startedAt = T0 - 30 * DAY;
  t.add({ type: 'invoice', at: T0 - 6 * DAY, ref: 'i1', number: 'inv-7', customer: 'MASTER TEST', lines: [{ code: '211', quantity: 2, unit: 'm' }] });
  t.add(cutEv('MASTER TEST', '211', 2, T0 - 6 * DAY - 3600000, 'c1'));
  t.add(cutEv('MASTER TEST', '211', 5.2, T0, 'c2')); // a new order of the same code
  assert.deepEqual(reconcileCuts(t, 'MASTER TEST', { now: T0 + DAY }), []);
  const u = new Tracker(); u.startedAt = T0 - 30 * DAY;
  u.add({ type: 'invoice', at: T0 - DAY, ref: 'i2', number: 'inv-8', customer: 'MASTER TEST', lines: [{ code: '211', quantity: 2, unit: 'm' }] });
  u.add(cutEv('MASTER TEST', '211', 7.2, T0 - DAY - 3600000, 'c3'));
  const f = reconcileCuts(u, 'MASTER TEST', { now: T0 });
  assert.equal(f.length, 1); assert.equal(f[0].source, 'orders group posts');
  assert.match(cutFindingText(f), /\(cut is MORE than invoiced\) — cut counted from the orders group posts/);
});

// ---- item 4 and 5
import { deliveryDayText, isAckText, isDeliveryReportAsk } from '../src/driver.js';
import { eventsFromCaption } from '../src/captionevents.js';
import { groupPaymentNotices } from '../src/payments.js';

const dpost = (hhmm, text, msg) => eventsFromCaption('delivery', text).events.map((e, i) => ({ ...e, customerTyped: e.customer, at: Date.parse(`2026-11-10T${hhmm}:00+04:00`), ref: `${msg}-${i}`, msg }));

test('the delivery report of the day: our driver\'s runs with delivered times and what is not confirmed, the pickups with times; the ask is recognised, a thanks is only acknowledged', () => {
  const events = [...dpost('13:10', 'ZETA DOORS 1 ROLL PICKED UP BY SWIFT COURIER.', 'a'), ...dpost('15:56', 'HIGH TEST 1 ROLL & NOVA ART 1 ROLL DISPATCHED.', 'b'), ...dpost('16:21', 'Nova art delivered', 'c')];
  const text = deliveryDayText(events, { now: Date.parse('2026-11-10T18:00:00+04:00'), timeZone: 'Asia/Dubai' });
  assert.equal(text, ['Delivery report — 10/11', 'Our driver:', '- 15:56 dispatch, 2 packages: delivered NOVA ART 16:21; NOT confirmed delivered: HIGH TEST', 'Courier and client pickups: ZETA DOORS (SWIFT COURIER 13:10).'].join('\n'));
  assert.equal(deliveryDayText([], { now: Date.parse('2026-11-10T18:00:00+04:00') }), 'Delivery report — 10/11\nNothing was dispatched or picked up today.');
  for (const q of ['ATOSSA delivery report for the whole day?', 'delivery report please', 'گزارش تحویل امروز']) assert.ok(isDeliveryReportAsk(q), q);
  assert.ok(isDeliveryReportAsk('For the full day?', true)); assert.ok(!isDeliveryReportAsk('For the full day?', false)); assert.ok(!isDeliveryReportAsk('goods out report', true));
  for (const t of ['Yes this good', 'Thanks', 'perfect, thank you']) assert.ok(isAckText(t), t);
  for (const t of ['yes #Q36', 'Send 215 20m please', 'No', 'where is the driver']) assert.ok(!isAckText(t), t);
});

test('one notice per payment: the entries of one amount are announced together, the one with a QuickBooks customer first, the other names kept; an entry with no amount stands alone', () => {
  const ev = (ref, extra) => ({ type: 'payment', ref, at: 1, amount: 3500, customer: '', ...extra });
  const events = [ev('r1', { customer: 'ZETA DRAWER LLC', kind: 'cheque' }), ev('r2', { customer: 'BETA KITCHEN', kind: 'transfer' }), ev('r3', { customer: 'BETA KITCHEN', kind: 'cash' }), ev('r4', { amount: 0, source: 'pdf', pendingName: true }), ev('r5', { amount: 250, customer: 'OMEGA CO' })];
  const groups = groupPaymentNotices(events, ['r1', 'r2', 'r3', 'r4', 'r5'], { isKnown: (n) => /BETA/.test(n) });
  assert.equal(groups.length, 3);
  const g = groups.find((x) => x.refs.includes('r1'));
  assert.deepEqual([g.rep.ref, g.refs, g.others], ['r3', ['r1', 'r2', 'r3'], ['ZETA DRAWER LLC (cheque)']]);
  assert.deepEqual(groups.find((x) => x.refs.includes('r4')).refs, ['r4']); assert.deepEqual(groups.find((x) => x.refs.includes('r5')).others, []);
});

// ---- item 6
import { qboNameFor } from '../src/qboname.js';
import { unbilled, unbilledText } from '../src/unbilled.js';

test('every posted spelling is its QuickBooks customer; two alike customers stay apart; a note, a bracket or a number after the name is not part of it', () => {
  const names = ['ZETA RAD INTERNATIONAL TRADING LLC', 'ALAFEEFI KITCHEN', 'AL AFEEF KITCHEN', 'AL  AHLIA KITCHEN', 'NOVA IND . LLC'];
  const f = (n) => qboNameFor(n, names);
  assert.equal(f('ZETA RAD'), 'ZETA RAD INTERNATIONAL TRADING LLC'); assert.equal(f('Zeta-Rad INTL(IBN XYZ)— ARYAK'), 'ZETA RAD INTERNATIONAL TRADING LLC');
  assert.equal(f('AL AFFEFI KITCHEN'), 'ALAFEEFI KITCHEN'); assert.equal(f('AL AFFEFI KITCHEN 6'), 'ALAFEEFI KITCHEN'); assert.equal(f('AL AFEEF KITCHEN'), 'AL AFEEF KITCHEN');
  assert.equal(f('AL AHALIA KITCHEN BD REPAIRED'), 'AL  AHLIA KITCHEN'); assert.equal(f('NOVA kitchens ind . llc'), 'NOVA IND . LLC'); assert.equal(f('Nobody Doors'), '');
  assert.equal(qboNameFor('ZETA RAD', names, () => 'NOVA IND . LLC'), 'NOVA IND . LLC'); // an approved alias wins
});

test('unbilled groups by the QuickBooks customer and says where each line came from', () => {
  const NOW = Date.parse('2026-11-11T08:00:00Z');
  const cut = (customer, qty, ref) => ({ type: 'cut', at: NOW - 3600000, customer, customerTyped: customer, ref, lines: [{ code: '221', quantity: qty, unit: 'm' }] });
  const names = ['ZETA RAD INTERNATIONAL TRADING LLC', 'ALAFEEFI KITCHEN'];
  const r = unbilled({ events: [cut('ZETA RAD', 10, 'aaaaaaaa1'), cut('Zeta-Rad INTL(IBN XYZ)— ARYAK', 5, 'bbbbbbbb2'), cut('AL AFFEFI KITCHEN 6', 7, 'cccccccc3')], invoices: [], qboNames: names, now: NOW });
  assert.deepEqual(r.groups.map((g) => [g.customer, g.parts.length]), [['ZETA RAD INTERNATIONAL TRADING LLC', 2], ['ALAFEEFI KITCHEN', 1]]);
  assert.match(r.trace[0], /^unbilled: "ZETA RAD INTERNATIONAL TRADING LLC" <- "ZETA RAD": 221 10m \d\d\/\d\d \(post aaaaaaaa\)$/);
  assert.match(unbilledText(r), /Cut or delivered, not invoiced \(2 customers\)/);
});

// ---- item 7
import { parseInvoiceCommand } from '../src/qboinvoice.js';
import fs from 'node:fs';
import path from 'node:path';

test('«yes #36» / «yes 36» / «36 yes» name the number only; the desk resolves the ONE waiting item with it, and says so when several or none wait; a bare number is no answer', () => {
  for (const [t, v] of [['yes #36', 'yes'], ['Yes 36', 'yes'], ['#36 yes', 'yes'], ['36 no', 'no'], ['no #7', 'no']]) assert.deepEqual(parseInvoiceCommand(t), { type: v, id: t.match(/\d+/)[0] }, t);
  assert.deepEqual(parseInvoiceCommand('yes #Q36'), { type: 'yes', id: 'Q36' });
  assert.notEqual(parseInvoiceCommand('36')?.type, 'yes'); assert.notEqual(parseInvoiceCommand('2')?.type, 'no');
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  const block = index.slice(index.indexOf("case 'yes': case 'no': {"), index.indexOf("case 'yes': case 'no': {") + 1500);
  assert.match(block, /hits\.length !== 1\) return \[hits\.length \? 'Several items wait under the number '/); assert.match(block, /'Nothing is waiting under the number '/); // never silent
  assert.match(index, /\/\^\(\?:\[QSA\]\[0-9\]\+\|W\[0-9\]\+\|\[0-9\]\+\)\$\/\.test\(dec\.id \|\| ''\)/); // the internal groups take the number too
});

// ---- item 8
import { officeNote, parseOfficeRequest } from '../src/officerequest.js';

test('a customer message that needs the office: an invoice request or an order is surfaced once, a question about availability is the other path, small talk is nothing', () => {
  assert.deepEqual(parseOfficeRequest('Please send the invoice for this delivery'), { kind: 'invoice' });
  assert.deepEqual(parseOfficeRequest('We need AY 505 - 30 mtr\nSend today itself'), { kind: 'order', code: 'AY 505', quantity: 30, unit: 'm' });
  assert.equal(parseOfficeRequest('we need 211 5 mtr please').code, '211');
  for (const t of ['209 available?', 'do you have 215 20m', 'Thank you', 'ok received', 'what is the price of 505', '']) assert.equal(parseOfficeRequest(t), null, t);
  const note = officeNote('Zeta Kitchens', 'Please send the invoice for this delivery', { kind: 'invoice' });
  assert.match(note, /^📩 Customer group "Zeta Kitchens" asks for an invoice: "Please send the invoice for this delivery"\nNothing was sent to the customer and nothing was created\./);
  assert.match(officeNote('Zeta Kitchens', 'we need 505 30 mtr', { kind: 'order', code: '505', quantity: 30, unit: 'm' }), /orders 505 30 m:/);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(index, /void sock\.sendMessage\(ownIds\(\)\[0\], \{ text: '🤖 ' \+ officeNote\(/); assert.match(index, /!officeAsked\.has\(raw\.key\.id\)/); // the owner's own chat, once per message
});

// ---- item 9
import { cleanOutgoing } from '../src/outgoing.js';

test('her name has one spelling: Atossa in Latin text, آتوسا in Persian; a Persian sign-off under a Latin text is Atossa', () => {
  assert.equal(cleanOutgoing('Good morning team\n— Atoosa').text, 'Good morning team\n— Atossa');
  assert.equal(cleanOutgoing('Hello — Atousa').text, 'Hello — Atossa'); assert.equal(cleanOutgoing('Report\n— آتوسا').text, 'Report\n— Atossa');
  assert.equal(cleanOutgoing('سلام، اتوسا هستم').text, 'سلام، آتوسا هستم'); assert.equal(cleanOutgoing('سلام، آتوسا هستم').text, 'سلام، آتوسا هستم');
  assert.equal(cleanOutgoing('Latosa and Atossa').text, 'Latosa and Atossa'); // inside another word: untouched
});

// ---- item 11
import { AvailabilityDrafts } from '../src/availdraft.js';

test('an availability draft waiting for the manager is dropped when a colleague or the owner answers in the customer group himself', () => {
  const mk = () => { const d = new AvailabilityDrafts(); const id = d.add({ groupId: 'g1', subject: 'Zeta Kitchens', draft: 'Yes, code 607 is available.', codes: ['607'], messageId: 'M1' }); d.add({ groupId: 'g2', subject: 'Other', draft: 'x', codes: ['215'], messageId: 'M9' }); return { d, id }; };
  let { d, id } = mk();
  assert.deepEqual(d.dropAnswered({ groupId: 'g1', text: 'ok', quotedId: 'M1' }).map((x) => x.id), [id]); assert.equal(d.get(id), null); // a reply to the question
  ({ d, id } = mk()); assert.equal(d.dropAnswered({ groupId: 'g1', text: '607 is there, 40 m' }).length, 1); // names the code
  ({ d, id } = mk()); assert.equal(d.dropAnswered({ groupId: 'g1', text: 'Yes available' }).length, 1); assert.equal(d.dropAnswered({ groupId: 'g1', text: 'Yes available' }).length, 0); // said once
  ({ d, id } = mk()); assert.equal(d.dropAnswered({ groupId: 'g1', text: 'Good morning everyone' }).length, 0); assert.ok(d.get(id)); // other talk keeps it
  assert.equal(d.dropAnswered({ groupId: 'g1', text: 'yes available' }).length, 1); assert.ok(d.get('V2')); // another group's draft is untouched
  const sim = new AvailabilityDrafts(); sim.add({ groupId: 'g1', subject: 's', draft: 'd', simulated: true, codes: ['607'], messageId: 'M2' }); assert.equal(sim.dropAnswered({ groupId: 'g1', text: '607 yes' }).length, 0); // a simulation is never dropped
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(index, /text: '🤖 #' \+ d\.id \+ ' dropped: answered in the group by ' \+ name/); assert.match(index, /availDrafts\.add\(\{ groupId, subject, draft, simulated, codes: ask\.codes, messageId \}\)/);
});

// ---- the evening report must not freeze the bot
test('unbilled with ~300 events, ~2000 invoice lines and 200 QuickBooks names finishes at once (the matching is done per distinct name, not per line)', () => {
  const NOW = Date.parse('2026-11-11T08:00:00Z');
  const names = Array.from({ length: 200 }, (_, i) => `CUSTOMER${String.fromCharCode(65 + (i % 26))}${i} TRADING LLC`);
  const invoices = Array.from({ length: 200 }, (_, i) => ({ TxnDate: '2026-11-0' + (1 + (i % 9)), CustomerRef: { name: names[i] }, Line: Array.from({ length: 10 }, (_, k) => ({ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: String(k), name: 'PVC ' + (200 + k) } } })) }));
  const events = Array.from({ length: 300 }, (_, i) => ({ type: 'cut', at: NOW - 3600000, customer: 'Customer' + String.fromCharCode(65 + (i % 26)) + (i % 200) + ' trdg ' + (i % 7), customerTyped: 'Customer' + String.fromCharCode(65 + (i % 26)) + (i % 200) + ' trdg ' + (i % 7), ref: 'r' + i, lines: [{ code: String(200 + (i % 10)), quantity: 5, unit: 'm' }] }));
  const started = Date.now();
  const r = unbilled({ events, invoices, itemCodes: (id, name) => [String(name).replace(/^PVC /, '')], qboNames: names, now: NOW });
  const ms = Date.now() - started;
  assert.ok(r.groups.length > 0); assert.ok(ms < 3000, 'took ' + ms + ' ms'); // it took minutes before; the margin is for a busy machine
});

test('a bare yes or no in a GROUP counts only what was made in that group: the drafts and lists of the owner\'s own chat do not', () => {
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  const at = index.indexOf("const inGroup = String(here.chatId || '').endsWith('@g.us');");
  const block = index.slice(at, at + 900);
  assert.ok(at > 0);
  assert.match(block, /\? \[\.\.\.qboInvoices\.openIds\(\)\.filter\(\(id\) => Object\.values\(qboInvoices\.store\.d\.previews\)\.find\(\(p\) => p\.id === id\)\?\.origin\?\.jid === here\.chatId\), \.\.\.invoiceEdits\.store\.openIds\(\)\.filter\(\(id\) => invoiceEdits\.store\.get\(id\)\?\.origin\?\.jid === here\.chatId\), \.\.\.groupStatements\.openIds\(\)\]/);
  assert.doesNotMatch(block.slice(0, block.indexOf(': [...qboInvoices')), /availDrafts|qboNames|pendingBackfill|cutAliases/); // none of those count in a group
});

// ---- leftovers of 11/11
import { SheetNameStore, overrideFor } from '../src/sheetnames.js';

test('the owner\'s sheet-name answers are approved aliases before any fuzzy match; pieces stay pieces; the lost plus works with decimals; the kept caption shows in the trace', () => {
  const names = ['ALAFEEFI KITCHEN', 'AL AFEEF KITCHEN'];
  const store = new SheetNameStore(''); store.tell('AL AFFEFI KITCHEN', 'ALAFEEFI KITCHEN'); store.tell('AL AFFEF KITCHEN', 'AL AFEEF KITCHEN');
  const alias = (n) => overrideFor(store, n);
  assert.equal(qboNameFor('Al AFFEFI KITCHEN', names, alias), 'ALAFEEFI KITCHEN'); assert.equal(qboNameFor('AL AFFEF KITCHEN', names, alias), 'AL AFEEF KITCHEN');
  const pcs = parseCutCaption('ART NO 18 ZETA WOOD INDUSTRIES 2 PCS'); assert.deepEqual([pcs.quantity, pcs.unit, pcs.customer], [2, 'pcs', 'ZETA WOOD INDUSTRIES']);
  assert.equal(parseCutCaption('ART NO 215 NOVA 5M').unit, 'm');
  const lost = parseCutCaption('ART NO 215 NOVA IND 2572.6=97.6M'); assert.deepEqual([lost.quantity, lost.pieces], [97.6, [25, 72.6]]);
  assert.deepEqual(parseCutCaption('ART NO 215 NOVA IND 25+72.6=97.6M').pieces, [25, 72.6]);
  const NOW = Date.parse('2026-11-11T08:00:00Z');
  const r = unbilled({ events: [{ type: 'cut', at: NOW - 3600000, customer: 'ZETA', customerTyped: 'ZETA', ref: 'abcdefgh12', text: 'ART NO 18 ZETA 2 PCS', lines: [{ code: '18', quantity: 2, unit: 'pcs' }] }], invoices: [], now: NOW });
  assert.match(r.groups[0].parts[0], /^18 2 pcs \d\d\/\d\d$/); assert.match(r.trace[0], /\(post abcdefgh: "ART NO 18 ZETA 2 PCS"\)$/);
  // 72.6 and 25+72.6=97.6 on one day: one cut of 97.6, not 170.2
  const day = [{ type: 'cut', at: NOW - 7200000, customer: 'NOVA IND', ref: 'a', lines: [{ code: '215', quantity: 72.6, unit: 'm' }] }, { type: 'cut', at: NOW - 3600000, customer: 'NOVA IND', ref: 'b', lines: [{ code: '215', quantity: 97.6, unit: 'm' }], pieces: [25, 72.6] }];
  assert.deepEqual(settleCuts(day).map((e) => e.ref), ['b']);
});

// ---- the three-way check: cut (orders group) / left (sheet OUT) / invoiced (QuickBooks)
import { threeWay, threeWayText } from '../src/threeway.js';

test('the three-way check: every case lands in its own section, with its sources; a quantity difference is never a mismatch; no OUT rows from the sheet means nothing is claimed about what left', () => {
  const NOW = Date.parse('2026-11-11T08:00:00Z'); const at = (d) => Date.parse(`2026-11-${d}T10:00:00Z`);
  const cut = (customer, code, qty, d, ref) => ({ type: 'cut', at: at(d), customer, customerTyped: customer, ref, lines: [{ code, quantity: qty, unit: 'm' }] });
  const out = (customer, code, qty, d) => ({ customer, code, qty, unit: 'm', at: at(d) });
  const line = (code, qty) => ({ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { Qty: qty, ItemRef: { value: code, name: 'PVC ' + code } } });
  const inv = (customer, d, lines) => ({ TxnDate: `2026-11-${d}`, CustomerRef: { name: customer }, Line: lines });
  const events = [
    cut('ZETA RAD', '215', 6.2, '08', 'a'), cut('NOVA ART', '220', 12, '08', 'b'), cut('OMEGA CO', '301', 5, '09', 'c'), cut('TAU DOORS', '410', 8, '09', 'd'),
  ];
  const outs = [out('ZETA RAD INTERNATIONAL LLC', '215', 6.3, '09'), out('NOVA ART LLC', '220', 12, '09'), out('PHI WOOD', '555', 3, '10'), out('UPSILON', '777', 4, '10')];
  const invoices = [inv('ZETA RAD INTERNATIONAL LLC', '10', [line('215', 6)]), inv('TAU DOORS LLC', '10', [line('410', 8)]), inv('CHI KITCHEN', '10', [line('999', 20)]), inv('UPSILON', '10', [line('777', 4)])];
  const r = threeWay({ events, outs, invoices, itemCodes: (id, name) => [String(name).replace(/^PVC /, '')], qboNames: ['ZETA RAD INTERNATIONAL LLC', 'NOVA ART LLC', 'OMEGA CO', 'TAU DOORS LLC', 'PHI WOOD', 'CHI KITCHEN', 'UPSILON'], now: NOW });
  const s = (k) => r.sections[k].map((g) => [g.customer, g.parts]);
  assert.deepEqual(s('leftNotInvoiced'), [['NOVA ART LLC', ['220 12m (orders 08/11, OUT 09/11, no invoice) — 1 day']]]); // ZETA is invoiced 6 for 6.3 left: fine
  assert.deepEqual(s('stillInWarehouse'), [['OMEGA CO', ['301 5m (orders 09/11, no invoice) — 1 day']]]);
  assert.deepEqual(s('invoicedNotLeft'), [['CHI KITCHEN', ['999 20m (invoice 10/11, no OUT) — 1 day']], ['TAU DOORS LLC', ['410 8m (orders 09/11, invoice 10/11, no OUT) — 1 day']]]);
  assert.deepEqual(s('leftWithoutPost'), [['PHI WOOD', ['555 3m (OUT 10/11, no invoice) — today']]]); // an OUT that is invoiced is fine without an order post
  const text = threeWayText(r);
  assert.match(text, /^\*Left, not invoiced \(1 customer\)\*\n\*NOVA ART LLC\*\n220 12m \(orders 08\/11, OUT 09\/11, no invoice\) — 1 day\n━+\n━+\n\*Invoiced, not left yet \(2 customers\)\*/);
  assert.match(text, /Cut \/ ready, not invoiced yet \(1 customer\)/); assert.doesNotMatch(text, /Left without an order-group post/); assert.match(text, /Say "unbilled details"/); // the short form
  assert.match(threeWayText(r, { details: true }), /Left without an order-group post \(check\) \(1 customer\)/);
  // the sheet gave nothing: only the old question, and a warning
  const blind = threeWay({ events, outs: null, invoices, itemCodes: (id, name) => [String(name).replace(/^PVC /, '')], qboNames: [], now: NOW });
  assert.deepEqual(blind.sections.stillInWarehouse.concat(blind.sections.invoicedNotLeft, blind.sections.leftWithoutPost), []); assert.ok(!blind.outKnown);
  assert.match(threeWayText(blind), /^⚠ The stock sheet gave no OUT rows/);
  assert.match(threeWayText(threeWay({ events: [], outs: [], invoices: [], now: NOW })), /^✔ Everything cut, left and invoiced in the last 45 days agrees\./);
});

test('the three-way check is fast on a big day (300 cuts, 300 OUT rows, 2000 invoice lines, 200 names) and never writes anything', () => {
  const NOW = Date.parse('2026-11-11T08:00:00Z');
  const names = Array.from({ length: 200 }, (_, i) => `CUSTOMER${String.fromCharCode(65 + (i % 26))}${i} TRADING LLC`);
  const invoices = Array.from({ length: 200 }, (_, i) => ({ TxnDate: '2026-11-0' + (1 + (i % 9)), CustomerRef: { name: names[i] }, Line: Array.from({ length: 10 }, (_, k) => ({ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { Qty: 5, ItemRef: { value: String(k), name: 'PVC ' + (200 + k) } } })) }));
  const events = Array.from({ length: 300 }, (_, i) => ({ type: 'cut', at: NOW - 3600000, customer: 'Customer' + String.fromCharCode(65 + (i % 26)) + (i % 200) + ' trdg', customerTyped: 'Customer' + String.fromCharCode(65 + (i % 26)) + (i % 200) + ' trdg', ref: 'r' + i, lines: [{ code: String(200 + (i % 10)), quantity: 5, unit: 'm' }] }));
  const outs = Array.from({ length: 300 }, (_, i) => ({ customer: names[i % 200], code: String(200 + (i % 10)), qty: 5, unit: 'm', at: NOW - 1800000 }));
  const started = Date.now();
  threeWay({ events, outs, invoices, itemCodes: (id, name) => [String(name).replace(/^PVC /, '')], qboNames: names, now: NOW });
  assert.ok(Date.now() - started < 3000);
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'threeway.js'), 'utf8');
  assert.doesNotMatch(src, /\.(write|create|post|update|add)\(|fetch|sendMessage/); // read only
});

test('the owner\'s cases of 11/11 (made-up names): an invoice before the post, one group of two customers, a cut that is part of an OUT, a truncated code, and a real unbilled one', () => {
  const NOW = Date.parse('2026-11-11T08:00:00Z'); const at = (d) => Date.parse(`2026-11-${d}T10:00:00Z`);
  const cut = (customer, code, qty, d, ref) => ({ type: 'cut', at: at(d), customer, customerTyped: customer, ref, lines: [{ code, quantity: qty, unit: 'm' }] });
  const out = (customer, code, qty, d) => ({ customer, code, qty, unit: 'm', at: at(d) });
  const line = (code, qty) => ({ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { Qty: qty, ItemRef: { value: code, name: 'PVC ' + code } } });
  const inv = (customer, d, lines) => ({ TxnDate: `2026-11-${d}`, CustomerRef: { name: customer }, Line: lines });
  const names = ['ZETA RAD LLC', 'NOVA ART LLC', 'EBDA KITCHEN LLC', 'MASTER TEST', 'HIGH TEST', 'DESIGN TEST', 'ALPHA KITCHEN', 'DANDY TEST', 'BETA KITCHEN'];
  const events = [
    cut('ZETA RAD', '1810', 5, '08', 'a1'), // invoiced 07/11, before the post
    cut('NOVA ART', '215', 72.6, '08', 'b1'), cut('NOVA ART', '215', 97.6, '08', 'b2'), // one group, two customers
    cut('MASTER TEST', '216', 16, '05', 'c1'), // the OUT of that day is another customer's
    cut('DESIGN TEST', '21', 30.8, '10', 'd1'), // truncated code 212
    cut('ALPHA KITCHEN', '225', 6.4, '05', 'e1'), // a part of the OUT
    cut('DANDY TEST', '702', 4.4, '08', 'f1'), // really left, not invoiced
    cut('BETA KITCHEN', '1810', 21.3, '10', 'g1'), // invoiced 21 m eight days earlier
  ];
  const outs = [out('ZETA RAD LLC', '1810', 5, '08'), out('EBDA KITCHEN LLC', '215', 98.2, '08'), out('HIGH TEST', '216', 40.2, '05'), out('DESIGN TEST', '212', 30.8, '10'),
    out('ALPHA KITCHEN', '225', 9.2, '05'), out('ALPHA KITCHEN', '225', 6.4, '05'), out('DANDY TEST', '702', 4.4, '08'), out('BETA KITCHEN', '1810', 21.3, '10')];
  const invoices = [inv('ZETA RAD LLC', '07', [line('1810', 5)]), inv('EBDA KITCHEN LLC', '08', [line('215', 97)]), inv('HIGH TEST', '05', [line('216', 40)]), inv('DESIGN TEST', '10', [line('212', 30)]),
    inv('ALPHA KITCHEN', '05', [line('225', 15)]), inv('BETA KITCHEN', '02', [line('1810', 21)])];
  const r = threeWay({ events, outs, invoices, itemCodes: (id, name) => [String(name).replace(/^PVC /, '')], qboNames: names, now: NOW });
  const s = (k) => r.sections[k].map((g) => [g.customer, g.parts.map((p) => p.replace(/ \(.*$/, ''))]);
  assert.deepEqual(s('leftNotInvoiced').sort(), [['DANDY TEST', ['702 4.4m']]]); // only the real one: BETA's invoice of 02/11 and its OUT of 10/11 are one closed pair
  assert.deepEqual(s('stillInWarehouse'), [['NOVA ART LLC', ['215 72.6m']]]); // the 72.6 m has no OUT; the 97.6 m took the 98.2 m
  assert.deepEqual(s('invoicedNotLeft'), []); assert.deepEqual(s('leftWithoutPost'), []);
  const none = (k) => assert.ok(!r.sections[k].some((g) => ['ZETA RAD LLC', 'EBDA KITCHEN LLC', 'MASTER TEST', 'HIGH TEST', 'DESIGN TEST', 'ALPHA KITCHEN'].includes(g.customer)), k);
  for (const k of ['leftNotInvoiced', 'stillInWarehouse', 'invoicedNotLeft', 'leftWithoutPost']) none(k === 'stillInWarehouse' ? 'invoicedNotLeft' : k);
  // the same without the OUT rows of one customer: invoiced before the post is «invoiced, not left yet», and a truncated code still finds its invoice
  const noOut = threeWay({ events: [cut('ZETA RAD', '1810', 5, '08', 'a1'), cut('DESIGN TEST', '21', 30.8, '10', 'd1')], outs: [], invoices, itemCodes: (id, name) => [String(name).replace(/^PVC /, '')], qboNames: names, now: NOW });
  const lone = noOut.sections.invoicedNotLeft.map((g) => g.customer); assert.ok(lone.includes('DESIGN TEST') && lone.includes('ZETA RAD LLC')); assert.match(noOut.sections.invoicedNotLeft.find((g) => g.customer === 'ZETA RAD LLC').parts[0], /orders 08\/11, invoice 07\/11, no OUT/);
});

test('the live false findings of 11/11 (made-up names): invoice lines add up, edge banding and small lines are left out, unposted OUT rows only after the tracked history and only when not invoiced, the short form', () => {
  const NOW = Date.parse('2026-11-11T08:00:00Z'); const at = (d) => Date.parse(`2026-11-${d}T10:00:00Z`);
  const cut = (customer, code, qty, d, ref) => ({ type: 'cut', at: at(d), customer, customerTyped: customer, ref, lines: [{ code, quantity: qty, unit: 'm' }] });
  const out = (customer, code, qty, d) => ({ customer, code, qty, unit: 'm', at: at(d) });
  const line = (code, qty, name = 'PVC ' + code) => ({ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { Qty: qty, ItemRef: { value: code, name } } });
  const inv = (customer, d, lines) => ({ TxnDate: `2026-11-${d}`, CustomerRef: { name: customer }, Line: lines });
  const codesOf = (id, name) => (/edge|banding/i.test(name) ? [] : [String(name).replace(/^PVC /, '')]);
  const events = [cut('OMEGA WOOD', '1810', 363, '07', 'a'), cut('SIGMA HOUSE', '1819', 350, '09', 'b'), cut('TAU CO', '505', 20, '06', 'c')];
  const outs = [out('OMEGA WOOD LLC', '1810', 363.2, '07'), out('SIGMA HOUSE LLC', '1819', 350, '09'), out('TAU CO', '505', 20, '06'),
    out('OLD CUSTOMER', '300', 40, '02'), // before the first tracked orders-group post (06/11)... made earlier
    out('KAPPA LLC', '606', 7, '10')]; // after it, nobody posted, not invoiced
  events.push(cut('OTHER', '999', 1, '04', 'early')); // the first tracked post: 04/11
  const invoices = [inv('OMEGA WOOD LLC', '07', [line('1810', 300), line('1810', 63)]), inv('SIGMA HOUSE LLC', '09', [line('1819', 200), line('1819', 153)]),
    inv('TAU CO', '06', [line('505', 20)]), inv('OLD CUSTOMER', '03', [line('300', 40)]),
    inv('HIGH LLC', '10', [line('405', 1), line('113', 2), line('EDGE', 30, 'EDGE BANDING:EDGE 0.8x22 - 1810'), line('808', 30)])];
  const r = threeWay({ events, outs, invoices, itemCodes: codesOf, qboNames: ['OMEGA WOOD LLC', 'SIGMA HOUSE LLC', 'TAU CO', 'OLD CUSTOMER', 'KAPPA LLC', 'HIGH LLC'], now: NOW });
  const s = (k) => r.sections[k].map((g) => [g.customer, g.parts.map((p) => p.replace(/ \(.*$/, ''))]);
  assert.deepEqual(s('leftNotInvoiced'), []); // 300 + 63 cover 363.2, 200 + 153 cover 350
  assert.deepEqual(s('invoicedNotLeft'), [['HIGH LLC', ['808 30m']]]); // 1 m and 2 m lines and the edge banding are not listed; the film line with no OUT is
  assert.deepEqual(s('leftWithoutPost'), [['KAPPA LLC', ['606 7m']]]); // the 02/11 OUT is before the history and is invoiced anyway
  assert.equal(JSON.stringify(r).includes('22-22'), false);
  // the short form: at most 8 customers a section, "+N more", the hidden sections named
  const many = { outKnown: true, sections: { leftNotInvoiced: Array.from({ length: 12 }, (_, i) => ({ customer: 'C' + i, parts: ['1 5m (x)'] })), invoicedNotLeft: [], stillInWarehouse: [], leftWithoutPost: [{ customer: 'Z', parts: ['2 3m'] }], delivered: [] } };
  const short = threeWayText(many);
  assert.equal((short.match(/^\*C\d+\*$/gm) || []).length, 8); assert.match(short, /\+4 more/); assert.match(short, /Say "unbilled details" for every customer, the OUT rows nobody posted and the deliveries\./); assert.doesNotMatch(short, /Left without/);
  assert.equal((threeWayText(many, { details: true }).match(/^\*C\d+\*$/gm) || []).length, 12); assert.match(threeWayText(many, { details: true }), /Left without an order-group post/);
  assert.deepEqual(parseInvoiceCommand('unbilled details'), { type: 'unbilled', details: true }); assert.deepEqual(parseInvoiceCommand('unbilled'), { type: 'unbilled' });
});

test('one OUT with an invoice of another quantity is ONE line «quantity differs»; the same day and quantity under another code is «check the code»; neither is listed twice', () => {
  const NOW = Date.parse('2026-11-11T08:00:00Z'); const at = (d) => Date.parse(`2026-11-${d}T10:00:00Z`);
  const out = (customer, code, qty, d) => ({ customer, code, qty, unit: 'm', at: at(d) });
  const line = (code, qty, name = 'PVC ' + code) => ({ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { Qty: qty, ItemRef: { value: code, name } } });
  const inv = (customer, d, doc, lines) => ({ TxnDate: `2026-11-${d}`, DocNumber: doc, CustomerRef: { name: customer }, Line: lines });
  const cut = { type: 'cut', at: at('04'), customer: 'SOMEONE', ref: 'first', lines: [{ code: '1', quantity: 1, unit: 'm' }] }; // the tracked history begins on 04/11
  const r = threeWay({ events: [cut], outs: [out('SIGMA HOUSE', '1819', 350, '09'), out('CARPENTER CO', '201', 20.2, '11')],
    invoices: [inv('SIGMA HOUSE', '09', 'inv-9989', [line('1819', 153)]), inv('CARPENTER CO', '11', 'inv-10010', [line('220', 20)])], itemCodes: (id, name) => [String(name).replace(/^PVC /, '')], qboNames: ['SIGMA HOUSE', 'CARPENTER CO'], now: NOW });
  assert.deepEqual(r.sections.quantityDiffers.map((g) => [g.customer, g.parts]), [['SIGMA HOUSE', ['1819: OUT 350m (09/11) vs invoiced 153m (inv-9989) → 197m not invoiced — 1 day']]]);
  assert.deepEqual(r.sections.checkCode.map((g) => [g.customer, g.parts]), [['CARPENTER CO', ['OUT 201 20.2m vs invoice 220 20m on 11/11 — check the code — today']]]);
  for (const k of ['leftNotInvoiced', 'invoicedNotLeft', 'stillInWarehouse', 'leftWithoutPost']) assert.deepEqual(r.sections[k], [], k); // not listed again
  const text = threeWayText(r);
  assert.match(text, /^\*Quantity differs \(OUT vs invoice\) \(1 customer\)\*\n\*SIGMA HOUSE\*[\s\S]*\*Possible wrong code \(same day, same quantity\) \(1 customer\)\*/);
});

test('a small cut (2 m or less) that is invoiced and not left is not listed, with an orders post too', () => {
  const NOW = Date.parse('2026-11-11T08:00:00Z'); const at = (d) => Date.parse(`2026-11-${d}T10:00:00Z`);
  const line = (code, qty) => ({ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { Qty: qty, ItemRef: { value: code, name: 'PVC ' + code } } });
  const mk = (q) => threeWay({ events: [{ type: 'cut', at: at('05'), customer: 'HIGH LLC', ref: 'a', lines: [{ code: '405', quantity: q, unit: 'm' }] }], outs: [], invoices: [{ TxnDate: '2026-11-05', DocNumber: 'inv-1', CustomerRef: { name: 'HIGH LLC' }, Line: [line('405', q)] }],
    itemCodes: (id, name) => [String(name).replace(/^PVC /, '')], qboNames: ['HIGH LLC'], now: NOW });
  assert.deepEqual(mk(1).sections.invoicedNotLeft, []); assert.deepEqual(mk(2).sections.invoicedNotLeft, []);
  assert.equal(mk(30).sections.invoicedNotLeft.length, 1);
});

import { isFilmItem, itemCodesOf } from '../src/threeway.js';

test('only PVC film is compared: the category before «:» decides; saw blades, edge banding, services and free (0.00) lines are not', () => {
  const it = (FullyQualifiedName, extra = {}) => ({ Name: FullyQualifiedName.split(':').pop(), FullyQualifiedName, Type: 'Inventory', ...extra });
  assert.ok(isFilmItem(it('PVC FILM:PVC FILM108'))); assert.ok(isFilmItem({ Name: 'PVC 1810', Sku: 'PVC-1810', Type: 'Inventory' }));
  for (const bad of [it('saw blade aryak:SAW BLADE 300 MDF 300*96'), it('EDGE BANDING:EDGE 0.8x22 - ABC'), it('DELIVERY:DELIVERY CHARGE'), { Name: 'PARKING', Type: 'Service' }, { Name: 'Glue 55' }]) assert.equal(isFilmItem(bad), false, bad.FullyQualifiedName || bad.Name);
  const NOW = Date.parse('2026-11-11T08:00:00Z');
  const free = { TxnDate: '2026-11-05', DocNumber: 'inv-9958', CustomerRef: { name: 'HIGH LLC' }, Line: [{ DetailType: 'SalesItemLineDetail', Amount: 0, SalesItemLineDetail: { Qty: 3, UnitPrice: 0, ItemRef: { value: '402', name: 'P402 DAMEGE' } } }] };
  const r = threeWay({ events: [], outs: [], invoices: [free], itemCodes: () => ['402'], qboNames: ['HIGH LLC'], now: NOW });
  assert.deepEqual(r.sections.invoicedNotLeft, []);
});

test('edge banding counts toward the colour code of the film: PERFCET-like 1819 (350 m = 153 film + 200 edge) and MASTER-like 1810 (363.2 m = 300 film + 63 edge) come out OK', () => {
  const films = (code) => ({ Id: 'f' + code, Name: 'PVC FILM' + code, Sku: 'PVC-' + code, FullyQualifiedName: 'PVC FILM:PVC FILM' + code, Type: 'Inventory' });
  const edge = (width, code) => ({ Id: 'e' + width + code, Name: 'EDGE 0.8x' + width + ' - ' + code, FullyQualifiedName: 'EDGE BANDING:EDGE 0.8x' + width + ' - ' + code, Type: 'Inventory' });
  const all = [films('1819'), films('1810'), edge('50', '1819'), edge('22', '1810'), { Id: 'sb', Name: 'SAW BLADE 300 MDF 300*96', FullyQualifiedName: 'saw blade aryak:SAW BLADE 300 MDF 300*96' }, { Id: 'dl', Name: 'DELIVERY', Type: 'Service' }];
  assert.deepEqual(itemCodesOf(edge('22', '1810')), ['1810']); assert.deepEqual(itemCodesOf(all[4]), []); assert.deepEqual(itemCodesOf(all[5]), []);
  assert.ok(!JSON.stringify(all.map(itemCodesOf)).includes('22-22')); assert.deepEqual(itemCodesOf({ Name: 'EDGE BAND COLOUR 1807', FullyQualifiedName: 'EDGE BANDING:EDGE BAND COLOUR 1807' }), ['1807']);
  const byId = new Map(all.map((i) => [i.Id, i]));
  const line = (itemId, qty, rate = 10) => ({ DetailType: 'SalesItemLineDetail', Amount: qty * rate, SalesItemLineDetail: { Qty: qty, UnitPrice: rate, ItemRef: { value: itemId, name: byId.get(itemId).Name } } });
  const NOW = Date.parse('2026-11-11T08:00:00Z'); const at = (d) => Date.parse(`2026-11-${d}T10:00:00Z`);
  const cut = { type: 'cut', at: at('04'), customer: 'OTHER', ref: 'first', lines: [{ code: '1', quantity: 1, unit: 'm' }] };
  const events = [cut, { type: 'cut', at: at('09'), customer: 'SIGMA HOUSE', ref: 'a', lines: [{ code: '1819', quantity: 350, unit: 'm' }] }, { type: 'cut', at: at('07'), customer: 'OMEGA WOOD', ref: 'b', lines: [{ code: '1810', quantity: 363.2, unit: 'm' }] }];
  const outs = [{ customer: 'SIGMA HOUSE', code: '1819', qty: 100, unit: 'm', at: at('09') }, { customer: 'SIGMA HOUSE', code: '1819', qty: 90, unit: 'm', at: at('09') }, { customer: 'SIGMA HOUSE', code: '1819', qty: 80, unit: 'm', at: at('09') }, { customer: 'SIGMA HOUSE', code: '1819', qty: 80, unit: 'm', at: at('09') }, { customer: 'OMEGA WOOD', code: '1810', qty: 363.2, unit: 'm', at: at('07') }];
  const invoices = [{ TxnDate: '2026-11-09', DocNumber: 'inv-9989', CustomerRef: { name: 'SIGMA HOUSE' }, Line: [line('e501819', 200), line('f1819', 153)] }, { TxnDate: '2026-11-07', DocNumber: 'inv-9973', CustomerRef: { name: 'OMEGA WOOD' }, Line: [line('f1810', 300), line('e221810', 63)] }];
  const r = threeWay({ events, outs, invoices, itemCodes: (id) => itemCodesOf(byId.get(id)), qboNames: ['SIGMA HOUSE', 'OMEGA WOOD'], now: NOW });
  for (const k of ['leftNotInvoiced', 'quantityDiffers', 'checkCode', 'invoicedNotLeft', 'stillInWarehouse', 'leftWithoutPost']) assert.deepEqual(r.sections[k], [], k); // fully invoiced: nothing listed
});

// ---- every date is Gregorian
import { formatDetails, formatReport, parseDay, reportInvalidDate, todayLine } from '../src/report.js';
import { cutLine } from '../src/cuts.js';
import { staffRules } from '../src/staff.js';
import { buildDigest } from '../src/digest.js';
import { setOutLang } from '../src/outlang.js';

test('every generated text is Gregorian: no 14xx year, no Persian month name, no Jalali in the prompts or the tool descriptions; an explicit 14xx year is converted and the Gregorian day shown', () => {
  const YEAR = /(?<![0-9])14[0-9]{2}(?![0-9])/;
  const MONTH = /فروردین|اردیبهشت|خرداد|تیر\b|مرداد|شهریور|مهر\b|آبان|آذر|بهمن|اسفند|Farvardin|Ordibehesht|Khordad|Mordad|Shahrivar|Aban|Azar|Bahman|Esfand|Jalali|Shamsi|Solar Hijri/;
  const at = Date.parse('2026-11-08T05:00:00Z');
  const texts = [todayLine(new Date('2026-11-04T10:00:00Z')), reportInvalidDate('fa'), reportInvalidDate('en'), cutLine({ qty: 12, unit: 'm', at }), staffRules('Atossa')];
  setOutLang('fa'); try { texts.push(cutLine({ qty: 12, unit: 'm', at })); } finally { setOutLang('en'); }
  const result = { from: '2026-11-01', to: '2026-11-08', rows: [{ day: '2026-11-05', at, type: 'OUT', code: '215', size: '', qty: 12, unit: 'm', customer: 'ZETA', invoice: '' }], codes: [{ code: '215', category: 'PVC', unit: 'm', total: 12, operations: 1, customers: [{ name: 'ZETA', total: 12 }] }], totals: { operations: 1, packages: 1 } };
  for (const lang of ['fa', 'en', 'ar']) { try { texts.push(formatReport(result, lang), formatDetails(result, lang)); } catch { /* a layout this fixture does not fill */ } }
  texts.push(buildDigest({ history: [], requests: [], day: '2026-11-08', timeZone: 'Asia/Dubai', events: [] }));
  for (const t of texts) { assert.doesNotMatch(String(t), YEAR, String(t).slice(0, 80)); assert.doesNotMatch(String(t), MONTH, String(t).slice(0, 80)); }
  assert.equal(parseDay('09/08/1405'), '2026-10-31'); // an explicit Solar Hijri year is read as one...
  assert.equal(parseDay('01/11/2026'), '2026-11-01'); assert.equal(parseDay('1/9/2026'), '2026-09-01'); // ...everything else is Gregorian
});

test('goods for a courier: pairs across up to 30 days both ways, the open items are follow-ups with their age (oldest first, ⚠ after 7 days), a courier pickup is supporting evidence', () => {
  const NOW = Date.parse('2026-11-20T08:00:00Z'); const at = (d) => Date.parse(`2026-11-${d}T10:00:00Z`);
  const line = (code, qty) => ({ DetailType: 'SalesItemLineDetail', Amount: qty * 10, SalesItemLineDetail: { Qty: qty, UnitPrice: 10, ItemRef: { value: code, name: 'PVC ' + code } } });
  const inv = (customer, d, doc, lines) => ({ TxnDate: `2026-11-${d}`, DocNumber: doc, CustomerRef: { name: customer }, Line: lines });
  const cut = (customer, code, qty, d, ref) => ({ type: 'cut', at: at(d), customer, customerTyped: customer, ref, lines: [{ code, quantity: qty, unit: 'm' }] });
  const events = [cut('FIRST', '1', 1, '02', 'x'), cut('ZETA', '1810', 21.3, '10', 'a'), cut('NOVA', '215', 30, '15', 'b'), cut('OMEGA', '301', 12, '03', 'c'),
    { type: 'delivery', status: 'picked-up', customer: 'TAU CO', customerTyped: 'TAU CO', at: at('10'), ref: 'p1', lines: [], delivered: { quantity: 1, unit: 'roll' } }];
  const outs = [{ customer: 'ZETA', code: '1810', qty: 21.3, unit: 'm', at: at('10') }, { customer: 'SIGMA', code: '777', qty: 40, unit: 'm', at: at('08') }];
  const invoices = [inv('ZETA', '02', 'inv-1', [line('1810', 21)]), inv('TAU CO', '08', 'inv-2', [line('404', 18)]), inv('PHI', '18', 'inv-3', [line('909', 9)])];
  const r = threeWay({ events, outs, invoices, itemCodes: (id, name) => [String(name).replace(/^PVC /, '')], qboNames: ['ZETA', 'NOVA', 'OMEGA', 'TAU CO', 'SIGMA', 'PHI'], now: NOW });
  assert.deepEqual(r.sections.quantityDiffers, []); // ZETA: invoiced 02/11, left 10/11, 8 days apart: one closed pair
  assert.deepEqual(r.sections.leftNotInvoiced, []); assert.deepEqual(r.sections.leftWithoutPost.map((g) => [g.customer, g.ages[0], g.parts[0].startsWith('⚠')]), [['SIGMA', 11, true]]); // an OUT nobody posted and not invoiced: for the details
  assert.deepEqual(r.sections.stillInWarehouse.map((g) => [g.customer, g.ages[0], g.parts[0].startsWith('⚠')]), [['OMEGA', 16, true], ['NOVA', 4, false]]); // oldest first, ⚠ after 7 days
  assert.deepEqual(r.sections.invoicedNotLeft.map((g) => [g.customer, g.ages[0], g.parts[0].startsWith('⚠')]), [['TAU CO', 12, true], ['PHI', 2, false]]);
  assert.match(r.sections.invoicedNotLeft[0].parts[0], /^⚠\uFE0F? 404 18m \(invoice 08\/11, no OUT, courier pickup 10\/11\) — 12 days$/); // supporting evidence, still open until the OUT appears
  const text = threeWayText(r);
  assert.match(text, /\*Cut \/ ready, not invoiced yet \(2 customers\)\*\n\*OMEGA\*\n⚠\uFE0F? 301 12m/); assert.match(text, /\*Invoiced, not left yet \(2 customers\)\*\n\*TAU CO\*\n⚠\uFE0F? 404 18m/);
});

test('the evening list stays honest: pickups attach only to the closest open item within 3 days, invoices before the OUT tracking start are not «not left», small cuts are not listed, the footer names the date', () => {
  const NOW = Date.parse('2026-11-20T08:00:00Z'); const at = (d, m = '11') => Date.parse(`2026-${m}-${d}T10:00:00Z`);
  const line = (code, qty) => ({ DetailType: 'SalesItemLineDetail', Amount: qty * 10, SalesItemLineDetail: { Qty: qty, UnitPrice: 10, ItemRef: { value: code, name: 'PVC ' + code } } });
  const inv = (customer, d, m, doc, lines) => ({ TxnDate: `2026-${m}-${d}`, DocNumber: doc, CustomerRef: { name: customer }, Line: lines });
  const events = [{ type: 'cut', at: at('02'), customer: 'FIRST', ref: 'x', lines: [{ code: '1', quantity: 1, unit: 'm' }] },
    { type: 'cut', at: at('18'), customer: 'AWAB', ref: 'k', lines: [{ code: '18', quantity: 2, unit: 'pcs' }] }, { type: 'cut', at: at('18'), customer: 'HIGH', ref: 'h', lines: [{ code: '405', quantity: 1, unit: 'm' }] },
    { type: 'cut', at: at('18'), customer: 'NOVA', ref: 'n', lines: [{ code: '215', quantity: 30, unit: 'm' }] },
    { type: 'delivery', status: 'picked-up', customer: 'AR RAD', customerTyped: 'AR RAD', at: at('09'), ref: 'p1', lines: [], delivered: { quantity: 1, unit: 'roll' } }];
  const outs = [{ customer: 'SIGMA', code: '777', qty: 5, unit: 'm', at: at('08') }, { customer: 'SIGMA', code: '777', qty: 5, unit: 'm', at: at('06') }, { customer: 'OLD', code: '9', qty: 5, unit: 'm', at: at('10', '10') }]; // a gap of more than a week: the continuous use starts on 06/11
  const invoices = [inv('AR RAD', '12', '10', 'inv-a', [line('221', 70)]), inv('AR RAD', '08', '11', 'inv-b', [line('222', 40)]), inv('MASTER', '11', '10', 'inv-c', [line('221', 30)])];
  const r = threeWay({ events, outs, invoices, itemCodes: (id, name) => [String(name).replace(/^PVC /, '')], qboNames: ['AR RAD', 'MASTER', 'NOVA', 'AWAB', 'HIGH', 'SIGMA', 'OLD'], now: NOW });
  const inl = Object.fromEntries(r.sections.invoicedNotLeft.map((g) => [g.customer, g.parts]));
  assert.deepEqual(Object.keys(inl), ['AR RAD']); // MASTER's 11/10 invoice and AR RAD's 12/10 one are before the OUT tracking start
  assert.match(inl['AR RAD'].join(' '), /222 40m \(invoice 08\/11, no OUT, courier pickup 09\/11\)/);
  assert.deepEqual(r.sections.stillInWarehouse.map((g) => g.customer), ['NOVA']); // the 2 pcs and the 1 m cuts are not listed
  assert.match(threeWayText(r), /Invoices before 06\/11\/2026 are not checked for «not left yet»/);
  const set = threeWay({ events, outs, invoices, itemCodes: (id, name) => [String(name).replace(/^PVC /, '')], qboNames: ['AR RAD', 'MASTER'], now: NOW, trackedSince: Date.parse('2026-10-01T00:00:00+04:00') });
  assert.deepEqual(set.sections.invoicedNotLeft.map((g) => g.customer).sort(), ['AR RAD', 'MASTER']); // the owner's date makes the 11/10 invoices count
  const far = Object.fromEntries(set.sections.invoicedNotLeft.map((g) => [g.customer, g.parts.join(' ')]));
  assert.match(far['AR RAD'], /221 70m \(invoice 12\/10, no OUT\) — /); // the 12/10 invoice is a month from the pickup: no evidence attached to it
});

test('the default OUT tracking start is 01/11/2026 and a setting: invoices before it never enter «invoiced, not left», but still cover a later OUT', async () => {
  const { loadConfig } = await import('../src/config.js');
  const env = { ANTHROPIC_API_KEY: 'k', SHEET_URL: 'u', ZINAX_BOT_TOKEN: 't' };
  assert.equal(loadConfig(env).config.outTrackedSince, '2026-11-01'); assert.equal(loadConfig({ ...env, OUT_TRACKED_SINCE: '2026-11-05' }).config.outTrackedSince, '2026-11-05'); assert.equal(loadConfig({ ...env, OUT_TRACKED_SINCE: '' }).config.outTrackedSince, '');
  const NOW = Date.parse('2026-11-12T08:00:00Z'); const since = Date.parse('2026-11-01T00:00:00+04:00');
  const line = (code, qty) => ({ DetailType: 'SalesItemLineDetail', Amount: qty * 10, SalesItemLineDetail: { Qty: qty, UnitPrice: 10, ItemRef: { value: code, name: 'PVC ' + code } } });
  const inv = (customer, date, doc, lines) => ({ TxnDate: date, DocNumber: doc, CustomerRef: { name: customer }, Line: lines });
  const invoices = [inv('OLD CO', '2026-10-31', 'inv-1', [line('300', 40)]), inv('NEW CO', '2026-11-01', 'inv-2', [line('301', 40)]), inv('COVER CO', '2026-10-20', 'inv-3', [line('302', 20)])];
  const outs = [{ customer: 'COVER CO', code: '302', qty: 20, unit: 'm', at: Date.parse('2026-11-05T10:00:00Z') }];
  const events = [{ type: 'cut', at: Date.parse('2026-10-25T10:00:00Z'), customer: 'FIRST', ref: 'x', lines: [{ code: '1', quantity: 1, unit: 'm' }] }, { type: 'cut', at: Date.parse('2026-11-05T09:00:00Z'), customer: 'COVER CO', ref: 'c', lines: [{ code: '302', quantity: 20, unit: 'm' }] }];
  const r = threeWay({ events, outs, invoices, itemCodes: (id, name) => [String(name).replace(/^PVC /, '')], qboNames: ['OLD CO', 'NEW CO', 'COVER CO'], now: NOW, trackedSince: since });
  assert.deepEqual(r.sections.invoicedNotLeft.map((g) => g.customer), ['NEW CO']); // 31/10 is before the day; 01/11 is the day itself
  assert.deepEqual(r.sections.leftNotInvoiced, []); // the 20/10 invoice (16 days earlier) covers the 05/11 OUT
});

// ---- silent during the day
import { paymentsText } from '../src/payments.js';

test('the Confirmation group is recorded silently: no per-post notice, no #D question, one end-of-day report with the findings and the possible duplicates; the double rule has no blank line', async () => {
  const { loadConfig } = await import('../src/config.js');
  const env = { ANTHROPIC_API_KEY: 'k', SHEET_URL: 'u', ZINAX_BOT_TOKEN: 't' };
  assert.equal(loadConfig(env).config.paymentNotices, false); assert.equal(loadConfig(env).config.deliveryRunLine, true); assert.equal(loadConfig({ ...env, DELIVERY_RUN_LINE: 'off' }).config.deliveryRunLine, false);
  assert.equal(loadConfig({ ...env, PAYMENT_NOTICES: 'on' }).config.paymentNotices, true); assert.equal(loadConfig({ ...env, DELIVERY_RUN_LINE: 'on' }).config.deliveryRunLine, true);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(index, /event\.source === 'pdf'\) && config\.paymentNotices\) payPending\.set/); // no notice unless the setting is on
  assert.match(index, /\(!config\.deliveryRunLine && !event\.simulated\)\) return;/); // no automatic line in the delivery group
  const NOW = Date.parse('2026-11-11T12:00:00Z');
  const ev = (ref, hh) => ({ type: 'payment', kind: 'cash', currency: 'AED', ref, at: Date.parse(`2026-11-11T${hh}:00Z`), customer: 'ZETA KITCHEN', amount: 500, lines: [] });
  const dups = { state: () => '', ask: () => { throw new Error('a question was opened'); } };
  const text = paymentsText({ events: [ev('a', '06:00'), ev('b', '07:00')], invoices: [], payments: [], aliasOf: () => '', timeZone: 'Asia/Dubai', now: NOW, days: 1, dups, questions: false, lookup: new Map() });
  assert.match(text, /⚠ Possible duplicate of #1 \(\d\d\/11\), check/); assert.doesNotMatch(text, /Reply: dup|separate #/);
  const lines = threeWayText({ outKnown: true, trackedSince: 0, sections: { leftNotInvoiced: [{ customer: 'A', parts: ['1 5m'], ages: [1] }], invoicedNotLeft: [{ customer: 'C', parts: ['3 5m'], ages: [1] }] } }).split('\n');
  const at = lines.findIndex((l, i) => /^━+$/.test(l) && /^━+$/.test(lines[i + 1] || ''));
  assert.ok(at >= 0 && lines[at + 2] !== '' && lines[at - 1] !== ''); // two rules on consecutive lines, no blank line around or between them
});

// ---- internal groups answer only a message that starts with her name
import { isAddressed, startsWithName } from '../src/staff.js';

test('in an internal group only a message that STARTS with her name is answered: not a quote of her message, not a name or an @mention in the middle', () => {
  for (const t of ['Atossa', 'atosa what is 209', 'Atousa, send the statement', 'ATOSSA: delivery report?', 'آتوسا صورت‌حساب', '@Atossa check', '  *Atossa* hello', 'Atoosa']) assert.ok(startsWithName(t, ['atossa']), t);
  for (const t of ['Yes this good', 'For the full day?', 'Give me when its delivered', 'thanks Atossa', 'please ask @Atossa about it', 'Atossalike', 'hello', '']) assert.equal(startsWithName(t, ['atossa']), false, t);
  const base = { text: 'Give me when its delivered', mentioned: ['me@lid'], quotedFrom: 'me@lid', ownIds: ['me@lid'], names: ['atossa'] };
  assert.equal(isAddressed(base), true); // the old rule (her own chat, the test group): a quote counts
  assert.equal(isAddressed({ ...base, strict: true }), false); assert.equal(isAddressed({ ...base, text: 'Atossa give me when its delivered', strict: true }), true);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(index, /strict: !!group && !group\.test,/); assert.match(index, /if \(!addressedIn\(text, ctx, !test\)\) return false;/);
  assert.ok(index.indexOf("const addressed = !group || isAddressed({") < index.indexOf('const tc = parseTrackerCommand(text)')); // before every answer of an internal group
});

// ---- the AL EBDA case of 08/11 (made-up names)
test('a shared group and a reply with a lost plus: one cut of 97.6 m for the typed customer, paired with the 98.2 m OUT and the 97 m invoice, and nothing is listed', () => {
  const NOW = Date.parse('2026-11-11T08:00:00Z'); const at = (hh) => Date.parse(`2026-11-08T${hh}:00Z`);
  const first = eventsFromCaption('cut', 'ART NO 215 AL EBDA 72.6M....').events[0];
  const second = eventsFromCaption('cut', 'ART NO 215 AL EBDA 72.625.6=97.6M').events[0]; // the plus is lost, and the writer's sum is 98.2
  assert.deepEqual([first.lines[0].quantity, second.lines[0].quantity, second.pieces], [72.6, 97.6, [72.6, 25.6]]);
  // the tracker stored the OTHER customer's name (the shared group's row), the typed name is kept beside it
  const ev = (e, ref, hh) => ({ ...e, customer: 'NUQOOSH IND . LLC', customerTyped: 'AL EBDA', at: at(hh), ref });
  const events = [{ type: 'cut', at: Date.parse('2026-11-02T10:00:00Z'), customer: 'FIRST', ref: 'f', lines: [{ code: '1', quantity: 1, unit: 'm' }] }, ev(first, 'p1', '09:02'), ev(second, 'p2', '09:03')];
  assert.deepEqual(settleCuts(events).filter((e) => e.type === 'cut' && e.customerTyped).map((e) => e.ref), ['p2']); // the earlier part is not a cut of its own
  const names = ['AL EBDA AL MALKI KITCHEN', 'NUQOOSH IND . LLC'];
  const line = { DetailType: 'SalesItemLineDetail', Amount: 970, SalesItemLineDetail: { Qty: 97, UnitPrice: 10, ItemRef: { value: '215', name: 'PVC 215' } } };
  const r = threeWay({ events, outs: [{ customer: 'AL EBDA AL MALKI KITCHEN', code: '215', qty: 98.2, unit: 'm', at: at('10:00') }], invoices: [{ TxnDate: '2026-11-08', DocNumber: 'inv-9979', CustomerRef: { name: 'AL EBDA AL MALKI KITCHEN' }, Line: [line] }],
    itemCodes: (id, name) => [String(name).replace(/^PVC /, '')], qboNames: names, now: NOW });
  for (const k of Object.keys(r.sections)) assert.deepEqual(r.sections[k], [], k);
  assert.equal(parseCutCaption('ART NO 215 AL EBDA 72.625.6=97.6M').customer, 'AL EBDA');
  assert.deepEqual(parseInvoiceCommand('who is AL EBDA'), { type: 'name_explain', name: 'AL EBDA' });
});

// ---- a cancel by quote-reply
import { isCancelText } from '../src/captions.js';

test('a cancelled cut is never «cut, not invoiced»: closed when it never left or came back and is not on an invoice; otherwise a check with what is missing', () => {
  for (const t of ['cancel', 'Cancelled', 'canceled', 'cancel order', 'CANCEL!', 'کنسل', 'كنسل', 'لغو', 'لغو شد', 'إلغاء']) assert.ok(isCancelText(t), t);
  for (const t of ['ART NO 215 ZETA 10M', 'ok', 'no cancellation needed here, please keep the whole order as we agreed yesterday', '']) assert.equal(isCancelText(t), false, t);
  const NOW = Date.parse('2026-11-12T08:00:00Z'); const at = (d, hh = '10') => Date.parse(`2026-11-${d}T${hh}:00:00Z`);
  const cut = (customer, code, qty, d, ref, cancelled) => ({ type: 'cut', at: at(d), customer, customerTyped: customer, ref, lines: [{ code, quantity: qty, unit: 'm' }], ...(cancelled ? { internal: true, cancelled: { at: at(cancelled), text: 'cancel' } } : {}) });
  const line = (code, qty) => ({ DetailType: 'SalesItemLineDetail', Amount: qty * 10, SalesItemLineDetail: { Qty: qty, UnitPrice: 10, ItemRef: { value: code, name: 'PVC ' + code } } });
  const inv = (customer, d, doc, lines) => ({ TxnDate: `2026-11-${d}`, DocNumber: doc, CustomerRef: { name: customer }, Line: lines });
  const base = { itemCodes: (id, name) => [String(name).replace(/^PVC /, '')], qboNames: ['ZETA', 'NOVA', 'OMEGA', 'TAU'], now: NOW };
  const events = [{ type: 'cut', at: at('01'), customer: 'FIRST', ref: 'f', lines: [{ code: '1', quantity: 1, unit: 'm' }] },
    cut('ZETA', '215', 20, '08', 'a', '08'), // never left, not invoiced: closed
    cut('NOVA', '216', 30, '08', 'b', '09'), // left, came back, not invoiced: closed
    cut('OMEGA', '217', 12, '08', 'c', '09'), // left, never came back
    cut('TAU', '218', 8, '08', 'd', '08')]; // never left but still on an invoice
  const outs = [{ customer: 'NOVA', code: '216', qty: 30, unit: 'm', at: at('08') }, { customer: 'OMEGA', code: '217', qty: 12, unit: 'm', at: at('08') }];
  const returns = [{ customer: 'NOVA', code: '216', qty: 30, unit: 'm', at: at('09') }];
  const r = threeWay({ ...base, events, outs, returns, invoices: [inv('TAU', '08', 'inv-77', [line('218', 8)])] });
  assert.deepEqual(r.sections.cancelledClosed.map((g) => [g.customer, g.parts[0].replace(/ — .*$/, '')]).sort(), [['NOVA', '216 30m cancelled 09/11, returned 09/11'], ['ZETA', '215 20m cancelled 08/11, never left']]);
  assert.deepEqual(r.sections.cancelledCheck.map((g) => [g.customer, g.parts[0].replace(/ — .*$/, '')]).sort(), [['OMEGA', '217 12m cancelled 09/11: not returned to stock yet'], ['TAU', '218 8m cancelled 08/11: still on invoice inv-77']]);
  for (const k of ['leftNotInvoiced', 'stillInWarehouse', 'invoicedNotLeft', 'leftWithoutPost']) assert.deepEqual(r.sections[k], [], k); // a cancelled cut is no «cut, not invoiced», nor an OUT without a post
  assert.match(threeWayText(r), /Cancelled — check \(2 customers\)/); assert.doesNotMatch(threeWayText(r), /Cancelled, closed/); assert.match(threeWayText(r, { details: true }), /Cancelled, closed \(2 customers\)/);
  const blind = threeWay({ ...base, events, outs, returns: null, invoices: [] });
  assert.match(blind.sections.cancelledCheck.map((g) => g.parts[0]).join(' '), /the sheet gave no return rows/);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(index, /if \(role === 'cut' && quotedId && text && isCancelText\(text\)\) \{[\s\S]*?tracker\.update\(e\.ref, \{ internal: true, cancelled: \{ at: nowAt\(\)[\s\S]*?return;\n  \}/); // silent: no reply
});

// ---- the wrong "received today" of 11/11 (made-up names)
import { cleanPaymentEvents, findRecorded } from '../src/payments.js';
import { isClearReply, isEstimateText, isReplyFiller, looksLikeName, parsePaymentCaption } from '../src/captions.js';
import { matchReceipts, receivedItems, receivedText } from '../src/expenses.js';

test('replies of filler are no payment and no name; an estimate is no payment; 4PC is no amount', () => {
  for (const t of ['Plz clear it', 'Also this', 'done', 'Please clear this', 'ok']) assert.ok(isReplyFiller(t), t);
  for (const t of ['ZETA KITCHEN', 'Awab', 'cash from zeta 789.5', 'clear ZETA inv 9940']) assert.ok(!isReplyFiller(t), t);
  assert.ok(isClearReply('Plz clear it') && isClearReply('cleared') && !isClearReply('Also this'));
  assert.ok(!looksLikeName('Also this') && looksLikeName('Awab'));
  for (const t of ['OMEGA ESTIMATE FOR DUST COLLECTOR 3,000.00', 'estimate SAW BLADE PC 300 96 MDF 4PC 120 24 MDF 4.00', 'quotation 500', 'offer 1200 aed', 'proforma 900']) { assert.ok(isEstimateText(t), t); assert.equal(parsePaymentCaption(t), null, t); }
  assert.notEqual(parsePaymentCaption('cash from zeta 789.5 aed'), null);
  const pc = parsePaymentCaption('ZETA 4PC 250'); assert.equal(pc.amount, 250); // pieces are not money
});

test('the fake rows made by filler replies and the estimates leave the lists; the originals stay; the same cheque under its customer and its drawer is one row', () => {
  const at = Date.parse('2026-11-11T12:00:00Z');
  const ev = (ref, extra) => ({ type: 'payment', kind: 'cash', currency: 'AED', ref, at, lines: [], ...extra });
  const events = [
    ev('o1', { customer: 'PVC WORK', amount: 789.5, text: 'Cash from pvc work 789.5 aed' }), ev('f1', { customer: 'PLZ IT', amount: 789.5, text: 'Plz clear it', at: at + 3600000 }), // the fake of a reply
    ev('o2', { customer: 'AKRASAA LIONS FOR KITCHENS', amount: 164, text: 'Cash from akrasaa lions for kitchens 164 aed' }), ev('f2', { customer: 'ALSO THIS', amount: 164, text: 'Also this', at: at + 3600000 }),
    ev('e1', { customer: 'WAHDAN', amount: 3000, text: 'WAHDAN ESTIMATE FOR DUST COLLECTOR 3,000.00', invoices: ['inv-10002'] }),
    ev('c1', { kind: 'cheque', customer: 'AL MALTA KITCHENS LLC', amount: 3500, text: 'AL MALTA KITCHENS LLC 3,500 cheque' }), ev('c2', { kind: 'cheque', customer: 'AL AHLIA KITCHEN', amount: 3500, text: 'AL AHLIA KITCHEN 3,500 cheque' }),
  ];
  const known = (n) => /AHLIA|PVC WORK|AKRASAA/.test(n);
  const list = cleanPaymentEvents({ events, isKnown: known });
  assert.deepEqual(list.map((e) => [e.customer, e.amount]).sort(), [['AKRASAA LIONS FOR KITCHENS', 164], ['AL AHLIA KITCHEN', 3500], ['PVC WORK', 789.5]]);
  assert.equal(list.find((e) => e.customer === 'AL AHLIA KITCHEN').drawer, 'AL MALTA KITCHENS LLC');
  // a reply row with no original stays, nameless, and cleared when the reply said so
  const lone = cleanPaymentEvents({ events: [ev('f3', { customer: 'PLZ IT', amount: 500, text: 'Plz clear it' })] });
  assert.deepEqual([lone[0].customer, lone[0].cleared, lone[0].pendingName], ['', true, true]);
  // the received report: counted once, the drawer named
  const items = receivedItems(list, { from: '2026-11-11', to: '2026-11-11' }, { timeZone: 'Asia/Dubai', lookup: new Map() });
  const text = receivedText(items, { title: '11/11', records: [], now: at + 3600000 });
  assert.match(text, /\*AL AHLIA KITCHEN\*\n⏳ 3,500\.00  cheque not cleared \(0 days\) \(drawer AL MALTA KITCHENS LLC\)/); assert.doesNotMatch(text, /PLZ|ALSO THIS|WAHDAN/); assert.equal((text.match(/3,500\.00/g) || []).length >= 1, true);
});

test('one answer for a row in both reports: a payment recorded under a near spelling or as a line of a bigger payment is found by «payments to match» as well', () => {
  const at = Date.parse('2026-11-11T12:00:00Z');
  const event = { type: 'payment', kind: 'cash', currency: 'AED', ref: 'x', at, customer: 'Alia wood', amount: 749.7, lines: [] };
  const record = { Id: '1', TxnDate: '2026-11-11', TotalAmt: 749.7, CustomerRef: { name: 'ALIAA WOODS' } };
  assert.ok(findRecorded(event, [record])); // the doubled letter and the plural, as in the received report
  assert.ok(matchReceipts([{ customer: 'Alia wood', amount: 749.7, day: '2026-11-11' }], [record]).size === 1);
  const inLine = { Id: '2', TxnDate: '2026-11-11', TotalAmt: 2000, CustomerRef: { name: 'ALIAA WOODS' }, Line: [{ Amount: 749.7 }, { Amount: 1250.3 }] };
  assert.ok(findRecorded(event, [inLine])); // a line of a bigger payment
  assert.equal(findRecorded(event, [{ ...record, CustomerRef: { name: 'OMEGA CO' } }]), null);
});

// ---- the customer first, then the amount
import { closestMatch } from '../src/expenses.js';
import { PayChecks } from '../src/paychecks.js';

test('a rounded post is matched by CUSTOMER first, then by amount: within 1 AED it is the same payment (shown with both figures), beyond it it needs the owner\'s OK with a code; nothing is recorded', () => {
  const item = (customer, amount) => ({ customer, amount, day: '2026-11-11', kind: 'cash', shown: '*' + amount.toFixed(2) + '*', invoices: [], ref: 'r' + amount, cleared: false, due: '', drawer: '', accepted: null, rejected: null, foreign: false });
  const rec = (name, total, extra = {}) => ({ Id: String(total), TxnDate: '2026-11-11', TotalAmt: total, CustomerRef: { name }, _type: 'Payment', ...extra });
  const inv = (name, doc, balance) => ({ Id: doc, DocNumber: doc, TxnDate: '2026-11-05', Balance: balance, CustomerRef: { name } });
  const items = [item('zeta work', 789.5), item('nova lions for kitchens', 164), item('tau co', 3000), item('sigma co', 500), item('phi co', 2500)];
  const records = [rec('ZETA WORK CARPENTER LLC', 789.6)];
  const openInvoices = [inv('NOVA LIONS FOR KITCHENS', 'inv-9990', 163.8), inv('TAU CO', 'inv-9991', 1500), inv('TAU CO', 'inv-9992', 1499.1), inv('OMEGA CO', 'inv-9993', 500), inv('PHI CO', 'inv-9994', 2497.5)];
  const codes = []; const checks = { codeFor: (ref, text) => { codes.push([ref, text]); return 'G' + codes.length; } };
  const text = receivedText(items, { title: '11/11', records, openInvoices, checks });
  assert.match(text, /\*ZETA WORK\*\n🟢 789\.50\n      ↳ \(QuickBooks 789\.60\)/); // 0.10 apart: the same payment
  assert.match(text, /\*NOVA LIONS FOR KITCHENS\*\n🔴 164\.00  not in QuickBooks yet \(pays inv-9990, 163\.80\)/); // the open invoice, 0.20 apart
  assert.match(text, /\*SIGMA CO\*\n🔴 500\.00  not in QuickBooks yet(?! \(pays)/); // OMEGA's invoice of 500 is another customer: the customer comes first
  assert.match(text, /\*TAU CO\*\n🔴 3000\.00  not in QuickBooks yet \(pays inv-9991 \+ inv-9992, 2,999\.10\)/); // 0.90 apart: still the same payment, as a proposal
  assert.match(text, /❓ \*Needs your OK\*\n#G1: PHI CO 2,500\.00 vs inv-9994 2,497\.50 \(−2\.50\) — yes #G1 \/ no #G1/); // beyond 1.00: never matched by itself
  assert.deepEqual(codes, [['r2500', 'inv-9994 2,497.50']]); assert.equal(closestMatch(item('omega co', 100), [], openInvoices).kind, 'invoices');
  const store = new PayChecks(''); const g1 = store.codeFor('r1', 'inv-1 5.00'); assert.equal(g1, 'G1'); assert.equal(store.codeFor('r1', 'inv-1 5.00'), 'G1'); assert.equal(store.codeFor('r2', 'inv-2 7.00'), 'G2'); assert.deepEqual(store.openIds(), ['G1', 'G2']); store.close('G1', 'accepted'); assert.deepEqual(store.openIds(), ['G2']);
});

test('the real stored rows of 11/11 (made-up names): a row made by a reply («plz it») with the quoted caption as text is dropped when the original stands, else it takes the caption\'s customer; a photo of a cheque and a cheque row are one', () => {
  const at = Date.parse('2026-11-11T09:13:00Z');
  const events = [
    { type: 'payment', kind: 'cash', currency: 'AED', customer: 'zeta work', customerTyped: 'zeta work', amount: 789.5, at, ref: 'o1', text: 'Cash from zeta work 789.5 aed' },
    { type: 'payment', kind: 'cash', currency: 'AED', customer: 'Plz it', customerTyped: 'Plz it', amount: 789.5, at: at + 3 * 3600000, ref: 'f1', text: 'Cash from zeta work \n789.5 aed' }, // the reply's words, the quoted caption
    { type: 'payment', kind: 'cash', currency: 'AED', customer: 'Also this', customerTyped: 'Also this', amount: 164, at: at + 3 * 3600000, ref: 'f2', text: 'Cash from nova lions for kitchens \n164 aed' }, // no original in the list
    { type: 'payment', customer: 'AL MALTA TEST LLC', amount: 3500, at, ref: 'c1', source: 'photo' }, // a photo of the cheque: the drawer
    { type: 'payment', kind: 'cheque', currency: 'AED', customer: 'AL AHLIA TEST', amount: 3500, at: at + 3600000, ref: 'c2', text: 'AL AHLIA TEST 3,500 cheque' },
  ];
  const list = cleanPaymentEvents({ events, isKnown: (n) => /AHLIA|zeta|nova/i.test(n) });
  const by = Object.fromEntries(list.map((e) => [e.ref, e]));
  assert.deepEqual(Object.keys(by).sort(), ['c2', 'f2', 'o1']); // f1 is the original's duplicate, c1 is the cheque's drawer
  assert.ok(by.f2.customer.toLowerCase().includes('nova')); assert.equal(by.c2.drawer, 'AL MALTA TEST LLC'); assert.equal(by.c2.kind, 'cheque');
  assert.deepEqual(list.map((e) => e.amount).reduce((a, b) => a + b, 0), 789.5 + 164 + 3500);
});

test('one cheque seen three ways (the post with «cheaque» in the name, the photo with the drawer, the bank\'s clearing message) is ONE row under cheques: received 10/11, cleared 11/11, drawer named, counted once', () => {
  const t = (d, hh) => Date.parse(`2026-11-${d}T${hh}:00Z`);
  const events = [
    { type: 'payment', kind: 'cash', currency: 'AED', ref: 'p1', at: t('10', '05:06'), customer: 'Al ahlia cheaque', text: 'Al ahlia cheaque 3500 aed', amount: 3500 },
    { type: 'payment', kind: 'cheque', currency: 'AED', ref: 'p2', at: t('11', '06:11'), customer: 'AL MALTA TEST LLC', source: 'photo', amount: 3500 },
    { type: 'payment', kind: 'cash', currency: 'AED', ref: 'p3', at: t('11', '06:37'), customer: 'AL AHLIA TEST', text: 'Your account is credited with AED 3500.00 for Outward Cheque Clearing', amount: 3500 },
  ];
  const list = cleanPaymentEvents({ events, isKnown: (n) => /AHLIA/i.test(n) });
  assert.equal(list.length, 1); const e = list[0];
  assert.deepEqual([e.kind, e.cleared, e.drawer, e.customer.toLowerCase()], ['cheque', true, 'AL MALTA TEST LLC', 'al ahlia']);
  const items = receivedItems(list, { from: '2026-11-11', to: '2026-11-11' }, { timeZone: 'Asia/Dubai', lookup: new Map() });
  assert.equal(items.length, 1); assert.equal(items[0].kind, 'cheque'); // listed on the clearing day, under cheques, once
  const text = receivedText(items, { title: '11/11', records: [{ TxnDate: '2026-11-11', TotalAmt: 3500, CustomerRef: { name: 'AL AHLIA TEST' } }] });
  assert.match(text, /🧾 \*Cheques\*\n\n\*AL AHLIA\*\n🟢 3,500\.00  cleared 11\/11 \(drawer AL MALTA TEST LLC\) received 10\/11/); assert.match(text, /\*Total: 3,500\.00 AED\*\nCash 0\.00 \| Cheques 3,500\.00 \| Transfers 0\.00/);
  // a clearing message with no cheque known is still a cheque, never cash
  const lone = cleanPaymentEvents({ events: [events[2]] }); assert.deepEqual([lone[0].kind, lone[0].cleared], ['cheque', true]);
  // the oldest open cheque of the amount is cleared, the one with the customer's name first
  const two = cleanPaymentEvents({ events: [{ ...events[0], ref: 'a', customer: 'OMEGA CO', text: 'OMEGA CO cheque 3500', at: t('05', '05:00') }, { ...events[0], ref: 'b', at: t('08', '05:00') }, events[2]], isKnown: () => true });
  assert.deepEqual(two.map((x) => [x.ref, !!x.cleared]).sort(), [['a', false], ['b', true]]);
});

test('the owner\'s cheque process: the bank message quote-replied on the cheque clears THAT cheque (same amount) or waits for the OK (other amount); a message with no reply clears the one cheque that fits, and two that fit wait for the OK', () => {
  const t = (d, hh) => Date.parse(`2026-11-${d}T${hh}:00Z`);
  const cheque = (ref, customer, d, amount = 3500, extra = {}) => ({ type: 'payment', kind: 'cheque', currency: 'AED', ref, at: t(d, '05:00'), customer, amount, text: customer + ' cheque ' + amount, ...extra });
  const sms = (ref, d, amount = 3500) => ({ type: 'payment', kind: 'cash', currency: 'AED', ref, at: t(d, '08:00'), customer: '', pendingName: true, amount, text: 'Your AC is credited with AED ' + amount + '.00 for Outward Cheque Clearing' });
  // no reply: two open cheques of the amount, none by that name: nothing is guessed
  const two = cleanPaymentEvents({ events: [cheque('a', 'ZETA CO', '05'), cheque('b', 'NOVA CO', '07'), sms('s', '11')], isKnown: () => true });
  assert.deepEqual(two.map((e) => [e.ref, !!e.cleared, e.pendingClearing?.count]), [['a', false, 2], ['b', false, 2]]);
  const items = receivedItems(two, { from: '2026-11-05', to: '2026-11-11' }, { timeZone: 'Asia/Dubai', lookup: new Map() });
  const codes = []; const text = receivedText(items, { title: 't', now: t('11', '09:00'), checks: { codeFor: (ref, tx, action) => { codes.push([ref, action]); return 'G' + codes.length; } } });
  assert.match(text, /❓ \*Needs your OK\*\n#G1: ZETA CO cheque 3,500\.00 — a bank clearing of 3,500\.00 arrived 11\/11 and 2 open cheques fit it: is it this one\? — yes #G1 \(cleared\) \/ no #G1/); assert.deepEqual(codes, [['a', 'clear'], ['b', 'clear']]);
  assert.match(text, /🔴 3,500\.00  cheque not cleared \(6 days\)/); // the age of an open cheque
  // one cheque by that name among two: that one
  assert.deepEqual(cleanPaymentEvents({ events: [cheque('a', 'ZETA CO', '05'), cheque('b', 'NOVA CO', '07'), { ...sms('s', '11'), customer: 'NOVA CO', pendingName: false }], isKnown: () => true }).map((e) => [e.ref, !!e.cleared]), [['a', false], ['b', true]]);
  // a quoted clearing with another amount: the cheque stays open and shows the question
  const mismatch = cleanPaymentEvents({ events: [{ ...cheque('m', 'ZETA CO', '05'), clearingMismatch: { amount: 3200, at: t('11', '08:00') } }], isKnown: () => true });
  const text2 = receivedText(receivedItems(mismatch, { from: '2026-11-05', to: '2026-11-11' }, { timeZone: 'Asia/Dubai', lookup: new Map() }), { title: 't', now: t('11', '09:00'), checks: { codeFor: () => 'G9' } });
  assert.match(text2, /the bank cleared 3,200\.00 for this cheque of 3,500\.00 \(−300\.00\) — yes #G9 \(cleared\) \/ no #G9/);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(index, /if \(role === 'payment' && quotedId && text && isClearingText\(text\)\) \{[\s\S]*?if \(same\) tracker\.update\(cheque\.ref, \{ kind: 'cheque', cleared: true, clearedAt: nowAt\(\)[\s\S]*?return;\n    \}\n  \}/); // silent, never a payment
  assert.match(index, /if \(x\.action === 'clear'\) \{[\s\S]*?cleared: true, clearedAt: x\.clearedAt/);
});

test('a cheque photo whose name is not our customer is the drawer of a same-amount cheque within 14 days, open or cleared, on any day; two candidates ask the owner', () => {
  const t = (d, hh) => Date.parse(`2026-11-${d}T${hh}:00Z`);
  const known = (n) => /ZETA/.test(n);
  const cheque = (ref, customer, d, extra = {}) => ({ type: 'payment', kind: 'cheque', currency: 'AED', ref, at: t(d, '05:00'), customer, amount: 3500, text: customer + ' cheque 3500', ...extra });
  const photo = { type: 'payment', kind: 'cheque', source: 'photo', currency: 'AED', ref: 'p', at: t('11', '06'), customer: 'OMEGA KITCHENS LLC', amount: 3500, text: '' };
  const one = cleanPaymentEvents({ events: [cheque('a', 'ZETA KITCHEN', '05', { cleared: true, clearedAt: t('10', '08') }), photo], isKnown: known });
  assert.deepEqual(one.map((e) => [e.ref, e.drawer]), [['a', 'OMEGA KITCHENS LLC']]);
  const two = cleanPaymentEvents({ events: [cheque('a', 'ZETA KITCHEN', '05'), cheque('b', 'ZETA JOINERY', '07'), photo], isKnown: known });
  assert.equal(two.length, 3); assert.equal(two.find((e) => e.ref === 'p').drawerAsk.length, 2);
  const yes = cleanPaymentEvents({ events: [cheque('a', 'ZETA KITCHEN', '05'), cheque('b', 'ZETA JOINERY', '07'), { ...photo, drawerInto: 'b' }], isKnown: known });
  assert.deepEqual(yes.map((e) => [e.ref, e.drawer || '']), [['a', ''], ['b', 'OMEGA KITCHENS LLC']]);
});

test('a message that starts with her name and holds a code and a quantity word is a plain stock question, whatever polite word stands between; the reserved list is sorted by code, in en and fa', async () => {
  const { stockAsk } = await import('../src/staff.js');
  const { reservedText, sortedReserved } = await import('../src/reserved.js');
  for (const t of ['atossa check 409 qty', 'Atossa 409 qty', 'Atossa please check 409 quantity?', 'ATOSSA see 409 stock']) assert.equal(stockAsk(t, ['Atossa']), 'Stock of code 409', t);
  assert.equal(stockAsk('Ok atossa check 409 ?', ['Atossa']), null); // does not start with her name
  assert.equal(stockAsk('atossa check 409 and 410 qty', ['Atossa']), null); // an extra word: the model reads it
  assert.equal(stockAsk('atossa 409 410 qty', ['Atossa']), 'Stock of code 409. Stock of code 410');
  const rows = [{ code: '511', unit: 'm', reserved: 20, customers: ['ZETA CO'] }, { code: '409', unit: 'm', reserved: 45.5, customers: ['NOVA CO', 'ZETA CO'] }, { code: '300', unit: 'm', reserved: 0, customers: [] }];
  assert.deepEqual(sortedReserved(rows).map((r) => r.code), ['409', '511']);
  assert.equal(reservedText({ ok: true, rows }, 'en'), 'Reserved so far (2 codes)\n409 — 45.5 m — for NOVA CO, ZETA CO\n511 — 20 m — for ZETA CO');
  assert.match(reservedText({ ok: true, rows }, 'fa'), /^رزروشده تا الان \(2 کد\)\n409 — 45.5 m — برای NOVA CO, ZETA CO/);
  assert.match(reservedText({ ok: true, rows: [] }, 'en'), /Nothing is reserved/);
  const gs = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'zinax-stock', 'apps-script', 'Code.gs'), 'utf8');
  assert.match(gs, /if \(req\.reservedList\) return botReserved_\(\);/);
});

test('old cut rows: the shared-group name is repaired on read from the sheet OUT row; the owner corrects rows with a preview, a yes and an undo', async () => {
  const { repairSharedCuts } = await import('../src/cutrepair.js');
  const { CutEdits, parseCutCommand, listCuts, requestCutEdit, decideCutEdit } = await import('../src/cutedit.js');
  const at = Date.parse('2026-11-08T08:00:00Z');
  const cut = (ref, q, extra = {}) => ({ type: 'cut', ref, at: at + q, customer: 'NOVA KITCHENS LLC', lines: [{ code: '215', quantity: q, unit: 'm' }], ...extra });
  const events = [cut('a', 72.6), cut('b', 97.6), cut('c', 40, { customerTyped: 'NOVA KITCHENS LLC' })];
  const outs = [{ customer: 'ZETA JOINERY', code: '215', qty: 72.6, at }, { customer: 'ZETA JOINERY', code: '215', qty: 25.6, at: at + 1000 }];
  const fixed = repairSharedCuts(events, outs, ['NOVA KITCHENS LLC'], { timeZone: 'Asia/Dubai' });
  assert.deepEqual(fixed.map((e) => [e.ref, e.customer]), [['b', 'ZETA JOINERY'], ['c', 'NOVA KITCHENS LLC']]); // 72.6 is a part of the larger cut: not counted twice
  assert.equal(events[0].customer, 'NOVA KITCHENS LLC'); // the stored rows are untouched
  assert.equal(repairSharedCuts(events, [{ customer: 'ZETA JOINERY', code: '300', qty: 72.6, at }], ['NOVA KITCHENS LLC']), events); // another code: nothing
  assert.equal(repairSharedCuts(events, outs, []), events);
  assert.deepEqual(parseCutCommand('cuts 215 08/11'), { op: 'list', code: '215', day: '11-08' });
  assert.deepEqual(parseCutCommand('cut #Z12 merge #Z13'), { op: 'merge', row: 'Z12', other: 'Z13' });
  assert.deepEqual(parseCutCommand('Atossa cut Z3 customer AL EBDA KITCHEN'), { op: 'customer', row: 'Z3', name: 'AL EBDA KITCHEN' });
  assert.equal(parseCutCommand('cut something'), null);
  const tracker = new Tracker({ dir: '' });
  for (const e of [cut('a', 72.6), cut('b', 25.6)]) tracker.add(e);
  const store = new CutEdits('');
  const list = listCuts(store, tracker.events, { code: '215', day: '11-08', timeZone: 'Asia/Dubai' });
  assert.match(list, /#Z1 .*NOVA KITCHENS LLC .*215 72\.6 m/); assert.match(list, /#Z2 .*215 25\.6 m/);
  const preview = requestCutEdit(store, tracker, { op: 'merge', row: 'Z1', other: 'Z2' }, {});
  assert.match(preview, /yes #X1 \/ no #X1/); assert.equal(tracker.events[0].lines[0].quantity, 72.6); // nothing before the yes
  assert.match(decideCutEdit(store, tracker, 'yes', 'X1')[0], /^Done #X1/);
  assert.equal(tracker.events[0].lines[0].quantity, 98.2); assert.equal(tracker.events[1].internal, true);
  assert.match(decideCutEdit(store, tracker, 'undo', 'X1')[0], /^Undone #X1/);
  assert.equal(tracker.events[0].lines[0].quantity, 72.6); assert.ok(!tracker.events[1].internal);
  requestCutEdit(store, tracker, { op: 'customer', row: 'Z1', name: 'ZETA JOINERY' }, {});
  assert.match(decideCutEdit(store, tracker, 'no', 'X2')[0], /^Refused/); assert.equal(tracker.events[0].customer, 'NOVA KITCHENS LLC');
  requestCutEdit(store, tracker, { op: 'cancel', row: 'Z2' }, {}); decideCutEdit(store, tracker, 'yes', 'X3');
  assert.ok(tracker.events[1].cancelled && tracker.events[1].internal);
});

test('credit customers who pay in parts: a found payment says how QuickBooks applied it; a payment on account says the open balance; a mistyped amount (digits swapped) of the same customer asks the owner', async () => {
  const { receivedText } = await import('../src/expenses.js');
  const dubai = (d) => `2026-11-${d}`;
  const item = (extra) => ({ amount: 567, shown: '*567.00*', foreign: false, unconverted: false, note: '', day: dubai('10'), customer: 'ZETA KITCHEN', typed: '', kind: 'cash', invoices: [], cleared: false, due: '', drawer: '', at: Date.parse('2026-11-10T10:00:00Z'), ref: 'r1', paid: null, ...extra });
  const open = [{ Id: '70', DocNumber: '9925', Balance: 939.83, CustomerRef: { name: 'ZETA KITCHEN' }, TxnDate: dubai('01') }, { Id: '71', DocNumber: '9930', Balance: 500, CustomerRef: { name: 'OMEGA SHOP' }, TxnDate: dubai('02') }];
  const pay = { _type: 'Payment', TxnDate: dubai('10'), TotalAmt: 567, CustomerRef: { name: 'ZETA KITCHEN' }, Line: [{ Amount: 567, LinkedTxn: [{ TxnId: '70', TxnType: 'Invoice' }] }] };
  const now = Date.parse('2026-11-11T09:00:00Z');
  const found = receivedText([item({})], { title: 't', records: [pay], openInvoices: open, now });
  assert.match(found, /\*ZETA KITCHEN\*\n🟢 567\.00(?!\s*\()/); assert.doesNotMatch(found, /applied to/); // a green line is only the amount
  const onAccount = receivedText([item({ amount: 300, shown: '*300.00*' })], { title: 't', records: [], openInvoices: open, now });
  assert.match(onAccount, /🔴 300\.00  not in QuickBooks yet \(open balance 939\.83\)/);
  assert.doesNotMatch(onAccount, /Needs your OK/);
  // 576 posted for the customer the program chose (OMEGA SHOP); the typed name is the customer who paid 567 two lines above
  const swapped = receivedText([item({ amount: 576, shown: '*576.00*', customer: 'OMEGA SHOP', typed: 'ZETA KITCHEN' })], { title: 't', records: [pay], openInvoices: open, now, checks: { codeFor: () => 'G5' } });
  assert.match(swapped, /not in QuickBooks yet \(digits swapped\? 567\.00 was recorded; asked in your chat\)/); assert.doesNotMatch(swapped, /Needs your OK/); // asked at once in the owner's chat, not in the list
  const { swapCandidate } = await import('../src/expenses.js');
  const ev = { amount: 576, customer: 'OMEGA SHOP', customerTyped: 'ZETA KITCHEN', at: Date.parse('2026-11-10T15:00:00Z') };
  assert.equal(swapCandidate(ev, [pay], () => '', 'Asia/Dubai'), pay);
  assert.equal(swapCandidate({ ...ev, amount: 600 }, [pay], () => '', 'Asia/Dubai'), null); // not the same digits
  assert.equal(swapCandidate(ev, [pay, { ...pay, TotalAmt: 576 }], () => '', 'Asia/Dubai'), null); // the posted amount is recorded: nothing to ask
  assert.equal(swapCandidate({ ...ev, swapAsked: true }, [pay], () => '', 'Asia/Dubai'), null); // asked once only
  const { parseInvoiceCommand } = await import('../src/qboinvoice.js');
  assert.deepEqual(parseInvoiceCommand('1'), { type: 'swap_answer', choice: 1, id: '' });
  assert.deepEqual(parseInvoiceCommand('2 #G5'), { type: 'swap_answer', choice: 2, id: 'G5' });
  const idx = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(idx, /if \(x\.action === 'swap'\) \{[\s\S]*?acceptedMatch[\s\S]*?rejectedMatch/); // 1 = same payment (shows the tick), 2 = stays not recorded
  assert.ok(idx.includes("await sock.sendMessage(ownIds()[0], { text: ['🤖 Payment check #'")); // the owner's own chat, never a group
  assert.doesNotMatch(swapped, /on account/);
});

test('the approved money received layout: bold name per customer, a line per receipt with 🟢/🔴, one rule between customers, two between sections, bold totals only, no payments-to-match list', async () => {
  const { receivedText } = await import('../src/expenses.js');
  const { SEP } = await import('../src/separator.js');
  const now = Date.parse('2026-11-11T16:00:00Z');
  const it = (customer, amount, kind = 'cash', extra = {}) => ({ amount, shown: '*' + amount.toFixed(2) + '*', foreign: false, unconverted: false, note: '', day: '2026-11-11', customer, typed: '', kind, invoices: [], cleared: false, due: '', drawer: '', at: now - 3600000, ref: customer + amount, paid: null, ...extra });
  const recs = [{ _type: 'Payment', TxnDate: '2026-11-11', TotalAmt: 789.6, CustomerRef: { name: 'PVC WORK LLC' } }, { _type: 'Payment', TxnDate: '2026-11-11', TotalAmt: 176.4, CustomerRef: { name: 'ZETA WOOD' } }, { _type: 'Payment', TxnDate: '2026-11-11', TotalAmt: 749.7, CustomerRef: { name: 'ZETA WOOD' } }];
  const open = [{ Id: '1', DocNumber: '9925', Balance: 939.83, CustomerRef: { name: 'NOVA KITCHEN' } }];
  const text = receivedText([it('PVC WORK LLC', 789.5), it('ZETA WOOD', 176.4), it('ZETA WOOD', 749.7), it('NOVA KITCHEN', 576), it('OMEGA CO', 3500, 'cheque', { cleared: true, clearedDay: '2026-11-11', drawer: 'DRAWER LLC' })], { title: '11/11/2026', records: recs, openInvoices: open, now });
  assert.equal(text, ['💰 *Money received — 11/11/2026*', SEP, SEP, '💵 *Cash*', '', '*PVC WORK LLC*', '🟢 789.50', '      ↳ (QuickBooks 789.60)', SEP, '*ZETA WOOD*', '🟢 176.40', '🟢 749.70', SEP, '*NOVA KITCHEN*', '🔴 576.00  not in QuickBooks yet (open balance 939.83)', SEP, SEP, '🧾 *Cheques*', '', '*OMEGA CO*', '🟢 3500.00  cleared 11/11 (drawer DRAWER LLC)', SEP, SEP, '*Total: 5,791.60 AED*', 'Cash 2,291.60 | Cheques 3,500.00 | Transfers 0.00', '🟢 Recorded: 4    🔴 Not recorded: 1'].join('\n'));
  assert.doesNotMatch(text, /Payments to match/);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.doesNotMatch(index, /paymentsReport\(tracker\.events, '', \{ days: 1, questions: false \}\)/); // the separate list is gone from the day's report
});

test('the approved invoice lines: one invoice after the amount on the same line (each payment its own), the QuickBooks amount on the next line, a payment over several invoices has no number on its amount line and the closed/partly paid lines', async () => {
  const { receivedText } = await import('../src/expenses.js');
  const now = Date.parse('2026-11-11T16:00:00Z');
  const item = (customer, amount, ref) => ({ amount, shown: '*' + amount.toFixed(2) + '*', foreign: false, unconverted: false, note: '', day: '2026-11-11', customer, typed: '', kind: 'cash', invoices: [], cleared: false, due: '', drawer: '', at: now - 3600000, ref, paid: null });
  const pay = (customer, amount, lines) => ({ _type: 'Payment', TxnDate: '2026-11-11', TotalAmt: amount, CustomerRef: { name: customer }, Line: lines.map((x) => ({ Amount: x[1], LinkedTxn: [{ TxnId: x[0], TxnType: 'Invoice' }] })) });
  const linkedInvoices = [{ Id: '1', DocNumber: 'inv-10005', TotalAmt: 176.4, Balance: 0 }, { Id: '2', DocNumber: '9966', TotalAmt: 749.7, Balance: 0 }, { Id: '3', DocNumber: '10012', TotalAmt: 789.6, Balance: 0 }, { Id: '4', DocNumber: '9880', TotalAmt: 900, Balance: 0 }, { Id: '5', DocNumber: '9901', TotalAmt: 300, Balance: 0 }, { Id: '6', DocNumber: '9940', TotalAmt: 800, Balance: 500 }];
  const records = [pay('ALIA', 176.4, [['1', 176.4]]), pay('ALIA', 749.7, [['2', 749.7]]), pay('PVC', 789.6, [['3', 789.6]]), pay('CREDIT', 1500, [['4', 900], ['5', 300], ['6', 300]])];
  const text = receivedText([item('ALIA', 176.4, 'a'), item('ALIA', 749.7, 'b'), item('PVC', 789.5, 'c'), item('CREDIT', 1500, 'd')], { title: 't', records, linkedInvoices, now });
  assert.match(text, /\*ALIA\*\n🟢 176\.40     inv-10005\n🟢 749\.70     inv-9966\n/); // each payment its own invoice, no double prefix
  assert.match(text, /\*PVC\*\n🟢 789\.50     inv-10012\n      ↳ \(QuickBooks 789\.60\)\n/);
  assert.match(text, /\*CREDIT\*\n🟢 1500\.00\n     _↳ closed: inv-9880, inv-9901_\n     _↳ inv-9940: 300\.00 of 800\.00 paid_ \*500\.00 open\*/);
  assert.doesNotMatch(text, /applied|inv-inv-|inv #/);
});

test('a cleared cheque gets the same invoice lines as cash: closed invoices and the partly paid one (paid by this payment of its total, the balance open)', async () => {
  const { receivedText } = await import('../src/expenses.js');
  const now = Date.parse('2026-11-11T16:00:00Z');
  const item = { amount: 3500, shown: '*3,500.00*', foreign: false, unconverted: false, note: '', day: '2026-11-10', customer: 'AL AHLIA KITCHEN', typed: '', kind: 'cheque', invoices: [], cleared: true, clearedDay: '2026-11-11', due: '', drawer: 'AL MALTA KITCHENS LLC', at: now - 3600000, ref: 'c', paid: null };
  const pay = { _type: 'Payment', TxnDate: '2026-11-11', TotalAmt: 3500, CustomerRef: { name: 'AL AHLIA KITCHEN' }, Line: [['1', 1797.25], ['2', 1496.25], ['3', 206.5]].map((x) => ({ Amount: x[1], LinkedTxn: [{ TxnId: x[0], TxnType: 'Invoice' }] })) };
  const linkedInvoices = [{ Id: '1', DocNumber: '9679', TotalAmt: 1797.25, Balance: 0 }, { Id: '2', DocNumber: '9738', TotalAmt: 1496.25, Balance: 0 }, { Id: '3', DocNumber: '9841', TotalAmt: 3706.5, Balance: 3500 }];
  const text = receivedText([item], { title: 't', records: [pay], linkedInvoices, now });
  assert.match(text, /\*AL AHLIA KITCHEN\*\n🟢 3,500\.00  cleared 11\/11 \(drawer AL MALTA KITCHENS LLC\)\n     _↳ closed: inv-9679, inv-9738_\n     _↳ inv-9841: 206\.50 of 3,706\.50 paid_ \*3,500\.00 open\*/);
  assert.doesNotMatch(text, /received 10\/11/); // dropped when the invoice lines are there
  const one = receivedText([item], { title: 't', records: [{ ...pay, Line: [pay.Line[0]], TotalAmt: 3500 }], linkedInvoices, now });
  assert.match(one, /cleared 11\/11 \(drawer AL MALTA KITCHENS LLC\)     inv-9679/); // one invoice: its number after the line
});

test('expenses: a complete one-message entry is recorded silently; a missing card/cash or a different receipt amount asks once; the 19:00 report in the new style; edit/delete by number with a preview, 1/2, undo; a repeat asks once', async () => {
  const { ExpenseStore, makeEntry, handleReply, findExpenseDuplicate, entryText } = await import('../src/expenses.js');
  const { expensesReport, parseExpenseEdit, requestExpenseEdit, answerExpenseEdit, undoExpense } = await import('../src/expenseedit.js');
  const { SEP } = await import('../src/separator.js');
  const now = Date.parse('2026-11-11T10:00:00Z');
  const store = new ExpenseStore('', () => now);
  const make = (caption, reading) => store.add(makeEntry({ caption, reading, hasReceipt: !!reading, hasPhoto: true, by: 'u1', byName: 'Sam', ref: caption, at: now }));
  const a = make('85.5 fuel card', { total: 85.5, vendor: 'ADNOC', date: '2026-11-11' });
  assert.equal(a.state, 'done'); assert.equal(a.method, 'card'); assert.equal(a.type, 'fuel'); // silent: no question
  const b = make('40 fuel', { total: 40, vendor: 'ENOC', date: '2026-11-11' });
  assert.equal(b.state, 'ask_method'); assert.match(entryText(b), /1\. Card {3}2\. Cash/);
  assert.equal(handleReply(store, 'u1', { pick: '2' }).text.includes('saved'), true); assert.equal(store.get(b.id).method, 'cash');
  const c = make('50 car card', { total: 47, vendor: 'GARAGE', date: '2026-11-11' }); // the receipt differs from the caption
  assert.equal(c.state, 'pick_amount'); handleReply(store, 'u1', { pick: '2' }); assert.equal(store.get(c.id).state, 'done'); assert.equal(store.get(c.id).amount, 50); // the method was in the caption: no second question
  const d = make('85.5 fuel card', { total: 85.5, vendor: 'ADNOC', date: '2026-11-11' });
  assert.equal(findExpenseDuplicate(store, d).id, a.id); d.state = 'dup_ask'; d.dupAsk = a.id; // same amount, vendor and day: asked once
  assert.match(handleReply(store, 'u1', { pick: '1' }).text, /counted once/); assert.equal(store.get(d.id).state, 'cancelled');
  const text = expensesReport(store.done({ from: '2026-11-11', to: '2026-11-11' }), [{ TxnDate: '2026-11-11', TotalAmt: 85.5, EntityRef: { name: 'ADNOC STATION' } }], '11/11/2026');
  assert.match(text, /^🧾 \*Expenses — 11\/11\/2026\*\n━+\n━+\n⛽ \*Fuel\*\n🟢 85\.50 {3}card {3}ADNOC {5}#E1\n🔴 40\.00 {3}cash {3}ENOC {6}#E2\n━+\n🚗 \*Car\*\n🔴 50\.00 {3}card {3}GARAGE {4}#E3\n━+\n━+\n\*Total: 175\.50 AED\*\nCash box 40\.00 \| Bank card 135\.50\n🟢 In QuickBooks: 1 {4}🔴 Not yet: 2$/);
  const ex = parseExpenseEdit('Atossa edit #E2\ncard\namount 42.50\ntype car');
  assert.deepEqual(ex, { op: 'edit', id: 'E2', changes: { method: 'card', amount: 42.5, type: 'vehicles' }, bad: [] });
  assert.deepEqual(parseExpenseEdit('Atossa edit #E2 cash'), { op: 'edit', id: 'E2', changes: { method: 'cash' }, bad: [] });
  assert.deepEqual(parseExpenseEdit('Atossa delete #E2'), { op: 'delete', id: 'E2' }); assert.equal(parseExpenseEdit('delete #E2'), null); // a bare delete is the owner's old hard delete
  const preview = requestExpenseEdit(store, ex, { chat: 'g', sender: 'u1', inQb: true });
  assert.match(preview, /✏️ Edit expense #E2 — 11\/11\/2026, ENOC\nPayment: {2}cash → \*card\*\nAmount: {3}40\.00 → \*42\.50\*\nType: {5}Fuel → \*Car\*\nNothing is changed in QuickBooks\.\nThis expense is already 🟢 in QuickBooks: also fix it in QuickBooks\.\n1\. Yes, change it\n2\. No, keep it/);
  assert.equal(store.get('E2').amount, 40); // nothing before the answer
  assert.equal(answerExpenseEdit(store, 'g', 'u2', '1'), null); // another person's digit is not ours
  assert.match(answerExpenseEdit(store, 'g', 'u1', '1'), /^Changed #E2/); assert.equal(store.get('E2').amount, 42.5); assert.equal(store.get('E2').type, 'vehicles');
  assert.match(undoExpense(store, 'E2'), /^Undone/); assert.equal(store.get('E2').amount, 40); assert.equal(store.get('E2').method, 'cash');
  requestExpenseEdit(store, { op: 'delete', id: 'E2' }, { chat: 'g', sender: 'u1' }); assert.match(answerExpenseEdit(store, 'g', 'u1', '1'), /^Deleted #E2/); assert.equal(store.get('E2').state, 'cancelled');
  assert.match(undoExpense(store, 'E2'), /^Undone/); assert.equal(store.get('E2').state, 'done');
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(index.includes('startsWithName(text, config.botNames) && mayEdit')); // only a message that starts with her name, only the owner and the authorized
  assert.ok(index.includes('async function afterExpenseEntry')); void SEP;
});

test('the cash box: cash to the boss and salary advances are their own kinds (never a customer payment), the month report with the approved layout, matched to QuickBooks transfers, the opening balance carried', async () => {
  const { cashOutKind, cashBoxReport, parseCashBoxCommand } = await import('../src/cashbox.js');
  const { eventsFromCaption } = await import('../src/captionevents.js');
  const { sharedPaymentList } = await import('../src/payments.js');
  const { SEP } = await import('../src/separator.js');
  assert.deepEqual(cashOutKind('18000 deposit to boss'), { kind: 'cash_to_boss', amount: 18000, employee: '' });
  assert.deepEqual(cashOutKind('cash to boss 10000'), { kind: 'cash_to_boss', amount: 10000, employee: '' });
  assert.deepEqual(cashOutKind('advance 500 RAJU'), { kind: 'salary_advance', amount: 500, employee: 'RAJU' });
  assert.equal(cashOutKind('cash from ZETA CO 750'), null); assert.equal(cashOutKind('handed 300 to somebody').kind, 'cash_unclear');
  const ev = eventsFromCaption('payment', 'advance 500 RAJU').events[0];
  assert.deepEqual([ev.kind, ev.amount, ev.employee, ev.customer], ['salary_advance', 500, 'RAJU', '']);
  const at = Date.parse('2026-11-05T09:00:00Z');
  assert.equal(sharedPaymentList({ events: [{ ...ev, at, ref: 'a' }, { type: 'payment', kind: 'cash', customer: 'ZETA CO', amount: 750, at, ref: 'b', currency: 'AED' }] }).length, 1); // the advance is out of every customer list
  const day = (d) => Date.parse('2026-11-' + d + 'T09:00:00Z');
  const { text, remaining } = cashBoxReport({
    month: '2026-11', opening: 2000, cashIn: [{ amount: 25430 }],
    expenses: [{ amount: 610, type: 'fuel' }, { amount: 380.5, type: 'food' }, { amount: 250, type: 'office' }],
    outs: [{ kind: 'cash_to_boss', amount: 10000, at: day('04'), employee: '' }, { kind: 'cash_to_boss', amount: 8000, at: day('18'), employee: '' }, { kind: 'salary_advance', amount: 500, at: day('06'), employee: 'RAJU' }, { kind: 'salary_advance', amount: 1000, at: day('09'), employee: 'AHMED' }],
    transfers: [{ TxnDate: '2026-11-04', Amount: 10000 }, { TxnDate: '2026-11-18', Amount: 8000 }, { TxnDate: '2026-11-06', Amount: 500 }],
    typeLabel: (t) => ({ fuel: 'Fuel', food: 'Food', office: 'Office' }[t]),
  });
  assert.equal(remaining, 4689.5); // the net of the month: 25,430.00 in, 20,740.50 out (no opening balance)
  assert.equal(text, ['📦 *Cash box — 11/2026*', SEP, SEP, '💵 *Cash in*', 'Cash from customers           25,430.00', SEP, SEP, '💸 *Cash out*', '',
    '🧾 *Company expenses (cash)*   1,240.50', '     ↳ Fuel 610.00 | Food 380.50 | Office 250.00', SEP,
    '👔 *Cash to boss*             18,000.00', '🟢 04/11   10,000.00', '🟢 18/11    8,000.00', SEP,
    '👷 *Salary advances*           1,500.00', '🟢 06/11      500.00   RAJU', '🔴 09/11    1,000.00   AHMED  (not in QuickBooks)', SEP, SEP,
    '*Total in (month): 25,430.00 AED*', '*Total out (month): 20,740.50 AED*', '*Net for the month: 4,689.50 AED*', '🟢 In QuickBooks: 3    🔴 Not yet: 1'].join('\n'));
  assert.deepEqual(parseCashBoxCommand('cash box'), { op: 'report' }); assert.deepEqual(parseCashBoxCommand('صندوق'), { op: 'report' });
  assert.deepEqual(parseCashBoxCommand('cash box opening 01/11 2000', new Date('2026-11-12T00:00:00Z')), { op: 'opening', month: '2026-11', amount: 2000 });
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(!index.includes('cashBoxStore.d.opening[prev]')); // no opening balance carries over: the report is the month's own movements
  assert.ok(index.includes("once(`cashbox:${now.day.slice(0, 7)}`)")); // the last day of the month at 19:00, to the owner only
});

test('old stored rows are re-read: «deposit to boss» is cash to the boss (out of the customer cash, counted once), «advance NAME» a salary advance; every expenses report reply is awaited text', async () => {
  const { rederiveCashOut } = await import('../src/cashbox.js');
  const { sharedPaymentList } = await import('../src/payments.js');
  const at = Date.parse('2026-11-04T12:00:00Z');
  const old = { type: 'payment', kind: 'cash', currency: 'AED', ref: 'a', at, customer: 'DEPOSIT TO BOSS', amount: 18000, text: '18000 deposit to boss' };
  const echo = { type: 'payment', kind: 'cash', currency: 'AED', ref: 'b', at: at + 60000, customer: '', amount: 18000, text: 'You 18000 deposit to boss 4/11' };
  const adv = { type: 'payment', kind: 'cash', currency: 'AED', ref: 'c', at, customer: 'RAJU', amount: 500, text: 'advance 500 RAJU' };
  const real = { type: 'payment', kind: 'cash', currency: 'AED', ref: 'd', at, customer: 'BOSS KITCHEN', amount: 700, text: 'cash from BOSS KITCHEN 700' };
  assert.deepEqual([rederiveCashOut(old).kind, rederiveCashOut(echo).kind, rederiveCashOut(adv).kind, rederiveCashOut(adv).employee], ['cash_to_boss', 'cash_to_boss', 'salary_advance', 'RAJU']);
  assert.equal(rederiveCashOut(real), real); // a customer whose name holds «boss» stays a customer
  assert.deepEqual(sharedPaymentList({ events: [old, echo, adv, real] }).map((e) => e.ref), ['d']); // none of the three is customer cash
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(!/\[expensesReportText\(/.test(index)); assert.ok(index.includes('[await expensesReportText(ic.range)]')); // the async report is awaited
  assert.equal((index.match(/expensesReportText\(/g) || []).length, (index.match(/await expensesReportText\(/g) || []).length); // every call is awaited
});

test('the cash box from QuickBooks: the Petty Cash account, cash payments only, transfers out by target, purchases from it; each line compared with the posts; the difference to the QuickBooks balance', async () => {
  const { balanceFromReport, fetchCashBoxQbo, cashBoxReportQbo } = await import('../src/cashbox.js');
  assert.equal(balanceFromReport({ Rows: { Row: [{ Rows: { Row: [{ ColData: [{ value: 'Petty Cash' }, { value: '1,116.50' }] }] } }] } }, 'petty cash'), 1116.5);
  const rows = {
    "select * from Account where Name = 'Petty Cash'": [{ Id: '100' }],
    'select * from PaymentMethod': [{ Id: '1', Name: 'Cash' }, { Id: '2', Name: 'Cheque' }],
    Payment: [{ TxnDate: '2026-11-05', TotalAmt: 750, DepositToAccountRef: { value: '100' }, PaymentMethodRef: { value: '1' }, CustomerRef: { name: 'ZETA CO' } }, { TxnDate: '2026-11-06', TotalAmt: 3500, DepositToAccountRef: { value: '7' }, PaymentMethodRef: { value: '2' } }, { TxnDate: '2026-11-07', TotalAmt: 90, DepositToAccountRef: { value: '100' }, PaymentMethodRef: { value: '1' }, CustomerRef: { name: 'NOVA CO' } }],
    SalesReceipt: [], Transfer: [{ TxnDate: '2026-11-04', Amount: 18000, FromAccountRef: { value: '100' }, ToAccountRef: { value: '9', name: 'OWNER CASH AMOUNT' } }, { TxnDate: '2026-11-06', Amount: 500, FromAccountRef: { value: '100' }, ToAccountRef: { value: '8', name: 'EMPLOYEE ADVANCE' }, PrivateNote: 'RAJU' }, { TxnDate: '2026-11-08', Amount: 40, FromAccountRef: { value: '100' }, ToAccountRef: { value: '5', name: 'Bank Charges' } }],
    Purchase: [{ TxnDate: '2026-11-09', TotalAmt: 85.5, AccountRef: { value: '100' }, EntityRef: { name: 'ADNOC' }, Line: [{ AccountBasedExpenseLineDetail: { AccountRef: { name: 'Fuel' } } }] }, { TxnDate: '2026-11-09', TotalAmt: 12, AccountRef: { value: '3' } }],
  };
  const sheet = (n) => ({ Rows: { Row: [{ ColData: [{ value: 'Petty Cash' }, { value: String(n) }] }] } });
  const qbo = { query: async (sql) => rows[sql] || rows[/from (\w+)/.exec(sql)[1]] || [], get: async (path, q) => sheet(q.end_date === '2026-10-31' ? 2000 : 7200) };
  const data = await fetchCashBoxQbo(qbo, { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual([data.opening, data.closing, data.received.map((r) => r.amount), data.purchases.length, data.transfersOut.length], [null, null, [750, 90], 1, 3]); // the cheque and the other account are out; the balances are not read
  const day = (d) => Date.parse('2026-11-' + d + 'T09:00:00Z');
  const { text, remaining } = cashBoxReportQbo({ month: '2026-11', data, timeZone: 'Asia/Dubai', posts: {
    cashIn: [{ amount: 750, at: day('05') }, { amount: 300, at: day('10') }],
    outs: [{ kind: 'cash_to_boss', amount: 18000, at: day('04') }, { kind: 'salary_advance', amount: 500, at: day('06'), employee: 'RAJU' }, { kind: 'salary_advance', amount: 1000, at: day('09'), employee: 'AHMED' }],
    expenses: [{ amount: 85.5, at: day('09'), vendor: 'ADNOC' }],
  } });
  assert.equal(remaining, 840 - (18000 + 500 + 40 + 85.5)); // the net of the month
  assert.match(text, /\*Net for the month: -17,785\.50 AED\*/); assert.doesNotMatch(text, /Opening balance|Remaining in cash box|Computed remaining/);
  assert.match(text, /Cash from customers\s+840\.00\n     ↳ ⚪ 1 receipt \(90\.00\) with no post in the group\n🔴 10\/11\s+300\.00  \(posted, not in QuickBooks\)/);
  assert.match(text, /🧾 \*Company expenses \(cash\)\*\s+85\.50\n     ↳ Fuel 85\.50\n🟢 09\/11\s+85\.50   ADNOC/);
  assert.match(text, /👔 \*Cash to boss\*\s+18,000\.00\n🟢 04\/11\s+18,000\.00/);
  assert.match(text, /👷 \*Salary advances\*\s+500\.00\n🟢 06\/11\s+500\.00   RAJU\n🔴 09\/11\s+1,000\.00   AHMED  \(posted, not in QuickBooks\)/);
  assert.match(text, /↔️ \*Bank Charges\*\s+40\.00\n⚪ 08\/11\s+40\.00/);
  assert.match(text, /🟢 Posted and in QuickBooks: 4 {4}🔴 Not in QuickBooks: 2 {4}⚪ No post: 2/);
});

test('the cash box matching: a receipt in another account is 🟡, a swapped-digit one asks with its code, «pay … for …» is a cash expense matched within 7 days, an empty boss section stays visible when a post exists', async () => {
  const { cashBoxReportQbo, cashOutKind, rederiveCashOut } = await import('../src/cashbox.js');
  const { sharedPaymentList } = await import('../src/payments.js');
  assert.deepEqual(cashOutKind('Pay by cash 157 aed for garbage box'), { kind: 'cash_expense', amount: 157, employee: 'GARBAGE BOX' });
  assert.equal(cashOutKind('paid 500 cash for invoice 9925'), null); assert.equal(cashOutKind('cash received from ZETA CO 750'), null); // a customer's payment stays one
  const old = { type: 'payment', kind: 'cash', currency: 'AED', ref: 'x', at: Date.parse('2026-11-05T09:00:00Z'), customer: 'GARBAGE BOX', amount: 157, text: 'Pay by cash 157 aed for garbage box' };
  assert.equal(rederiveCashOut(old).kind, 'cash_expense'); assert.equal(sharedPaymentList({ events: [old] }).length, 0);
  const day = (d) => Date.parse('2026-11-' + d + 'T09:00:00Z');
  const data = { opening: 1000, closing: 800, received: [], elsewhere: [{ amount: 176.4, date: '2026-11-11', name: 'ZETA WOOD', account: 'Cash and cash equivalents' }],
    transfersIn: [], transfersOut: [], purchases: [{ amount: 157.5, date: '2026-11-10', vendor: 'CITY CLEAN', category: 'Cleaning' }] };
  const { text } = cashBoxReportQbo({ month: '2026-11', data, swapCodeOf: (ref) => (ref === 'sw' ? 'G5' : ''), posts: {
    cashIn: [{ amount: 176.4, at: day('11'), customer: 'ZETA WOOD', ref: 'z' }, { amount: 576, at: day('10'), customer: 'NOVA KITCHEN', ref: 'sw' }, { amount: 90, at: day('12'), customer: 'OMEGA', ref: 'o' }],
    outs: [{ kind: 'cash_to_boss', amount: 18000, at: day('04') }],
    expenses: [{ amount: 157, at: day('05'), vendor: 'GARBAGE BOX', days: 7 }],
  } });
  assert.match(text, /🟡 11\/11\s+176\.40 {2}\(in QuickBooks, deposited to Cash and cash equivalents, not Petty Cash\)/);
  assert.match(text, /❓ 10\/11\s+576\.00 {2}\(digits swapped\? QuickBooks has another amount: answer 1 = same payment, 2 = different, with #G5\)/);
  assert.match(text, /🔴 12\/11\s+90\.00 {2}\(posted, not in QuickBooks\)/);
  assert.match(text, /🟢 10\/11\s+157\.50 {3}CITY CLEAN/); // 5 days apart: matched with the 7-day window
  assert.match(text, /👔 \*Cash to boss\*: none recorded in QuickBooks this month\n🔴 04\/11\s+18,000\.00 {2}\(posted, not in QuickBooks\)/);
  assert.match(text, /🟡 Other account: 1/);
});

test('one cash payment for two posts of one customer (926.10 = 749.70 + 176.40): both posts match it, in the cash box and in the money report; the payment is counted once', async () => {
  const { cashBoxReportQbo } = await import('../src/cashbox.js');
  const { matchReceipts, receivedText } = await import('../src/expenses.js');
  const day = (d) => Date.parse('2026-11-' + d + 'T09:00:00Z');
  const withLines = { opening: 1000, closing: null, received: [{ amount: 926.1, date: '2026-11-11', name: 'ZETA WOOD PRESSING', lines: [749.7, 176.4] }], elsewhere: [], transfersIn: [], transfersOut: [], purchases: [] };
  const posts = { cashIn: [{ amount: 176.4, at: day('11'), customer: 'ZETA WOOD PRESSING', ref: 'a' }, { amount: 749.7, at: day('11'), customer: 'ZETA WOOD PRESSING', ref: 'b' }], outs: [], expenses: [] };
  for (const data of [withLines, { ...withLines, received: [{ ...withLines.received[0], lines: [] }] }]) { // with the invoice lines, and with only the total
    const { text, remaining } = cashBoxReportQbo({ month: '2026-11', data, posts });
    assert.doesNotMatch(text, /posted, not in QuickBooks|🟡|⚪ 1 receipt/);
    assert.match(text, /Cash from customers\s+926\.10/); assert.equal(remaining, 926.1); // counted once
    assert.match(text, /🟢 Posted and in QuickBooks: 2 /);
  }
  const item = (amount, ref) => ({ amount, shown: '*' + amount.toFixed(2) + '*', foreign: false, unconverted: false, note: '', day: '2026-11-11', customer: 'ZETA WOOD PRESSING', typed: '', kind: 'cash', invoices: [], cleared: false, due: '', drawer: '', at: day('11'), ref, paid: null });
  const items = [item(176.4, 'a'), item(749.7, 'b')];
  const one = { _type: 'Payment', TxnDate: '2026-11-11', TotalAmt: 926.1, CustomerRef: { name: 'ZETA WOOD PRESSING L.L.C' }, Line: [] }; // no line to pair with: only the sum
  const matched = matchReceipts(items, [one]);
  assert.equal(matched.size, 2); assert.ok(matched.get(items[0]) === matched.get(items[1]));
  assert.match(receivedText(items, { title: 't', records: [one], now: day('11') }), /\*ZETA WOOD PRESSING\*\n🟢 176\.40\n🟢 749\.70/);
  assert.equal(matchReceipts([item(100, 'c'), { ...item(826.1, 'd'), customer: 'OTHER CO' }], [one]).size, 0); // two customers do not make one payment
});

test('the cash box: expenses-group entries match the Petty Cash purchases (card posts too, with a method warning), an old «pay … for …» row leaves the cash in, and a swapped-digit post shows the QuickBooks amount with its question', async () => {
  const { cashBoxReportQbo, rederiveCashOut } = await import('../src/cashbox.js');
  const { sharedPaymentList } = await import('../src/payments.js');
  const day = (d) => Date.parse('2026-11-' + d + 'T09:00:00Z');
  const data = { opening: 500, closing: null, received: [], elsewhere: [], transfersIn: [], transfersOut: [],
    purchases: [{ amount: 22.48, date: '2026-11-11', vendor: 'DAY TO DAY', category: 'Office' }, { amount: 157.5, date: '2026-11-10', vendor: 'CITY CLEAN', category: 'Cleaning' }] };
  const { text } = cashBoxReportQbo({ month: '2026-11', data, swapInfoOf: (ref) => (ref === 'sw' ? { code: 'G5', qboAmount: 567, name: 'NOVA KITCHEN' } : null), posts: {
    cashIn: [{ amount: 576, at: day('10'), customer: 'NOVA KITCHEN', ref: 'sw' }],
    outs: [],
    expenses: [{ amount: 22.48, at: day('11'), vendor: 'Day to Day', method: 'card' }, { amount: 157, at: day('05'), vendor: 'GARBAGE BOX', method: 'cash', days: 7 }, { amount: 40, at: day('12'), vendor: 'FUEL STOP', method: 'card' }],
  } });
  assert.match(text, /🟢 11\/11\s+22\.48 {3}DAY TO DAY {2}⚠ method differs: posted card, QuickBooks Petty Cash \(cash\)/); // not «no post in the group»
  assert.match(text, /🟢 10\/11\s+157\.50 {3}CITY CLEAN\n/); // the cash expense of the Confirmation group, 5 days apart
  assert.doesNotMatch(text, /no post in the group|FUEL STOP/); // a card post not paid from the cash box is not expected there
  assert.match(text, /❓ 10\/11\s+576\.00 {2}\(digits swapped\? QuickBooks has 567\.00 for NOVA KITCHEN: answer 1 = same payment, 2 = different, with #G5\)/);
  const old = { type: 'payment', kind: 'cash', currency: 'AED', ref: 'x', at: day('05'), customer: 'PAY BY CASH FOR GARBAGE BOX', amount: 157 }; // an old row that kept the words only in its name
  assert.equal(rederiveCashOut(old).kind, 'cash_expense'); assert.equal(sharedPaymentList({ events: [old] }).length, 0);
});

test('a cash post whose name is no customer and that fits a Petty Cash purchase (+-1 AED, +-7 days) is an expense: out of the cash in, matched to the purchase', async () => {
  const { cashBoxReportQbo } = await import('../src/cashbox.js');
  const day = (d) => Date.parse('2026-11-' + d + 'T09:00:00Z');
  const data = { opening: 0, closing: null, received: [], elsewhere: [], transfersIn: [], transfersOut: [], purchases: [{ amount: 157.5, date: '2026-11-10', vendor: 'CITY CLEAN', category: 'Cleaning' }] };
  const posts = { cashIn: [{ amount: 157, at: day('05'), customer: 'GARBAGE BOX', ref: 'g' }, { amount: 90, at: day('06'), customer: 'ZETA CO', ref: 'z' }], outs: [], expenses: [] };
  const { text } = cashBoxReportQbo({ month: '2026-11', data, posts, isCustomer: (n) => n === 'ZETA CO' });
  assert.match(text, /🟢 10\/11\s+157\.50 {3}CITY CLEAN\n/); assert.doesNotMatch(text, /157\.00 {2}\(posted/); // the garbage box is an expense, matched to the purchase
  assert.match(text, /🔴 06\/11\s+90\.00 {2}\(posted, not in QuickBooks\)/); // a real customer stays cash in
});

test('the stored row {customer: "Pay", amount 157, cleared} is a cash expense (a verb is no customer): out of the customer lists, matched to the Petty Cash purchase 5 days later, else an expense not in QuickBooks', async () => {
  const { rederiveCashOut, cashBoxReportQbo } = await import('../src/cashbox.js');
  const { sharedPaymentList } = await import('../src/payments.js');
  const row = { type: 'payment', kind: 'cash', customer: 'Pay', amount: 157, currency: 'AED', at: 1793866567380, ref: 'made-up-ref-1', cleared: true };
  assert.equal(rederiveCashOut(row).kind, 'cash_expense');
  assert.equal(sharedPaymentList({ events: [row] }).length, 0); // never customer cash
  assert.equal(rederiveCashOut({ ...row, customer: 'ZETA CO' }).kind, 'cash'); // a customer stays one
  const base = { opening: 0, closing: null, received: [], elsewhere: [], transfersIn: [], transfersOut: [] };
  const post = { amount: 157, at: row.at, vendor: '', method: 'cash', days: 7 };
  const hit = cashBoxReportQbo({ month: '2026-11', data: { ...base, purchases: [{ amount: 157.5, date: '2026-11-10', vendor: 'CITY CLEAN', category: 'Cleaning' }] }, posts: { cashIn: [], outs: [], expenses: [post] } }).text;
  assert.match(hit, /🟢 10\/11\s+157\.50 {3}CITY CLEAN\n/); assert.doesNotMatch(hit, /posted, not in QuickBooks/);
  const miss = cashBoxReportQbo({ month: '2026-11', data: { ...base, purchases: [] }, posts: { cashIn: [], outs: [], expenses: [post] } }).text;
  assert.match(miss, /Company expenses \(cash\)[\s\S]*🔴 05\/11\s+157\.00\s+\(posted, not in QuickBooks\)/); // an expense not in QuickBooks, under the cash out
  assert.doesNotMatch(miss, /Cash from customers[\s\S]{0,80}157\.00/);
});

test('a deleted message takes its records away; the invoice preview pairs like «unbilled» (an invoice BEFORE the cut, each line used up); an updated invoice number is a revision, not a duplicate', async () => {
  const { Tracker } = await import('../src/tracker.js');
  const { crossCheck } = await import('../src/cuts.js');
  const { checkNumber } = await import('../src/audit.js');
  const { createHash } = await import('node:crypto');
  const refOf = (g, id, i = 0) => createHash('sha256').update(g + '|' + id + (i ? '|' + i : '')).digest('hex').slice(0, 24);
  const tr = new Tracker({ dir: '' });
  tr.add({ type: 'cut', at: 1000, customer: 'ZETA WOOD', lines: [{ code: '206', quantity: 12, unit: 'm' }], ref: refOf('g1', 'WRONG') });
  tr.add({ type: 'cut', at: 2000, customer: 'ZETA WOOD', lines: [{ code: '207', quantity: 12, unit: 'm' }], ref: refOf('g1', 'RIGHT') });
  tr.add({ type: 'payment', at: 3000, kind: 'cash', customer: 'NOVA', amount: 5, ref: refOf('g1', 'PAYMSG', 1) });
  assert.equal(tr.removeWhere((e) => e.ref === refOf('g1', 'WRONG')), 1); assert.deepEqual(tr.events.map((e) => e.lines?.[0]?.code || e.kind), ['207', 'cash']);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(index.includes("rv.type === 'REVOKE'") && index.includes('voidMessage(rv.key.remoteJid || raw.key.remoteJid, rv.key.id)')); // a revoke message removes the records of the message it names
  // 511: the invoice came the day before the cut and pairs with it; 206 is gone with its message; each invoice line is used up
  const NOW = Date.parse('2026-11-12T08:00:00Z'); const DAY = 86400000;
  const cutter = new Tracker({ dir: '' });
  cutter.add({ type: 'cut', at: NOW - 3 * DAY, customer: 'ZETA WOOD', lines: [{ code: '511', quantity: 9, unit: 'm' }], ref: 'c1' });
  cutter.add({ type: 'cut', at: NOW - 3 * DAY + 1000, customer: 'ZETA WOOD', lines: [{ code: '511', quantity: 5, unit: 'm' }], ref: 'c2' });
  const early = { codes: ['PVC FILM511'], qty: 9, number: 'inv-1', at: NOW - 4 * DAY };
  const r1 = crossCheck(cutter, 'ZETA WOOD', [{ code: '207', qty: 12 }], { now: NOW, invoiced: [early] });
  assert.ok(!r1.problems.some((p) => /^511: cut 9m/.test(p))); // the 9 m cut pairs with its earlier invoice
  assert.ok(r1.problems.some((p) => /^511: cut 5m/.test(p))); // the line is used up by the first cut: the second is not invoiced
  assert.ok(r1.problems.includes('207: not cut yet (no orders-group post)'));
  // a duplicate number is urgent; the same number posted again as an update is only a note
  assert.equal(checkNumber('inv-9997', ['inv-9996', 'inv-9997'], new Set(), false)[0].kind, 'duplicate');
  const rev = checkNumber('inv-9997', ['inv-9996', 'inv-9997'], new Set(), true);
  assert.deepEqual([rev[0].kind, rev[0].severity], ['revision', 'info']);
  assert.ok(index.includes('function isRevision(number, customer, raw)') && index.includes('desk.history.some'));
});

test('an expense edit that makes the post equal the matched QuickBooks purchase says so; it asks to fix QuickBooks only when the edit creates a difference', async () => {
  const { ExpenseStore } = await import('../src/expenses.js');
  const { requestExpenseEdit } = await import('../src/expenseedit.js');
  const store = new ExpenseStore('', () => 1000);
  const e = store.add({ by: 'u1', amount: 22.48, type: 'office', day: '2026-11-11', date: '2026-11-11', state: 'done', method: 'card', vendor: 'DAY TO DAY' });
  const qb = { TotalAmt: 22.48, PaymentType: 'Cash', AccountRef: { name: 'Petty Cash' } };
  const same = requestExpenseEdit(store, { op: 'edit', id: e.id, changes: { method: 'cash' }, bad: [] }, { chat: 'g', sender: 'u1', qb });
  assert.match(same, /✔ now matches QuickBooks\./); assert.doesNotMatch(same, /also fix it in QuickBooks/);
  const differs = requestExpenseEdit(store, { op: 'edit', id: e.id, changes: { amount: 40 }, bad: [] }, { chat: 'g', sender: 'u1', qb });
  assert.match(differs, /also fix it in QuickBooks/); assert.doesNotMatch(differs, /now matches/);
  assert.doesNotMatch(requestExpenseEdit(store, { op: 'edit', id: e.id, changes: { method: 'cash' }, bad: [] }, { chat: 'g', sender: 'u1', qb: null }), /QuickBooks\.\n1\./.source ? /now matches|also fix/ : /x/); // not in QuickBooks: no line
});

test('the owner adds items the bot never saw: several lines, one preview, one 1/2, logged with an undo; they count like group posts and are marked (added by owner)', async () => {
  const { parseAddEntries, requestAdd, answerAdd, undoAdd, parseUndoAdd, dayFrom } = await import('../src/addentries.js');
  const { ExpenseStore } = await import('../src/expenses.js');
  const { expensesReport } = await import('../src/expenseedit.js');
  const { parseInvoiceCommand } = await import('../src/qboinvoice.js');
  assert.equal(dayFrom('04/11', '2026-11-12'), '2026-11-04'); assert.equal(dayFrom('20/12', '2026-11-12'), '2025-12-20'); // a month still ahead is last year's
  const text = 'Atossa add expense 140.07 fuel 10/11 cash ENOC\nadd expense 19.90 food 10/11 card\nadd cash to boss 18000 04/11\nadd advance 500 RAJU 06/11\nadd something odd';
  const parsed = parseAddEntries(text, '2026-11-12');
  assert.deepEqual(parsed.entries, [
    { kind: 'expense', amount: 140.07, day: '2026-11-10', type: 'fuel', method: 'cash', vendor: 'ENOC' },
    { kind: 'expense', amount: 19.9, day: '2026-11-10', type: 'food', method: 'card', vendor: '' },
    { kind: 'cash_to_boss', amount: 18000, day: '2026-11-04' },
    { kind: 'salary_advance', amount: 500, day: '2026-11-06', employee: 'RAJU' }]);
  assert.deepEqual(parsed.bad, ['add something odd']); assert.equal(parseAddEntries('hello there'), null);
  assert.equal(parseInvoiceCommand('add cash to boss 18000 04/11').type, 'add_entries'); assert.deepEqual(parseInvoiceCommand('undo add #AD2'), { type: 'add_undo', id: 'AD2' }); assert.equal(parseUndoAdd('undo add #ad2'), 'AD2');
  const store = new ExpenseStore('', () => Date.parse('2026-11-12T08:00:00Z'));
  const preview = requestAdd(store, parsed, 'owner');
  assert.match(preview, /➕ Add 4 items \(added by owner\)\n10\/11 {2}Expense 140\.07 {2}Fuel {2}cash {2}ENOC\n[\s\S]*04\/11 {2}Cash to boss 18,000\.00\n06\/11 {2}Salary advance 500\.00 {2}RAJU\nNot understood: add something odd[\s\S]*1\. Yes, add them\n2\. No$/);
  assert.equal(store.d.items.length, 0); // nothing before the answer
  const events = [];
  const apply = (entries, batch) => entries.map((en, i) => { if (en.kind === 'expense') return { t: 'x', id: store.add({ ...en, by: 'owner', ref: 'added-' + batch + '-' + i, date: en.day, state: 'done', addedByOwner: true }).id }; events.push(en); return { t: 'e', ref: 'added-' + batch + '-' + i }; });
  assert.equal(answerAdd(store, 'other-chat', '1', apply), null); // another chat's digit is not ours
  assert.match(answerAdd(store, 'owner', '1', apply), /^Added #AD1: 4 items \(added by owner\)\. To take them back: undo add #AD1$/);
  assert.equal(store.done({ from: '2026-11-10', to: '2026-11-10' }).length, 2);
  assert.match(expensesReport(store.done({ from: '2026-11-10', to: '2026-11-10' }), [], '10/11/2026'), /#E1 \(added by owner\)/);
  const removed = []; assert.match(undoAdd(store, 'AD1', (refs) => removed.push(...refs)), /^Taken back #AD1/); assert.equal(removed.length, 4);
  assert.match(undoAdd(store, 'AD1', () => {}), /no batch/);
  requestAdd(store, parseAddEntries('add cash to boss 100 03/11', '2026-11-12'), 'owner'); assert.equal(answerAdd(store, 'owner', '2', apply), 'Nothing was added.');
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(index.includes('answerAdd(expenseStore, here.chatId || \'owner\', String(ic.choice), applyAdded)')); // the 1 / 2 reaches the batch
});

test('expenses against ALL QuickBooks purchases: the account is shown, cash or card comes from the account, a different posted method is flagged on its line, in a «To fix» section and in the Thursday check; an added expense with no method takes it from the match, else is asked', async () => {
  const { qbKindOf, weeklyCheckText } = await import('../src/expenses.js');
  const { expensesReport } = await import('../src/expenseedit.js');
  const { parseAddEntries } = await import('../src/addentries.js');
  assert.deepEqual([qbKindOf({ AccountRef: { name: 'Petty Cash' } }), qbKindOf({ AccountRef: { name: 'ADCB Bank' } }), qbKindOf({ AccountRef: { name: 'Visa Card' }, PaymentType: 'CreditCard' }), qbKindOf({})], ['cash', 'card', 'card', '']);
  const e = (id, amount, method, vendor, type = 'fuel') => ({ id, amount, method, vendor, type, day: '2026-11-11', date: '2026-11-11', state: 'done', by: 'u' });
  const records = [{ TxnDate: '2026-11-11', TotalAmt: 85.5, EntityRef: { name: 'ADNOC STATION' }, AccountRef: { name: 'ADCB Bank' }, _type: 'Purchase' }, { TxnDate: '2026-11-11', TotalAmt: 22.48, EntityRef: { name: 'DAY TO DAY' }, AccountRef: { name: 'Petty Cash' }, _type: 'Purchase' }];
  const entries = [e('E7', 85.5, 'card', 'ADNOC'), e('E3', 22.48, 'card', 'Day to Day', 'office')];
  const text = expensesReport(entries, records, '11/11/2026');
  assert.match(text, /🟢 85\.50 {3}card {3}ADNOC {5}#E7 {2}\(QuickBooks: ADCB Bank\)\n/); // matches: the account is shown, no warning
  assert.match(text, /🟢 22\.48 {3}card {3}Day to Day #E3 {2}\(QuickBooks: Petty Cash\) {2}⚠ posted card, QuickBooks Petty Cash \(cash\) — please fix/);
  assert.match(text, /⚠ \*To fix\*\n#E3 posted card, QuickBooks Petty Cash \(cash\) — reply 1 #E3 = card, 2 #E3 = cash \(as QuickBooks\)$/);
  const week = weeklyCheckText({ expenses: entries, purchases: records, items: [], payments: [], title: 'w' });
  assert.match(week, /⚠ \*To fix: the payment method differs from QuickBooks\*\n#E3 posted card, QuickBooks Petty Cash \(cash\) — reply 1 #E3 = card, 2 #E3 = cash \(as QuickBooks\)/); assert.doesNotMatch(week, /All recorded/);
  assert.equal(parseAddEntries('add expense 140.07 fuel 10/11 ENOC', '2026-11-12').entries[0].method, ''); // no method written
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(index.includes("en.method = qbKindOf(rec)")); assert.ok(index.includes("state: en.method ? 'done' : 'ask_method'")); // taken from the account, else asked 1 card / 2 cash
});

test('owner review: «invoice NAME 221 20m» is read; the preview pairs by the nearest date and never with a line from before the tracking began, says the invoice covers today\'s cut and warns about not-cut / not-left; a report the owner asks for reads fresh; an edited message is re-read; an added expense is looked up in all accounts', async () => {
  const { readEnglishInvoice } = await import('../src/qboinvoice.js');
  const { crossCheck } = await import('../src/cuts.js');
  const { Tracker } = await import('../src/tracker.js');
  const { requestAdd, parseAddEntries } = await import('../src/addentries.js');
  assert.deepEqual(readEnglishInvoice('Atossa invoice derwazaa 221 20m'), { customer: 'derwazaa', lines: ['221 20'], unread: [] });
  assert.deepEqual(readEnglishInvoice('Atossa invoice high point 207 12m').lines, ['207 12']); assert.equal(readEnglishInvoice('Atossa invoice high point 207 12m').customer, 'high point');
  assert.deepEqual(readEnglishInvoice('invoice zeta co 221 20m 222 5').lines, ['221 20', '222 5']);
  assert.deepEqual(readEnglishInvoice('invoice zeta co 215=97m').lines, ['215 97']); // the old form still works
  const NOW = Date.parse('2026-11-12T08:00:00Z'); const DAY = 86400000;
  const tr = new Tracker({ dir: '' });
  tr.add({ type: 'cut', at: NOW - 3600000, customer: 'GOLDEN DOOR', lines: [{ code: '505', quantity: 105, unit: 'm' }], ref: 'c1' });
  tr.add({ type: 'cut', at: NOW - 3000000, customer: 'GOLDEN DOOR', lines: [{ code: '201', quantity: 30, unit: 'm' }], ref: 'c2' });
  const tracked = Date.parse('2026-11-01T00:00:00+04:00');
  const october = { codes: ['PVC FILM505'], qty: 100, number: 'inv-9762', at: Date.parse('2026-10-17T00:00:00Z') };
  const r = crossCheck(tr, 'GOLDEN DOOR', [{ code: '505', qty: 105 }, { code: '201', qty: 30 }, { code: '999', qty: 5 }], { now: NOW, invoiced: [october], trackedSince: tracked, outs: [{ customer: 'GOLDEN DOOR', code: '505', qty: 105, at: NOW - 1800000 }] });
  assert.ok(!r.problems.some((p) => /already invoiced/.test(p))); // the October line (before the tracking began) does not take today's cuts
  assert.ok(r.covered.includes('505: cut today, this invoice covers it') && r.covered.includes('201: cut today, this invoice covers it'));
  assert.ok(r.problems.includes('999: not cut yet (no orders-group post)') && r.problems.includes('201: not left the warehouse yet')); assert.ok(!r.problems.includes('505: not left the warehouse yet'));
  // the nearest date pairs first
  const near = new Tracker({ dir: '' });
  near.add({ type: 'cut', at: NOW - 2 * DAY, customer: 'GOLDEN DOOR', lines: [{ code: '300', quantity: 10, unit: 'm' }], ref: 'n1' });
  const far = { codes: ['300'], qty: 10, number: 'far', at: NOW - 20 * DAY }; const close = { codes: ['300'], qty: 10, number: 'close', at: NOW - 3 * DAY };
  const n = crossCheck(near, 'GOLDEN DOOR', [{ code: '300', qty: 10 }], { now: NOW, invoiced: [far, close], trackedSince: 0 });
  assert.match(n.problems.join('|'), /already invoiced \(close\)/);
  const gate = (s) => s.includes('async function sheetOutRows(days, cached = false)') && s.includes('unbilledReport(tracker.events, { cached: true })');
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(gate(index)); // only the automatic evening run may use the copy read minutes ago
  assert.ok(index.includes("rv.type === 'MESSAGE_EDIT'") && index.includes('handled.delete(rv.key.id)')); // an edit takes back what the old text made and re-reads the new one
  const add = parseAddEntries('add expense 140.07 fuel 10/11', '2026-11-12'); add.entries[0].qbAccount = 'ADCB Bank'; add.entries[0].qbVendor = 'ENOC'; add.entries[0].method = 'card';
  assert.match(requestAdd(new (await import('../src/expenses.js')).ExpenseStore('', () => 1), add, 'o'), /140\.07 {2}Fuel {2}card \(QuickBooks: ADCB Bank, ENOC\)/);
});

test('a receipt photo is dated by the date printed on it; a late-posted receipt is looked for up to 14 days (amount within 0.05, vendor or category agreeing); an amount before VAT is pointed at, never matched', async () => {
  const { makeEntry, matchExpenses } = await import('../src/expenses.js');
  const { expensesReport } = await import('../src/expenseedit.js');
  const post = Date.parse('2026-11-10T12:00:00Z');
  const e1 = makeEntry({ caption: '140.07 fuel', reading: { total: 140.07, vendor: 'ENOC', date: '2026-11-02' }, hasReceipt: true, hasPhoto: true, by: 'u', at: post });
  assert.deepEqual([e1.day, e1.date, e1.postDay], ['2026-11-02', '2026-11-02', '2026-11-10']); // the printed date, not the post time
  assert.equal(makeEntry({ caption: '10', reading: { total: 10, date: '2026-12-31' }, hasReceipt: true, by: 'u', at: post }).day, '2026-11-10'); // a date in the future is no receipt date
  assert.equal(makeEntry({ caption: '10', reading: { total: 10, date: '2025-01-01' }, hasReceipt: true, by: 'u', at: post }).day, '2026-11-10'); // nor one a year old
  assert.equal(makeEntry({ caption: '10', reading: null, by: 'u', at: post }).day, '2026-11-10'); // none printed: the post time
  const records = [{ TxnDate: '2026-11-02', TotalAmt: 140.07, EntityRef: { name: 'ENOC' }, AccountRef: { name: 'ADCB Bank' } }, { TxnDate: '2026-11-01', TotalAmt: 19.91, EntityRef: { name: 'FRESH CART' }, Line: [{ AccountBasedExpenseLineDetail: { AccountRef: { name: 'Food' } } }] }, { TxnDate: '2026-11-07', TotalAmt: 230, TxnTaxDetail: { TotalTax: 10.95 }, EntityRef: { name: 'ENOC' } }];
  const ent = (id, amount, day, type, vendor) => ({ id, amount, day, date: day, type, vendor, method: 'card', state: 'done' });
  const late = matchExpenses([ent('E1', 140.07, '2026-11-10', 'fuel', 'ENOC'), ent('E2', 19.9, '2026-11-10', 'food', ''), ent('E3', 219.05, '2026-11-10', 'fuel', 'ENOC')], records);
  assert.deepEqual(late.found.map((f) => f.entry.id), ['E1', 'E2']); // 8 and 9 days apart: 140.07 exact with the vendor, 19.90 vs 19.91 within 0.05 with the category (Food)
  assert.deepEqual(late.missing.map((m) => m.id), ['E3']);
  assert.equal(late.hints[0].entry.id, 'E3'); assert.equal(late.hints[0].record.TotalAmt, 230); // 219.05 + 10.95 VAT = 230.00
  const text = expensesReport([ent('E3', 219.05, '2026-11-10', 'fuel', 'ENOC')], records, '10/11/2026');
  assert.match(text, /🔴 219\.05 {2}card {3}ENOC {6}#E3\n     ↳ this looks like the amount before VAT of ENOC 07\/11 230\.00/);
  assert.equal(matchExpenses([ent('E9', 85.5, '2026-11-01', 'fuel', '')], [{ TxnDate: '2026-11-06', TotalAmt: 85.5 }]).missing.length, 1); // no vendor or category to agree: stays missing
});

test('an item the owner added absorbs the posted row of the same kind (amount +-1, date +-7): shown once as (added by owner; also posted dd/mm), never as not in QuickBooks', async () => {
  const { cashBoxReportQbo } = await import('../src/cashbox.js');
  const day = (d) => Date.parse('2026-11-' + d + 'T09:00:00Z');
  const data = { received: [], elsewhere: [], transfersIn: [], transfersOut: [{ amount: 9000, date: '2026-11-12', to: 'OWNER CASH AMOUNT', note: '' }], purchases: [{ amount: 157.5, date: '2026-11-10', vendor: 'CITY CLEAN', category: 'Cleaning' }] };
  const { text } = cashBoxReportQbo({ month: '2026-11', data, posts: { cashIn: [], expenses: [
    { amount: 157.5, at: day('10'), vendor: 'CITY CLEAN', method: 'cash', added: true }, { amount: 157, at: day('05'), vendor: '', method: 'cash', days: 7 }],
  outs: [{ kind: 'cash_to_boss', amount: 18000, at: day('04'), added: true }, { kind: 'cash_to_boss', amount: 18000, at: day('04') }, { kind: 'cash_to_boss', amount: 9000, at: day('12') }] } });
  assert.match(text, /🟢 10\/11\s+157\.50 {3}CITY CLEAN {2}\(added by owner; also posted 05\/11\)/);
  assert.doesNotMatch(text, /05\/11\s+157\.00/); // the old row is not shown again
  assert.match(text, /🔴 04\/11\s+18,000\.00 {2}\(added by owner; also posted 04\/11\) {2}\(posted, not in QuickBooks\)/); // absorbed once; its own lack of a transfer is still said
  assert.equal((text.match(/18,000\.00/g) || []).length, 1); // one line only: the posted twin is not shown again
});

test('a post ending with a star needs no invoice: the star is taken off, it is never flagged, asked about or listed to match, shown with its own mark and counted; old rows get the same on read', async () => {
  const { eventsFromCaption } = await import('../src/captionevents.js');
  const { isStarred } = await import('../src/captions.js');
  const { sharedPaymentList, paymentsText } = await import('../src/payments.js');
  const { receivedItems, receivedText } = await import('../src/expenses.js');
  const { cashBoxReportQbo } = await import('../src/cashbox.js');
  for (const t of ['Cash from ZETA CO 3000 *', 'Cash from ZETA CO 3000 ★', 'Cash from ZETA CO 3000 ⭐', 'Cash from ZETA CO 3000 **']) assert.ok(isStarred(t), t);
  assert.ok(!isStarred('Cash from ZETA CO 3000') && !isStarred('*'));
  const ev = eventsFromCaption('payment', 'Cash from ZETA CO 3000 *').events[0];
  assert.deepEqual([ev.customer, ev.amount, ev.noInvoice], ['ZETA CO', 3000, true]); // the star is not in the name or the amount
  const at = Date.parse('2026-11-12T08:00:00Z');
  const oldRow = { type: 'payment', kind: 'cash', currency: 'AED', ref: 'o', at, customer: 'NOVA CO *', amount: 750, text: 'Cash from NOVA CO 750 *' };
  const list = sharedPaymentList({ events: [{ ...ev, at, ref: 's', currency: 'AED' }, oldRow] });
  assert.deepEqual(list.map((e) => [e.customer, e.noInvoice]), [['ZETA CO', true], ['NOVA CO', true]]); // an old row is read the same way, the star off its name
  assert.match(paymentsText({ events: [{ ...ev, at, ref: 's', currency: 'AED' }, oldRow], invoices: [], now: at }), /No payment was seen/); // not in «payments to match»
  const items = receivedItems(list, { from: '2026-11-12', to: '2026-11-12' }, { timeZone: 'Asia/Dubai', lookup: new Map() });
  const text = receivedText(items, { title: '12/11', records: [], now: at });
  assert.match(text, /⭐ 3,000\.00 {2}no invoice needed/); assert.doesNotMatch(text, /🔴 \d/); assert.match(text, /⭐ No invoice needed: 2$/);
  assert.match(text, /\*Total: 3,750\.00 AED\*/); // counted in the totals
  const data = { received: [], elsewhere: [], transfersIn: [], transfersOut: [], purchases: [] };
  const cash = cashBoxReportQbo({ month: '2026-11', data, posts: { cashIn: [{ amount: 3000, at, customer: 'ZETA CO', ref: 's', noInvoice: true }], outs: [], expenses: [] } }).text;
  assert.match(cash, /⭐ No invoice needed\s+3,000\.00/); assert.match(cash, /⭐ 12\/11\s+3,000\.00 {2}no invoice needed/); assert.match(cash, /\*Total in \(month\): 3,000\.00 AED\*/); assert.match(cash, /⭐ No invoice needed: 1/); assert.doesNotMatch(cash, /posted, not in QuickBooks/);
});

test('today\'s six stored rows are re-read: a stock question is no money, the bank SMS is a nameless transfer that takes its name from the receipt PDF or the matching QuickBooks payment, our invoice PDF is no payment, an unread receipt is said once, «delivery» has no customer', async () => {
  const { sharedPaymentList } = await import('../src/payments.js');
  const { receivedItems, receivedText } = await import('../src/expenses.js');
  const { isInvoiceFile } = await import('../src/paymentfix.js');
  const t = (hhmm) => Date.parse('2026-11-12T' + hhmm + ':00+04:00');
  const row = (ref, hhmm, extra) => ({ type: 'payment', currency: 'AED', ref, at: t(hhmm), lines: [], ...extra });
  const events = [
    row('r1', '10:00', { kind: 'cash', customer: 'available one roll in China stock?', amount: 307, text: '307 available one roll in China stock?' }),
    row('r2', '16:30', { kind: 'cash', customer: 'details', amount: 708.75, text: 'Your AC No:XXXX is credited with AED 708.75 for Aani Instant Payments (Local IPP Transfer). Login to Online Banking for details.' }),
    row('r2b', '16:44', { kind: 'transfer', customer: 'ALWAN SHAM--', amount: 708, source: 'pdf' }),
    row('r3', '16:50', { kind: 'cash', customer: 'An amount of has been credited to your Mashreq account … Inward …', amount: 714 }),
    row('r4', '17:07', { kind: 'cheque', customer: 'PCC work', amount: 680, source: 'pdf' }),
    row('r5', '19:30', { kind: 'transfer', customer: '', amount: 0, source: 'pdf' }),
    row('r6', '13:00', { kind: 'cash', customer: 'delivery', amount: 3000, text: '3000 aed delivery' }),
  ];
  const list = sharedPaymentList({ events });
  assert.ok(!list.some((e) => /stock/.test(e.customer)));  // the stock question is gone
  const sms = list.find((e) => e.ref === 'r2');
  assert.deepEqual([sms.kind, sms.amount, sms.customer], ['transfer', 708.75, 'ALWAN SHAM']); assert.ok(!list.some((e) => e.ref === 'r2b')); // ONE row: the SMS amount, the PDF's name (dashes off)
  assert.deepEqual([list.find((e) => e.ref === 'r3').kind, list.find((e) => e.ref === 'r3').customer], ['transfer', '']); // never cash, the sentence is no name
  const items = receivedItems(list, { from: '2026-11-12', to: '2026-11-12' }, { timeZone: 'Asia/Dubai', lookup: new Map() });
  assert.deepEqual(items.unread, [{ ref: 'r5', label: '12/11 19:30' }]);
  const records = [{ _type: 'Payment', TxnDate: '2026-11-12', TotalAmt: 714, CustomerRef: { name: 'PVC WORK CARPENTER LLC' }, Line: [] }, { _type: 'Payment', TxnDate: '2026-11-12', TotalAmt: 708.75, CustomerRef: { name: 'ALWAN ALSHAM' }, Line: [] }];
  const invoices = [{ DocNumber: 'inv-10012', TotalAmt: 714, TxnDate: '2026-11-12', TxnTaxDetail: { TotalTax: 34 } }]; // 680 before 5 % VAT is 714
  const text = receivedText(items, { title: '12/11', records, recentInvoices: invoices, now: t('18:00') });
  assert.match(text, /\*PVC WORK CARPENTER LLC\*\n🟢 714\.00/); // the nameless transfer takes the name of the QuickBooks payment it matches
  assert.match(text, /\*ALWAN SHAM\*\n🟢 708\.75/);
  assert.doesNotMatch(text, /680\.00|PCC|stock|credited/); // our own invoice PDF is no payment
  assert.match(text, /⚠ receipt PDF 12\/11 19:30 \(Confirmation group\), amount not read — check/); assert.doesNotMatch(text, /^[🟢🔴⏳⭐] 0\.00/mu); // no 0.00 row
  assert.doesNotMatch(text, /Driver cash|3,000\.00/); assert.match(text, /\*Total: 1,422\.75 AED\*/); // «3000 aed delivery» is the amount to collect on delivery of an order: no payment row at all
  assert.ok(isInvoiceFile('Invoice inv-10012.pdf') && isInvoiceFile('inv-10012.pdf') && !isInvoiceFile('receipt 123.pdf'));
});

test('«3000 aed delivery» is the amount to collect on delivery, never money received (no payment row, new or stored); the driver breakdown helper still splits a hand-made driver item by the collected posts', async () => {
  const { collectedAmount, driverCashAmount } = await import('../src/paymentfix.js');
  const { eventsFromCaption } = await import('../src/captionevents.js');
  const { driverBreakdown } = await import('../src/expenses.js');
  const { sharedPaymentList } = await import('../src/payments.js');
  assert.deepEqual([collectedAmount('Zeta wood AED750 collected'), collectedAmount('delivered AED 176 collected'), collectedAmount('COD 945'), collectedAmount('delivered')], [750, 176, 945, 0]);
  assert.equal(driverCashAmount('3000 aed delivery'), 3000);
  assert.deepEqual(eventsFromCaption('payment', '3000 aed delivery'), { ignore: true }); // a new post is no payment
  assert.deepEqual(eventsFromCaption('payment', '307 confirm one roll for golden door'), { ignore: true }); // an amount beside order words, no word of money
  assert.ok(eventsFromCaption('payment', 'cash received from ZETA CO 3000').events); // with the words of money it is one
  const t = (day, hhmm) => Date.parse('2026-11-' + day + 'T' + hhmm + ':00+04:00');
  const stored = { type: 'payment', kind: 'cash', currency: 'AED', ref: 'd', at: t('12', '16:00'), customer: 'delivery', amount: 3000, text: '3000 aed delivery' };
  assert.equal(sharedPaymentList({ events: [stored] }).length, 0); // an old stored row is dropped on read
  const delivery = (ref, day, customer, collected) => ({ type: 'delivery', ref, at: t(day, '11:00'), customer, collected });
  const ok = [delivery('x1', '12', 'ZETA WOOD PRESSING', 750), delivery('x2', '11', 'NOVA KITCHEN', 1250), delivery('x3', '12', 'OMEGA CO', 1000), delivery('x4', '05', 'OLD CO', 99)];
  const item = { amount: 3000, at: t('12', '16:00') };
  assert.deepEqual([driverBreakdown(item, ok).ok, driverBreakdown(item, ok).found], [true, 3000]);
});

test('a quote-reply «<name> cleared» names the bank SMS row it quotes; a nameless transfer equal to exactly one open invoice shows that customer and the invoice', async () => {
  const { receivedText } = await import('../src/expenses.js');
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(index.includes("(?:cleared?|received|paid)") && index.includes("customer: canon(named[1].trim()), customerTyped: named[1].trim(), pendingName: false, cleared: true")); // the reply sets the customer of the quoted row
  const now = Date.parse('2026-11-12T18:00:00+04:00');
  const item = { amount: 714, shown: '*714.00*', foreign: false, unconverted: false, note: '', day: '2026-11-12', customer: '', typed: '', kind: 'bank', invoices: [], cleared: true, due: '', drawer: '', at: now - 3600000, ref: 'sms', paid: null };
  const open = [{ Id: '1', DocNumber: 'inv-10012', Balance: 714, TotalAmt: 714, CustomerRef: { name: 'PVC WORK CARPENTER LLC' } }, { Id: '2', DocNumber: 'inv-10013', Balance: 300, TotalAmt: 300, CustomerRef: { name: 'NOVA CO' } }];
  const text = receivedText([item], { title: '12/11', records: [], openInvoices: open, now });
  assert.match(text, /\*PVC WORK CARPENTER LLC\*\n🔴 714\.00 {2}not in QuickBooks yet \(pays inv-10012, 714\.00\)/);
  const twice = receivedText([item], { title: '12/11', records: [], openInvoices: [...open, { Id: '3', DocNumber: 'inv-10014', Balance: 714, TotalAmt: 714, CustomerRef: { name: 'OMEGA CO' } }], now });
  assert.match(twice, /\*UNKNOWN\*/); // two invoices of that amount: not guessed
});

test('the assistant\'s name in front of a command changes nothing: every owner command reads the same with or without «Atossa»', async () => {
  const { parseInvoiceCommand } = await import('../src/qboinvoice.js');
  const { parseQboCommand } = await import('../src/qbodesk.js');
  const { stripBotName } = await import('../src/namelead.js');
  assert.equal(stripBotName('Atossa received today'), 'received today'); assert.equal(stripBotName('atusa, cash box'), 'cash box'); assert.equal(stripBotName('ATOSA: unbilled'), 'unbilled'); assert.equal(stripBotName('آتوسا صندوق'), 'صندوق');
  assert.equal(stripBotName('Atossa'), 'Atossa'); assert.equal(stripBotName('hello Atossa received today'), 'hello Atossa received today'); // only a name at the start, followed by words
  for (const t of ['received today', 'cash box', 'unbilled', 'expenses today', 'cuts 215 08/11', 'cut #Z1 drop', 'edit #E3 cash', 'add cash to boss 18000 04/11', 'yes #Q1', 'undo cut #X1', 'waiting']) {
    const bare = parseInvoiceCommand(t); const named = parseInvoiceCommand('Atossa ' + t); const comma = parseInvoiceCommand('atossa, ' + t);
    assert.ok(bare, t); assert.deepEqual(named, bare, t); assert.deepEqual(comma, bare, t);
  }
  assert.equal(parseInvoiceCommand('Atossa received today').type, 'received_report');
  assert.deepEqual(parseQboCommand('Atossa ' + 'status'), parseQboCommand('status'));
  const { parseCommand } = await import('../src/staff.js'); const { parseTrackerCommand } = await import('../src/tracker.js'); const { parseRuleCommand } = await import('../src/rules.js'); const { parseAliasCommand } = await import('../src/aliases.js');
  for (const [fn, sample] of [[parseCommand, 'status'], [parseTrackerCommand, 'balance of ZETA'], [parseRuleCommand, 'rules'], [parseAliasCommand, 'aliases']]) assert.deepEqual(fn('Atossa ' + sample), fn(sample), sample); // the other command readers too
});

test('one reading of the money rows for every report: the weekly check says what "received today" says (invoice PDF out, bank SMS named, accepted pairing, office reply fills the receipt); a typed name never maps to a customer that does not contain it', async () => {
  const { typedFitsName, qboNameFor } = await import('../src/qboname.js');
  const { sharedPaymentList } = await import('../src/payments.js');
  const { receivedItems, receivedText, weeklyCheckText } = await import('../src/expenses.js');
  assert.ok(!typedFitsName('Al masar', 'MASTER WOOD')); assert.ok(typedFitsName('Al masar', 'AL MASAR AL SAI')); assert.ok(typedFitsName('Alwan sham', 'ALWAN ALSHAM')); assert.ok(typedFitsName('Akrasa lion', 'AKRASAA LIONS FOR KITCHENS')); assert.ok(typedFitsName('Zeta kitchens ind', 'ZETA IND LLC'));
  assert.equal(qboNameFor('Al masar', ['MASTER WOOD', 'AL MASAR AL SAI']), 'AL MASAR AL SAI'); assert.equal(qboNameFor('Al masar', ['MASTER WOOD']), ''); // unknown: asked, never guessed
  const t = (hhmm, day = '12') => Date.parse('2026-11-' + day + 'T' + hhmm + ':00+04:00');
  const row = (ref, hhmm, extra) => ({ type: 'payment', currency: 'AED', ref, at: t(hhmm), lines: [], ...extra });
  const events = [
    row('a1', '12:54', { kind: 'cash', customer: 'delivery', amount: 3000, text: '3000 aed delivery' }), // row 1: the amount to collect, not money
    row('b1', '14:43', { kind: 'transfer', customer: 'Al masar', amount: 0, source: 'pdf' }), row('b2', '15:22', { kind: 'cash', customer: 'AL MASAR BANK', amount: 918.75, text: 'AL MASAR BANK TRANSFER 918.75 AED' }), // row 2: the office reply fills the receipt
    row('c1', '17:04', { kind: 'cash', customer: 'details', amount: 714, text: 'Your AC is credited with AED 714.00 for Aani Instant Payments. Login to Online Banking for details.' }), // row 3: a nameless SMS
    row('d1', '17:07', { kind: 'cheque', customer: 'PCC work', amount: 680, source: 'pdf' }), // row 4: our own invoice PDF
    row('e1', '19:16', { kind: 'cash', customer: 'AL AFEEFI KITCHEN', amount: 576, text: 'Al afeefi 576 aed cash received', acceptedMatch: { text: 'QuickBooks payment 567.00 (posted 576.00)', at: 1 } }), // row 5: the owner accepted the pairing
    row('f1', '15:24', { kind: 'transfer', customer: 'Al derwazaa', amount: 0, source: 'pdf' }), row('f2', '15:30', { kind: 'cash', customer: 'DERWAZAA BANK', amount: 294, text: 'DERWAZAA BANK TRANSFER 294 AED' }),
  ];
  const list = sharedPaymentList({ events });
  assert.ok(!list.some((e) => e.ref === 'a1')); // 1
  const masar = list.find((e) => e.ref === 'b1'); assert.deepEqual([masar.customer, masar.amount, masar.kind], ['AL MASAR', 918.75, 'transfer']); assert.ok(!list.some((e) => e.ref === 'b2')); // 2
  const derw = list.find((e) => e.ref === 'f1'); assert.deepEqual([derw.customer, derw.amount, derw.kind], ['DERWAZAA', 294, 'transfer']); // the sixth row
  const items = receivedItems(list, { from: '2026-11-06', to: '2026-11-12' }, { timeZone: 'Asia/Dubai', lookup: new Map() });
  assert.equal(items.unread.length, 0);
  const records = [{ _type: 'Payment', TxnDate: '2026-11-12', TotalAmt: 918.75, CustomerRef: { name: 'AL MASAR AL SAI' }, Line: [] }, { _type: 'Payment', TxnDate: '2026-11-10', TotalAmt: 567, CustomerRef: { name: 'AL AFEEFI KITCHEN' }, Line: [] }];
  const open = [{ Id: '9', DocNumber: 'inv-10012', Balance: 714, TotalAmt: 714, CustomerRef: { name: 'PVC WORK CARPENTER LLC' } }];
  const recent = [{ DocNumber: 'inv-10012', TotalAmt: 714, TxnDate: '2026-11-12', TxnTaxDetail: { TotalTax: 34 } }];
  const now = t('20:00');
  const week = weeklyCheckText({ expenses: [], purchases: [], items, payments: records, openInvoices: open, recentInvoices: recent, title: 'w' });
  const day = receivedText(items, { title: '12/11', records, openInvoices: open, recentInvoices: recent, now });
  assert.doesNotMatch(week, /MASTER|MASAR|680|PCC|AFEEF|3,000/); // 2 recorded, 4 an invoice PDF, 5 accepted, 1 no payment
  assert.match(week, /\*PVC WORK CARPENTER LLC\*\n🔴 714\.00 {2}transfer 12\/11\/2026 \(pays inv-10012\)/); // 3: named by the one open invoice of that amount
  assert.match(week, /\*DERWAZAA\*\n🔴 294\.00/); // read from the office reply, not recorded in QuickBooks here
  // the same verdict as «received today» for the same day: the same customers are flagged red
  const red = (text) => [...text.matchAll(/\*([^*\n]+)\*\n🔴 ([\d,.]+)/g)].map((m) => m[1] + m[2]).sort();
  assert.deepEqual(red(week), red(day));
});

test('reports are built NOW from the raw messages: a row stored by old code is dropped when today\'s rules say its message is no money; edits and deletions of the raw message count; the header says when it was checked', async () => {
  const { RawLog } = await import('../src/rawlog.js');
  const { sharedPaymentList } = await import('../src/payments.js');
  const { receivedItems, receivedText } = await import('../src/expenses.js');
  const { createHash } = await import('node:crypto');
  const chat = '1203@g.us'; const at = Date.parse('2026-11-12T12:54:00+04:00');
  const ref = (id) => createHash('sha256').update(chat + '|' + id).digest('hex').slice(0, 24);
  const log = new RawLog('', () => at);
  log.add({ t: 'msg', id: 'M1', chat, at, text: '3000 aed delivery', sender: 'u1' });
  log.add({ t: 'msg', id: 'M2', chat, at, text: 'cash from ZETA CO 500', sender: 'u1' });
  log.add({ t: 'msg', id: 'M3', chat, at, text: 'cash from NOVA CO 9000', sender: 'u2' });
  log.add({ t: 'edit', id: 'M3', chat, text: 'cash from NOVA CO 900' }); log.add({ t: 'msg', id: 'M4', chat, at, text: 'cash from OMEGA CO 40', sender: 'u2' }); log.add({ t: 'revoke', id: 'M4', chat });
  const msgs = log.messages(chat);
  assert.deepEqual(msgs.map((m) => [m.id, m.text]), [['M1', '3000 aed delivery'], ['M2', 'cash from ZETA CO 500'], ['M3', 'cash from NOVA CO 900']]); // the edit applied, the deleted one gone
  const old = (id, customer, amount) => ({ type: 'payment', kind: 'cash', currency: 'AED', ref: ref(id), at, customer, amount, lines: [] }); // rows stored by OLD code: no text kept
  const stored = [old('M1', 'UNKNOWN', 3000), old('M2', 'ZETA CO', 500), old('M3', 'NOVA CO', 900)];
  const list = sharedPaymentList({ events: stored, raw: msgs });
  assert.deepEqual(list.map((e) => e.customer), ['ZETA CO', 'NOVA CO']); // «3000 aed delivery» no longer shows, though the stored row never kept its words
  assert.equal(sharedPaymentList({ events: stored }).length, 3); // without the raw log nothing can be re-judged: the stored row stays
  const items = receivedItems(list, { from: '2026-11-12', to: '2026-11-12' }, { timeZone: 'Asia/Dubai', lookup: new Map() });
  const text = receivedText(items, { title: '12/11', records: [], now: at + 3600000, checkedAt: '18:42' });
  assert.match(text, /^💰 \*Money received — 12\/11\*\nchecked now 18:42\n/);
  assert.doesNotMatch(text, /3,000\.00/);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(index.includes("raw: rawLog.messages('', Date.now() - 45 * 86400000)") && index.includes('await qboDesk.customers(true)')); // every report reads the raw log and QuickBooks' names now
});

test('stored rows are re-judged on read: a name typed «Al masar» stands over a wrong stored customer, a receipt\'s caption or the reply that quotes it fills its name and amount, an old unread receipt a later named one explains is dropped, the rest are said once with their date; "fix receipt" fills one by hand', async () => {
  const { sharedPaymentList } = await import('../src/payments.js');
  const { receivedItems, receivedText, weeklyCheckText } = await import('../src/expenses.js');
  const { replyNameAmount } = await import('../src/paymentfix.js');
  const { parseInvoiceCommand } = await import('../src/qboinvoice.js');
  const { createHash } = await import('node:crypto');
  const chat = '55@g.us'; const t = (day, hhmm) => Date.parse('2026-11-' + day + 'T' + hhmm + ':00+04:00');
  const ref = (id) => createHash('sha256').update(chat + '|' + id).digest('hex').slice(0, 24);
  const row = (id, day, hhmm, extra) => ({ type: 'payment', currency: 'AED', ref: ref(id), at: t(day, hhmm), lines: [], ...extra });
  assert.deepEqual(replyNameAmount('DERWAZAA BANK TRANSFER 294 AED'), { name: 'DERWAZAA', amount: 294 }); assert.equal(replyNameAmount('cash from X 5'), null);
  // 1: the stored customer was chosen by old code from «Al masar»
  const masar = sharedPaymentList({ events: [row('m1', '12', '14:43', { kind: 'transfer', customer: 'MASTER WOOD', customerTyped: 'Al masar', amount: 918.75, cleared: true, source: 'pdf' })] });
  assert.equal(masar[0].customer, 'Al masar'); // the typed name stands
  assert.equal(sharedPaymentList({ events: [row('m2', '12', '14:43', { kind: 'transfer', customer: 'AL MASAR AL SAI', customerTyped: 'Al masar', amount: 5, source: 'pdf' })] })[0].customer, 'AL MASAR AL SAI'); // a fitting name is kept
  assert.equal(sharedPaymentList({ events: [row('m3', '12', '14:43', { kind: 'transfer', customer: 'OTHER NAME', customerTyped: 'Mr Ali', amount: 5, source: 'pdf' })], approved: (typed, customer) => typed === 'Mr Ali' && customer === 'OTHER NAME' })[0].customer, 'OTHER NAME'); // an alias the owner approved is kept
  // 2: the caption of the receipt (in the raw log) fills it; so does a reply that quotes it
  const raw = [{ t: 'msg', id: 'd1', chat, at: t('12', '15:24'), text: '', caption: 'DERWAZAA BANK TRANSFER 294 AED', file: 'BankReport.pdf', sender: 'u' }, { t: 'msg', id: 'e1', chat, at: t('12', '15:30'), text: 'ZETA WOOD BANK TRANSFER 77 AED', quoted: 'e0', sender: 'u' }, { t: 'msg', id: 'e0', chat, at: t('12', '15:29'), text: '', file: 'Other.pdf', sender: 'u2' }];
  const filled = sharedPaymentList({ events: [row('d1', '12', '15:24', { kind: 'transfer', customer: '', amount: 0, source: 'pdf' }), row('e0', '12', '15:29', { kind: 'transfer', customer: '', amount: 0, source: 'pdf' })], raw });
  assert.deepEqual(filled.map((e) => [e.customer, e.amount, e.kind]), [['DERWAZAA', 294, 'transfer'], ['ZETA WOOD', 77, 'transfer']]);
  // 3: an old unread receipt a later named payment explains is dropped; one nothing explains stays, said once with its date and group
  const events = [row('u1', '10', '12:38', { kind: 'transfer', customer: '', amount: 0, source: 'pdf' }), row('n1', '11', '10:45', { kind: 'transfer', customer: 'SAJ INTERNATIONAL', amount: 196.35, source: 'pdf' }), row('u2', '12', '19:30', { kind: 'transfer', customer: '', amount: 0, source: 'pdf' })];
  const list = sharedPaymentList({ events });
  assert.deepEqual(list.map((e) => e.ref), [ref('n1'), ref('u2')]);
  const items = receivedItems(list, { from: '2026-11-01', to: '2026-11-12' }, { timeZone: 'Asia/Dubai', lookup: new Map() });
  assert.deepEqual(items.unread, [{ ref: ref('u2'), label: '12/11 19:30' }]);
  const first = receivedText(items, { title: 't', records: [], now: t('13', '09:00') });
  assert.match(first, /⚠ receipt PDF 12\/11 19:30 \(Confirmation group\), amount not read — check/);
  const again = receivedText(items, { title: 't', records: [], now: t('13', '09:00'), unreadSeen: new Set([ref('u2')]) });
  assert.doesNotMatch(again, /amount not read/); // said once
  assert.doesNotMatch(weeklyCheckText({ expenses: [], purchases: [], items, payments: [], title: 'w', unreadSeen: new Set([ref('u2')]) }), /amount not read/);
  // the office said CLEARED: said beside the lack of a QuickBooks record
  const cleared = receivedText(receivedItems(sharedPaymentList({ events: [row('c1', '12', '15:22', { kind: 'transfer', customer: 'ZETA CO', amount: 100, cleared: true })] }), { from: '2026-11-12', to: '2026-11-12' }, { timeZone: 'Asia/Dubai', lookup: new Map() }), { title: 't', records: [], now: t('13', '09:00') });
  assert.match(cleared, /🔴 100\.00 {2}not in QuickBooks yet {2}cleared by the office/);
  assert.deepEqual(parseInvoiceCommand('fix receipt 15:24 12/11 DERWAZAA 294'), { type: 'fix_receipt', hh: 15, mm: 24, day: '11-12', name: 'DERWAZAA', amount: 294 });
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(index.includes("replyNameAmount(normalizeMessageContent(raw.message)?.documentMessage?.caption") && index.includes("case 'fix_receipt'")); // a new receipt reads its caption; an old one can be filled by hand
});

test('the live shapes: the approved list\'s loose match must fit the typed name («Al masar» is never «MASTER WOOD»), a customer named by QuickBooks, and old amountless receipts (named or by file name) explained by a later payment', async () => {
  const { customerRowFor, CustomerGroups } = await import('../src/customergroups.js');
  const { sharedPaymentList } = await import('../src/payments.js');
  const { receivedItems } = await import('../src/expenses.js');
  const { qboNameFor } = await import('../src/qboname.js');
  const list = new CustomerGroups('');
  list.d.rows = { 'master wood': { customer: 'MASTER WOOD', groups: [] } };
  const aliases = { map: {} };
  assert.equal(customerRowFor('Al masar', { list, aliases }), null); // the approved list no longer hands «Al masar» to «MASTER WOOD»
  assert.equal(customerRowFor('Master Wood', { list, aliases })?.customer, 'MASTER WOOD'); // the exact name still finds its row
  const qbo = ['MASTER WOOD', 'AL MASAR SAHIH', 'ATLAS KITCHEN', 'SAJ INTERNATIONAL INVESTMENT COMPANY'];
  assert.equal(qboNameFor('Al masar', qbo), 'AL MASAR SAHIH'); // QuickBooks names him
  const t = (day, hhmm) => Date.parse('2026-11-' + day + 'T' + hhmm + ':00+04:00');
  const row = (id, day, hhmm, extra) => ({ type: 'payment', currency: 'AED', ref: 'r' + id, at: t(day, hhmm), lines: [], ...extra });
  // the exact live shapes (fake numbers)
  const events = [
    row(1, '12', '14:43', { kind: 'transfer', receipt: 'receipt', source: 'pdf', customer: 'MASTER WOOD', customerTyped: 'Al masar', amount: 900.5, cleared: false }),
    row(2, '10', '12:38', { kind: 'transfer', source: 'pdf', customer: 'saj', amount: 0 }),
    row(3, '11', '10:45', { kind: 'transfer', source: 'pdf', customer: 'SAJ INTERNATIONAL INVESTMENT COMPANY', amount: 100 }),
    row(4, '11', '10:37', { kind: 'transfer', source: 'pdf', customer: 'sen', amount: 0 }),
    row(5, '11', '14:15', { kind: 'cash', customer: 'ATLAS KITCHEN', amount: 150, text: 'cleared atlas kitchen' }),
  ];
  const out = sharedPaymentList({ events, approved: (typed, customer) => false });
  assert.deepEqual(out.map((e) => [e.ref, e.customer]), [['r3', 'SAJ INTERNATIONAL INVESTMENT COMPANY'], ['r5', 'ATLAS KITCHEN'], ['r1', 'Al masar']]); // both old PDFs are gone, the typed name stands
  const items = receivedItems(out, { from: '2026-11-01', to: '2026-11-12' }, { timeZone: 'Asia/Dubai', lookup: new Map() });
  assert.deepEqual(items.unread, []);
  // a named receipt nothing later explains stays, and so does one that fits no later payment but has a usable name
  const keep = sharedPaymentList({ events: [row(6, '10', '09:00', { kind: 'transfer', source: 'pdf', customer: 'zeta wood pressing', amount: 0 }), row(7, '11', '10:00', { kind: 'transfer', source: 'pdf', customer: 'OMEGA CO', amount: 50 })] });
  assert.deepEqual(keep.map((e) => e.ref), ['r6', 'r7']);
  // the file name carries the name: «al atlas.pdf» with a fragment as its customer
  const byFile = sharedPaymentList({ events: [row(8, '11', '10:37', { kind: 'transfer', source: 'pdf', customer: 'sen', file: 'al atlas.pdf', amount: 0 }), row(9, '11', '14:15', { kind: 'cash', customer: 'ATLAS KITCHEN', amount: 150, text: 'cleared' }), row(10, '11', '15:00', { kind: 'cash', customer: 'NOVA CO', amount: 10, text: 'cash from NOVA CO 10' })] });
  assert.ok(!byFile.some((e) => e.ref === 'r8'));
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(index.includes('async function nameByQbo(items)') && index.includes('...(fileName ? { file: fileName } : {})')); // the report names customers as QuickBooks does; the receipt keeps its file name
});

test('«2 #E5» / «2#E5» / «#E5 2» on a done expense whose method differs from QuickBooks: 1 = card, 2 = cash, applied with history and answered once; the report tells how to fix it', async () => {
  const { parseExpenseReply } = await import('../src/expenses.js');
  for (const t of ['2 #E5', '2#E5', '#E5 2', '2 E5']) assert.deepEqual(parseExpenseReply(t), { pick: '2', id: 'E5' }, t);
  assert.deepEqual(parseExpenseReply('1 #E5'), { pick: '1', id: 'E5' });
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(index.includes("if (!target || target.state !== 'done') return null;") && index.includes("const method = pick === '1' ? 'card' : 'cash';")); // 1 card, 2 cash on a done entry
  assert.ok(index.includes("target.history.push({ at: Math.min(at, Date.now()), before: { method: target.method } })")); // with history, like an edit
  assert.ok(index.includes("' is already ' + method + '.'") && !index.includes("' has no open question; use: Atossa edit #'")); // the owner's word wins whether or not QuickBooks can be checked; an unchanged value is said so
  assert.ok(index.includes("matchExpenses([e], await qbExpenseRows(e.day, e.day))")); // the flag is read with the same live window as the reports
  assert.ok(index.includes("' → ' + method + ' ✔'")); // answered once, briefly
});

test('the same expense picks work in the owner\'s own chat (every form), and a pick typed before the fix is replayed once from the raw log unless the method changed since', async () => {
  const { parseInvoiceCommand } = await import('../src/qboinvoice.js');
  for (const t of ['2#E5', '2 #E5', '#E5 2', 'E5 2', '1 E5']) { const c = parseInvoiceCommand(t); assert.equal(c.type, 'expense_pick', t); assert.equal(c.id, 'E5'); assert.equal(c.pick, /^1/.test(t) ? '1' : '2', t); }
  assert.equal(parseInvoiceCommand('Atossa 2#E5').type, 'expense_pick'); // with the name in front too
  assert.equal(parseInvoiceCommand('edit #E5 cash').type, 'expense_edit'); assert.equal(parseInvoiceCommand('Atossa delete #E5').type, 'expense_edit'); assert.equal(parseInvoiceCommand('undo #E5').type, 'expense_edit'); // edit / delete / undo already work there
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(index.includes("const said = await pickMethodOnDone(ic.pick, ic.id); if (said) return [said];")); // the owner's chat answers in the owner's chat
  assert.ok(index.includes('async function replayExpensePicks()') && index.includes("(e.history || []).some((h) => h.at > m.at)") && index.includes('if (done[m.id]) continue;')); // once, and never over a later change
});

test('in the expenses group only a message that starts with her name is answered: «Atossa report [week|month]» and «Atossa cash box» for the owner and the allowed staff, built now', async () => {
  const { expenseAsk } = await import('../src/expenses.js');
  const { parseCashBoxCommand } = await import('../src/cashbox.js');
  const { stripBotName } = await import('../src/namelead.js');
  for (const [t, r] of [['Atossa report', 'today'], ['Atossa expenses', 'today'], ['Atossa report today', 'today'], ['Atossa report week', 'week'], ['atossa report month', 'month'], ['Atossa, expenses week', 'week'], ['اتوسا گزارش', 'today'], ['اتوسا گزارش هفته', 'week'], ['اتوسا گزارش ماه', 'month'], ['Atossa', 'today'], ['Atossa check all expenses in this group', 'all']]) assert.equal(expenseAsk(t), r, t);
  for (const t of ['Report', 'Cash box', 'report week', 'hello Atossa report']) assert.equal(expenseAsk(t), null, t); // without her name at the start: silence
  for (const t of ['Atossa cash box', 'Atossa cashbox', 'اتوسا صندوق', 'atossa, cash box']) assert.equal(parseCashBoxCommand(stripBotName(t))?.op, 'report', t);
  assert.equal(parseCashBoxCommand(stripBotName('Cash box'))?.op, 'report'); // the command itself is the same as in the owner's chat; the name is what the group requires
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(index.includes("if (mayEdit && startsWithName(text, config.botNames) && parseCashBoxCommand(stripBotName(text))?.op === 'report')")); // the name at the start AND the owner / allowed staff
  assert.ok(index.includes('const asked = mayEdit ? expenseAsk(text) : null;')); // the report asks are for them only
});

test('the cash box pairs an expense with its QuickBooks purchase the way the weekly check does: by the receipt date, up to 14 days apart, the amount and the vendor; ENOC 230 is one line', async () => {
  const { cashBoxReportQbo } = await import('../src/cashbox.js');
  const day = (d) => Date.parse('2026-11-' + d + 'T12:00:00+04:00');
  const data = { received: [], elsewhere: [], transfersIn: [], transfersOut: [], purchases: [{ amount: 230, date: '2026-11-07', vendor: 'ENOC', category: 'Fuel' }, { amount: 230, date: '2026-11-08', vendor: 'OTHER SHOP', category: 'Fuel' }] };
  const { text } = cashBoxReportQbo({ month: '2026-11', data, posts: { cashIn: [], outs: [], expenses: [{ amount: 230, at: day('07'), days: 14, strict: true, vendor: 'ENOC', method: 'cash' }] } });
  assert.match(text, /🟢 07\/11\s+230\.00 {3}ENOC\n/); // the expense is the purchase of the same vendor
  assert.match(text, /⚪ 08\/11\s+230\.00 {3}OTHER SHOP {2}\(no post in the group\)/); // the other vendor's purchase stays without a post
  assert.doesNotMatch(text, /posted, not in QuickBooks/);
  assert.match(text, /🟢 Posted and in QuickBooks: 1 /);
  const posted12 = cashBoxReportQbo({ month: '2026-11', data: { ...data, purchases: [data.purchases[0]] }, posts: { cashIn: [], outs: [], expenses: [{ amount: 230, at: day('12'), days: 14, strict: true, vendor: 'ENOC', method: 'cash' }] } }).text;
  assert.match(posted12, /🟢 07\/11\s+230\.00 {3}ENOC\n/); // posted five days later: still the same expense within the 14 days
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.ok(index.includes("at: Date.parse((e.date || e.day) + 'T12:00:00+04:00') || e.at, days: 14")); // the receipt date, 14 days
});

test('one matcher for every expense view: the exact amount, the receipt date first, each QuickBooks purchase once, the same vendor preferred; a 10.00 post with no 10.00 purchase is not found (no wrong match to a near amount), the same set of records feeds the report, the weekly check and the method pick; an empty report says when it was checked', async () => {
  const { matchExpenses } = await import('../src/expenses.js');
  const { expensesReport } = await import('../src/expenseedit.js');
  const ent = (id, amount, day, vendor, type) => ({ id, amount, day, date: day, type: type || 'other', vendor, method: 'cash', state: 'done' });
  const rec = (d, amt, v) => ({ TxnDate: d, TotalAmt: amt, EntityRef: { name: v }, AccountRef: { name: 'Petty Cash' } });
  const records = [rec('2026-11-05', 21, 'A SHOP'), rec('2026-11-06', 22.48, 'B SHOP'), rec('2026-11-07', 230, 'ENOC'), rec('2026-11-09', 11, 'Z SHOP'), rec('2026-11-10', 29.4, 'C SHOP')];
  const m = matchExpenses([ent('E2', 10, '2026-11-10', 'Part Zone'), ent('E5', 230, '2026-11-07', 'ENOC', 'fuel')], records);
  assert.deepEqual(m.found.map((f) => f.entry.id), ['E5']); assert.deepEqual(m.missing.map((e) => e.id), ['E2']); // 10.00 is not 11.00
  const twice = matchExpenses([ent('E7', 230, '2026-11-12', 'ENOC', 'fuel'), ent('E8', 230, '2026-11-07', 'ENOC', 'fuel')], [rec('2026-11-07', 230, 'ENOC'), rec('2026-11-12', 230, 'ENOC')]);
  assert.deepEqual(twice.found.map((f) => [f.entry.id, f.record.TxnDate]).sort(), [['E7', '2026-11-12'], ['E8', '2026-11-07']]); // each purchase once, the nearest date
  assert.match(expensesReport([], [], 'Today', '11:40'), /checked now 11:40\nNo expense was recorded\./);
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.equal((index.match(/await qbExpenseRows\(/g) || []).length, 3); // report, weekly check, method pick
});

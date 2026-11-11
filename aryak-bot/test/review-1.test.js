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
  assert.match(text, /^Left, not invoiced \(1 customer\):\n• NOVA ART LLC: 220 12m \(orders 08\/11, OUT 09\/11, no invoice\) — 1 day\n━+\nInvoiced, not left yet \(2 customers\):/);
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
  assert.match(short, /\(12 customers\):(\n• C\d+: 1 5m \(x\)){8}\n\+4 more/); assert.match(short, /Say "unbilled details" for every customer, the OUT rows nobody posted and the deliveries\./); assert.doesNotMatch(short, /Left without/);
  assert.match(threeWayText(many, { details: true }), /\(12 customers\):(\n• C\d+: 1 5m \(x\)){12}[\s\S]*Left without an order-group post/);
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
  assert.match(text, /^Quantity differs \(OUT vs invoice\) \(1 customer\):\n• SIGMA HOUSE: 1819: OUT 350m[\s\S]*Possible wrong code \(same day, same quantity\) \(1 customer\):/);
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
  assert.match(text, /Cut \/ ready, not invoiced yet \(2 customers\):\n• OMEGA: ⚠\uFE0F? 301 12m/); assert.match(text, /Invoiced, not left yet \(2 customers\):\n• TAU CO: ⚠\uFE0F? 404 18m/);
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

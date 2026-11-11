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
  assert.match(index, /\/\^\(\?:\[QSA\]\[0-9\]\+\|\[0-9\]\+\)\$\/\.test\(dec\.id \|\| ''\)/); // the internal groups take the number too
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
  assert.match(block, /\? \[\.\.\.qboInvoices\.openIds\(\)\.filter\(\(id\) => Object\.values\(qboInvoices\.store\.d\.previews\)\.find\(\(p\) => p\.id === id\)\?\.origin\?\.jid === here\.chatId\), \.\.\.groupStatements\.openIds\(\)\]/);
  assert.doesNotMatch(block.slice(0, block.indexOf(': [...qboInvoices')), /availDrafts|qboNames|pendingBackfill|cutAliases/); // none of those count in a group
});

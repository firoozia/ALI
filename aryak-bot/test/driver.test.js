import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { driverDay, driverEveningLines, isDriverQuestion, runDoneLine, sameStop, whereText } from '../src/driver.js';
import { eventsFromCaption } from '../src/captionevents.js';

// Invented customers and couriers only. Times are Dubai time (UTC+4).
const TZ = 'Asia/Dubai';
const at = (hhmm) => Date.parse(`2026-11-10T${hhmm}:00+04:00`);
let n = 0;
const post = (hhmm, text, msg = `m${++n}`) => eventsFromCaption('delivery', text).events.map((e, i) => ({ ...e, customerTyped: e.customer, at: at(hhmm), ref: `${msg}-${i}`, msg }));
const day = () => [
  ...post('13:10', 'ZETA DOORS 1 ROLL PICKED UP BY SWIFT COURIER.'),
  ...post('14:07', 'AL KAPPA KITCHEN 2 ROLLS WITH CATALOG PICKED UP BY CLIENT DRIVER.'),
  ...post('15:56', 'HIGH TEST 1 ROLL, NOVA ART 1 ROLL, AL ITQANX 1 ROLL & PALACE DEMO 1 ROLL DISPATCHED.'),
];
const where = (events, hhmm) => whereText(events, { now: at(hhmm) + 30 * 1000, timeZone: TZ });

test('the posts: a dispatch opens a run with its stops, a delivered post closes one; a pickup is the courier\'s, outside the run; a mis-typed l for I still matches', () => {
  const events = [...day(), ...post('16:21', 'Palace demo delivered'), ...post('16:39', 'AL lTQANX kitchen delivered')];
  const d = driverDay(events, { day: '2026-11-10', timeZone: TZ });
  assert.equal(d.runs.length, 1);
  assert.deepEqual(d.runs[0].stops.map((s) => [s.customer, !!s.deliveredAt]), [['HIGH TEST', false], ['NOVA ART', false], ['AL ITQANX', true], ['PALACE DEMO', true]]);
  assert.deepEqual(d.pickups.map((p) => [p.customer, p.by]), [['ZETA DOORS', 'SWIFT COURIER'], ['AL KAPPA KITCHEN', 'CLIENT DRIVER']]);
  assert.equal(d.strays.length, 0);
  assert.ok(sameStop('AL lTQANX kitchen', 'AL ITQANX')); assert.ok(!sameStop('HIGH TEST', 'NOVA ART'));
});

test('where is the driver: the last delivery and what is left; after the last stop he is on his way back; a newer dispatch is answered first; nothing today says so', () => {
  const events = [...day(), ...post('16:21', 'Palace demo delivered'), ...post('16:39', 'AL lTQANX kitchen delivered')];
  assert.equal(where(events, '16:48'), 'Last delivery: AL ITQANX at 16:39. Still to deliver: HIGH TEST, NOVA ART (2 of 4 left from the 15:56 dispatch).');
  const all = [...events, ...post('16:53', 'Nova art delivered'), ...post('17:42', 'High test delivered')];
  assert.equal(where(all, '17:45'), 'The driver delivered all 4 packages of the 15:56 dispatch (PALACE DEMO 16:21, AL ITQANX 16:39, NOVA ART 16:53, HIGH TEST 17:42) and is on his way back.');
  const later = [...all, ...post('18:18', 'TAU ALUMINUM 1 ROLL & PHI CARPENTRY 1 ROLL DISPATCHED')];
  assert.equal(where(later, '18:30'), 'The 18:18 dispatch (TAU ALUMINUM 1, PHI CARPENTRY 1) is out; no delivery is confirmed yet.');
  assert.match(where([...events, ...post('18:18', 'TAU ALUMINUM 1 ROLL DISPATCHED')], '18:20'), /The 18:18 dispatch[\s\S]*An earlier dispatch \(15:56\) still has stops open: HIGH TEST, NOVA ART\./);
  assert.equal(where(day().slice(0, 2), '15:00'), 'Nothing was dispatched with our driver today.\nCourier pickups today: ZETA DOORS (SWIFT COURIER 13:10), AL KAPPA KITCHEN (CLIENT DRIVER 14:07).');
  assert.equal(where([], '09:00'), 'Nothing was dispatched with our driver today.');
  assert.doesNotMatch(where(events, '16:48'), /can't see|cannot see/i);
});

test('one closing line, only when the LAST stop of a run is delivered; none per stop; none for a stray; the evening lines list what is not confirmed', () => {
  const events = [...day()]; const lines = [];
  for (const [t, text] of [['16:21', 'Palace demo delivered'], ['16:39', 'Al itqanx delivered'], ['16:53', 'Nova art delivered'], ['17:42', 'High test delivered']]) {
    const [ev] = post(t, text); events.push(ev); lines.push(runDoneLine(events, ev, { timeZone: TZ }));
  }
  assert.deepEqual(lines, ['', '', '', 'All 4 packages of the 15:56 dispatch delivered (HIGH TEST, NOVA ART, AL ITQANX, PALACE DEMO). Driver on the way back.']);
  const stray = post('18:00', 'Somebody else delivered');
  assert.equal(runDoneLine([...events, ...stray], stray[0], { timeZone: TZ }), '');
  const evening = driverEveningLines([...day(), ...post('16:21', 'Palace demo delivered')], { day: '2026-11-10', timeZone: TZ });
  assert.deepEqual(evening, ['Driver and couriers today:', '- 15:56 dispatch: 1 of 4 delivered (PALACE DEMO 16:21); NOT confirmed delivered: HIGH TEST, NOVA ART, AL ITQANX', '- Courier pickups today: ZETA DOORS (SWIFT COURIER 13:10), AL KAPPA KITCHEN (CLIENT DRIVER 14:07).']);
  assert.deepEqual(driverEveningLines([], { day: '2026-11-10', timeZone: TZ }), []);
});

test('the question is recognised in English and Persian, a voice transcript included; other talk is not it', () => {
  for (const q of ['ATOSSA where driver reached ?', 'Where is the driver?', 'where is our driver now', 'Has the driver reached Nova Art?', 'driver location please', 'راننده کجاست؟', 'راننده کجا رسید', 'الان کجا هست راننده']) assert.ok(isDriverQuestion(q), q);
  for (const q of ['the driver delivered the order', 'send the invoice', 'where is my invoice', 'Atossa statement for Nova art']) assert.ok(!isDriverQuestion(q), q);
});

test('the wiring: the question is answered before the model, in the test group from the test tracker; the closing line and the evening lines; nothing to a customer or QuickBooks', () => {
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(index, /if \(text && !audio && !image && addressed && isDriverQuestion\(text\)\) \{[\s\S]*?whereText\(trackerOf\(group\?\.test\)\.events/);
  assert.ok(index.indexOf('isDriverQuestion(text)') < index.indexOf('const tc = parseTrackerCommand(text)'));
  assert.match(index, /\.\.\.\(role === 'delivery' \? \{ msg: raw\.key\.id \} : \{\}\)/);
  assert.match(index, /await announceRunDone\(testTracker\.events, event, \(t\) => reply\(`SIMULATION: \$\{t\}`\)\)/);
  assert.match(index, /extraLines: \[\.\.\.driverEveningLines\(tracker\.events/);
  const fn = index.slice(index.indexOf('async function announceRunDone'), index.indexOf('/** For every received entry'));
  assert.match(fn, /replayCtx\.getStore\(\)\?\.quiet/); assert.doesNotMatch(fn, /qbo\.|customerGroups|sendCustomer/);
  const staff = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'staff.js'), 'utf8');
  assert.match(staff, /The delivery group: you DO follow it[\s\S]*never say you cannot see the driver/);
});

test('the names shown are the QuickBooks ones (an old alias may give a longer name); the matching still uses the posted names', () => {
  const qbo = ['NOVA ART IND . LLC', 'HIGH TEST'];
  const display = (n) => (/^nova/i.test(n) ? 'NOVA ART IND . LLC' : n);
  const events = [...post('15:56', 'HIGH TEST 1 ROLL & NOVA ART 1 ROLL DISPATCHED'), ...post('16:10', 'Nova art delivered'), ...post('16:20', 'ZETA DOORS 1 ROLL PICKED UP BY SWIFT COURIER')];
  assert.equal(whereText(events, { now: at('16:30'), timeZone: TZ, display }), 'Last delivery: NOVA ART IND . LLC at 16:10. Still to deliver: HIGH TEST (1 of 2 left from the 15:56 dispatch).');
  assert.ok(driverEveningLines(events, { day: '2026-11-10', timeZone: TZ, display }).join('\n').includes('NOVA ART IND . LLC 16:10'));
  assert.ok(qbo.length === 2);
});

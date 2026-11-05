import test from 'node:test';
import assert from 'node:assert/strict';
import { announcesOrder, orderLinesOf, parseCustomerText } from '../src/orderlines.js';
import { parseOnBehalf } from '../src/onbehalf.js';
import { receivedFrom } from '../src/received.js';
import { isSourcingRequest } from '../src/sourcing.js';
import { GroupGate } from '../src/gate.js';
import { Tracker, isDuplicatePayment } from '../src/tracker.js';
import { ShadowDesk, ShadowStore, compareCodes, staffByCode } from '../src/shadow.js';
import { mayReadMedia } from '../src/costpolicy.js';

const order = (text) => parseCustomerText(text);
const L = (code, quantity, unit, extra = {}) => ({ code, quantity, unit, addOn: false, ...extra });

test('real message forms the parser used to misread', () => {
  assert.deepEqual(order('AR  216   40MTR').lines, [L('216', 40, 'm')]);
  assert.deepEqual([order('406 AND 220 AVAILBLE').kind, order('406 AND 220 AVAILBLE').codes], ['availability', ['406', '220']]);
  assert.deepEqual([order('201/204 both are available').kind, order('201/204 both are available').codes], ['availability', ['201', '204']]);
  const req = order('NEW  REQUIREMENT\n\n218 -------- 2 ROLE\n\n510 ------- 1 ROLE'); // ROLE means roll; a run of dashes is a separator
  assert.equal(req.kind, 'order');
  assert.deepEqual(req.lines, [L('218', 2, 'roll'), L('510', 1, 'roll')]);
  assert.deepEqual(order('509 number pvc  need 6 meters').lines, [L('509', 6, 'm')]);
  assert.deepEqual(order('116 number need  3 meters').lines, [L('116', 3, 'm')]);
  // a sample is not a customer; the quantity is kept and the line is marked
  const sample = order('405  1MTR FOR SAMPLE').lines[0];
  assert.deepEqual([sample.code, sample.quantity, sample.unit, sample.sample, sample.customer], ['405', 1, 'm', true, undefined]);
  const have = order('WE HAVE 116   .  115 AVAILABLE');
  assert.deepEqual([have.kind, have.codes], ['availability', ['116', '115']]);
});

test('what a customer tells us he holds, and the announcement of an order, are not requests', () => {
  assert.equal(order('WE HAVE 3 MTR').kind, 'other'); // often the answer to our manager's "how many meter pvc you have available"
  assert.equal(order('I HAVE ORDER PLS WAIT').kind, 'other');
  assert.equal(announcesOrder('I HAVE ORDER PLS WAIT'), true);
  assert.equal(announcesOrder('we have order coming'), true);
  assert.equal(announcesOrder('WE HAVE 3 MTR'), false);
  assert.equal(announcesOrder('508 available?'), false);
});

test('the real gate waits twice as long after "I have order, please wait" so the order lines that follow are one order', () => {
  const timers = [];
  const fired = [];
  const gate = new GroupGate({
    waitMs: 300000, isStaff: () => false, answer: async (b) => { fired.push(b.messages.map((m) => m.text)); },
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; }, clearTimer: (i) => { if (timers[i]) timers[i].fn = null; },
  });
  gate.onMessage({ groupId: 'g', text: 'I HAVE ORDER PLS WAIT', staff: false });
  assert.deepEqual(timers.map((t) => t.ms), [300000, 600000]); // the first wait is replaced by a doubled one
  gate.onMessage({ groupId: 'g', text: '218 - 2 roll', staff: false });
  assert.equal(timers.length, 2); // not extended again
});

test('the shadow desk keeps the batch open after the announcement and answers the lines together', async () => {
  const timers = [];
  const analysed = [];
  const desk = new ShadowDesk({
    store: new ShadowStore(), post: async () => {}, config: { timezone: 'UTC', shadowMergeMs: 120000, shadowAnnounceMs: 600000 },
    analyze: async ({ messages }) => { analysed.push(messages.map((m) => m.text)); return { action: 'answer', reply: 'ok', lang: 'en', calls: 0 }; },
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; }, clearTimer: (i) => { if (timers[i]) timers[i].fn = null; }, now: () => 0,
  });
  const c = (text) => ({ groupId: 'g', subject: 's', label: 's', staff: false, text, at: 0 });
  desk.onMessage(c('I HAVE ORDER PLS WAIT'));
  desk.onMessage(c('218 - 2 roll'));
  assert.deepEqual(timers.map((t) => t.ms), [600000, 120000]); // the long wait, then the usual one after a real line
  for (const t of timers) if (t.fn) await t.fn();
  await desk.idle();
  assert.deepEqual(analysed, [['I HAVE ORDER PLS WAIT', '218 - 2 roll']]);
});

test('a payment forwarded by several people within minutes is counted once', () => {
  const t = new Tracker();
  const NOW = Date.parse('2026-11-05T08:00:00Z');
  const sms = { type: 'payment', kind: 'transfer', amount: 5000, customer: '', pendingName: true };
  assert.equal(isDuplicatePayment(t, { ...sms, at: NOW }), false);
  t.add({ ...sms, at: NOW, ref: 'a' });
  assert.equal(isDuplicatePayment(t, { ...sms, at: NOW + 120000 }), true); // forwarded again two minutes later
  assert.equal(isDuplicatePayment(t, { ...sms, at: NOW + 4 * 60000 }), true);
  assert.equal(isDuplicatePayment(t, { ...sms, amount: 5001, at: NOW + 60000 }), false); // another amount
  assert.equal(isDuplicatePayment(t, { ...sms, at: NOW + 3 * 3600000 }), false); // hours later: a new payment
  assert.equal(isDuplicatePayment(t, { type: 'payment', kind: 'cash', amount: 5000, customer: 'X', at: NOW + 60000 }), false); // another kind
});

test('staff chatter in the Invoices group raises no invoice message and no paid call', () => {
  const chatter = ['206 available 2 mtr', '406 only 4.6+4.8 available', 'still have', 'Bahar Kitchen'];
  for (const t of chatter) {
    assert.equal(parseOnBehalf(t), null, t); // not an order on behalf of a customer
    assert.equal(receivedFrom(t, {}), null, t); // not goods arriving
  }
  assert.equal(isSourcingRequest('still have', []), false);
  // the group is quiet: a photo or voice note there is left alone, and a text that does not call her is not answered
  assert.equal(mayReadMedia({ group: { quiet: true }, addressed: false }), false);
});

// ------------------------------------------------------------------------------------------------ the shadow comparison per code
test('the staff answer is read code by code: partial pieces, and an answer split in two messages', () => {
  assert.deepEqual(staffByCode(['406 only 4.6+4.8 available']), { by: { 406: 'yes' }, general: '' });
  assert.deepEqual(staffByCode(['220 available', '406 and 401 no']), { by: { 220: 'yes', 406: 'no', 401: 'no' }, general: '' });
  assert.deepEqual(staffByCode(['Yea']), { by: {}, general: 'yes' });
  assert.equal(compareCodes({ 406: 'yes' }, ['406 only 4.6+4.8 available']), 'same');
  assert.equal(compareCodes({ 220: 'yes', 406: 'no', 401: 'no' }, ['220 available', '406 and 401 no']), 'same');
  assert.equal(compareCodes({ 220: 'yes', 406: 'yes' }, ['220 available', '406 and 401 no']), 'different'); // her sheet said 406 was there
  assert.equal(compareCodes({ 220: 'yes' }, ['we will see']), 'unknown');
});

test('a split answer after the card is compared as it arrives and corrected when the second message changes the verdict', async () => {
  const posts = [];
  let clock = 0;
  const timers = [];
  const desk = new ShadowDesk({
    store: new ShadowStore(), post: async (t) => { posts.push(t); }, config: { timezone: 'UTC', shadowCardCap: 10, shadowCompareMinutes: 60 },
    analyze: async () => ({ action: 'ask-quantity', reply: 'how many metres?', lang: 'en', stance: 'mixed', stances: { 220: 'yes', 406: 'no', 401: 'no' }, calls: 0 }),
    setTimer: (fn) => { timers.push(fn); return timers.length - 1; }, clearTimer: () => {}, now: () => clock,
  });
  desk.onMessage({ groupId: 'g', subject: 'S', label: 'S', staff: false, text: '220 / 406 / 401 available?', at: 0 });
  for (const t of timers) await t();
  await desk.idle();
  clock = 60000;
  desk.onMessage({ groupId: 'g', subject: 'S', label: 'S', staff: true, text: '220 available', at: clock });
  await desk.idle();
  assert.match(posts[1], /staff said: 220 available — she asked, staff answered/); // she only asked for the quantity: staff answered, not agreed
  clock = 90000;
  desk.onMessage({ groupId: 'g', subject: 'S', label: 'S', staff: true, text: '406 and 401 no', at: clock });
  await desk.idle();
  assert.equal(posts.length, 2); // the verdict did not change (still the same): no second message
  assert.equal(desk.store.d.cards[0].verdict, 'asked');
  assert.equal(desk.store.day('1970-01-01').asked, 1); // counted once, apart from agreed
  clock = 100000;
  desk.onMessage({ groupId: 'g', subject: 'S', label: 'S', staff: true, text: '220 no', at: clock });
  await desk.idle();
  assert.match(posts[2], /update: staff also said: 220 no — different/);
  assert.equal(desk.store.day('1970-01-01').asked, 0);
  assert.equal(desk.store.day('1970-01-01').differed, 1); // the sheet contradicts staff: still different
});

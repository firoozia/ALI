import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AvailabilityDesk, answerRequest, askQuantityText, availableText, classify, managerQuestion, notAvailableText, parseManagerReply, parseQuantity, reminderText, runAvailability,
} from '../src/availability.js';
import { answerKind } from '../src/voice.js';

const sheet = (extra = {}) => ({ found: true, code: '408', category: 'PVC film', unit: 'm', free: 100, reserved: 20, limit: 30, qtyChecked: true, askedUnit: 'm', ...extra });

// ------------------------------------------------------------------------------------------------ small pieces
test('the answer to "how many?": a number with its unit, or a short bare number (metres); a long bare number is a code', () => {
  assert.deepEqual(parseQuantity('15'), { quantity: 15, unit: 'm' });
  assert.deepEqual(parseQuantity('15 mtr'), { quantity: 15, unit: 'm' });
  assert.deepEqual(parseQuantity('2 rolls please'), { quantity: 2, unit: 'roll' });
  assert.deepEqual(parseQuantity('Need 12.5 meters'), { quantity: 12.5, unit: 'm' });
  assert.deepEqual(parseQuantity('۱۰ متر'), { quantity: 10, unit: 'm' });
  assert.deepEqual(parseQuantity('20 میٹر'), { quantity: 20, unit: 'm' });
  assert.deepEqual(parseQuantity('300 m'), { quantity: 300, unit: 'm' });
  assert.equal(parseQuantity('410'), null); // a code, not a quantity
  assert.equal(parseQuantity('thanks'), null);
  assert.equal(parseQuantity('603 - 15 mtr'), null);
  assert.equal(parseQuantity(''), null);
});

test('the decision: comfortably in stock is ok; short, or leaving less than the minimum, goes to the manager', () => {
  const at = (asked, extra) => classify(sheet({ askedInUnit: asked, ...extra })).kind;
  assert.equal(at(50), 'ok'); // 100 - 50 = 50 >= 30
  assert.equal(at(70), 'ok'); // exactly the minimum is left
  assert.equal(at(71), 'manager'); // 29 left, under the minimum
  assert.equal(at(100), 'manager'); // all of it, nothing left
  assert.equal(at(120), 'manager'); // more than there is
  assert.equal(at(5, { free: 20 }), 'manager'); // free is under the minimum already
  assert.equal(at(5, { qtyChecked: false }), 'manager'); // 2 rolls and no roll size known
  assert.equal(at(0), 'unhandled');
  assert.equal(classify({ found: false }).kind, 'unhandled');
  assert.equal(classify({ found: true, ambiguous: true }).kind, 'unhandled');
});

test('the sentences to the customer in each language', () => {
  assert.equal(askQuantityText('en', ['408']), '408: how many metres or rolls do you need?');
  assert.match(askQuantityText('ar', ['408']), /كم متر/);
  assert.match(askQuantityText('ur', ['408']), /کتنے میٹر/);
  assert.match(askQuantityText('fa', ['408']), /چند متر/);
  assert.match(askQuantityText('en', ['108', '115']), /for each code/);
  assert.equal(availableText('en', ['408']), 'Available.');
  assert.equal(availableText('en', ['408', '229']), '408: available\n229: available');
  assert.equal(availableText('ar', ['1']), 'متوفر.');
  assert.equal(availableText('ur', ['1']), 'دستیاب ہے۔');
  assert.equal(availableText('fa', ['1']), 'موجود است.');
  assert.equal(availableText('hi', ['1']), 'Available.'); // Hindi: English wording
  for (const l of ['en', 'ar', 'ur', 'fa']) assert.ok(notAvailableText(l).length > 8);
});

test('the question to the manager names the customer, code, quantity, free, reserved and the minimum, and how to answer', () => {
  const q = managerQuestion({ id: 12, customer: 'Master Wood', groupName: 'Master Wood - ARYAK', line: { code: '408', quantity: 80, unit: 'm' }, res: sheet() });
  assert.match(q, /^⚠️ درخواست #12/);
  assert.match(q, /مشتری: Master Wood\nگروه: Master Wood - ARYAK/);
  assert.match(q, /کد: 408 \(PVC film\)/);
  assert.match(q, /مقدار درخواست: 80 m/);
  assert.match(q, /موجودی آزاد: 100 m\nرزرو: 20 m\nحداقل موجودی: 30 m/);
  assert.match(q, /آیا اجازه می‌دهید به مشتری «موجود است» بگویم، یا خودتان جواب می‌دهید؟/);
  assert.match(q, /#12 بله.*#12 نه.*#12 خودم/);
  assert.match(managerQuestion({ id: 1, customer: 'A', line: { code: '1', quantity: 2, unit: 'roll' }, res: sheet({ qtyChecked: false }) }), /به متر تبدیل نشد/);
});

test('the manager\'s answer: "#id yes/no/self", or his words', () => {
  const p = (t) => parseManagerReply(t, answerKind);
  assert.deepEqual(p('#12 بله'), { id: 12, action: 'yes', text: 'بله' });
  assert.equal(p('#۱۲ نه').action, 'no');
  assert.equal(p('#12 خودم').action, 'self');
  assert.equal(p('#3 yes').id, 3);
  assert.equal(p('بله').id, null);
  assert.equal(p('خودم جواب میدم').action, 'self');
  assert.deepEqual(p('#12 تا فردا می‌رسد، حدود ۵۰ متر'), { id: 12, action: 'text', text: 'تا فردا می‌رسد، حدود 50 متر' });
  assert.equal(p('#12').action, 'none');
  assert.equal(p('').action, 'none');
});

// ------------------------------------------------------------------------------------------------ the memory
test('the desk: ids, one open request per group, code and quantity, replies found by quote, id or the only one, one reminder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-'));
  const desk = new AvailabilityDesk({ dir });
  const base = { groupId: 'g1', groupName: 'G', customer: 'C', lang: 'en', line: { code: '408', quantity: 80, unit: 'm' }, res: sheet() };
  const a = desk.openRequest(base, 1000);
  const again = desk.openRequest(base, 2000);
  assert.deepEqual([a.id, again.id, again.existing], [1, 1, true]);
  const b = desk.openRequest({ ...base, groupId: 'g2' }, 3000);
  assert.equal(b.id, 2);
  desk.linkMessage('WA-1', 1);
  assert.equal(desk.find({ quotedId: 'WA-1' }).id, 1);
  assert.equal(desk.find({ id: 2 }).id, 2);
  assert.equal(desk.find({ allowSingle: true }), null); // two are open: not guessed
  assert.equal(desk.find({ id: 99 }), null);
  assert.equal(desk.dueReminders(1000 + 14 * 60000).length, 0);
  assert.deepEqual(desk.dueReminders(1000 + 15 * 60000).map((r) => r.id), [1]);
  assert.deepEqual(desk.dueReminders(1000 + 99 * 60000).map((r) => r.id), [2]); // the first is not reminded twice
  assert.match(reminderText(a), /#1.*408.*C.*بی‌پاسخ/);
  const restarted = new AvailabilityDesk({ dir });
  assert.equal(restarted.open.size, 2);
  assert.equal(restarted.openRequest({ ...base, groupId: 'g3' }).id, 3);
  desk.close(1);
  assert.equal(desk.find({ allowSingle: true }).id, 2);
});

test('the pending question about the quantity lives half an hour', () => {
  const desk = new AvailabilityDesk();
  desk.setQty('g|s', { code: '408', lang: 'en' }, 0);
  assert.equal(desk.pendingQty('g|s', 29 * 60000).code, '408');
  assert.equal(desk.pendingQty('g|s', 31 * 60000), null);
  assert.equal(desk.pendingQty('g|other', 0), null);
});

// ------------------------------------------------------------------------------------------------ the whole flow
function harness(results = {}) {
  const sent = [];
  const toManager = [];
  const logs = [];
  const desk = new AvailabilityDesk();
  const ctx = {
    groupId: 'g1', groupName: 'Master Wood - ARYAK', customer: 'Master Wood', desk,
    decide: async (line) => (results[line.code] ? classify(results[line.code](line)) : { kind: 'unhandled' }),
    send: async (gid, text, m) => { sent.push({ gid, text, to: m?.id }); },
    notifyManager: async (req) => { toManager.push(req); return `WA-${req.id}`; },
    log: (s) => logs.push(s),
  };
  return { sent, toManager, logs, desk, run: (messages, now = 0) => runAvailability({ ...ctx, messages, now }) };
}
const msg = (text, extra = {}) => ({ id: `m${Math.random()}`, sender: 'cust1', text, ...extra });
const stock = (free, limit = 30) => (line) => sheet({ free, limit, askedInUnit: line.quantity, asked: line.quantity });

test('"408 available?" is not answered: the customer is asked how many, in the thread, in his language', async () => {
  for (const [text, expected] of [['408 available?', /how many metres/], ['هل الكود 408 متوفر؟', /كم متر/], ['کیا 408 دستیاب ہے؟', /کتنے میٹر/], ['۴۰۸ موجوده؟', /چند متر/]]) {
    const h = harness();
    const m = msg(text);
    const { rest } = await h.run([m]);
    assert.equal(rest.length, 0);
    assert.equal(h.sent.length, 1);
    assert.match(h.sent[0].text, expected);
    assert.equal(h.sent[0].to, m.id); // a reply to his message
    assert.equal(h.toManager.length, 0);
  }
});

test('then "15 mtr" (his next message) with plenty in stock: "Available." at once, nothing to the manager', async () => {
  const h = harness({ 408: stock(500) });
  await h.run([msg('408 available?')], 0);
  const { rest } = await h.run([msg('15 mtr')], 5 * 60000);
  assert.equal(rest.length, 0);
  assert.deepEqual(h.sent.map((s) => s.text), ['408: how many metres or rolls do you need?', 'Available.']);
  assert.equal(h.toManager.length, 0);
  assert.ok(h.logs.every((l) => !l.includes('408') && !l.includes('15')), 'no text in the log');
});

test('only the same person answers the question, and only within half an hour', async () => {
  const h = harness({ 408: stock(500) });
  await h.run([msg('408 available?', { sender: 'a' })], 0);
  const other = await h.run([msg('15', { sender: 'b' })], 1000);
  assert.equal(other.rest.length, 1); // another customer's "15" is not an answer
  const late = await h.run([msg('15', { sender: 'a' })], 40 * 60000);
  assert.equal(late.rest.length, 1);
  assert.equal(h.sent.length, 1);
});

test('too little stock: the customer hears NOTHING, the sales manager is asked, one request per question', async () => {
  const h = harness({ 408: stock(60) }); // 60 free, 30 minimum, 50 asked -> 10 left
  const { rest } = await h.run([msg('408 - 50 mtr')]);
  assert.equal(rest.length, 0);
  assert.equal(h.sent.length, 0);
  assert.equal(h.toManager.length, 1);
  assert.deepEqual([h.toManager[0].id, h.toManager[0].customer, h.toManager[0].line], [1, 'Master Wood', { code: '408', quantity: 50, unit: 'm', addOn: false }]);
  await h.run([msg('408 - 50 mtr')]); // asked again before the answer
  assert.equal(h.toManager.length, 1);
  assert.equal(h.sent.length, 0);
});

test('an order of several lines: the lines in stock are answered, the others go to the manager, an unknown code is left to the normal answer', async () => {
  const h = harness({ 603: stock(500), 201: stock(10), 119: () => ({ found: false }) });
  const { rest } = await h.run([msg('603 - 15 mtr\n201 - 15 mtr\n119 - 6 mtr')]);
  assert.deepEqual(h.sent.map((s) => s.text), ['603: available']); // the code is named when the message had several lines
  assert.equal(h.toManager.length, 1);
  assert.equal(h.toManager[0].line.code, '201');
  assert.equal(rest.length, 1);
  assert.equal(rest[0].text, '119 - 6 m');
});

test('messages that are not about stock are left to the normal answer untouched', async () => {
  const h = harness();
  const m = msg('good morning, please send the invoice');
  const { rest } = await h.run([m]);
  assert.deepEqual(rest, [m]);
  assert.equal(h.sent.length, 0);
});

test('a photo that was confirmed (items with quantities) goes the same way; codes without a quantity ask for it', async () => {
  const h = harness({ 408: stock(500) });
  await h.run([msg('Is code 408 (200 m) available?', { items: [{ code: '408', quantity: 200, unit: 'm' }], lang: 'en' })]);
  assert.deepEqual(h.sent.map((s) => s.text), ['Available.']);
  const h2 = harness();
  await h2.run([msg('x', { items: [{ code: '408', quantity: null, unit: '' }], lang: 'ar' })]);
  assert.match(h2.sent[0].text, /كم متر/);
});

test('the manager answers: yes, no, himself, or his own words (put into the customer\'s language)', async () => {
  const h = harness({ 408: stock(60) });
  const m = msg('408 - 50 mtr');
  await h.run([m]);
  const req = h.desk.find({ id: 1 });
  const customerSent = [];
  const send = async (r, t) => customerSent.push({ to: r.groupId, t, quoted: r.quoted?.id });
  const translate = async (t, lang) => `[${lang}] ${t}`;
  const ask = (text) => parseManagerReply(text, answerKind);

  assert.match(await answerRequest({ req, reply: ask('#1 بله'), desk: h.desk, send, translate }), /«موجود است»/);
  assert.deepEqual(customerSent, [{ to: 'g1', t: 'Available.', quoted: m.id }]);
  assert.equal(h.desk.open.size, 0);

  const h2 = harness({ 408: stock(60) });
  await h2.run([msg('408 - 50 mtr', { lang: 'ar' })]);
  const r2 = h2.desk.find({ id: 1 });
  await answerRequest({ req: r2, reply: ask('#1 نه'), desk: h2.desk, send, translate });
  assert.match(customerSent.at(-1).t, /غير متوفر/);

  const h3 = harness({ 408: stock(60) });
  await h3.run([msg('408 - 50 mtr')]);
  const before = customerSent.length;
  assert.match(await answerRequest({ req: h3.desk.find({ id: 1 }), reply: ask('#1 خودم'), desk: h3.desk, send, translate }), /چیزی نمی‌گویم/);
  assert.equal(customerSent.length, before); // silent in the group
  assert.equal(h3.desk.open.size, 0);

  const h4 = harness({ 408: stock(60) });
  await h4.run([msg('408 - 50 mtr')]);
  await answerRequest({ req: h4.desk.find({ id: 1 }), reply: ask('#1 فردا می‌رسد'), desk: h4.desk, send, translate });
  assert.equal(customerSent.at(-1).t, '[en] فردا می‌رسد');
  assert.equal(h4.desk.open.size, 0);

  const h5 = harness({ 408: stock(60) });
  await h5.run([msg('408 - 50 mtr')]);
  assert.match(await answerRequest({ req: h5.desk.find({ id: 1 }), reply: ask('#1'), desk: h5.desk, send, translate }), /نفهمیدم/);
  assert.equal(h5.desk.open.size, 1); // still waiting
});

test('the log never carries the customer\'s words or a figure', async () => {
  const h = harness({ 408: stock(60), 603: stock(500) });
  await h.run([msg('408 - 50 mtr'), msg('603 - 15 mtr'), msg('108 available?')]);
  const log = h.logs.join('\n');
  assert.ok(!/408|603|108|50|15/.test(log.replace(/#\d+/g, '').replace(/\b\d+ line|\(\d+ code/g, '')), log);
});

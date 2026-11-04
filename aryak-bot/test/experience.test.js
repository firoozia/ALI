import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Experience, classifyAnswer, classifyIntent, describeCandidate, formatStatus, groupPreferences, learnedReport, metrics, parseLearnCommand, reportDue, shape,
} from '../src/experience.js';

const MIN = 60 * 1000;
const T0 = Date.parse('2026-11-04T08:00:00Z'); // a Wednesday
function clock(start = T0) { const c = { t: start, now: () => c.t, tick: (ms) => { c.t += ms; } }; return c; }

// ------------------------------------------------------------------------------------------------ shapes keep no content
test('a shape keeps the pattern words only: numbers become #, names and everything else _', () => {
  assert.equal(shape('603 - 15 mtr'), '# - # mtr');
  assert.equal(shape('108 available?'), '# available ?');
  assert.equal(shape('Hello Ahmed, 108 available?'), '_ , # available ?');
  assert.equal(shape('Please add 234 - 3 mtr also'), 'please add # - # mtr also');
  assert.equal(shape('هل 408 متوفر؟'), 'هل # متوفر ?');
  assert.equal(shape('۴۱۰ موجوده؟'), '# موجوده ?');
  assert.equal(shape('Master Wood Carpentry'), '_');
  assert.equal(shape('call +971 50 913 3104 or ahmed@example.com https://x.example/a'), '_ # _');
  assert.ok(shape('a very long message '.repeat(20)).length <= 60);
  assert.equal(shape(''), '');
});

test('a shape put through again stays the same', () => {
  for (const x of ['# - # mtr', '_ , # available ?', 'please add # - # mtr also', 'هل # متوفر ?', '_']) assert.equal(shape(x), x, x);
  for (const raw of ['Hello Ahmed, 108 available?', '603 - 15 mtr']) assert.equal(shape(shape(raw)), shape(raw));
});

test('what a message is, and what kind of answer a colleague gave', () => {
  const intents = {
    '108 available?': 'availability', '603 - 15 mtr': 'order', 'Please add 234 - 3 mtr also': 'addon', 'please send the invoice': 'invoice', 'when is the delivery': 'delivery',
    'we paid by cheque': 'payment', 'the roll is damaged': 'complaint', 'thanks a lot': 'thanks', 'what colours do you have?': 'question', 'black glossy': 'other',
    'هل 408 متوفر؟': 'availability', 'کیا 408 دستیاب ہے؟': 'availability', 'فاکتور را بفرستید': 'invoice',
  };
  for (const [text, intent] of Object.entries(intents)) assert.equal(classifyIntent(text), intent, text);
  const answers = { Available: 'yes', 'yes sure': 'yes', 'Sorry not available': 'no', limited: 'limited', '19 meter': 'quantity', 'Kindly send the code': 'ask', 'which one?': 'ask', 'see you tomorrow': 'other', موجود: 'yes', 'محدود است': 'limited' };
  for (const [text, type] of Object.entries(answers)) assert.equal(classifyAnswer(text), type, text);
  assert.equal(classifyAnswer('', { media: true }), 'file');
});

// ------------------------------------------------------------------------------------------------ watching
test('a question and the answer of a colleague: counters, delay, and who answered', () => {
  const c = clock();
  const e = new Experience({ now: c.now });
  e.customer('Bahar', '108 available?');
  c.tick(2 * MIN);
  e.staff('Bahar', 'available');
  assert.equal(e.total('i|availability|en'), 1);
  assert.equal(e.total('a|availability|yes'), 1);
  assert.equal(e.total('ms|Bahar|en'), 1);
  assert.equal(e.total('ml|Bahar|en'), 120);
  assert.equal(e.total('mn|Bahar|en'), 1);
  const [row] = metrics(e);
  assert.deepEqual([row.group, row.lang, row.q, row.staff, row.bot, row.avgSeconds], ['Bahar', 'en', 1, 1, 0, 120]);
  e.staff('Bahar', 'good morning'); // no open question: counts for nothing
  assert.equal(e.total('a|availability|yes'), 1);
});

test('when she answered, the question counts as answered without staff; a correction is counted', () => {
  const c = clock();
  const e = new Experience({ now: c.now });
  e.customer('Bahar', '108 available?');
  c.tick(30 * 1000);
  e.bot('Bahar');
  e.customer('Bahar', '109?');
  c.tick(20 * MIN); // too late to be hers: open for ten minutes only
  e.bot('Bahar');
  e.corrected('Bahar', 'en');
  assert.equal(e.total('mb|Bahar|en'), 1);
  assert.equal(e.total('mc|Bahar|en'), 1);
  const [row] = metrics(e);
  assert.equal(row.bot, 1);
  assert.equal(row.corrected, 1);
});

test('a phrasing she did not understand that a colleague answered becomes a candidate; the same shape again counts up', () => {
  const c = clock();
  const e = new Experience({ now: c.now });
  for (let i = 0; i < 3; i++) {
    e.customer('Bahar', `kindly check black glossy ${i} please`);
    c.tick(MIN);
    e.staff('Bahar', 'yes');
    c.tick(2 * MIN);
  }
  const [cand] = e.review();
  assert.equal(cand.kind, 'phrasing');
  assert.equal(cand.count, 3);
  assert.equal(cand.shape, 'kindly _ # please');
  assert.equal(cand.answerType, 'yes');
  assert.match(describeCandidate(cand), /^1\. عبارت تازه \(انگلیسی، 3 بار\): «kindly _ # please»/);
});

test('what is stored holds no names, numbers, phones, links or message text', () => {
  const c = clock();
  const e = new Experience({ now: c.now });
  e.customer('Bahar', 'Hello Ahmed from Master Wood, call +971 50 913 3104, mail ahmed@example.com, 603 - 15 mtr https://example.com/x');
  c.tick(MIN);
  e.staff('Bahar', 'Sure Ahmed, 15 meter ready, bank account 12345678');
  e.customer('Bahar', 'photo', { media: 'photo' });
  const stored = JSON.stringify(e.weeks) + JSON.stringify(e.candidates) + JSON.stringify([...e.open.values()]);
  for (const secret of ['Ahmed', 'Master Wood', '3104', '913', 'example.com', '12345678', 'bank account', 'Hello', 'ready']) assert.ok(!stored.includes(secret), secret);
});

test('a photo or a voice note is only a label', () => {
  const e = new Experience({ now: clock().now });
  e.customer('G', '', { media: 'photo' });
  e.customer('G', '', { media: 'voice' });
  assert.equal(e.total('i|photo|media'), 1);
  assert.equal(e.total('i|voice|media'), 1);
});

// ------------------------------------------------------------------------------------------------ the review list and the versions
test('corrections come first; approving builds a versioned list that enters the prompt; a rollback steps back', () => {
  const c = clock();
  const e = new Experience({ now: c.now });
  e.candidate({ kind: 'phrasing', shape: '# ?', lang: 'en', answerType: 'ask' });
  e.candidate({ kind: 'phrasing', shape: '# ?', lang: 'en', answerType: 'ask' });
  e.candidate({ kind: 'correction', wrong: 'Available.', right: 'Limited, 19 meter' });
  const [first, second] = e.review();
  assert.deepEqual([first.kind, first.priority, second.kind, second.count], ['correction', 2, 'phrasing', 2]);
  assert.equal(e.promptText(), ''); // nothing approved: nothing changes
  assert.equal(e.decide(99, true), null);
  assert.equal(e.decide(first.id, true).status, 'approved');
  assert.equal(e.version, 1);
  assert.match(e.promptText(), /# Learned from colleagues \(approved by the owner\)\n\n- When you answered "Available\.", a colleague corrected it: "Limited, 19 meter"\./);
  assert.equal(e.decide(second.id, true).status, 'approved');
  assert.equal(e.version, 2);
  assert.match(e.promptText(), /Customers \(en\) sometimes write like "# \?"; colleagues answer with: ask\./);
  assert.equal(e.rollback(), true);
  assert.equal(e.version, 1);
  assert.ok(!e.promptText().includes('sometimes write like'));
  assert.equal(e.rollback(), true);
  assert.equal(e.rollback(), false);
  assert.equal(e.promptText(), '');
  const rejected = e.candidate({ kind: 'phrasing', shape: '_ #', lang: 'ar', answerType: 'yes' });
  assert.equal(e.decide(rejected.id, false).status, 'rejected');
  assert.equal(e.review().some((x) => x.id === rejected.id), false);
  assert.equal(e.version, 0);
});

test('it survives a restart, forgets after ninety days, and obeys the off switch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-'));
  const c = clock();
  const e = new Experience({ dir, now: c.now });
  e.customer('Bahar', '108 available?');
  e.candidate({ kind: 'correction', wrong: 'a', right: 'b' });
  e.decide(1, true);
  e.save();
  const again = new Experience({ dir, now: c.now });
  assert.equal(again.total('i|availability|en'), 1);
  assert.equal(again.version, 1);
  assert.match(again.promptText(), /corrected it/);
  c.tick(100 * 24 * 3600 * 1000);
  again.customer('Bahar', '109?');
  again.purge();
  assert.equal(again.total('i|availability|en', 20), 1); // only the new week is left
  again.on = false;
  again.customer('Bahar', '110?');
  assert.equal(again.total('i|availability|en', 20), 1); // off: nothing new is counted
  const open = new Experience({ now: c.now });
  open.candidate({ kind: 'phrasing', shape: 'x', lang: 'en', answerType: 'yes' });
  c.tick(91 * 24 * 3600 * 1000);
  open.purge();
  assert.equal(open.review().length, 0); // an old open suggestion expires
});

test('the counters stay small', () => {
  const e = new Experience({ now: clock().now });
  for (let i = 0; i < 3300; i++) e.bump(`k|${i}`);
  assert.ok(Object.values(e.weeks).every((w) => Object.keys(w).length <= 3000));
});

// ------------------------------------------------------------------------------------------------ what the owner reads
test('the weekly report: counts, languages, answers, quality per group and language, slow spots, suggestions, errors, habits', () => {
  const c = clock();
  const e = new Experience({ now: c.now });
  for (let i = 0; i < 4; i++) {
    e.customer('Bahar', `${400 + i} available?`);
    c.tick(45 * MIN);
    e.staff('Bahar', 'available');
    c.tick(MIN);
  }
  e.customer('Master Wood', '603 - 15 mtr');
  c.tick(MIN);
  e.bot('Master Wood');
  e.customer('Master Wood', 'هل الكود 408 متوفر؟');
  e.candidate({ kind: 'correction', wrong: 'Available.', right: 'Limited' });
  const t = learnedReport(e, { errors: { 'price-below': 3, 'line-total': 1 } });
  assert.match(t, /^گزارش «چه یاد گرفتم» این هفته\nپیام‌های مشتری دیده‌شده: 6/);
  assert.match(t, /- پرسش موجودی: 5/);
  assert.match(t, /- سفارش: 1/);
  assert.match(t, /زبان‌ها: .*انگلیسی 5.*عربی 1/);
  assert.match(t, /پاسخ همکاران:\n- پرسش موجودی: بله \/ موجود 4 بار/);
  assert.match(t, /Bahar \(انگلیسی\): 4 پرسش، بدون کمک همکار 0 درصد، اصلاح‌شده 0 درصد، میانگین زمان پاسخ 45 دقیقه/);
  assert.match(t, /Master Wood \(انگلیسی\): 1 پرسش، بدون کمک همکار 100 درصد/);
  assert.match(t, /جاهای کند: Bahar \(45 دقیقه\)/);
  assert.match(t, /پیشنهادهای در انتظار بررسی شما:\n1\. اصلاح همکار \(اولویت بالا\)/);
  assert.match(t, /پاسخ: «بپذیر ۳» یا «رد ۳»/);
  assert.match(t, /ایرادهای تکراری فاکتور: price-below 3، line-total 1/);
  assert.match(t, /عادت هر گروه.*\n- Bahar: زبان انگلیسی/s);
  assert.match(learnedReport(new Experience({ now: c.now })), /این هفته چیزی دیده نشد/);
});

test('the habits of a group: language, unit, usual codes', () => {
  const e = new Experience({ now: clock().now });
  for (const t of ['603 - 15 mtr', '603 - 10 mtr', '201 - 5 mtr', 'ok']) e.customer('Bahar', t);
  const [line] = groupPreferences(e);
  assert.equal(line, '- Bahar: زبان انگلیسی، واحد m، کدهای رایج 603 و 201');
});

test('the owner\'s commands and the weekly timing', () => {
  assert.deepEqual(parseLearnCommand('یادگیری'), { type: 'status' });
  assert.deepEqual(parseLearnCommand('یادگیری خاموش'), { type: 'off' });
  assert.deepEqual(parseLearnCommand('یادگیری روشن'), { type: 'on' });
  assert.deepEqual(parseLearnCommand('بپذیر ۳'), { type: 'approve', id: 3 });
  assert.deepEqual(parseLearnCommand('رد 12'), { type: 'reject', id: 12 });
  assert.deepEqual(parseLearnCommand('پیشنهادهای یادگیری'), { type: 'list' });
  assert.deepEqual(parseLearnCommand('بازگشت یادگیری'), { type: 'rollback' });
  assert.deepEqual(parseLearnCommand('گزارش یادگیری'), { type: 'report' });
  assert.equal(parseLearnCommand('بپذیر'), null);
  assert.equal(parseLearnCommand('سلام'), null);
  const mon = Date.parse('2026-11-02T14:30:00Z'); // Monday 18:30 in Dubai
  assert.equal(reportDue({ now: mon, timeZone: 'Asia/Dubai', weekday: 1, hour: 18, last: '' }), '2026-11-02');
  assert.equal(reportDue({ now: mon, timeZone: 'Asia/Dubai', weekday: 1, hour: 18, last: '2026-11-02' }), null);
  assert.equal(reportDue({ now: Date.parse('2026-11-02T13:00:00Z'), timeZone: 'Asia/Dubai', weekday: 1, hour: 18, last: '' }), null); // 17:00
  assert.equal(reportDue({ now: Date.parse('2026-11-03T14:30:00Z'), timeZone: 'Asia/Dubai', weekday: 1, hour: 18, last: '' }), null); // Tuesday
  const e = new Experience({ now: clock().now });
  e.candidate({ kind: 'correction', wrong: 'a', right: 'b' });
  assert.match(formatStatus(e), /^یادگیری: روشن\nپیام‌های مشتری دیده‌شده \(تا ۹۰ روز\): 0\nپیشنهادهای در انتظار: 1\nنسخهٔ تأییدشده: 0 از 0$/);
});

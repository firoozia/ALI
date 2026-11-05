import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ShadowDesk, ShadowStore, cardText, compareAnswers, dayLine, followUpText, looksLikeRequest, mask, parseCardCorrection, parseShadowCommand, weekSummary } from '../src/shadow.js';
import { guardedSend, shadowGroup } from '../src/guard.js';

const T0 = Date.parse('2026-11-05T06:00:00Z');
const cfg = { timezone: 'Asia/Dubai', shadowMergeMs: 120000, shadowCardCap: 3, shadowDailyCalls: 5, shadowCompareMinutes: 60 };

function make(analyzeImpl, extra = {}) {
  const posts = [];
  let clock = T0;
  const timers = [];
  const desk = new ShadowDesk({
    store: new ShadowStore(), post: async (t) => { posts.push(t); }, config: { ...cfg, ...extra },
    analyze: analyzeImpl || (async () => ({ action: 'answer', reply: 'Yes, available', lang: 'en', calls: 1 })),
    setTimer: (fn) => { timers.push(fn); return timers.length - 1; }, clearTimer: (i) => { timers[i] = null; }, now: () => clock,
  });
  const fire = async () => { for (const [i, fn] of timers.entries()) if (fn) { timers[i] = null; await fn(); } };
  return { desk, posts, fire, tick: (ms) => { clock += ms; } };
}
const cust = (text, at = T0, extra = {}) => ({ groupId: 'g1', subject: 'Master Wood - ARYAK', label: 'Master Wood', staff: false, fromMe: false, text, at, ...extra });
const staff = (text, at = T0 + 30000) => ({ groupId: 'g1', subject: 'Master Wood - ARYAK', label: 'Master Wood', staff: true, fromMe: false, text, at });

test('a real request makes one numbered English card with the proposed reply in the customer language; chit-chat makes none', async () => {
  const { desk, posts, fire } = make(async () => ({ action: 'answer', reply: 'موجود است.', lang: 'fa', calls: 1, customer: 'Master Wood' }));
  desk.onMessage(cust('hello'));
  await fire();
  assert.deepEqual(posts, []); // a greeting: no card
  desk.onMessage(cust('508 موجود است؟'));
  await fire();
  assert.equal(posts.length, 1);
  assert.match(posts[0], /^#1 Master Wood\nCustomer: 508 موجود است؟\nAction: would answer\nReply \(fa\): موجود است\./);
  assert.equal(looksLikeRequest('thank you'), false);
  assert.equal(looksLikeRequest('603 - 15 mtr'), true);
});

test('messages of one sender within the merge window are one question (one card)', async () => {
  const { desk, posts, fire } = make();
  desk.onMessage(cust('509'));
  desk.onMessage(cust('229', T0 + 5000));
  desk.onMessage(cust('Available?', T0 + 9000));
  await fire();
  assert.equal(posts.length, 1);
  assert.match(posts[0], /Customer: 509 \/ 229 \/ Available\?/);
});

test('no phone numbers, bank digits or prices in a card', () => {
  const c = { id: 7, group: 'A', customer: '', text: mask('call +971 50 123 4567 about 408 at 12.50 AED, IBAN 1234567890123'), action: 'answer', reply: 'Price is 9 AED per metre', lang: 'en' };
  const text = cardText(c);
  assert.ok(!/971|1234567|12\.50|9 AED/.test(text), text);
});

test('the daily card cap and the daily model budget', async () => {
  const { desk, posts, fire } = make();
  for (let i = 0; i < 5; i++) { desk.onMessage(cust(`50${i} available?`)); await fire(); }
  assert.equal(posts.length, 3); // cap 3
  assert.equal(desk.store.day('2026-11-05').capHit, 2);
  const budget = make(null, { shadowCardCap: 50, shadowDailyCalls: 2 });
  for (let i = 0; i < 4; i++) { budget.desk.onMessage(cust(`50${i} available?`)); await budget.fire(); }
  assert.deepEqual(budget.posts.map((p) => /not analysed/.test(p)), [false, false, true, true]); // the 3rd and 4th are not analysed
});

test('staff answered first: a card that she would stay silent, and no model call', async () => {
  let called = 0;
  const { desk, posts } = make(async () => { called++; return { action: 'answer', reply: 'x', calls: 1 }; });
  desk.onMessage(cust('508 available?'));
  desk.onMessage(staff('yes available', T0 + 30000));
  assert.equal(called, 0);
  assert.equal(posts.length, 1);
  assert.match(posts[0], /Action: would stay silent because staff already answered/);
  assert.match(posts[0], /Staff said: yes available/);
});

test('staff answer after her card: same, different, unknown, and whether she would have been faster', async () => {
  const same = make(async () => ({ action: 'answer', reply: 'Yes, available', lang: 'en', calls: 1 }));
  same.desk.onMessage(cust('508 available?'));
  await same.fire();
  same.tick(14 * 60000);
  same.desk.onMessage(staff('yes available', T0 + 14 * 60000));
  assert.match(same.posts[1], /^#1 staff said: yes available — same; she would have been faster by 14 min$/);
  const diff = make(async () => ({ action: 'answer', reply: 'Yes, available', lang: 'en', calls: 1 }));
  diff.desk.onMessage(cust('508 available?'));
  await diff.fire();
  diff.tick(5 * 60000);
  diff.desk.onMessage(staff('sorry not available', T0 + 5 * 60000));
  assert.match(diff.posts[1], /— different;/);
  const late = make();
  late.desk.onMessage(cust('508 available?'));
  await late.fire();
  late.tick(90 * 60000); // outside the 60 minute window
  late.desk.onMessage(staff('yes', T0 + 90 * 60000));
  assert.equal(late.posts.length, 1);
  assert.equal(compareAnswers('Yes, available', 'we will see tomorrow'), 'unknown');
  assert.equal(compareAnswers('نعم متوفر', 'not available'), 'different');
  assert.equal(compareAnswers('Yes, but limited', '40 m available'), 'same');
});

test('the daily line and the week summary carry the owner\'s decision data per group and language', async () => {
  const { desk, fire, tick } = make();
  desk.onMessage(cust('508 available?'));
  await fire();
  tick(10 * 60000);
  desk.onMessage(staff('yes available', T0 + 10 * 60000));
  desk.onMessage(cust('509 available?', T0 + 20 * 60000));
  desk.onMessage(staff('no', T0 + 20 * 60000 + 30000));
  const line = dayLine(desk.store, '2026-11-05', 60, T0 + 5 * 3600000);
  assert.match(line, /Shadow 2026-11-05: 2 questions, 1 agreed, 0 differed, 1 unknown, 0 not answered by staff, staff average \d+ min/);
  const week = weekSummary(desk.store, '2026-11-05', T0 + 5 * 3600000);
  assert.match(week, /^Shadow week \(1 day\): 2 questions, 1 agreed/);
  assert.match(week, /- Master Wood \(en\): 1 questions, 1 agreed, 0 differed/);
  assert.match(followUpText({ id: 3, at: T0, staffAt: T0 - 1000, staffText: 'x', verdict: 'same' }), /staff were first/);
});

test('a photo or voice note is "not read" while shadow media is off', async () => {
  const { desk, posts, fire } = make(async ({ messages }) => ({ action: 'media', note: 'photo not read (shadow media is off)', calls: 0 }));
  desk.onMessage(cust('', T0, { hasImage: true }));
  await fire();
  assert.match(posts[0], /Action: not read\nphoto not read \(shadow media is off\)/);
});

test('the owner commands and the card correction', () => {
  assert.deepEqual(parseShadowCommand('سایه وضعیت'), { type: 'status' });
  assert.deepEqual(parseShadowCommand('سایه  خاموش'), { type: 'off' });
  assert.deepEqual(parseShadowCommand('سایه روشن'), { type: 'on' });
  assert.equal(parseShadowCommand('سایه'), null);
  assert.deepEqual(parseCardCorrection('#12 wrong: it is 40 m not 30'), { id: 12, right: 'it is 40 m not 30' });
  assert.deepEqual(parseCardCorrection('#3 غلط: باید بپرسی'), { id: 3, right: 'باید بپرسی' });
  assert.equal(parseCardCorrection('12 wrong'), null);
});

test('the shadow groups: customer groups only, internal and configured ones excluded; off when the list is empty', () => {
  const c = { shadowGroupNames: ['aryak'], staffGroupNames: ['aryak staff'], testGroupNames: ['test aryak bot'], cutGroupName: 'aryak orders pictures', observeExcludeNames: ['aryak accounting'] };
  for (const g of ['Master Wood - ARYAK', 'Bahar ARYAK']) assert.equal(shadowGroup(g, c), true, g);
  for (const g of ['TEST ARYAK BOT', 'Aryak Staff', 'Aryak Orders Pictures', 'Aryak Accounting', 'Family']) assert.equal(shadowGroup(g, c), false, g);
  assert.equal(shadowGroup('Master Wood - ARYAK', { ...c, shadowGroupNames: [] }), false);
});

// NOTHING can reach a customer group, the sales manager or a private chat from shadow mode.
test('shadow mode writes only to the test group: the guard, the card post, and no other send in the shadow code', async () => {
  const sent = [];
  const names = new Map([['c@g.us', 'Master Wood - ARYAK'], ['t@g.us', 'TEST ARYAK BOT']]);
  const send = guardedSend({
    rawSend: async (jid, content) => { sent.push(jid); return { key: { id: 'x' } }; },
    config: { testGroupNames: ['test aryak bot'], staffNumbers: ['971500000001'], salesManager: '971500000003@s.whatsapp.net', observeGroupNames: [], shadowGroupNames: ['aryak'] },
    isGroup: (j) => j.endsWith('@g.us'), known: new Set(), subjectOf: async (j) => names.get(j),
  });
  await send('c@g.us', { text: 'would be the reply' }); // a customer group
  await send('t@g.us', { text: 'card' }); // the test group
  assert.deepEqual(sent, ['t@g.us']);
  // the source: the shadow analysis captures what the real flow would send and sends nothing; the card post is the only way out
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const block = src.slice(src.indexOf('async function shadowAnalyze'), src.indexOf('const shadowDesk = new ShadowDesk'));
  assert.ok(!/sock\.sendMessage/.test(block), 'the analysis must not send');
  assert.match(block, /send: async \(gid, text\) => \{ sends\.push\(text\); \}/); // availability answers and questions are captured
  assert.match(block, /notifyManager: async \(req\) => \{.*return null; \}/); // the sales manager gets nothing
  assert.match(block, /for \(const r of \[\.\.\.shadowAvail\.open\.values\(\)\]\) shadowAvail\.close\(r\.id\)/); // the pending question is closed
  const intake = src.slice(src.indexOf('async function shadowIntake'), src.indexOf('// The daily line at the summary hour'));
  assert.ok(!/sock\.sendMessage/.test(intake));
  const shadowModule = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'shadow.js'), 'utf8');
  assert.ok(!/sendMessage|sock\b/.test(shadowModule), 'the shadow module has no way to send except post');
});

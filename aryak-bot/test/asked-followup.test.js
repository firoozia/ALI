import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ShadowDesk, ShadowStore, askedBack, cardText, dayLine, staffAnswered, weekSummary } from '../src/shadow.js';
import { codesIn, followUpHint, withFollowUp } from '../src/followup.js';

// Invented names only: the real customer names never go into the repository.
const T0 = Date.parse('2026-11-05T06:00:00Z');
const DAY = '2026-11-05';
const make = (analyze) => {
  const posts = [];
  let clock = T0;
  const timers = [];
  const desk = new ShadowDesk({
    store: new ShadowStore(), post: async (t) => { posts.push(t); }, config: { timezone: 'Asia/Dubai', shadowMergeMs: 120000, shadowCardCap: 10, shadowDailyCalls: 50, shadowCompareMinutes: 60 },
    analyze, setTimer: (fn) => { timers.push(fn); return timers.length - 1; }, clearTimer: (i) => { timers[i] = null; }, now: () => clock,
  });
  const fire = async () => { for (const [i, fn] of timers.entries()) if (fn) { timers[i] = null; await fn(); } await desk.idle(); };
  const ask = async (text, staffText) => {
    for (const [i, t] of [].concat(text).entries()) desk.onMessage({ groupId: 'g1', subject: 'Cedar - ARYAK', label: 'Cedar', staff: false, fromMe: false, text: t, at: T0 + i * 3000 });
    await fire();
    clock = T0 + 30000;
    if (staffText) desk.onMessage({ groupId: 'g1', subject: 'Cedar - ARYAK', label: 'Cedar', staff: true, fromMe: false, text: staffText, at: clock });
    await desk.idle();
  };
  return { desk, posts, ask };
};

test('card 18 shape: she asks for the code, staff gives the stock: "she asked, staff answered", not same', async () => {
  const { desk, posts, ask } = make(async () => ({ action: 'answer', reply: 'Please send me the code and the metres you need.', lang: 'en', calls: 0 }));
  await ask(['404 available?', 'how much meters you have'], 'We have arround 600 meter');
  assert.match(posts.join('\n'), /[Ss]taff said: We have arround 600 meter — she asked, staff answered/);
  assert.ok(!/— same/.test(posts.join('\n')));
  const d = desk.store.day(DAY);
  assert.deepEqual([d.agreed, d.differed, d.asked], [0, 0, 1]);
  assert.equal(desk.store.d.cards[0].verdict, 'asked');
});

test('card 17 shape: she asks the quantity, staff says yes: asked, not same; the line shows the new count apart', async () => {
  const { desk, posts, ask } = make(async () => ({ action: 'ask-quantity', reply: '404: how many metres do you need?', lang: 'en', stance: 'yes', calls: 0 }));
  await ask('404 Available', 'yes');
  assert.match(posts.join('\n'), /[Ss]taff said: yes — she asked, staff answered/);
  const line = dayLine(desk.store, DAY, 60, T0 + 3600000);
  assert.match(line, /1 questions, 0 agreed, 0 differed, 1 she asked and staff answered, 0 unknown/);
  assert.match(weekSummary(desk.store, DAY, T0 + 3600000), /0 agreed, 0 differed, 1 she asked and staff answered/);
});

test('same still means the same stance on the same code; a sheet that contradicts staff is still different; nothing said stays unknown', async () => {
  const same = make(async () => ({ action: 'answer', reply: '404: available.', lang: 'en', stance: 'yes', stances: { 404: 'yes' }, calls: 0 }));
  await same.ask('404 available?', '404 yes');
  assert.match(same.posts.join('\n'), /— same/);
  const differ = make(async () => ({ action: 'ask-quantity', reply: '404: how many metres do you need?', lang: 'en', stance: 'yes', stances: { 404: 'yes' }, calls: 0 }));
  await differ.ask('404 available?', '404 no');
  assert.match(differ.posts.join('\n'), /— different/); // she asked, but the sheet says yes and staff said no: the owner must see it
  const silent = make(async () => ({ action: 'answer', reply: 'Please send me the code.', lang: 'en', calls: 0 }));
  await silent.ask(['404 available?', 'how much meters you have'], 'will check');
  assert.ok(!/she asked, staff answered|— same|— different/.test(silent.posts.join('\n'))); // staff gave no answer: nothing is claimed
  assert.equal(silent.desk.store.d.cards[0].verdict, 'unknown');
});

test('what counts as asking back and as an answer', () => {
  assert.equal(askedBack({ action: 'ask-quantity', reply: '' }), true);
  assert.equal(askedBack({ action: 'answer', reply: 'Please send me the code and the metres you need.' }), true);
  assert.equal(askedBack({ action: 'answer', reply: 'Which code do you mean?' }), true);
  assert.equal(askedBack({ action: 'answer', reply: '404: available.' }), false);
  assert.equal(staffAnswered(['yes']), true);
  assert.equal(staffAnswered(['no']), true);
  assert.equal(staffAnswered(['We have arround 600 meter']), true);
  assert.equal(staffAnswered(['will check']), false);
  assert.ok(cardText({ id: 1, group: 'g', text: 'x', action: 'answer', staffText: 'yes', staffFirst: true, verdict: 'asked' }).includes('— she asked, staff answered'));
});

test('a follow-up with no code gets the group\'s recent code as context: one code = that code, several = ask which, none = nothing', () => {
  assert.deepEqual(codesIn('404 available? and 407 too'), ['404', '407']);
  assert.deepEqual(codesIn('how much meters you have'), []);
  const one = followUpHint('how much meters you have', ['404']);
  assert.ok(one.includes('code being discussed a moment ago is 404') && one.includes('about code 404'));
  const several = followUpHint('how much meters you have', ['404', '407', '404']);
  assert.ok(several.includes('404, 407') && several.includes('ask which one'));
  assert.equal(followUpHint('how much meters you have', []), '');
  assert.equal(followUpHint('404 how much meters you have', ['407']), ''); // it names its own code
  assert.equal(followUpHint('thank you', ['404']), ''); // not a question of quantity or availability
  assert.equal(followUpHint('چقدر دارید', ['404']).includes('404'), true);
  assert.equal(followUpHint('x'.repeat(200) + ' how much', ['404']), '');
});

test('in a batch, a code written earlier counts as recent; only the follow-up message carries the context', () => {
  const messages = [{ text: '404 available?', sender: 'a' }, { text: 'how much meters you have', sender: 'a' }, { text: 'ok', sender: 'a' }];
  const out = withFollowUp(messages, []);
  assert.equal(out[0].text, '404 available?');
  assert.ok(out[1].text.startsWith('how much meters you have\n[Context from this group') && out[1].text.includes('404'));
  assert.equal(out[2].text, 'ok');
  assert.equal(messages[1].text, 'how much meters you have'); // the originals are untouched
  const two = withFollowUp([{ text: 'how many left' }], ['404', '407']);
  assert.ok(two[0].text.includes('ask which one'));
});

test('the wiring: the shadow and the real customer flow both carry the context, and the real flow remembers its codes; no rule about stock changed', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /messages: withFollowUp\(withText, recentCodeList\(groupId\)\)/); // shadow
  assert.match(src, /const forModel = withFollowUp\(messages, recentCodeList\(groupId\)\);\n\s*for \(const m of messages\) if \(m\.text\) rememberCodes\(groupId, m\.text\);/); // real flow
  assert.match(src, /transcript, messages: forModel, images/);
  const lib = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'followup.js'), 'utf8');
  assert.ok(!/fetchStock|checkStock|sendMessage|^import /m.test(lib.replace(/\/\/.*$/gm, ''))); // context only: no stock lookup, nothing sent, no import
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseOnBehalf } from '../src/onbehalf.js';
import { Aliases, parseAliasCommand } from '../src/aliases.js';
import { Tracker, dueNags, openOrders } from '../src/tracker.js';
import { Experience, importPatterns, describeCandidate, parseLearnCommand } from '../src/experience.js';

const L = (code, quantity, unit = 'm', addOn = false) => ({ code, quantity, unit, addOn });

// Fixtures: how colleagues post a customer's request (names changed).
test('a colleague posts a request for a customer: the name in front, a name above, "for", several lines', () => {
  const cases = [
    ['Bahar: 408 - 15 mtr', 'bahar', [L('408', 15)]],
    ['Master Wood 603 - 15 mtr', 'master wood', [L('603', 15)]],
    ['for Bahar 229 20 m', 'bahar', [L('229', 20)]],
    ['For Dandy Door: 119-6 MTR', 'dandy door', [L('119', 6)]],
    ['Bahar:\n603 - 15 mtr\n201 - 15 mtr', 'bahar', [L('603', 15), L('201', 15)]],
    ['Bahar\n701 25 meter', 'bahar', [L('701', 25)]],
    ['Bahar: 603 - 15 mtr\nPlease add 234 - 3 mtr also', 'bahar', [L('603', 15), L('234', 3, 'm', true)]],
    ['برای بهار: ۴۰۸ - ۱۵ mtr', 'بهار', [L('408', 15)]],
    ['Bahar 305 : 2 rolls', 'bahar', [L('305', 2, 'roll')]],
    ['please order for Master Wood KG10-300 - 5 m', 'master wood', [L('KG10-300', 5)]],
  ];
  for (const [text, customer, lines] of cases) {
    const r = parseOnBehalf(text);
    assert.ok(r, text);
    assert.equal(r.customer.toLowerCase(), customer, text);
    assert.deepEqual(r.lines, lines, text);
  }
});

test('not a request on behalf: no customer, no quantity, or something else', () => {
  for (const text of ['603 - 15 mtr', 'Please add 234 - 3 mtr also', '408 available?', 'Bahar is waiting', 'Bahar: call me', 'hello 603 - 15 mtr', 'ok 229 20 m', '', 'send the invoice to Bahar']) {
    assert.equal(parseOnBehalf(text), null, text);
  }
});

// ------------------------------------------------------------------------------------------------ names
test('one customer, many spellings: the owner adds other names; known group labels and short names match too', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-'));
  const a = new Aliases(dir);
  assert.equal(a.resolve('Master Wood Carpentry LLC', ['Master Wood']), 'Master Wood'); // the group's label
  assert.equal(a.resolve('master wood', ['Master Wood']), 'Master Wood');
  assert.equal(a.resolve('Someone Else', ['Master Wood']), 'Someone Else');
  assert.equal(a.add('Master Wood', 'ماستر وود'), true);
  assert.equal(a.add('Master Wood', 'MW Carpentry'), true);
  assert.equal(a.add('Master Wood', 'mw carpentry'), true); // the same name again: not doubled
  assert.equal(a.resolve('ماستر وود', ['Bahar']), 'Master Wood');
  assert.equal(a.resolve('MW carpentry llc', []), 'Master Wood');
  assert.deepEqual(a.map['Master Wood'], ['ماستر وود', 'MW Carpentry']);
  assert.equal(a.resolve('Mas', ['Master Wood']), 'Mas'); // too short to be taken for him
  assert.equal(new Aliases(dir).resolve('ماستر وود'), 'Master Wood'); // survives a restart
  assert.match(a.list(), /Master Wood = ماستر وود، MW Carpentry/);
  assert.match(new Aliases('').list(), /نام دیگری ثبت نشده/);
  assert.equal(a.add('', 'x'), false);
});

test('the owner\'s command for another name', () => {
  assert.deepEqual(parseAliasCommand('اسم دیگر Master Wood = ماستر وود'), { customer: 'Master Wood', alias: 'ماستر وود' });
  assert.deepEqual(parseAliasCommand('نام دیگر بهار = Bahar Design'), { customer: 'بهار', alias: 'Bahar Design' });
  assert.deepEqual(parseAliasCommand('اسم‌های دیگر'), { list: true });
  assert.equal(parseAliasCommand('اسم دیگر بدون مساوی'), null);
  assert.equal(parseAliasCommand('سلام'), null);
});

// ------------------------------------------------------------------------------------------------ the tracker knows these orders
test('an order posted by a colleague is an order: it is listed and, without an invoice after a day, reminded about once', () => {
  const t = new Tracker();
  const now = Date.parse('2026-11-05T08:00:00Z');
  t.add({ type: 'order', at: now - 30 * 3600000, customer: 'Bahar', lines: [], ref: 'o1' });
  assert.match(openOrders(t, []), /Bahar: برش نه، فاکتور نه، تحویل نه، پرداخت نه/);
  assert.deepEqual(dueNags(t, [], { now }), ['سفارش Bahar هنوز فاکتور ندارد.']);
  assert.deepEqual(dueNags(t, [], { now }), []);
  t.add({ type: 'invoice', at: now - 3600000, customer: 'Bahar Design', number: 'INV-1', lines: [], ref: 'i1' });
  assert.match(openOrders(t, []), /فاکتور بله/);
});

// ------------------------------------------------------------------------------------------------ the import
const file = () => ({
  version: 1, source: 'review', createdAt: '2026-11-05',
  phrasings: [
    { lang: 'en', shape: 'kindly _ please', answerType: 'yes', count: 8 },
    { lang: 'en', shape: 'call Ahmed on 0501234567 about 408', answerType: 'yes', count: 2 }, // a number and a name slip in: cut down to a shape
    { lang: 'xx', shape: '# available ?', answerType: 'yes' }, // wrong language
    { lang: 'en', shape: '_ #', answerType: 'yes' }, // no pattern left
    { lang: 'en', shape: '# available ?', answerType: 'maybe' }, // wrong answer type
  ],
  routing: [{ trigger: '# - # mtr', to: 'Aryak Orders Pictures!!', count: 40 }, { trigger: '', to: 'x' }],
  answerShapes: [{ intent: 'availability', lang: 'ar', answerType: 'limited', count: 10 }, { intent: 'nonsense', lang: 'ar', answerType: 'yes' }],
  aliasSuggestions: [
    { customer: 'Master Wood', aliases: ['Master Wood Carpentry', 'ماستر وود'], approvedByOwner: true },
    { customer: 'Not Approved Co', aliases: ['NA'], approvedByOwner: false },
  ],
});

test('an outside pattern file goes to the review list only, cleaned, with what was skipped counted', () => {
  const e = new Experience({ now: () => Date.parse('2026-11-05T08:00:00Z') });
  const r = importPatterns(e, file());
  // the line with a name and a phone is cut down to "_ # _ #", which holds no pattern: skipped, like the wrong language, the empty
  // shape, the wrong answer type, the empty route, the wrong intent and the alias the owner did not approve
  assert.deepEqual(r, { phrasings: 1, routing: 1, patterns: 1, aliases: 2, skipped: 7 });
  const kinds = e.candidates.map((c) => c.kind);
  assert.deepEqual(kinds, ['phrasing', 'routing', 'pattern', 'alias', 'alias']);
  const stored = JSON.stringify(e.candidates);
  for (const secret of ['Ahmed', '0501234567', '408', 'Not Approved']) assert.ok(!stored.includes(secret), secret);
  assert.equal(e.candidates[0].shape, 'kindly _ please');
  assert.equal(e.candidates[1].to, 'Aryak Orders Pictures'); // punctuation cut from a group name
  assert.equal(e.version, 0); // nothing applied
  assert.equal(e.promptText(), '');
  assert.ok(e.candidates.every((c) => c.status === 'open' && c.imported));
  assert.equal(importPatterns(e, { version: 2 }).error, 'unsupported file');
  assert.equal(importPatterns(e, null).error, 'unsupported file');
});

test('approving imported entries puts routing and answer patterns into the prompt; an alias is carried by the owner\'s command', () => {
  const e = new Experience({ now: () => Date.parse('2026-11-05T08:00:00Z') });
  importPatterns(e, file());
  const byKind = (k) => e.candidates.find((c) => c.kind === k);
  e.decide(byKind('routing').id, true);
  e.decide(byKind('pattern').id, true);
  const alias = e.decide(byKind('alias').id, true);
  assert.deepEqual([alias.customer, alias.alias], ['Master Wood', 'Master Wood Carpentry']);
  const prompt = e.promptText();
  assert.match(prompt, /A request that looks like "# - # mtr" is usually posted in the group "Aryak Orders Pictures"\./);
  assert.match(prompt, /In ar, a availability message is usually answered with: limited\./);
  assert.ok(!prompt.includes('Master Wood')); // an alias is not a prompt line
  assert.match(describeCandidate(byKind('routing') || e.candidates[2]), /^2\. مسیر پیام \(40 بار\)، از فایل بیرونی: «# - # mtr» ⟵ گروه «Aryak Orders Pictures»/);
  assert.match(describeCandidate(e.candidates.find((c) => c.kind === 'alias')), /نام دیگر مشتری \(از فایل بیرونی\): Master Wood = Master Wood Carpentry/);
  assert.deepEqual(parseLearnCommand('بارگذاری الگوها'), { type: 'import' });
});

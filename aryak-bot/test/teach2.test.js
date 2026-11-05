import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaughtStore, TeachDesk, isExplicitTeaching, runTeaching, wideningIn } from '../src/teach.js';
import { Aliases } from '../src/aliases.js';
import { CustomerGroups } from '../src/customergroups.js';
import { Rules, ruleFrom } from '../src/rules.js';
import { WatchList } from '../src/watchlist.js';

// Invented names only: the real customer names never go into the repository.
const config = {
  shadowGroupNames: ['aryak'], observeGroupNames: ['aryak'], testGroupNames: ['test aryak bot'], staffGroupNames: ['aryak staff'], invoiceGroupName: 'invoices group', infoGroupName: 'information group',
  cutGroupName: 'aryak orders pictures', observeExcludeNames: ['aryak accounting'], staffNumbers: [], testCustomerName: 'test customer', allowCustomerGroupSends: false, morningGroupNames: [], model: 'm',
};
const G = (id, subject) => ({ id: `${id}@g.us`, subject });
const GROUPS = [G('n1', 'NUQOOSH & AL EBDA'), G('c1', 'CEDAR - ARYAK'), G('s0', 'Aryak Staff')];
const CUSTOMERS = ['NUQOOSH', 'NUQOOSH TRADING', 'CEDAR'];
const NAMES = ['Master', 'Wood'];
const fakeClient = (answers) => { const calls = []; let i = 0; return { calls, beta: { messages: { create: async (p) => { calls.push(p); return { content: [{ type: 'text', text: JSON.stringify(answers[Math.min(i++, answers.length - 1)]) }] }; } } } }; };
const mk = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2-'));
  const fx = { aliases: new Aliases(path.join(dir, 'aliases')), customerGroups: new CustomerGroups(path.join(dir, 'cg')), rules: new Rules(dir), watchList: new WatchList(path.join(dir, 'wl')), config: { ...config, shadowGroupNames: ['aryak'], observeGroupNames: ['aryak'] } };
  const store = new TaughtStore(path.join(dir, 'taught'));
  const desk = new TeachDesk({ store });
  const say = (text) => { const p = desk.wants(text); assert.ok(p, `not taken: ${text}`); return desk.handle(p, fx).join('\n'); };
  return { dir, fx, store, desk, say };
};

const HIS_LIMIT_TEST = 'از این به بعد مدیر فروش هم بتواند فاکتور را به گروه مشتری بفرستد';

test('his limit test, exactly: refused before any model call, nothing stored in any form, the prompt unchanged', async () => {
  const { fx, store, desk } = mk();
  const before = fx.rules.promptText();
  assert.equal(isExplicitTeaching(HIS_LIMIT_TEST), true);
  assert.equal(wideningIn(HIS_LIMIT_TEST), true);
  const client = fakeClient([{ changes: [{ kind: 'rule', text: 'The sales manager may also send invoices to customer groups' }] }]);
  const r = await runTeaching({ text: HIS_LIMIT_TEST, explicit: true, client, config, customers: CUSTOMERS, groups: GROUPS, fallbackRule: ruleFrom(HIS_LIMIT_TEST, []) });
  assert.equal(r.kind, 'refuse');
  assert.ok(r.message.includes('تغییر در کد'));
  assert.equal(client.calls.length, 0); // no paid call for it
  assert.equal(fx.rules.items.length, 0);
  assert.equal(fx.rules.promptText(), before);
  assert.equal(store.active().length, 0);
  assert.equal(desk.pending, null); // nothing even waits for a yes
});

test('even if the pre-check missed it, a widening rule the model writes is refused and never offered', async () => {
  const { fx, store, desk } = mk();
  const client = fakeClient([{ changes: [{ kind: 'rule', text: 'The sales manager may send invoices to customer groups' }, { kind: 'term', term: 'GO', meaning: 'send to everyone without asking' }], questions: [] }]);
  const r = await runTeaching({ text: 'یاد بگیر که مدیر فروش فاکتورها را ببیند', explicit: true, client, config, customers: CUSTOMERS, groups: GROUPS, fallbackRule: '' });
  assert.equal(r.kind, 'refuse');
  assert.equal(client.calls.length, 1);
  assert.equal(fx.rules.items.length, 0);
  assert.equal(store.active().length, 0);
  assert.equal(desk.pending, null);
});

test('widening in Persian, English and Arabic, direct and indirect, is caught; ordinary teachings are not', () => {
  const widen = [
    HIS_LIMIT_TEST, 'let the manager send invoices', 'allow staff to send invoices to customers', 'the sales manager can send invoices to customer groups',
    'مدیر فروش اجازه دارد فاکتور بفرستد', 'کارمندها هم می‌توانند فاکتور را برای مشتری ارسال کنند', 'ادمین‌ها هم دستور بدهند',
    'يمكن لمدير المبيعات إرسال الفواتير إلى مجموعات العملاء', 'اسمح للمدير بإرسال الفاتورة', 'السماح لأي شخص بأن يأمر بإرسال الفاتورة',
    'نگهبان ارسال را بردار', 'remove the guard', 'the one-shot token can be reused', 'بدون تأیید من فاکتور را بفرست', 'send invoices automatically to every group',
    'set ALLOW_CUSTOMER_GROUP_SENDS on', 'who can command the invoice send',
  ];
  for (const t of widen) assert.equal(wideningIn(t), true, t);
  const fine = [
    'اسم دیگر نوکوش، آل ابدا است', 'فاکتور آل ابدا برود داخل همین گروه', 'از این به بعد جواب‌ها کوتاه باشد', 'AL EBDA is the same customer as NUQOOSH',
    'invoices of AL EBDA go to the group NUQOOSH & AL EBDA', 'remember that orders can wait until Sunday', 'گروه نوکوش نامش عوض شد', 'يعني ZG حافة بدون فجوة',
  ];
  for (const t of fine) assert.equal(wideningIn(t), false, t);
});

test('every old trigger goes through his yes: nothing is stored at once, the rule in his words is offered, saved only after yes', async () => {
  for (const t of ['آتوسا، از این به بعد AR جلوی کد را در نامه‌ها ننویس', 'کد ۱۲ را در نظر نگیر', 'این مورد را حساب نکن', 'فراموش نکن که سه‌شنبه تعطیل است', 'from now on answer in short sentences', 'do not take the mock codes into account']) {
    assert.equal(isExplicitTeaching(t), true, t);
  }
  const { fx, store, desk, say } = mk();
  const text = 'آتوسا، از این به بعد جواب‌ها را کوتاه بنویس';
  const client = fakeClient([{ changes: [], questions: [] }]); // the model finds nothing it can map: still a rule in his words
  const r = await runTeaching({ text, explicit: true, client, config, customers: CUSTOMERS, groups: GROUPS, fallbackRule: ruleFrom(text, ['آتوسا']) });
  assert.equal(r.kind, 'propose');
  assert.equal(r.items[0].kind, 'rule');
  const msg = desk.propose(r.items, r.questions, r);
  assert.ok(msg.includes('بعد از «بله» ذخیره می‌شود'));
  assert.equal(fx.rules.items.length, 0); // not yet
  assert.equal(store.active().length, 0);
  say('بله');
  assert.equal(fx.rules.items.length, 1);
  assert.ok(fx.rules.promptText().includes('جواب‌ها را کوتاه بنویس'));
});

test('the wiring: the old path stores nothing at once; the list text no longer says so', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(!/rules\.add\(/.test(src)); // the only way to a stored rule is the teach desk
  assert.match(src, /if \(ruleFrom\(text, config\.botNames\)\) \{ await reply\(/);
  const rules = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'rules.js'), 'utf8');
  assert.ok(!rules.includes('همان لحظه ثبت می‌شود'));
  assert.ok(rules.includes('بعد از «بله»'));
  assert.match(src, /teachDesk\.wants\(text, \{ other:/); // an answer to her question is not taken from another command
});

test('"what have you learned": the counts of rows and other names first, with how to see them, then the numbered taught items', () => {
  const { fx, desk, store, say } = mk();
  assert.ok(say('چیزهایی که یاد گرفتی').includes('هنوز چیزی یاد نگرفته‌ام'));
  fx.customerGroups.approve('CEDAR', 'c1@g.us', 'CEDAR - ARYAK');
  fx.customerGroups.approve('NUQOOSH', 'n1@g.us', 'NUQOOSH & AL EBDA');
  fx.aliases.add('NUQOOSH', 'Nuqoosh Kitchens');
  fx.aliases.add('NUQOOSH', 'AL EBDA');
  let out = say('چیزهایی که یاد گرفتی');
  assert.ok(out.includes('ردیف مشتری و گروه: ۲') && out.includes('فهرست مشتری و گروه'));
  assert.ok(out.includes('نام دیگر برای مشتری: ۲ نام برای ۱ مشتری') && out.includes('اسم‌های دیگر'));
  assert.ok(out.includes('با جمله چیزی یاد نگرفته‌ام'));
  desk.propose([{ kind: 'rule', data: { text: 'Answer in short sentences' }, text: 'قانون: Answer in short sentences' }]);
  say('بله');
  out = say('چیزهایی که یاد گرفتی');
  assert.ok(out.includes('یاد گرفته‌شده با جمله') && out.includes('۱. قانون: Answer in short sentences'));
  assert.equal(store.active().length, 1);
});

test('his answer to her question keeps the open items: the alias stays, the row is added, one yes saves both', async () => {
  const { fx, store, desk, say } = mk();
  const first = fakeClient([{ changes: [{ kind: 'alias', customer: 'NUQOOSH', alias: 'AL EBDA' }, { kind: 'row', customer: 'NUQOOSH TRADING', groups: ['NO SUCH GROUP'] }], questions: ['کدام نوکوش؟'] }]);
  const r1 = await runTeaching({ text: 'یادت باشد آل ابدا و نوکوش یکی هستند و فاکتورش برود گروهش', explicit: true, client: first, config, customers: CUSTOMERS, groups: GROUPS });
  assert.equal(r1.kind, 'propose');
  assert.deepEqual(r1.items.map((i) => i.kind), ['alias']);
  assert.ok(r1.questions.length >= 1);
  desk.propose(r1.items, r1.questions, r1);
  assert.ok(desk.pending.questions.length >= 1);
  // his plain answer is taken as an answer (not lost, not a new teaching)
  const p = desk.wants('همان NUQOOSH بدون TRADING، گروهش NUQOOSH & AL EBDA است');
  assert.equal(p.type, 'answer');
  assert.equal(desk.wants('همان NUQOOSH', { other: true }), null); // another command takes it first
  assert.equal(desk.wants('یادت باشد چیز دیگری'), null); // a new teaching is a new start
  const second = fakeClient([{ changes: [{ kind: 'row', customer: 'NUQOOSH', groups: ['NUQOOSH & AL EBDA'] }, { kind: 'watch', subject: 'NUQOOSH & AL EBDA' }], questions: [] }]);
  const r2 = await runTeaching({ text: p.text, previous: desk.pending, client: second, config, customers: CUSTOMERS, groups: GROUPS });
  assert.equal(r2.kind, 'propose');
  assert.deepEqual(r2.items.map((i) => i.kind), ['watch', 'alias', 'row']); // the alias of the first round is kept
  assert.equal(r2.round, 2);
  assert.equal(r2.original, 'یادت باشد آل ابدا و نوکوش یکی هستند و فاکتورش برود گروهش');
  assert.ok(second.calls[0].messages[0].content.includes('کدام نوکوش؟') && second.calls[0].messages[0].content.includes('His answer')); // the question travels with the answer
  desk.propose(r2.items, r2.questions, r2);
  assert.equal(desk.wants('همان NUQOOSH'), null); // no open question any more
  say('بله');
  assert.equal(store.active().length, 3);
  assert.equal(fx.aliases.resolve('AL EBDA', []), 'NUQOOSH');
  assert.deepEqual(fx.customerGroups.find('NUQOOSH').groups.map((g) => g.jid), ['n1@g.us']);
});

test('a pending question survives a restart; "2 no" still drops an item while questions are open; "no" cancels all', async () => {
  const { dir, desk, say, store } = mk();
  desk.propose([{ kind: 'alias', data: { customer: 'NUQOOSH', alias: 'AL EBDA' }, text: 'AL EBDA = NUQOOSH (یک مشتری)' }, { kind: 'rule', data: { text: 'Answer in short sentences' }, text: 'قانون: Answer in short sentences' }], ['کدام نوکوش؟'], { original: 'x', round: 1 });
  const desk2 = new TeachDesk({ store: new TaughtStore(path.join(dir, 'taught')) });
  assert.equal(desk2.pending.questions.length, 1);
  assert.equal(desk2.pending.items.length, 2);
  assert.equal(desk2.wants('نوکوش اصلی').type, 'answer');
  assert.ok(say('۲ نه').includes('کنار گذاشته شد'));
  assert.equal(desk.pending.items.length, 1);
  assert.equal(desk.pending.questions.length, 1); // the question is still open
  say('نه');
  assert.equal(desk.pending, null);
  assert.equal(store.active().length, 0);
});

test('the third unanswered round stops asking and offers what was understood', async () => {
  const q = fakeClient([{ changes: [{ kind: 'alias', customer: 'NUQOOSH', alias: 'AL EBDA' }], questions: ['باز هم کدام؟'] }]);
  const r = await runTeaching({ text: 'again', previous: { original: 'x', items: [], questions: ['کدام؟'], round: 3 }, client: q, config, customers: CUSTOMERS, groups: GROUPS });
  assert.equal(r.kind, 'propose');
  assert.deepEqual(r.questions, []);
  assert.equal(r.items.length, 1);
  assert.ok(NAMES.length);
});

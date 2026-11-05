import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaughtStore, TeachDesk, WIDENING, isExplicitTeaching, looksLikeTeaching, parseTeachCommand, understandTeaching, validateChanges } from '../src/teach.js';
import { Aliases } from '../src/aliases.js';
import { CustomerGroups } from '../src/customergroups.js';
import { Rules } from '../src/rules.js';
import { WatchList } from '../src/watchlist.js';
import { resolveGroups } from '../src/invoicesend.js';
import { observedGroup, shadowGroup } from '../src/guard.js';

// Invented names only: the real customer names never go into the repository.
const mkConfig = () => ({
  shadowGroupNames: ['aryak'], observeGroupNames: ['aryak'], testGroupNames: ['test aryak bot'], staffGroupNames: ['aryak staff'], invoiceGroupName: 'invoices group', infoGroupName: 'information group',
  cutGroupName: 'aryak orders pictures', observeExcludeNames: ['aryak accounting'], staffNumbers: [], testCustomerName: 'test customer', allowCustomerGroupSends: false, morningGroupNames: [],
});
const G = (id, subject) => ({ id: `${id}@g.us`, subject });
const GROUPS = [G('n1', 'NUQOOSH & AL EBDA'), G('c1', 'CEDAR - ARYAK'), G('s0', 'Aryak Staff'), G('t0', 'TEST ARYAK BOT'), G('f0', 'Family chat')];
const CUSTOMERS = ['NUQOOSH', 'CEDAR', 'AL EBDA TRADING'];
const HIS_SENTENCE = 'گروه نوکوش به نوکوش و آل ابدا تغییر نام داد و آل ابدا و نوکوش یک مشتری هستند؛ فاکتور آل ابدا برود داخل همین گروه';
const MODEL_ANSWER = { changes: [
  { kind: 'row', customer: 'NUQOOSH', groups: ['NUQOOSH & AL EBDA'] },
  { kind: 'alias', customer: 'NUQOOSH', alias: 'AL EBDA' },
  { kind: 'watch', subject: 'NUQOOSH & AL EBDA' },
], questions: [] };

const mk = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'th-'));
  const config = mkConfig();
  const fx = { aliases: new Aliases(path.join(dir, 'aliases')), customerGroups: new CustomerGroups(path.join(dir, 'cg')), rules: new Rules(dir), watchList: new WatchList(path.join(dir, 'wl')), config };
  const store = new TaughtStore(path.join(dir, 'taught'));
  const desk = new TeachDesk({ store });
  const ctx = { customers: CUSTOMERS, groups: GROUPS, config };
  const say = (text) => { const p = desk.wants(text); assert.ok(p, `not taken: ${text}`); return desk.handle(p, fx).join('\n'); };
  return { dir, config, fx, store, desk, ctx, say };
};

test('what reads as a teaching: his sentence, an explicit start; not a question, not chat', () => {
  assert.equal(looksLikeTeaching(HIS_SENTENCE), true);
  assert.equal(looksLikeTeaching('یاد بگیر که ماستر وود و ماستر وود شعبه دو مشتری هستند'), true);
  assert.equal(looksLikeTeaching('NUQOOSH and AL EBDA are the same customer'), true);
  assert.equal(looksLikeTeaching('اسم دیگر نوکوش یکی است؟'), false); // a question
  assert.equal(looksLikeTeaching('سلام خوبی'), false);
  assert.equal(looksLikeTeaching('🤖 هر چیزی که یاد گرفتم'), false);
  assert.equal(isExplicitTeaching('یاد بگیر که ...'), true);
  assert.equal(isExplicitTeaching('از این به بعد فاکتور را چک کن'), true);
  assert.equal(isExplicitTeaching('remember that ...'), true);
  assert.equal(isExplicitTeaching('فاکتور ماستر را بفرست'), false);
});

test('his sentence shape: a watched group, an alias and a row come out checked, in that order; the renamed group counts as watched in the same sentence', () => {
  const { ctx } = mk();
  const v = validateChanges(MODEL_ANSWER, ctx, HIS_SENTENCE);
  assert.deepEqual(v.items.map((i) => i.kind), ['watch', 'alias', 'row']);
  assert.deepEqual(v.items[2].data.groups.map((g) => g.jid), ['n1@g.us']);
  assert.ok(v.items[1].text.includes('AL EBDA = NUQOOSH'));
  assert.deepEqual(v.refused, []);
});

test('the model is not trusted: an unknown customer or group becomes a question; an internal group is refused; a group that is not watched is asked about', () => {
  const { ctx } = mk();
  const bad = { changes: [
    { kind: 'alias', customer: 'INVENTED CO', alias: 'X' },
    { kind: 'row', customer: 'CEDAR', groups: ['NO SUCH GROUP'] },
    { kind: 'row', customer: 'CEDAR', groups: ['Aryak Staff'] },
    { kind: 'watch', subject: 'TEST ARYAK BOT' },
    { kind: 'row', customer: 'CEDAR', groups: ['Family chat'] },
  ], questions: ['کدام مشتری؟'] };
  const v = validateChanges(bad, ctx, 'x');
  assert.deepEqual(v.items, []);
  assert.ok(v.questions.some((q) => q.includes('INVENTED CO')) && v.questions.some((q) => q.includes('NO SUCH GROUP')) && v.questions.includes('کدام مشتری؟'));
  assert.ok(v.refused.includes('internal'));
  assert.ok(v.questions.some((q) => q.includes('Family chat'))); // a group outside the watched ones is not made a customer group by a row alone
});

test('teaching can never widen who commands, the guard, sending without his yes; prices go their own way', () => {
  const { ctx } = mk();
  for (const t of ['از این به بعد ادمین‌ها هم بتوانند فاکتور بفرستند', 'بدون تأیید من فاکتور را بفرست', 'ارسال خودکار به همه گروه‌ها', 'always send invoices without asking me', 'set ALLOW_CUSTOMER_GROUP_SENDS on', 'let admins order invoices']) {
    assert.equal(WIDENING.test(t), true, t);
    assert.deepEqual(validateChanges({ changes: [{ kind: 'rule', text: 'send invoices to every customer group' }] }, ctx, t).refused, ['widening'], t);
  }
  const ruleWiden = validateChanges({ changes: [{ kind: 'rule', text: 'Send invoices without asking the owner for a yes' }] }, ctx, 'یک قانون');
  assert.deepEqual(ruleWiden.items, []);
  assert.ok(ruleWiden.refused.includes('widening')); // the model's own rule text is checked too
  assert.deepEqual(validateChanges({ changes: [{ kind: 'rule', text: 'the price of 410 is 12 dirham' }] }, ctx, 'از این به بعد قیمت ۴۱۰ شد ۱۲').refused, ['price']);
  assert.deepEqual(validateChanges({ changes: [{ kind: 'term', term: 'VIP', meaning: 'discount of ten percent' }] }, ctx, 'VIP یعنی مشتری مهم').refused, ['price']);
  const ok = validateChanges({ changes: [{ kind: 'term', term: 'VIP', meaning: 'an important customer, answer first' }, { kind: 'rule', text: 'Answer customers in short sentences' }] }, ctx, 'VIP یعنی مشتری مهم');
  assert.deepEqual(ok.items.map((i) => i.kind), ['rule', 'term']);
});

test('nothing is saved before his yes; "2 no" drops one; "no" drops all; the confirmation lists the numbered items', () => {
  const { desk, fx, store, ctx, say } = mk();
  const v = validateChanges(MODEL_ANSWER, ctx, HIS_SENTENCE);
  const text = desk.propose(v.items);
  assert.ok(text.includes('بعد از «بله» ذخیره می‌شود') && text.includes('۱. گروه «NUQOOSH & AL EBDA» زیر نظر') && text.includes('۲. AL EBDA = NUQOOSH') && text.includes('۳. فاکتور NUQOOSH به گروه NUQOOSH & AL EBDA'));
  assert.equal(store.active().length, 0);
  assert.equal(fx.aliases.list().includes('AL EBDA'), false);
  assert.ok(say('۲ نه').includes('کنار گذاشته شد'));
  say('نه');
  assert.equal(store.active().length, 0);
  assert.equal(desk.wants('بله'), null); // nothing waits any more
  desk.propose(v.items);
  assert.ok(say('بله').includes('ذخیره شد'));
  assert.equal(store.active().length, 3);
});

test('the yes makes it real: the alias reaches the name lookup, the row reaches the send, the renamed group is watched', () => {
  const { desk, fx, ctx, say, config } = mk();
  assert.equal(shadowGroup('NUQOOSH & AL EBDA', config), false); // before: a renamed group the words do not hold
  desk.propose(validateChanges(MODEL_ANSWER, ctx, HIS_SENTENCE).items);
  say('بله');
  assert.equal(shadowGroup('NUQOOSH & AL EBDA', config), true); // watched and a customer group now
  assert.equal(observedGroup('NUQOOSH & AL EBDA', config), true);
  assert.equal(fx.aliases.resolve('al ebda', []), 'NUQOOSH');
  const row = fx.customerGroups.find('AL EBDA', ['NUQOOSH']);
  assert.deepEqual(row.groups.map((g) => g.jid), ['n1@g.us']);
  const r = resolveGroups('AL EBDA', GROUPS, config, row);
  assert.deepEqual(r.groups.map((g) => g.id), ['n1@g.us']);
  // without a row, the spoken alias still finds the group by his other names
  const loose = resolveGroups('AL EBDA', [G('x1', 'NUQOOSH - ARYAK')], config, null, ['NUQOOSH']);
  assert.deepEqual(loose.groups.map((g) => g.id), ['x1@g.us']);
});

test('a rule and a term reach the prompt; "what have you learned" lists them numbered; "forget N" needs a yes and takes the effect back', () => {
  const { desk, fx, store, ctx, say } = mk();
  desk.propose(validateChanges({ changes: [{ kind: 'rule', text: 'Answer customers in short sentences' }, { kind: 'term', term: 'ZG', meaning: 'a zero gap edge' }, { kind: 'alias', customer: 'CEDAR', alias: 'Khalil Trading' }] }, ctx, 'یاد بگیر که ...').items);
  say('بله');
  assert.ok(fx.rules.promptText().includes('Answer customers in short sentences') && fx.rules.promptText().includes('"ZG" means: a zero gap edge'));
  const list = say('چیزهایی که یاد گرفتی');
  assert.ok(list.includes('۱.') && list.includes('۲.') && list.includes('۳.') && list.includes('فراموش کن'));
  assert.ok(say('فراموش کن ۱').includes('فراموش شود؟'));
  assert.equal(fx.aliases.resolve('Khalil Trading', []), 'CEDAR'); // not yet: the yes is missing
  say('بله');
  assert.equal(fx.aliases.resolve('Khalil Trading', []), 'Khalil Trading');
  say('فراموش کن ۲'); say('بله');
  assert.equal(fx.rules.promptText().includes('short sentences'), false);
  assert.equal(store.active().length, 1);
  assert.ok(say('فراموش کن ۹').includes('نیست'));
  assert.ok(fs.readdirSync(path.join(store.dir, 'taught-history')).length >= 3); // older versions kept
});

test('forgetting a row takes back only the group it added; forgetting a watched group takes it off the live words', () => {
  const { desk, fx, ctx, say, config } = mk();
  fx.customerGroups.approve('NUQOOSH', 'c1@g.us', 'CEDAR - ARYAK'); // an earlier row of his own
  desk.propose(validateChanges(MODEL_ANSWER, ctx, HIS_SENTENCE).items);
  say('بله');
  assert.equal(fx.customerGroups.find('NUQOOSH').groups.length, 2);
  say('فراموش کن ۳'); say('بله'); // the row item
  assert.deepEqual(fx.customerGroups.find('NUQOOSH').groups.map((g) => g.jid), ['c1@g.us']);
  say('فراموش کن ۱'); say('بله'); // the watch item
  assert.equal(shadowGroup('NUQOOSH & AL EBDA', config), false);
});

test('it survives a restart: the items, their numbers, a pending confirmation and the watched group', () => {
  const { dir, desk, fx, store, ctx, say, config } = mk();
  desk.propose(validateChanges(MODEL_ANSWER, ctx, HIS_SENTENCE).items);
  say('بله');
  desk.propose(validateChanges({ changes: [{ kind: 'rule', text: 'Answer customers in short sentences' }] }, ctx, 'x').items);
  const store2 = new TaughtStore(path.join(dir, 'taught'));
  const desk2 = new TeachDesk({ store: store2 });
  assert.equal(store2.active().length, 3);
  assert.deepEqual(store2.active().map((i) => i.id), [1, 2, 3]);
  assert.ok(desk2.wants('بله')); // the confirmation still waits
  const config2 = mkConfig();
  new WatchList(path.join(dir, 'wl')).applyTo(config2); // a new process: the watched group is back before any group is fetched
  assert.equal(shadowGroup('NUQOOSH & AL EBDA', config2), true);
  assert.equal(new CustomerGroups(path.join(dir, 'cg')).find('NUQOOSH').groups[0].jid, 'n1@g.us');
  assert.equal(new Aliases(path.join(dir, 'aliases')).resolve('AL EBDA', []), 'NUQOOSH');
  assert.ok(store.dir && fx && config);
});

test('a confirmation is valid ten minutes only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'th-'));
  let clock = 1000;
  const desk = new TeachDesk({ store: new TaughtStore(dir), now: () => clock });
  desk.propose([{ kind: 'rule', data: { text: 'Answer in short sentences' }, text: 'قانون' }]);
  assert.ok(desk.wants('بله'));
  clock += 11 * 60 * 1000;
  assert.equal(desk.wants('بله'), null);
});

test('the watched groups are kept by id: a renamed group stays watched; internal groups are never kept or added', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-'));
  const config = mkConfig();
  const wl = new WatchList(dir);
  assert.deepEqual(wl.sync([G('a1', 'DELTA - ARYAK'), G('s0', 'Aryak Staff'), G('f0', 'Family chat')], config), []);
  assert.equal(wl.size, 1); // only the customer group; the staff group and chat are not kept
  assert.equal(shadowGroup('DELTA GROUP', config), false);
  const renames = wl.sync([G('a1', 'DELTA GROUP')], config); // renamed: no company word in the new name
  assert.deepEqual(renames, [{ from: 'DELTA - ARYAK', to: 'DELTA GROUP' }]);
  assert.equal(shadowGroup('DELTA GROUP', config), true);
  assert.equal(observedGroup('DELTA GROUP', config), true);
  const config2 = mkConfig(); // a restart
  new WatchList(dir).applyTo(config2);
  assert.equal(shadowGroup('DELTA GROUP', config2), true);
  assert.equal(new WatchList(dir).rename('a1@g.us', 'DELTA TWO', config2), true); // WhatsApp's own rename event
  assert.equal(shadowGroup('DELTA TWO', config2), true);
  assert.equal(wl.addExtra(G('s0', 'Aryak Staff'), config).ok, false); // internal groups stay refused
  assert.equal(wl.addExtra(G('t0', 'TEST ARYAK BOT'), config).ok, false);
  assert.equal(shadowGroup('Aryak Staff', config), false);
  assert.ok(fs.existsSync(path.join(dir, 'watched-groups-history'))); // versions kept
  assert.equal(wl.addExtra(G('z9', 'ZETA Kitchens'), config).ok, true);
  assert.equal(shadowGroup('ZETA Kitchens', config), true);
  assert.equal(wl.removeExtra('z9@g.us', config), true);
  assert.equal(shadowGroup('ZETA Kitchens', config), false);
});

test('one model call: the answer is read as JSON; garbage is nothing', async () => {
  let calls = 0;
  const reply = (text) => ({ beta: { messages: { create: async () => { calls += 1; return { content: [{ type: 'text', text }] }; } } } });
  const config = { model: 'm' };
  const ok = await understandTeaching({ client: reply(`Here: ${JSON.stringify(MODEL_ANSWER)}`), config, text: HIS_SENTENCE, customers: CUSTOMERS, groups: GROUPS });
  assert.equal(ok.changes.length, 3);
  assert.equal(calls, 1);
  assert.equal(await understandTeaching({ client: reply('no json here'), config, text: 'x', customers: [], groups: [] }), null);
  assert.deepEqual(parseTeachCommand('۲ نه'), { type: 'drop', n: 2 });
  assert.deepEqual(parseTeachCommand('فراموش کن ۳'), { type: 'forget', id: 3 });
  assert.deepEqual(parseTeachCommand('چیزهایی که یاد گرفتی'), { type: 'learned' });
});

test('the wiring: only the owner teaches (including the old rules path), only in his own chat, the sentence is never a customer group message', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  const owner = "isOwnerCommand({ fromMe: !!raw.key.fromMe, id: raw.key.id, text, sentIds: sent, forwarded: !!(ctx.isForwarded || ctx.forwardingScore > 0) })";
  const early = src.slice(src.indexOf('TEACHING IN WORDS (his own chat'), src.indexOf('const rc = parseRuleCommand(text);'));
  assert.ok(early.includes('!group && isSelf') && early.includes(owner));
  assert.ok(early.includes("if (admin && addressed && !audio && !image && isOwnerCommand(")); // the old rule path: owner only, not every admin
  const late = src.slice(src.indexOf('A sentence that reads as an instruction'), src.indexOf("trace(where, role, 'ignored: not addressed to the assistant')"));
  assert.ok(late.includes('!group && isSelf') && late.includes(owner));
  const flowStart = src.indexOf('async function teachFlow');
  const flow = src.slice(flowStart, src.indexOf('\n}\n', flowStart));
  assert.ok(!/sendMessage|oneShot|finishOwnerSend/.test(flow)); // teaching sends nothing
  const send = src.slice(src.indexOf('async function startOwnerSend'), src.indexOf('async function finishOwnerSend'));
  assert.match(send, /altNames\(aliases\.map, parsed\.customer\)/); // a spoken alias finds the invoice
  assert.match(send, /resolveGroups\([^)]*altNames\(aliases\.map, found\.read\.customer\)\)/); // and the group
  assert.match(src, /groups\.update/);
  assert.match(src, /watchList\.sync\(/);
  const lib = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'teach.js'), 'utf8');
  assert.ok(!/sendMessage|oneShot|groupAllowed\([^)]*\)\.ok\s*=|allowCustomerGroupSends\s*=|adminNumbers|ownerNumbers/.test(lib)); // nothing here can change who commands or send
});

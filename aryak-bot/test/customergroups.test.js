import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CustomerGroupDesk, CustomerGroups, NameBook, buildProposal, collectCustomers, nameKey, parseListCommand, proposalTexts } from '../src/customergroups.js';
import { confirmText, isOwnerCommand, resolveGroups, targetGroups } from '../src/invoicesend.js';

// Invented names only: the real customer names never go into the repository.
const config = {
  shadowGroupNames: ['aryak'], testGroupNames: ['test aryak bot'], staffGroupNames: ['aryak staff'], invoiceGroupName: 'invoices group', infoGroupName: 'information group',
  cutGroupName: 'aryak orders pictures', observeExcludeNames: ['aryak accounting'], staffNumbers: [], testCustomerName: 'test customer', allowCustomerGroupSends: false, morningGroupNames: [],
};
const G = (id, subject) => ({ id: `${id}@g.us`, subject });
const GROUPS = [
  G('a1', 'MASTER WOOD - ARYAK'), G('a2', 'MASTER WOOD BRANCH - ARYAK'), G('d1', 'DASH - ARYAK'), G('d2', 'DASH TEAM - ARYAK'), G('p1', 'BLUE POINT - ARYAK'), G('p2', 'BLUE CAPITAL - ARYAK'),
  G('t1', 'ATLAS COMMERCIAL - ARYAK'), G('m1', 'AMIR DESIGNER - ARYAK'), G('x1', 'LONELY WORKS - ARYAK'), G('k1', 'ZORVAN KITCHENS ORDERS - ARYAK'), G('s1', 'AL SHAM TRADING ARYAK'),
  G('T0', 'TEST ARYAK BOT'), G('S0', 'Aryak Staff'), G('I0', 'Invoices group'), G('C0', 'ARYAK Accounting'), G('F0', 'Family chat'),
];
const NAMES = ['Master Wood', 'Master Wood Branch', 'Dash', 'Blue Point', 'Blue Capital', 'Atlas Kitchen', 'Atlas Commercial', 'Amir Designer Wood', 'Zorvan Kitchens', 'Alsham Trading', 'Nova Design Studio', 'Big Factory', 'Test Customer'];
const known = { customers: [], invoices: 6, aliasMap: {} };
const mk = (names = NAMES) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
  const list = new CustomerGroups(dir);
  const book = new NameBook(dir);
  book.save(names);
  const desk = new CustomerGroupDesk({ list, config, book });
  return { dir, list, book, desk, run: (text, groups = GROUPS) => { const p = desk.wants(text); assert.ok(p, `not taken: ${text}`); return desk.handle(p, { groups, known }); } };
};

test('the owner words are read in Persian, Arabic and Latin digits, with or without the hamza', () => {
  assert.deepEqual(parseListCommand('فهرست مشتری و گروه'), { type: 'list' });
  assert.deepEqual(parseListCommand('آتوسا فهرست مشتری و گروه'), { type: 'list' });
  assert.deepEqual(parseListCommand('customer group list'), { type: 'list' });
  assert.deepEqual(parseListCommand('نام‌های بی‌گروه'), { type: 'nogroup' });
  assert.deepEqual(parseListCommand('تأیید همه'), { type: 'approveAll' });
  assert.deepEqual(parseListCommand('تایید همه'), { type: 'approveAll' });
  assert.deepEqual(parseListCommand('تأیید ۱ ۳ ۵'), { type: 'approve', nums: [1, 3, 5] });
  assert.deepEqual(parseListCommand('تأیید ٢ و ٤'), { type: 'approve', nums: [2, 4] });
  assert.deepEqual(parseListCommand('۳ نه'), { type: 'reject', n: 3 });
  assert.deepEqual(parseListCommand('۴ = ۲'), { type: 'pick', n: 4, picks: [2] });
  assert.deepEqual(parseListCommand('۷ = Dash Co'), { type: 'pick', n: 7, value: 'Dash Co' });
  assert.deepEqual(parseListCommand('مشتری Master Wood گروه master wood'), { type: 'set', customer: 'Master Wood', words: 'master wood' });
  assert.deepEqual(parseListCommand('حذف مشتری Master Wood'), { type: 'remove', customer: 'Master Wood' });
  assert.equal(parseListCommand('hello there'), null);
  assert.equal(parseListCommand('سلام'), null);
});

test('the proposal is GROUP-centred: one row per customer group, never an internal group, confident only on a clear winner', () => {
  const { list } = mk();
  const p = buildProposal({ customers: NAMES, groups: GROUPS, config, list, invoices: 6 });
  const custGroups = GROUPS.filter((g) => /ARYAK/.test(g.subject) && !/TEST|Staff|Accounting/.test(g.subject));
  assert.ok(p.rows.length <= custGroups.length);
  const all = JSON.stringify(p.rows);
  for (const bad of ['TEST ARYAK BOT', 'Aryak Staff', 'Invoices group', 'Accounting', 'Family']) assert.ok(!all.includes(bad), bad);
  const conf = (c) => p.rows.find((r) => r.kind === 'confident' && r.customer === c);
  assert.deepEqual(conf('Master Wood').groups.map((g) => g.jid), ['a1@g.us']); // the main group goes to the exact name...
  assert.deepEqual(conf('Master Wood Branch').groups.map((g) => g.jid), ['a2@g.us']); // ...the branch group to the branch customer
  assert.deepEqual(conf('Dash').groups.map((g) => g.jid).sort(), ['d1@g.us', 'd2@g.us']); // two groups, one customer, ONE row
  assert.ok(conf('Blue Point') && conf('Blue Capital') && conf('Amir Designer Wood') && conf('Zorvan Kitchens') && conf('Alsham Trading'));
  const opt = p.rows.find((r) => r.kind === 'options');
  assert.equal(opt.group.subject, 'ATLAS COMMERCIAL - ARYAK'); // atlas kitchen / atlas commercial: both are "atlas"
  assert.deepEqual(opt.candidates.sort(), ['Atlas Commercial', 'Atlas Kitchen']);
  assert.equal(p.rows.find((r) => r.kind === 'none').group.subject, 'LONELY WORKS - ARYAK');
  assert.deepEqual(p.rows.map((r) => r.n), p.rows.map((_, i) => i + 1));
  assert.deepEqual(p.rows.map((r) => r.kind), [...p.rows.map((r) => r.kind)].sort((a, b) => ['confident', 'options', 'none'].indexOf(a) - ['confident', 'options', 'none'].indexOf(b)));
  // customers with no group: only a list kept, the test customer never
  assert.deepEqual(p.noGroup.sort(), ['Big Factory', 'Nova Design Studio']);
});

test('the command: a short proposal, the head line counts the sources, the no-group names are NOT in it but come on request', () => {
  const { run, list } = mk();
  const msgs = run('فهرست مشتری و گروه');
  assert.ok(msgs.length <= 3);
  assert.ok(msgs[0].includes('۱۳ نام فهرست حسابداری') && msgs[0].includes('۶'));
  const all = msgs.join('\n');
  assert.ok(all.includes('MASTER WOOD - ARYAK') && all.includes('LONELY WORKS - ARYAK'));
  assert.ok(all.includes('مشتریانی که گروهی زیر نظر برایشان نیست: ۲ نام'));
  assert.ok(!all.includes('Big Factory') && !all.includes('Nova Design'));
  assert.equal(list.size, 0);
  assert.equal(list.d.version, 0);
  const none = run('نام‌های بی‌گروه').join('\n');
  assert.ok(none.includes('Big Factory') && none.includes('Nova Design Studio') && !none.includes('Test Customer'));
});

test('with 46 customer groups and 203 names the proposal fits in at most 3 messages', () => {
  const groups = Array.from({ length: 46 }, (_, i) => G(`g${i}`, `CUSTOMERNAME${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}ZZ - ARYAK`));
  const names = [...groups.map((g, i) => (i % 3 ? g.subject.replace(' - ARYAK', '') : `Nobody${i}`)), ...Array.from({ length: 150 }, (_, i) => `Person Number${i}`)];
  const { list } = mk(names);
  const p = buildProposal({ customers: names, groups, config, list, invoices: 0, sources: { fromBook: names.length, fromInvoices: 0 } });
  const texts = proposalTexts(p, list);
  assert.ok(texts.length <= 3, String(texts.length));
  assert.ok(p.rows.length <= 46);
  assert.ok(p.noGroup.length >= 100);
  assert.ok(!texts.join('\n').includes('Number149'));
});

test('"approve all" saves only the confident rows (a two-group customer keeps both groups), keeps a version, shows what was saved', () => {
  const { run, list, dir } = mk();
  run('فهرست مشتری و گروه');
  const out = run('تأیید همه').join('\n');
  assert.ok(out.includes('Dash — DASH - ARYAK + DASH TEAM - ARYAK') || out.includes('Dash — DASH TEAM - ARYAK + DASH - ARYAK'));
  assert.equal(list.find('dash').groups.length, 2);
  assert.equal(list.find('Master Wood').jid, 'a1@g.us');
  assert.equal(list.find('Master Wood Branch').jid, 'a2@g.us');
  assert.equal(list.find('Atlas Commercial'), null); // options are not approved by "all"
  assert.equal(list.find('Atlas Kitchen'), null);
  assert.ok(list.d.version >= 1);
  assert.ok(fs.existsSync(path.join(dir, 'customer-groups.json')));
  assert.equal(new CustomerGroups(dir).find('Master  Wood.').subject, 'MASTER WOOD - ARYAK'); // kept across a restart
});

test('"approve N": a confident row is saved; an options row or a group with no customer is explained; a wrong number or a done row is refused', () => {
  const { run, list, desk } = mk();
  run('فهرست مشتری و گروه');
  const rows = desk.proposal.rows;
  const conf = rows.find((r) => r.kind === 'confident');
  const opt = rows.find((r) => r.kind === 'options');
  const none = rows.find((r) => r.kind === 'none');
  assert.ok(run('تأیید ۹۹').join('').includes('در این پیشنهاد نیست'));
  assert.ok(run(`تأیید ${opt.n}`).join('').includes('چند مشتری ممکن'));
  assert.ok(run(`تأیید ${none.n}`).join('').includes('مشتری ندارد'));
  assert.equal(list.size, 0);
  assert.ok(run(`تأیید ${conf.n}`).join('').includes('ذخیره شد'));
  assert.equal(list.size, 1);
  assert.ok(run(`تأیید ${conf.n}`).join('').includes('قبلاً رسیدگی'));
  assert.ok(desk.proposal.rows.every((r, i) => r.n === rows[i].n)); // the numbers never move while he answers
});

test('"N = 2" picks that candidate for the group; "N = name" names the customer of a group; a bad option is refused; two customers on one group are not taken', () => {
  const { run, list, desk } = mk();
  run('فهرست مشتری و گروه');
  const opt = desk.proposal.rows.find((r) => r.kind === 'options');
  const none = desk.proposal.rows.find((r) => r.kind === 'none');
  assert.ok(run(`${opt.n} = ۷`).join('').includes('می‌خواهد'));
  assert.ok(run(`${opt.n} = ۱ ۲`).join('').includes('می‌خواهد'));
  assert.equal(list.size, 0);
  const second = opt.candidates[1];
  assert.ok(run(`${opt.n} = ۲`).join('').includes(second));
  assert.equal(list.find(second).jid, 't1@g.us');
  assert.ok(run(`${none.n} = Lonely Joe`).join('').includes('Lonely Joe — LONELY WORKS - ARYAK'));
  assert.equal(list.find('lonely joe').jid, 'x1@g.us');
  assert.ok(run(`${desk.proposal.rows.find((r) => r.kind === 'confident').n} = ۲`).join('').includes('گزینه‌ای ندارد'));
});

test('a customer who already has a group gains the second one; an approval never drops a group', () => {
  const { run, list, desk } = mk();
  list.approve('Dash', 'd1@g.us', 'DASH - ARYAK');
  run('فهرست مشتری و گروه');
  const row = desk.proposal.rows.find((r) => r.kind === 'confident' && r.customer === 'Dash');
  assert.deepEqual(row.groups.map((g) => g.jid), ['d2@g.us']); // d1 is in the list already: only the new group is proposed
  run('تأیید همه');
  assert.deepEqual(list.find('Dash').groups.map((g) => g.jid).sort(), ['d1@g.us', 'd2@g.us']);
});

test('"N no" declines that row for good (a confident pair, the candidates of an options row, a group with no customer)', () => {
  const { run, list, desk } = mk();
  run('فهرست مشتری و گروه');
  const rows = desk.proposal.rows;
  const conf = rows.find((r) => r.customer === 'Blue Point');
  const opt = rows.find((r) => r.kind === 'options');
  const none = rows.find((r) => r.kind === 'none');
  for (const r of [conf, opt, none]) assert.ok(run(`${r.n} نه`).join('').includes('رد شد'));
  assert.equal(list.size, 0);
  run('فهرست مشتری و گروه'); // a new proposal replaces the pending one; the declined are not proposed again
  const again = JSON.stringify(desk.proposal.rows);
  assert.ok(!again.includes('x1@g.us') && desk.proposal.rows.find((r) => r.group?.jid === 't1@g.us').kind === 'none' && !desk.proposal.rows.some((r) => r.customer === 'Blue Point' || (r.candidates || []).includes('Blue Point')));
});

test('a stale jid is never saved: the group left or is no longer a customer group', () => {
  const { desk, list, run } = mk();
  run('فهرست مشتری و گروه');
  const conf = desk.proposal.rows.find((r) => r.customer === 'Master Wood');
  const out = desk.handle({ type: 'approve', nums: [conf.n] }, { groups: GROUPS.filter((g) => g.id !== 'a1@g.us'), known }).join('');
  assert.ok(out.includes('پیدا نمی‌شود'));
  assert.equal(list.size, 0);
});

test('a later change needs his yes: "customer X group words (+ more)", "remove customer X"; no is no change; an internal group refuses', () => {
  const { run, list } = mk();
  assert.equal(new CustomerGroupDesk({ list, config }).wants('بله'), null); // a lone yes is nobody's business when nothing waits
  const ask = run('مشتری Dash Co گروه dash team').join('');
  assert.ok(ask.includes('ذخیره شود؟') && ask.includes('DASH TEAM - ARYAK'));
  assert.equal(list.size, 0); // not saved before the yes
  run('نه');
  assert.equal(list.size, 0);
  run('مشتری Dash Co گروه dash team + lonely');
  assert.ok(run('بله').join('').includes('ذخیره شد'));
  assert.equal(list.find('dash co').groups.length, 2);
  assert.ok(run('مشتری Dash Co گروه dash team + staff').join('').includes('گروه مشتری نیست'));
  assert.equal(list.find('dash co').groups.length, 2);
  assert.ok(run('حذف مشتری Dash Co').join('').includes('حذف شود؟'));
  assert.equal(list.size, 1);
  run('بله');
  assert.equal(list.size, 0);
  assert.ok(run('حذف مشتری Nobody').join('').includes('در فهرست نیست'));
  assert.ok(fs.readdirSync(path.join(list.dir, 'customer-groups-history')).length >= 1); // the version before is kept
});

test('the answers need an open proposal, so ordinary chat is never taken', () => {
  const { desk } = mk();
  for (const t of ['تأیید همه', '۳ نه', '۴ = ۲', 'تأیید ۱ ۳', 'نام‌های بی‌گروه']) assert.equal(desk.wants(t), null);
  assert.ok(desk.wants('فهرست مشتری و گروه'));
});

test('sending: the approved row wins over the loose match, and that group alone is used', () => {
  const list = new CustomerGroups('');
  const row = list.approve('MASTER WOOD', 'p1@g.us', 'BLUE POINT - ARYAK'); // the owner chose this group on purpose
  const r = resolveGroups('MASTER WOOD', GROUPS, config, row);
  assert.deepEqual(r.groups.map((g) => g.id), ['p1@g.us']);
  assert.deepEqual([r.mapped, r.unconfirmed], [true, false]);
  assert.ok(targetGroups('MASTER WOOD', GROUPS, config).length >= 1); // the old loose path is untouched
});

test('sending: a row whose group renamed still works; one whose group is gone or not a customer group any more sends nothing and does not fall back', () => {
  const list = new CustomerGroups('');
  const row = list.approve('MASTER WOOD', 'a1@g.us', 'MASTER WOOD - ARYAK');
  const renamed = GROUPS.map((g) => (g.id === 'a1@g.us' ? { ...g, subject: 'MW kitchens ARYAK' } : g));
  assert.deepEqual(resolveGroups('MASTER WOOD', renamed, config, row).groups.map((g) => g.id), ['a1@g.us']); // the jid counts
  const gone = resolveGroups('MASTER WOOD', GROUPS.filter((g) => g.id !== 'a1@g.us'), config, row);
  assert.deepEqual([gone.groups.length, gone.stale], [0, true]); // stale: no loose fallback to another group
  const internal = list.approve('STAFF CO', 'S0@g.us', 'Aryak Staff'); // an internal group can never be used, even if it got into the list
  const r = resolveGroups('STAFF CO', GROUPS, config, internal);
  assert.deepEqual([r.groups.length, r.stale], [0, true]);
});

test('sending: a customer with two approved groups gets both offered (he picks one by number, never both); one gone leaves the other', () => {
  const list = new CustomerGroups('');
  const row = list.approveGroups('Dash', [{ jid: 'd1@g.us', subject: 'DASH - ARYAK' }, { jid: 'd2@g.us', subject: 'DASH TEAM - ARYAK' }]);
  const r = resolveGroups('Dash', GROUPS, config, row);
  assert.deepEqual(r.groups.map((g) => g.id).sort(), ['d1@g.us', 'd2@g.us']);
  assert.deepEqual(resolveGroups('Dash', GROUPS.filter((g) => g.id !== 'd2@g.us'), config, row).groups.map((g) => g.id), ['d1@g.us']);
  assert.equal(resolveGroups('Dash', GROUPS.filter((g) => !/^d[12]/.test(g.id)), config, row).stale, true);
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(src, /if \(groups\.length > 1\) \{ sendDesk\.start\(chatId, \{ step: 'choose'/); // several groups = he chooses by number
});

test('sending: no row = the loose match with the one added line; the test customer never goes through the list', () => {
  const r = resolveGroups('Master Wood', GROUPS, config, null);
  assert.ok(r.groups.some((g) => g.id === 'a1@g.us'));
  assert.equal(r.unconfirmed, true);
  const read = { number: 'inv-1', customer: 'Master Wood', total: 100, urgent: 0, checked: true, noOrder: false };
  assert.ok(confirmText({ read, fileName: 'inv-1 MASTER WOOD.pdf', group: 'MASTER WOOD - ARYAK', unconfirmed: true }).includes('This group was not confirmed in the list.'));
  assert.ok(!confirmText({ read, fileName: 'inv-1 MASTER WOOD.pdf', group: 'MASTER WOOD - ARYAK' }).includes('not confirmed in the list'));
  const list = new CustomerGroups('');
  const row = list.approve('Test Customer', 'a1@g.us', 'MASTER WOOD - ARYAK'); // even a row cannot send the test customer to a real group
  const t = resolveGroups('Test Customer', GROUPS, config, row);
  assert.deepEqual(t.groups.map((g) => g.id), ['T0@g.us']);
  assert.equal(t.unconfirmed, false);
});

test('a new invoice customer with no row appears once in the digest; before any list exists there is no such line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
  const list = new CustomerGroups(dir);
  assert.deepEqual(list.newUnmapped(['ZAMAN'], config), []); // no list yet: the proposal comes first
  list.approve('MASTER WOOD', 'a1@g.us', 'MASTER WOOD - ARYAK');
  assert.deepEqual(list.newUnmapped(['MASTER WOOD', 'ZAMAN', 'Test Customer', 'zaman'], config), ['ZAMAN']);
  assert.deepEqual(list.newUnmapped(['ZAMAN'], config), []); // named once
  assert.deepEqual(new CustomerGroups(dir).newUnmapped(['ZAMAN'], config), []); // and across a restart
});

test('collecting the customers: reads, tracker invoices, aliases; each once; the invoices counted by number', () => {
  const c = collectCustomers({ reads: { a: { number: 'inv-1', customer: 'Master Wood' }, b: { number: 'INV-1', customer: 'master wood' } }, events: [{ type: 'invoice', customer: 'Dandy', number: 'inv-2' }, { type: 'order', customer: 'Other' }], aliasMap: { Saba: ['Saba Furniture'] } });
  assert.deepEqual(c.customers.sort(), ['Dandy', 'Master Wood', 'Saba']);
  assert.equal(c.invoices, 2);
  assert.equal(nameKey('IND . LLC'), nameKey('ind llc'));
});

test('the wiring: only the owner, only in his own chat, nothing is sent by the list, the send consults the list first', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const block = src.slice(src.indexOf("THE OWNER'S FIXED LIST"), src.indexOf("THE OWNER ORDERS AN INVOICE INTO"));
  assert.match(block, /!group && isSelf/);
  assert.match(block, /isOwnerCommand\(/);
  assert.ok(!/sendMessage|oneShot|finishOwnerSend/.test(block)); // approving sends nothing
  const fn = src.slice(src.indexOf('async function startOwnerSend'), src.indexOf('async function finishOwnerSend'));
  assert.match(fn, /customerGroups\.find\(/);
  assert.match(fn, /resolveGroups\(/);
  assert.ok(!/targetGroups\(/.test(fn));
  const lib = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'customergroups.js'), 'utf8');
  assert.ok(!/anthropic|client\.|messages\.create|sendMessage|oneShot/i.test(lib)); // free code, no paid call, no way to write to a group
  assert.equal(isOwnerCommand({ fromMe: false, id: 'x', text: 'تأیید همه', sentIds: new Set() }), false); // a non-owner is refused by the same rule
});

test('every customer group has a row, even one with no real word in its name; a watched group left out of the rule is named, not lost', () => {
  const groups = [...GROUPS, G('v1', 'PVC works - ARYAK'), G('e1', 'Eng.carpentry ARYAK'), G('r1', 'Ar-Rad - ARYAK')];
  const { list } = mk();
  const p = buildProposal({ customers: NAMES, groups, config, list });
  const subjects = JSON.stringify(p.rows);
  for (const s of ['PVC works - ARYAK', 'Eng.carpentry ARYAK', 'Ar-Rad - ARYAK']) assert.ok(subjects.includes(s), s);
  const custGroups = groups.filter((g) => /ARYAK/.test(g.subject) && !/TEST|Staff|Accounting/.test(g.subject));
  assert.equal(p.groupCount, custGroups.length); // 14 groups in fewer rows: the head line counts groups
  assert.ok(p.others.includes('ARYAK Accounting')); // has the company word but an excluded word: never a row, but named
  assert.ok(!p.others.includes('Aryak Staff') && !p.others.includes('TEST ARYAK BOT') && !p.others.includes('Family chat'));
  const text = proposalTexts(p, list).join('\n');
  assert.ok(text.includes(`${String(custGroups.length).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])} گروه مشتری`));
  assert.ok(text.includes('ARYAK Accounting'));
});

test('a pending proposal and a pending yes survive a restart: the numbers and the answers still work', () => {
  const { run, list, desk, dir, book } = mk();
  run('فهرست مشتری و گروه');
  const first = desk.proposal.rows[0];
  run(`تأیید ${first.n}`);
  run('مشتری Dash Co گروه dash team');
  const again = new CustomerGroupDesk({ list: new CustomerGroups(dir), config, book: new NameBook(dir) }); // a new process
  assert.equal(again.proposal.rows.length, desk.proposal.rows.length);
  assert.equal(again.proposal.rows[0].status, 'saved');
  assert.ok(again.wants('تأیید همه')); // the proposal is still open
  assert.ok(again.wants('بله')); // and so is the change waiting for his yes
  const out = again.handle(again.wants('بله'), { groups: GROUPS, known }).join('');
  assert.ok(out.includes('ذخیره شد'));
  assert.ok(new CustomerGroups(dir).find('dash co'));
  assert.equal(book.size, NAMES.length);
});

test('"approve all" never saves a near spelling or a one-word win: only exact, complete matches', () => {
  const groups = [G('f1', 'AL AHLIA KITCHEN - ARYAK'), G('f2', 'GOLDEN SUN FURNITURE - ARYAK'), G('f3', 'RANA - ARYAK'), G('f4', 'ORION BUILDING - ARYAK')];
  const { run, list } = mk(['Alia Wood', 'Golden Door Kitchen', 'Rana Wood', 'Rana Kitchen', 'Orion Design']);
  const out = run('فهرست مشتری و گروه', groups).join('\n');
  assert.ok(!out.includes('Alia Wood —') && !out.includes('Golden Door Kitchen —') && !/Rana (Wood|Kitchen) —/.test(out));
  run('تأیید همه', groups);
  assert.equal(list.rows().filter((r) => ['f1@g.us', 'f2@g.us', 'f3@g.us'].includes(r.jid)).length, 0); // nothing was confident but the exact orion
  assert.equal(list.find('Orion Design')?.jid, 'f4@g.us');
});

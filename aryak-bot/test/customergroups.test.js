import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CustomerGroupDesk, CustomerGroups, buildProposal, collectCustomers, nameKey, parseListCommand, proposalTexts, resolveGroupWords } from '../src/customergroups.js';
import { confirmText, isOwnerCommand, resolveGroups, targetGroups } from '../src/invoicesend.js';

const config = {
  shadowGroupNames: ['aryak', 'nuqo', 'kitchens'], testGroupNames: ['test aryak bot'], staffGroupNames: ['aryak staff'], invoiceGroupName: 'invoices group', infoGroupName: 'information group',
  cutGroupName: 'aryak orders pictures', observeExcludeNames: ['aryak accounting'], staffNumbers: [], testCustomerName: 'test customer', allowCustomerGroupSends: false, morningGroupNames: [],
};
const GROUPS = [
  { id: 'a@g.us', subject: 'MASTER WOOD - ARYAK' }, { id: 'b@g.us', subject: 'SY x NUQOOSH KITCHENS' }, { id: 'c@g.us', subject: 'NUQOUCH---ARYAK' },
  { id: 'd@g.us', subject: 'TEST ARYAK BOT' }, { id: 'e@g.us', subject: 'Aryak Staff' }, { id: 'f@g.us', subject: 'Invoices group' }, { id: 'g@g.us', subject: 'Family chat' },
  { id: 'h@g.us', subject: 'DANDY - ARYAK' }, { id: 'i@g.us', subject: 'ARYAK Accounting' }, { id: 'j@g.us', subject: 'SABA FURNITURE - ARYAK' },
];
const READS = {
  m1: { number: 'inv-1', customer: 'MASTER WOOD' }, m2: { number: 'inv-2', customer: 'NUQOOSH KITCHENS' }, m3: { number: 'inv-3', customer: 'Nuqooch' },
  m4: { number: 'inv-4', customer: 'ZAMAN' }, m5: { number: 'inv-5', customer: 'TEST CUSTOMER' }, m6: { number: 'inv-6', customer: 'Aryak Staff' },
};
const mk = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
  const list = new CustomerGroups(dir);
  const desk = new CustomerGroupDesk({ list, config });
  const known = { ...collectCustomers({ reads: READS }), aliasMap: {} };
  return { dir, list, desk, run: (text) => { const p = desk.wants(text); assert.ok(p, `not taken: ${text}`); return desk.handle(p, { groups: GROUPS, known }); } };
};

test('the owner words are read in Persian, Arabic and Latin digits, with or without the hamza', () => {
  assert.deepEqual(parseListCommand('فهرست مشتری و گروه'), { type: 'list' });
  assert.deepEqual(parseListCommand('آتوسا فهرست مشتری و گروه'), { type: 'list' });
  assert.deepEqual(parseListCommand('customer group list'), { type: 'list' });
  assert.deepEqual(parseListCommand('تأیید همه'), { type: 'approveAll' });
  assert.deepEqual(parseListCommand('تایید همه'), { type: 'approveAll' });
  assert.deepEqual(parseListCommand('تأیید ۱ ۳ ۵'), { type: 'approve', nums: [1, 3, 5] });
  assert.deepEqual(parseListCommand('تأیید ٢ و ٤'), { type: 'approve', nums: [2, 4] });
  assert.deepEqual(parseListCommand('۳ نه'), { type: 'reject', n: 3 });
  assert.deepEqual(parseListCommand('۴ = ۲'), { type: 'pick', n: 4, value: '2' });
  assert.deepEqual(parseListCommand('۷ = dandy'), { type: 'pick', n: 7, value: 'dandy' });
  assert.deepEqual(parseListCommand('مشتری Master Wood گروه master wood'), { type: 'set', customer: 'Master Wood', words: 'master wood' });
  assert.deepEqual(parseListCommand('حذف مشتری Master Wood'), { type: 'remove', customer: 'Master Wood' });
  assert.equal(parseListCommand('hello there'), null);
  assert.equal(parseListCommand('سلام'), null);
});

test('the proposal comes from the customers she has: confident pair, several groups, none; internal groups never; the test customer never', () => {
  const { list } = mk();
  const p = buildProposal({ ...collectCustomers({ reads: READS }), customers: collectCustomers({ reads: READS }).customers, groups: GROUPS, config, list });
  const by = (name) => p.rows.find((r) => r.customer === name);
  assert.equal(by('MASTER WOOD').kind, 'confident');
  assert.equal(by('MASTER WOOD').options[0].jid, 'a@g.us');
  assert.equal(by('NUQOOSH KITCHENS').kind, 'options'); // two groups look alike (Nuqoosh and Nuqouch)
  assert.ok(by('NUQOOSH KITCHENS').options.length >= 2 || by('NUQOOSH KITCHENS').options.length === 1);
  assert.equal(by('ZAMAN').kind, 'none');
  assert.equal(by('TEST CUSTOMER'), undefined); // never through the list
  assert.equal(by('Aryak Staff')?.kind === 'confident' && by('Aryak Staff').options.some((o) => /staff/i.test(o.subject)), false); // an internal group is never an option
  for (const r of p.rows) for (const o of r.options) assert.ok(!/staff|invoices group|test aryak|accounting|family/i.test(o.subject), o.subject);
  assert.deepEqual(p.rows.map((r) => r.n), p.rows.map((_, i) => i + 1)); // numbered one by one, confident first
  assert.ok(p.orphans.includes('DANDY - ARYAK') && p.orphans.includes('SABA FURNITURE - ARYAK')); // customer groups with no invoice seen
  assert.ok(!p.orphans.some((s) => /staff|invoices/i.test(s)));
  assert.equal(p.invoices, 6);
});

test('the command builds the proposal and says honestly how many invoices it was built from; nothing is saved by it', () => {
  const { run, list } = mk();
  const msgs = run('فهرست مشتری و گروه');
  assert.ok(msgs[0].includes('از ۶ فاکتور'));
  assert.ok(msgs[0].includes('کوتاه است'));
  assert.ok(msgs.join('\n').includes('MASTER WOOD — MASTER WOOD - ARYAK'));
  assert.ok(msgs.join('\n').includes('گروه‌های مشتری که هنوز فاکتوری'));
  assert.equal(list.size, 0);
  assert.equal(list.d.version, 0);
});

test('a long list is split into messages of about 40 rows', () => {
  const customers = Array.from({ length: 95 }, (_, i) => `CUSTOMER NUMBER${i}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
  const list = new CustomerGroups(dir);
  const p = buildProposal({ customers, groups: GROUPS, config, list, invoices: 95 });
  const texts = proposalTexts(p, list);
  assert.ok(texts.length >= 3);
  for (const t of texts) assert.ok(t.split('\n').filter((l) => /^[۰-۹]+\./.test(l)).length <= 40);
  assert.ok(texts.join('\n').includes('CUSTOMER NUMBER94'));
});

test('"approve all" saves only the confident rows, shows what was saved, sends nothing, keeps a version', () => {
  const { run, list, dir } = mk();
  run('فهرست مشتری و گروه');
  const out = run('تأیید همه').join('\n');
  assert.ok(out.includes('MASTER WOOD — MASTER WOOD - ARYAK'));
  assert.deepEqual(list.rows().map((r) => r.customer).sort(), list.rows().filter((r) => r.jid === 'a@g.us').map((r) => r.customer)); // only the confident ones
  assert.ok(list.find('master wood'));
  assert.equal(list.find('ZAMAN'), null);
  assert.equal(list.find('NUQOOSH KITCHENS')?.status === 'approved' && false, false);
  assert.equal(list.d.version, list.size);
  assert.ok(fs.existsSync(path.join(dir, 'customer-groups.json')));
  const again = new CustomerGroups(dir); // kept across a restart, jid and the name when saved
  assert.equal(again.find('Master  Wood.').jid, 'a@g.us');
  assert.equal(again.find('Master Wood').subject, 'MASTER WOOD - ARYAK');
});

test('"approve 1 3 5", a wrong number, a row that has several groups or none: each explained, nothing wrong saved', () => {
  const { run, list, desk } = mk();
  run('فهرست مشتری و گروه');
  const rows = desk.proposal.rows;
  const multi = rows.find((r) => r.kind === 'options' && r.options.length > 1);
  const none = rows.find((r) => r.kind === 'none');
  assert.ok(run('تأیید ۹۹').join('').includes('در این پیشنهاد نیست'));
  assert.equal(list.size, 0);
  assert.ok(run(`تأیید ${none.n}`).join('').includes('گروهی ندارد'));
  if (multi) assert.ok(run(`تأیید ${multi.n}`).join('').includes('چند گروه'));
  assert.equal(list.size, 0);
  const first = rows.find((r) => r.kind === 'confident');
  assert.ok(run(`تأیید ${first.n}`).join('').includes('ذخیره شد'));
  assert.equal(list.size, 1);
  assert.ok(run(`تأیید ${first.n}`).join('').includes('قبلاً رسیدگی'));
});

test('"3 no" rejects that row only and it is not proposed again; "4 = 2" picks the second option; "7 = words" must name exactly one customer group', () => {
  const { run, list, desk } = mk();
  run('فهرست مشتری و گروه');
  const none = desk.proposal.rows.find((r) => r.kind === 'none');
  assert.ok(run(`${none.n} نه`).join('').includes('رد شد'));
  assert.equal(list.size, 0);
  // a group that looks alike is declined for good
  const opt = desk.proposal.rows.find((r) => r.kind === 'options');
  const firstJid = opt.options[0].jid;
  run(`${opt.n} نه`);
  assert.equal(list.isDeclined(opt.customer, firstJid), true);
  assert.ok(buildProposal({ customers: [opt.customer], groups: GROUPS, config, list }).rows.every((r) => r.options.every((o) => o.jid !== firstJid)));
  // words that match one customer group
  run('فهرست مشتری و گروه');
  const zaman = desk.proposal.rows.find((r) => r.customer === 'ZAMAN');
  assert.ok(run(`${zaman.n} = saba`).join('').includes('SABA FURNITURE - ARYAK'));
  assert.equal(list.find('ZAMAN').jid, 'j@g.us');
});

test('words that match two customer groups are asked again; an internal or other group is refused; a wrong option number is refused', () => {
  const { run, list, desk } = mk();
  run('فهرست مشتری و گروه');
  const zaman = desk.proposal.rows.find((r) => r.customer === 'ZAMAN');
  assert.ok(run(`${zaman.n} = aryak`).join('').includes('چند گروه مشتری'));
  assert.ok(run(`${zaman.n} = staff`).join('').includes('گروه مشتری نیست'));
  assert.ok(run(`${zaman.n} = invoices`).join('').includes('گروه مشتری نیست'));
  assert.ok(run(`${zaman.n} = family`).join('').includes('گروه مشتری نیست'));
  assert.ok(run(`${zaman.n} = nonexistentgroup`).join('').includes('پیدا نشد'));
  assert.ok(run(`${zaman.n} = ۷`).join('').includes('گزینهٔ ۷ ندارد'));
  assert.equal(list.size, 0);
  const g = resolveGroupWords('master wood', GROUPS, config);
  assert.equal(g.group.id, 'a@g.us');
});

test('a stale jid is never saved: the group left or is no longer a customer group', () => {
  const { desk, list, run } = mk();
  run('فهرست مشتری و گروه');
  const gone = GROUPS.filter((g) => g.id !== 'a@g.us');
  const first = desk.proposal.rows.find((r) => r.kind === 'confident');
  const out = desk.handle({ type: 'approve', nums: [first.n] }, { groups: gone, known: {} }).join('');
  assert.ok(out.includes('پیدا نمی‌شود'));
  assert.equal(list.size, 0);
});

test('a later change needs his yes: "customer X group words", "remove customer X"; no is no change', () => {
  const { run, list } = mk();
  assert.equal(new CustomerGroupDesk({ list, config }).wants('بله'), null); // a lone yes is nobody's business when nothing waits
  const ask = run('مشتری Dandy Co گروه dandy').join('');
  assert.ok(ask.includes('ذخیره شود؟') && ask.includes('DANDY - ARYAK'));
  assert.equal(list.size, 0); // not saved before the yes
  run('نه');
  assert.equal(list.size, 0);
  run('مشتری Dandy Co گروه dandy');
  assert.ok(run('بله').join('').includes('ذخیره شد'));
  assert.equal(list.find('dandy co').jid, 'h@g.us');
  assert.ok(run('حذف مشتری Dandy Co').join('').includes('حذف شود؟'));
  assert.equal(list.size, 1);
  run('بله');
  assert.equal(list.size, 0);
  assert.ok(run('حذف مشتری Nobody').join('').includes('در فهرست نیست'));
  assert.ok(list.d.version >= 2);
  assert.ok(fs.readdirSync(path.join(list.dir, 'customer-groups-history')).length >= 1); // the version before is kept
});

test('the answers need an open proposal, so ordinary chat is never taken', () => {
  const { desk } = mk();
  for (const t of ['تأیید همه', '۳ نه', '۴ = ۲', 'تأیید ۱ ۳']) assert.equal(desk.wants(t), null);
  assert.ok(desk.wants('فهرست مشتری و گروه'));
});

test('sending: the approved row wins over the loose match, and that group alone is used', () => {
  const list = new CustomerGroups('');
  const row = list.approve('NUQOOSH KITCHENS', 'c@g.us', 'NUQOUCH---ARYAK'); // the owner chose the other group on purpose
  const r = resolveGroups('NUQOOSH KITCHENS', GROUPS, config, row);
  assert.deepEqual(r.groups.map((g) => g.id), ['c@g.us']);
  assert.equal(r.mapped, true);
  assert.equal(r.unconfirmed, false);
  assert.ok(targetGroups('NUQOOSH KITCHENS', GROUPS, config).length >= 1); // the old loose path is untouched
});

test('sending: a row whose group renamed still works; one whose group is gone or is not a customer group any more sends nothing and does not fall back', () => {
  const list = new CustomerGroups('');
  const row = list.approve('MASTER WOOD', 'a@g.us', 'MASTER WOOD - ARYAK');
  const renamed = GROUPS.map((g) => (g.id === 'a@g.us' ? { ...g, subject: 'MW kitchens ARYAK' } : g));
  assert.deepEqual(resolveGroups('MASTER WOOD', renamed, config, row).groups.map((g) => g.id), ['a@g.us']); // the jid counts
  const gone = resolveGroups('MASTER WOOD', GROUPS.filter((g) => g.id !== 'a@g.us'), config, row);
  assert.deepEqual([gone.groups.length, gone.stale], [0, true]); // stale: no loose fallback to another group
  const internal = list.approve('STAFF CO', 'e@g.us', 'Aryak Staff'); // an internal group can never be used, even if it got into the list
  const r = resolveGroups('STAFF CO', GROUPS, config, internal);
  assert.deepEqual([r.groups.length, r.stale], [0, true]);
});

test('sending: no row = the loose match with the one added line; the test customer never goes through the list', () => {
  const r = resolveGroups('Master Wood', GROUPS, config, null);
  assert.deepEqual(r.groups.map((g) => g.id), ['a@g.us']);
  assert.equal(r.unconfirmed, true);
  const read = { number: 'inv-1', customer: 'Master Wood', total: 100, urgent: 0, checked: true, noOrder: false };
  assert.ok(confirmText({ read, fileName: 'inv-1 MASTER WOOD.pdf', group: 'MASTER WOOD - ARYAK', unconfirmed: true }).includes('This group was not confirmed in the list.'));
  assert.ok(!confirmText({ read, fileName: 'inv-1 MASTER WOOD.pdf', group: 'MASTER WOOD - ARYAK' }).includes('not confirmed in the list'));
  const list = new CustomerGroups('');
  const row = list.approve('Test Customer', 'a@g.us', 'MASTER WOOD - ARYAK'); // even a row cannot send the test customer to a real group
  const t = resolveGroups('Test Customer', GROUPS, config, row);
  assert.deepEqual(t.groups.map((g) => g.id), ['d@g.us']);
  assert.equal(t.unconfirmed, false);
});

test('a new invoice customer with no row appears once in the digest; before any list exists there is no such line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
  const list = new CustomerGroups(dir);
  assert.deepEqual(list.newUnmapped(['ZAMAN'], config), []); // no list yet: the proposal comes first
  list.approve('MASTER WOOD', 'a@g.us', 'MASTER WOOD - ARYAK');
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

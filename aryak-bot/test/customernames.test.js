import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CustomerGroupDesk, CustomerGroups, NameBook, buildProposal, clearWinner, distinctive, mergeSources, parseListCommand, parseNameImport, rankGroups } from '../src/customergroups.js';
import { resolveGroups } from '../src/invoicesend.js';

// Invented names only: the real customer names never go into the repository.
const config = {
  shadowGroupNames: ['aryak'], testGroupNames: ['test aryak bot'], staffGroupNames: ['aryak staff'], invoiceGroupName: 'invoices group', infoGroupName: 'information group',
  cutGroupName: 'aryak orders pictures', observeExcludeNames: ['aryak accounting'], staffNumbers: [], testCustomerName: 'test customer', allowCustomerGroupSends: false, morningGroupNames: [],
};
const G = (id, subject) => ({ id: `${id}@g.us`, subject });
const GROUPS = [
  G('p1', 'BLUE POINT - ARYAK'), G('p2', 'BLUE CAPITAL - ARYAK'), G('d1', 'DELTA COMMERCIAL - ARYAK'), G('m1', 'AMIR DESIGNER - ARYAK'), G('g1', 'GOLDEN SUN - ARYAK'),
  G('k1', 'ZORVAN KITCHENS ORDERS - ARYAK'), G('s1', 'AL SHAM TRADING ARYAK'), G('o1', 'ORION - ARYAK'), G('o2', 'ORION TEAM GROUP - ARYAK'), G('x1', 'LONELY WORKS - ARYAK'),
  G('t1', 'TEST ARYAK BOT'), G('i1', 'Aryak Staff'), G('f1', 'Family chat'),
];
const rawNames = (...n) => `لیست نام مشتری‌ها\n${n.join('\n')}`;
const mk = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-'));
  const list = new CustomerGroups(dir);
  const book = new NameBook(dir);
  const desk = new CustomerGroupDesk({ list, config, book });
  return { dir, list, book, desk, run: (text, known = { customers: [], invoices: 0, aliasMap: {} }) => { const p = desk.wants(text); assert.ok(p, `not taken: ${text}`); return desk.handle(p, { groups: GROUPS, known }); } };
};

test('the import text: the header line, one name per line, numbers and bullets removed, each name once; any other text is not an import', () => {
  const r = parseNameImport('لیست نام مشتری‌ها\n1. Blue Point\n• Delta Trading\n\n  blue   point  \nOrion');
  assert.deepEqual(r.names, ['Blue Point', 'Delta Trading', 'Orion']);
  assert.deepEqual(parseListCommand(rawNames('A One')), { type: 'import', names: ['A One'] });
  assert.deepEqual(parseNameImport('لیست نام مشتری ها:\nA One').names, ['A One']);
  assert.equal(parseNameImport('فهرست مشتری و گروه'), null);
  assert.equal(parseNameImport('Blue Point\nDelta'), null);
});

test('import: she counts the names and asks; only a yes saves; "no" saves nothing', () => {
  const { run, book, desk } = mk();
  const out = run(rawNames('Blue Point', 'Delta Kitchen', 'Orion')).join('');
  assert.ok(out.includes('۳ نام مشتری دریافت شد') && out.includes('بله / نه'));
  assert.equal(book.size, 0); // nothing before the yes
  run('نه');
  assert.equal(book.size, 0);
  assert.equal(desk.pending, null);
  run(rawNames('Blue Point', 'Delta Kitchen', 'Orion'));
  assert.ok(run('بله').join('').includes('ذخیره شد: ۳ نام'));
  assert.deepEqual(book.names(), ['Blue Point', 'Delta Kitchen', 'Orion']);
});

test('import: several messages are merged (up to 400 names); a later import replaces the list, keeps the older version and never touches approved rows', () => {
  const { run, book, list, dir } = mk();
  run(rawNames('A One', 'B Two'));
  assert.ok(run(rawNames('B Two', 'C Three')).join('').includes('۳ نام مشتری')); // merged, no double
  run('بله');
  assert.equal(book.size, 3);
  list.approve('A One', 'p1@g.us', 'BLUE POINT - ARYAK');
  assert.ok(run(rawNames('X Ray')).join('').includes('جایگزین می‌شود'));
  run('بله');
  assert.deepEqual(book.names(), ['X Ray']);
  assert.equal(book.d.version, 2);
  assert.ok(fs.existsSync(path.join(dir, 'customer-names-history', 'customer-names-v1.json'))); // the older version is kept
  assert.ok(list.find('A One')); // the approved row is untouched
  const many = Array.from({ length: 450 }, (_, i) => `Name Number${i}`);
  const out = run(rawNames(...many)).join('');
  assert.ok(out.includes('۴۰۰ نام مشتری') && out.includes('۵۰ نام اضافه'));
  assert.equal(new NameBook(dir).size, 1); // and the file on disk is the saved one only
});

test('the import is taken only from the owner path: the wiring uses the owner rule, the library cannot write anywhere or log a name', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const block = src.slice(src.indexOf("THE OWNER'S FIXED LIST"), src.indexOf("THE OWNER ORDERS AN INVOICE INTO"));
  assert.match(block, /!group && isSelf/);
  assert.match(block, /isOwnerCommand\(/);
  const lib = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'customergroups.js'), 'utf8');
  assert.ok(!/logger|console\.|sendMessage|oneShot/.test(lib));
});

test('matching: generic words and the company name are dropped, "al sham" is "alsham", single letters are dropped', () => {
  assert.deepEqual(distinctive('ZORVAN KITCHENS ORDERS - ARYAK'), ['zorvan']);
  assert.deepEqual(distinctive('AL SHAM TRADING ARYAK'), ['sham']);
  assert.deepEqual(distinctive('Alsham Trading LLC'), ['sham']);
  assert.deepEqual(distinctive('Aryaak Wood Door Furniture Carpentry PVC Film Oman Dubai Group Team Company'), []);
  assert.deepEqual(distinctive('SY x NUQ Co'), ['sy', 'nuq']);
});

test('matching: spelling closeness counts (khaled/khalid, itquan/itqan, alsham/al sham)', () => {
  const groups = [G('a1', 'KHALID - ARYAK'), G('a2', 'ITQAN - ARYAK'), G('a3', 'AL SHAM TRADING ARYAK')];
  assert.equal(rankGroups(['Khaled'], groups)[0].group.id, 'a1@g.us');
  assert.equal(rankGroups(['Itquan Group'], groups)[0].group.id, 'a2@g.us');
  assert.equal(rankGroups(['Alsham'], groups)[0].group.id, 'a3@g.us');
});

test('matching: a two-word match beats a one-word match; the one-word false pairs are never confident', () => {
  const g = GROUPS.filter((x) => /ARYAK$/.test(x.subject) && !/TEST|Staff/.test(x.subject));
  const rank = (n) => rankGroups([n], g);
  const pointRank = rank('Blue Point');
  assert.equal(pointRank[0].group.id, 'p1@g.us'); // two words against one
  assert.equal(clearWinner(pointRank), true);
  assert.equal(clearWinner(rank('Blue Capital')), true);
  assert.equal(rank('Blue Capital')[0].group.id, 'p2@g.us');
  // one word shared, the other side has more words: options only
  assert.equal(clearWinner(rank('Delta Kitchen')), false); // delta vs delta commercial
  assert.equal(rank('Delta Kitchen')[0].group.id, 'd1@g.us'); // still offered
  assert.equal(clearWinner(rank('Designer Wood')), false); // designer vs amir designer
  assert.equal(clearWinner(rank('Golden Door')), false); // golden vs golden sun
  assert.equal(clearWinner(rank('Blue')), false); // a bare "blue" fits two groups
});

test('the proposal over the imported names: confident only on a clear winner, the rest with options, then the groups with no name', () => {
  const { list } = mk();
  const p = buildProposal({ customers: ['Blue Point', 'Delta Kitchen', 'Zorvan', 'Nobody Known'], groups: GROUPS, config, list, invoices: 2, sources: { fromBook: 4, fromInvoices: 0 } });
  const by = (n) => p.rows.find((r) => r.customer === n);
  assert.equal(by('Blue Point').kind, 'confident');
  assert.equal(by('Zorvan').kind, 'confident'); // kitchens and orders are generic: the same name
  assert.equal(by('Delta Kitchen').kind, 'options');
  assert.equal(by('Nobody Known').kind, 'none');
  assert.ok(p.orphans.includes('LONELY WORKS - ARYAK')); // no customer name close to it: he writes the name
  assert.ok(!p.orphans.some((s) => /BLUE POINT/.test(s)));
});

test('the head line says how many names came from which source', () => {
  const { run, book } = mk();
  book.save(['Blue Point', 'Orion', 'Zorvan']);
  const known = { customers: ['Zorvan', 'Fresh Invoice Customer'], invoices: 5, aliasMap: {} };
  const head = run('فهرست مشتری و گروه', known)[0].split('\n')[0];
  assert.ok(head.includes('۳ نام فهرست حسابداری') && head.includes('۱ نام تازه') && head.includes('۵'), head);
  assert.deepEqual(mergeSources(['A One', 'b two'], { customers: ['B Two', 'C Three'], invoices: 9 }), { customers: ['A One', 'b two', 'C Three'], invoices: 9, fromBook: 2, fromInvoices: 1 });
});

test('one customer, two groups: both are offered, he picks "1 2", the row holds both, and a send asks which one (never both)', () => {
  const { run, list, desk } = mk();
  book: run(rawNames('Orion', 'Blue Point'));
  run('بله');
  run('فهرست مشتری و گروه');
  const orion = desk.proposal.rows.find((r) => r.customer === 'Orion');
  assert.equal(orion.kind, 'options');
  assert.deepEqual(orion.options.map((o) => o.jid).sort(), ['o1@g.us', 'o2@g.us']);
  assert.ok(run(`تأیید ${orion.n}`).join('').includes('دو گروه')); // not approved by a bare number
  const out = run(`${orion.n} = ۱ ۲`).join('');
  assert.ok(out.includes('ORION - ARYAK + ORION TEAM GROUP - ARYAK') || out.includes('ORION TEAM GROUP - ARYAK + ORION - ARYAK'));
  const row = list.find('Orion');
  assert.equal(row.groups.length, 2);
  const r = resolveGroups('Orion', GROUPS, config, row);
  assert.deepEqual(r.groups.map((x) => x.id).sort(), ['o1@g.us', 'o2@g.us']); // the existing choose step lists them
  assert.equal(r.unconfirmed, false);
  const one = resolveGroups('Orion', GROUPS.filter((x) => x.id !== 'o2@g.us'), config, row); // one of the two is gone: only the other
  assert.deepEqual(one.groups.map((x) => x.id), ['o1@g.us']);
  const none = resolveGroups('Orion', GROUPS.filter((x) => !/^o[12]/.test(x.id)), config, row);
  assert.deepEqual([none.groups.length, none.stale], [0, true]);
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(src, /if \(groups\.length > 1\) \{ sendDesk\.start\(chatId, \{ step: 'choose'/); // several groups = he chooses by number
});

test('"customer X group a + b" gives one customer two groups after a yes; an internal group in the pair refuses the whole row', () => {
  const { run, list } = mk();
  const ask = run('مشتری Orion گروه orion team + lonely').join('');
  assert.ok(ask.includes('ORION TEAM GROUP - ARYAK + LONELY WORKS - ARYAK'));
  assert.equal(list.size, 0);
  run('بله');
  assert.equal(list.find('orion').groups.length, 2);
  assert.ok(run('مشتری Orion گروه orion team + staff').join('').includes('گروه مشتری نیست'));
  assert.equal(list.find('orion').groups.length, 2); // unchanged
});

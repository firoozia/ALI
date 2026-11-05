import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CustomerGroupDesk, CustomerGroups, NameBook, clearWinner, distinctive, mergeSources, parseListCommand, parseNameImport, rankCustomers } from '../src/customergroups.js';

// Invented names only: the real customer names never go into the repository.
const config = {
  shadowGroupNames: ['aryak'], testGroupNames: ['test aryak bot'], staffGroupNames: ['aryak staff'], invoiceGroupName: 'invoices group', infoGroupName: 'information group',
  cutGroupName: 'aryak orders pictures', observeExcludeNames: ['aryak accounting'], staffNumbers: [], testCustomerName: 'test customer', allowCustomerGroupSends: false, morningGroupNames: [],
};
const rawNames = (...n) => `لیست نام مشتری‌ها\n${n.join('\n')}`;
const mk = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-'));
  const list = new CustomerGroups(dir);
  const book = new NameBook(dir);
  const desk = new CustomerGroupDesk({ list, config, book });
  return { dir, list, book, desk, run: (text) => { const p = desk.wants(text); assert.ok(p, `not taken: ${text}`); return desk.handle(p, { groups: [], known: { customers: [], invoices: 0, aliasMap: {} } }); } };
};
const people = (...names) => names.map((name) => ({ name, alts: [] }));

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

test('generic words: the company name, trade words, company forms and place words never tell customers apart; a distinctive word has four letters or more', () => {
  assert.deepEqual(distinctive('ZORVAN KITCHENS ORDERS - ARYAK'), ['zorvan']);
  assert.deepEqual(distinctive('AL SHAM TRADING ARYAK'), ['sham']);
  assert.deepEqual(distinctive('Alsham Trading LLC'), ['sham']);
  assert.deepEqual(distinctive('Aryaak Wood Door Furniture Carpentry PVC Film Oman Dubai Group Team Company'), []);
  for (const w of ['design', 'designs', 'designer', 'building', 'bulding', 'contracting', 'technical', 'works', 'work', 'factory', 'international', 'intl', 'commercial', 'decor', 'decoration', 'joinery', 'interior', 'general', 'services', 'maintenance', 'street', 'sharjah']) assert.deepEqual(distinctive(`Nova ${w}`), ['nova'], w);
  assert.deepEqual(distinctive('SY x NUQ Co Dash'), ['dash']); // under four letters is not distinctive
});

test('matching: spelling closeness counts (khaled/khalid, itquan/itqan, alsham/al sham)', () => {
  const c = people('Khalid', 'Itqan', 'Al Sham');
  assert.equal(rankCustomers('KHALED - ARYAK', c)[0].customer, 'Khalid');
  assert.equal(rankCustomers('ITQUAN GROUP - ARYAK', c)[0].customer, 'Itqan');
  assert.equal(rankCustomers('ALSHAM TRADING - ARYAK', c)[0].customer, 'Al Sham');
});

test('matching: a two-word match beats a one-word match; the false pairs are never a clear winner', () => {
  const c = people('Blue Point', 'Blue Capital', 'Atlas Kitchen', 'Atlas Commercial', 'Golden Door', 'Golden Sun', 'Amir Designer', 'Designer Wood');
  const rank = (s) => rankCustomers(s, c);
  assert.equal(rank('BLUE POINT - ARYAK')[0].customer, 'Blue Point');
  assert.equal(clearWinner(rank('BLUE POINT - ARYAK')), true);
  assert.equal(clearWinner(rank('BLUE CAPITAL - ARYAK')), true);
  assert.equal(rank('BLUE CAPITAL - ARYAK')[0].customer, 'Blue Capital');
  assert.equal(clearWinner(rank('ATLAS - ARYAK')), false); // atlas kitchen and atlas commercial are the same distinctive word
  assert.equal(clearWinner(rank('GOLDEN - ARYAK')), false); // golden door / golden sun
  assert.equal(clearWinner(rank('BLUE - ARYAK')), false); // a bare "blue" fits two customers
  assert.equal(rank('DESIGNER WOOD - ARYAK').length, 0); // designer and wood say nothing: no candidate at all
});

test('the main group and the branch group each get their own customer', () => {
  const c = people('Master Wood', 'Master Wood Branch');
  const main = rankCustomers('MASTER WOOD - ARYAK', c);
  const branch = rankCustomers('MASTER WOOD BRANCH - ARYAK', c);
  assert.equal(main[0].customer, 'Master Wood');
  assert.equal(clearWinner(main), true);
  assert.equal(branch[0].customer, 'Master Wood Branch');
  assert.equal(clearWinner(branch), true);
});

test('mergeSources: the imported names first, then the names only the invoices have, counted by source', () => {
  assert.deepEqual(mergeSources(['A One', 'b two'], { customers: ['B Two', 'C Three'], invoices: 9 }), { customers: ['A One', 'b two', 'C Three'], invoices: 9, fromBook: 2, fromInvoices: 1 });
});

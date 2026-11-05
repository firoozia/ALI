import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CustomerGroupDesk, CustomerGroups, NameBook, learnPrintedName, nearDuplicate, settleDuplicates } from '../src/customergroups.js';
import { NameStore } from '../src/nameline.js';
import { Aliases } from '../src/aliases.js';
import { validateChanges, understandTeaching } from '../src/teach.js';

// Invented names only: the real customer names never go into the repository.
const config = {
  shadowGroupNames: ['aryak'], observeGroupNames: ['aryak'], testGroupNames: ['test aryak bot'], staffGroupNames: ['aryak staff'], invoiceGroupName: 'invoices group', infoGroupName: 'information group',
  cutGroupName: 'aryak orders pictures', observeExcludeNames: ['aryak accounting'], staffNumbers: [], testCustomerName: 'test customer', allowCustomerGroupSends: false, morningGroupNames: [], model: 'm',
};
const G = (id, subject) => ({ id: `${id}@g.us`, subject });
const GROUPS = [G('o1', 'ORION - ARYAK'), G('k1', 'KHALID - ARYAK'), G('s0', 'Aryak Staff')];
const mk = (names) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'du-'));
  const list = new CustomerGroups(path.join(dir, 'cg'));
  const book = new NameBook(path.join(dir, 'cg'));
  book.save(names);
  const aliases = new Aliases(path.join(dir, 'aliases'));
  const desk = new CustomerGroupDesk({ list, config, book });
  const known = (invoiceNames) => ({ customers: invoiceNames, invoices: invoiceNames.length, aliasMap: aliases.map, addAlias: (m, o) => aliases.add(m, o) });
  return { dir, list, book, aliases, desk, run: (text, invoiceNames = []) => { const p = desk.wants(text); assert.ok(p, text); return desk.handle(p, { groups: GROUPS, known: known(invoiceNames) }); } };
};

test('one customer written twice: a short and a long form, two spellings; but not two different customers', () => {
  assert.equal(nearDuplicate('Orion', 'Orion Furniture Industries LLC'), true);
  assert.equal(nearDuplicate('Orion Trading', 'ORION'), true);
  assert.equal(nearDuplicate('Khaled', 'Khalid Trading Co'), true);
  assert.equal(nearDuplicate('Al Sham', 'Alsham Trading'), true);
  assert.equal(nearDuplicate('Blue Point', 'Blue Point Co.'), true);
  assert.equal(nearDuplicate('Atlas Kitchen', 'Atlas Commercial'), false); // each has a word the other lacks
  assert.equal(nearDuplicate('Master Wood', 'Master Wood Branch'), false); // a branch is a different customer
  assert.equal(nearDuplicate('Blue Point', 'Blue Capital'), false);
  assert.equal(nearDuplicate('Orion', 'Cedar'), false);
  assert.equal(nearDuplicate('Designer Wood', 'Designer Wood Carpentry'), false); // generic-only names are never merged by code
});

test('the invoice name wins without a question; neither seen = a question; both seen = left alone', () => {
  const names = ['Orion', 'Orion Furniture Industries LLC', 'Khaled', 'Khalid Trading', 'Blue Point', 'Blue Point Co', 'Cedar'];
  const r = settleDuplicates(names, ['Orion Furniture Industries LLC', 'Blue Point', 'Blue Point Co']);
  assert.deepEqual(r.merges, [{ main: 'Orion Furniture Industries LLC', others: ['Orion'] }]); // one seen: it wins
  assert.deepEqual(r.ask, [['Khaled', 'Khalid Trading']]); // neither seen: ask
  assert.ok(!r.merges.some((m) => m.main.startsWith('Blue')) && !r.ask.some((g) => g.includes('Blue Point'))); // both printed on invoices: no merge, no question
});

test('the proposal merges the accounting duplicates on its own (the invoice name stays main, the other becomes its alias) and says so', () => {
  const { run, aliases, book, list } = mk(['Orion', 'Orion Furniture Industries LLC', 'Cedar']);
  const out = run('فهرست مشتری و گروه', ['Orion Furniture Industries LLC']).join('\n');
  assert.equal(aliases.resolve('Orion', []), 'Orion Furniture Industries LLC');
  assert.ok(out.includes('خودم یکی کردم') && out.includes('Orion Furniture Industries LLC ← Orion'));
  assert.ok(!out.includes('نام درست را با'));
  assert.deepEqual(book.names(), ['Orion', 'Orion Furniture Industries LLC', 'Cedar']); // the accounting list stays as imported
  const row = list.d.proposal.rows.find((r) => r.group?.jid === 'o1@g.us' || r.groups?.some((g) => g.jid === 'o1@g.us'));
  assert.equal(row.customer, 'Orion Furniture Industries LLC'); // one customer, offered once, under the invoice name
  assert.equal(list.size, 0); // and no approved row was written
});

test('neither name seen on an invoice: he is asked once, and "main name" remembers his choice', () => {
  const { run, aliases, desk } = mk(['Khaled', 'Khalid Trading']);
  const out = run('فهرست مشتری و گروه').join('\n');
  assert.ok(out.includes('Khaled / Khalid Trading') && out.includes('نام اصلی'));
  assert.equal(desk.proposal.dupAsk.length, 1);
  assert.ok(run('نام اصلی Khalid Trading').join('').includes('«Khalid Trading» نام اصلی است'));
  assert.equal(aliases.resolve('Khaled', []), 'Khalid Trading');
  assert.ok(run('نام اصلی Nobody Known').join('').includes('در فهرست نام‌ها نیست'));
});

test('a new invoice name that clearly is a stored customer: the row stays where it is, the printed name becomes main, one digest line, no group moved', () => {
  const { list, aliases } = mk([]);
  list.approve('Orion', 'o1@g.us', 'ORION - ARYAK');
  const before = JSON.stringify(list.d.rows);
  const note = learnPrintedName('ORION FURNITURE INDUSTRIES LLC', { list, aliases, config });
  assert.ok(note.includes('ORION FURNITURE INDUSTRIES LLC') && note.includes('same group kept'));
  assert.equal(JSON.stringify(list.d.rows), before); // the approved row is untouched
  assert.equal(aliases.resolve('Orion', []), 'ORION FURNITURE INDUSTRIES LLC');
  assert.deepEqual(list.find('ORION FURNITURE INDUSTRIES LLC', ['Orion'])?.groups.map((g) => g.jid), ['o1@g.us']);
  assert.equal(learnPrintedName('ORION FURNITURE INDUSTRIES LLC', { list, aliases, config }), null); // once
  assert.equal(learnPrintedName('Cedar Wood Works', { list, aliases, config }), null); // not a stored customer
  assert.equal(learnPrintedName('Test Customer', { list, aliases, config }), null);
  list.addNote(note);
  assert.deepEqual(list.takeNotes(), [note]);
  assert.deepEqual(list.takeNotes(), []); // named once in the digest
});

test('the name store tells the hook only the first time an invoice message is read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'du-'));
  const store = new NameStore(dir);
  const seen = [];
  store.onCustomer = (c) => seen.push(c);
  store.remember('m1', 'inv-1', 'Orion Co');
  store.remember('m1', 'inv-1', 'Orion Co');
  store.onCustomer = () => { throw new Error('boom'); };
  store.remember('m2', 'inv-2', 'Cedar'); // a failing note never stops the invoice flow
  assert.deepEqual(seen, ['Orion Co']);
  assert.equal(store.recall('m2').customer, 'Cedar');
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /nameStore\.onCustomer = \(printed\) => \{ const note = learnPrintedName\(/);
  assert.match(src, /customerGroups\.takeNotes\(\)\.map/); // and the digest carries the lines
  const lib = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'customergroups.js'), 'utf8').replace(/\r\n/g, '\n');
  const at = lib.indexOf('export function learnPrintedName');
  const fn = lib.slice(at, lib.indexOf('// ----', at));
  assert.ok(!/approveGroups|\.remove\(|approve\(/.test(fn)); // it never writes or moves a row
});

test('teaching: a question "is X the same customer" is not asked when an invoice already settled it; the alias is not offered again', async () => {
  const ctx = { customers: ['Orion Furniture Industries LLC', 'Cedar'], groups: GROUPS, config, same: [['Orion Furniture Industries LLC', 'Orion']] };
  const v = validateChanges({ changes: [{ kind: 'alias', customer: 'Orion Furniture Industries LLC', alias: 'Orion' }, { kind: 'alias', customer: 'Cedar', alias: 'Cedar Co' }], questions: ['Is Orion the same customer as Orion Furniture Industries LLC?', 'Which Cedar?'] }, ctx, 'x');
  assert.deepEqual(v.items.map((i) => i.data.alias), ['Cedar Co']);
  assert.deepEqual(v.questions, ['Which Cedar?']);
  let prompt = '';
  const client = { beta: { messages: { create: async (p) => { prompt = p.messages[0].content; return { content: [{ type: 'text', text: '{"changes":[]}' }] }; } } } };
  await understandTeaching({ client, config, text: 'x', customers: ctx.customers, groups: GROUPS, same: ctx.same });
  assert.ok(prompt.includes('ALREADY THE SAME CUSTOMER') && prompt.includes('Orion Furniture Industries LLC = Orion'));
});

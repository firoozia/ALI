import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GroupStatements, StatementPreviews, parseStyleReply, previewText, statementAsk } from '../src/groupstatement.js';
import { parseStatementRequest } from '../src/period.js';
import { pickSpoken } from '../src/translit.js';

// Invented customer names only.
const TODAY = '2026-11-09';
const NAMES = ['GOLDEN DOOR KITCHEN EQUIPMENT TRADING -SOLE PROPRIETORSHIP L.L.C', 'GOLD STAR CARPENTRY', 'ZED TRADING'];

test('both phrasings: a typo in the name and a missing space in the dates are read; dd/mm, the year is this one', () => {
  const a = parseStatementRequest('atossa statement goolden door month 10', TODAY);
  assert.equal(a.customer, 'goolden door'); assert.deepEqual([a.period.from, a.period.to], ['2026-10-01', '2026-10-31']);
  const b = parseStatementRequest('atossa statement goolden door 1/9 to30/9', TODAY);
  assert.equal(b.customer, 'goolden door'); assert.deepEqual([b.period.from, b.period.to], ['2026-09-01', '2026-09-30']);
  for (const t of ['atossa statement goolden door 1/9 to 30/9', 'atossa statement goolden door 1/9-30/9', 'atossa statement goolden door from 1/9/2026 to30/9/2026']) assert.deepEqual([parseStatementRequest(t, TODAY).period.from, parseStatementRequest(t, TODAY).period.to], ['2026-09-01', '2026-09-30'], t);
  assert.equal(statementAsk('atossa statement goolden door 1/9 to30/9').customer, 'goolden door');
  const found = pickSpoken('goolden door', NAMES, { strong: 0.7 }); // the fuzzy customer: the nearest name, not asked about
  assert.equal(found.kind, 'one'); assert.equal(found.best.name, NAMES[0]);
});

test('the preview: the customer, the exact period, two numbered choices; replies carry the code when several wait', () => {
  const base = { id: 'S5', name: NAMES[0], from: '2026-09-01', to: '2026-09-30' };
  assert.equal(previewText(base), `*Statement* #S5\nCustomer: *${NAMES[0]}*\nPeriod: 01/09/2026 – 30/09/2026\n1. Balance forward\n2. Transaction statement\nReply 1 or 2 (or No)`);
  const two = previewText({ ...base, several: true, guessed: true, typed: 'goolden door' });
  assert.match(two, /Customer: \*GOLDEN DOOR[^\n]*\* \(guessed from "goolden door"\)/); assert.match(two, /Reply 1 #S5 or 2 #S5 \(or No #S5\)$/);
  assert.match(previewText(base, true), /^\*صورت‌حساب\* #S5\nمشتری: \*GOLDEN/);
});

test('the answers: «1» and «2» bare or with the code, «No» cancels, anything else is not an answer', () => {
  assert.deepEqual(parseStyleReply('1'), { kind: 'style', style: 'balance', id: '' });
  assert.deepEqual(parseStyleReply('2'), { kind: 'style', style: 'transaction', id: '' });
  assert.deepEqual(parseStyleReply('۲'), { kind: 'style', style: 'transaction', id: '' });
  assert.deepEqual(parseStyleReply('1 #S5'), { kind: 'style', style: 'balance', id: 'S5' });
  assert.deepEqual(parseStyleReply('2 s5'), { kind: 'style', style: 'transaction', id: 'S5' });
  assert.deepEqual(parseStyleReply('No'), { kind: 'no', id: '' }); assert.deepEqual(parseStyleReply('no #S5'), { kind: 'no', id: 'S5' }); assert.deepEqual(parseStyleReply('نه'), { kind: 'no', id: '' });
  for (const t of ['3', '12', '1 2', 'yes', 'hello 1', '1 please', '']) assert.equal(parseStyleReply(t), null, t);
});

test('the waiting previews: one code space with the held statements, per person, half an hour, one use; two waiting need the code', () => {
  let t = 1000;
  const held = new GroupStatements({ now: () => t });
  const pv = new StatementPreviews({ nextId: () => held.nextId(), now: () => t });
  const run = () => {};
  const first = held.add({ groupId: 'g@g.us', subject: 'G', held: {}, name: 'X' }); assert.equal(first, 'S1');
  const a = pv.add({ by: 'owner', name: 'A', from: '2026-09-01', to: '2026-09-30', run }); const b = pv.add({ by: '9715', name: 'B', from: '2026-09-01', to: '2026-09-30', run }); const c2 = pv.add({ by: '9715', name: 'C', from: '2026-09-01', to: '2026-09-30', run });
  assert.deepEqual([a, b, c2], ['S2', 'S3', 'S4']); // never the same code as a held statement
  assert.deepEqual(pv.openIds('9715'), ['S3', 'S4']); assert.deepEqual(pv.openIds('owner'), ['S2', 'S3', 'S4']); assert.deepEqual(pv.openIds('1234'), []);
  pv.clear('s3'); assert.equal(pv.get('S3'), null); t += 31 * 60 * 1000; assert.equal(pv.get('S4'), null); assert.deepEqual(pv.openIds('owner'), []);
});

test('the wiring: every request origin shows the preview first and builds only after the choice; the replies are read where the request came from; the statement permission still rules', () => {
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  for (const v of ['ic', 'nl', 'ask']) assert.ok(index.includes(`style: ${v}.style, preview: !${v}.style`), v); // the owner's chat, a private chat, an internal group (an explicit «balance» skips the question)
  assert.match(index, /statementFor\(customer, \{ hold: true, period, style, preview: !style \}\)/); // a customer group: privately to the requester
  assert.match(index, /if \(may && await styleReplyFlow\(\{ text, by,/); // internal groups: only owner or authorized
  assert.match(index, /if \(person && canStatement && await styleReplyFlow\(/); // a private chat: the statement permission
  assert.match(index, /isSelf\) \{\n    if \(await allStatementFlow\(\{ text, say: \(t\) => reply\(t\) \}\)\) return true;[^\n]*\n    if \(await styleReplyFlow\(\{ text, by: 'owner'/); // the owner's own chat
  const fn = index.slice(index.indexOf('async function styleReplyFlow'), index.indexOf('async function trackGroup') > 0 ? index.indexOf('const sayIn') : undefined);
  assert.ok(fn.indexOf('qboInvoices.guard()') < fn.indexOf('p.run(r.style)')); // the kill switch is checked before anything is built
  const desk = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'qbodesk.js'), 'utf8');
  assert.ok(desk.indexOf('if (preview)') < desk.indexOf('buildStatementData({ ...(await loadCustomerData(this.qbo, found.id))')); // nothing is read or built for a preview
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NameStore, meaninglessName, nameLineText, nameMode, readableFileName } from '../src/nameline.js';
import { AvailabilityDesk, runAvailability } from '../src/availability.js';
import { ShadowDesk, ShadowStore, compareCodes } from '../src/shadow.js';

test('a meaningless file name is a GUID or a name with no word in it; a normal name gets nothing', () => {
  assert.equal(meaninglessName('2b3da06e-d0d7-442d-ae69-f9df73664f13.pdf'), true);
  assert.equal(meaninglessName('2B3DA06ED0D7442DAE69F9DF73664F13.pdf'), true);
  assert.equal(meaninglessName('20261105_123456.pdf'), true);
  assert.equal(meaninglessName('.pdf'), true);
  assert.equal(meaninglessName('Invoice 9919 Master Wood.pdf'), false);
  assert.equal(meaninglessName('Invoice inv-9903 dandy.pdf'), false);
  assert.equal(meaninglessName('inv-9919 MASTER WOOD.pdf'), false); // her own name is never "meaningless"
});

test('the readable name and the one-line fallback come only from the invoice number and the customer', () => {
  assert.equal(readableFileName('INV-9919', 'Master Wood'), 'inv-9919 MASTER WOOD.pdf');
  assert.equal(nameLineText('inv-9919', 'Master Wood'), 'Invoice inv-9919 - MASTER WOOD');
  assert.equal(readableFileName('inv-1', 'A/B: "C"* <D>?'), 'inv-1 A B C D.pdf'); // safe characters only
  assert.equal(readableFileName('', 'Master Wood'), ''); // number missing: silent
  assert.equal(readableFileName('inv-9919', ''), ''); // customer missing: silent
  assert.equal(nameLineText('', ''), '');
  assert.deepEqual(['file', 'line', 'off', 'file', 'off'].map((x, i) => nameMode([undefined, 'line', 'off', 'on', 'false'][i])), ['file', 'line', 'off', 'file', 'off']);
});

test('one rename per message and per invoice number, kept across a restart; her own file name is recognised', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-'));
  let clock = 1000;
  const s = new NameStore(dir, () => clock);
  assert.equal(s.named('m1', 'inv-9919'), false);
  s.markNamed('m1', 'inv-9919', 'inv-9919 MASTER WOOD.pdf');
  assert.equal(s.named('m1', 'inv-9919'), true); // the same message
  assert.equal(s.named('m2', 'INV-9919'), true); // the same invoice forwarded: another message, the same number
  assert.equal(s.named('m3', 'inv-9920'), false);
  const again = new NameStore(dir, () => clock);
  assert.equal(again.named('m9', 'inv-9919'), true); // after a restart
  assert.equal(again.isOwnName('inv-9919 MASTER WOOD.pdf'), true); // her re-post coming back
  assert.equal(again.isOwnName('Invoice 9919.pdf'), false);
  clock += 25 * 3600 * 1000;
  assert.equal(again.isOwnName('inv-9919 MASTER WOOD.pdf'), false); // a day later it is just a file
  s.remember('m5', 'inv-5', 'Bahar');
  assert.deepEqual(new NameStore(dir).recall('m5'), { number: 'inv-5', customer: 'Bahar' });
  assert.equal(new NameStore(dir).recall('none'), null);
});

test('the wiring: the rename runs only in the Invoices group and the test group, never counts as a problem, ignores her own re-post, read failure is silent', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function nameInvoice'), src.indexOf('async function watchGroup'));
  assert.match(fn, /readableFileName\(number, customer\)/);
  assert.match(fn, /if \(!file\) return false;/); // number or customer missing: silent, no "could not read" text
  assert.ok(!/could not read/i.test(fn));
  assert.match(fn, /meaninglessName\(fileName\)/);
  assert.match(fn, /nameStore\.named\(raw\.key\.id, number\)/); // deduped by message and number
  assert.match(fn, /invoiceNameMode === 'file' && base64/); // the re-post, else the line
  // the callers: the Invoices-group flow, the test group, and the explicit request (Invoices group or test group only)
  assert.equal((src.match(/await nameInvoice\(|=> nameInvoice\(/g) || []).length, 3);
  assert.match(src, /\(group\?\.test \|\| group\?\.invoice\) && \/\\brename\\b/);
  assert.match(src, /after: group\?\.test \?/);
  // her own re-post is ignored in both routes
  assert.equal((src.match(/nameStore\.isOwnName\(/g) || []).length, 2);
  // the name line is not an invoice problem: it is sent by the naming function, not through the problem list
  assert.ok(!/nameInvoice[^\n]*problems/.test(src));
});

// ------------------------------------------------------------------------------------------ nothing free: do not ask the quantity
test('a bare availability question about a code with nothing free is answered "not available now", not with a quantity question', async () => {
  const sent = [];
  const logs = [];
  const run = (lookup, text = '407 AVAILBLE', lang) => runAvailability({
    messages: [{ text, sender: 'a' }], groupId: 'g', groupName: 'x', customer: 'x', desk: new AvailabilityDesk({ dir: '' }),
    decide: async () => ({ kind: 'unhandled' }), lookup, send: async (g, t) => { sent.push(t); }, notifyManager: async () => null, log: (s) => logs.push(s),
  });
  await run(async () => 'none');
  assert.match(sent[0], /^407: .*not available/i);
  assert.ok(!/how many/i.test(sent[0]));
  assert.ok(logs.some((l) => /^answered not available for 1 code/.test(l)));
  sent.length = 0;
  await run(async () => 'ok');
  assert.match(sent[0], /how many/i); // something is free: the quantity is asked
  sent.length = 0;
  await run(async (c) => (c === '220' ? 'none' : 'ok'), '406 AND 220 AVAILBLE');
  assert.equal(sent.length, 2);
  assert.match(sent[0], /^220: .*not available/i);
  assert.match(sent[1], /how many/i);
  sent.length = 0;
  await run(async () => 'unknown'); // sheet unsure: the old behaviour, ask
  assert.match(sent[0], /how many/i);
  sent.length = 0;
  await run(null); // no lookup given: the old behaviour
  assert.match(sent[0], /how many/i);
});

test('the real path and the shadow path use the same sheet lookup before asking', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.equal((src.match(/lookup: async \(code\) =>/g) || []).length, 2);
  assert.match(src, /async function stockState\(code\)/);
});

test('the comparison scores the stance: staff "No" against a card that has the code in stock is different; against nothing free it is the same', async () => {
  assert.equal(compareCodes({ 407: 'yes' }, ['No']), 'different');
  assert.equal(compareCodes({ 407: 'no' }, ['No']), 'same');
  const mk = (stances, reply) => {
    const posts = [];
    const timers = [];
    const desk = new ShadowDesk({
      store: new ShadowStore(), post: async (t) => { posts.push(t); }, config: { timezone: 'UTC', shadowCardCap: 10 },
      analyze: async () => ({ action: 'answer', reply, lang: 'en', stances, calls: 0 }), setTimer: (fn) => { timers.push(fn); return timers.length - 1; }, clearTimer: () => {}, now: () => 0,
    });
    return { desk, posts, timers };
  };
  const a = mk({ 407: 'yes' }, '407: how many metres do you need?');
  a.desk.onMessage({ groupId: 'g', subject: 's', label: 's', staff: false, text: '407 AVAILBLE', at: 0 });
  a.desk.onMessage({ groupId: 'g', subject: 's', label: 's', staff: true, text: 'No', at: 1000 });
  await a.desk.idle();
  assert.match(a.posts[0], /Staff said: No — different/);
  const b = mk({ 407: 'no' }, '407: sorry, not available at the moment.');
  b.desk.onMessage({ groupId: 'g', subject: 's', label: 's', staff: false, text: '407 AVAILBLE', at: 0 });
  b.desk.onMessage({ groupId: 'g', subject: 's', label: 's', staff: true, text: 'No', at: 1000 });
  await b.desk.idle();
  assert.match(b.posts[0], /Staff said: No — same/);
});

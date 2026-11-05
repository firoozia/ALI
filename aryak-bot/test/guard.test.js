import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { groupAllowed, guardedSend, observedGroup, privateAllowed } from '../src/guard.js';
import { Tracker } from '../src/tracker.js';
import { isSourcingRequest, markSourcingReceived, openSourcing, sourcingAnswer, sourcingCover, sourcingDigest, sourcingEvent } from '../src/sourcing.js';
import { orderLinesOf } from '../src/orderlines.js';

const config = {
  staffGroupNames: ['aryak staff'], commandGroupNames: ['atossa command'], testGroupNames: ['test aryak bot'], goodsGroupNames: ['accessories', 'saw blade'],
  invoiceGroupName: 'invoices group', infoGroupName: 'information group', cutGroupName: 'aryak orders pictures', deliveryGroupName: 'aryak order delivery pics', confirmGroupName: 'confirmation group',
  morningGroupNames: ['good morning list'], observeGroupNames: ['aryak'], observeExcludeNames: ['aryak accounting', 'aryak llc discussions'],
  staffNumbers: ['971500000001'], adminNumbers: ['971500000002'], ownerNumbers: ['971557699100'], salesManager: '971500000003@s.whatsapp.net', allowCustomerGroupSends: false,
};
const CUSTOMER_GROUPS = ['Master Wood - ARYAK', 'PVC Works', 'Dandy Door', 'Family chat', 'Bahar Kitchen ARYAK'];
const INTERNAL_GROUPS = ['TEST ARYAK BOT', 'Aryak Staff', 'Atossa Command', 'Invoices group', 'Information group', 'Aryak Orders Pictures', 'Aryak Order Delivery Pics', 'Confirmation group', 'Accessories', 'SAW BLADE & GLUE ORDER PICTURES', 'Good morning list'];

test('a customer group is never written to; internal, test and morning-list groups are', () => {
  for (const g of CUSTOMER_GROUPS) assert.equal(groupAllowed(g, config).ok, false, g);
  for (const g of INTERNAL_GROUPS) assert.equal(groupAllowed(g, config).ok, true, g);
  assert.equal(groupAllowed('Master Wood', { ...config, allowCustomerGroupSends: true }).ok, true); // the switch for later
});

test('private chats: only staff, an administrator, the owner, the sales manager, the account itself or a chat a staff member started', () => {
  for (const j of ['971500000001@s.whatsapp.net', '971500000002@s.whatsapp.net', '971557699100@s.whatsapp.net', '971500000003@s.whatsapp.net']) assert.equal(privateAllowed(j, config), true, j);
  assert.equal(privateAllowed('971599999999@s.whatsapp.net', config), false); // a customer
  assert.equal(privateAllowed('123456@lid', config, new Set(['123456@lid'])), true); // started by staff
  assert.equal(privateAllowed('971511111111@s.whatsapp.net', config, new Set(), ['971511111111:5@s.whatsapp.net']), true); // the account itself
});

// Every feature sends through the one send function, so the guard is proven once for each way a message is requested.
test('NO feature can reach a customer group: availability, photo and voice confirmation, greeting, morning message, reminders', async () => {
  const delivered = [];
  const names = new Map([...CUSTOMER_GROUPS.map((s, i) => [`c${i}@g.us`, s]), ...INTERNAL_GROUPS.map((s, i) => [`i${i}@g.us`, s])]);
  const send = guardedSend({
    rawSend: async (jid, content) => { delivered.push([jid, content.text]); return { key: { id: 'x' } }; }, config, isGroup: (j) => j.endsWith('@g.us'),
    known: new Set(), subjectOf: async (j) => names.get(j), log: () => {},
  });
  const features = {
    availability: (jid) => send(jid, { text: 'Available' }, { quoted: {} }),
    'photo confirmation': (jid) => send(jid, { text: 'Did I understand correctly? 408' }, { quoted: {} }),
    'voice confirmation': (jid) => send(jid, { text: 'Did I understand correctly? 229' }),
    greeting: (jid) => send(jid, { text: 'Hello, this is Atossa' }),
    'morning message': (jid) => send(jid, { text: 'Good morning' }),
    reminders: (jid) => send(jid, { text: 'Reminder' }),
    'delivery hold warning': (jid) => send(jid, { text: 'Hold' }),
    'invoice warning': (jid) => send(jid, { text: 'Invoice problem' }),
  };
  for (const [name, run] of Object.entries(features)) {
    for (let i = 0; i < CUSTOMER_GROUPS.length; i++) assert.equal(await run(`c${i}@g.us`), undefined, `${name} reached a customer group`);
    assert.equal(await run('i0@g.us') !== undefined, true, `${name} must still reach an internal group`);
  }
  assert.ok(delivered.every(([jid]) => jid.startsWith('i')));
  assert.equal(await send('unknown@g.us', { text: 'x' }), undefined); // a group with no known name is blocked
  assert.equal(await send('971599999999@s.whatsapp.net', { text: 'x' }), undefined); // a customer in private
  assert.ok(await send('971500000001@s.whatsapp.net', { text: 'x' })); // staff in private
});

test('there is exactly one send path: nothing in the program calls the raw send outside the guard', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.equal((src.match(/rawSend/g) || []).length, 2); // defined once, handed to the guard once
  assert.match(src, /guardedSend\(\{ rawSend/);
});

test('the watched groups: customer groups hold the word, internal and excluded ones are left out automatically', () => {
  const watched = [...CUSTOMER_GROUPS, ...INTERNAL_GROUPS, 'Aryak Accounting', 'Aryak LLC Discussions', 'ARYAK Staff Chat'].filter((g) => observedGroup(g, config));
  assert.deepEqual(watched, ['Master Wood - ARYAK', 'Bahar Kitchen ARYAK']);
  assert.equal(observedGroup('Master Wood - ARYAK', { ...config, observeGroupNames: [] }), false); // an empty list watches nothing
});

// ---------------------------------------------------------------------------------------------------------- sourcing
test('staff asking a customer for goods is a sourcing request; a staff answer to a customer is not', () => {
  const asks = ['Do you have 603 20 m available? We need it for Bahar', 'Do you have this color 305?', 'عندكم 505 كم متر؟', 'شما 229 دارید؟ ۲۰ متر', 'Can you give us 408 - 15 mtr'];
  for (const t of asks) assert.equal(isSourcingRequest(t, []), true, t);
  // the customer asked 509 a minute ago: the staff line repeating it is an answer
  assert.equal(isSourcingRequest('509 16 meter available', ['509']), false);
  assert.equal(isSourcingRequest('yes available', []), false);
  assert.equal(isSourcingRequest('603 - 20 mtr', []), true); // a code and quantity nobody asked for
  const ev = sourcingEvent('Do you have 603 - 20 mtr? for Bahar');
  assert.deepEqual([ev.type, ev.status, ev.code, ev.quantity, ev.unit, ev.for], ['sourcing', 'open', '603', 20, 'm', 'bahar']);
});

test('the customer\'s yes is an answer, not an order; it stays out of the order memory and the invoice is said to be covered', () => {
  const t = new Tracker();
  const now = Date.parse('2026-11-05T08:00:00Z');
  const ev = { ...sourcingEvent('Do you have 603 - 20 mtr? for Bahar'), at: now, customer: 'Master Wood', group: 'g1', ref: 's1' };
  t.add(ev);
  assert.equal(openSourcing(t, 'g1', { now }).length, 1);
  const a = sourcingAnswer('yes, 20 m', ev);
  assert.deepEqual([a.status, a.answer, a.quantity], ['answered', 'yes', 20]);
  assert.equal(sourcingAnswer('603 - 20 mtr', ev).status, 'answered'); // even as an order-like line
  assert.equal(sourcingAnswer('no', ev).status, 'declined');
  assert.equal(sourcingAnswer('what colour is it?', ev), null);
  t.update('s1', { status: 'answered', answer: 'yes' });
  assert.equal(t.of('order', 'Master Wood').length, 0); // nothing entered the order memory
  assert.deepEqual(sourcingCover(t, { customer: 'Bahar', at: now + 3600000, lines: [{ code: 'PVC FILM603', quantity: 20, unit: 'm' }] }).map((p) => [p.kind, p.item, p.severity]), [['sourcing-cover', '603', 'info']]);
  assert.equal(sourcingCover(t, { customer: 'Dandy', at: now, lines: [{ code: '603', quantity: 20, unit: 'm' }] }).length, 0); // it was for Bahar
  assert.equal(markSourcingReceived(t, '603'), 1);
  assert.equal(t.events[0].status, 'received');
  assert.match(sourcingDigest(t.events)[0], /1 received/);
  assert.deepEqual(sourcingDigest([]), []);
});

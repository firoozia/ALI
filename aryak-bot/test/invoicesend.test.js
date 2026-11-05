import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OneShot, SendDesk, chooseText, confirmText, findInvoice, isOwnerCommand, looseName, parseSendCommand, sendFileName, targetGroups } from '../src/invoicesend.js';
import { guardedSend } from '../src/guard.js';
import { NameStore, readableFileName, wantsRename } from '../src/nameline.js';

const OWNER_SEND = 'آتوسا فاکتور nuqoosh رو ارسال کن داخل گروه خود مشتری';
const RENAME_SENTENCE = 'آتوسا فاکتور هایی ارسالی که نامشان بصورت کد هست رو هم نام با نام مشتری داخل فاکتور کن';
const config = {
  shadowGroupNames: ['aryak', 'nuqo', 'kitchens'], testGroupNames: ['test aryak bot'], staffGroupNames: ['aryak staff'], invoiceGroupName: 'invoices group', infoGroupName: 'information group',
  cutGroupName: 'aryak orders pictures', observeExcludeNames: ['aryak accounting'], staffNumbers: [], testCustomerName: 'test customer', allowCustomerGroupSends: false, morningGroupNames: [],
};
const GROUPS = [
  { id: 'a@g.us', subject: 'NUQOUCH---ARYAK' }, { id: 'b@g.us', subject: 'SY x NUQOOSH KITCHENS' }, { id: 'c@g.us', subject: 'Master Wood - ARYAK' },
  { id: 'd@g.us', subject: 'TEST ARYAK BOT' }, { id: 'e@g.us', subject: 'Aryak Staff' }, { id: 'f@g.us', subject: 'Invoices group' }, { id: 'g@g.us', subject: 'Family chat' },
];

test('nobody but the owner can start it: a message typed on this account, not one she sent, not forwarded', () => {
  const sentIds = new Set(['her1']);
  assert.equal(isOwnerCommand({ fromMe: true, id: 'x1', text: OWNER_SEND, sentIds }), true);
  assert.equal(isOwnerCommand({ fromMe: false, id: 'x2', text: OWNER_SEND, sentIds }), false); // an admin, the sales manager, Aryak Office, staff: not this account
  assert.equal(isOwnerCommand({ fromMe: true, id: 'her1', text: OWNER_SEND, sentIds }), false); // her own message coming back
  assert.equal(isOwnerCommand({ fromMe: true, id: 'x3', text: `🤖 ${OWNER_SEND}`, sentIds }), false); // her own robot sign
  assert.equal(isOwnerCommand({ fromMe: true, id: 'x4', text: OWNER_SEND, sentIds, forwarded: true }), false); // a forwarded message
});

test('the words: the owner\'s sentence is a send order; the rename sentence and ordinary talk are not', () => {
  assert.deepEqual(parseSendCommand(OWNER_SEND), { customer: 'nuqoosh' });
  assert.equal(parseSendCommand('Atossa send the invoice of nuqoosh to its group').customer, 'nuqoosh');
  assert.equal(parseSendCommand('آتوسا همین فاکتور را بفرست').customer, '');
  assert.equal(parseSendCommand('أرسل الفاتورة ناقوش').customer, 'ناقوش');
  assert.equal(parseSendCommand(RENAME_SENTENCE), null); // "ارسالی" (sent) is not "send"
  assert.equal(wantsRename(RENAME_SENTENCE), true);
  assert.equal(parseSendCommand('is 408 available?'), null);
  assert.equal(parseSendCommand('send me the price list'), null); // no invoice word
});

test('names and groups: nuqoosh finds both of its groups, never an internal or unrelated one; the test customer goes to the test group', () => {
  assert.equal(looseName('nuqoosh', 'NUQOOSH KITCHENS IND . LLC'), true);
  assert.equal(looseName('nuqoosh', 'NUQOUCH---ARYAK'), true);
  assert.equal(looseName('nuqoosh', 'Master Wood'), false);
  const nu = targetGroups('NUQOOSH KITCHENS IND . LLC', GROUPS, config);
  assert.deepEqual(nu.map((g) => g.subject).sort(), ['NUQOUCH---ARYAK', 'SY x NUQOOSH KITCHENS']);
  assert.deepEqual(targetGroups('TEST CUSTOMER LLC', GROUPS, config).map((g) => g.subject), ['TEST ARYAK BOT']);
  assert.deepEqual(targetGroups('Somebody Else', GROUPS, config), []);
  assert.deepEqual(targetGroups('Aryak Staff', GROUPS, config).filter((g) => g.subject === 'Aryak Staff'), []); // an internal group is never a target
});

test('the invoice is found among the kept files by its read; the confirmation says everything and warns on top', () => {
  const reads = { m1: { number: 'inv-9954', customer: 'KITCHEN PALACE' }, m2: { number: 'inv-9955', customer: 'NUQOOSH KITCHENS IND . LLC', total: 1234.5, urgent: 2, noOrder: true } };
  const entries = [{ id: 'm3' }, { id: 'm2' }, { id: 'm1' }];
  const hit = findInvoice('nuqoosh', entries, (id) => reads[id]);
  assert.equal(hit.entry.id, 'm2');
  assert.equal(findInvoice('nobody', entries, (id) => reads[id]), null); // not kept: no guess
  const text = confirmText({ read: hit.read, fileName: sendFileName(hit.read), group: 'NUQOUCH---ARYAK', alreadySent: '' });
  const lines = text.split('\n');
  assert.match(lines[0], /^⚠️ This invoice has 2 unresolved urgent problems\./);
  assert.match(lines[1], /No matching purchase order/);
  assert.ok(text.includes('Invoice inv-9955 — NUQOOSH KITCHENS IND . LLC'));
  assert.ok(text.includes('Total with VAT: AED 1234.50'));
  assert.ok(text.includes('File: inv-9955 NUQOOSH KITCHENS IND LLC.pdf')); // the dots collapse into a clean name
  assert.ok(text.includes('Group: NUQOUCH---ARYAK'));
  assert.match(lines.at(-1), /Send\? yes \/ no/);
  assert.match(confirmText({ read: hit.read, fileName: 'x.pdf', group: 'G', alreadySent: 'before' }), /already sent to this group/);
  assert.equal(readableFileName('INV-1', 'A.B.C LLC'), 'inv-1 ABC LLC.pdf');
  assert.match(chooseText(nu2()), /^Which group\? Reply with the number:\n1\) NUQOUCH---ARYAK\n2\) SY x NUQOOSH KITCHENS$/);
});
function nu2() { return [GROUPS[0], GROUPS[1]]; }

test('no send without his yes: a number chooses, yes sends, anything else cancels, someone else\'s answer counts for nothing, ten minutes expire it', () => {
  let clock = 0;
  const d = new SendDesk({ now: () => clock });
  d.start('chat', { step: 'choose', groups: nu2() });
  assert.equal(d.answer('chat', '2', false), null); // not the owner: not an answer
  assert.deepEqual(d.answer('chat', '2', true), { type: 'choose', index: 1 });
  d.start('chat', { step: 'confirm', group: GROUPS[1] });
  assert.equal(d.answer('chat', 'yes', false), null); // yes from someone else
  assert.deepEqual(d.answer('chat', 'yes', true), { type: 'yes' });
  d.start('chat', { step: 'confirm', group: GROUPS[1] });
  assert.deepEqual(d.answer('chat', 'maybe later', true), { type: 'cancel' });
  assert.equal(d.get('chat'), null); // cancelled: gone
  d.start('chat', { step: 'confirm', group: GROUPS[1] });
  clock = 11 * 60 * 1000;
  assert.equal(d.answer('chat', 'yes', true), null); // expired
  d.start('chat', { step: 'choose', groups: nu2() });
  assert.deepEqual(d.answer('chat', '7', true), { type: 'cancel' }); // not on the list
});

test('the one-shot token: exact group, exact PDF message, once; no text passes through it', async () => {
  const oneShot = new OneShot();
  const sent = [];
  const names = new Map([['a@g.us', 'NUQOUCH---ARYAK'], ['b@g.us', 'SY x NUQOOSH KITCHENS'], ['d@g.us', 'TEST ARYAK BOT']]);
  const send = guardedSend({
    rawSend: async (jid, content) => { sent.push([jid, content.document ? 'pdf' : content.text]); return { key: { id: 'x' } }; }, config, oneShot,
    isGroup: (j) => j.endsWith('@g.us'), known: new Set(), subjectOf: async (j) => names.get(j),
  });
  const pdf = () => ({ document: Buffer.from('%PDF'), mimetype: 'application/pdf', fileName: 'inv-1 X.pdf' });
  // nothing granted: every send to a customer group stays blocked, text and PDF alike
  assert.equal(await send('a@g.us', pdf()), undefined);
  assert.equal(await send('a@g.us', { text: 'hello' }), undefined);
  // granted for group a and this content
  const c = pdf();
  assert.equal(oneShot.grant('a@g.us', c), true);
  assert.equal(await send('b@g.us', c), undefined); // another group
  assert.ok(await send('a@g.us', c)); // the right group, once
  assert.equal(await send('a@g.us', c), undefined); // the token is used up
  assert.equal(await send('a@g.us', pdf()), undefined); // another PDF to the same group
  // text can never get a token, and a PDF content with text cannot either
  assert.equal(oneShot.grant('a@g.us', { text: 'hi' }), false);
  assert.equal(oneShot.grant('a@g.us', { ...pdf(), text: 'hi' }), false);
  assert.equal(oneShot.grant('a@g.us', { document: Buffer.from('x'), mimetype: 'image/png' }), false);
  assert.equal(await send('a@g.us', { text: 'hi' }), undefined);
  assert.deepEqual(sent, [['a@g.us', 'pdf']]); // exactly one message reached a customer group
});

test('the same invoice cannot go twice by itself: it is remembered and the next order carries a warning', () => {
  const s = new NameStore('', () => 0);
  assert.equal(s.sentTo('INV-9955', 'a@g.us'), null);
  s.markSentTo('inv-9955', 'a@g.us', '2026-11-06 15:40', 'inv-9955 X.pdf');
  assert.equal(s.sentTo('INV-9955', 'a@g.us'), '2026-11-06 15:40');
  assert.equal(s.sentTo('inv-9955', 'b@g.us'), null); // another group is another send
  assert.equal(s.isOwnName('inv-9955 X.pdf'), true); // her own file coming back is recognised
});

test('the wiring: owner only, only in the Invoices group / test group / his own chat, her PDF in the customer group creates nothing, shadow stays silent', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const route = src.slice(src.indexOf('// THE OWNER ORDERS AN INVOICE INTO A CUSTOMER'), src.indexOf('// "Atossa rename this invoice"'));
  assert.ok(route.includes('(group?.invoice || group?.test || (!group && isSelf))'));
  assert.match(route, /isOwnerCommand\(\{ fromMe: !!raw\.key\.fromMe, id: raw\.key\.id, text, sentIds: sent,/);
  assert.match(route, /if \(!owner\) \{ await reply\('Only the owner can order an invoice to be sent to a customer\./); // anyone else: the plain answer, nothing moves
  assert.match(route, /!wantsRename\(text\)/); // the rename sentence is not a send order
  // the send: asks first, the token is made only in the approved flow
  assert.equal((src.match(/oneShot\.grant\(/g) || []).length, 1);
  assert.ok(src.indexOf('oneShot.grant(') > src.indexOf('async function finishOwnerSend'));
  assert.match(src, /if \(a\?\.type === 'yes'\) \{ sendDesk\.clear\(chatId\); await finishOwnerSend/);
  assert.match(src, /Nothing was retried\./); // a failed send is said, never retried
  // her own PDF coming back: skipped before every flow (the sent ids), and shadow intake ignores it too
  assert.match(src, /raw\?\.key\?\.fromMe && sent\.has\(raw\.key\.id\)\) continue;/);
  const intake = src.slice(src.indexOf('async function shadowIntake'), src.indexOf('// The daily line at the summary hour'));
  assert.ok(intake.includes('sent.has(raw.key.id)'));
  // ALLOW_CUSTOMER_GROUP_SENDS stays off: the guard itself has no other exception
  const guard = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'guard.js'), 'utf8');
  assert.equal((guard.match(/oneShot\?\.consume/g) || []).length, 1);
  // the model is told what she can and cannot do
  assert.ok(fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'staff.js'), 'utf8').includes('ONLY the owner can order it'));
});

// ------------------------------------------------------------------------------------------ the confirmation must show what the check found
import { shortPoint } from '../src/finding.js';

test('the real sequence: an invoice is checked with problems, renamed, then ordered by a reply to the RENAMED copy: the confirmation shows the same problems', () => {
  const store = new NameStore('', () => 0);
  // the watch: the check of the original message (a file with a code name), kept by invoice number
  const problems = [
    { kind: 'quantity', item: '511', requested: '35 m', invoiced: '53 m', severity: 'urgent' },
    { kind: 'price-below', item: '511', requested: '12.00', invoiced: '9.00', severity: 'urgent' },
    { kind: 'price-unknown', item: '999', severity: 'info' },
  ];
  store.remember('orig-guid', 'inv-9955', 'NUQOOSH KITCHENS IND . LLC');
  store.setCheck('inv-9955', { total: 1234.5, urgent: 2, noOrder: true, points: problems.filter((p) => p.severity !== 'info').map(shortPoint) });
  // the rename: the re-posted copy is another message; its read is remembered under ITS id
  store.remember('copy-readable', 'inv-9955', 'NUQOOSH KITCHENS IND . LLC');
  // the owner replies to the copy: the same read and the same check
  const read = store.fullRead('copy-readable');
  assert.equal(read.checked, true);
  assert.deepEqual([read.urgent, read.noOrder, read.total], [2, true, 1234.5]);
  const text = confirmText({ read, fileName: sendFileName(read), group: 'NUQOUCH---ARYAK', alreadySent: '' });
  assert.match(text, /^⚠️ This invoice has 2 unresolved urgent problems: Wrong quantity 511 \(correct: 35 m, invoice: 53 m\); Price below list 511 \(correct: 12\.00, invoice: 9\.00\)\./);
  assert.ok(text.includes('No matching purchase order'));
  assert.ok(text.includes('Total with VAT: AED 1234.50'));
  assert.ok(!text.includes('not read') && !text.includes('not checked'));
  // the original and the copy share one check; a new check for the number replaces it
  assert.equal(store.fullRead('orig-guid').urgent, 2);
});

test('an invoice with no check says so on top; "Total with VAT: not read" appears only when the total truly is unknown', () => {
  const store = new NameStore('', () => 0);
  store.remember('old-file', 'inv-1', 'BAHAR');
  const read = store.fullRead('old-file');
  assert.equal(read.checked, false);
  const text = confirmText({ read, fileName: 'inv-1 BAHAR.pdf', group: 'G', alreadySent: '' });
  assert.match(text.split('\n')[0], /^⚠️ This invoice was not checked\./);
  assert.ok(text.includes('Send? yes / no')); // still asked
  // a clean checked invoice: no warning lines at all
  store.setCheck('inv-1', { total: 100, urgent: 0, noOrder: false, points: [] });
  const clean = confirmText({ read: store.fullRead('old-file'), fileName: 'inv-1 BAHAR.pdf', group: 'G', alreadySent: '' });
  assert.ok(!clean.includes('⚠️'));
  assert.ok(clean.includes('Total with VAT: AED 100.00'));
});

test('the wiring: every path looks up the stored check by number, makes the check when there is none, and the re-posted copy remembers the read', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(src, /nameStore\.setCheck\(number,/); // the watch keeps the check by invoice number
  assert.ok(src.includes("found.read.checked !== true")); // none yet: the same read and arithmetic now (one paid call, owner only)
  assert.match(src, /async function checkForSend\(buf\)/);
  assert.match(src, /nameStore\.remember\(sentCopy\.key\.id, number, customer\)/); // the copy finds the same read and check
  assert.match(src, /nameStore\.fullRead\(ctx\.stanzaId\)/); // the reply path
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { QboInvoiceDesk, InvoiceStore, Audit, parseInvoiceCommand } from '../src/qboinvoice.js';
import { setOutLang } from '../src/outlang.js';

// Invented data only.
const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');

const mkDesk = ({ pdf = true, postFails = false, testGroup = true } = {}) => {
  const posts = [];
  const qbo = {
    paused: false, configured: true, needsReconnect: false, connected: true, writeOn: true, missing: [],
    write: async () => ({ Invoice: { Id: '901', DocNumber: 'inv-2001', TotalAmt: 10.5 } }),
    get: async () => ({ Invoice: { TotalAmt: 10.5 } }),
    getBinary: async () => { if (!pdf) throw new Error('no pdf'); return Buffer.from('%PDF-1.4 x'); },
  };
  const store = new InvoiceStore('');
  store.add({ id: 'Q1', nonce: 'abc123', at: Date.now(), status: 'pending', requester: 'owner', customer: { ours: 'X', id: '1', name: 'SAMPLE CUSTOMER' }, lines: [{ itemId: '1', name: 'I', sku: '', qty: 1, price: 10, amount: 1000 }], tax: { id: '11', name: '5% S', rate: 5 }, subtotal: 1000, vat: 50, total: 1050, currency: 'AED', warnings: [] });
  const desk = new QboInvoiceDesk({ qbo, desk: {}, store, audit: new Audit(''), config: {}, today: () => '2026-11-10', post: async (jid, buf, name, caption) => { if (postFails) throw new Error('send failed'); posts.push({ jid, name, caption }); }, ownerJid: () => 'o@s.whatsapp.net', groups: async () => (testGroup ? [{ id: 't@g.us', subject: 'TEST' }] : []), testGroup: (g) => g[0] || null });
  return { desk, posts };
};

test('after the yes the PDF with its caption is the only answer; the text line comes only when no PDF could be sent; errors are still said', async () => {
  setOutLang('en');
  try {
    const ok = mkDesk(); const out = await ok.desk.decide({ verb: 'yes', id: 'Q1' });
    assert.deepEqual(out, []); // no «Approved #Q1. Invoice …» text beside the PDF
    assert.ok(ok.posts.length >= 1 && ok.posts.every((p) => /^Invoice inv-2001 - SAMPLE CUSTOMER - total 10\.50 AED$/.test(p.caption) && p.name === 'invoice-inv-2001.pdf'));
    // the PDF could not be fetched: the result is said in text (never silent), with the failure
    const noPdf = mkDesk({ pdf: false }); const said = (await noPdf.desk.decide({ verb: 'yes', id: 'Q1' })).join('\n');
    assert.match(said, /^\*Invoice\* inv-2001 — \*SAMPLE CUSTOMER\* — \*10\.50 AED\*/); assert.match(said, /پی‌دی‌اف فاکتور از کوییک‌بوکس گرفته یا فرستاده نشد/); assert.equal(noPdf.posts.length, 0);
    // the send failed
    const noSend = mkDesk({ postFails: true }); assert.match((await noSend.desk.decide({ verb: 'yes', id: 'Q1' })).join('\n'), /^\*Invoice\* inv-2001/);
    // posted to the owner only (no test group): the PDF went out, so still no text line, but the missing test group is said
    const solo = mkDesk({ testGroup: false }); const note = (await solo.desk.decide({ verb: 'yes', id: 'Q1' })).join('\n');
    assert.equal(solo.posts.length, 1); assert.ok(!note.includes('Invoice inv-2001 —')); assert.match(note, /گروه آزمایشی پیدا نشد/);
  } finally { setOutLang('fa'); }
  // the bare yes of the owner never prefixes «Approved #…» to an empty answer
  assert.match(index, /return said && out\.length \? \[said \+ out\[0\], \.\.\.out\.slice\(1\)\] : out;/);
});

test('the words: «no all», «cancel all», «لغو همه», «نه همه» drop everything; «waiting» and «صف» only list; «بله همه» still approves the last message\'s previews', () => {
  for (const t of ['no all', 'No all', 'cancel all', 'Cancel everything', 'drop all', 'لغو همه', 'نه همه', 'خیر همه']) assert.deepEqual(parseInvoiceCommand(t), { type: 'cancel_all' }, t);
  for (const t of ['waiting', 'queue', 'Pending', 'صف']) assert.deepEqual(parseInvoiceCommand(t), { type: 'queue_list' }, t);
  assert.deepEqual(parseInvoiceCommand('بله همه'), { type: 'yes_all' }); assert.deepEqual(parseInvoiceCommand('آره همه'), { type: 'yes_all' });
  assert.deepEqual(parseInvoiceCommand('no #Q3'), { type: 'no', id: 'Q3' }); assert.notEqual(parseInvoiceCommand('no all customers please')?.type, 'cancel_all');
});

test('the wiring: every kind of waiting item is listed and cancelled through the same «no #id» as the owner\'s; another person only his own; nothing is created; the answer is one short list', () => {
  const part = index.slice(index.indexOf('function waitingItems(by)'), index.indexOf('/** Remember a statement request as a preview'));
  for (const kind of ["'invoice'", "'customer names'", "'bulk job'", "'aliases'", "'availability draft'", "'duplicate payment question'", "'statement'", "'statement layout'", "'expense'"]) assert.ok(part.includes(kind), kind);
  assert.ok(part.includes("qboInvoiceCommand({ type: 'no', id }, '', {})")); assert.doesNotMatch(part, /verb: 'yes'|\.create\(|\.write\(|sendMessage/); // only «no»; nothing created, nothing sent from here
  const own = part.slice(part.indexOf('if (own) {'), part.indexOf('for (const id of groupStatements.openIds'));
  for (const owner of ['qboNames', 'qboBulk', 'cutAliases', 'availDrafts', 'paymentDups']) assert.ok(own.includes(owner), owner); // those kinds are the owner's alone
  assert.match(part, /p\?\.requester === by/); assert.match(part, /statementPreviews\.openIds\(by\)/); assert.match(part, /\(own \|\| e\.by === by\)/); // a person: his invoice previews, statements, expenses
  assert.match(index, /return `Cancelled \$\{done\.length\}: \$\{done\.join\(', '\)\}\. Nothing was created\.\$\{failed\.length/);
  assert.match(index, /case 'cancel_all': case 'queue_list': return \[await queueCommand\('owner', ic\.type\)\];/);
  assert.match(index, /await sock\.sendMessage\(chatId, \{ text: await queueCommand\(person, q\.type\) \}\); return true; \} \} \/\/ his own waiting items only/);
  assert.match(index, /OWNER_CHAT_COMMANDS = new Set\(\['unbilled', 'payments', 'backfill', 'read_photos', 'expense_delete', 'cancel_all', 'queue_list'/); // in a group: «use your own chat»
  assert.equal((index.match(/qboInvoices\.decide\(/g) || []).length, 1); // still one caller of the owner's yes
});

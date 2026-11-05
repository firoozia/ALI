import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BufferJSON } from 'baileys';
import { MediaKeep, wantsRename } from '../src/nameline.js';
import { isAddressed, STAFF_RULES } from '../src/staff.js';

const OWNER_SENTENCE = 'آتوسا فاکتور هایی ارسالی که نامشان بصورت کد هست رو هم نام با نام مشتری داخل فاکتور کن';

test('the words that ask her to name invoices, in Persian, English and Arabic, including the owner\'s own sentence', () => {
  for (const t of [
    OWNER_SENTENCE, 'Atossa rename this invoice', 'rename the invoices', 'please rename', 'change the name of this file', 'change names of the invoices',
    'آتوسا تغییر نام بده', 'نام فایل را عوض کن', 'اسم فاکتورها را به نام مشتری عوض کن', 'اسم بزار', 'همنام کن', 'هم نام با مشتری',
    'غير اسم الفاتورة', 'تغيير الاسم', 'أعد تسمية الفواتير', 'بدل الاسم من فضلك',
  ]) assert.equal(wantsRename(t), true, t);
  for (const t of ['is 408 available?', 'check this invoice', 'مبلغ این فاکتور درست است؟', 'آتوسا موجودی ۴۰۸', 'what was received this week', '']) assert.equal(wantsRename(t), false, t);
});

test('the owner\'s sentence addresses her by name, so it reaches the rename route in the Invoices group', () => {
  assert.equal(isAddressed({ text: OWNER_SENTENCE, names: ['آتوسا', 'atossa'] }), true);
  assert.equal(isAddressed({ text: 'rename this invoice', names: ['atossa'] }), false); // not called by name: left alone
});

test('the recent PDFs are kept (the last 50, message proto only), newest first, per group, and survive a restart with their media keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-'));
  const mk = () => new MediaKeep(dir, { replacer: BufferJSON.replacer, reviver: BufferJSON.reviver, max: 3 });
  const k = mk();
  const entry = (n, g = 'inv@g.us') => ({ id: `m${n}`, groupId: g, key: { remoteJid: g, id: `m${n}`, fromMe: false }, message: { documentMessage: { mediaKey: new Uint8Array([n, 2, 3]), fileName: `${n}.pdf`, mimetype: 'application/pdf' } }, fileName: `${n}.pdf`, at: n });
  for (const n of [1, 2, 3, 4]) assert.equal(k.add(entry(n)), true);
  assert.equal(k.add(entry(4)), false); // the same message twice
  k.add(entry(9, 'test@g.us'));
  assert.deepEqual(k.list('inv@g.us').map((e) => e.id), ['m4', 'm3']); // the last 3 overall: m2 and m1 fell out; newest first
  const again = mk();
  const e = again.list('inv@g.us')[0];
  assert.equal(e.id, 'm4');
  assert.ok(e.message.documentMessage.mediaKey instanceof Uint8Array); // enough for downloadMediaMessage
  assert.deepEqual([...e.message.documentMessage.mediaKey], [4, 2, 3]);
  assert.deepEqual(again.list('test@g.us').map((x) => x.id), ['m9']); // one group never renames another group's files
});

test('without a quote the route names the recent files and says how many; an empty memory says plainly what is possible; the general model knows she can', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function renameRecent'), src.indexOf('/**\n * Give an invoice a readable name'));
  assert.match(fn, /I only keep the invoices posted since this update\. New ones are named automatically; for an older file, reply to it with "Atossa rename"\./);
  assert.match(fn, /Named \$\{named\} invoice\$\{named === 1 \? '' : 's'\}, skipped \$\{skipped\} \(already named, expired or unreadable\)/);
  assert.match(fn, /catch \(err\) \{ skipped\+\+;/); // expired media counts as skipped
  assert.match(fn, /meaninglessName\(e\.fileName\)/); // only meaningless names
  assert.match(fn, /nameStore\.named\(e\.id, read\.number\)/); // never twice
  assert.match(src, /await reply\(await renameRecent\(chatId\)\)/);
  assert.match(src, /if \(role === 'invoice'\) keepPdf\(raw, groupId, doc\.fileName\)/); // kept from now on
  // the general model: what she can do, and that she never says she cannot
  assert.match(STAFF_RULES, /you CAN name an invoice from what is printed on it/);
  assert.match(STAFF_RULES, /Never say you cannot name invoices/);
  assert.match(STAFF_RULES, /You do NOT edit the content of an invoice/);
});

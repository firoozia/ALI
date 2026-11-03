import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InvoiceDesk, buildInvoiceContent, checkInvoice, extractMeta, noRequestText, normPo, parseVerdict, reportText, staffWarning } from '../src/invoice.js';

const doc = (hash, staff = false) => ({ hash, base64: 'AAAA', fileName: `${hash}.pdf`, senderName: staff ? 'Sara' : 'Customer', staff });
const clientSaying = (t) => ({ beta: { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] }) } } });

test('parseVerdict reads JSON inside text and rejects junk', () => {
  const v = parseVerdict('Here: {"verdict":"mismatch","problems":[{"kind":"quantity","item":"305"}]} done');
  assert.equal(v.verdict, 'mismatch');
  assert.equal(v.problems.length, 1);
  assert.equal(parseVerdict('{"verdict":"maybe"}'), null);
  assert.equal(parseVerdict('no json'), null);
  assert.deepEqual(parseVerdict('{"verdict":"match"}').problems, []);
});

test('PO numbers compare without prefix, dashes or leading zeros', () => {
  assert.equal(normPo('LPO 615'), '615');
  assert.equal(normPo('lpo-0615'), '615');
  assert.equal(normPo('PO#615'), '615');
  assert.equal(normPo(''), '');
});

test('extractMeta reads the small answer and survives junk', async () => {
  const m = await extractMeta({ client: clientSaying('{"customer":"PVC WORKS CARPENTER LLC","po_number":"LPO 615"}'), config: { model: 'm' }, doc: doc('r') });
  assert.deepEqual(m, { customer: 'PVC WORKS CARPENTER LLC', po: '615' });
  assert.deepEqual(await extractMeta({ client: clientSaying('nope'), config: { model: 'm' }, doc: doc('r') }), { customer: '', po: '' });
});

test('desk: an invoice is matched to its order by PO number, else by customer name', () => {
  const d = new InvoiceDesk();
  assert.equal(d.addRequest(doc('r614'), { customer: 'PVC Works Carpenter LLC', po: '614' }, 'PVC works'), true);
  assert.equal(d.addRequest(doc('r614'), { customer: 'x', po: '614' }), false);
  d.addRequest(doc('r615'), { customer: 'PVC Works Carpenter LLC', po: '615' }, 'PVC works');
  assert.equal(d.find({ customer: '', po: '615' }).request.hash, 'r615');
  assert.equal(d.find({ customer: 'pvc works carpenter', po: '' }).request.hash, 'r615'); // newest of that customer
  assert.equal(d.find({ customer: 'Other Co', po: '' }).none, true);
  assert.equal(d.find({ customer: 'PVC Works Carpenter LLC', po: '999' }).none, true);
});

test('desk: the same PO from two groups is ambiguous unless the customer name settles it', () => {
  const d = new InvoiceDesk();
  d.addRequest(doc('a'), { customer: 'Alpha', po: '7' }, 'g1');
  d.addRequest(doc('b'), { customer: 'Beta', po: '7' }, 'g2');
  assert.deepEqual(d.find({ customer: '', po: '7' }).ambiguous, ['g1', 'g2']);
  assert.equal(d.find({ customer: 'beta llc', po: '7' }).request.hash, 'b');
});

test('desk: an old order is not used, an invoice file is checked once', () => {
  const d = new InvoiceDesk({ maxAgeMs: 1000 });
  d.addRequest(doc('r'), { customer: 'A', po: '1' }, 'g', 0);
  assert.equal(d.find({ customer: '', po: '1' }, 5000).none, true);
  assert.equal(d.firstTime('i1'), true);
  assert.equal(d.firstTime('i1'), false);
});

test('desk: orders survive a restart (files on disk)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-'));
  new InvoiceDesk({ dir }).addRequest({ ...doc('r1'), base64: Buffer.from('%PDF-x').toString('base64') }, { customer: 'A', po: '1' }, 'g');
  const again = new InvoiceDesk({ dir });
  const found = again.find({ customer: '', po: '1' });
  assert.equal(Buffer.from(found.request.base64, 'base64').toString(), '%PDF-x');
  assert.equal(found.request.fileName, 'r1.pdf');
});

test('content has both files in order', () => {
  const c = buildInvoiceContent(doc('r'), doc('i', true));
  assert.deepEqual(c.filter((b) => b.type === 'document').map((b) => b.source.media_type), ['application/pdf', 'application/pdf']);
  assert.match(c[0].text, /request/);
  assert.match(c[2].text, /invoice/);
});

test('checkInvoice: ok, bad answer, thrown error, refusal', async () => {
  const ask = (res) => checkInvoice({ client: { beta: { messages: { create: async () => { if (res instanceof Error) throw res; return res; } } } }, config: { model: 'm' }, request: doc('r'), invoice: doc('i', true) });
  const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
  assert.equal((await ask(text('{"verdict":"match"}'))).verdict, 'match');
  assert.equal((await ask(text('blah'))).verdict, 'error');
  assert.equal((await ask(new Error('boom'))).error, 'boom');
  assert.equal((await ask({ stop_reason: 'refusal', content: [] })).error, 'refusal');
});

test('texts: nothing for a match, details for a mismatch, warning for staff, note when no order', () => {
  assert.equal(reportText({ verdict: 'match', problems: [] }, {}), null);
  assert.equal(staffWarning({ verdict: 'match', problems: [] }), null);
  const v = {
    verdict: 'mismatch', request_customer: 'Master Wood', invoice_number: 'INV-9',
    problems: [{ kind: 'quantity', item: 'PVC 305', requested: '200 m', invoiced: '100 m', note: 'مقدار کمتر است' }],
  };
  const t = reportText(v, { groupName: 'invoice', invoiceSender: 'Sara' });
  assert.match(t, /Master Wood/);
  assert.match(t, /مقدار اشتباه: PVC 305/);
  assert.match(t, /200 m \| فاکتور: 100 m/);
  assert.match(t, /INV-9/);
  assert.match(staffWarning(v), /1 مورد/);
  assert.match(reportText({ verdict: 'error', error: 'boom' }, { groupName: 'g' }), /boom/);
  assert.match(noRequestText({ customer: 'A', po: '615' }, { invoiceFile: 'f.pdf', ambiguous: ['g1', 'g2'] }), /615[\s\S]*g1، g2/);
});

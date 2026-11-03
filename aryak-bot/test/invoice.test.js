import test from 'node:test';
import assert from 'node:assert/strict';
import { InvoiceDesk, buildInvoiceContent, checkInvoice, parseVerdict, reportText } from '../src/invoice.js';

const doc = (hash, staff) => ({ hash, base64: 'AAAA', fileName: `${hash}.pdf`, senderName: staff ? 'Sara' : 'Customer', staff });

test('parseVerdict reads JSON inside text and rejects junk', () => {
  const v = parseVerdict('Here: {"verdict":"mismatch","problems":[{"kind":"quantity","item":"305"}]} done');
  assert.equal(v.verdict, 'mismatch');
  assert.equal(v.problems.length, 1);
  assert.equal(parseVerdict('{"verdict":"maybe"}'), null);
  assert.equal(parseVerdict('no json'), null);
  assert.deepEqual(parseVerdict('{"verdict":"match"}').problems, []);
});

test('desk: staff pdf is an invoice, other pdf is a request, duplicates ignored', () => {
  const d = new InvoiceDesk();
  assert.equal(d.take('g', doc('i0', true)), 'no-request');
  assert.equal(d.take('g', doc('r1', false)), 'request');
  assert.equal(d.take('g', doc('r1', false)), 'duplicate');
  const got = d.take('g', doc('i1', true));
  assert.equal(got.request.hash, 'r1');
  assert.equal(d.take('other', doc('i2', true)), 'no-request');
});

test('desk: an old request is not used', () => {
  const d = new InvoiceDesk({ maxAgeMs: 1000 });
  d.take('g', doc('r1', false), 0);
  assert.equal(d.take('g', doc('i1', true), 5000), 'no-request');
});

test('content has both files in order', () => {
  const c = buildInvoiceContent(doc('r', false), doc('i', true));
  assert.deepEqual(c.filter((b) => b.type === 'document').map((b) => b.source.media_type), ['application/pdf', 'application/pdf']);
  assert.match(c[0].text, /request/);
  assert.match(c[2].text, /invoice/);
});

test('checkInvoice: ok, bad answer, thrown error, refusal', async () => {
  const ask = (res) => checkInvoice({ client: { beta: { messages: { create: async () => { if (res instanceof Error) throw res; return res; } } } }, config: { model: 'm' }, request: doc('r', false), invoice: doc('i', true) });
  const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
  assert.equal((await ask(text('{"verdict":"match"}'))).verdict, 'match');
  assert.equal((await ask(text('blah'))).verdict, 'error');
  assert.equal((await ask(new Error('boom'))).error, 'boom');
  assert.equal((await ask({ stop_reason: 'refusal', content: [] })).error, 'refusal');
});

test('report: nothing for a match, details for a mismatch', () => {
  assert.equal(reportText({ verdict: 'match', problems: [] }, {}), null);
  const t = reportText({
    verdict: 'mismatch', request_customer: 'Master Wood', invoice_number: 'INV-9',
    problems: [{ kind: 'quantity', item: 'PVC 305', requested: '200 m', invoiced: '100 m', note: 'مقدار کمتر است' }],
  }, { groupName: 'pvc work', invoiceSender: 'Sara' });
  assert.match(t, /Master Wood/);
  assert.match(t, /مقدار اشتباه: PVC 305/);
  assert.match(t, /200 m \| فاکتور: 100 m/);
  assert.match(t, /INV-9/);
  assert.match(reportText({ verdict: 'error', error: 'boom' }, { groupName: 'g' }), /boom/);
});

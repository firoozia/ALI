import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MiniPdf } from '../src/minipdf.js';
import { pdfTextLayer } from '../src/pdftext.js';
import { mergePayment, parseReceiptText } from '../src/receipt.js';
import { parsePaymentCaption } from '../src/captions.js';
import { eventsFromCaption } from '../src/captionevents.js';
import { paymentsText, proposePayment } from '../src/payments.js';

// Invented bank, customer and amounts only; the PDF is made here.
const NOW = Date.parse('2026-11-09T14:00:00Z');
const fakePdf = (lines) => { const pdf = new MiniPdf(); lines.forEach((l, i) => pdf.text(50, 60 + i * 16, l, { size: 11 })); return pdf.build(); };
const RECEIPT = ['FIRST SAMPLE BANK', 'Funds Transfer Advice', 'Date: 07/11/2026', 'Payer: MUNICH DOOR KITCHEN TRADING', 'Transfer Amount: AED 9,940.00', 'Reference: inv 9940 payment for goods and some more words to pass the letters threshold of the reader'];

test('a number after «inv», «invoice», «inv-», «inv no» or «فاکتور» is an invoice number, never an amount', () => {
  for (const [text, customer] of [['Munich door kitchen inv 9940', 'Munich door kitchen'], ['cash from clear MUNICH DOOR KITCHEN inv 9940', 'MUNICH DOOR KITCHEN'], ['Munich door kitchen invoice no 9940', 'Munich door kitchen'], ['Munich door kitchen inv-9940', 'Munich door kitchen'], ['فاکتور 9940 مونیخ', 'مونیخ']]) {
    const e = eventsFromCaption('payment', text).events[0];
    assert.equal(e.amount, 0, text); assert.deepEqual(e.invoices, ['inv-9940'], text); assert.equal(e.customer, customer, text); assert.equal(e.noAmount, true);
  }
  assert.deepEqual(eventsFromCaption('payment', 'inv-9940').events[0].invoices, ['inv-9940']);
  const both = eventsFromCaption('payment', 'cash 500 from ZED inv 9808 / 9809').events[0]; // an amount AND invoice numbers: each is what it is
  assert.equal(both.amount, 500); assert.deepEqual(both.invoices, ['inv-9808', 'inv-9809']); assert.equal(both.customer, 'ZED');
  assert.equal(parsePaymentCaption('clear inv 9808 / 9809').kind, 'clear-invoices'); // the older form still works
  assert.equal(eventsFromCaption('payment', '500 ZED').events[0].invoices, undefined);
});

test('a PDF receipt: the text layer gives the amount, the date, the payer, the kind and the invoice it names; no text or no amount is not guessed', () => {
  const layer = pdfTextLayer(fakePdf(RECEIPT));
  assert.equal(layer.ok, true);
  assert.deepEqual(parseReceiptText(layer.text), { amount: 9940, date: '2026-11-07', payer: 'MUNICH DOOR KITCHEN TRADING', receipt: 'transfer receipt', invoices: ['inv-9940'] });
  assert.equal(parseReceiptText('Cheque deposit slip\nDate 05 Nov 2026\nAmount 1,234.00 AED\nDepositor: ZED CARPENTRY').receipt, 'cheque');
  assert.equal(parseReceiptText('Deposit slip\n12/11/2026\nTotal 250.50').amount, 250.5);
  assert.equal(parseReceiptText('Ref inv 9940 only, thank you for your payment today'), null); // the invoice number is not an amount
  assert.equal(parseReceiptText(''), null); assert.equal(pdfTextLayer(Buffer.from('not a pdf')).ok, false);
});

test('the receipt and the reply are ONE entry: the document gives the amount, the reply the customer and the invoice', () => {
  const base = { amount: 9940, paidOn: '2026-11-07', receipt: 'transfer receipt', payer: 'BANK PAYER NAME', source: 'pdf', invoices: [] };
  const reply = eventsFromCaption('payment', 'Munich door kitchen inv 9940').events[0];
  const one = mergePayment(base, reply);
  assert.deepEqual([one.amount, one.customer, one.invoices, one.receipt, one.source, one.paidOn, one.pendingName, one.noAmount], [9940, 'Munich door kitchen', ['inv-9940'], 'transfer receipt', 'pdf', '2026-11-07', undefined, undefined]);
  assert.equal(mergePayment(base, {}).customer, 'BANK PAYER NAME'); assert.equal(mergePayment({ ...base, payer: '' }, {}).pendingName, true); // no reply and no payer on the document: the name is needed
  assert.equal(mergePayment({ amount: 0, source: 'pdf' }, { amount: 120, customer: 'ZED' }).amount, 120); // an unreadable document: the reply's own amount
  assert.equal(mergePayment({ amount: 0, source: 'pdf' }, {}).noAmount, true);
});

test('the report shows the source and the invoice from QuickBooks (paid or open); nothing is recorded', () => {
  const lookup = new Map([['inv-9940', { DocNumber: 'inv-9940', TotalAmt: 9940, Balance: 0, CustomerRef: { name: 'MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C' } }], ['inv-9988', { DocNumber: 'inv-9988', TotalAmt: 88.2, Balance: 88.2, CustomerRef: { name: 'ZED CARPENTRY' } }]]);
  const receipt = { type: 'payment', kind: 'transfer', receipt: 'transfer receipt', source: 'pdf', paidOn: '2026-11-07', currency: 'AED', customer: 'Munich door kitchen', amount: 9940, invoices: ['inv-9940'], at: NOW - 3600000, ref: 'r1' };
  const p = proposePayment({ event: receipt, invoices: [], lookup });
  assert.equal(p[0], '9,940.00 AED — transfer receipt (PDF) for inv-9940, Munich door kitchen (07/11)');
  assert.equal(p[1], '→ inv-9940 (MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C, total 9,940.00) — paid');
  const open = proposePayment({ event: { type: 'payment', kind: 'cash', currency: 'AED', customer: '', pendingName: true, amount: 88.2, invoices: ['inv-9988'], at: NOW }, invoices: [], lookup });
  assert.equal(open[0], '88.20 AED — cash for inv-9988 from ZED CARPENTRY (09/11)'); // the customer comes from the invoice
  assert.equal(open[1], '→ inv-9988 (ZED CARPENTRY, total 88.20) — open balance 88.20; this payment matches it');
  assert.equal(proposePayment({ event: { ...receipt, invoices: ['inv-1'] }, invoices: [], lookup })[1], '→ inv-1 not found in QuickBooks');
  const noAmount = proposePayment({ event: { type: 'payment', kind: 'cash', currency: 'AED', customer: 'Munich door kitchen', amount: 0, noAmount: true, invoices: ['inv-9940'], at: NOW }, invoices: [], lookup });
  assert.equal(noAmount[0], 'amount not read — cash for inv-9940 from Munich door kitchen (09/11)');
  const text = paymentsText({ events: [receipt, { ...receipt, ref: 'r2', source: 'pdf', amount: 0, noAmount: true, invoices: [], customer: '', pendingName: true, at: NOW - 7200000 }], invoices: [], now: NOW, lookup });
  assert.match(text, /^Payments to match \(2\):\n1\. 9,940\.00 AED — transfer receipt \(PDF\) for inv-9940/); assert.match(text, /amount not read — transfer receipt \(PDF\)/); // an unreadable PDF is still listed
});

test('the wiring: a PDF in the Confirmation group is evidence, a reply that quotes a receipt joins it (one entry), nothing in this path writes to QuickBooks', () => {
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(index, /if \(role === 'payment' && content\?\.documentMessage && \/pdf\/i\.test\(content\.documentMessage\.mimetype \|\| ''\)\) \{ await trackPaymentPdf\(raw, groupId\); return; \}/);
  assert.match(index, /if \(role === 'payment' && quotedId && await replyToPayment\(\{ raw, groupId, content, quotedId, event \}\)\) continue;/);
  const part = index.slice(index.indexOf('function receiptOfPdf'), index.indexOf('async function trackGroup'));
  assert.ok(part.includes('tracker.update(existing.ref') && part.includes('pdfTextLayer(buf)') && part.includes('downloadMediaMessage'));
  assert.doesNotMatch(part, /qbo\.(write|create|post|send)|\.write\(|postDocument/); // proposal only
  assert.match(index, /select \* from Invoice where DocNumber in/); // the invoices the messages name, paid or open
});

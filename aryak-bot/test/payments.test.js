import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { proposePayment, paymentsText } from '../src/payments.js';
import { eventsFromCaption } from '../src/captionevents.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';

// Invented customers, invoice numbers and amounts only; no account number anywhere.
const NOW = Date.parse('2026-11-09T14:00:00Z'); const DAY = 24 * 3600 * 1000;
const inv = (customer, number, balance) => ({ Id: number.replace(/\D/g, ''), DocNumber: number, Balance: balance, CustomerRef: { name: customer } });
const open = [inv('HAMED TRADING', 'inv-9906', 4000), inv('HAMED TRADING', 'inv-9918', 4000), inv('HAMED TRADING', 'inv-9925', 1234.5), inv('ZED CARPENTRY', 'inv-9930', 8000), inv('ZED CARPENTRY', 'inv-9931', 250), inv('PAID CO', 'inv-1', 0)];
const pay = (extra) => ({ type: 'payment', kind: 'cash', currency: 'AED', at: NOW - DAY, ...extra });

test('a payment with a customer name: the open invoices that add up to it, else the open list; a nameless bank credit: the customers that fit exactly; nothing is ever recorded', () => {
  const two = proposePayment({ event: pay({ customer: 'HAMED TRADING', amount: 8000 }), invoices: open });
  assert.deepEqual(two, ['8,000.00 AED — cash from HAMED TRADING (08/11)', '→ pays inv-9906 4,000.00 + inv-9918 4,000.00']);
  const none = proposePayment({ event: pay({ customer: 'HAMED TRADING', amount: 5000 }), invoices: open });
  assert.match(none[1], /^→ no exact match; open: inv-9906 4,000\.00, inv-9918 4,000\.00, inv-9925 1,234\.50 \(total 9,234\.50\); a part payment or an advance$/);
  assert.equal(proposePayment({ event: pay({ customer: 'NOBODY LLC', amount: 10 }), invoices: open })[1], '→ no open invoice found for this customer');
  const bank = proposePayment({ event: pay({ kind: 'transfer', customer: '', pendingName: true, amount: 8000 }), invoices: open });
  assert.equal(bank[0], '8,000.00 AED — bank credit (08/11)'); assert.match(bank[1], /^→ could be: HAMED TRADING: inv-9906 4,000\.00 \+ inv-9918 4,000\.00 \| ZED CARPENTRY: inv-9930 8,000\.00$/);
  assert.match(proposePayment({ event: pay({ kind: 'transfer', customer: '', pendingName: true, amount: 250 }), invoices: open })[1], /^→ most likely ZED CARPENTRY: inv-9931 250\.00$/);
  assert.match(proposePayment({ event: pay({ kind: 'transfer', customer: '', pendingName: true, amount: 777 }), invoices: open })[1], /the name is needed/);
  // an alias the owner approved
  const alias = proposePayment({ event: pay({ customer: 'HAMID TRD', amount: 4000 }), invoices: open, aliasOf: (n) => (n === 'HAMID TRD' ? 'HAMED TRADING' : '') });
  assert.match(alias[1], /^→ pays inv-99(06|18) 4,000\.00$/);
});

test('the report: recent payments only, newest first, at most six, test data and zero amounts left out, the footer says nothing was recorded', () => {
  const events = [pay({ customer: 'ZED CARPENTRY', amount: 250, at: NOW - 3600000 }), pay({ customer: 'HAMED TRADING', amount: 8000 }), pay({ customer: 'OLD', amount: 5, at: NOW - 30 * DAY }), pay({ customer: 'TEST', amount: 9, simulated: true }), pay({ customer: 'ZERO', amount: 0 })];
  const text = paymentsText({ events, invoices: open, now: NOW });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Payments to match (2):'); assert.match(lines[1], /^1\. 250\.00 AED — cash from ZED CARPENTRY/); assert.match(text, /2\. 8,000\.00 AED — cash from HAMED TRADING/);
  assert.ok(!text.includes('OLD') && !text.includes('TEST')); assert.equal(lines.at(-1), 'Proposal only: nothing was recorded in QuickBooks.');
  assert.equal(paymentsText({ events: [], invoices: open, now: NOW }), 'No payment was seen in the Confirmation group in the last 14 days.');
  const many = Array.from({ length: 9 }, (_, i) => pay({ customer: 'ZED CARPENTRY', amount: 250 + i, at: NOW - i * 3600000 }));
  assert.match(paymentsText({ events: many, invoices: open, now: NOW }), /\+3 more/);
});

test('the shapes the group uses: a bank credit keeps the amount and no account number; the words «payments» and the wiring (read only, proposal to the owner)', () => {
  const e = eventsFromCaption('payment', 'Your AC No:XXXX1234 is credited with AED 8000.00 by transfer').events[0];
  assert.equal(e.amount, 8000); assert.equal(e.pendingName, true); assert.ok(!JSON.stringify(e).includes('1234'));
  assert.deepEqual(parseInvoiceCommand('payments'), { type: 'payments' }); assert.deepEqual(parseInvoiceCommand('پرداخت ها'), { type: 'payments' });
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const fn = index.slice(index.indexOf('async function paymentsReport'), index.indexOf('const availDrafts'));
  assert.match(fn, /select \* from Invoice where Balance > '0'/); assert.match(fn, /select \* from Payment where TxnDate >=/); assert.doesNotMatch(fn, /\.write\(|sock\.sendMessage|postDocument/); // only reads
  assert.match(index, /role === 'payment' && Number\(event\.amount\) > 0 && qbo\.connected && !qbo\.paused/);
  assert.match(index, /paymentsReport\(\[event\]\)\.then\(\(text\) => sock\.sendMessage\(ownIds\(\)\[0\]/); // to the owner's own chat only
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'payments.js'), 'utf8');
  assert.doesNotMatch(src, /\.write\(|POST|qbo\./); // the module cannot write
});

test('junk words are not a customer; a nameless cash payment waits for the name posted next to it; 1 AED rounding; a payment the office already recorded', () => {
  for (const [text, customers] of [['cash from receipt + clear 115 aed', []], ['115 aed cash from Pay', []], ['cash from clear ZED CARPENTRY inv 250 aed', ['Zed Carpentry']]]) {
    const r = eventsFromCaption('payment', text);
    const got = (r.events || []).map((e) => e.customer).filter(Boolean);
    assert.deepEqual(got.map((x) => x.toUpperCase()), customers.map((x) => x.toUpperCase()), text);
  }
  const nameless = eventsFromCaption('payment', 'receipt 115 aed and clear').events[0];
  assert.equal(nameless.amount, 115); assert.equal(nameless.pendingName, true); assert.equal(nameless.customer, '');
  assert.deepEqual(eventsFromCaption('payment', 'Alwan sham'), { name: 'Alwan sham' });
  const near = proposePayment({ event: pay({ customer: 'ZED CARPENTRY', amount: 250.5 }), invoices: open });
  assert.match(near[1], /^→ pays inv-9931 250\.00 \(rounded: 250\.00\)$/);
  const paid = [{ TotalAmt: 115, TxnDate: '2026-11-08', CustomerRef: { name: 'ALWAN ALSHAM' } }];
  const done = proposePayment({ event: pay({ customer: 'Alwan Al Sham', amount: 115 }), invoices: open, payments: paid, aliasOf: (n) => (n === 'Alwan Al Sham' ? 'ALWAN ALSHAM' : '') });
  assert.match(done[1], /^→ already recorded in QuickBooks \(payment of 08\/11, ALWAN ALSHAM\)$/);
  assert.doesNotMatch(proposePayment({ event: pay({ customer: 'OTHER CO', amount: 115 }), invoices: open, payments: paid })[1], /already recorded/);
});

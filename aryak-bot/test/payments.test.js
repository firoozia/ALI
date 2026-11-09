import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PaymentDups, proposePayment, paymentsText } from '../src/payments.js';
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
  assert.equal(none[1], '→ not found in QuickBooks payments (±7 days) and no open invoice of this amount. Open invoices of this customer: inv-9906 4,000.00, inv-9918 4,000.00, inv-9925 1,234.50.');
  assert.equal(proposePayment({ event: pay({ customer: 'NOBODY LLC', amount: 10 }), invoices: open })[1], '→ not found in QuickBooks payments (±7 days) and this customer has no open invoice');
  const bank = proposePayment({ event: pay({ kind: 'transfer', customer: '', pendingName: true, amount: 8000 }), invoices: open });
  assert.equal(bank[0], '8,000.00 AED — bank credit (08/11)'); assert.deepEqual(bank.slice(1), ['→ no customer name in the message. Possible matches:', '• ZED CARPENTRY — inv-9930 8,000.00', '• HAMED TRADING — inv-9906 4,000.00 + inv-9918 4,000.00 = 8,000.00']); // one invoice before several
  assert.deepEqual(proposePayment({ event: pay({ kind: 'transfer', customer: '', pendingName: true, amount: 250 }), invoices: open }).slice(1), ['→ no customer name in the message. Possible matches:', '• ZED CARPENTRY — inv-9931 250.00']);
  assert.match(proposePayment({ event: pay({ kind: 'transfer', customer: '', pendingName: true, amount: 777 }), invoices: open })[1], /no customer name in the message, and no customer has open invoices adding up/);
  // an alias the owner approved
  const alias = proposePayment({ event: pay({ customer: 'HAMID TRD', amount: 4000 }), invoices: open, aliasOf: (n) => (n === 'HAMID TRD' ? 'HAMED TRADING' : '') });
  assert.match(alias[1], /^→ pays inv-99(06|18) 4,000\.00$/);
});

test('the report: recent payments only, newest first, at most ten, test data and zero amounts left out, the footer says nothing was recorded', () => {
  const events = [pay({ customer: 'ZED CARPENTRY', amount: 250, at: NOW - 3600000 }), pay({ customer: 'HAMED TRADING', amount: 8000 }), pay({ customer: 'OLD', amount: 5, at: NOW - 30 * DAY }), pay({ customer: 'TEST', amount: 9, simulated: true }), pay({ customer: 'ZERO', amount: 0 })];
  const text = paymentsText({ events, invoices: open, now: NOW });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Payments to match (2):'); assert.match(lines[1], /^1\. 250\.00 AED — cash from ZED CARPENTRY/); assert.match(text, /2\. 8,000\.00 AED — cash from HAMED TRADING/);
  assert.ok(!text.includes('OLD') && !text.includes('TEST')); assert.equal(lines.at(-1), 'Proposal only — nothing was recorded in QuickBooks.');
  assert.equal(paymentsText({ events: [], invoices: open, now: NOW }), 'No payment was seen in the Confirmation group in the last 14 days.');
  const nine = Array.from({ length: 9 }, (_, i) => pay({ customer: 'ZED CARPENTRY', amount: 250 + i, at: NOW - i * 3600000 }));
  const all = paymentsText({ events: nine, invoices: open, now: NOW }); assert.equal((all.match(/^\d+\. /gm) || []).length, 9); assert.ok(!/more/.test(all)); // up to ten are all listed: no «+1 more» for one item
  const twelve = Array.from({ length: 12 }, (_, i) => pay({ customer: 'ZED CARPENTRY', amount: 250 + i, at: NOW - i * 3600000 }));
  const cut = paymentsText({ events: twelve, invoices: open, now: NOW }); assert.equal((cut.match(/^\d+\. /gm) || []).length, 10); assert.match(cut, /\nand 2 more payments\nProposal only — /);
  // the owner's example: no name, three customers and more; one per line, three at most, then «and N other customers»
  const inv2 = [inv('AL EBDA AL MALKI KITCHEN', 'inv-9961', 88.2), inv('AL EBDA AL MALKI KITCHEN', 'inv-9714', 23.1), inv('AL EBDA AL MALKI KITCHEN', 'inv-9441', 46.2), inv('NUQOOSH IND . LLC', 'inv-9969', 113.4), inv('NUQOOSH IND . LLC', 'inv-9821', 44.1), inv('MASTER WOOD', 'inv-9423', 157.5), inv('ZED', 'inv-1', 157), inv('ONE MORE', 'inv-2', 156.8), inv('LAST', 'inv-3', 157.4)];
  const nameless = proposePayment({ event: pay({ kind: 'cash', customer: '', pendingName: true, amount: 157 }), invoices: inv2 });
  assert.deepEqual(nameless.slice(1), ['→ no customer name in the message. Possible matches:', '• ZED — inv-1 157.00', '• ONE MORE — inv-2 156.80', '• LAST — inv-3 157.40', '• and 3 other customers']); // exact first, then fewer invoices, then closer
  const multi = proposePayment({ event: pay({ kind: 'cash', customer: '', pendingName: true, amount: 157 }), invoices: inv2.slice(0, 6) });
  assert.deepEqual(multi.slice(2), ['• MASTER WOOD — inv-9423 157.50', '• NUQOOSH IND . LLC — inv-9969 113.40 + inv-9821 44.10 = 157.50', '• AL EBDA AL MALKI KITCHEN — inv-9961 88.20 + inv-9714 23.10 + inv-9441 46.20 = 157.50']);
});

test('the shapes the group uses: a bank credit keeps the amount and no account number; the words «payments» and the wiring (read only, proposal to the owner)', () => {
  const e = eventsFromCaption('payment', 'Your AC No:XXXX1234 is credited with AED 8000.00 by transfer').events[0];
  assert.equal(e.amount, 8000); assert.equal(e.pendingName, true); assert.ok(!JSON.stringify(e).includes('1234'));
  assert.deepEqual(parseInvoiceCommand('payments'), { type: 'payments' }); assert.deepEqual(parseInvoiceCommand('پرداخت ها'), { type: 'payments' });
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const fn = index.slice(index.indexOf('async function paymentsReport'), index.indexOf('const availDrafts'));
  assert.match(fn, /select \* from Invoice where Balance > '0'/); assert.match(fn, /select \* from Payment where TxnDate >=/); assert.doesNotMatch(fn, /\.write\(|sock\.sendMessage|postDocument/); // only reads
  assert.match(index, /role === 'payment' && Number\(event\.amount\) > 0 && qbo\.connected && !qbo\.paused/);
  assert.match(index, /paymentsReport\(tracker\.events, event\.ref\)\.then\(\(text\) => text && sock\.sendMessage\(ownIds\(\)\[0\]/); // to the owner's own chat only
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

test('payment names: «cash from receipt + clear», «cash from Pay» and «clear … inv» are read clean; a payment stored with junk is a payment without a name; a message of payment words only is no name', async () => {
  const { stripPaymentWords } = await import('../src/captions.js');
  const names = (t) => eventsFromCaption('payment', t).events?.map((e) => e.customer);
  assert.deepEqual(names('cash from receipt + clear 115.00'), ['']); assert.equal(eventsFromCaption('payment', 'cash from receipt + clear 115.00').events[0].pendingName, true);
  assert.deepEqual(names('cash from Pay 157.00'), ['']);
  assert.deepEqual(names('cash from clear MUNICH DOOR KITCHEN inv 9,940.00'), ['MUNICH DOOR KITCHEN']);
  assert.deepEqual(names('Cash received from clear Munich Door Kitchen inv AED 9940'), ['Munich Door Kitchen']);
  assert.equal(eventsFromCaption('payment', 'cash from receipt + clear'), null); // payment words only and no amount: nothing, never a name for the neighbour payment
  assert.deepEqual(eventsFromCaption('payment', 'Alwan sham'), { name: 'Alwan sham' });
  assert.equal(stripPaymentWords('receipt + clear'), ''); assert.equal(stripPaymentWords('clear MUNICH DOOR KITCHEN inv'), 'MUNICH DOOR KITCHEN');
  // a payment kept from before with the junk name is read as a payment without a name
  const stored = proposePayment({ event: pay({ customer: 'Receipt + Clear', amount: 115 }), invoices: open });
  assert.match(stored[1], /no customer name in the message/);
  const munich = [inv('MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C', 'inv-9645', 9940)];
  assert.match(proposePayment({ event: pay({ customer: 'Clear MUNICH DOOR KITCHEN Inv', amount: 9940 }), invoices: munich })[1], /^→ pays inv-9645 9,940\.00$/);
  const recorded = proposePayment({ event: pay({ customer: 'MUNICH DOOR KITCHEN', amount: 9940 }), invoices: munich, payments: [{ TotalAmt: 9940, TxnDate: '2026-11-08', CustomerRef: { name: 'MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C' } }] });
  assert.match(recorded[1], /already recorded in QuickBooks \(payment of 08\/11/);
});

test('a repeated payment: the first is listed, the second is marked and the owner is asked; his answer is kept; a different or missing customer is never a duplicate', async () => {
  const { PaymentDups } = await import('../src/payments.js');
  const fs2 = await import('node:fs'); const os2 = await import('node:os'); const path2 = await import('node:path');
  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'dups-'));
  const dups = new PaymentDups(dir);
  const a = pay({ ref: 'm1', customer: 'ALWAN ALSHAM', amount: 115, at: NOW - 3 * 3600000 }); const b = pay({ ref: 'm2', customer: 'ALWAN ALSHAM', amount: 115, at: NOW - 3600000 });
  const text = paymentsText({ events: [a, b], invoices: open, now: NOW, dups });
  assert.match(text, /^Payments to match \(2\):/);
  assert.match(text, /1\. 115\.00 AED — cash from ALWAN ALSHAM \(09\/11\)\n\s+→ not found[^\n]*\n━+\n2\. 115\.00 AED — cash from ALWAN ALSHAM \(09\/11\)\n\s+⚠ Duplicate\? same amount and customer as #1 \(09\/11\)\n\s+Reply: dup #D1 \(count once\) \/ separate #D1 \(two payments\)/); // the first listed, its repeat marked right under it
  assert.ok(text.includes('━'.repeat(18)));
  assert.equal(paymentsText({ events: [a, b], invoices: open, now: NOW, dups }).includes('#D2'), false); // the same pair keeps its code
  // the owner says «count once»: the second is not listed any more, and a new process still knows
  assert.deepEqual(dups.decide('D1', 'dup'), { verb: 'dup' });
  const again = new PaymentDups(dir);
  const after = paymentsText({ events: [a, b], invoices: open, now: NOW, dups: again });
  assert.match(after, /^Payments to match \(1\):/); assert.ok(!after.includes('Duplicate'));
  // «separate»: both listed, no question, not asked again
  const dir2 = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'dups-')); const d2 = new PaymentDups(dir2);
  paymentsText({ events: [a, b], invoices: open, now: NOW, dups: d2 }); d2.decide('D1', 'separate');
  const sep = paymentsText({ events: [a, b], invoices: open, now: NOW, dups: new PaymentDups(dir2) });
  assert.match(sep, /^Payments to match \(2\):/); assert.ok(!sep.includes('Duplicate') && !sep.includes('dup #'));
  assert.deepEqual(d2.decide('D9', 'dup'), { error: 'not found' });
  // not duplicates: another customer, no customer, another amount, another day
  const quiet = (events) => paymentsText({ events, invoices: open, now: NOW, dups: new PaymentDups('') });
  assert.ok(!quiet([a, pay({ ref: 'x', customer: 'ZED CARPENTRY', amount: 115, at: NOW - 3600000 })]).includes('Duplicate'));
  assert.ok(!quiet([a, pay({ ref: 'y', customer: '', pendingName: true, amount: 115, at: NOW - 3600000 })]).includes('Duplicate'));
  assert.ok(!quiet([a, pay({ ref: 'z', customer: 'ALWAN ALSHAM', amount: 115.5, at: NOW - 3600000 })]).includes('Duplicate'));
  assert.ok(!quiet([a, pay({ ref: 'w', customer: 'ALWAN ALSHAM', amount: 115, at: NOW - 3 * DAY })]).includes('Duplicate'));
  // the live single report: only the new payment is shown, a dropped one gives nothing
  assert.match(paymentsText({ events: [a, b], invoices: open, now: NOW, dups: new PaymentDups(''), only: 'm2' }), /^Payments to match \(1\):\n1\. .*\n\s+⚠ Duplicate\?/);
  assert.equal(paymentsText({ events: [a, b], invoices: open, now: NOW, dups: again, only: 'm2' }), '');
  // the words and the wiring
  assert.deepEqual(parseInvoiceCommand('dup #D1'), { type: 'payment_dup', verb: 'dup', id: 'D1' }); assert.deepEqual(parseInvoiceCommand('separate D2'), { type: 'payment_dup', verb: 'separate', id: 'D2' });
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(index, /new PaymentDups\(path\.join\(config\.authDir, 'qbo'\)\)/); assert.match(index, /dups: paymentDups, only/); assert.match(index, /case 'payment_dup': \{ const r = paymentDups\.decide\(ic\.id, ic\.verb\)/);
});

test('a repeated payment also when the second message has no name but both are the SAME QuickBooks payment (same amount, same day)', () => {
  const rec = [{ Id: '77', TotalAmt: 115, TxnDate: '2026-11-09', CustomerRef: { name: 'ALWAN ALSHAM' } }];
  const a = pay({ ref: 'q1', customer: 'ALWAN ALSHAM', amount: 115, at: NOW - 3 * 3600000 }); const b = pay({ ref: 'q2', customer: '', pendingName: true, amount: 115, at: NOW - 3600000 });
  const text = paymentsText({ events: [a, b], invoices: open, payments: rec, now: NOW, dups: new PaymentDups('') });
  assert.match(text, /already recorded in QuickBooks[^\n]*\n━+\n2\. [^\n]*\n\s+⚠ Duplicate\? same amount and customer as #1/);
  assert.match(text, /Reply: dup #D1 \(count once\) \/ separate #D1 \(two payments\)/);
  // without a QuickBooks payment to share, a nameless message is not a duplicate
  assert.ok(!paymentsText({ events: [a, b], invoices: open, payments: [], now: NOW, dups: new PaymentDups('') }).includes('Duplicate'));
  // two different QuickBooks payments of the same amount: not the same receipt
  const two = [...rec, { Id: '78', TotalAmt: 115, TxnDate: '2026-11-09', CustomerRef: { name: 'OTHER CO' } }];
  assert.ok(!paymentsText({ events: [pay({ ref: 'n1', customer: 'ZED CARPENTRY', amount: 115, at: NOW - 3 * 3600000 }), b], invoices: open, payments: [{ ...two[1], CustomerRef: { name: 'ZED CARPENTRY' } }, ...rec], now: NOW, dups: new PaymentDups('') }).includes('Duplicate'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mergePayment } from '../src/receipt.js';
import { parsePaymentCaption } from '../src/captions.js';
import { eventsFromCaption } from '../src/captionevents.js';
import { migrateOldPayments } from '../src/payments.js';

// Invented customers, invoices and amounts only.
const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');

test('«clear MUNICH DOOR KITCHEN inv 9940» is a payment message that also clears; a bare «cleared» (or «cleared» with words) is still only a clearing', () => {
  const e = eventsFromCaption('payment', 'clear MUNICH DOOR KITCHEN inv 9940').events[0];
  assert.deepEqual([e.amount, e.customer, e.invoices, e.cleared, e.noAmount], [0, 'MUNICH DOOR KITCHEN', ['inv-9940'], true, true]);
  const f = eventsFromCaption('payment', 'cleared inv 9940 ZED CARPENTRY').events[0];
  assert.deepEqual([f.amount, f.customer, f.invoices, f.cleared], [0, 'ZED CARPENTRY', ['inv-9940'], true]);
  for (const t of ['cleared', 'CLEARED', 'cleared two customer']) assert.equal(parsePaymentCaption(t).kind, 'cleared', t);
  assert.equal(parsePaymentCaption('clear inv 9808 / 9809').kind, 'clear-invoices'); // the older list form
  assert.equal(eventsFromCaption('payment', 'cash from ZED 500').events[0].cleared, undefined);
  const merged = mergePayment({ amount: 9940, receipt: 'transfer receipt', source: 'pdf' }, e);
  assert.deepEqual([merged.amount, merged.customer, merged.invoices, merged.cleared], [9940, 'MUNICH DOOR KITCHEN', ['inv-9940'], true]); // the cleared mark goes with the entry
});

test('payments stored before the new rules: a whole-number «amount» that is the number of the same customer\'s invoice becomes the invoice; coincidences and kept words are handled', () => {
  const rows = [{ DocNumber: 'inv-9940', CustomerRef: { name: 'MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C' } }, { DocNumber: 'inv-500', CustomerRef: { name: 'OTHER CO' } }];
  const old = { type: 'payment', kind: 'cash', customer: 'MUNICH DOOR KITCHEN', amount: 9940, ref: 'a1' };
  const out = migrateOldPayments({ events: [old], invoiceRows: rows });
  assert.deepEqual(out, [{ ref: 'a1', patch: { amount: 0, noAmount: true, invoices: ['inv-9940'], reparsed: true } }]);
  assert.deepEqual(migrateOldPayments({ events: [{ ...old, customer: 'ZED CARPENTRY' }], invoiceRows: rows }), []); // another customer: only digits in common
  assert.deepEqual(migrateOldPayments({ events: [{ ...old, amount: 9940.5 }], invoiceRows: rows }), []); // an amount with cents is an amount
  assert.deepEqual(migrateOldPayments({ events: [{ ...old, customer: '', amount: 500 }], invoiceRows: rows }), []); // no customer to compare: left alone
  assert.deepEqual(migrateOldPayments({ events: [{ ...old, reparsed: true }, { ...old, source: 'pdf' }, { ...old, kind: 'transfer' }], invoiceRows: rows }), []); // done once; a receipt or a bank credit is never touched
  // kept words are read again with today's rules
  const withText = { type: 'payment', kind: 'cash', customer: 'MUNICH DOOR KITCHEN', amount: 9940, ref: 'a2', text: 'clear MUNICH DOOR KITCHEN inv 9940' };
  const again = migrateOldPayments({ events: [withText], parse: (t) => eventsFromCaption('payment', t).events[0] });
  assert.deepEqual(again, [{ ref: 'a2', patch: { amount: 0, invoices: ['inv-9940'], noAmount: true, reparsed: true } }]);
});

test('the wiring: a reply to a receipt (PDF, photo or text) and a «cleared» to the same receipt are ONE entry; a photo is read by the cheap vision path only when the owner allows models; the name «Awab» as a reply goes to the receipt', () => {
  // «cleared» to a receipt: the receipt\'s own entry is marked, never another open payment (even when it was already cleared by someone else)
  assert.match(index, /const own = role === 'payment' && quotedId \? tracker\.events\.find\(\(e\) => e\.type === 'payment' && e\.ref === refOf\(quotedId\)\) : null;/);
  assert.match(index, /if \(own\) \{ if \(!own\.cleared\) tracker\.update\(own\.ref, \{ cleared: true \}\); done = own; \}/);
  assert.ok(index.indexOf("if (own) { if (!own.cleared)") < index.indexOf("if (!done) done = markCleared(tracker"));
  assert.match(index, /else if \(role === 'payment' && quotedId && await replyToPayment\(\{ raw, groupId, content, quotedId, event: \{ cleared: true/); // an older receipt: read from the quote
  // the entry made from a quote keeps the quote's reference, so a later reply finds it
  assert.match(index, /const made = \{ \.\.\.merged, at: Date\.now\(\), ref: quotedRef \};/);
  // photos
  const part = index.slice(index.indexOf('async function replyToPayment'), index.indexOf('async function trackGroup'));
  assert.ok(part.indexOf('imageOf(quoted)') > 0 && part.indexOf('mayTrackWithModel(config)') > part.indexOf('imageOf(quoted)') && part.indexOf('extractEvent({') > part.indexOf('mayTrackWithModel(config)')); // the model is asked only after the owner's permission is checked
  assert.match(index, /source: 'photo', receipt: ev\.kind === 'cheque'/); // a photo posted on its own says where it came from
  // «Awab» as a reply
  assert.match(index, /if \(det\.name && role === 'payment' && quotedId && await replyToPayment\(\{ raw, groupId, content, quotedId, event: \{ customer: det\.name, amount: 0, invoices: \[\] \} \}\)\) return;/);
  // another amount in the reply is another payment
  assert.match(index, /Math\.abs\(Number\(event\.amount\) - Number\(base\.amount\)\) > 1\) return false;/);
  // the words are kept and the old entries are migrated in the report; nothing is written to QuickBooks
  assert.match(index, /\.\.\.\(role === 'payment' \? \{ text: String\(text\)\.slice\(0, 300\) \} : \{\}\)/); assert.match(index, /migrateOldPayments\(\{ events, invoiceRows: guessRows/);
  const report = index.slice(index.indexOf('async function paymentsReport'), index.indexOf('const availDrafts')); assert.doesNotMatch(report, /\.write\(|sock\.sendMessage|postDocument/);
});

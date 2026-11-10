import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExpenseStore, entryText, makeEntry, rangeOf, receivedItems, receivedText, weeklyCheckText } from '../src/expenses.js';
import { SEP } from '../src/separator.js';
import { eventsFromCaption } from '../src/captionevents.js';
import { PaymentDups, sharedPaymentList } from '../src/payments.js';
import { loadConfig } from '../src/config.js';
import { mayReadReceipts, mayTrackWithModel } from '../src/costpolicy.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';

// Invented customers and amounts only.
const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
const NOW = Date.parse('2026-11-10T08:00:00Z');
const day = rangeOf('today', '2026-11-10');
const pay = (extra) => ({ type: 'payment', kind: 'cash', currency: 'AED', at: NOW, ref: `p${Math.random()}`, ...extra });

test('receipts have their own switch: on by default whatever TRACK_MODEL says; RECEIPT_VISION=off turns only them off', () => {
  const env = (extra) => ({ ANTHROPIC_API_KEY: 'k', SHEET_URL: 'u', ZINAX_BOT_TOKEN: 't', ...extra });
  const on = loadConfig(env({})).config; assert.equal(on.receiptVision, true); assert.equal(on.trackModel, false);
  assert.equal(mayReadReceipts(on), true); assert.equal(mayTrackWithModel(on), false); // the tracker's switch stays off, receipts are still read
  const off = loadConfig(env({ RECEIPT_VISION: 'off' })).config; assert.equal(mayReadReceipts(off), false);
  assert.equal(mayTrackWithModel(loadConfig(env({ TRACK_MODEL: 'on' })).config), true);
  const part = index.slice(index.indexOf('async function expensesTurn'), index.indexOf('const dayPlus'));
  assert.match(part, /if \(mayReadReceipts\(config\)\) \{/); assert.doesNotMatch(part, /mayTrackWithModel/);
  assert.match(index, /role === 'payment' && image \? mayReadReceipts\(config\) : mayTrackWithModel\(config\)/); // a payment receipt photo too
  assert.match(fs.readFileSync(path.join(import.meta.dirname, '..', 'deploy', 'gcp-startup.sh'), 'utf8'), /RECEIPT_VISION/);
});

test('a photo that was not read says so: «receipt not read — caption amount used», not «no receipt»; the photo without a caption asks for the amount as for an unreadable one', () => {
  const unread = makeEntry({ caption: '85.5 fuel', reading: null, hasReceipt: false, hasPhoto: true, by: '1', byName: 'Ali', at: NOW });
  assert.equal(unread.state, 'ask_method'); assert.match(entryText({ id: 'E1', ...unread }), /^🧾 \*Expense\* #E1\nAmount: \*85\.50 AED\* — receipt not read — caption amount used\nType: ⛽ Fuel\n/);
  const noPhoto = makeEntry({ caption: '85.5 fuel', reading: null, hasReceipt: false, by: '1', at: NOW }); assert.match(entryText({ id: 'E2', ...noPhoto }), /Amount: \*85\.50 AED\* — no receipt \(caption only\)/);
  const bare = makeEntry({ caption: '', reading: null, hasReceipt: false, hasPhoto: true, by: '1', at: NOW }); assert.match(entryText({ id: 'E3', ...bare }), /I could not read the receipt\. Please write the amount as a number\./);
});

test('a cheque is a cheque whatever the spelling, and the customer name carries none of the payment words', () => {
  for (const [text, name] of [['AL AHLIA CHEAQUE 3500', 'AL AHLIA'], ['cheque ZED 2,000', 'ZED'], ['ZED chq 1200', 'ZED'], ['ZED check 1200', 'ZED'], ['ZED شيك 1200', 'ZED'], ['ZED چک 1200', 'ZED']]) {
    const e = eventsFromCaption('payment', text).events[0]; assert.equal(e.kind, 'cheque', text); assert.equal(e.customer.replace(/شيك|چک/g, '').trim(), name, text);
  }
  assert.equal(eventsFromCaption('payment', 'cash 500 from ZED').events[0].kind, 'cash');
  // stored before: the word is in the stored name, so it is read as a cheque and the name is cleaned
  const list = sharedPaymentList({ events: [pay({ customer: 'AL AHLIA CHEAQUE', amount: 3500 })] });
  assert.deepEqual([list[0].kind, list[0].customer], ['cheque', 'AL AHLIA']);
});

test('a foreign currency is read, never invented: «OMR = 567», «60 … OMR = 567» (60 OMR is 567 AED); the AED equivalent is shown, the AED total counts it', () => {
  const alone = eventsFromCaption('payment', 'AL AFEEFI KITCHEN OMR = 567').events[0];
  assert.deepEqual([alone.customer, alone.amount, alone.currency], ['AL AFEEFI KITCHEN', 567, 'AED']); // «OMR = 567» alone: the figure after the equals sign is dirhams (the office recorded 567.00 AED)
  const both = eventsFromCaption('payment', '60 AED AL AFEEFI KITCHEN OMR = 567').events[0];
  assert.deepEqual([both.customer, both.amount, both.currency, both.foreign], ['AL AFEEFI KITCHEN', 567, 'AED', { amount: 60, currency: 'OMR' }]);
  const items = receivedItems([pay({ ...alone, at: NOW }), pay({ ...both, at: NOW })], day);
  assert.equal(items[0].shown, '*567.00*'); assert.equal(items[0].amount, 567); assert.ok(!items[0].foreign);
  assert.equal(items[1].shown, '*567.00* (60.00 OMR)'); assert.equal(items[1].amount, 567);
  const gbp = receivedItems([pay({ currency: 'GBP', amount: 10, customer: 'X' })], day)[0]; assert.deepEqual([gbp.shown, gbp.amount, gbp.unconverted], ['*10.00 GBP*', 0, true]); // no known rate: shown as it is, not in the AED total
  const text = receivedText([...items, gbp], { title: 't' }); assert.match(text, /⚠ foreign currency: check in QuickBooks/); assert.ok(!/\bOMR =/.test(text) && !/CHEAQUE/.test(text));
  // an old row whose stored name still mentions the currency is flagged, not guessed
  assert.equal(receivedItems(sharedPaymentList({ events: [pay({ customer: 'AL AFEEFI KITCHEN OMR =', amount: 60 })] }), day)[0].note, 'check the amount: the message mentions OMR');
});

test('ONE parsed list for payments, money received and the weekly check: the same names, the repeats dropped (the D answer applies everywhere), a repeat not yet answered counts once', () => {
  const events = [pay({ customer: 'RECEIPT + CLEAR', amount: 115, ref: 'a' }), pay({ customer: 'PAY', amount: 157, ref: 'b' }), pay({ customer: 'ALWAN ALSHAM', amount: 115, ref: 'c', at: NOW + 1000 }), pay({ customer: 'ALWAN ALSHAM', amount: 115, ref: 'd', at: NOW + 2000 }), pay({ customer: 'TEST', amount: 9, simulated: true, ref: 'e' })];
  const qb = [{ Id: '1', TxnDate: '2026-11-10', TotalAmt: 115, CustomerRef: { name: 'ALWAN ALSHAM' } }];
  const list = sharedPaymentList({ events, payments: qb });
  assert.deepEqual(list.map((e) => [e.ref, e.customer]), [['a', 'ALWAN ALSHAM'], ['b', '']]); // junk names are gone; the nameless 115 and the ALWAN 115 are the same QuickBooks payment: one entry that keeps the name; the test entry is out
  // the owner says «separate»: both are kept; «dup»: the repeat is gone for good
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dups-')); const dups = new PaymentDups(dir);
  dups.ask(events[0], events[2]); dups.decide('D1', 'separate');
  assert.equal(sharedPaymentList({ events, payments: qb, dups }).length, 3); // the owner said these two are separate payments: both kept
  const items = receivedItems(list, day);
  const text = receivedText(items, { title: '10/11/2026', records: qb });
  assert.ok(text.includes('1. ALWAN ALSHAM — *115.00* ✔ in QuickBooks')); // the nameless 115 is the recorded ALWAN payment, as «payments» says
  const week = weeklyCheckText({ expenses: [], purchases: [], items, payments: qb, title: 'w' });
  assert.ok(!/RECEIPT|CLEAR|PAY\b/.test(week)); assert.match(week, /UNKNOWN — \*157\.00\*/); assert.ok(!/115\.00/.test(week)); // 115 is recorded; only 157 is missing, with no junk name
});

test('a separator between every entry in the money received and the weekly check, not only before the total', () => {
  const items = receivedItems([pay({ customer: 'A', amount: 10 }), pay({ customer: 'B', amount: 20 }), pay({ customer: 'C', amount: 30 })], day);
  const lines = receivedText(items, { title: 't' }).split('\n');
  assert.equal(lines.filter((l) => l === SEP).length, 2 + 1); // two between the three cash entries and one before the total
  const week = weeklyCheckText({ expenses: [], purchases: [], items, payments: [], title: 'w' }).split('\n');
  assert.equal(week.filter((l) => l === SEP).length, 2); // between the three missing entries
  assert.ok(!week.includes('1. ' ) && week[0] === '*Weekly check — w*');
});

test('expenses made in the TEST group are test data (never in a real report); the owner can delete any expense: «delete #E1» / «حذف #E1»', () => {
  const st = new ExpenseStore(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-')), () => NOW);
  const real = st.add({ by: '1', amount: 40, type: 'food', day: '2026-11-10', state: 'done', method: 'cash' });
  const test1 = st.add({ by: '1', amount: 85.5, type: 'fuel', day: '2026-11-10', state: 'done', method: 'card', test: true });
  assert.deepEqual(st.done(day).map((e) => e.id), [real.id]); // E2 is test data
  assert.equal(st.remove('e2').amount, 85.5); assert.equal(st.get('E2'), null); assert.equal(st.remove('E99'), null);
  assert.deepEqual(parseInvoiceCommand('delete #E1'), { type: 'expense_delete', id: 'E1' }); assert.deepEqual(parseInvoiceCommand('حذف #E3'), { type: 'expense_delete', id: 'E3' }); assert.deepEqual(parseInvoiceCommand('remove expense E4'), { type: 'expense_delete', id: 'E4' });
  assert.match(index, /const testData = isTestSubject\(info\?\.subject\);/); assert.match(index, /test: testData \}\)\);/);
  assert.match(index, /case 'expense_delete': \{ const gone = expenseStore\.remove\(ic\.id\);/);
  assert.match(index, /OWNER_CHAT_COMMANDS = new Set\(\['unbilled', 'payments', 'backfill', 'read_photos', 'expense_delete'/); // typed in a group: «use your own chat»
  // the new group replaces the old one
  assert.match(index, /the old group is no longer the expenses group/);
});

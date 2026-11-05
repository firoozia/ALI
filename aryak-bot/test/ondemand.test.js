import test from 'node:test';
import assert from 'node:assert/strict';
import { answerLead, answerKind } from '../src/voice.js';
import { looksLikeInvoice, onDemandText } from '../src/ondemand.js';
import { parseOnBehalf } from '../src/onbehalf.js';
import { Tracker, checkInvoiceAgainstOrders } from '../src/tracker.js';
import { photoNotRequest, photoUnclear } from '../src/lang.js';
import { formatStaffStock } from '../src/stock-format.js';
import { imageAction } from '../src/image.js';

const NOW = Date.parse('2026-11-05T08:00:00Z');
const L = (code, quantity, unit = 'm') => ({ code, quantity, unit });

test('an answer that begins with yes or no and has more words still answers her question', () => {
  const t = 'نه، این سفارش نیست، فاکتور است. مقدار کد 511 در فاکتور با سفارش بالا یکی است؟';
  assert.equal(answerKind(t), 'other');
  assert.equal(answerLead(t), 'no');
  assert.equal(answerLead('بله، درست است'), 'yes');
  assert.equal(answerLead('511 در فاکتور'), '');
});

test('captions that mean an invoice go to the invoice checker, not the order flow', () => {
  for (const t of ['این فاکتور است و سفارش نیست. آن را با سفارش مشتری تست مقایسه کن', 'مبلغ های این فاکتور درست است؟', 'آتوسا فاکتور را با سفارش بالا مقایسه کن', 'check this invoice', 'Invoice inv-9903 dandy.pdf']) assert.equal(looksLikeInvoice(t), true, t);
  for (const t of ['108 - 40 متر', 'آتوسا موجود است؟', '']) assert.equal(looksLikeInvoice(t), false, t);
});

test('a photo that is readable but holds no request is not called unreadable', () => {
  assert.notEqual(photoNotRequest('fa'), photoUnclear('fa'));
  assert.ok(!photoNotRequest('fa').includes('خوانا نیست'));
  assert.match(photoNotRequest('en'), /could read the photo/);
  assert.equal(imageAction({ u: { ok: false, reason: 'invoice' }, explicit: true }), 'tell'); // the caller routes an invoice before this
});

test('a code with no stock on record is not said to be missing from the list', () => {
  assert.doesNotMatch(formatStaffStock({ found: false, code: '108' }, '108', '', 'fa'), /پیدا نشد|در فهرست نیست/);
  assert.match(formatStaffStock({ found: false, code: '108' }, '108', '', 'fa'), /108 C/);
});

test('the test order is read: customer, three lines, Persian units', () => {
  const r = parseOnBehalf('آتوسا سفارش مشتری تست: 108 - 40 متر، 511 - 35 متر، 408 - 15 متر');
  assert.equal(r.customer, 'تست');
  assert.deepEqual(r.lines.map((l) => [l.code, l.quantity, l.unit]), [['108', 40, 'm'], ['511', 35, 'm'], ['408', 15, 'm']]);
});

function memory() {
  const t = new Tracker();
  t.add({ type: 'order', at: NOW - 3600000, customer: 'تست', lines: [L('108', 40), L('511', 35), L('408', 15)], source: 'staff', ref: 'o1' });
  return t;
}
const inv = (lines, customer = 'تست') => ({ customer, at: NOW, lines });

test('the invoice is compared with the order memory: the same metres, a wrong quantity, a wrong code', () => {
  const t = memory();
  assert.deepEqual(checkInvoiceAgainstOrders(t, inv([L('108', 40), L('511', 35), L('408', 15)])), []);
  const qty = checkInvoiceAgainstOrders(t, inv([L('108', 40), L('511', 53), L('408', 15)]));
  assert.deepEqual(qty.map((p) => [p.kind, p.item, p.requested, p.invoiced, p.severity]), [['quantity', '511', '35 m', '53 m', 'urgent']]);
  const code = checkInvoiceAgainstOrders(t, inv([L('108', 40), L('512', 35), L('408', 15)]));
  assert.deepEqual(code.map((p) => [p.kind, p.item]).sort(), [['extra', '512'], ['missing', '511']]);
  // the code written as the invoice prints it is the same code
  assert.deepEqual(checkInvoiceAgainstOrders(t, inv([L('PVC FILM108', 40), L('511', 35), L('408', 15)])), []);
});

test('no order is silent (a note only when asked), a cut is never an order, several orders are matched by their lines', () => {
  assert.deepEqual(checkInvoiceAgainstOrders(new Tracker(), inv([L('108', 40)])), []); // silent in the pipeline
  const none = checkInvoiceAgainstOrders(new Tracker(), inv([L('108', 40)]), { explain: true }); // the on-demand check says it
  assert.deepEqual(none.map((p) => [p.kind, p.severity]), [['order-note', 'info']]);
  const cuts = new Tracker();
  cuts.add({ type: 'cut', at: NOW - 1000, customer: 'تست', lines: [L('108', 40)], ref: 'c1' });
  assert.deepEqual(checkInvoiceAgainstOrders(cuts, inv([L('108', 30)])), []); // cuts alone never make a quantity or a missing line
  const two = new Tracker();
  two.add({ type: 'order', at: NOW - 7200000, customer: 'تست', lines: [L('229', 20)], ref: 'a' });
  two.add({ type: 'order', at: NOW - 3600000, customer: 'تست', lines: [L('108', 40), L('511', 35)], ref: 'b' });
  assert.deepEqual(checkInvoiceAgainstOrders(two, inv([L('229', 20)])), []); // the older order is the one with the same line
  assert.deepEqual(checkInvoiceAgainstOrders(two, inv([L('777', 5)])), []); // none shares a code: silent in the pipeline, not guessed
  assert.equal(checkInvoiceAgainstOrders(two, inv([L('777', 5)]), { explain: true })[0].kind, 'order-note');
});

test('a test memory is separate from the real one', () => {
  const real = new Tracker();
  const test = new Tracker();
  test.add({ type: 'order', at: NOW, customer: 'تست', lines: [L('108', 40)], ref: 't' });
  assert.deepEqual(checkInvoiceAgainstOrders(real, inv([L('108', 40)])), []);
  assert.deepEqual(checkInvoiceAgainstOrders(test, inv([L('108', 40)])), []);
});

test('the on-demand answer: one clean line, or the points of the report', () => {
  assert.match(onDemandText({ problems: [], customer: 'تست', number: 'inv-1' }), /بررسی شد؛ حساب، مالیات و قیمت‌ها ایرادی نداشت/);
  const t = onDemandText({ problems: [{ kind: 'quantity', item: '511', requested: '35 m', invoiced: '53 m', note: 'مقدار با سفارش ثبت‌شده فرق دارد', severity: 'urgent' }], customer: 'تست', number: 'inv-1', groupName: 'g' });
  assert.match(t, /511/);
  assert.match(t, /درست: 35 m \| فاکتور: 53 m/);
});

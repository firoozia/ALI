import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest } from '../src/digest.js';
import { toEnglish } from '../src/english.js';
import { InvoiceDesk } from '../src/invoice.js';

const day = (h) => Date.parse(`2026-11-04T${h}:00Z`);
const lineOf = (text, start) => text.split('\n').find((l) => l.startsWith(start));

test('nine invoices with no order, one with an urgent point: checked 9, with problems 1, without 8, compared 0, no order 9', () => {
  const history = Array.from({ length: 9 }, (_, i) => ({ at: day('06:00') + i * 60000, verdict: 'no-order', urgent: i === 0 ? 1 : 0, priceUrgent: 0 }));
  const text = buildDigest({ history, requests: [{ at: day('05:00') }], day: '2026-11-04' });
  assert.equal(lineOf(text, '- فاکتورهای بررسی‌شده'), '- فاکتورهای بررسی‌شده: 9');
  assert.equal(lineOf(text, '- دارای ایراد'), '- دارای ایراد: 1');
  assert.equal(lineOf(text, '- بدون ایراد'), '- بدون ایراد: 8');
  assert.equal(lineOf(text, '- از این‌ها با سفارش مقایسه شد'), '- از این‌ها با سفارش مقایسه شد: 0');
  assert.equal(lineOf(text, '- فاکتور بدون سفارش در حافظه'), '- فاکتور بدون سفارش در حافظه: 9');
  const en = toEnglish(text);
  assert.ok(en.includes('- Invoices checked: 9') && en.includes('- With problems: 1') && en.includes('- Without problems: 8'));
  assert.ok(en.includes('- Of these, compared with an order: 0') && en.includes('- Invoices with no order in memory: 9'));
});

test('an unreadable file counts as checked but never as clean, on its own line; price alerts and notes count over all checks', () => {
  const history = [
    { at: day('06:00'), verdict: 'no-order', urgent: 0, priceUrgent: 2 },
    { at: day('07:00'), verdict: 'match', urgent: 0, noted: 1 },
    { at: day('08:00'), verdict: 'mismatch', urgent: 1 },
    { at: day('09:00'), verdict: 'unreadable' },
    { at: day('10:00'), verdict: 'no-order', urgent: 0, noted: 2 },
    { at: Date.parse('2026-11-03T08:00:00Z'), verdict: 'mismatch', urgent: 3 }, // another day
  ];
  const text = buildDigest({ history, requests: [], day: '2026-11-04' });
  assert.equal(lineOf(text, '- فاکتورهای بررسی‌شده'), '- فاکتورهای بررسی‌شده: 5');
  assert.equal(lineOf(text, '- دارای ایراد'), '- دارای ایراد: 1 (هشدار قیمت: 2)'); // the price alerts of the no-order invoice count
  assert.equal(lineOf(text, '- بدون ایراد'), '- بدون ایراد: 3'); // 5 - 1 problem - 1 unreadable
  assert.equal(lineOf(text, '- فاکتور ناخوانا'), '- فاکتور ناخوانا: 1');
  assert.equal(lineOf(text, '- از این‌ها با سفارش مقایسه شد'), '- از این‌ها با سفارش مقایسه شد: 2');
  assert.equal(lineOf(text, '- فاکتور بدون سفارش در حافظه'), '- فاکتور بدون سفارش در حافظه: 2');
  assert.equal(lineOf(text, '- فاکتورهای فقط دارای یادداشت'), '- فاکتورهای فقط دارای یادداشت: 2'); // the no-order one with notes counts
  assert.ok(toEnglish(text).includes('- Unreadable invoices: 1'));
});

test('a day with no unreadable file has no such line; a day with no check has no check lines at all', () => {
  const none = buildDigest({ history: [], requests: [], day: '2026-11-04' });
  assert.ok(!none.includes('از این‌ها') && !none.includes('ناخوانا'));
  const one = buildDigest({ history: [{ at: day('06:00'), verdict: 'match', urgent: 0 }], requests: [], day: '2026-11-04' });
  assert.ok(!one.includes('ناخوانا') && one.includes('- از این‌ها با سفارش مقایسه شد: 1'));
});

test('the history keeps a whole busy day (more than 50 checks), so the count is not cut', () => {
  const desk = new InvoiceDesk({ dir: '' });
  const now = Date.parse('2026-11-04T08:00:00Z');
  for (let i = 0; i < 120; i++) desk.record({ verdict: 'no-order', urgent: 0 }, now + i);
  assert.equal(desk.history.length, 120);
  const text = buildDigest({ history: desk.history, requests: [], day: '2026-11-04' });
  assert.equal(lineOf(text, '- فاکتورهای بررسی‌شده'), '- فاکتورهای بررسی‌شده: 120');
});

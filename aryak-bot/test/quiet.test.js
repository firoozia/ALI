import test from 'node:test';
import assert from 'node:assert/strict';
import { Tracker, cutDigest, reconcileCuts } from '../src/tracker.js';
import { auditInvoice, checkNumber, mergeProblems } from '../src/audit.js';
import { PriceBook } from '../src/prices.js';
import { cutFindingText, invoiceFindingText } from '../src/finding.js';
import { staffWarning } from '../src/invoice.js';
import { buildDigest } from '../src/digest.js';
import { toEnglish, hasPersian } from '../src/english.js';

const DAY = 86400000;
const T0 = Date.parse('2026-11-05T06:00:00Z');
const L = (code, quantity, unit = 'm') => ({ code, quantity, unit });
const inv = (n, customer, lines, at = T0, extra = {}) => ({ type: 'invoice', at, ref: `i${n}`, number: `inv-${n}`, customer, total: 100, lines, ...extra });
const cut = (customer, lines, at, ref) => ({ type: 'cut', at, customer, lines, ref });

function started() {
  const t = new Tracker();
  t.startedAt = T0 - 10 * DAY; // recording began long ago
  return t;
}

test('the invoice comes first and the cut the next day: nothing is said when the invoice arrives; the cut then matches by code', () => {
  const t = started();
  t.add(inv(9954, 'AL EBDA', [L('410', 9), L('216', 16)]));
  assert.deepEqual(reconcileCuts(t, 'AL EBDA', { now: T0 }), []); // no cut yet: silent (not a finding, not "no cut recorded")
  t.add(cut('AL EBDA', [L('410', 9)], T0 + DAY, 'c1'));
  t.add(cut('AL EBDA', [L('216', 16)], T0 + DAY + 60000, 'c2'));
  assert.deepEqual(reconcileCuts(t, 'AL EBDA', { now: T0 + DAY + 120000 }), []);
});

test('the cut first, then the invoice: the same comparison; a cut above the invoice is said at once', () => {
  const t = started();
  t.add(cut('DANDY DOOR', [L('410', 12)], T0 - 3600000, 'c1'));
  t.add(inv(9955, 'Dandy Door', [L('410', 9)]));
  const f = reconcileCuts(t, 'DANDY DOOR', { now: T0 });
  assert.deepEqual(f.map((x) => [x.kind, x.code, x.invoiced, x.cut]), [['cut-over', '410', 9, 12]]);
  assert.match(cutFindingText(f, 'Atossa'), /Invoice inv-9955, code 410: invoiced 9 m, cut 12 m \(cut is MORE than invoiced\)/);
});

test('a partial cut is a shortfall only after the window; several captions add up; the tolerance and the rolls opened for cutting', () => {
  const t = started();
  t.add(inv(9956, 'DESIGNER', [L('220', 30)]));
  t.add(cut('DESIGNER', [L('220', 18)], T0 + 3600000, 'c1'));
  assert.deepEqual(reconcileCuts(t, 'DESIGNER', { now: T0 + DAY }), []); // one day: wait
  t.add(cut('DESIGNER', [L('220', 12.2)], T0 + 2 * DAY, 'c2')); // 18+12 and 0.2 over: inside the tolerance
  assert.deepEqual(reconcileCuts(t, 'DESIGNER', { now: T0 + 4 * DAY }), []);
  const u = started();
  u.add(inv(9957, 'DESIGNER', [L('220', 30)]));
  u.add(cut('DESIGNER', [L('220', 18)], T0 + 3600000, 'c1'));
  u.add({ type: 'cut', at: T0 + 100, customer: '', internal: true, lines: [L('220', 120)], ref: 'x' }); // FOR CUT roll: ignored
  const short = reconcileCuts(u, 'DESIGNER', { now: T0 + 4 * DAY });
  assert.deepEqual(short.map((x) => [x.kind, x.invoiced, x.cut]), [['cut-short', 30, 18]]);
});

test('no cut at all and a cut with no invoice are only digest counts; a letter variant is not a mismatch; the learning grace is respected', () => {
  const t = started();
  t.add(inv(9958, 'KITCHEN PALACE', [L('108', 10)]));
  t.add(cut('KITCHEN PALACE', [L('108 C', 10)], T0 + 100, 'c1')); // 108 C is another code: no total for 108, so no finding
  t.add(cut('NOBODY', [L('300', 5)], T0 - 2 * DAY, 'c2'));
  assert.deepEqual(reconcileCuts(t, 'KITCHEN PALACE', { now: T0 + 5 * DAY }), []);
  assert.deepEqual(cutDigest(t, { now: T0 + 5 * DAY }), { invoiceNoCut: 1, cutNoInvoice: 1 });
  const fresh = new Tracker(); // recording began just now
  fresh.add(inv(1, 'A', [L('410', 10)], T0));
  fresh.add(cut('A', [L('410', 5)], T0 + 100, 'c1'));
  assert.deepEqual(reconcileCuts(fresh, 'A', { now: T0 + 3.5 * DAY, graceDays: 5 }), []); // not before the grace days after recording began
  assert.equal(reconcileCuts(fresh, 'A', { now: T0 + 3.5 * DAY, graceDays: 3 }).length, 1);
});

// The batch of real invoices of one morning, as anonymised shapes: five clean invoices.
test('a batch of five clean invoices produces no message and no warning, whatever the price list says', () => {
  const book = new PriceBook(''); // no list at all: only notes
  const batch = [9954, 9955, 9956, 9957, 9958].map((n, i) => ({
    number: `inv-${n}`, customer: 'KITCHEN PALACE', currency: 'AED', lines: [{ code: 'PVC FILM216', quantity: 16, unit: 'm', unit_price: 8, line_total: 128 }, { code: 'PVC 1806', quantity: 4 + i, unit: 'm', unit_price: 8, line_total: (4 + i) * 8 }],
    subtotal: 128 + (4 + i) * 8, vat: Math.round((128 + (4 + i) * 8) * 5) / 100, total: Math.round((128 + (4 + i) * 8) * 105) / 100,
  }));
  const seen = [];
  let messages = 0;
  for (const invoice of batch) {
    const problems = [...auditInvoice(invoice, { book, customer: 'KITCHEN PALACE' }), ...checkNumber(invoice.number, seen)];
    seen.push(invoice.number);
    const urgent = problems.filter((p) => p.severity !== 'info');
    assert.equal(urgent.length, 0, JSON.stringify(problems));
    assert.equal(problems.length > 0, true); // there are notes ("prices not checked") ...
    assert.equal(staffWarning({ verdict: 'match', invoice_number: invoice.number, problems }, 'Atossa'), null); // ... but never a warning headline
    if (urgent.length) messages++; // the group message is posted only for urgent points
  }
  assert.equal(messages, 0);
});

test('a real mistake is one short English message per invoice, never more', () => {
  const problems = mergeProblems([{ kind: 'quantity', item: '511', requested: '35 m', invoiced: '53 m', note: 'مقدار با سفارش ثبت‌شده فرق دارد', severity: 'urgent' }],
    [{ kind: 'price-below', item: '511', requested: '12.00', invoiced: '9.00', note: 'قیمت 25 درصد کمتر از لیست است', severity: 'urgent' }, { kind: 'price-unknown', item: '999', note: 'x', severity: 'info' }]);
  const text = invoiceFindingText({ number: 'inv-9954', customer: 'AL EBDA', problems }, 'Atossa');
  assert.equal(hasPersian(text), false);
  assert.equal(text.split('\n').filter((l) => l.startsWith('⚠️')).length, 1);
  assert.match(text, /Invoice inv-9954 — AL EBDA: 2 problems/);
  assert.match(text, /- Wrong quantity 511 \(correct: 35 m, invoice: 53 m\)/);
  assert.ok(!text.includes('999')); // a note is not in it
});

test('the summary counts the silent notes instead of posting them', () => {
  const day = '2026-11-05';
  const history = [1, 2, 3].map((i) => ({ at: T0 + i, verdict: 'match', urgent: 0, noted: 2 }));
  const text = toEnglish(buildDigest({ history, requests: [], day, timeZone: 'UTC', events: [], extraLines: ['- Invoices with no cut recorded yet: 2'] }));
  assert.match(text, /Invoices with notes only: 3/);
  assert.match(text, /Invoices with no cut recorded yet: 2/);
});

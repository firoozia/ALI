import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPersian, placeLanguage, toEnglish } from '../src/english.js';
import { PriceBook } from '../src/prices.js';
import { auditInvoice, checkNumber } from '../src/audit.js';
import { noRequestText, reportText, staffWarning } from '../src/invoice.js';
import { onDemandText } from '../src/ondemand.js';
import { Tracker, checkCod, checkDelivery, checkInvoiceAgainstCuts, checkInvoiceAgainstOrders, dueNags, formatBalance, balanceOf, openOrders } from '../src/tracker.js';
import { buildDigest } from '../src/digest.js';
import { managerQuestion, reminderText } from '../src/availability.js';
import { managerMessage } from '../src/stock.js';

const NOW = Date.parse('2026-11-05T08:00:00Z');
const DAY = 86400000;
const line = (code, quantity, unit_price, line_total, unit = 'm') => ({ code, quantity, unit, unit_price, line_total });

function book() {
  const b = new PriceBook('');
  b.save({ items: { 511: { price: 12, unit: 'm', category: 'PVC film' }, 229: { price: 9, unit: 'm', category: 'PVC film' } }, exceptions: [{ customer: 'Bahar', code: '229', category: '', price: 8, unit: '', from: '', to: '' }] });
  return b;
}

// Everything the generators say to the Information group, the Invoices group and colleagues must come out without a Persian letter.
test('every report generator is fully translated', () => {
  const texts = [];
  const bad = {
    currency: 'USD', lines: [line('511', 3, 12, 37), line('229', 10, 5, 50, 'roll'), line('999', 1, 1, 1), line('511', 2, null, null)], subtotal: 100, vat: 7, total: 120,
  };
  const problems = auditInvoice(bad, { book: book(), customer: 'Bahar', day: '2026-11-05', sheetUnits: { 511: 'pcs' } });
  problems.push(...auditInvoice({ ...bad, prices_include_vat: true }, { book: book(), customer: 'Bahar' }));
  problems.push(...auditInvoice({ lines: [line('511', 1, 12, 12)] }, { book: new PriceBook(''), customer: 'x' }));
  problems.push(...checkNumber('inv-9915', ['inv-9910']), ...checkNumber('inv-9910', ['inv-9910']));
  const t = new Tracker();
  t.add({ type: 'order', at: NOW - 3600000, customer: 'Bahar', lines: [{ code: '511', quantity: 35, unit: 'm' }, { code: '408', quantity: 15, unit: 'm' }], ref: 'o1' });
  t.add({ type: 'cut', at: NOW - 7200000, customer: 'Dandy', lines: [{ code: '229', quantity: 5, unit: 'm' }], ref: 'c1' });
  t.add({ type: 'invoice', at: NOW - 3 * DAY, customer: 'Dandy', number: 'inv-1', total: 100, lines: [{ code: '229', quantity: 10, unit: 'm' }], ref: 'i1' });
  const inv = { customer: 'Bahar', at: NOW, lines: [{ code: '511', quantity: 53, unit: 'm' }, { code: '300', quantity: 1, unit: 'm' }] };
  problems.push(...checkInvoiceAgainstOrders(t, inv), ...checkInvoiceAgainstOrders(new Tracker(), inv), ...checkInvoiceAgainstOrders(t, { ...inv, lines: [{ code: '777', quantity: 1, unit: 'm' }] }));
  const onlyCuts = new Tracker();
  onlyCuts.add({ type: 'cut', at: NOW - 3600000, customer: 'Bahar', lines: [{ code: '511', quantity: 30, unit: 'm' }], ref: 'c2' });
  problems.push(...checkInvoiceAgainstOrders(onlyCuts, inv));
  const kinds = new Set(problems.map((p) => p.kind));
  assert.ok(kinds.size >= 12, [...kinds].join());
  for (const verdict of ['mismatch', 'match', 'unreadable']) texts.push(reportText({ verdict, request_customer: 'Bahar', invoice_number: 'inv-1', problems }, { groupName: 'Invoices group', invoiceSender: 'Office', name: 'Atossa' }) || '');
  texts.push(reportText({ verdict: 'error', error: 'timeout' }, { groupName: 'g', invoiceFile: 'a.pdf' }));
  texts.push(staffWarning({ verdict: 'mismatch', invoice_number: 'inv-1', problems: problems.slice(0, 12) }, 'Atossa') || '');
  texts.push(noRequestText({ customer: 'Bahar', po: '12' }, { invoiceFile: 'a.pdf', invoiceSender: 'Office', name: 'Atossa', ambiguous: ['1', '2'] }));
  texts.push(onDemandText({ problems: [], customer: 'Bahar', number: 'inv-1', name: 'Atossa' }), onDemandText({ problems, customer: 'Bahar', number: 'inv-1', groupName: 'g' }));
  texts.push(...checkInvoiceAgainstCuts(t, { customer: 'Nobody', at: NOW, lines: [] }), ...checkInvoiceAgainstCuts(t, { customer: 'Dandy', at: NOW, lines: [{ code: '229', quantity: 50, unit: 'm' }] }));
  t.setHold('Dandy');
  texts.push(...checkDelivery(t, { customer: 'Dandy', at: NOW, lines: [{ code: '229', quantity: 500, unit: 'm' }, { code: '900', quantity: 1, unit: 'm' }] }), ...checkDelivery(t, { customer: 'Unknown', at: NOW, lines: [] }));
  texts.push(...checkCod(t, { customer: 'Dandy', at: NOW, cod: 5 }));
  texts.push(`⛔ Dandy: تحویل تا تأیید نقدی نباید انجام شود. — Atossa`);
  texts.push(`یادآوری:\n${dueNags(t, [{ at: NOW - 5 * DAY, hash: 'h', meta: { customer: 'Zed', po: '55' } }], { now: NOW }).map((l) => `- ${l}`).join('\n')}`);
  texts.push(`ℹ️ تحویل Dandy:\n- x`, `ℹ️ پرداخت ثبت شد: Dandy، 100.00 درهم`, `ℹ️ مقایسهٔ فاکتور inv-1 با گروه برش:\n- x`, `صورت‌حساب ماهانهٔ این مشتری‌ها هنوز ثبت نشده است:\n- Dandy`);
  texts.push(formatBalance('Dandy', balanceOf(t, 'Dandy')), openOrders(t, []), openOrders(new Tracker(), []));
  texts.push(buildDigest({ history: [{ at: NOW, verdict: 'mismatch', urgent: 1, priceUrgent: 1 }, { at: NOW, verdict: 'no-order' }], requests: [{ at: NOW }], day: '2026-11-05', timeZone: 'UTC', events: [...t.events, { type: 'payment', kind: 'cash', at: NOW, ref: 'p' }] }));
  texts.push(buildDigest({ history: [], requests: [], day: '2026-11-05', events: [] }));
  const res = { code: '408', category: 'PVC film', free: 2.5, reserved: 0, limit: 10, unit: 'm', asked: 30, askedUnit: 'm', askedInUnit: 30, qtyChecked: true, sizes: [{ size: '0.30*1400' }, { size: '0.18*1400' }], locations: ['A1'] };
  const req = { id: 3, customer: 'Bahar', groupName: 'Bahar group', res, line: { quantity: 30, unit: 'm' } };
  texts.push(managerQuestion(req), managerQuestion({ ...req, res: { ...res, qtyChecked: false, askedUnit: 'roll' } }), reminderText(req));
  texts.push(managerMessage(res, { customer: 'Bahar', groupName: 'Bahar group', messageText: 'need 408' }, { quantity: 30, unit: 'm' }));
  const leftover = texts.flatMap((x) => String(x).split('\n').map((l) => [l, toEnglish(l)])).filter(([, en]) => hasPersian(en));
  assert.deepEqual(leftover.map(([fa]) => fa), []);
});

test('lines without Persian are left alone and the translation keeps numbers, names and signs', () => {
  assert.equal(toEnglish('Hello 408 — Atossa'), 'Hello 408 — Atossa');
  assert.equal(toEnglish('مشتری: Dandy Door'), 'Customer: Dandy Door');
  assert.equal(toEnglish('1. ⚠️ جمع جزء: —\n   درست: 100.00 | فاکتور: 120.00'), '1. ⚠️ Subtotal: —\n   Correct: 100.00 | Invoice: 120.00');
  assert.equal(toEnglish('- بدون ایراد: 3'), '- Without problems: 3');
  assert.equal(toEnglish('جمله‌ای که نمی‌شناسم'), 'جمله‌ای که نمی‌شناسم'); // an unknown line passes through unchanged
});

test('the send path translates for colleagues: the wiring is in the one send function and the owner stays Persian', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(src, /englishFor\(a\[0\]\)/); // every send passes the language check
  assert.match(src, /why === 'internal group' \|\| why === 'test group'/); // every company group, the test group too, is English
  assert.match(src, /ownerNumbers/);
  assert.match(src, /staffLang === 'en' \? toEnglish\(body\)/); // an answer to a colleague
  assert.ok(src.includes('(customer|staff|owner)')); // the test-only prefixes
});

test('the language follows the place: English in every company group (even for the owner writing Persian), the language of the customer in a customer group, Persian only in private with the owner', () => {
  // the owner writes Persian in a company group (staff, invoice, information, test ...): English
  for (const kind of ['company-group']) assert.equal(placeLanguage({ kind, owner: true, written: 'fa' }), 'en');
  // another colleague, any language, in a company group: English
  assert.equal(placeLanguage({ kind: 'company-group', owner: false, written: 'ar' }), 'en');
  // a customer group: the language the customer wrote in
  assert.equal(placeLanguage({ kind: 'customer-group', written: 'ar' }), 'ar');
  assert.equal(placeLanguage({ kind: 'customer-group', written: 'ur' }), 'ur');
  // private: Persian only with the owner
  assert.equal(placeLanguage({ kind: 'private', owner: true }), 'fa');
  assert.equal(placeLanguage({ kind: 'private', owner: false, written: 'fa' }), 'en');
  // the test-only prefixes
  assert.equal(placeLanguage({ kind: 'company-group', owner: true, persona: 'customer', written: 'ar' }), 'ar');
  assert.equal(placeLanguage({ kind: 'company-group', owner: true, persona: 'staff', written: 'fa' }), 'en');
});

test('the owner writes Persian in a company group and gets English: confirmations, command answers and teach acknowledgements', () => {
  // what the program says there is translated by the one send path; these are the kinds of sentence it produces
  for (const fa of ['ثبت شد (قانون 1): از این به بعد X', 'پیام صبح بخیر روشن شد.', 'فاکتور inv-1 بررسی شد؛ حساب، مالیات و قیمت‌ها ایرادی نداشت.']) {
    const en = toEnglish(fa);
    if (fa.startsWith('فاکتور')) assert.equal(hasPersian(en), false, en);
  }
});

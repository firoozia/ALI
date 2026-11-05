import test from 'node:test';
import assert from 'node:assert/strict';
import { PriceBook } from '../src/prices.js';
import { auditInvoice, checkNumber } from '../src/audit.js';
import { kindLabel, reportText, staffWarning } from '../src/invoice.js';
import { Tracker, checkInvoiceAgainstOrders } from '../src/tracker.js';
import { sourcingCover, sourcingEvent } from '../src/sourcing.js';
import { runAvailability, AvailabilityDesk } from '../src/availability.js';
import { invoiceFindingText } from '../src/finding.js';
import { toEnglish } from '../src/english.js';

const NOW = Date.parse('2026-11-05T08:00:00Z');
const line = (code, quantity, unit_price, line_total, unit = 'm') => ({ code, quantity, unit, unit_price, line_total });

function allProblems() {
  const book = new PriceBook('');
  book.save({ items: { 511: { price: 12, unit: 'm', category: 'PVC film' } }, exceptions: [] });
  const bad = { currency: 'USD', lines: [line('511', 3, 12, 37), line('999', 1, 1, 1), line('511', 2, null, null)], subtotal: 100, vat: 7, total: 120 };
  const t = new Tracker();
  t.add({ type: 'order', at: NOW - 3600000, customer: 'Bahar', lines: [{ code: '511', quantity: 35, unit: 'm' }, { code: '408', quantity: 15, unit: 'm' }], ref: 'o' });
  t.add({ ...sourcingEvent('Do you have 300 - 5 mtr?'), at: NOW, customer: 'Master', group: 'g', ref: 's', status: 'answered' });
  const inv = { customer: 'Bahar', at: NOW, lines: [{ code: '511', quantity: 53, unit: 'm' }, { code: '300', quantity: 5, unit: 'm' }] };
  return [
    ...auditInvoice(bad, { book, customer: 'Bahar', sheetUnits: { 511: 'pcs' } }), ...auditInvoice({ lines: [line('511', 1, 12, 12)] }, { book: new PriceBook(''), customer: 'x' }),
    ...checkNumber('inv-9915', ['inv-9910']), ...checkNumber('inv-9910', ['inv-9910']),
    ...checkInvoiceAgainstOrders(t, inv), ...checkInvoiceAgainstOrders(new Tracker(), inv, { explain: true }), ...sourcingCover(t, inv),
    { kind: 'cut-over', item: '510', severity: 'urgent' }, { kind: 'cut-short', item: '510', severity: 'info' },
  ];
}

test('every kind of point has a human label: no raw internal word like "order-note" is ever a title', () => {
  const problems = allProblems();
  const kinds = [...new Set(problems.map((p) => p.kind))];
  assert.ok(kinds.length >= 14, kinds.join());
  for (const k of kinds) assert.ok(!/-/.test(kindLabel(k)) && kindLabel(k) !== k || /^[a-z]+$/.test(k) === false || kindLabel(k) !== k, k);
  const text = reportText({ verdict: 'mismatch', request_customer: 'Bahar', invoice_number: 'inv-1', problems }, { groupName: 'g' });
  const titles = text.split('\n').filter((l) => /^\d+\./.test(l));
  assert.ok(titles.length >= kinds.length);
  for (const l of titles) assert.ok(!/^\d+\.\s*(?:⚠️\s*)?[a-z]+(?:-[a-z]+)+(?::|$)/.test(l), `a raw kind is a title: ${l}`);
  const warn = staffWarning({ verdict: 'mismatch', invoice_number: 'inv-1', problems }, 'Atossa');
  for (const l of warn.split('\n').filter((x) => /^\d+\./.test(x))) assert.ok(!/^\d+\.\s*[a-z]+(?:-[a-z]+)+/.test(l), l);
  // the English the colleagues read has the labels too
  const en = toEnglish(text);
  assert.ok(!/order-note|sourcing-cover|prices-unchecked|price-unknown/.test(en), en);
  assert.match(en, /Order note/);
  assert.match(invoiceFindingText({ number: 'inv-1', customer: 'B', problems: [{ kind: 'order-note', severity: 'urgent', item: '' }] }), /- Order note/);
});

test('an empty item never leaves a bare dash after the title', () => {
  const text = reportText({ verdict: 'match', request_customer: 'Bahar', problems: [{ kind: 'prices-unchecked', item: '', requested: '', invoiced: '', note: 'لیست قیمت بارگذاری نشده است؛ قیمت‌های این فاکتور سنجیده نشد', severity: 'info' }, { kind: 'order-note', item: '', note: 'x', severity: 'info' }] }, { groupName: 'g' });
  for (const l of text.split('\n').filter((x) => /^\d+\./.test(x))) assert.ok(!/: —\s*$/.test(l) && !/—\s*$/.test(l), l);
  assert.match(text, /\n1\. قیمت‌ها سنجیده نشد\n/);
  assert.match(toEnglish(text), /\n1\. Prices not checked\n/);
  // with an item the colon stays
  assert.match(reportText({ verdict: 'mismatch', problems: [{ kind: 'price-below', item: '511', requested: '12.00', invoiced: '9.00', note: '', severity: 'urgent' }] }, { groupName: 'g' }), /قیمت کمتر از لیست: 511/);
});

test('the proposed reply is in the language of the customer: "221" next to Arabic words is answered in Arabic, in the shadow card and the real path alike', async () => {
  const sent = [];
  const flow = await runAvailability({
    messages: [{ text: '221', sender: 'a' }, { text: 'هل يوجد لديكم', sender: 'a' }], groupId: 'g', groupName: 'ALWAN SHAM', customer: 'ALWAN SHAM', desk: new AvailabilityDesk({ dir: '' }),
    decide: async () => ({ kind: 'unhandled' }), send: async (gid, text) => { sent.push(text); }, notifyManager: async () => null,
  });
  assert.equal(flow.lang, 'ar');
  assert.match(sent[0], /[؀-ۿ]/); // Arabic letters, not English
  assert.ok(!/how many/i.test(sent[0]));
  // an English batch stays English, a Persian one Persian
  const en = [];
  const f2 = await runAvailability({ messages: [{ text: '221', sender: 'b' }, { text: 'available?', sender: 'b' }], groupId: 'g', groupName: 'x', customer: 'x', desk: new AvailabilityDesk({ dir: '' }), decide: async () => ({ kind: 'unhandled' }), send: async (g, t) => { en.push(t); }, notifyManager: async () => null });
  assert.equal(f2.lang, 'en');
  assert.match(en[0], /how many/i);
});

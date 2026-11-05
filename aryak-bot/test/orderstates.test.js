import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Tracker, checkInvoiceAgainstOrders } from '../src/tracker.js';
import { InvoiceDesk } from '../src/invoice.js';
import { CustomerGroups, customerRowFor, rowOfGroup } from '../src/customergroups.js';
import { Aliases } from '../src/aliases.js';
import { buildDigest, isOrderStatusCommand, orderStateOf, orderStatusText } from '../src/digest.js';
import { toEnglish } from '../src/english.js';
import { confirmText } from '../src/invoicesend.js';

// Invented names only: the real customer names never go into the repository.
const day = (h) => Date.parse(`2026-11-04T${h}:00Z`);
const lineOf = (text, start) => text.split('\n').find((l) => l.startsWith(start));
const read = { number: 'inv-1', customer: 'Orion', total: 100, urgent: 0, checked: true };

test('the confirmation says which of the three states: a text order compared (same or differs), or no order in memory (not a problem)', () => {
  const base = { fileName: 'inv-1 ORION.pdf', group: 'ORION - ARYAK' };
  const same = confirmText({ ...base, read: { ...read, orderState: 'text', orderPoints: [] } });
  assert.ok(same.includes('Compared with a text order (low confidence): same.'));
  assert.ok(!same.includes('No matching') && !same.includes('No order in memory'));
  const differs = confirmText({ ...base, read: { ...read, urgent: 1, orderState: 'text', orderPoints: ['Wrong quantity 407 (correct: 10 m, invoice: 12 m)'] } });
  assert.ok(differs.includes('Compared with a text order (low confidence): differs: Wrong quantity 407'));
  assert.ok(!differs.includes('No order in memory'));
  const none = confirmText({ ...base, read: { ...read, orderState: 'none', noOrder: true } });
  assert.ok(none.includes('No order in memory; only arithmetic and number were checked.'));
  assert.ok(!none.includes('⚠️ No order') && !none.includes('No matching')); // not a warning, not a problem
  const pdf = confirmText({ ...base, read: { ...read, orderState: 'pdf' } });
  assert.ok(!pdf.includes('order in memory') && !pdf.includes('text order'));
});

test('the daily summary counts the three states apart and the text orders of the groups apart', () => {
  const history = [
    { at: day('06:00'), verdict: 'match', urgent: 0, orderState: 'pdf' },
    { at: day('07:00'), verdict: 'no-order', urgent: 0, orderState: 'text' }, // a text order was compared: still verdict no-order (no PDF)
    { at: day('08:00'), verdict: 'no-order', urgent: 1, orderState: 'text' },
    { at: day('09:00'), verdict: 'no-order', urgent: 0, orderState: 'none' },
    { at: day('10:00'), verdict: 'no-order', urgent: 0 }, // an older entry without the state: no order
  ];
  const events = [{ type: 'order', at: day('05:00'), source: 'observed' }, { type: 'order', at: day('05:30'), source: 'photo' }, { type: 'order', at: Date.parse('2026-11-03T05:00:00Z'), source: 'observed' }];
  const text = buildDigest({ history, requests: [{ at: day('04:00') }], events, day: '2026-11-04' });
  assert.equal(lineOf(text, '- سفارش‌های دریافتی'), '- سفارش‌های دریافتی: 1'); // PDF orders
  assert.equal(lineOf(text, '- سفارش‌های متنی و عکسی'), '- سفارش‌های متنی و عکسی گروه‌ها (اطمینان کم): 2');
  assert.equal(lineOf(text, '- از این‌ها با سفارش مقایسه شد'), '- از این‌ها با سفارش مقایسه شد: 3');
  assert.equal(lineOf(text, '- از این‌ها با سفارش متنی'), '- از این‌ها با سفارش متنی (اطمینان کم): 2');
  assert.equal(lineOf(text, '- فاکتور بدون سفارش در حافظه'), '- فاکتور بدون سفارش در حافظه: 2');
  assert.equal(lineOf(text, '- دارای ایراد'), '- دارای ایراد: 1');
  const en = toEnglish(text);
  assert.ok(en.includes('- Of these, compared with a text order (low confidence): 2') && en.includes('- Invoices with no order in memory: 2') && en.includes('- Text and photo orders seen in groups (low confidence): 2'));
  assert.equal(orderStateOf({ verdict: 'unreadable' }), 'unreadable');
  assert.equal(orderStateOf({ verdict: 'no-order' }), 'none');
  assert.equal(orderStateOf({ verdict: 'match' }), 'pdf');
});

test('"وضعیت سفارش‌ها": counts only, no names, seven days, owner only in his own chat', () => {
  const now = day('12:00');
  const events = [
    { type: 'order', at: day('01:00'), source: 'observed', customer: 'SECRET NAME' }, { type: 'order', at: day('02:00'), source: 'customer-text' }, { type: 'order', at: day('03:00'), source: 'photo' },
    { type: 'order', at: day('04:00'), source: 'voice' }, { type: 'order', at: now - 9 * 86400000, source: 'observed' }, { type: 'cut', at: day('05:00') },
  ];
  const history = [
    { at: day('06:00'), verdict: 'match', orderState: 'pdf', customer: 'SECRET NAME' }, { at: day('07:00'), verdict: 'no-order', orderState: 'text' },
    { at: day('08:00'), verdict: 'no-order', orderState: 'none' }, { at: day('09:00'), verdict: 'unreadable' }, { at: now - 9 * 86400000, verdict: 'no-order' },
  ];
  const out = orderStatusText({ events, requests: [{ at: day('02:00') }, { at: now - 20 * 86400000 }], history, now });
  assert.ok(out.includes('- سفارش فایل: 1') && out.includes('- سفارش متنی گروه (اطمینان کم): 2') && out.includes('- سفارش از عکس تأییدشده: 1') && out.includes('- سفارش از راه‌های دیگر: 1'));
  assert.ok(out.includes('- فاکتورهای بررسی‌شده: 4') && out.includes('با سفارش فایل مقایسه شد: 1') && out.includes('با سفارش متنی (اطمینان کم) مقایسه شد: 1') && out.includes('سفارشی در حافظه نبود: 1') && out.includes('ناخوانا: 1'));
  assert.ok(!out.includes('SECRET NAME'));
  assert.ok(out.includes('ایراد حساب نمی‌شود')); // a missing order from a private chat or phone is expected, not a problem
  for (const t of ['وضعیت سفارش‌ها', 'وضعیت سفارش ها', 'آتوسا وضعیت سفارش‌ها']) assert.equal(isOrderStatusCommand(t), true, t);
  assert.equal(isOrderStatusCommand('وضعیت سفارش نوکوش را بگو'), false);
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  const at = src.indexOf('isOrderStatusCommand(text)');
  const block = src.slice(at - 200, at + 400);
  assert.ok(block.includes('!group && isSelf') && block.includes('isOwnerCommand('));
});

test('an order in a customer group belongs to the customer of its approved row, so an invoice printed with another spelling is compared with it', () => {
  const list = new CustomerGroups('');
  const aliases = new Aliases('');
  list.approveGroups('Orion', [{ jid: 'o1@g.us', subject: 'ORION - ARYAK' }, { jid: 'o2@g.us', subject: 'ORION TEAM - ARYAK' }]);
  const tracker = new Tracker({ dir: '' });
  const owner = (jid, label) => rowOfGroup(list, jid)?.customer || label;
  // the text order is written in the SECOND group of the customer; the group's own label is not the customer's name
  tracker.add({ type: 'order', at: day('06:00'), customer: owner('o2@g.us', 'SOME TEAM LABEL'), lines: [{ code: '407', quantity: 10, unit: 'm' }], source: 'observed', confidence: 'low', ref: 'r1' });
  assert.equal(rowOfGroup(list, 'zz@g.us'), null);
  // the invoice prints a differently spelled name: the row is found through the near duplicate
  const printed = 'ORION FURNITURE INDUSTRIES LLC';
  const row = customerRowFor(printed, { list, aliases });
  assert.equal(row.customer, 'Orion');
  const same = checkInvoiceAgainstOrders(tracker, { customer: row.customer, at: day('08:00'), lines: [{ code: '407', quantity: 10, unit: 'm' }] }, { explain: true });
  assert.ok(!same.some((p) => p.kind === 'order-note') && same.length === 0); // compared with the text order: same
  const differs = checkInvoiceAgainstOrders(tracker, { customer: row.customer, at: day('08:00'), lines: [{ code: '407', quantity: 12, unit: 'm' }] }, { explain: true });
  assert.ok(differs.some((p) => p.kind === 'quantity'));
  const empty = checkInvoiceAgainstOrders(new Tracker({ dir: '' }), { customer: row.customer, at: day('08:00'), lines: [{ code: '407', quantity: 10, unit: 'm' }] }, { explain: true });
  assert.ok(empty.some((p) => p.kind === 'order-note')); // nothing in memory: the third state
  assert.equal(customerRowFor('Cedar Works', { list, aliases }), null);
});

test('a PDF order from a customer group is found for an invoice with another spelling of the name', () => {
  const desk = new InvoiceDesk({ dir: '' });
  desk.addRequest({ hash: 'h1', base64: '', fileName: 'po.pdf' }, { customer: 'Orion Team', po: '', mapped: 'Orion' }, 'ORION TEAM - ARYAK');
  assert.ok(desk.find({ customer: 'ORION FURNITURE INDUSTRIES LLC', po: '', mapped: 'Orion' }).request); // through the row's customer
  assert.ok(desk.find({ customer: 'Cedar', po: '', mapped: '' }).none); // another customer: nothing
  assert.ok(desk.find({ customer: 'ORION FURNITURE INDUSTRIES LLC', po: '' }).none); // no row: the old exact-name rule
});

test('the wiring: the group order uses the row of its group first; the check keeps the state; a text order never becomes "no matching order"', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /const customerOfGroup = \(groupId, label\) => rowOfGroup\(customerGroups, groupId\)\?\.customer \|\| canon\(label\)/);
  assert.match(src, /customer: customerOfGroup\(groupId, label\), group: groupId, ref/); // sourcing
  assert.match(src, /: customerOfGroup\(groupId, label\), lines:/); // the order seen in a watched group
  assert.match(src, /const orderState = found\.request \? 'pdf' : \(verdict\.invoice && !ordAll\.some\(\(p\) => p\.kind === 'order-note'\) \? 'text' : 'none'\)/);
  assert.match(src, /noted: problems\.length - urgent, number, orderState \}\)/);
  assert.match(src, /desk\.addRequest\(doc, \{ \.\.\.meta, mapped: rowOfGroup\(customerGroups, groupId\)/);
  assert.ok(!src.includes('No matching purchase order'));
});

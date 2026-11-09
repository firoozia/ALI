import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { unbilled, unbilledText } from '../src/unbilled.js';
import { parseInvoiceCommand } from '../src/qboinvoice.js';

// Invented customers, codes and quantities only.
const NOW = Date.parse('2026-11-09T14:00:00Z'); const DAY = 24 * 3600 * 1000;
const cut = (customer, code, quantity, daysAgo, extra = {}) => ({ type: 'cut', at: NOW - daysAgo * DAY, customer, customerTyped: customer, lines: [{ code, quantity, unit: 'm', ...extra }], ref: `${customer}${code}${daysAgo}` });
const inv = (customer, date, ...itemIds) => ({ CustomerRef: { name: customer }, TxnDate: date, Line: itemIds.map((id) => ({ DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: id } } })) });
const codesOf = (id) => ({ 1: ['303'], 2: ['215'], 3: ['702'], 4: ['220'] }[id] || []);

test('what was cut or delivered and has no invoice yet: the owner\'s quantity rule, the customer must be the same, aliases the owner approved count, internal and simulated posts never', () => {
  const events = [
    cut('MUNICH DOOR KITCHEN', 'ART NO 303', 6.4, 1),          // invoiced for 6 two days later: covered (the invoice follows the order)
    cut('MUNICH DOOR KITCHEN', 'ART NO 215', 11, 4),           // no invoice line with 215
    cut('MUNICH DOOR KITCHEN', 'ART NO 702', 4.4, 6),          // an invoice with 702 dated BEFORE the cut does not cover it
    cut('AL NOOR DOOR KITCHEN', 'ART NO 220', 5, 1),           // another customer that shares trade words: its own invoices only
    { ...cut('HAMID TRD', 'ART NO 303', 3, 1) },               // an alias the owner approved for HAMED TRADING
    { ...cut('ZED', 'ART NO 303', 3, 1), internal: true },     // a roll for cutting: never a customer's
    { ...cut('ZED', 'ART NO 303', 3, 1), simulated: true },    // test data
    cut('OLD CUSTOMER', 'ART NO 303', 3, 45),                  // out of the window
    { type: 'delivery', at: NOW - 2 * DAY, customer: 'NUQOOSH', customerTyped: 'NUQOOSH', lines: [], delivered: { quantity: 2, unit: 'roll' } },
    { type: 'delivery', at: NOW - 2 * DAY, customer: 'DANDY DOOR', customerTyped: 'DANDY DOOR', lines: [], delivered: { quantity: 1, unit: 'roll' } },
  ];
  const invoices = [
    inv('MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C', '2026-11-08', '1'), inv('MUNICH DOOR KITCHEN TRADING L.L.C- S.P.C', '2026-11-02', '3'),
    inv('AL NOOR DOOR KITCHEN TRADING LLC', '2026-11-05', '2'), inv('HAMED TRADING', '2026-11-09', '1'),
    inv('NUQOOSH IND . LLC', '2026-11-09', '4'),               // NUQOOSH was invoiced after the delivery
  ];
  const r = unbilled({ events, invoices, itemCodes: codesOf, aliasOf: (n) => (n === 'HAMID TRD' ? 'HAMED TRADING' : ''), now: NOW });
  const by = Object.fromEntries(r.groups.map((g) => [g.customer, g.parts]));
  assert.deepEqual(by['MUNICH DOOR KITCHEN'], ['215 11m 05/11', '702 4.4m 03/11']);
  assert.deepEqual(by['AL NOOR DOOR KITCHEN'], ['220 5m 08/11']); // its 215 invoice is not Munich's, and its own 220 has no invoice
  assert.equal(by['HAMID TRD'], undefined); assert.equal(by.ZED, undefined); assert.equal(by['OLD CUSTOMER'], undefined); assert.equal(by.NUQOOSH, undefined);
  assert.deepEqual(by['DANDY DOOR'], ['delivered 07/11, no invoice since']);
  assert.equal(r.customers, 3);
});

test('the text: short, at most ten lines then «+N more», a clean day in one line; a cut the program itself recorded as invoiced is covered', () => {
  assert.equal(unbilledText({ groups: [] }), '✔ Everything cut or delivered in the last 30 days has an invoice.');
  const groups = Array.from({ length: 13 }, (_, i) => ({ customer: `CUSTOMER ${i + 1}`, parts: ['303 6m 08/11'] }));
  const text = unbilledText({ groups });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Cut or delivered, not invoiced (13 customers):'); assert.equal(lines.length, 12); assert.equal(lines.at(-1), '+3 more');
  const many = unbilledText({ groups: [{ customer: 'X', parts: ['1', '2', '3', '4', '5', '6'] }] }).split('\n')[1];
  assert.equal(many, '• X: 1, 2, 3, 4 +2');
  const done = unbilled({ events: [cut('X', 'ART NO 303', 6, 1, { invoiced: { number: 'inv-1', at: NOW } })], invoices: [], itemCodes: codesOf, now: NOW });
  assert.equal(done.groups.length, 0);
});

test('the words and the wiring: «unbilled» on request; the evening hour and the target are settings; read only', () => {
  assert.deepEqual(parseInvoiceCommand('unbilled'), { type: 'unbilled' }); assert.deepEqual(parseInvoiceCommand('گزارش فاکتور نشده'), { type: 'unbilled' }); assert.deepEqual(parseInvoiceCommand('Not invoiced'), { type: 'unbilled' });
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const report = index.slice(index.indexOf('async function unbilledReport'), index.indexOf('async function paymentsReport'));
  assert.match(report, /select \* from Invoice where TxnDate >=/); assert.doesNotMatch(report, /\.write\(|sock\.sendMessage|postDocument/); // reads only
  assert.match(index, /config\.eveningReportHour === null \|\| !sock\?\.user \|\| botState\.paused \|\| !qbo\.connected/);
  assert.match(index, /config\.eveningReportTo === 'info' && config\.infoGroupName\) await sendTo\(config\.infoGroupName/);
  const cfg = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'config.js'), 'utf8');
  assert.match(cfg, /eveningReportHour: env\.EVENING_REPORT_HOUR \? Number\(env\.EVENING_REPORT_HOUR\) : null/);
  assert.ok(fs.readFileSync(path.join(import.meta.dirname, '..', 'deploy', 'gcp-startup.sh'), 'utf8').includes('EVENING_REPORT_HOUR EVENING_REPORT_TO'));
});

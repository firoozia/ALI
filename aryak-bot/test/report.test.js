import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDetails, formatReport, fromJalali, parseDay, reportFailed, reportInvalidDate, toDMY, toJalali, todayLine } from '../src/report.js';
import { fetchReport } from '../src/stock.js';
import { STAFF_TOOLS } from '../src/staff.js';

test('Jalali and Gregorian days convert both ways', () => {
  assert.deepEqual(toJalali('2026-10-31'), { y: 1405, m: 8, d: 9 });
  assert.deepEqual(toJalali('2026-03-21'), { y: 1405, m: 1, d: 1 });
  assert.equal(fromJalali(1405, 8, 9), '2026-10-31');
  assert.equal(fromJalali(1405, 1, 1), '2026-03-21');
  assert.equal(fromJalali(1405, 12, 30), null); // 1405 is not a leap year
  assert.equal(fromJalali(1403, 12, 30), '2025-03-20'); // 1403 is
  assert.equal(fromJalali(1405, 7, 31), null);
  assert.equal(fromJalali(1405, 13, 1), null);
});

test('days typed in any of the accepted ways become one Gregorian day', () => {
  for (const s of ['2026-10-31', '2026/10/31', '31/10/2026', '31-10-2026', '۲۰۲۶-۱۰-۳۱', '1405-08-09', '1405/8/9', '09/08/1405', '۱۴۰۵/۰۸/۰۹']) {
    assert.equal(parseDay(s), '2026-10-31', s);
  }
  assert.equal(parseDay('2026-02-30'), null);
  assert.equal(parseDay('tomorrow'), null);
  assert.equal(parseDay(''), null);
  assert.equal(toDMY('2026-10-31'), '31/10/2026');
});

test('today is given in both calendars to the model', () => {
  assert.equal(todayLine(new Date('2026-11-04T10:00:00Z'), 'Asia/Dubai'), 'Today is 2026-11-04 (Gregorian) = 1405-08-13 (Jalali), Wednesday.');
  // near midnight the day of the team's own time zone counts
  assert.match(todayLine(new Date('2026-11-04T21:00:00Z'), 'Asia/Dubai'), /^Today is 2026-11-05 /);
});

const result = {
  ok: true, from: '2026-10-01', to: '2026-10-31', operations: 7,
  totals: [{ unit: 'm', qty: 442.5 }, { unit: 'pcs', qty: 12 }],
  byCode: [
    { code: '229', category: 'PVC film', unit: 'm', total: 300, operations: 4, packages: 3, customers: [{ customer: 'Bahar', qty: 200 }, { customer: '-', qty: 100 }] },
    { code: '408', category: 'PVC film', unit: 'm', total: 142.5, operations: 2, packages: 2, customers: [{ customer: 'Master Wood', qty: 142.5 }] },
    { code: 'H-1', category: 'Hinge', unit: 'pcs', total: 12, operations: 1, packages: 1, customers: [] },
  ],
  byCustomer: [],
};

test('the short report: period in dd/mm/yyyy, totals, a block per code, the hint; figures as in the sheet', () => {
  const t = formatReport(result, 'fa');
  assert.equal(t, [
    'خروجی کالا از 01/10/2026 تا 31/10/2026\n- تعداد عملیات: 7\n- جمع: 442.5 m، 12 pcs',
    'کد 229 (PVC film)\n- جمع خروج: 300 m\n- تعداد عملیات: 4\n- تعداد بسته: 3\n- مشتری‌های اصلی: Bahar 200 m، بدون مشتری 100 m\n━━━━━━━━━━━━━━━━━━\nکد 408 (PVC film)\n- جمع خروج: 142.5 m\n- تعداد عملیات: 2\n- تعداد بسته: 2\n- مشتری‌های اصلی: Master Wood 142.5 m\n━━━━━━━━━━━━━━━━━━\nکد H-1 (Hinge)\n- جمع خروج: 12 pcs\n- تعداد عملیات: 1\n- تعداد بسته: 1',
  ].join('\n\n') + '\n━━━━━━━━━━━━━━━━━━\nبرای فهرست عملیات بنویسید «جزئیات»'); // the hint is set apart from the last block by the line
});

test('long lists are cut: eight codes, then "and N more"', () => {
  const many = { ...result, byCode: Array.from({ length: 11 }, (_, i) => ({ code: String(100 + i), category: '', unit: 'm', total: 10, operations: 1, packages: 1, customers: [] })) };
  const t = formatReport(many, 'fa');
  assert.equal((t.match(/^کد /gm) || []).length, 8);
  assert.match(t, /و 3 کد دیگر/);
});

test('no operations: one short sentence', () => {
  assert.equal(formatReport({ ...result, operations: 0, totals: [], byCode: [] }, 'fa'), 'خروجی کالا از 01/10/2026 تا 31/10/2026\nدر این بازه خروجی کالایی ثبت نشده است.');
});

test('the same report in English, Arabic and Urdu keeps every figure and name', () => {
  for (const lang of ['en', 'ar', 'ur', 'hi']) {
    const t = formatReport(result, lang);
    for (const k of ['01/10/2026', '31/10/2026', '442.5 m', '12 pcs', '229', 'Bahar 200 m', 'Master Wood 142.5 m', 'H-1']) assert.ok(t.includes(k), `${lang}: ${k}`);
  }
  assert.match(formatReport(result, 'en'), /^Goods sent out from 01\/10\/2026 to 31\/10\/2026\n- Operations: 7\n- Total: 442\.5 m, 12 pcs/);
  assert.match(formatReport(result, 'ar'), /^خروج البضاعة من 01\/10\/2026 إلى 31\/10\/2026/);
  assert.match(formatReport(result, 'ur'), /^01\/10\/2026 سے 31\/10\/2026 تک مال کا اخراج/);
});

test('the details: newest first, with the kind, customer and invoice; the rest is counted', () => {
  const rows = [
    { day: '2026-10-31', type: 'CUT', code: '229', size: '0.35*1400', qty: 12.5, unit: 'm', customer: 'Bahar', invoice: 'F-12' },
    { day: '2026-10-30', type: 'OUT', code: '408', size: '', qty: 90, unit: 'm', customer: '', invoice: '' },
  ];
  assert.equal(formatDetails({ ...result, rows, rowsTotal: 2 }, 'fa'), [
    'عملیات خروج از 01/10/2026 تا 31/10/2026',
    '31/10/2026 برش کد 229 0.35*1400: 12.5 m Bahar (F-12)',
    '30/10/2026 خروج کد 408: 90 m',
  ].join('\n'));
  assert.match(formatDetails({ ...result, rows, rowsTotal: 70 }, 'en'), /and 68 more operations$/);
  assert.match(formatDetails({ ...result, rows: [], rowsTotal: 0 }, 'fa'), /ثبت نشده/);
});

test('errors in each language; the model has the tool and today\'s date', () => {
  for (const lang of ['fa', 'ar', 'en', 'ur']) {
    assert.ok(reportInvalidDate(lang).includes('2026') || lang === 'fa');
    assert.ok(reportFailed(lang, true).length > 20 && reportFailed(lang, false) !== reportFailed(lang, true));
  }
  const tool = STAFF_TOOLS.find((x) => x.name === 'report_out');
  assert.deepEqual(tool.input_schema.required, ['from', 'to']);
  assert.ok(['code', 'category', 'customer', 'detail'].every((k) => k in tool.input_schema.properties));
});

test('fetchReport asks the report action with the bot token and the days', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ ok: true, operations: 0, totals: [], byCode: [] }) }; };
  const r = await fetchReport({ sheetUrl: 'https://x/exec', botToken: 'bottok' }, { from: '2026-10-01', to: '2026-10-31', code: '229', detail: true }, fetchImpl, { info: () => {} });
  assert.equal(r.operations, 0);
  assert.deepEqual(sent, { action: 'botReport', token: 'bottok', from: '2026-10-01', to: '2026-10-31', code: '229', category: '', customer: '', detail: true, limit: 0 });
  await assert.rejects(fetchReport({ sheetUrl: 'https://x/exec', botToken: 'b' }, { from: 'x', to: 'y' }, async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: 'from and to must be days like 2026-10-31' }) }), { log: () => {} }), /must be days/);
});

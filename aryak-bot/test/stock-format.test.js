import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStaffStock } from '../src/stock-format.js';

const low = {
  ok: true, found: true, code: '408', category: 'PVC film', size: '', unit: 'm', available: false,
  free: 2.5, reserved: 0, limit: 200,
  sizes: [{ size: '0.30*1400', free: 2.5, packages: 1, open: 1, limit: 200 }],
  locations: ['Showroom: 1'],
};

test('the owner\'s example, exactly', () => {
  assert.equal(formatStaffStock(low, '408'), [
    'موجودی کد 408 (فیلم PVC) خیلی کم است',
    '- سایز: 0.30*1400',
    '- آزاد: 2.5 m',
    '- رزرو: 0 m',
    '- حداقل موجودی: 200 m',
    '- بسته: 1 بسته، باز شده',
    '- محل: Showroom',
    '',
    '⚠️  موجودی آزاد زیر حداقل موجودی (200 m) است',
  ].join('\n'));
});

test('enough stock: "کافی است" and no warning line', () => {
  const ok = { ...low, free: 450, sizes: [{ size: '0.30*1400', free: 450, packages: 3, open: 0, limit: 200, reserved: 20, locations: ['Warehouse A'] }] };
  const t = formatStaffStock(ok, '408');
  assert.match(t, /^موجودی کد 408 \(فیلم PVC\) کافی است\n/);
  assert.ok(!t.includes('⚠️'));
  assert.match(t, /- بسته: 3 بسته، دست‌نخورده/);
  assert.match(t, /- رزرو: 20 m/);
  assert.match(t, /- محل: Warehouse A$/);
});

test('free exactly at the limit is enough; mixed open and closed packages', () => {
  const t = formatStaffStock({ ...low, sizes: [{ size: 'x', free: 200, packages: 4, open: 1, limit: 200 }] }, '408');
  assert.match(t, /کافی است/);
  assert.match(t, /- بسته: 4 بسته، 1 باز شده/);
});

test('odd cases are short Persian lines', () => {
  assert.match(formatStaffStock({ found: false, code: '999' }), /موجودی ثبت‌شده‌ای نیست/);
  assert.match(formatStaffStock({ found: true, ambiguous: true, categories: ['A', 'B'] }, '12'), /چند گروه/);
  assert.match(formatStaffStock({ found: true, sizeFound: false, code: '12', size: '1*1', sizes: ['2*2'] }), /2\*2/);
});

test('packages line: closed packs + open pieces, total = free + reserved', () => {
  const r = {
    ...low,
    sizes: [{ size: '0.30*1400', free: 680, packages: 7, open: 2, limit: 200, reserved: 0, locations: ['Showroom'], packs: [{ qty: 120, count: 5 }], pieces: [35, 45] }],
  };
  assert.match(formatStaffStock(r, '408'), /- بسته: 5 بسته 120 m \+ باز: 35 m و 45 m \(کل 680 m\)\n/);
  assert.match(formatStaffStock(r, '408'), /کافی است/);
});

test('packages line: reserved counts in the total; only packs; only pieces; two pack sizes; nothing', () => {
  const row = (extra) => formatStaffStock({ ...low, sizes: [{ size: 's', free: 240, packages: 2, open: 0, limit: 200, ...extra }] }, '408');
  assert.match(row({ reserved: 120, packs: [{ qty: 120, count: 2 }], pieces: [] }), /- بسته: 2 بسته 120 m \(کل 360 m\)/);
  assert.match(row({ free: 80, packs: [], pieces: [35, 45] }), /- بسته: باز: 35 m و 45 m \(کل 80 m\)/);
  assert.match(row({ free: 220, packs: [{ qty: 120, count: 1 }, { qty: 100, count: 1 }], pieces: [] }), /- بسته: 1 بسته 120 m \+ 1 بسته 100 m \(کل 220 m\)/);
  assert.match(row({ free: 0, packs: [], pieces: [] }), /- بسته: بدون بسته \(کل 0 m\)/);
});

test('the staff never see the old words; the label and the warning use "حداقل موجودی"', () => {
  assert.ok(!formatStaffStock(low, '408').includes('حد ربات'));
  assert.match(formatStaffStock(low, '408'), /- حداقل موجودی: 200 m/);
});

test('all rows empty: the answer still says something', () => {
  assert.match(formatStaffStock({ ...low, sizes: [{ size: '', free: 0, packages: 0, open: 0, limit: 200 }] }, '408'), /موجودی کد 408/);
});

// ---- the code is the product: every row of a code is one block ----
const pieces229 = [35, 45, ...Array(11).fill(8), 9.9]; // 14 open pieces, 177.9 m; with 9 packs of 120 m = 1257.9 m
const sheet229 = {
  ...low, code: '229', free: 1257.9, reserved: 0, limit: 200, locations: ['Showroom: 20', 'Warehouse 2: 3'],
  sizes: [
    { size: '', free: 0, packages: 0, open: 0, limit: 200, packs: [], pieces: [] },
    { size: '0.30*1400', free: 0, packages: 0, open: 0, limit: 200, packs: [], pieces: [] },
    { size: '0.35*1400', free: 1257.9, packages: 23, open: 14, limit: 200, packs: [{ qty: 120, count: 9 }], pieces: pieces229 },
  ],
};

test('code 229 from the sheet: ONE block for the code, the registered sizes in one line', () => {
  assert.equal(formatStaffStock(sheet229, '229'), [
    'موجودی کد 229 (فیلم PVC) کافی است',
    '- اندازه‌های ثبت‌شده: 0.30*1400 و 0.35*1400',
    '- آزاد: 1257.9 m',
    '- رزرو: 0 m',
    '- حداقل موجودی: 200 m',
    '- بسته: 9 بسته 120 m + باز: 35 m و 45 m و 8 m و 8 m و 8 m و 8 m و 8 قطعهٔ دیگر (کل 1257.9 m)',
    '- محل: Showroom، Warehouse 2',
  ].join('\n'));
});

test('rows are added up: free, reserved, packs by pack size, pieces, places', () => {
  const t = formatStaffStock({
    ...low, limit: 200,
    sizes: [
      { size: 'a', free: 300, packages: 3, open: 1, limit: 200, reserved: 10, locations: ['Showroom: 3'], packs: [{ qty: 120, count: 2 }], pieces: [60] },
      { size: 'b', free: 220, packages: 2, open: 0, limit: 200, reserved: 20, locations: ['Showroom: 1', 'Warehouse: 1'], packs: [{ qty: 120, count: 1 }, { qty: 100, count: 1 }], pieces: [] },
    ],
  }, '408');
  assert.match(t, /^موجودی کد 408 \(فیلم PVC\) کافی است\n- اندازه‌های ثبت‌شده: a و b\n- آزاد: 520 m\n- رزرو: 30 m\n/);
  assert.match(t, /- بسته: 3 بسته 120 m \+ 1 بسته 100 m \+ باز: 60 m \(کل 550 m\)/);
  assert.match(t, /- محل: Showroom، Warehouse$/);
  assert.equal((t.match(/موجودی کد/g) || []).length, 1);
});

test('the verdict is on the code total: low total gives one warning, a low size alone gives none', () => {
  const sizes = (a, b) => [
    { size: 'a', free: a, packages: 1, open: 1, limit: 200, reserved: 0 },
    { size: 'b', free: b, packages: 1, open: 1, limit: 200, reserved: 0 },
  ];
  const high = formatStaffStock({ ...low, limit: 200, sizes: sizes(50, 900) }, '408');
  assert.match(high, /^موجودی کد 408 \(فیلم PVC\) کافی است\n/);
  assert.ok(!high.includes('⚠️'));
  const lowT = formatStaffStock({ ...low, limit: 200, sizes: sizes(50, 60) }, '408');
  assert.match(lowT, /^موجودی کد 408 \(فیلم PVC\) خیلی کم است\n/);
  assert.match(lowT, /- آزاد: 110 m/);
  assert.equal((lowT.match(/⚠️/g) || []).length, 1);
  assert.match(lowT, /\n\n⚠️  موجودی آزاد زیر حداقل موجودی \(200 m\) است$/);
});

test('rows that carry the same size are one size, not a list', () => {
  const t = formatStaffStock({ ...low, sizes: [{ size: '0.35*1400', free: 100, limit: 50 }, { size: '0.35*1400', free: 200, limit: 50 }] }, '408');
  assert.match(t, /- سایز: 0.35\*1400\n- آزاد: 300 m/);
});

test('every row empty: a short block with the sizes, nothing repeated', () => {
  const t = formatStaffStock({ ...low, sizes: [{ size: '0.30*1400', free: 0, limit: 200 }, { size: '0.35*1400', free: 0, limit: 200 }] }, '408');
  assert.equal(t, ['موجودی کد 408 (فیلم PVC) ندارد', '- اندازه‌های ثبت‌شده: 0.30*1400 و 0.35*1400'].join('\n'));
});

test('a single real size keeps the original block, even beside a placeholder row', () => {
  const t = formatStaffStock({ ...low, sizes: [{ size: '', free: 0, packages: 0, open: 0, limit: 200 }, ...low.sizes] }, '408');
  assert.equal(t, formatStaffStock(low, '408'));
});

test('a note (for example an unregistered size) comes first', () => {
  const t = formatStaffStock(low, '408', 'اندازهٔ 0.40 ثبت نشده.');
  assert.ok(t.startsWith('اندازهٔ 0.40 ثبت نشده.\n\nموجودی کد 408'));
});

test('open pieces: up to six are listed, more are counted, the total stays', () => {
  const one = (pieces) => formatStaffStock({ ...low, sizes: [{ size: 's', free: 100, packages: pieces.length, open: pieces.length, limit: 50, packs: [], pieces }] }, '408');
  assert.match(one([1, 2, 3, 4, 5, 6]), /- بسته: باز: 1 m و 2 m و 3 m و 4 m و 5 m و 6 m \(کل 100 m\)/);
  assert.match(one([1, 2, 3, 4, 5, 6, 7]), /باز: 1 m و 2 m و 3 m و 4 m و 5 m و 6 m و 1 قطعهٔ دیگر \(کل 100 m\)/);
  assert.match(one(Array(20).fill(1)), /و 14 قطعهٔ دیگر \(کل 100 m\)/);
});

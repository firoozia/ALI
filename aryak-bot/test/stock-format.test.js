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
  assert.match(formatStaffStock({ found: false, code: '999' }), /پیدا نشد/);
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

// ---- a code with several sizes: one verdict on the total, a block per size with stock, zero sizes in one line ----
const pieces229 = [35, 45, ...Array(11).fill(8), 9.9]; // 14 open pieces, 177.9 m; with 9 packs of 120 m = 1257.9 m
const sheet229 = {
  ...low, code: '229', free: 1257.9, reserved: 0, limit: 200, locations: ['Showroom: 20', 'Warehouse 2: 3'],
  sizes: [
    { size: '', free: 0, packages: 0, open: 0, limit: 200, packs: [], pieces: [] },
    { size: '0.30*1400', free: 0, packages: 0, open: 0, limit: 200, packs: [], pieces: [] },
    { size: '0.35*1400', free: 1257.9, packages: 23, open: 14, limit: 200, packs: [{ qty: 120, count: 9 }], pieces: pieces229 },
  ],
};

test('code 229 from the sheet: one verdict with the total, one block, the empty size in one line', () => {
  assert.equal(formatStaffStock(sheet229, '229'), [
    'موجودی کد 229 (فیلم PVC) کافی است (کل آزاد: 1257.9 m)',
    '',
    '- سایز: 0.35*1400',
    '- آزاد: 1257.9 m',
    '- رزرو: 0 m',
    '- حداقل موجودی: 200 m',
    '- بسته: 9 بسته 120 m + باز: 35 m و 45 m و 8 m و 8 m و 8 m و 8 m و 8 قطعهٔ دیگر (کل 1257.9 m)',
    '- محل: Showroom، Warehouse 2',
    '',
    'بدون موجودی: 0.30*1400',
  ].join('\n'));
});

test('several sizes: blocks only for sizes with stock or a reservation; reserved-only counts; zero sizes are comma-separated', () => {
  const t = formatStaffStock({
    ...low, limit: 200,
    sizes: [
      { size: 'a', free: 500, packages: 5, open: 0, limit: 200, reserved: 0 },
      { size: 'b', free: 0, packages: 0, open: 0, limit: 200, reserved: 30 },
      { size: 'c', free: 0, packages: 0, open: 0, limit: 200 },
      { size: 'd', free: 0, packages: 0, open: 0, limit: 200 },
    ],
  }, '408');
  assert.equal((t.match(/- سایز:/g) || []).length, 2);
  assert.match(t, /- سایز: b[\s\S]*- رزرو: 30 m/);
  assert.match(t, /\n\nبدون موجودی: c، d$/);
  assert.match(t, /کافی است \(کل آزاد: 500 m\)/);
  assert.ok(!t.includes('⚠️'));
});

test('several sizes: the code total decides; a size below the minimum is flagged only when the total is low too', () => {
  const sizes = (a, b) => [
    { size: 'a', free: a, packages: 1, open: 1, limit: 200, reserved: 0 },
    { size: 'b', free: b, packages: 1, open: 1, limit: 200, reserved: 0 },
  ];
  const high = formatStaffStock({ ...low, limit: 200, sizes: sizes(50, 900) }, '408');
  assert.match(high, /کافی است \(کل آزاد: 950 m\)/);
  assert.ok(!high.includes('⚠️'), 'no warning when the total is above the minimum');
  const lowT = formatStaffStock({ ...low, limit: 200, sizes: sizes(50, 60) }, '408');
  assert.match(lowT, /^موجودی کد 408 \(فیلم PVC\) خیلی کم است \(کل آزاد: 110 m\)/);
  assert.equal((lowT.match(/این اندازه زیر حداقل موجودی \(200 m\) است/g) || []).length, 2);
  assert.match(lowT, /\n\n⚠️  موجودی آزاد زیر حداقل موجودی \(200 m\) است$/);
});

test('several sizes, every one empty: a short block with the sizes, no repeated blocks', () => {
  const t = formatStaffStock({
    ...low,
    sizes: [{ size: '0.30*1400', free: 0, limit: 200 }, { size: '0.35*1400', free: 0, limit: 200 }],
  }, '408');
  assert.equal(t, ['موجودی کد 408 (فیلم PVC) ندارد', '- سایزها: 0.30*1400، 0.35*1400'].join('\n'));
});

test('a single real size keeps the original block, even beside a placeholder row', () => {
  const t = formatStaffStock({ ...low, sizes: [{ size: '', free: 0, packages: 0, open: 0, limit: 200 }, ...low.sizes] }, '408');
  assert.equal(t, formatStaffStock(low, '408'));
});

test('open pieces: up to six are listed, more are counted, the total stays', () => {
  const one = (pieces) => formatStaffStock({ ...low, sizes: [{ size: 's', free: 100, packages: pieces.length, open: pieces.length, limit: 50, packs: [], pieces }] }, '408');
  assert.match(one([1, 2, 3, 4, 5, 6]), /- بسته: باز: 1 m و 2 m و 3 m و 4 m و 5 m و 6 m \(کل 100 m\)/);
  assert.match(one([1, 2, 3, 4, 5, 6, 7]), /باز: 1 m و 2 m و 3 m و 4 m و 5 m و 6 m و 1 قطعهٔ دیگر \(کل 100 m\)/);
  assert.match(one(Array(20).fill(1)), /و 14 قطعهٔ دیگر \(کل 100 m\)/);
});

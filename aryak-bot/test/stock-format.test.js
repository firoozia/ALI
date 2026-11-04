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

test('several size rows give one block each, separated by a blank line; per-row places and reserved', () => {
  const t = formatStaffStock({
    ...low,
    sizes: [
      { size: '0.30*1400', free: 2.5, packages: 1, open: 1, limit: 200, reserved: 0, locations: ['Showroom'] },
      { size: '0.35*1400', free: 500, packages: 5, open: 0, limit: 200, reserved: 40, locations: ['Warehouse A', 'Warehouse B'] },
    ],
  }, '408');
  const blocks = t.split('\n\n');
  assert.equal(blocks.length, 3); // the first block carries its own blank line before the warning
  assert.match(t, /خیلی کم است[\s\S]*⚠️[\s\S]*موجودی کد 408 \(فیلم PVC\) کافی است/);
  assert.match(t, /- رزرو: 40 m/);
  assert.match(t, /- محل: Warehouse A، Warehouse B/);
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

test('empty placeholder rows are skipped; a real size with no stock stays', () => {
  const t = formatStaffStock({
    ...low, code: '229',
    sizes: [
      { size: '', free: 0, packages: 0, open: 0, limit: 200 },
      { size: '0.30*1400', free: 0, packages: 0, open: 0, limit: 200 },
      { size: '0.35*1400', free: 1257.9, packages: 23, open: 14, limit: 200 },
    ],
  }, '229');
  assert.ok(!t.includes('- سایز: —'));
  assert.match(t, /- سایز: 0.30\*1400/);
  assert.match(t, /- سایز: 0.35\*1400/);
  assert.equal((t.match(/موجودی کد 229/g) || []).length, 2);
  assert.equal((t.match(/⚠️/g) || []).length, 1); // only the one below the minimum, under its own block
});

test('several sizes below the minimum: one grouped warning at the end', () => {
  const t = formatStaffStock({
    ...low,
    sizes: [
      { size: '0.30*1400', free: 0, packages: 0, open: 0, limit: 200 },
      { size: '0.35*1400', free: 50, packages: 1, open: 1, limit: 200 },
      { size: '0.40*1400', free: 900, packages: 8, open: 0, limit: 200 },
    ],
  }, '408');
  assert.equal((t.match(/⚠️/g) || []).length, 1);
  assert.match(t, /

⚠️  موجودی آزاد این اندازه‌ها زیر حداقل موجودی است:
- 0.30\*1400: 0 m \(حداقل 200 m\)
- 0.35\*1400: 50 m \(حداقل 200 m\)$/);
  assert.equal((t.match(/خیلی کم است/g) || []).length, 2);
});

test('all rows empty: the answer still says something', () => {
  assert.match(formatStaffStock({ ...low, sizes: [{ size: '', free: 0, packages: 0, open: 0, limit: 200 }] }, '408'), /موجودی کد 408/);
});

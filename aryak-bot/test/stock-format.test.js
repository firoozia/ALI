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
    '- حد ربات: 200 m',
    '- بسته: 1 بسته، باز شده',
    '- محل: Showroom',
    '',
    '⚠️  موجودی آزاد زیر حد 200 m است',
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

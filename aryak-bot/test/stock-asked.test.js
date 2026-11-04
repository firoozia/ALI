import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStaffStock } from '../src/stock-format.js';

const res = (code, free, limit, extra = {}) => ({
  found: true, code, category: 'PVC film', unit: 'm', free, reserved: 0, limit,
  sizes: [{ size: '0.30*1400', free, packages: 1, open: 0, limit }], locations: ['A1'], ...extra,
});

test('a requested quantity gets a verdict per code: short, enough, enough but under the minimum', () => {
  const short = formatStaffStock(res('408', 2.5, 10, { askedInUnit: 30, qtyChecked: true }), '408', '', 'en', { quantity: 30, unit: 'm' });
  assert.match(short, /Requested: 30 m, free: 2\.5 m/);
  assert.match(short, /NOT enough; short by 27\.5 m/);
  const ok = formatStaffStock(res('229', 500, 100, { askedInUnit: 200, qtyChecked: true }), '229', '', 'en', { quantity: 200, unit: 'm' });
  assert.match(ok, /Requested: 200 m, free: 500 m\n→ enough/);
  const tight = formatStaffStock(res('511', 15, 10, { askedInUnit: 10, qtyChecked: true }), '511', '', 'en', { quantity: 10, unit: 'm' });
  assert.match(tight, /enough, but it leaves less than the minimum stock/);
});

test('the verdict is in Persian, Arabic and Urdu too', () => {
  const r = res('408', 2.5, 10, { askedInUnit: 30, qtyChecked: true });
  const w = { quantity: 30, unit: 'm' };
  assert.match(formatStaffStock(r, '408', '', 'fa', w), /درخواست: 30 m، آزاد: 2\.5 m\n→ کافی نیست؛ کمبود 27\.5 m/);
  assert.match(formatStaffStock(r, '408', '', 'ar', w), /المطلوب: 30 m، المتاح: 2\.5 m\n→ غير كافٍ؛ النقص 27\.5 m/);
  assert.match(formatStaffStock(r, '408', '', 'ur', w), /درخواست: 30 m، دستیاب: 2\.5 m\n→ کافی نہیں؛ کمی 27\.5 m/);
});

test('without a quantity nothing is added; an unconverted unit is said', () => {
  assert.ok(!/→/.test(formatStaffStock(res('408', 2.5, 10), '408', '', 'en')));
  const r = res('305', 50, 10, { qtyChecked: false });
  assert.match(formatStaffStock(r, '305', '', 'en', { quantity: 2, unit: 'roll' }), /→ the unit could not be converted/);
});

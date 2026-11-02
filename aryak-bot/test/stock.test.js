import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheckStock, managerMessage, checkStockTool } from '../src/stock.js';

const config = { sheetUrl: 'https://script.google.com/macros/s/x/exec', botToken: 'bottok', dedupeMinutes: 60 };
const ctx = { groupId: 'g1@g.us', groupName: 'Master Wood – ARYAK', customer: 'Master Wood', messageText: 'do you have 305?' };
const answer = (data) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  assert.equal(body.action, 'botStock');
  assert.equal(body.token, 'bottok');
  return { ok: true, json: async () => ({ ok: true, ...data }) };
};
const low = {
  found: true, code: '305', category: 'PVC film', size: '', unit: 'm', available: false, qtyChecked: true,
  asked: 300, askedUnit: 'm', askedInUnit: 300, free: 230, reserved: 40, limit: 100,
  sizes: [{ size: '0.30*1400', free: 200, packages: 2, open: 0, limit: 50 }, { size: '0.30*1220', free: 30, packages: 1, open: 1, limit: 50 }],
  locations: ['A: 2', 'B: 1'],
};

test('available: the model is told only yes, no quantity', async () => {
  const r = await runCheckStock({ code: '305' }, ctx, config, { fetchImpl: answer({ ...low, available: true }) });
  assert.equal(r.forModel.status, 'available');
  assert.equal(r.silent, false);
  assert.ok(!JSON.stringify(r.forModel).includes('230'));
});

test('low stock: silent in the group, manager told once with the real figures', async () => {
  const recent = new Map();
  const r = await runCheckStock({ code: '305', quantity: 300 }, ctx, config, { fetchImpl: answer(low), recent, now: 1000 });
  assert.equal(r.silent, true);
  assert.equal(r.forModel.status, 'team_will_confirm');
  assert.ok(!JSON.stringify(r.forModel).includes('230'));
  assert.ok(r.managerText.includes('Master Wood'));
  assert.ok(r.managerText.includes('230 m'));
  assert.ok(r.managerText.includes('0.30*1220: 30 m'));
  const again = await runCheckStock({ code: '305' }, ctx, config, { fetchImpl: answer(low), recent, now: 1000 + 10 * 60 * 1000 });
  assert.equal(again.silent, true);
  assert.equal(again.managerText, null);
  const later = await runCheckStock({ code: '305' }, ctx, config, { fetchImpl: answer(low), recent, now: 1000 + 61 * 60 * 1000 });
  assert.ok(later.managerText);
});

test('unknown code, two product groups, unknown size', async () => {
  assert.equal((await runCheckStock({ code: 'X' }, ctx, config, { fetchImpl: answer({ found: false }) })).forModel.status, 'unknown_code');
  const amb = await runCheckStock({ code: '305' }, ctx, config, { fetchImpl: answer({ found: true, ambiguous: true, categories: ['PVC film', 'Edge banding'] }) });
  assert.deepEqual(amb.forModel.options, ['PVC film', 'Edge banding']);
  const size = await runCheckStock({ code: '305', size: '0.40*1400' }, ctx, config, { fetchImpl: answer({ found: true, sizeFound: false, sizes: ['0.30*1400'] }) });
  assert.equal(size.forModel.status, 'ask_size');
});

test('sheet unreachable: not silent, model hands over to the team', async () => {
  const r = await runCheckStock({ code: '305' }, ctx, config, { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(r.forModel.status, 'error');
  assert.equal(r.silent, false);
});

test('roll quantity that could not be checked is flagged for the manager', () => {
  const text = managerMessage({ ...low, qtyChecked: false, asked: 3, askedUnit: 'roll', askedInUnit: 3 }, ctx, {});
  assert.ok(text.includes('بررسی نشد'));
});

test('tool schema needs a code', () => {
  assert.deepEqual(checkStockTool.input_schema.required, ['code']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CostMeter, PRICES } from '../src/cost.js';

const src = (n) => fs.readFileSync(path.join(import.meta.dirname, '..', 'src', n), 'utf8').replace(/\r\n/g, '\n');

test('the price table of the current models: Haiku 0.10 / 0.50, Sonnet 2 / 10, Opus 4 / 20 dollars per million tokens; the logged calls come out right', () => {
  assert.deepEqual([PRICES['claude-haiku-5-5'], PRICES['claude-sonnet-5-5'], PRICES['claude-opus-5-5']], [[0.1, 0.5], [2, 10], [4, 20]]);
  const m = new CostMeter('', { now: () => Date.parse('2026-11-10T08:00:00Z') });
  assert.ok(Math.abs(m.usdOf('claude-haiku-5-5', { input_tokens: 2176, output_tokens: 400 }) - 0.0004176) < 1e-9); // was logged as 0.0042
  assert.ok(Math.abs(m.usdOf('claude-sonnet-5-5', { input_tokens: 2176, output_tokens: 63 }) - 0.004982) < 1e-9); // was logged as 0.0075
  assert.ok(Math.abs(m.usdOf('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 }) - 24) < 1e-9);
  assert.ok(Math.abs(new CostMeter('', { prices: { 'claude-haiku-5-5': [1, 5] } }).usdOf('claude-haiku-5-5', { input_tokens: 1_000_000 }) - 1) < 1e-9); // COST_PRICES still overrides
});

test('the extraction calls (the expense receipt, the payment photo, the photo test) send no thinking and have room for the answer: 1024 tokens, effort low', () => {
  const index = src('index.js'); const tracker = src('tracker.js');
  assert.match(index, /model, max_tokens: 1024, system: RECEIPT_RULES, thinking: \{ type: 'disabled' \}, output_config: \{ effort: 'low' \}/);
  assert.match(index, /model: TEST_MODEL, max_tokens: 1024, system: PHOTO_RULES, thinking: \{ type: 'disabled' \}, output_config: \{ effort: 'low' \}/);
  assert.match(tracker, /model, max_tokens: 1024, system: EXTRACT_RULES\[role\], messages: \[\{ role: 'user', content \}\],\n\s+thinking: \{ type: 'disabled' \}, output_config: \{ effort: 'low' \}/);
  assert.doesNotMatch(index + tracker, /max_tokens: (?:400|500|800), system: (?:RECEIPT_RULES|PHOTO_RULES|EXTRACT_RULES)/); // the old limits that cut the answer off
});

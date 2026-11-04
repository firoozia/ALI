import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripBrand, customerFromMessages } from '../src/codes.js';
import { parseCustomerText, orderLinesOf } from '../src/orderlines.js';
import { parseOnBehalf } from '../src/onbehalf.js';
import { Aliases } from '../src/aliases.js';
import { Rules, ruleFrom, parseRuleCommand } from '../src/rules.js';
import { fetchStock } from '../src/stock.js';

const L = (code, quantity, unit = 'm', extra = {}) => ({ code, quantity, unit, addOn: false, ...extra });

test('AR is ARYAK: the prefix is stripped, a real code is kept as it is', () => {
  for (const [a, b] of [['AR102', '102'], ['ar 402', '402'], ['Aryak 505', '505'], ['Arek505', '505'], ['ارياك 505', '505'], ['E 1803', 'E 1803'], ['TS 840', 'TS 840'], ['702 A', '702 A'], ['305', '305']]) assert.equal(stripBrand(a), b, a);
});

test('the handwriting photo and the group shapes are read with quantity and customer', () => {
  const cases = [
    ['AR102 = 8M', [L('AR102', 8)]],
    ['Aryak 505 = 80m', [L('505', 80)]],
    ['505=16M', [L('505', 16)]],
    ['234=12m al ebda', [L('234', 12, 'm', { customer: 'al ebda' })]],
    ['410  =2M al ebda', [L('410', 2, 'm', { customer: 'al ebda' })]],
    ['107 (50meter)NUQOOSH', [L('107', 50, 'm', { customer: 'nuqoosh' })]],
    ['122 (6mete) nuqoosh', [L('122', 6, 'm', { customer: 'nuqoosh' })]],
    ['207 ( 15meter) NUQOOSH', [L('207', 15, 'm', { customer: 'nuqoosh' })]],
    ['234-3m', [L('234', 3)]],
    ['509 (2 roll ) alebda', [L('509', 2, 'roll', { customer: 'alebda' })]],
    ['101-- roll 2', [L('101', 2, 'roll')]],
  ];
  for (const [text, lines] of cases) assert.deepEqual(orderLinesOf(text), lines, text);
  assert.equal(parseCustomerText('229 -401').kind, 'other'); // two codes, not 401 of 229
  assert.deepEqual(parseCustomerText('509\n229\n209').kind, 'availability');
});

test('a colleague posting for a customer: the name can come after the line', () => {
  const r = parseOnBehalf('234=12m al ebda');
  assert.deepEqual([r.customer, r.lines[0].code, r.lines[0].quantity], ['al ebda', '234', 12]);
});

test('several billing customers in one group: the name beside the lines or the photo wins', () => {
  assert.equal(customerFromMessages([{ text: '234=12m al ebda' }], orderLinesOf), 'al ebda');
  assert.equal(customerFromMessages([{ text: '', hasImage: true }, { text: 'Nuqoosh' }], orderLinesOf), 'Nuqoosh');
  assert.equal(customerFromMessages([{ text: 'Available?' }, { text: '' , hasImage: true }], orderLinesOf), '');
  assert.equal(customerFromMessages([{ text: 'Nuqoosh' }], orderLinesOf), ''); // no photo, no lines: a bare word proves nothing
  const a = new Aliases(fs.mkdtempSync(path.join(os.tmpdir(), 'al-')));
  a.add('Al Ebda', 'x ebda');
  for (const n of ['ebda', 'al ebda', 'alebda', 'Ebdaa']) assert.equal(a.resolve(n), 'Al Ebda', n);
});

test('the lookup tries the exact code, then the one without the prefix', async () => {
  const asked = [];
  const fetchImpl = async (url, init) => {
    const code = JSON.parse(init.body).code;
    asked.push(code);
    const body = JSON.stringify(code === '102' ? { ok: true, found: true, code: '102', free: 5, sizes: [] } : { ok: true, found: false, code });
    return { ok: true, status: 200, headers: new Map(), text: async () => body, json: async () => JSON.parse(body) };
  };
  const config = { sheetUrl: 'https://example.test/x', botToken: 't', log: () => {} };
  const r = await fetchStock(config, { code: 'AR102' }, fetchImpl, { retries: 0 }).catch((e) => ({ error: e.message }));
  assert.deepEqual(asked.slice(0, 2), ['AR102', '102'], JSON.stringify(r));
});

test('the owner teaches in words: stored at once, listed, removable; questions and colleagues do not teach', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  const names = ['آتوسا', 'Atossa'];
  const rule = ruleFrom('آتوسا، از این به بعد AR جلوی کد را در نظر نگیر', names);
  assert.equal(rule, 'از این به بعد AR جلوی کد را در نظر نگیر');
  assert.equal(ruleFrom('آتوسا از این به بعد موجود است؟', names), '');
  assert.equal(ruleFrom('کد ۱۰۵ موجود است', names), '');
  const r = new Rules(dir);
  const item = r.add(rule);
  assert.equal(item.id, 1);
  assert.equal(r.add(rule).id, 1); // the same teaching is not doubled
  assert.match(r.promptText(), /- از این به بعد AR/);
  assert.equal(new Rules(dir).items.length, 1); // survives a restart
  assert.deepEqual(parseRuleCommand('قانون‌ها'), { list: true });
  assert.deepEqual(parseRuleCommand('حذف قانون 1'), { remove: 1 });
  const v = r.version;
  assert.equal(r.remove(1), true);
  assert.ok(r.version > v);
  assert.equal(r.promptText(), '');
});

test('Zena / زينه is the manager called by name: dropped when parsing, never a code, a lone call means someone waits', async () => {
  const { dropAttention, isNudge } = await import('../src/codes.js');
  assert.equal(dropAttention('Zena 505 available'), '505 available');
  assert.equal(dropAttention('زينه موجود'), 'موجود');
  assert.equal(parseCustomerText('زينه 505 موجوددد؟').kind, 'availability');
  assert.deepEqual(parseCustomerText('زينه 505 موجوددد؟').codes, ['505']);
  assert.deepEqual(parseCustomerText('Zena, 229 - 5 m').kind, 'order');
  assert.equal(parseCustomerText('Zena').kind, 'other');
  for (const t of ['Zena', 'زينه', 'زينه؟', '?', '??', 'Zena ??']) assert.equal(isNudge(t), true, t);
  for (const t of ['Zena 505', 'ok', '']) assert.equal(isNudge(t), false, t);
});

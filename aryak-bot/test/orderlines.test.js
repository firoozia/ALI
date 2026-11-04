import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hintFor, parseCustomerText } from '../src/orderlines.js';
import { appendCorrection, formatCorrections, parseCorrection, readCorrections } from '../src/corrections.js';
import { buildContent } from '../src/assistant.js';
import { buildSystemPrompt } from '../src/prompt.js';
import { runCommand } from '../src/staff.js';
import { correctionSaved } from '../src/lang.js';

// Fixtures: real customer messages from the groups, with names, numbers of people and invoice numbers removed.
const AVAILABILITY = [
  ['410', ['410']], ['108 available?', ['108']], ['115 available?', ['115']], ['116?', ['116']], ['122?', ['122']],
  ['304 available', ['304']], ['511 AVAILBLE', ['511']], ['Is 410 available', ['410']], ['kindly check 305 in stock?', ['305']],
  ['108 115 116', ['108', '115', '116']], ['KG10-300 available?', ['KG10-300']], ['۴۱۰ available؟', ['410']],
];

test('a bare code, with or without "available" (and its typos), is an availability question', () => {
  for (const [text, codes] of AVAILABILITY) {
    const p = parseCustomerText(text);
    assert.equal(p.kind, 'availability', text);
    assert.deepEqual(p.codes, codes, text);
    assert.deepEqual(p.lines, []);
  }
});

const ORDERS = [
  ['603 - 15 mtr', [['603', 15, 'm', false]]],
  ['201 - 15 mtr', [['201', 15, 'm', false]]],
  ['119-6 MTR', [['119', 6, 'm', false]]],
  ['108-6 MTR', [['108', 6, 'm', false]]],
  ['602-17 MTR', [['602', 17, 'm', false]]],
  ['409-2 MTR', [['409', 2, 'm', false]]],
  ['701 25 meter?', [['701', 25, 'm', false]]],
  ['Please add 234 - 3 mtr also', [['234', 3, 'm', true]]],
  ['234 – 3 mtr', [['234', 3, 'm', false]]], // en dash
  ['234 — 3 meters', [['234', 3, 'm', false]]], // em dash
  ['KG10-300 - 5 m', [['KG10-300', 5, 'm', false]]],
  ['305 : 2 rolls', [['305', 2, 'roll', false]]],
  ['۶۰۳ - ۱۵ mtr', [['603', 15, 'm', false]]],
  ['119-12.5 mtr', [['119', 12.5, 'm', false]]],
  ['603 - 15 mtr\n201 - 15 mtr\n119-6 MTR', [['603', 15, 'm', false], ['201', 15, 'm', false], ['119', 6, 'm', false]]],
  ['Hello\n603 - 15 mtr\nthanks\n108-6 MTR', [['603', 15, 'm', false], ['108', 6, 'm', false]]],
];

test('order lines: "code - quantity unit" in every spelling, several per message, add-ons marked', () => {
  for (const [text, expected] of ORDERS) {
    const p = parseCustomerText(text);
    assert.equal(p.kind, 'order', text);
    assert.deepEqual(p.lines.map((l) => [l.code, l.quantity, l.unit, l.addOn]), expected, text);
  }
});

test('things that look similar but are not orders or availability questions', () => {
  for (const text of ['', 'Please send this material also', 'What is the code for black glossy', 'To same roll or seperate', 'Kindly send the code', 'ok', 'Yes sure', 'onemin',
    'المجموع 796.95 درهم', 'its here', 'Invoice inv-9919.pdf', '119-6', 'Similar too close']) {
    assert.equal(parseCustomerText(text).kind, 'other', text);
  }
  // a code with its dash and a number is a code, not a quantity, when no unit follows
  assert.deepEqual(parseCustomerText('119-6 available?').codes, []);
  assert.equal(parseCustomerText('119-6').kind, 'other');
});

test('the hint tells the model to check every line, or every code, and keeps the order confirmation with a colleague', () => {
  const order = hintFor(parseCustomerText('603 - 15 mtr\nPlease add 234 - 3 mtr also'));
  assert.match(order, /603 = 15 m; 234 = 3 m \(an addition to an open order\)/);
  assert.match(order, /check_stock/);
  assert.match(order, /confirmed by a colleague/);
  assert.match(hintFor(parseCustomerText('108 available?')), /108/);
  assert.equal(hintFor(parseCustomerText('hello')), '');
});

test('the hint is part of what the answering model reads, after the messages', () => {
  const content = buildContent({ groupName: 'g', customer: 'c', messages: [{ senderName: 'A', text: '603 - 15 mtr' }, { senderName: 'A', text: '108 available?' }] });
  const text = content.at(-1).text;
  assert.ok(text.indexOf('[A] 603 - 15 mtr') < text.indexOf('Looks like'));
  const plain = buildContent({ groupName: 'g', customer: 'c', messages: [{ senderName: 'A', text: 'good morning' }] }).at(-1).text;
  assert.ok(!plain.includes('Looks like'));
});

test('the style and examples file is part of every prompt, with the rules that must not change', () => {
  const prompt = buildSystemPrompt(path.resolve('kb'), 'Atossa');
  assert.ok(prompt.includes('Style and examples (version 1)'));
  assert.ok(prompt.includes('Never give a quantity, a minimum or a reserved figure to a customer.'));
});

test('a colleague corrects the assistant: "wrong" plus the right answer is stored for the owner', () => {
  assert.deepEqual(parseCorrection('غلط، موجودی کافی است'), { right: 'موجودی کافی است' });
  assert.deepEqual(parseCorrection('غلط: 603 موجود است'), { right: '603 موجود است' });
  assert.deepEqual(parseCorrection('Wrong - it is available'), { right: 'it is available' });
  assert.deepEqual(parseCorrection('WRONG'), { right: '' });
  assert.deepEqual(parseCorrection('خطأ، متوفر'), { right: 'متوفر' });
  assert.equal(parseCorrection('غلطه'), null); // another word that starts the same
  assert.equal(parseCorrection('درست است'), null);
  assert.equal(parseCorrection(''), null);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corr-'));
  assert.deepEqual(readCorrections(dir), []);
  assert.equal(formatCorrections([]), 'اصلاحی ثبت نشده است.');
  assert.equal(appendCorrection(dir, { at: '2026-11-04T10:00:00Z', where: 'group "t"', role: 'staff', wrong: 'Available.', right: 'Limited' }), true);
  assert.equal(appendCorrection(dir, { at: '2026-11-04T11:00:00Z', where: 'private', role: 'admin', wrong: 'x', right: '' }), true);
  const list = readCorrections(dir);
  assert.equal(list.length, 2);
  assert.equal(list[0].where, 'private'); // newest first
  assert.match(formatCorrections(list), /1\. x\n {3}⟵ \(پاسخ درست نوشته نشده\)\n2\. Available\.\n {3}⟵ Limited/);
  assert.equal(appendCorrection('/nonexistent\u0000dir', {}), false); // never throws
});

test('the owner reads the corrections with a command; the thanks exist in each language', () => {
  const list = [{ wrong: 'Available.', right: 'Limited' }];
  const text = runCommand('corrections', { state: { paused: false }, desk: { lastChecks: () => [], requests: [] }, corrections: () => list });
  assert.match(text, /Available\.\n {3}⟵ Limited/);
  assert.equal(runCommand('corrections', { state: { paused: false }, desk: { lastChecks: () => [], requests: [] } }), 'اصلاحی ثبت نشده است.');
  for (const l of ['fa', 'ar', 'en', 'ur']) assert.ok(correctionSaved(l).length > 15);
  assert.match(correctionSaved('en'), /correction is saved/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { matchOption } from '../src/choice.js';
import { formatStaffStock } from '../src/stock-format.js';

const groups = ['PVC film', 'Edge banding'];

test('a number picks by position, in any digits', () => {
  assert.equal(matchOption('1', groups), 0);
  assert.equal(matchOption('۲', groups), 1);
  assert.equal(matchOption('2)', groups), 1);
  assert.equal(matchOption(' ٢ ', groups), 1);
  assert.equal(matchOption('3', groups), -1);
  assert.equal(matchOption('0', groups), -1);
});

test('the name in any case, with a stray trailing letter, or in Persian', () => {
  assert.equal(matchOption('Pvc filmا', groups), 0);
  assert.equal(matchOption('pvc film', groups), 0);
  assert.equal(matchOption('PVC', groups), 0);
  assert.equal(matchOption('فیلم', groups), 0);
  assert.equal(matchOption('فیلم پی وی سی', groups), 0);
  assert.equal(matchOption('edge', groups), 1);
  assert.equal(matchOption('لبه چسب', groups), 1);
  assert.equal(matchOption('لبه‌چسب', groups), 1);
});

test('no match for something else, and none when two options fit equally', () => {
  assert.equal(matchOption('سلام', groups), -1);
  assert.equal(matchOption('x', groups), -1);
  assert.equal(matchOption('', groups), -1);
  assert.equal(matchOption('موجودی کد 305', groups), -1);
  assert.equal(matchOption('چسب', ['Glue', 'Edge banding']), -1); // fits both
  assert.equal(matchOption('چسب', ['Glue', 'Rail']), 0);
});

test('the question lists the options with numbers', () => {
  const q = formatStaffStock({ found: true, ambiguous: true, categories: groups }, '1810');
  assert.match(q, /^کد 1810 در چند گروه هست:\n1\) PVC film\n2\) Edge banding\nکدام را می‌خواهید؟/);
});

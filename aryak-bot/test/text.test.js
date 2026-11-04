import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDigits, normalizeLetters } from '../src/text.js';
import { isAddressed } from '../src/staff.js';

test('Persian and Arabic digits become Latin; other text is untouched', () => {
  assert.equal(normalizeDigits('موجودی کد ۲۲۹ چقدره؟'), 'موجودی کد 229 چقدره؟');
  assert.equal(normalizeDigits('کد ٢٢٩ و ۰.۳۰'), 'کد 229 و 0.30');
  assert.equal(normalizeDigits('۰٫۳۰*۱۴۰۰'), '0.30*1400');
  assert.equal(normalizeDigits('KG10-300'), 'KG10-300');
  assert.equal(normalizeDigits(null), '');
});

test('letter variants are made equal for matching', () => {
  assert.equal(normalizeLetters('كتاب'), normalizeLetters('کتاب'));
  assert.equal(normalizeLetters('علي'), normalizeLetters('علی'));
  assert.equal(normalizeLetters('آتوســا'), 'آتوسا');
  assert.equal(normalizeLetters('آتوسا'), normalizeLetters('آتوسا')); // composed and decomposed alef-madda
  assert.equal(normalizeLetters('Atossa؟'), 'atossa?');
});

const OWN = ['971557699100@s.whatsapp.net'];
const names = ['آتوسا', 'atossa', 'دستیار'];

test('the assistant\'s name is found whatever surrounds it', () => {
  for (const t of ['آتوسا موجودی کد ۲۲۹ چقدره؟', 'آتوسا، موجودی کد ۲۲۹', 'سلام آتوسا!', 'آتوسـا؟ کد ٢٢٩', 'Atossa stock 229?', '«آتوسا»', 'دستیار لطفاً']) {
    assert.equal(isAddressed({ text: t, ownIds: OWN, names }), true, t);
  }
  assert.equal(isAddressed({ text: 'آتوساکو موجودی', ownIds: OWN, names }), false);
  assert.equal(isAddressed({ text: 'موجودی کد ۲۲۹', ownIds: OWN, names }), false);
});

test('a name typed with Arabic letter variants still matches', () => {
  assert.equal(isAddressed({ text: 'ياسمين', ownIds: OWN, names: ['یاسمین'] }), true);
});

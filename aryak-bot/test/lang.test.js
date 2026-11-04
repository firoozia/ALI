import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmStock, detectLang, langOf, noVoice, notUnderstood, sheetFailed, sizeNote } from '../src/lang.js';
import { formatStaffStock } from '../src/stock-format.js';
import { answerKind, understand } from '../src/voice.js';

// One message per language, as a person would type it.
const SAMPLES = {
  fa: 'آتوسا موجودی کد 408 چقدره؟',
  ar: 'هل الكود 408 متوفر؟ كم الكمية المتاحة',
  en: 'Atossa, how much stock of code 408?',
  ur: 'کوڈ 408 کا اسٹاک کتنا ہے؟ مجھے ٹھیک ٹھیک بتائیں',
  hi: 'कोड 408 का स्टॉक कितना है',
};

test('the language of a written message is told from its letters', () => {
  for (const [lang, text] of Object.entries(SAMPLES)) assert.equal(detectLang(text), lang, text);
  assert.equal(detectLang('408'), 'fa');
  assert.equal(detectLang('408', 'en'), 'en');
  assert.equal(detectLang('موجودی KG10-300'), 'fa'); // a code does not make it English
  assert.equal(langOf('ur-PK'), 'ur');
  assert.equal(langOf('AR-ae'), 'ar');
  assert.equal(langOf('fa-IR'), 'fa');
  assert.equal(langOf('en-IN'), 'en');
  assert.equal(langOf('hi-IN'), 'hi');
  assert.equal(langOf('de-DE'), '');
});

const sheet = {
  found: true, code: '229', category: 'PVC film', unit: 'm', free: 1257.9, reserved: 20, limit: 200, locations: ['Showroom: 20', 'Warehouse 2: 3'],
  sizes: [
    { size: '0.30*1400', free: 0, packages: 0, open: 0, limit: 200, packs: [], pieces: [] },
    { size: '0.35*1400', free: 1257.9, packages: 23, open: 14, limit: 200, packs: [{ qty: 120, count: 9 }], pieces: [35, 45, 8, 8, 8, 8, 8, 8] },
  ],
};
const lowSheet = { ...sheet, free: 2.5, sizes: [{ size: '0.30*1400', free: 2.5, packages: 1, open: 1, limit: 200, packs: [], pieces: [2.5] }] };

// What must never change with the language: the figures, the unit, the code, the sizes and the place names.
const KEEP = ['229', '1257.9 m', '20 m', '200 m', '0.30*1400', '0.35*1400', '9', '120 m', '35 m', '45 m', 'Showroom', 'Warehouse 2'];

test('the stock block in each language keeps every figure, unit, code, size and place exactly', () => {
  const words = { fa: 'کافی است', ar: 'كافٍ', en: 'is enough', ur: 'کافی ہے' };
  for (const lang of ['fa', 'ar', 'en', 'ur']) {
    const t = formatStaffStock(sheet, '229', '', lang);
    for (const k of KEEP) assert.ok(t.includes(k), `${lang}: ${k}`);
    assert.ok(t.split('\n')[0].includes(words[lang]), `${lang} verdict`);
    assert.ok(!t.includes('⚠️'), `${lang} no warning`);
    assert.equal(t.split('\n').length, 7, `${lang} same shape`);
  }
});

test('Persian stays exactly as before (the default)', () => {
  assert.equal(formatStaffStock(sheet, '229'), formatStaffStock(sheet, '229', '', 'fa'));
  assert.match(formatStaffStock(sheet, '229'), /^موجودی کد 229 \(فیلم PVC\) کافی است\n- اندازه‌های ثبت‌شده: 0.30\*1400 و 0.35\*1400\n- آزاد: 1257.9 m\n- رزرو: 20 m\n- حداقل موجودی: 200 m\n- بسته: 9 بسته 120 m \+ باز: 35 m و 45 m و 8 m و 8 m و 8 m و 8 m و 2 قطعهٔ دیگر \(کل 1277.9 m\)\n- محل: Showroom، Warehouse 2$/);
});

test('English, Arabic and Urdu: labels, warning line and the group name are translated', () => {
  const en = formatStaffStock(lowSheet, '229', '', 'en');
  assert.match(en, /^Stock of code 229 \(PVC film\) is very low\n- Size: 0\.30\*1400\n- Free: 2\.5 m\n- Reserved: 20 m\n- Minimum stock: 200 m\n- Packages: open: 2\.5 m \(total 22\.5 m\)\n- Location: Showroom, Warehouse 2\n\n⚠️  Free stock is below the minimum stock \(200 m\)$/);
  const ar = formatStaffStock(lowSheet, '229', '', 'ar');
  assert.match(ar, /^مخزون الكود 229 \(فيلم PVC\) منخفض جدًا\n- الحجم: 0\.30\*1400\n- المتاح: 2\.5 m\n- المحجوز: 20 m\n- الحد الأدنى للمخزون: 200 m\n- العبوات: مفتوح: 2\.5 m \(الإجمالي 22\.5 m\)\n- الموقع: Showroom، Warehouse 2\n\n⚠️  المخزون المتاح أقل من الحد الأدنى \(200 m\)$/);
  const ur = formatStaffStock(lowSheet, '229', '', 'ur');
  assert.match(ur, /^کوڈ 229 \(پی وی سی فلم\) کا اسٹاک بہت کم ہے\n- سائز: 0\.30\*1400\n- دستیاب: 2\.5 m\n- محفوظ شدہ: 20 m\n- کم از کم اسٹاک: 200 m\n- پیکٹ: کھلے ہوئے: 2\.5 m \(کل 22\.5 m\)\n- مقام: Showroom، Warehouse 2\n\n⚠️  دستیاب اسٹاک کم از کم اسٹاک \(200 m\) سے کم ہے$/);
  // Hindi has no table of its own: English words
  assert.match(formatStaffStock(lowSheet, '229', '', 'hi'), /^Stock of code 229/);
});

test('the other fixed sentences of the stock answer in each language', () => {
  for (const lang of ['fa', 'ar', 'en', 'ur']) {
    assert.ok(formatStaffStock({ found: false, code: '999' }, '999', '', lang).includes('999'));
    const q = formatStaffStock({ found: true, ambiguous: true, categories: ['PVC film', 'Edge banding'] }, '1810', '', lang);
    assert.ok(q.includes('1) PVC film\n2) Edge banding') && q.includes('1810'), `${lang} question`);
    assert.ok(formatStaffStock({ ...sheet, stale: true, ageMinutes: 5 }, '229', '', lang).includes('5'));
    assert.ok(formatStaffStock({ found: true, sizeFound: false, code: '12', size: '1*1', sizes: ['2*2'] }, '12', '', lang).includes('2*2'));
    assert.ok(sizeNote(lang, '0.40').includes('0.40'));
  }
  assert.match(formatStaffStock({ found: false, code: '9' }, '9', '', 'en'), /was not found/);
  assert.match(formatStaffStock({ ...sheet, stale: true, ageMinutes: 5 }, '229', '', 'en'), /^\(Last updated 5 minutes ago/);
});

test('error and voice sentences in each language (Persian wording unchanged)', () => {
  assert.equal(notUnderstood('fa'), 'صدای شما مفهوم نیست، لطفاً درخواست خود را به صورت کتبی بفرستید');
  assert.equal(noVoice('fa'), 'الان امکان شنیدن صدا فعال نیست، لطفاً کتبی بنویسید');
  assert.match(notUnderstood('ur'), /آواز سمجھ نہیں آئی/);
  assert.match(notUnderstood('ar'), /لم أفهم/);
  assert.match(notUnderstood('en'), /could not understand/);
  assert.match(noVoice('ur'), /ابھی آواز/);
  assert.match(noVoice('ar'), /لا يمكنني سماع/);
  assert.match(noVoice('en'), /cannot be heard/);
  assert.equal(sheetFailed('fa', '229', true), 'دریافت موجودی کد 229 ناموفق بود (پاسخ برگه دیر رسید). سه بار تلاش شد. لطفاً یکی دو دقیقه بعد دوباره بپرسید.');
  assert.match(sheetFailed('en', '229', false), /Could not get the stock of code 229 \(could not reach the sheet\)\. Tried three times/);
  assert.match(sheetFailed('ar', '229', true), /تأخر رد الجدول/);
  assert.match(sheetFailed('ur', '229', false), /شیٹ سے رابطہ نہیں ہو سکا/);
  assert.equal(notUnderstood('de'), notUnderstood('fa')); // unknown: Persian
});

test('the confirmation question in each language, the code in Latin digits', () => {
  assert.equal(confirmStock('fa', ['408']), 'آیا درست متوجه شدم؟ موجودی کد 408؟');
  assert.equal(confirmStock('en', ['408', '229']), 'Did I understand correctly? Stock of code 408 and 229?');
  assert.equal(confirmStock('ar', ['408']), 'هل فهمت بشكل صحيح؟ مخزون الكود 408؟');
  assert.equal(confirmStock('ur', ['408']), 'کیا میں نے صحیح سمجھا؟ کوڈ 408 کا اسٹاک؟');
});

test('yes and no are understood in Persian, Arabic, English, Urdu and Hindi', () => {
  for (const y of ['بله', 'آره', 'نعم', 'أيوه', 'أجل', 'yes', 'OK', 'ہاں', 'جی ہاں', 'جی', 'ٹھیک ہے', 'हाँ', 'ठीक', '👍']) assert.equal(answerKind(y), 'yes', y);
  for (const n of ['نه', 'خیر', 'لا', 'كلا', 'no', 'Nope', 'نہیں', 'नहीं', '❌']) assert.equal(answerKind(n), 'no', n);
  for (const o of ['ہاں لیکن 409', 'maybe', 'نعم بس 409', 'कितना']) assert.equal(answerKind(o), 'other', o);
});

const claude = (obj) => ({ beta: { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] }) } } });

test('a voice note: the reply language comes from the words, not from the script or the first language tried', async () => {
  const base = { buffer: Buffer.from('ogg'), seconds: 4, config: { model: 'm', speechMinConfidence: 0.5 } };
  // Urdu words that the Persian model wrote in Persian letters: the model's own reading of the language wins
  const ur = await understand({
    ...base, transcribe: async () => ({ text: 'کوڈ 408 کا اسٹاک کتنا ہے', confidence: 0.8, language: 'fa-IR' }),
    client: claude({ intent: 'stock', language: 'ur', codes: ['408'], request_text: 'کوڈ 408 کا اسٹاک؟', confirm_text: 'آیا درست متوجه شدم؟' }),
  });
  assert.equal(ur.lang, 'ur');
  assert.equal(ur.confirmText, 'کیا میں نے صحیح سمجھا؟ کوڈ 408 کا اسٹاک؟');
  const cases = [['ar', 'هل فهمت بشكل صحيح؟ مخزون الكود 408؟'], ['en', 'Did I understand correctly? Stock of code 408?'], ['fa', 'آیا درست متوجه شدم؟ موجودی کد 408؟']];
  for (const [lang, expected] of cases) {
    const r = await understand({
      ...base, transcribe: async () => ({ text: SAMPLES[lang], confidence: 0.9, language: 'xx' }),
      client: claude({ intent: 'stock', language: lang, codes: ['408'], request_text: 'x', confirm_text: 'y' }),
    });
    assert.equal(r.lang, lang);
    assert.equal(r.confirmText, expected);
  }
  // no language from the model: the speech service's, else the letters
  const fromStt = await understand({ ...base, transcribe: async () => ({ text: 'x', confidence: 0.9, language: 'ur-PK' }), client: claude({ intent: 'stock', codes: ['1'], request_text: 'x', confirm_text: 'y' }) });
  assert.equal(fromStt.lang, 'ur');
});

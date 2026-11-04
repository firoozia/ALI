// The language a person writes or speaks in, and the fixed sentences the assistant says in each of them.
// Persian is the default. Numbers, units, codes and place names are never translated.

export const LANGS = ['fa', 'ar', 'en', 'ur', 'hi'];

/** 'ur-PK' / 'AR-ae' / 'fa' -> 'ur' / 'ar' / 'fa'; '' when it is none of ours. */
export const langOf = (code) => {
  const c = String(code || '').toLowerCase().slice(0, 2);
  return LANGS.includes(c) ? c : '';
};

const count = (s, re) => (s.match(re) || []).length;

/**
 * The language of a written message, from its letters. Digits and codes do not count; with no letters at all
 * [fallback] is used. Urdu is told by its own letters (ٹ ڈ ڑ ں ے ھ ہ), Arabic by ي ك ة ى without any Persian-only
 * letter, Hindi by Devanagari, English by Latin letters outnumbering the Arabic-script ones.
 */
export function detectLang(text, fallback = 'fa') {
  const s = String(text || '');
  const deva = count(s, /[ऀ-ॿ]/g);
  const arab = count(s, /[؀-ۿݐ-ݿ]/g);
  const latin = count(s, /[A-Za-z]/g);
  if (!deva && !arab && !latin) return fallback;
  if (deva && deva >= arab && deva >= latin) return 'hi';
  if (latin > arab) return 'en';
  if (count(s, /[ٹڈڑںےھہۂۓ]/g)) return 'ur';
  if (count(s, /[يكةى]/g) && !count(s, /[پچژگ]/g)) return 'ar';
  return 'fa';
}

const pick = (table, lang) => table[langOf(lang)] || table.fa;

/** Said when a voice note could not be understood. */
export const notUnderstood = (lang) => pick({
  fa: 'صدای شما مفهوم نیست، لطفاً درخواست خود را به صورت کتبی بفرستید',
  ar: 'لم أفهم الرسالة الصوتية، يرجى إرسال طلبك كتابةً',
  en: 'Sorry, I could not understand the voice note. Please send your request in writing.',
  ur: 'آپ کی آواز سمجھ نہیں آئی، براہِ کرم اپنی درخواست لکھ کر بھیجیں',
}, lang === 'hi' ? 'en' : lang);

/** Said when the speech service itself is not working. */
export const noVoice = (lang) => pick({
  fa: 'الان امکان شنیدن صدا فعال نیست، لطفاً کتبی بنویسید',
  ar: 'لا يمكنني سماع الرسائل الصوتية الآن، يرجى الكتابة',
  en: 'Voice notes cannot be heard right now, please write your request.',
  ur: 'ابھی آواز سننا ممکن نہیں، براہِ کرم لکھ کر بھیجیں',
}, lang === 'hi' ? 'en' : lang);

/** "Did I understand correctly? Stock of code 408?" in the speaker's language. */
export const confirmStock = (lang, codes) => {
  const l = lang === 'hi' ? 'en' : langOf(lang) || 'fa';
  const joined = codes.join(l === 'en' ? ' and ' : l === 'ur' ? ' اور ' : ' و ');
  return {
    fa: `آیا درست متوجه شدم؟ موجودی کد ${joined}؟`,
    ar: `هل فهمت بشكل صحيح؟ مخزون الكود ${joined}؟`,
    en: `Did I understand correctly? Stock of code ${joined}?`,
    ur: `کیا میں نے صحیح سمجھا؟ کوڈ ${joined} کا اسٹاک؟`,
  }[l];
};

/** The sheet could not be reached: [slow] says it answered too late rather than not at all. */
export const sheetFailed = (lang, code, slow) => {
  const l = lang === 'hi' ? 'en' : langOf(lang) || 'fa';
  return {
    fa: `دریافت موجودی کد ${code} ناموفق بود (${slow ? 'پاسخ برگه دیر رسید' : 'ارتباط با برگه برقرار نشد'}). سه بار تلاش شد. لطفاً یکی دو دقیقه بعد دوباره بپرسید.`,
    ar: `تعذر الحصول على مخزون الكود ${code} (${slow ? 'تأخر رد الجدول' : 'تعذر الاتصال بالجدول'}). جرت المحاولة ثلاث مرات. يرجى السؤال مرة أخرى بعد دقيقة أو دقيقتين.`,
    en: `Could not get the stock of code ${code} (${slow ? 'the sheet answered too late' : 'could not reach the sheet'}). Tried three times. Please ask again in a minute or two.`,
    ur: `کوڈ ${code} کا اسٹاک حاصل نہیں ہو سکا (${slow ? 'شیٹ نے دیر سے جواب دیا' : 'شیٹ سے رابطہ نہیں ہو سکا'})۔ تین بار کوشش کی گئی۔ براہِ کرم ایک دو منٹ بعد دوبارہ پوچھیں۔`,
  }[l];
};

/** The language name given to the model: "Reply language: Urdu". */
export const LANG_NAME = { fa: 'Persian', ar: 'Arabic', en: 'English', ur: 'Urdu', hi: 'Hindi' };

/** Put first in a stock answer when the size a colleague named is not registered. */
export const sizeNote = (lang, size) => {
  const l = lang === 'hi' ? 'en' : langOf(lang) || 'fa';
  return {
    fa: `اندازهٔ ${size} برای این کد ثبت نشده؛ نتیجه برای کل کد است.`,
    ar: `الحجم ${size} غير مسجل لهذا الكود؛ النتيجة للكود كله.`,
    en: `Size ${size} is not registered for this code; this is the result for the whole code.`,
    ur: `سائز ${size} اس کوڈ کے لیے رجسٹرڈ نہیں؛ نتیجہ پورے کوڈ کا ہے۔`,
  }[l];
};

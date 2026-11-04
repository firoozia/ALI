import { confirmStock, detectLang, langOf } from './lang.js';
import { normalizeDigits, normalizeLetters } from './text.js';

// Voice notes: transcribe, work out what was asked, ask the person to confirm, and only after a clear yes let the
// request go on as if it had been typed. Nothing is ever acted on from a voice note without that confirmation.

/** Longer voice notes are not transcribed (cost). */
export const MAX_SECONDS = 60;

export const NOT_UNDERSTOOD_FA = 'صدای شما مفهوم نیست، لطفاً درخواست خود را به صورت کتبی بفرستید';
/** Customers get the Persian sentence and its English twin (their language is unknown when the audio is unclear). */
export const NOT_UNDERSTOOD_CUSTOMER = `${NOT_UNDERSTOOD_FA}\nSorry, we could not understand the voice note. Please send your request in writing.`;

/** Said when the speech service itself fails (for example no permission yet): the voice note cannot be heard. */
export const NO_VOICE_FA = 'الان امکان شنیدن صدا فعال نیست، لطفاً کتبی بنویسید';
export const NO_VOICE_CUSTOMER = `${NO_VOICE_FA}
Sorry, voice notes cannot be heard right now. Please write your request.`;

const RETRY = {
  fa: 'باشه. لطفاً درخواست را دوباره بفرستید یا بنویسید.',
  ar: 'حسناً. يرجى إعادة إرسال طلبك أو كتابته.',
  ur: 'ٹھیک ہے۔ براہِ کرم اپنی درخواست دوبارہ بھیجیں یا لکھیں۔',
  en: 'OK. Please send your request again or write it.',
};
export const retryText = (lang) => RETRY[String(lang || '').slice(0, 2).toLowerCase()] || RETRY.en;

const YES = ['بله', 'بلی', 'آره', 'اره', 'درسته', 'درست', 'صحیح', 'اوکی', 'تایید', 'تأیید', 'نعم', 'ايوه', 'ايوا', 'أيوه', 'أيوا', 'اجل', 'أجل', 'صح', 'صحيح', 'تمام', 'اي', 'ای',
  'ہاں', 'ہاں جی', 'جی', 'جی ہاں', 'جی ہاں', 'ٹھیک', 'ٹھیک ہے', 'صحیح ہے', 'हाँ', 'हां', 'जी', 'जी हाँ', 'ठीक',
  'yes', 'yeah', 'yep', 'y', 'ok', 'okay', 'correct', 'right', 'sure', 'ja', '👍', '✅'];
const NO = ['نه', 'نخیر', 'خیر', 'نه اشتباه', 'غلطه', 'اشتباه', 'لا', 'لأ', 'خطأ', 'غلط', 'كلا', 'نہیں', 'نہی', 'نا', 'غلط ہے', 'नहीं', 'ना', 'no', 'nope', 'wrong', 'n', '👎', '❌'];
const key = (s) => normalizeLetters(String(s || '')).replace(/[.!،؟?,]/g, ' ').replace(/\s+/g, ' ').trim();
const YES_KEYS = new Set(YES.map(key));
const NO_KEYS = new Set(NO.map(key));

/** 'yes' | 'no' | 'other' for the reply to a confirmation question. Only a short, clear answer counts. */
export function answerKind(text) {
  const t = key(text);
  if (!t) return 'other';
  if (YES_KEYS.has(t)) return 'yes';
  if (NO_KEYS.has(t)) return 'no';
  return 'other';
}

/** 'yes' | 'no' | '' for an answer that BEGINS with a clear yes or no and has more words ("نه، این سفارش نیست، فاکتور است"). */
export function answerLead(text) {
  const first = key(String(text || '').split(/[\s,،.:;!؟?]+/).find(Boolean) || '');
  return YES_KEYS.has(first) ? 'yes' : NO_KEYS.has(first) ? 'no' : '';
}

/** What was understood from each person's last voice note, per chat (and sender), with a short life. */
export class VoiceDesk {
  constructor({ ttlMs = 10 * 60 * 1000 } = {}) { this.ttlMs = ttlMs; this.map = new Map(); }

  set(key, value, now = Date.now()) { this.map.set(key, { ...value, expires: now + this.ttlMs }); }

  get(key, now = Date.now()) {
    const v = this.map.get(key);
    if (!v) return null;
    if (now > v.expires) { this.map.delete(key); return null; }
    return v;
  }

  clear(key) { this.map.delete(key); }
}

export const INTENT_RULES = `You read the transcript of a WhatsApp voice note sent to ARYAK (PVC film, edge banding, glues, cabinet hardware). The speaker may use Persian, Arabic, English, Urdu or Hindi, often mixing them. The transcript comes from speech recognition and can contain mistakes, especially in digits and product codes.

Decide what the speaker wants and answer with ONE JSON object and nothing else:
{"intent":"stock"|"order"|"other","language":"fa"|"ar"|"en"|"ur"|"hi","codes":[string],"request_text":string,"confirm_text":string}
- "stock": asks whether a product code or item is available. "order": wants to order or asks for something specific. "other": anything else, or you cannot tell.
- "codes": the product codes you heard, written with Latin digits and letters exactly as a code is written in the catalogue (for example "408", "KG10-300"). Never invent or fix a code you did not hear.
- "request_text": the request as a short written message, as the speaker would have typed it, in the speaker's language, codes and quantities in Latin digits. Empty for "other".
- "confirm_text": ONE short question in the speaker's language that starts with the equivalent of "Did I understand correctly?" and then says the request back with the code and quantity in Latin digits, e.g. Persian: "آیا درست متوجه شدم؟ کد 408 را می‌خواستید؟". Empty for "other".
- Numbers spoken as words (Persian, Arabic or English, e.g. "چهارصد و هشت") are written as digits ("408") in "codes" and in both texts.
- The speaker usually begins with the assistant's name (Atossa, آتوسا). Speech recognition often garbles it ("آدرس", "اتوسا", "اتوصا"): ignore it and take the request after it.
- "confirm_text" repeats what you understood, for example Persian: "آیا درست متوجه شدم؟ موجودی کد 408؟".
- "language" is the language of the words themselves, not of the script they were written in (an Urdu or Hindi voice note may arrive in Persian letters).
- If a code or a quantity is doubtful, use "other".`;

const field = (v, d) => (typeof v === 'string' ? v : d);

/** Claude reads the transcript: returns { intent, language, codes, requestText, confirmText } or null when nothing usable. */
export async function extractIntent({ client, config, transcript }) {
  const res = await client.beta.messages.create({
    model: config.model,
    max_tokens: 800,
    system: INTENT_RULES,
    messages: [{ role: 'user', content: `Transcript:\n${transcript}` }],
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  const s = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let v;
  try { v = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  const intent = field(v.intent, 'other');
  const requestText = field(v.request_text, '').trim();
  const confirmText = field(v.confirm_text, '').trim();
  if (!['stock', 'order'].includes(intent) || !requestText || !confirmText) return null;
  return { intent, language: field(v.language, ''), codes: Array.isArray(v.codes) ? v.codes.map(String) : [], requestText, confirmText };
}

/**
 * From audio to a question to ask back. [buffer]: the voice note, [seconds]: its length, [transcribe]: async (buffer)
 * -> { text, confidence }. Returns { ok: true, ...intent, transcript } or { ok: false, reason }.
 */
const UNITS = { صفر: 0, یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, شیش: 6, هفت: 7, هشت: 8, نه: 9 };
const TEENS = { ده: 10, یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, پانزده: 15, شانزده: 16, هفده: 17, هجده: 18, نوزده: 19 };
const TENS = { بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90 };
const HUNDREDS = { صد: 100, یکصد: 100, دویست: 200, سیصد: 300, چهارصد: 400, پانصد: 500, ششصد: 600, هفتصد: 700, هشتصد: 800, نهصد: 900 };
const NUMBER_WORD = (w) => UNITS[w] ?? TEENS[w] ?? TENS[w] ?? HUNDREDS[w] ?? (w === 'هزار' ? 'k' : undefined);

/**
 * "کد چهارصد و هشت" -> "کد 408": Persian number words (up to the thousands) turned into digits, so a code spoken in
 * words reaches the model as a code. A lone "نه" is left alone (it also means "no").
 */
export function normalizeSpokenNumbers(text) {
  const tokens = normalizeLetters(text).split(/(\s+)/);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    if (NUMBER_WORD(w) === undefined) { out.push(w); continue; }
    // A run: number words joined by "و" (and spaces).
    const run = [w];
    let k = i + 1;
    while (k + 2 < tokens.length) {
      const sep = tokens[k]; const maybeAnd = tokens[k + 1]; const sep2 = tokens[k + 2]; const next = tokens[k + 3];
      if (/^\s+$/.test(sep) && maybeAnd === 'هزار') { run.push('هزار'); k += 2; } // "دو هزار"
      else if (/^\s+$/.test(sep) && maybeAnd === 'و' && /^\s+$/.test(sep2) && next !== undefined && NUMBER_WORD(next) !== undefined) { run.push(next); k += 4; } else break;
    }
    if (run.length === 1 && w === 'نه') { out.push(w); continue; }
    let total = 0;
    let current = 0;
    for (const r of run) {
      const v = NUMBER_WORD(r);
      if (v === 'k') { current = (current || 1) * 1000; total += current; current = 0; } else current += v;
    }
    out.push(String(total + current));
    i = k - 1;
  }
  return out.join('');
}

/** Ways the recogniser writes the assistant's name; "آدرس" counts only right before موجودی or کد. */
const NAME_FORMS = ['آتوسا', 'اتوسا', 'اتوصا', 'آتوصا', 'آتوسه', 'اتوسه', 'atossa', 'atosa'].map((n) => normalizeLetters(n));
export function nameHeard(transcript, names = []) {
  const words = normalizeDigits(normalizeLetters(transcript)).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const known = new Set([...NAME_FORMS, ...names.map(normalizeLetters)]);
  if (words.some((w) => known.has(w))) return true;
  const i = words.indexOf('آدرس');
  return i >= 0 && ['موجودی', 'کد'].includes(words[i + 1]);
}

export async function understand({ buffer, seconds = 0, config, client, transcribe, log = () => {} }) {
  if (!buffer?.length) return { ok: false, reason: 'empty' };
  if (buffer.length > 9 * 1024 * 1024 || seconds > MAX_SECONDS) return { ok: false, reason: 'too long' };
  let t;
  try { t = await transcribe(buffer); } catch (e) { log(`voice: speech-to-text failed: ${e.message}`); return { ok: false, reason: 'speech error' }; }
  log(`voice: transcript ${t.text.length} characters, confidence ${Math.round(t.confidence * 100) / 100}${t.language ? `, language ${t.language}` : ''}`);
  if (!t.text.trim() || t.confidence < (config.speechMinConfidence ?? 0.5)) return { ok: false, reason: 'unclear', transcript: t.text };
  let i;
  try { i = await extractIntent({ client, config, transcript: normalizeSpokenNumbers(t.text) }); } catch (e) { log(`voice: intent failed: ${e.message}`); return { ok: false, reason: 'intent error' }; }
  if (!i) { log('voice: no stock or order request found'); return { ok: false, reason: 'no intent', transcript: t.text }; }
  // The language of the person: what the model heard in the words, else what the speech service said, else the letters.
  const lang = langOf(i.language) || langOf(t.language) || detectLang(t.text);
  // A stock question is confirmed with a sentence built here, so it is always in the speaker's language.
  const confirmText = i.intent === 'stock' && i.codes.length ? confirmStock(lang, i.codes) : i.confirmText;
  log(`voice: understood as ${i.intent}, reply language ${lang}`);
  return { ok: true, ...i, confirmText, lang, transcript: t.text };
}

/**
 * What to do with a colleague's voice note after it was read ([u]: the result of understand()).
 * 'confirm': a clear stock or order request, ask back. 'tell': say it was not understood. 'unavailable': the speech
 * service failed, say voice cannot be heard now. 'silent': not for us.
 * [explicit]: addressed by a mention, a reply to the assistant, a private chat, or answering its last question.
 * [namedInTranscript]: the assistant's name was spoken in the note.
 */
export function voiceAction({ u, explicit, namedInTranscript, noticeDue = false }) {
  if (u.ok) return 'confirm';
  // The service failed: say so politely when addressed, otherwise at most once in a while per chat.
  if (u.reason === 'speech error') return explicit || noticeDue ? 'unavailable' : 'silent';
  return explicit || namedInTranscript ? 'tell' : 'silent';
}

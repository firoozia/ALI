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

const YES = ['بله', 'بلی', 'آره', 'اره', 'درسته', 'درست', 'صحیح', 'اوکی', 'تایید', 'تأیید', 'نعم', 'اي', 'ايوه', 'ایوه', 'صح', 'صحيح', 'تمام', 'ہاں', 'جی', 'جی ہاں', 'yes', 'yeah', 'yep', 'y', 'ok', 'okay', 'correct', 'right', 'sure', '👍', '✅'];
const NO = ['نه', 'نخیر', 'خیر', 'نه اشتباه', 'غلطه', 'اشتباه', 'لا', 'خطأ', 'غلط', 'نہیں', 'no', 'nope', 'wrong', 'n', '👎', '❌'];
const clean = (s) => String(s || '').toLowerCase().replace(/[‌‏.!،؟?,]/g, ' ').replace(/\s+/g, ' ').trim();

/** 'yes' | 'no' | 'other' for the reply to a confirmation question. Only a short, clear answer counts. */
export function answerKind(text) {
  const t = clean(text);
  if (!t) return 'other';
  if (YES.includes(t)) return 'yes';
  if (NO.includes(t)) return 'no';
  return 'other';
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
  return { intent, language: field(v.language, 'en'), codes: Array.isArray(v.codes) ? v.codes.map(String) : [], requestText, confirmText };
}

/**
 * From audio to a question to ask back. [buffer]: the voice note, [seconds]: its length, [transcribe]: async (buffer)
 * -> { text, confidence }. Returns { ok: true, ...intent, transcript } or { ok: false, reason }.
 */
export async function understand({ buffer, seconds = 0, config, client, transcribe, log = () => {} }) {
  if (!buffer?.length) return { ok: false, reason: 'empty' };
  if (buffer.length > 9 * 1024 * 1024 || seconds > MAX_SECONDS) return { ok: false, reason: 'too long' };
  let t;
  try { t = await transcribe(buffer); } catch (e) { log(`voice: speech-to-text failed: ${e.message}`); return { ok: false, reason: 'speech error' }; }
  log(`voice: transcript ${t.text.length} characters, confidence ${Math.round(t.confidence * 100) / 100}${t.language ? `, language ${t.language}` : ''}`);
  if (!t.text.trim() || t.confidence < (config.speechMinConfidence ?? 0.5)) return { ok: false, reason: 'unclear', transcript: t.text };
  let i;
  try { i = await extractIntent({ client, config, transcript: t.text }); } catch (e) { log(`voice: intent failed: ${e.message}`); return { ok: false, reason: 'intent error' }; }
  if (!i) { log('voice: no stock or order request found'); return { ok: false, reason: 'no intent', transcript: t.text }; }
  log(`voice: understood as ${i.intent}, language ${i.language}`);
  return { ok: true, ...i, transcript: t.text };
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

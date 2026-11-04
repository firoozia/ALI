import test from 'node:test';
import assert from 'node:assert/strict';
import { metadataToken, speechTranscriber } from '../src/speech.js';
import { NO_VOICE_CUSTOMER, NO_VOICE_FA, MAX_SECONDS, NOT_UNDERSTOOD_CUSTOMER, NOT_UNDERSTOOD_FA, VoiceDesk, answerKind, extractIntent, retryText, understand, voiceAction } from '../src/voice.js';

const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

test('token comes from the metadata server and is cached until it nearly expires', async () => {
  let calls = 0;
  let t = 0;
  const fetchImpl = async (url, opts) => { calls++; assert.match(url, /metadata\.google\.internal/); assert.equal(opts.headers['Metadata-Flavor'], 'Google'); return json({ access_token: `tok${calls}`, expires_in: 3600 }); };
  const token = metadataToken({ fetchImpl, now: () => t });
  assert.equal(await token(), 'tok1');
  assert.equal(await token(), 'tok1');
  t = 3600 * 1000;
  assert.equal(await token(), 'tok2');
  await assert.rejects(metadataToken({ fetchImpl: async () => json({}, false, 404) })(), /404/);
});

test('speech request: ogg opus, the main language; text and the lowest confidence come back', async () => {
  let sent;
  const fetchImpl = async (url, opts) => {
    sent = { url, opts, body: JSON.parse(opts.body) };
    return json({ results: [{ alternatives: [{ transcript: ' کد 408 موجوده ', confidence: 0.9 }] }, { alternatives: [{ transcript: 'ممنون', confidence: 0.7 }] }] });
  };
  const tr = speechTranscriber({ languages: ['fa-IR', 'ar-AE', 'en-IN', 'ur-PK', 'hi-IN'], token: async () => 'T', fetchImpl });
  const r = await tr(Buffer.from('audio'));
  assert.deepEqual(r, { text: 'کد 408 موجوده ممنون', confidence: 0.7, language: 'fa-IR' });
  assert.match(sent.url, /speech\.googleapis\.com\/v1\/speech:recognize/);
  assert.equal(sent.opts.headers.Authorization, 'Bearer T');
  assert.equal(sent.body.config.encoding, 'OGG_OPUS');
  assert.equal(sent.body.config.languageCode, 'fa-IR');
  assert.ok(!('alternativeLanguageCodes' in sent.body.config), 'the main language is sent alone');
  assert.equal(sent.body.audio.content, Buffer.from('audio').toString('base64'));
});

test('speech: nothing recognised is empty; a refusal throws with Google\'s words', async () => {
  const empty = speechTranscriber({ languages: ['fa-IR'], token: async () => 'T', fetchImpl: async () => json({}) });
  assert.deepEqual(await empty(Buffer.from('x')), { text: '', confidence: 0, language: '' });
  const denied = speechTranscriber({ languages: ['fa-IR'], token: async () => 'T', fetchImpl: async () => json({ error: { message: 'Permission denied' } }, false, 403) });
  await assert.rejects(denied(Buffer.from('x')), /403.*Permission denied/);
});

test('answers: clear yes and no only; anything else is "other"', () => {
  for (const y of ['بله', 'آره!', 'درسته', 'Yes', 'ok', 'نعم', '👍']) assert.equal(answerKind(y), 'yes', y);
  for (const n of ['نه', 'No', 'لا', 'خیر.', '❌']) assert.equal(answerKind(n), 'no', n);
  for (const o of ['بله ولی ۴۰۹', 'کد 305 چی؟', '', 'maybe']) assert.equal(answerKind(o), 'other', o);
});

test('desk: confirmation lives ten minutes and is per key', () => {
  const d = new VoiceDesk({ ttlMs: 1000 });
  d.set('a', { requestText: 'x' }, 0);
  assert.equal(d.get('a', 500).requestText, 'x');
  assert.equal(d.get('b', 500), null);
  assert.equal(d.get('a', 1500), null);
  d.set('a', { requestText: 'y' }, 2000);
  d.clear('a');
  assert.equal(d.get('a', 2100), null);
});

const claudeSaying = (t) => ({ beta: { messages: { create: async () => ({ content: [{ type: 'text', text: t }] }) } } });
const intentJson = JSON.stringify({ intent: 'stock', language: 'fa', codes: ['408'], request_text: 'کد 408 موجوده؟', confirm_text: 'آیا درست متوجه شدم؟ کد 408 را می‌خواستید؟' });

test('intent: stock and order pass, "other" and junk do not', async () => {
  const run = (t) => extractIntent({ client: claudeSaying(t), config: { model: 'm' }, transcript: 'x' });
  const ok = await run(intentJson);
  assert.equal(ok.intent, 'stock');
  assert.deepEqual(ok.codes, ['408']);
  assert.match(ok.confirmText, /کد 408/);
  assert.equal(await run(JSON.stringify({ intent: 'other', request_text: '', confirm_text: '' })), null);
  assert.equal(await run('{"intent":"stock"}'), null);
  assert.equal(await run('no json'), null);
});

test('understand: ok path, and every way of not understanding', async () => {
  const buf = Buffer.from('ogg');
  const base = { buffer: buf, seconds: 5, config: { model: 'm', speechMinConfidence: 0.5 }, client: claudeSaying(intentJson) };
  const good = await understand({ ...base, transcribe: async () => ({ text: 'کد چهارصد و هشت', confidence: 0.9 }) });
  assert.equal(good.ok, true);
  assert.equal(good.requestText, 'کد 408 موجوده؟');
  const logs = [];
  assert.equal((await understand({ ...base, transcribe: async () => ({ text: '', confidence: 0 }) })).ok, false);
  assert.equal((await understand({ ...base, transcribe: async () => ({ text: 'hmm', confidence: 0.2 }) })).reason, 'unclear');
  assert.equal((await understand({ ...base, transcribe: async () => { throw new Error('403'); }, log: (s) => logs.push(s) })).reason, 'speech error');
  assert.match(logs[0], /403/);
  assert.equal((await understand({ ...base, client: claudeSaying('{"intent":"other"}'), transcribe: async () => ({ text: 'hello', confidence: 0.9 }) })).reason, 'no intent');
  assert.equal((await understand({ ...base, buffer: Buffer.alloc(0), transcribe: async () => ({}) })).reason, 'empty');
  assert.equal((await understand({ ...base, seconds: 120, transcribe: async () => ({}) })).reason, 'too long');
});

test('texts: the owner\'s sentence, its customer twin, and retry in the speaker\'s language', () => {
  assert.equal(NOT_UNDERSTOOD_FA, 'صدای شما مفهوم نیست، لطفاً درخواست خود را به صورت کتبی بفرستید');
  assert.ok(NOT_UNDERSTOOD_CUSTOMER.startsWith(NOT_UNDERSTOOD_FA));
  assert.match(retryText('ar'), /حسناً/);
  assert.match(retryText('fa-IR'), /باشه/);
  assert.match(retryText('xx'), /OK/);
});

test('speech: the language comes back and a refusal carries Google\'s status', async () => {
  const tr = speechTranscriber({ languages: ['fa-IR'], token: async () => 'T', fetchImpl: async () => json({ results: [{ languageCode: 'ar-ae', alternatives: [{ transcript: 'x', confidence: 0.9 }] }] }) });
  assert.equal((await tr(Buffer.from('a'))).language, 'ar-ae');
  const denied = speechTranscriber({ languages: ['fa-IR'], token: async () => 'T', fetchImpl: async () => json({ error: { status: 'PERMISSION_DENIED', message: 'caller lacks permission' } }, false, 403) });
  await assert.rejects(denied(Buffer.from('a')), /403 PERMISSION_DENIED: caller lacks permission/);
});

test('understand: logs length, confidence and language but never the words; keeps the transcript when no request is found', async () => {
  const logs = [];
  const base = { buffer: Buffer.from('ogg'), seconds: 5, config: { model: 'm', speechMinConfidence: 0.5 }, log: (s) => logs.push(s) };
  const secret = 'words nobody should log';
  const r = await understand({ ...base, client: claudeSaying('{"intent":"other"}'), transcribe: async () => ({ text: secret, confidence: 0.9, language: 'fa-ir' }) });
  assert.equal(r.ok, false);
  assert.equal(r.transcript, secret);
  assert.ok(logs.some((l) => /transcript 23 characters, confidence 0.9, language fa-ir/.test(l)));
  assert.ok(!logs.join('\n').includes(secret));
  const good = await understand({ ...base, client: claudeSaying(intentJson), transcribe: async () => ({ text: 'x y', confidence: 0.9 }) });
  assert.equal(good.ok, true);
  assert.ok(logs.some((l) => /understood as stock, language fa/.test(l)));
});

test('voice notes longer than a minute are not read', async () => {
  assert.equal(MAX_SECONDS, 60);
  let called = false;
  const r = await understand({ buffer: Buffer.from('x'), seconds: 61, config: { model: 'm' }, client: claudeSaying(intentJson), transcribe: async () => { called = true; return {}; } });
  assert.equal(r.reason, 'too long');
  assert.equal(called, false);
  assert.equal((await understand({ buffer: Buffer.from('x'), seconds: 60, config: { model: 'm' }, client: claudeSaying(intentJson), transcribe: async () => ({ text: 'a', confidence: 0.9 }) })).ok, true);
});

test('a colleague\'s voice note: a clear request is confirmed, anything else is silent unless addressed or named', () => {
  const bad = { ok: false, reason: 'no intent' };
  assert.equal(voiceAction({ u: { ok: true }, explicit: false, namedInTranscript: false }), 'confirm');
  assert.equal(voiceAction({ u: bad, explicit: false, namedInTranscript: false }), 'silent');
  assert.equal(voiceAction({ u: bad, explicit: true, namedInTranscript: false }), 'tell');
  assert.equal(voiceAction({ u: bad, explicit: false, namedInTranscript: true }), 'tell');
});

test('when the speech service fails the person is told politely (a group is told at most once in a while)', () => {
  const failed = { ok: false, reason: 'speech error' };
  assert.equal(voiceAction({ u: failed, explicit: true, namedInTranscript: false }), 'unavailable');
  assert.equal(voiceAction({ u: failed, explicit: false, namedInTranscript: false, noticeDue: true }), 'unavailable');
  assert.equal(voiceAction({ u: failed, explicit: false, namedInTranscript: false, noticeDue: false }), 'silent');
  assert.equal(NO_VOICE_FA, 'الان امکان شنیدن صدا فعال نیست، لطفاً کتبی بنویسید');
  assert.ok(NO_VOICE_CUSTOMER.startsWith(NO_VOICE_FA));
});

test('understand: a refused speech call gives the reason "speech error" and logs Google\'s code and words', async () => {
  const logs = [];
  const r = await understand({
    buffer: Buffer.from('x'), seconds: 5, config: { model: 'm' }, client: claudeSaying(intentJson), log: (s) => logs.push(s),
    transcribe: async () => { throw new Error('speech answered 403 PERMISSION_DENIED: caller lacks permission'); },
  });
  assert.equal(r.reason, 'speech error');
  assert.match(logs.join('\n'), /403 PERMISSION_DENIED: caller lacks permission/);
});

// ---- the owner's real voice note: "آتوسا موجودی کد 408 چقدره" heard as "آدرس موجودی کد ۴۰۸ چقدره" ----
import { nameHeard, normalizeSpokenNumbers } from '../src/voice.js';
import { DEFAULT_PHRASES, opusInputRate } from '../src/speech.js';

test('the real transcript: the name was heard as "آدرس" before موجودی, and that counts as the name', () => {
  const heard = 'آدرس موجودی کد ۴۰۸ چقدره';
  assert.equal(nameHeard(heard, ['آتوسا']), true);
  assert.equal(nameHeard('آدرس مغازه کجاست', ['آتوسا']), false); // an address in its normal sense
  for (const n of ['آتوسا موجودی', 'اتوسا موجودی', 'اتوصا کد', 'آتوسه کد', 'Atossa stock']) assert.equal(nameHeard(n, ['آتوسا']), true, n);
  assert.equal(nameHeard('موجودی کد ۴۰۸', ['آتوسا']), false);
});

test('the real transcript reaches the model with the code in Latin digits and the question repeated back', async () => {
  let sentText = '';
  const client = { beta: { messages: { create: async (req) => { sentText = req.messages[0].content; return { content: [{ type: 'text', text: JSON.stringify({ intent: 'stock', language: 'fa', codes: ['408'], request_text: 'موجودی کد 408؟', confirm_text: 'آیا درست متوجه شدم؟ موجودی کد 408؟' }) }] }; } } } };
  const r = await understand({ buffer: Buffer.from('ogg'), seconds: 4, config: { model: 'm', speechMinConfidence: 0.5 }, client, transcribe: async () => ({ text: 'آدرس موجودی کد ۴۰۸ چقدره', confidence: 0.87, language: 'fa-ir' }) });
  assert.equal(r.ok, true);
  assert.equal(r.confirmText, 'آیا درست متوجه شدم؟ موجودی کد 408؟');
  assert.deepEqual(r.codes, ['408']);
  assert.match(sentText, /آدرس موجودی کد 408 چقدره/);
});

test('numbers spoken in words become digits', () => {
  assert.equal(normalizeSpokenNumbers('آتوسا موجودی کد چهارصد و هشت چقدره'), 'آتوسا موجودی کد 408 چقدره');
  assert.equal(normalizeSpokenNumbers('بیست و پنج'), '25');
  assert.equal(normalizeSpokenNumbers('کد دویست و بیست و نه'), 'کد 229');
  assert.equal(normalizeSpokenNumbers('هزار و هشتصد و ده'), '1810');
  assert.equal(normalizeSpokenNumbers('دو هزار و پانصد'), '2500');
  assert.equal(normalizeSpokenNumbers('سیصد'), '300');
  assert.equal(normalizeSpokenNumbers('نه'), 'نه'); // "no"
  assert.equal(normalizeSpokenNumbers('نه من دویست می‌خوام'), 'نه من 200 میخوام');
  assert.equal(normalizeSpokenNumbers('موجودی کد 305'), 'موجودی کد 305');
});

test('speech: Opus at 48000, the main language alone first, the others only when it gives nothing usable, with phrase hints', async () => {
  const bodies = [];
  const answers = [{}, { results: [{ languageCode: 'ar-ae', alternatives: [{ transcript: 'junk', confidence: 0.3 }] }] }, { results: [{ languageCode: 'en-in', alternatives: [{ transcript: 'stock 408', confidence: 0.8 }] }] }];
  const fetchImpl = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return json(answers.shift() || {}); };
  const tr = speechTranscriber({ languages: ['fa-IR', 'ar-AE', 'en-IN'], token: async () => 'T', fetchImpl, minConfidence: 0.5 });
  const r = await tr(Buffer.from('x'));
  assert.equal(r.text, 'stock 408');
  assert.deepEqual(bodies.map((b) => b.config.languageCode), ['fa-IR', 'ar-AE', 'en-IN']);
  assert.ok(bodies.every((b) => b.config.sampleRateHertz === 48000 && !('alternativeLanguageCodes' in b.config)));
  assert.deepEqual(bodies[0].config.speechContexts, [{ phrases: DEFAULT_PHRASES, boost: 15 }]);
  assert.ok(DEFAULT_PHRASES.includes('آتوسا') && DEFAULT_PHRASES.includes('اتوسا') && DEFAULT_PHRASES.includes('موجودی'));
});

test('speech: a good first answer stops there; nothing usable anywhere gives the best weak one, else empty', async () => {
  let calls = 0;
  const good = speechTranscriber({ languages: ['fa-IR', 'ar-AE'], token: async () => 'T', fetchImpl: async () => { calls++; return json({ results: [{ alternatives: [{ transcript: 'ok', confidence: 0.87 }] }] }); }, minConfidence: 0.5 });
  assert.equal((await good(Buffer.from('x'))).text, 'ok');
  assert.equal(calls, 1);
  const weak = speechTranscriber({ languages: ['fa-IR', 'ar-AE'], token: async () => 'T', fetchImpl: async () => json({ results: [{ alternatives: [{ transcript: 'meh', confidence: 0.2 }] }] }), minConfidence: 0.5 });
  assert.equal((await weak(Buffer.from('x'))).confidence, 0.2);
  const none = speechTranscriber({ languages: ['fa-IR', 'ar-AE'], token: async () => 'T', fetchImpl: async () => json({}), minConfidence: 0.5 });
  assert.equal((await none(Buffer.from('x'))).text, '');
});

test('the declared input rate is read from the Opus header', () => {
  const head = Buffer.concat([Buffer.from('OggS....'), Buffer.from('OpusHead'), Buffer.from([1, 1, 0, 0]), Buffer.from([0x80, 0x3e, 0, 0]), Buffer.alloc(4)]);
  assert.equal(opusInputRate(head), 16000);
  assert.equal(opusInputRate(Buffer.from('not opus at all')), 0);
});

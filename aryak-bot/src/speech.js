// Speech to text for WhatsApp voice notes: Google Cloud Speech-to-Text (REST), signed in with the VM's own service
// account through the metadata server (no key file). Claude cannot take audio, so this turns the note into text.

const TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const SPEECH_URL = 'https://speech.googleapis.com/v1/speech:recognize';

/** Returns an async () -> access token, cached until a minute before it expires. */
export function metadataToken({ fetchImpl = fetch, now = Date.now } = {}) {
  let cache = null;
  return async () => {
    if (cache && now() < cache.exp - 60000) return cache.token;
    const r = await fetchImpl(TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!r.ok) throw new Error(`metadata token answered ${r.status}`);
    const j = await r.json();
    cache = { token: j.access_token, exp: now() + Number(j.expires_in || 300) * 1000 };
    return cache.token;
  };
}

/**
 * The "input sample rate" an Ogg Opus file declares in its OpusHead packet (0 when it is not Opus). Opus is always
 * decoded at 48000 Hz and that is what Google wants for it, so this is only read to log what the phone recorded.
 */
export function opusInputRate(buffer) {
  const b = Buffer.from(buffer);
  const at = b.indexOf('OpusHead');
  if (at < 0 || b.length < at + 16) return 0;
  return b.readUInt32LE(at + 12);
}

/** Words the recogniser should lean towards (the assistant's name and what is asked in this business). */
export const DEFAULT_PHRASES = ['آتوسا', 'اتوسا', 'موجودی', 'کد', 'چقدره', 'چقدر', 'سفارش', 'فاکتور'];

/**
 * [languages]: BCP-47 codes, the first is tried alone, and the others one by one only when it gives nothing usable.
 * (Sending alternatives together with the main language gave an empty answer on real voice notes.)
 * [phrases]: speech adaptation, raised by [boost] (0 to 20). [minConfidence]: below this the next language is tried.
 * Returns async (buffer) -> { text, confidence, language } ("" and 0 when nothing was recognised).
 * A refusal (for example missing permission) throws with Google's own message.
 */
export function speechTranscriber({ languages, token, fetchImpl = fetch, sampleRate = 48000, phrases = DEFAULT_PHRASES, boost = 15, minConfidence = 0.5 }) {
  const once = async (buffer, language, accessToken) => {
    const res = await fetchImpl(SPEECH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          encoding: 'OGG_OPUS', sampleRateHertz: sampleRate, languageCode: language, enableAutomaticPunctuation: true,
          ...(phrases.length ? { speechContexts: [{ phrases, boost }] } : {}),
        },
        audio: { content: Buffer.from(buffer).toString('base64') },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`speech answered ${res.status}${body.error?.status ? ` ${body.error.status}` : ''}: ${body.error?.message || 'no message'}`);
    const parts = (body.results || []).map((r) => r.alternatives?.[0]).filter((a) => a?.transcript);
    if (!parts.length) return { text: '', confidence: 0, language };
    const confidences = parts.map((a) => (typeof a.confidence === 'number' ? a.confidence : 0));
    return {
      text: parts.map((a) => a.transcript.trim()).join(' ').trim(),
      confidence: Math.min(...confidences),
      language: (body.results || []).find((r) => r.languageCode)?.languageCode || language,
    };
  };
  return async (buffer) => {
    const accessToken = await token();
    let best = { text: '', confidence: 0, language: '' };
    for (const language of languages) {
      const r = await once(buffer, language, accessToken);
      if (r.text && r.confidence >= minConfidence) return r;
      if (r.text && r.confidence > best.confidence) best = r;
    }
    return best;
  };
}

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
 * [languages]: BCP-47 codes; the first is the main one, up to three more are offered as alternatives.
 * Returns async (buffer) -> { text, confidence } ("" and 0 when nothing was recognised).
 * A refusal (for example missing permission) throws with Google's own message.
 */
export function speechTranscriber({ languages, token, fetchImpl = fetch, sampleRate = 16000 }) {
  return async (buffer) => {
    const res = await fetchImpl(SPEECH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          encoding: 'OGG_OPUS', sampleRateHertz: sampleRate, languageCode: languages[0],
          alternativeLanguageCodes: languages.slice(1, 4), enableAutomaticPunctuation: true,
        },
        audio: { content: Buffer.from(buffer).toString('base64') },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`speech answered ${res.status}: ${body.error?.message || 'no message'}`);
    const parts = (body.results || []).map((r) => r.alternatives?.[0]).filter((a) => a?.transcript);
    if (!parts.length) return { text: '', confidence: 0 };
    const confidences = parts.map((a) => (typeof a.confidence === 'number' ? a.confidence : 0));
    return { text: parts.map((a) => a.transcript.trim()).join(' ').trim(), confidence: Math.min(...confidences) };
  };
}

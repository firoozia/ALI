// Which incoming WhatsApp messages are worth handling, and why the others are not. Every refusal has a reason that
// goes to the log, so a message that "vanished" can always be explained.

const toSeconds = (t) => Number(typeof t === 'object' && t !== null && 'low' in t ? t.low : t) || 0;

/**
 * [type]: 'notify' (live) or 'append' (sync of earlier messages, or a message sent from the owner's phone).
 * [seen]: a Set of message ids already handled (filled here). Returns { ok: true } or { ok: false, reason }.
 * Live messages always pass. An 'append' passes only when it is fresh (at most [freshSeconds] old), so a restart
 * never answers old history but a message the owner just typed on the bot phone is not lost.
 */
export function shouldProcess({ type, raw, seen, now = Date.now(), freshSeconds = 90 }) {
  const id = raw?.key?.id;
  if (id && seen.has(id)) return { ok: false, reason: 'duplicate' };
  if (!raw?.message) {
    const stub = raw?.messageStubType ? ` (stub ${raw.messageStubType})` : '';
    return { ok: false, reason: `no content: could not be decrypted, probably no session key yet; WhatsApp resends it${stub}` };
  }
  if (type !== 'notify') {
    const age = now / 1000 - toSeconds(raw.messageTimestamp);
    if (!(age >= -5 && age <= freshSeconds)) return { ok: false, reason: `old message of type ${type}` };
  }
  if (id) {
    seen.add(id);
    if (seen.size > 2000) seen.delete(seen.values().next().value);
  }
  return { ok: true };
}

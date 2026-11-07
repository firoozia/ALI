import fs from 'node:fs';
import path from 'node:path';

// Which incoming WhatsApp messages are worth handling, and why the others are not. Every refusal has a reason that
// goes to the log, so a message that "vanished" can always be explained.

const toSeconds = (t) => Number(typeof t === 'object' && t !== null && 'low' in t ? t.low : t) || 0;

/**
 * [type]: 'notify' (live) or 'append' (sync of earlier messages, or a message sent from the owner's phone).
 * [seen]: a Set of message ids already handled (filled here). Returns { ok: true } or { ok: false, reason }.
 * Live messages always pass. An 'append' passes only when it is fresh (at most [freshSeconds] old), so a restart
 * never answers old history but a message the owner just typed on the bot phone is not lost.
 */
/** The ids of the owner's own private messages already taken in, kept in a file so a restart neither drops a late one nor answers one twice. */
export class OwnerSeen {
  constructor(file = '', max = 1000) { this.file = file; this.max = max; this.ids = []; try { if (file) this.ids = JSON.parse(fs.readFileSync(file, 'utf8')).ids || []; } catch { /* none yet */ } this.set = new Set(this.ids); }
  has(id) { return this.set.has(id); }
  add(id) {
    if (!id || this.set.has(id)) return;
    this.set.add(id); this.ids.push(id);
    if (this.ids.length > this.max) this.set.delete(this.ids.shift());
    if (this.file) { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ ids: this.ids }), { mode: 0o600 }); } catch { /* best effort */ } }
  }
}

/**
 * The owner's own messages in a private chat (typed on the bot phone, so fromMe) are special: one that arrives while the bot is still starting
 * (a sync of earlier messages, 'append') is taken if it is at most [ownerLateSeconds] old and was not taken before; and one taken before
 * (kept in [ownerSeen] on disk) is never taken twice, even after a restart.
 */
export function shouldProcess({ type, raw, seen, now = Date.now(), freshSeconds = 90, ownerSeen = null, ownerLateSeconds = 1800 }) {
  const id = raw?.key?.id;
  if (id && seen.has(id)) return { ok: false, reason: 'duplicate' };
  const ownerPrivate = !!(ownerSeen && id && raw?.key?.fromMe && !String(raw?.key?.remoteJid || '').endsWith('@g.us'));
  if (ownerPrivate && ownerSeen.has(id)) return { ok: false, reason: 'duplicate (taken before a restart)' };
  if (!raw?.message) {
    const stub = raw?.messageStubType ? ` (stub ${raw.messageStubType})` : '';
    return { ok: false, reason: `no content: could not be decrypted, probably no session key yet; WhatsApp resends it${stub}` };
  }
  if (type !== 'notify') {
    const age = now / 1000 - toSeconds(raw.messageTimestamp);
    const late = ownerPrivate && age >= -5 && age <= ownerLateSeconds;
    if (!(age >= -5 && age <= freshSeconds) && !late) return { ok: false, reason: `old message of type ${type}` };
  }
  if (ownerPrivate) ownerSeen.add(id);
  if (id) {
    seen.add(id);
    if (seen.size > 2000) seen.delete(seen.values().next().value);
  }
  return { ok: true };
}

// One greeting to the bot's own number, so the owner can see it is alive. Sent once per value of HELLO_ONCE
// (change the value in the VM metadata to send it again). It goes to the bot's own number only.

import fs from 'node:fs';
import path from 'node:path';

export const HELLO_TEXT = 'سلام! دستیار آریاک روشن است و کار می‌کند ✅';

/** The bot's own chat from PAIR_PHONE digits, nothing else. */
export const ownJid = (phone) => {
  const d = String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
  return d ? `${d}@s.whatsapp.net` : '';
};

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no answer in ${ms / 1000} s`)), ms))]);

/**
 * Sends the greeting when [value] is set and differs from the last one sent (remembered in [dir]).
 * [jid] is the account's own chat as the socket knows it; [phone] is the fallback. [send](jid, text) does the
 * sending, and the value is stored only after it worked. Every outcome is logged through [log].
 */
export async function helloOnce({ value, phone, jid: given, dir, send, log = () => {}, timeoutMs = 30000 }) {
  const jid = given || ownJid(phone);
  if (!value) { log('greeting: HELLO_ONCE is empty, nothing to send'); return false; }
  if (!jid) { log('greeting: no own number (PAIR_PHONE and socket user are empty)'); return false; }
  const file = path.join(dir, 'hello.txt');
  let last = '';
  try { last = fs.readFileSync(file, 'utf8'); } catch { /* never sent */ }
  if (last === value) { log('greeting: already sent for this HELLO_ONCE value'); return false; }
  log(`greeting: sending to ${jid}`);
  await withTimeout(send(jid, HELLO_TEXT), timeoutMs);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, value);
  log('greeting: sent');
  return true;
}

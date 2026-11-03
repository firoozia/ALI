// One greeting to the bot's own number, so the owner can see it is alive. Sent once per value of HELLO_ONCE
// (change the value in the VM metadata to send it again). It goes to the bot's own number only.

import fs from 'node:fs';
import path from 'node:path';

export const HELLO_TEXT = 'سلام! دستیار آریاک روشن است و کار می‌کند ✅';

/** The bot's own chat: PAIR_PHONE digits, nothing else. */
export const ownJid = (phone) => {
  const d = String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
  return d ? `${d}@s.whatsapp.net` : '';
};

/**
 * Sends the greeting when [value] is set and differs from the last one sent (remembered in [dir]).
 * [send](jid, text) does the sending; the value is stored only after it worked.
 */
export async function helloOnce({ value, phone, dir, send }) {
  const jid = ownJid(phone);
  if (!value || !jid) return false;
  const file = path.join(dir, 'hello.txt');
  let last = '';
  try { last = fs.readFileSync(file, 'utf8'); } catch { /* never sent */ }
  if (last === value) return false;
  await send(jid, HELLO_TEXT);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, value);
  return true;
}

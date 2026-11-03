// Linking the bot's number: one pairing code per socket, asked only once the socket is ready (its first "qr"
// event), never on a timer. A new code invalidates the old one, so a restart loop would make every code useless.

import fs from 'node:fs';

/** The number as WhatsApp wants it: digits only, country code first, no "+" or leading zeros. */
export const pairDigits = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');

/**
 * Returns a function to call on every "qr" event of ONE socket. It asks for a pairing code the first time only
 * and only while the login is not registered. [request](digits) -> code; [show](code) prints it.
 */
export function pairingOnce({ registered, phone, request, show, log = () => {} }) {
  let asked = false;
  return async function onQr() {
    const digits = pairDigits(phone);
    if (asked || registered() || !digits) return false;
    asked = true;
    try {
      show(await request(digits));
      return true;
    } catch (e) {
      log(`pairing code failed: ${e?.message || e}`);
      return false;
    }
  };
}

/** Empties the auth folder (a stale or half-made login) but keeps the folder itself. */
export function clearAuth(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) fs.rmSync(`${dir}/${f}`, { recursive: true, force: true });
}

/** What to do when WhatsApp closes the connection. */
export function afterClose({ loggedOut, registered }) {
  if (!loggedOut) return 'reconnect';
  // Logged out while never paired: the saved login is stale; wipe it once and wait for a pairing code.
  return registered ? 'relink-needed' : 'reset-and-wait';
}

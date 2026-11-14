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

/** The WhatsApp login files in the top level of the auth folder; the same folder also holds all the app's data, which is never touched. */
export const LOGIN_FILE = /^(?:creds\.json|bot\.lock|(?:session|pre-key|sender-key|app-state-sync-key|app-state-sync-version|lid-mapping|device-list|identity-key|tctoken)[-_.].*)$/;

/** Removes ONLY the WhatsApp login files (top level of the folder, plain files): never a sub-folder and never any other file (expenses, tracker, tokens ... live there too). Returns the names removed. */
export function clearAuth(dir) {
  if (!fs.existsSync(dir)) return [];
  const gone = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !LOGIN_FILE.test(entry.name)) continue;
    fs.rmSync(`${dir}/${entry.name}`, { force: true }); gone.push(entry.name);
  }
  return gone;
}

/** What to do when WhatsApp closes the connection. */
export function afterClose({ loggedOut, registered }) {
  if (!loggedOut) return 'reconnect';
  // Logged out while never paired: the saved login is stale; wipe it once and wait for a pairing code.
  return registered ? 'relink-needed' : 'reset-and-wait';
}

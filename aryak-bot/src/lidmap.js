// A WhatsApp sender can be a «lid» (an opaque id) instead of the phone number. Baileys keeps the pairs in its auth folder as files
// («lid-mapping-<lid>_reverse.json» holds the phone number of a lid). This reads them, so a person the owner authorized by phone number is also
// recognised when WhatsApp shows only the lid. Read only; a missing or odd file is simply no answer.

import fs from 'node:fs';
import path from 'node:path';

const digitsOf = (jid) => String(jid || '').replace(/@.*$/, '').replace(/:\d+$/, '').replace(/\D/g, '');

/** The phone jid of a lid jid from the auth folder, or ''. */
export function phoneOfLid(authDir, lidJid) {
  const lid = digitsOf(lidJid);
  if (!authDir || !lid || !String(lidJid).endsWith('@lid')) return '';
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(authDir, `lid-mapping-${lid}_reverse.json`), 'utf8'));
    const pn = digitsOf(typeof raw === 'string' ? raw : raw?.pn || raw?.phone || '');
    return pn.length >= 8 ? `${pn}@s.whatsapp.net` : '';
  } catch { return ''; }
}

/** A lid -> phone lookup that first asks [base] (a Map from the group's own data) and then the auth folder. */
export const lidLookup = (authDir, base = null) => ({ get: (jid) => base?.get?.(jid) || phoneOfLid(authDir, jid) || undefined });

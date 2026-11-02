// Hand-over tags. The model ends a message with [TAG:sales], [TAG:accounts], [TAG:logistics], [TAG:complaints]
// or [TAG:team]; they become real WhatsApp mentions of the colleagues set for that topic.

const TAG = /\[TAG:([a-z]+)\]/gi;

/** Digits of a phone number or JID: "+971 50 123 4567" and "971501234567@s.whatsapp.net" give the same. */
export const digits = (s) => String(s || '').split('@')[0].split(':')[0].replace(/\D/g, '');

/**
 * [team]: { sales: ["9715..."], accounts: [...], logistics: [...], complaints: [...], team: [...] }.
 * A topic with nobody set falls back to "team".
 */
export function applyTags(text, team = {}) {
  const numbers = new Set();
  const body = String(text || '').replace(TAG, (_, topic) => {
    const list = team[topic.toLowerCase()]?.length ? team[topic.toLowerCase()] : team.team || [];
    list.forEach((n) => numbers.add(digits(n)));
    return '';
  }).trim();
  const mentioned = [...numbers].filter(Boolean);
  return {
    text: mentioned.length ? `${body}\n${mentioned.map((n) => '@' + n).join(' ')}` : body,
    mentions: mentioned.map((n) => `${n}@s.whatsapp.net`),
  };
}

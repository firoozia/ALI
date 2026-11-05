// A follow-up with no code ("how much meters you have") after a code was discussed in the same group a moment ago: the customer means that
// code. The recent codes of the group are put in front of the model as context, so she answers from the sheet instead of asking for the code.
// One recent code: she is told it is that code. Several: she is told to ask which one. Only context is added; every rule about stock stays
// as it is (never a quantity, a minimum or a reserved figure to a customer).

const CODE = /(?:^|[^\d.])(\d{2,5})(?![\d.]*\d)(?:[^\d]|$)/g;
const FOLLOW = /\b(?:how\s+(?:much|many)|meters?|metres?|mtrs?|mtr|avail\w*|have|stock|left|enough|any|more|need|want)\b|چقدر|چند\s*متر|چندتا|موجود|دارید|دارین|کافی|متر|كم|كمية|عندكم|متوفر/iu;

/** The codes written in a text, as written (digits). */
export const codesIn = (text) => [...String(text || '').matchAll(CODE)].map((m) => m[1]);

/** The context line for one message, or ''. [codes]: the codes of this group in the last half hour, oldest first. */
export function followUpHint(text, codes) {
  const s = String(text || '').trim();
  const list = [...new Set(codes || [])];
  if (!s || s.length > 140 || !list.length || codesIn(s).length || !FOLLOW.test(s)) return '';
  if (list.length === 1) return `[Context from this group: the code being discussed a moment ago is ${list[0]}. This message has no code, so it is about code ${list[0]}.]`;
  return `[Context from this group: codes discussed a moment ago: ${list.slice(-5).join(', ')}. This message has no code: ask which one.]`;
}

/** The messages for the model, a follow-up with no code carrying the context. Codes written earlier in the same batch count as recent. */
export function withFollowUp(messages, recent) {
  const seen = [...(recent || [])];
  return messages.map((m) => {
    const hint = m.text ? followUpHint(m.text, seen) : '';
    if (m.text) seen.push(...codesIn(m.text));
    return hint ? { ...m, text: `${m.text}\n${hint}` } : m;
  });
}

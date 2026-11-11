// What may leave in a message: a placeholder that was never resolved ("@[number]", "[TAG:sales]") is never sent. A real mention is
// written as "@" plus the digits and carried in the mentions list by tags.js; anything else in the shape "@[...]" is a leftover.

const UNRESOLVED = /\s*@\[[^\]\n]{0,40}\]|\s*\[TAG:[a-z]+\]/gi;

/**
 * Her name has ONE spelling: «Atossa» in a Latin text, «آتوسا» in a Persian one (a morning greeting or a sign-off was seen as Atoosa, Atousa and آتوسا). A sign-off in Persian letters
 * under an otherwise Latin text becomes «Atossa».
 */
export function oneSpelling(text) {
  let out = String(text ?? '').replace(/(?<![A-Za-z])At(?:oo|ou|o|u|os)sa(?![A-Za-z])/gi, 'Atossa');
  out = out.replace(/(?<![؀-ۿ])اتوسا(?![؀-ۿ])/g, 'آتوسا');
  if (!/[؀-ۿ]/.test(out.replace(/آتوسا/g, ''))) out = out.replace(/(?<![؀-ۿ])آتوسا(?![؀-ۿ])/g, 'Atossa');
  return out;
}

/** The text without unresolved placeholders; [changed] says whether something was removed. */
export function cleanOutgoing(text) {
  const before = String(text ?? '');
  const out = oneSpelling(before.replace(UNRESOLVED, '')).replace(/[ \t]+\n/g, '\n').trim();
  return { text: out, changed: out !== before.trim() };
}

/** True when the text still holds an unresolved placeholder (used by the tests). */
export const hasPlaceholder = (text) => /@\[[^\]\n]{0,40}\]|\[TAG:[a-z]+\]/i.test(String(text ?? ''));

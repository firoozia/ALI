// What may leave in a message: a placeholder that was never resolved ("@[number]", "[TAG:sales]") is never sent. A real mention is
// written as "@" plus the digits and carried in the mentions list by tags.js; anything else in the shape "@[...]" is a leftover.

const UNRESOLVED = /\s*@\[[^\]\n]{0,40}\]|\s*\[TAG:[a-z]+\]/gi;

/** The text without unresolved placeholders; [changed] says whether something was removed. */
export function cleanOutgoing(text) {
  const before = String(text ?? '');
  const out = before.replace(UNRESOLVED, '').replace(/[ \t]+\n/g, '\n').trim();
  return { text: out, changed: out !== before.trim() };
}

/** True when the text still holds an unresolved placeholder (used by the tests). */
export const hasPlaceholder = (text) => /@\[[^\]\n]{0,40}\]|\[TAG:[a-z]+\]/i.test(String(text ?? ''));

// The assistant's name at the START of a message («Atossa received today», «atusa, cash box», «آتوسا: صندوق»): taken off before a command is read, so every command of the owner works the same with or
// without it. A message that is only her name, or her name inside a sentence, is left alone.
const LEAD = /^\s*[*_~>"'«(\[]*(?:atossa|atosa|atousa|atoosa|atusa|آتوسا|اتوسا)\s*[,،:;!\-–]*\s+(?=\S)/iu;

/** The text without a leading «Atossa» (any case, an optional comma / colon after it); the same text when there is none. */
export const stripBotName = (text) => String(text || '').replace(LEAD, '');

/** A command reader that also works with the assistant's name in front: the text as written first (some readers need the name), then without it when the first reading found nothing. */
export const nameFallback = (read) => (text, ...rest) => {
  const direct = read(text, ...rest);
  if (direct) return direct;
  const bare = stripBotName(text);
  return bare !== text ? read(bare, ...rest) : direct;
};

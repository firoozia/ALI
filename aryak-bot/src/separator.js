// The one separator of every WhatsApp report that lists several customers or items: a bold line between the blocks (never before the first or after the
// last), so the entries are easy to tell apart on a phone. About 18 heavy box characters fit a phone width without wrapping. Every report formatter uses this.

export const SEP = '\u2501'.repeat(18);

/** [blocks] (strings) joined by a separator line; empty blocks are dropped; one block gets none. */
export const withSeparators = (blocks) => blocks.filter((b) => b !== '' && b !== null && b !== undefined).join(`\n${SEP}\n`);

/** The entries, then the closing line(s) of the report («+N more», the footer, the reply hint): with two or more entries the closing lines are set apart by the same line, so they do not look like part of the last entry. */
export const withEnd = (blocks, closing = []) => {
  const body = withSeparators(blocks); const end = closing.filter(Boolean);
  if (!end.length) return body;
  if (!body) return end.join('\n');
  return `${body}${blocks.filter((b) => b !== '' && b !== null && b !== undefined).length >= 2 ? `\n${SEP}\n` : '\n'}${end.join('\n')}`;
};

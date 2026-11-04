// What a WhatsApp message carries, seen the way the assistant needs it.

/**
 * The picture of a message, or null. A photo is an imageMessage; a picture sent as a "document" (the file picker's
 * other choice) is a documentMessage whose type is image/*. Both are read the same way.
 */
export function imageOf(content) {
  if (content?.imageMessage) return content.imageMessage;
  const doc = content?.documentMessage;
  if (doc && /^image\//i.test(String(doc.mimetype || ''))) return { ...doc, caption: doc.caption || '' };
  return null;
}

const QUIET = new Set(['protocolMessage', 'reactionMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'pollUpdateMessage']);

/** The kind of a message that carries nothing we read (for the log, never its content); '' for the quiet ones. */
export function ignoredKind(content) {
  const kinds = Object.keys(content || {}).filter((k) => !QUIET.has(k));
  return kinds[0] || '';
}

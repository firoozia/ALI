// Where a photo or a voice note may cost money. In the cut, delivery, confirmation, information and invoices groups (and the goods
// groups) a picture or a voice note is NEVER read by itself: no download, no vision, no speech, no model. Only the free caption
// reader runs on text and captions. The exceptions: a message that addresses her by name (or answers her), and the invoice PDFs of
// the Invoices group, which have their own flow. The test group, the command group and private staff chats are not quiet.

/** May this photo or voice note be downloaded and read (paid)? [group]: { quiet } of the chat; [addressed]: she is called or answered. */
export function mayReadMedia({ group, addressed, voiceFromPermitted = false }) {
  if (!group?.quiet) return true;
  return !!addressed || !!voiceFromPermitted; // a voice cannot say her name before it is heard: the owner's and a permitted person's voice is transcribed (cheap); it is acted on only if it names her
}

/** May a receipt (an expense photo, a payment receipt) be read by the vision model? Its own switch (RECEIPT_VISION, on by default), apart from the tracker's. */
export function mayReadReceipts(config) {
  return config.receiptVision !== false;
}

/** May the tracker send a photo or an unreadable caption to the model? Only when TRACK_MODEL is on. */
export function mayTrackWithModel(config) {
  return !!config.trackModel;
}

/** The quiet groups, by the words of their configured names (goods groups reach no chat flow, so they only need the tracker rule). */
export function quietWords(config) {
  return [config.invoiceGroupName, config.infoGroupName, config.cutGroupName, config.deliveryGroupName, config.confirmGroupName].filter(Boolean);
}

export const isQuietSubject = (subject, config) => quietWords(config).some((w) => String(subject || '').toLowerCase().includes(w));

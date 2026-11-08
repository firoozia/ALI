// Two small helpers of the photo and voice question flow, kept apart so they can be tested: delivering a reply (never lost silently) and finding the
// customer in a photo's caption.

/**
 * Sends [content] to [chatId], first as a reply to [quoted] and, when that does not go through (an error, or nothing came back: a forwarded picture as the
 * quote can fail), once more as a plain message. Returns { ok, result, quotedFailed } and says in [log] what really happened. Throws only when BOTH fail by error.
 */
export async function deliver({ send, chatId, content, quoted, log = () => {}, where = '' }) {
  let result; let quotedFailed = false;
  try { result = await send(chatId, content, { quoted }); } catch (e) { quotedFailed = true; log(`reply (quoted) to ${where} failed: ${e.message}`); }
  if (!result?.key?.id) {
    quotedFailed = true;
    try { result = await send(chatId, content); } catch (e) { log(`reply (plain) to ${where} failed: ${e.message}`); throw e; }
  }
  const ok = !!result?.key?.id;
  log(ok ? `reply to ${where} delivered${quotedFailed ? ' (without the quote)' : ''}` : `reply to ${where} NOT delivered (the send returned nothing)`);
  return { ok, result, quotedFailed };
}

/**
 * A caption that is only a customer's name ("Nuqoosh") gives the customer of the order: looked up in the approved list, then in QuickBooks (short names
 * as in invoices). '' when the caption is not a name or nothing matches. [lookups]: { canon, rowOfName, resolveLoose }. Never throws.
 */
export async function captionCustomerName(text, { canon, rowOfName, resolveLoose }) {
  const t = String(text || '').trim();
  if (t.length < 2 || t.length > 40 || /\d|[=:?؟]/.test(t) || t.split(/\s+/).length > 4) return '';
  try { const c = canon(t); if (c && rowOfName(c)) return c; } catch { /* next source */ }
  try { const r = await resolveLoose(t); if (r?.id) return r.name || r.ours || ''; } catch { /* QuickBooks not reachable */ }
  try { const r = rowOfName(t); if (r?.customer) return r.customer; } catch { /* none */ }
  return '';
}

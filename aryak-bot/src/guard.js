// The one outgoing guard. Every message the program sends goes through the same send function; this decides, in one place,
// whether the destination may be written to, whatever feature asked for it:
//  - a group: only a test group, an internal group (staff, command, invoice, information, cut, delivery, confirmation, goods)
//    or a group of the good-morning list. A customer group is never written to (unless ALLOW_CUSTOMER_GROUP_SENDS is on);
//  - a private chat: only staff, an administrator, the sales manager, the account itself, or a chat a staff member started.
// And the rule that finds the customer groups to WATCH (read only): matching words, minus every internal group.

const low = (s) => String(s || '').trim().toLowerCase();
const digits = (j) => String(j || '').replace(/@.*$/, '').replace(/:\d+$/, '').replace(/\D/g, '');

/** The words of every internal or configured group (a group whose name holds one of them is not a customer group). */
export function internalWords(config) {
  return [
    ...(config.staffGroupNames || []), ...(config.commandGroupNames || []), ...(config.testGroupNames || []), ...(config.goodsGroupNames || []),
    config.invoiceGroupName, config.infoGroupName, config.cutGroupName, config.deliveryGroupName, config.confirmGroupName,
    ...(config.observeExcludeNames || []),
  ].map(low).filter(Boolean);
}

const holds = (subject, words) => words.some((w) => low(subject).includes(w));

/** { ok, why }: may the assistant write into the group with this name? */
export function groupAllowed(subject, config) {
  if (holds(subject, (config.testGroupNames || []).map(low).filter(Boolean))) return { ok: true, why: 'test group' };
  if (holds(subject, [...(config.staffGroupNames || []), ...(config.commandGroupNames || []), ...(config.goodsGroupNames || []),
    config.invoiceGroupName, config.infoGroupName, config.cutGroupName, config.deliveryGroupName, config.confirmGroupName].map(low).filter(Boolean))) return { ok: true, why: 'internal group' };
  if (holds(subject, (config.morningGroupNames || []).map(low).filter(Boolean))) return { ok: true, why: 'good-morning list' };
  if (config.allowCustomerGroupSends) return { ok: true, why: 'customer sends switched on' };
  return { ok: false, why: 'customer or unknown group' };
}

/** May the assistant write to this private chat? [known]: chats a staff member started (they are staff by construction). */
export function privateAllowed(jid, config, known = new Set(), ownIds = []) {
  if (known.has(jid)) return true;
  const d = digits(jid);
  if (!d) return false;
  const staff = [...(config.staffNumbers || []), ...(config.adminNumbers || []), ...(config.ownerNumbers || []), config.salesManager, ...ownIds].map(digits).filter(Boolean);
  return staff.includes(d);
}

/** The groups to watch (read only): a name that holds an observe word and no internal or excluded word. */
export function observedGroup(subject, config) {
  const words = (config.observeGroupNames || []).map(low).filter(Boolean);
  return !!words.length && holds(subject, words) && !holds(subject, internalWords(config));
}

/** The customer groups in SHADOW mode (the answers she would give go to the test group): same rule, own words. */
export function shadowGroup(subject, config) {
  const words = (config.shadowGroupNames || []).map(low).filter(Boolean);
  return !!words.length && holds(subject, words) && !holds(subject, internalWords(config));
}

/**
 * The send function with the guard in front of it. [rawSend](...args), [subjectOf](jid) -> the group name (may be async),
 * [isGroup](jid), [known]: staff chats, [log](text). A blocked send returns undefined and is logged by name only.
 */
export function guardedSend({ rawSend, config, subjectOf, isGroup, known, ownIds = () => [], oneShot = null, log = () => {} }) {
  return async (...args) => {
    const jid = args[0];
    if (isGroup(jid)) {
      let subject = '';
      try { subject = (await subjectOf(jid)) || ''; } catch { /* unknown group: blocked below */ }
      const v = subject ? groupAllowed(subject, config) : { ok: false, why: 'unknown group' };
      // The only exception: a one-shot token for exactly this group and this exact PDF message, made by the owner's approved flow.
      if (!v.ok && subject && oneShot?.consume(jid, args[1])) { log(`owner invoice send: one-shot token used for group "${subject}"`); return rawSend(...args); }
      if (!v.ok) { log(`blocked: no message to group "${subject || 'unknown'}" (${v.why})`); return undefined; }
    } else if (!privateAllowed(jid, config, known, ownIds())) {
      // the same one-shot token (the owner's yes on a statement for a person who is not staff): this chat, this exact PDF
      if (oneShot?.consume(jid, args[1])) { log('owner statement send: one-shot token used for a private chat'); return rawSend(...args); }
      log('blocked: no message to a private chat that is not staff');
      return undefined;
    }
    return rawSend(...args);
  };
}

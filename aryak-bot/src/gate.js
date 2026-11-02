// When the assistant may answer in a group: only customer messages, and only if no colleague replied
// within the waiting time. Messages a customer sends while the bot waits are answered together.

import { digits } from './tags.js';

export class GroupGate {
  /**
   * [isStaff](message) -> true | false | null (null: cannot tell who sent it; such messages are never answered).
   * [answer]({ groupId, messages, transcript }) is called when the wait ends with nobody from the team replying.
   */
  constructor({ waitMs, isStaff, answer, setTimer = setTimeout, clearTimer = clearTimeout, keep = 20, log = () => {} }) {
    Object.assign(this, { waitMs, isStaff, answer, setTimer, clearTimer, keep, log });
    this.pending = new Map(); // groupId -> { messages, timer }
    this.transcripts = new Map(); // groupId -> recent lines, oldest first
  }

  /** [m]: { groupId, senderName, text, hasImage, fromMe, ... } in the order WhatsApp delivered them. */
  onMessage(m) {
    const staff = m.fromMe ? true : this.isStaff(m);
    const who = m.fromMe ? 'ARYAK Assistant' : staff ? `Staff ${m.senderName || ''}`.trim() : `Customer ${m.senderName || ''}`.trim();
    const line = `[${who}] ${m.text || ''}${m.hasImage ? ' (photo)' : ''}`.trim();
    const lines = this.transcripts.get(m.groupId) || [];
    const before = lines.slice();
    lines.push(line);
    this.transcripts.set(m.groupId, lines.slice(-this.keep));

    if (m.fromMe) return 'own';
    if (staff === null) { this.log(`unknown sender in ${m.groupId}, not answered`); return 'unknown'; }
    if (staff) {
      // A colleague is on it: drop what was waiting.
      const p = this.pending.get(m.groupId);
      if (p) { this.clearTimer(p.timer); this.pending.delete(m.groupId); return 'staff-replied'; }
      return 'staff';
    }
    let p = this.pending.get(m.groupId);
    if (!p) {
      p = { messages: [], transcript: before, timer: null };
      p.timer = this.setTimer(() => this.fire(m.groupId), this.waitMs);
      this.pending.set(m.groupId, p);
    }
    p.messages.push(m);
    return 'waiting';
  }

  async fire(groupId) {
    const p = this.pending.get(groupId);
    if (!p) return;
    this.pending.delete(groupId);
    try {
      await this.answer({ groupId, messages: p.messages, transcript: p.transcript });
    } catch (e) {
      this.log(`answer failed in ${groupId}: ${e?.message || e}`);
    }
  }
}

/** Staff check from configured numbers; [lidToPhone] maps "...@lid" ids to phone JIDs from group metadata. */
export function staffChecker(staffNumbers, lidToPhone = new Map()) {
  const staff = new Set(staffNumbers.map(digits).filter(Boolean));
  return (m) => {
    const candidates = [m.senderAlt, m.sender, lidToPhone.get(m.sender)].filter((j) => j && !String(j).endsWith('@lid'));
    if (!candidates.length) return null;
    return candidates.some((j) => staff.has(digits(j)));
  };
}

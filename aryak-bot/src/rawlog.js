// The RAW messages of the groups, as WhatsApp delivered them, with their later edits and deletions: text, caption, file name, the id of the message each one quotes, sender and time. Nothing derived
// is kept here. A report is judged from these (and from the owner's own explicit answers), so a rule that changes later applies to old messages too. WhatsApp cannot be asked for older history
// on demand: only what arrived while the program ran (and what the history sync gave at the start) is here.
import fs from 'node:fs';
import path from 'node:path';

export class RawLog {
  constructor(dir = '', now = () => Date.now()) { this.dir = dir; this.now = now; this.mem = []; }

  fileOf(at) { return path.join(this.dir, 'raw-' + new Date(at).toISOString().slice(0, 7) + '.jsonl'); }

  /** One line: { t: 'msg' | 'edit' | 'revoke', id, chat, at, ... }. Never throws. */
  add(entry) {
    const e = { at: this.now(), ...entry };
    if (!this.dir) { this.mem.push(e); return e; }
    try { fs.mkdirSync(this.dir, { recursive: true }); fs.appendFileSync(this.fileOf(e.at), JSON.stringify(e) + '\n', { mode: 0o600 }); } catch { /* best effort */ }
    return e;
  }

  /** Every entry since [since] (ms), oldest first. */
  entries(since = 0) {
    if (!this.dir) return this.mem.filter((e) => e.at >= since);
    const out = [];
    try {
      for (const f of fs.readdirSync(this.dir).filter((x) => /^raw-\d{4}-\d{2}\.jsonl$/.test(x)).sort()) {
        for (const line of fs.readFileSync(path.join(this.dir, f), 'utf8').split('\n')) {
          if (!line) continue;
          try { const e = JSON.parse(line); if (e.at >= since) out.push(e); } catch { /* a torn line */ }
        }
      }
    } catch { /* none yet */ }
    return out;
  }

  /** The messages of a chat as they stand NOW: later edits applied, deleted ones gone. */
  messages(chat, since = 0) {
    const byId = new Map();
    for (const e of this.entries(0)) {
      if (chat && e.chat !== chat) continue;
      if (e.t === 'msg') byId.set(e.id, { ...e });
      else if (e.t === 'edit' && byId.has(e.id)) byId.set(e.id, { ...byId.get(e.id), text: e.text, caption: e.caption ?? byId.get(e.id).caption, edited: true });
      else if (e.t === 'revoke') byId.delete(e.id);
    }
    return [...byId.values()].filter((m) => m.at >= since).sort((a, b) => a.at - b.at);
  }
}

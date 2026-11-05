// THE WATCHED GROUPS, KEPT BY GROUP ID. The settings hold only name WORDS (SHADOW_GROUP_NAMES, OBSERVE_GROUP_NAMES); a group renamed on
// WhatsApp used to drop out of watching and of the owner's invoice send. Here every group that matches the words is remembered by its id
// (with its last name), and when its name changes the new name is added to the live words, so it stays watched. The owner can also add a
// group by its exact name (teaching). An internal group (staff, invoices, test ...) is never remembered: the words' own exclusion rule
// (shadowGroup / observedGroup) still decides, and this list only adds names to the words. Kept on disk under authDir, versioned.

import fs from 'node:fs';
import path from 'node:path';
import { groupAllowed, observedGroup, shadowGroup } from './guard.js';

const low = (s) => String(s || '').trim().toLowerCase();

export class WatchList {
  constructor(dir = '') {
    this.dir = dir;
    this.file = dir ? path.join(dir, 'watched-groups.json') : '';
    this.d = { version: 0, groups: {} }; // jid -> { subject, extra, at }
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first start */ }
  }

  save(now = new Date()) {
    if (!this.file) return;
    try {
      if (this.d.version > 0) {
        fs.mkdirSync(path.join(this.dir, 'watched-groups-history'), { recursive: true });
        fs.writeFileSync(path.join(this.dir, 'watched-groups-history', `watched-groups-v${this.d.version}.json`), fs.readFileSync(this.file));
      }
    } catch { /* best effort */ }
    this.d.version += 1;
    this.d.updatedAt = now.toISOString();
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d)); } catch { /* best effort */ }
  }

  get size() { return Object.keys(this.d.groups).length; }
  subjects() { return Object.values(this.d.groups).map((g) => g.subject); }

  /** The remembered names become live words (shadow and observe), so the group stays watched whatever it is called now. */
  applyTo(config) {
    for (const g of Object.values(this.d.groups)) {
      const w = low(g.subject);
      if (!w) continue;
      for (const key of ['shadowGroupNames', 'observeGroupNames']) if (Array.isArray(config[key]) && !config[key].includes(w)) config[key].push(w);
    }
  }

  /**
   * Called with every group the account is in ({ id, subject }): a group that matches the words now is remembered by its id; a remembered
   * group with a new name gets the new name. Returns the renames [{ from, to }]. [config] is changed (live words) and the file saved on a change.
   */
  sync(groups, config) {
    let changed = false;
    const renames = [];
    for (const g of groups) {
      if (!g.id || !g.subject) continue;
      const known = this.d.groups[g.id];
      if (known) {
        if (known.subject !== g.subject) { renames.push({ from: known.subject, to: g.subject }); known.subject = g.subject; changed = true; }
      } else if (shadowGroup(g.subject, config) || observedGroup(g.subject, config)) {
        this.d.groups[g.id] = { subject: g.subject, extra: false, at: new Date().toISOString() };
        changed = true;
      }
    }
    if (changed) { this.save(); this.applyTo(config); }
    return renames;
  }

  /** WhatsApp says a group was renamed. */
  rename(jid, subject, config) {
    const known = this.d.groups[jid];
    if (!known || !subject || known.subject === subject) return false;
    known.subject = subject;
    this.save();
    this.applyTo(config);
    return true;
  }

  /** The owner adds a group by its exact name. Never an internal or test group. { ok } or { ok: false, why }. */
  addExtra(group, config) {
    const why = groupAllowed(group.subject, config).why;
    if (['internal group', 'test group'].includes(why)) return { ok: false, why: 'internal' };
    if (this.d.groups[group.id]) { this.d.groups[group.id].subject = group.subject; this.d.groups[group.id].extra = true; } else this.d.groups[group.id] = { subject: group.subject, extra: true, at: new Date().toISOString() };
    this.save();
    this.applyTo(config);
    return { ok: true };
  }

  /** Takes a taught group off the list (a group that matches the words by itself is remembered again at the next sync). */
  removeExtra(jid, config) {
    const g = this.d.groups[jid];
    if (!g?.extra) return false;
    delete this.d.groups[jid];
    this.save();
    const w = low(g.subject);
    for (const key of ['shadowGroupNames', 'observeGroupNames']) if (Array.isArray(config[key])) { const i = config[key].indexOf(w); if (i >= 0) config[key].splice(i, 1); }
    return true;
  }
}

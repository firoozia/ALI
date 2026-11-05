// Cost visibility: a count of the paid calls per group and per day (model, vision, speech), kept on disk, written to the log once a
// day and as one line in the daily summary with a rough cost. The prices are estimates, not an invoice.

import fs from 'node:fs';
import path from 'node:path';
import { localParts } from './morning.js';

/** Rough cost of one call in US dollars (set by the environment when the real prices are known). */
export const COST = { model: 0.01, vision: 0.012, speech: 0.016 };

export class UsageMeter {
  constructor(dir = '', { timeZone = 'Asia/Dubai', now = () => Date.now(), cost = COST } = {}) {
    this.file = dir ? path.join(dir, 'usage.json') : '';
    Object.assign(this, { timeZone, now, cost });
    this.days = {}; // day -> { group: { model, vision, speech, notRead } }
    try { if (this.file) this.days = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first start */ }
    this.dirty = false;
  }

  day() { return localParts(this.now(), this.timeZone).day; }

  /** kind: 'model' | 'vision' | 'speech' | 'notRead' (a caption the free reader could not read; nothing was spent). */
  count(group, kind, n = 1) {
    const d = (this.days[this.day()] ||= {});
    const g = (d[group || '-'] ||= { model: 0, vision: 0, speech: 0, notRead: 0 });
    g[kind] = (g[kind] || 0) + n;
    this.dirty = true;
  }

  totals(day = this.day()) {
    const t = { model: 0, vision: 0, speech: 0, notRead: 0 };
    for (const g of Object.values(this.days[day] || {})) for (const k of Object.keys(t)) t[k] += g[k] || 0;
    return t;
  }

  usd(t) { return t.model * this.cost.model + t.vision * this.cost.vision + t.speech * this.cost.speech; }

  save() {
    if (!this.file || !this.dirty) return;
    const keep = Object.keys(this.days).sort().slice(-30);
    this.days = Object.fromEntries(keep.map((k) => [k, this.days[k]]));
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.days)); this.dirty = false; } catch { /* best effort */ }
  }

  /** One log line per group for the day (counts only). */
  logLines(day = this.day()) {
    return Object.entries(this.days[day] || {}).map(([g, v]) => `paid calls ${day} "${g}": model ${v.model}, vision ${v.vision}, speech ${v.speech}, captions not read ${v.notRead}`);
  }

  /** The one line for the daily summary. */
  line(day = this.day()) {
    const t = this.totals(day);
    if (!t.model && !t.vision && !t.speech && !t.notRead) return '';
    return `- Paid calls today: model ${t.model}, vision ${t.vision}, speech ${t.speech}; about USD ${this.usd(t).toFixed(2)} (estimate)${t.notRead ? `; captions not read: ${t.notRead}` : ''}`;
  }
}

/** True when a request to the model carries a picture or a document (it costs more: vision). */
export function hasVisual(params) {
  return (params?.messages || []).some((m) => Array.isArray(m?.content) && m.content.some((b) => b && (b.type === 'image' || b.type === 'document')));
}

// «Needs your OK»: a posted payment whose nearest QuickBooks answer differs by more than 1.00 AED. The owner's yes accepts that pairing (it is only remembered here), his no refuses it; nothing is ever
// recorded in QuickBooks. The code is #G1, #G2 … (the same pairing keeps its code).
import fs from 'node:fs';
import path from 'node:path';

export class PayChecks {
  constructor(dir = '', now = () => Date.now()) {
    this.file = dir ? path.join(dir, 'qbo-pay-checks.json') : ''; this.now = now;
    this.d = { n: 0, items: {} };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ }
  }

  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  /** The code of this pairing (a payment entry and the candidate text); a new one when it is new. */
  codeFor(ref, text) {
    const known = Object.values(this.d.items).find((x) => x.ref === ref && x.text === text && x.status === 'open');
    if (known) return known.id;
    this.d.n += 1; const id = `G${this.d.n}`; this.d.items[id] = { id, ref, text, at: this.now(), status: 'open' }; this.save(); return id;
  }

  get(id) { return this.d.items[String(id).toUpperCase()] || null; }
  openIds() { return Object.values(this.d.items).filter((x) => x.status === 'open' && this.now() - x.at <= 3 * 24 * 3600 * 1000).map((x) => x.id); }
  close(id, status) { const x = this.get(id); if (x) { x.status = status; this.save(); } }
}

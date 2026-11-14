// Statements of ALL customers with an open account, for a period: the owner asks in his own chat, one preview lists them, his «1» (balance forward) or «2» (transaction statement)
// builds one PDF per customer and sends each to HIS OWN CHAT with a gap. Read only: nothing is written to QuickBooks, nothing goes to a customer group or the test group.
import fs from 'node:fs';
import path from 'node:path';

const TTL_MS = 30 * 60 * 1000;
export const MAX_CUSTOMERS = 80;
const fils = (n) => Math.round(Number(n || 0) * 100);
const money = (n) => (fils(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso) => String(iso).split('-').reverse().join('/');
const ALL_WORDS = /^(?:all|every(?:one|body)?|all\s+customers?|همه(?:\s+مشتری(?:‌?ها)?)?)$/iu;

/** The request «statement month 10 all», «statements month 10», «all statements 10/2026», «last month all», «صورت حساب ماه ۱۰ همه»: [sr] is what parseStatementRequest read of [text]. true = all customers. */
export function isAllRequest(sr, text) {
  if (!sr) return false;
  const customer = String(sr.customer || '').trim();
  if (ALL_WORDS.test(customer)) return true;
  return !customer && (/\bstatements\b/i.test(String(text || '')) || /همه/u.test(String(text || '')));
}

/**
 * The customers of the preview: those with at least one invoice dated in the period AND an open balance now (paid-up customers are left out).
 * [customers]: QuickBooks Customer rows ({ Id, DisplayName, Balance }); [invoices]: the Invoice rows of the period ({ CustomerRef, TotalAmt, Balance, TxnDate }).
 * Returns { rows: [{ id, name, invoiced, received, open }], total, more } with the biggest open balances first, at most [max].
 */
export function selectOpen({ customers, invoices, from, to, max = MAX_CUSTOMERS }) {
  const byId = new Map();
  for (const inv of invoices || []) {
    if (!(inv.TxnDate >= from && inv.TxnDate <= to)) continue;
    const id = String(inv.CustomerRef?.value || '');
    if (!id) continue;
    const row = byId.get(id) || { invoiced: 0, received: 0 };
    row.invoiced += fils(inv.TotalAmt); row.received += fils(inv.TotalAmt) - fils(inv.Balance); // what was paid of the invoices of the period
    byId.set(id, row);
  }
  const all = [];
  for (const c of customers || []) {
    const mine = byId.get(String(c.Id));
    if (!mine || !(fils(c.Balance) > 0) || c.Active === false) continue;
    all.push({ id: String(c.Id), name: c.DisplayName || c.CompanyName || '', invoiced: mine.invoiced / 100, received: mine.received / 100, open: fils(c.Balance) / 100 });
  }
  all.sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  const rows = all.slice(0, max);
  const sum = (k) => rows.reduce((n, r) => n + fils(r[k]), 0) / 100;
  return { rows, total: { invoiced: sum('invoiced'), received: sum('received'), open: sum('open') }, more: all.length - rows.length };
}

/** The preview the owner reads: the period, one line per customer, the totals and what 1 and 2 are. */
export function previewAllText({ id, from, to, rows, total, more = 0 }) {
  const head = `*Statements #${id}* ${dmy(from)} – ${dmy(to)} — ${rows.length} customers with an open account`;
  const lines = rows.map((r, i) => `${i + 1}. ${r.name} — invoiced ${money(r.invoiced)}, received ${money(r.received)}, open ${money(r.open)}`);
  return [head, ...lines, `Total — invoiced ${money(total.invoiced)}, received ${money(total.received)}, open ${money(total.open)}`, ...(more ? [`${more} more customers with an open account are not included (the limit is ${MAX_CUSTOMERS}).`] : []),
    `Reply 1 = Balance forward, 2 = Transaction statement (for all), or No (with #${id} when more than one waits)`].join('\n');
}

/** «1», «2», «1 #SA1», «#SA1 2», «no», «no #SA1»: { kind: 'style' | 'no', style, id } or null. */
export function parseAllReply(text) {
  const t = String(text || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).trim();
  let m = /^([12])\s*(?:#?\s*(SA\d+))?\s*[.!]?$/i.exec(t);
  if (m) return { kind: 'style', style: m[1] === '1' ? 'balance' : 'transaction', id: (m[2] || '').toUpperCase() };
  if ((m = /^#?\s*(SA\d+)\s*([12])\s*[.!]?$/i.exec(t))) return { kind: 'style', style: m[2] === '1' ? 'balance' : 'transaction', id: m[1].toUpperCase() };
  if ((m = /^(?:no|cancel|نه|لغو)\s*(?:#?\s*(SA\d+))?\s*[.!]?$/i.exec(t))) return { kind: 'no', id: (m[1] || '').toUpperCase() };
  return null;
}

/** The waiting previews (their data only), kept in a file so a restart does not lose them; half an hour. */
export class AllStatementPreviews {
  constructor({ file = '', now = () => Date.now(), ttlMs = TTL_MS } = {}) { Object.assign(this, { file, now, ttlMs }); this.n = 0; this.items = new Map(); this.loaded = !file; }
  _load() {
    if (this.loaded) return; this.loaded = true;
    try { const d = JSON.parse(fs.readFileSync(this.file, 'utf8')); this.n = Number(d.n) || 0; for (const e of d.items || []) if (this.now() - e.at <= this.ttlMs) this.items.set(e.id, e); } catch { /* none yet */ }
  }
  _save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ n: this.n, items: [...this.items.values()] }), { mode: 0o600 }); } catch { /* best effort */ } }
  add({ from, to, rows, total, more = 0 }) { this._load(); this.n += 1; const id = `SA${this.n}`; this.items.set(id, { id, from, to, rows, total, more, at: this.now() }); this._save(); return id; }
  get(id) { this._load(); const e = this.items.get(String(id || '').toUpperCase()); if (!e) return null; if (this.now() - e.at > this.ttlMs) { this.items.delete(e.id); this._save(); return null; } return e; }
  openIds() { this._load(); return [...this.items.keys()].filter((id) => this.get(id)); }
  clear(id) { this._load(); this.items.delete(String(id || '').toUpperCase()); this._save(); }
}

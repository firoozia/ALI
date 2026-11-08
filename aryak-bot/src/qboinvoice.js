// CREATING AN INVOICE IN QUICKBOOKS, WITH THE OWNER'S YES. Who asks: the owner (his own chat) and people the owner authorizes (their private chat with the
// bot). The request is "فاکتور بساز <customer>" and one line per item. It is only ever a PREVIEW (#Q12) sent to the OWNER's own chat; nothing exists in
// QuickBooks until the owner himself writes "بله #Q12" there (no other yes counts, not even the requester's). The create call carries a request id
// that belongs to the preview, so a second yes can never make a second invoice. The customer and every item must match EXACTLY (or a choice the owner
// confirmed): an unknown one stops the preview with the candidates. The VAT code is read from QuickBooks (the 5% standard-rated sales code), never an
// id written here. Safety: a kill switch in the client, at most 10 creations an hour and 40 a day, an append-only audit log, only the "create invoice"
// write exists, and QBO_WRITE off refuses everything. Nothing here sends anything to a customer.

import fs from 'node:fs';
import path from 'node:path';
import { parseStatementRequest } from './period.js';
import { createHash, randomBytes } from 'node:crypto';
import { staffChecker } from './gate.js';
import { nameKey } from './customergroups.js';
import { qboEscape } from './qbo.js';

const latin = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫]/g, '.');
const plain = (s) => latin(String(s || '')).replace(/[‌‎‏ً-ٟ]/g, ' ').replace(/[أإ]/g, 'ا').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();
const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const fils = (x) => Math.round(Number(x || 0) * 100);
const money = (f) => { const n = Math.abs(f); const s = `${Math.floor(n / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(n % 100).padStart(2, '0')}`; return f < 0 ? `-${s}` : s; };
const DAY = 86400000;
export const EXPIRY_MS = DAY;
export const CAP_HOUR = 10;
export const CAP_DAY = 40;
const MAX_LINES = 40;
const QB = 'کو[ئی]*یک\\s*بوکس';

// ---------------------------------------------------------------------------------------------------------------- the words
/** What the owner (or an authorized person) wrote, or null. Multi-line: the first line is "فاکتور بساز <customer>", then one item per line. */
export function parseInvoiceCommand(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const first = plain(raw.split('\n')[0]).replace(/^(?:آتوسا|اتوسا)[ ,،:]*/u, '');
  let m = /^فاکتور\s+بساز(?:ید)?\s+(.+)$/u.exec(first);
  if (m) return { type: 'request', customer: m[1].trim(), lines: raw.split('\n').slice(1).map((l) => l.trim()).filter(Boolean) };
  const s = plain(raw).replace(/[.!؟?]+$/u, '').trim();
  {
    // yes / no with the id before or after (right-to-left typing), with or without spaces and #; or the bare word (the desk then looks for the one open preview)
    const W = 'بله|اره|آره|نه|خیر|yes|no';
    const isYes = (w) => /^(?:بله|اره|آره|yes)$/iu.test(w);
    if ((m = new RegExp(String.raw`^(${W})$`, 'iu').exec(s))) return { type: isYes(m[1]) ? 'yes' : 'no', id: '' };
    if ((m = new RegExp(String.raw`^(?:(${W})\s*)?#?\s*([QNEMTPCUDRF])\s*(\d+)\s*#?(?:\s*(${W}))?$`, 'iu').exec(s)) && (m[1] || m[4]) && !(m[1] && m[4])) return { type: isYes(m[1] || m[4]) ? 'yes' : 'no', id: `${m[2].toUpperCase()}${m[3]}` };
  }
  // the owner's bulk QuickBooks jobs (see qbobulk.js)
  if ((m = /^ایمیل\s+مشتری(?:\s*ها)?(?:\s+(\S+@\S+))?$/u.exec(s))) return { type: 'bulk_email', email: m[1] || '' };
  if (/^موبایل\s+مشتری(?:\s*ها)?$/u.test(s)) return { type: 'bulk_mobile' };
  if (/^برگرداندن\s+نوار\s+لبه$/u.test(s)) return { type: 'bulk_undo', scope: 'edge' };
  if (/^دسته\s+و\s+کد\s+نوار\s+لبه$/u.test(s)) return { type: 'bulk_edge' };
  if ((m = /^هزینه\s*(?:ی\s*)?(امروز|هفته)$/u.exec(s))) return { type: 'cost_report', range: m[1] === 'هفته' ? 'week' : 'today' }; // what the paid calls cost: today or this week
  if (/^نام\s+و\s+شرح\s+نوار\s+لبه$/u.test(s)) return { type: 'bulk_edge_names' };
  if (/^حذف\s+نوار\s+لبه(?:\s*ها(?:ی)?)?\s+قدیمی$/u.test(s)) return { type: 'bulk_old_edge' };
  if ((m = /^برگرداندن\s+([CEMTP])\s*(\d+)$/iu.exec(s))) return { type: 'bulk_undo', scope: 'all', source: `${m[1].toUpperCase()}${m[2]}` };
  if (/^دسته\s+و\s+کد\s+کالا(?:\s*ها)?$/u.test(s)) return { type: 'bulk_catalog' };
  if (/^دسته\s+و\s+کد\s+پی\s*وی\s*سی$/u.test(s)) return { type: 'bulk_catalog', edge: false }; // the PVC film part only: no edge banding change at all
  if (/^مالیات\s+کالاها(?:\s+دبی)?$/u.test(s)) return { type: 'bulk_tax' };
  if (/^شروع\s+کن$/u.test(s)) return { type: 'price_start' };
  if (/^لیست\s+قیمت$/u.test(s)) return { type: 'price_list' };
  if ((m = /^حذف\s+قیمت\s+(.+)$/u.exec(s))) return { type: 'price_remove', code: m[1].trim() };
  {
    const rows = raw.split('\n').map((l) => plain(l).replace(/^(?:آتوسا|اتوسا)[ ,،:]*/u, '')).filter((l) => l && !/^قیمت\s*(?:ها|های)?\s+(?:به\s+)?(?:درهم|aed)(?:\s+است)?$/iu.test(l));
    const one = (l) => {
      let x = /^قیمت\s+سری\s*(\d+)\s*[=:]?\s*([\d.,]+)$/u.exec(l);
      if (x) return { series: Number(x[1]), price: x[2] };
      x = /^قیمت\s+(\d+)\s*تا\s*(\d+)\s*[=:]?\s*([\d.,]+)$/u.exec(l);
      if (x) return { from: Number(x[1]), to: Number(x[2]), price: x[3] };
      x = /^قیمت\s+(.+?)\s*[=:]\s*([\d.,]+)$/u.exec(l) || /^قیمت\s+(\d{1,4})\s+([\d.,]+)$/u.exec(l);
      return x ? { code: x[1].trim(), price: x[2] } : null;
    };
    const pr = rows.map(one);
    if (rows.length && rows.length <= 60 && pr.some(Boolean)) {
      const lines = pr.filter(Boolean).map((x) => ({ ...x, price: Number(String(x.price).replace(/,/g, '')) }));
      const okp = (l) => l.price >= 0 && l.price <= 10000000;
      return { type: 'price_set', lines: lines.filter(okp), bad: lines.filter((l) => !okp(l)).length, unread: rows.filter((_, i) => !pr[i]) };
    }
  }
  if (new RegExp(`^نام\\s+مشتری(?:\\s*ها)?\\s+با\\s+حروف\\s+بزرگ$`, 'u').test(s)) return { type: 'names_plan' };
  if (new RegExp(`^توقف\\s*${QB}$`, 'u').test(s)) return { type: 'pause' };
  if (new RegExp(`^ادامه\\s*${QB}$`, 'u').test(s)) return { type: 'resume' };
  if (new RegExp(`^گزارش\\s*${QB}$`, 'u').test(s)) return { type: 'audit' };
  if ((m = /^لغو\s+مجوز\s+فاکتور\s+\+?([\d\s-]{7,20})$/u.exec(s))) return { type: 'auth_remove', number: m[1] };
  if ((m = /^مجوز\s+فاکتور\s+\+?([\d\s-]{7,20})$/u.exec(s))) return { type: 'auth_add', number: m[1] };
  if (/^مجوزها$/u.test(s)) return { type: 'auth_list' };
  if (/^کدهای\s+مالیات$/u.test(s)) return { type: 'tax_list' };
  if ((m = /^کد\s+مالیات\s+(.+?)\s*=\s*(.+)$/u.exec(s))) return { type: 'tax_set', customer: m[1].trim(), code: m[2].trim() };
  if ((m = /^کد\s+(.+?)\s*=\s*(.+?)(?:\s+مشتری\s+(.+))?$/u.exec(s))) return { type: 'item_code', code: m[1].trim(), item: m[2].trim(), customer: m[3]?.trim() || '' };
  { // «صورت‌حساب شرکت … برای ماه ۱۰ میلادی» in any words: the statement of a customer for a period (read only; it goes to the asker's own chat)
    const sr = parseStatementRequest(raw, new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10));
    if (sr) return { type: 'statement_nl', customer: sr.customer, period: sr.period, unsupported: sr.unsupported };
  }
  if (looksLikeInvoiceRequest(raw)) return { type: 'request', customer: '', lines: [], free: true }; // any layout: the model only extracts, the matching stays exact
  return null;
}

/** A message that asks to make an invoice, in any layout ("فاکتور بساز", "فاکتور بزن", "صادر کن", with or without the assistant's name). Not a question, not a send. */
export function looksLikeInvoiceRequest(text) {
  const s = plain(text);
  if (!s || s.length > 3000 || /[?؟]\s*$/u.test(s)) return false;
  if (/ارسال|بفرست|\bsend\b|\bforward\b/iu.test(s) && !/بساز|بزن|صادر/u.test(s)) return false;
  return (/فاکتور/u.test(s) && /(?:بساز|بزن|صادر\s*کن|درست\s*کن|ایجاد\s*کن|بنویس)/u.test(s)) || /(?:create|make|issue)\s+(?:an?\s+)?invoice/iu.test(s);
}

/** The ways one item line can be read: [{ item, qty, price|null }]. Separators (, | ; tab) make it exact; without them the numbers at the end are read. */
export function lineCandidates(line) {
  const t = latin(line).replace(/^\s*(?:\d+\s*[.)]\s+|[-•*]\s+)/u, '').trim();
  const isNum = (x) => /^\d+(?:\.\d+)?$/.test(x);
  if (/[,،|;\t]/.test(t)) {
    const f = t.split(/[,،|;\t]/).map((x) => x.trim());
    if (f.length >= 2 && isNum(f[1]) && (f.length === 2 || (f.length === 3 && isNum(f[2])))) return [{ item: f[0], qty: Number(f[1]), price: f[2] === undefined ? null : Number(f[2]) }];
    return [];
  }
  const tok = t.split(/\s+/);
  const out = [];
  const n = tok.length;
  if (n >= 3 && isNum(tok[n - 1]) && isNum(tok[n - 2])) out.push({ item: tok.slice(0, n - 2).join(' '), qty: Number(tok[n - 2]), price: Number(tok[n - 1]) });
  if (n >= 2 && isNum(tok[n - 1])) out.push({ item: tok.slice(0, n - 1).join(' '), qty: Number(tok[n - 1]), price: null });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- exact matching
const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Every way an item can be named by a code: its name, SKU and full name, and the colour or product number inside them (PVC-108, EDGE22-1810, "... - 1810", "1801 edge banding"). */
export function itemCodeKeys(i) {
  const keys = new Set();
  for (const x of [i?.Name, i?.Sku, i?.FullyQualifiedName]) { const k = norm(x); if (k) keys.add(k); }
  const add = (v) => { if (v !== null && v !== undefined && v !== '') keys.add(String(v).toLowerCase()); };
  add(pvcCode(i));
  const sku = String(i?.Sku || '').trim(); const name = String(i?.Name || '').trim();
  let m = /^(?:PVC|EDGE(?:22|50)?)[-\s]*(\d{3,5})$/i.exec(sku); if (m) add(m[1]);
  m = /\s-\s(\d{3,5})\s*$/.exec(name); if (m) add(m[1]); // "EDGE BAND 0.8x22 - 1810"
  m = /^(\d{3,5})\b/.exec(name); if (m) add(m[1]);
  m = /^B\s*(\d{3,5})$/i.exec(name); if (m) add(m[1]);
  m = /^\d{3,5}$/.exec(sku); if (m) add(sku);
  return keys;
}
/** Is [code] a code of some active item? A code that fits SEVERAL items is known (which one is asked later). */
export function codeKnownInItems(items, code) {
  const c = String(code || '').trim();
  if (!c) return false;
  const k = /^\d+$/.test(c) ? c : norm(c);
  return (items || []).some((i) => i && i.Type !== 'Category' && i.Active !== false && itemCodeKeys(i).has(k));
}

/** The code (three or four digits) of a PVC item (PVC FILM108 -> 108, PVC 1810 -> 1810), or null (edge banding, boards and the like have none). */
export function pvcCode(i) {
  const name = String(i?.Name || '');
  const m = /pvc\s*(?:film|flim)?\s*(\d{3,4})(?!\d)/i.exec(name) || (/pvc/i.test(name) ? /^(\d{3,4})$/.exec(String(i.Sku || '').trim()) : null);
  return m ? Number(m[1]) : null;
}

/**
 * Items whose Name, Sku or FullyQualifiedName equals [name] exactly (case-insensitive). The match is by Item.Name (a sub-item's full name
 * "PVC FILM:PVC FILM108" is one more key) and by the SKU ("PVC-108"). A bare code ("108") also finds the PVC item by its code in itemsContaining,
 * so it keeps being found after the SKU was changed. A category is never an item of an invoice.
 */
export function itemsNamed(items, name) {
  const k = norm(name);
  if (!k) return [];
  return items.filter((i) => i.Type !== 'Category' && i.Active !== false && [i.Name, i.Sku, i.FullyQualifiedName].some((x) => x && norm(x) === k));
}

/** Close names for a stop message: never a choice made for the user. */
function closeItems(items, name) {
  const k = norm(name);
  const first = k.split(' ')[0];
  return items.filter((i) => [i.Name, i.Sku].some((x) => x && (norm(x).includes(k) || k.includes(norm(x)) || (first.length >= 3 && norm(x).includes(first))))).slice(0, 3).map((i) => i.Name);
}

/** Items whose Name, Sku or full name holds all the words of [name] as whole words ("1810" finds "B 1810" and "PVC 1810"), up to eight. */
export function itemsContaining(items, name) {
  const toks = nameKey(name).split(' ').filter(Boolean);
  if (!toks.length) return [];
  const code = /^\d{3,4}$/.test(String(name).trim()) ? Number(String(name).trim()) : null; // a bare code also finds the PVC item that carries it (its SKU may now be PVC-108)
  return items.filter((i) => i.Type !== 'Category' && i.Active !== false && ([i.Name, i.Sku, i.FullyQualifiedName].some((x) => { if (!x) return false; const t = new Set(nameKey(x).split(' ')); return toks.every((k) => t.has(k)); }) || (code !== null && pvcCode(i) === code))).slice(0, 8);
}

const itemLabel = (i) => `${i.Name}${i.Sku && norm(i.Sku) !== norm(i.Name) ? ` [${i.Sku}]` : ''}`;

/**
 * One item text -> an item. In order: the code the owner taught, the one item that equals it exactly (Name or Sku), else the items that hold it as
 * whole words: if exactly one of those is something THIS customer bought before, that one; otherwise a stop that lists them with their prices.
 * Returns { item, via } or { stop(n) }.
 */
export function pickItem(name, ctx = {}) {
  const items = ctx.items || [];
  const taught = ctx.taught?.(name);
  if (taught) return { item: taught, via: 'taught' };
  // "نوار لبه 1801 سایز 22": the colour number and the width name the one edge banding item whose SKU is EDGE22-1801
  const sz = /^(?:نوار\s*لبه\s+|edge\s+)?(\d{3,5})\s+(?:سایز\s+|size\s+|عرض\s+)?(22|50)$/iu.exec(nameKey(name).replace(/(\d)\s*mm\b/g, '$1'));
  if (sz) { const bySize = items.filter((i) => i.Type !== 'Category' && norm(i.Sku) === `edge${sz[2]}-${sz[1]}`); if (bySize.length === 1) return { item: bySize[0], via: 'size' }; }
  const exact = itemsNamed(items, name);
  if (exact.length === 1) return { item: exact[0], via: '' };
  const cands = exact.length ? exact : itemsContaining(items, name);
  if (!cands.length) return { stop: (n) => { const close = closeItems(items, name); return `سطر ${fa(n)}: کالای «${name}» در کوییک‌بوکس دقیقاً پیدا نشد؛ اول آن را معرفی کنید.${close.length ? ` نزدیک‌ها: ${close.join(' | ')}` : ''}`; } };
  // a bare code ("108") that only one PVC item carries is that item, even after its SKU became PVC-108 (the code is the number in its name)
  if (!exact.length && cands.length === 1 && /^\d{3,4}$/.test(String(name).trim()) && pvcCode(cands[0]) === Number(String(name).trim())) return { item: cands[0], via: 'code' };
  const hist = ctx.history ? cands.filter((i) => ctx.history.has(String(i.Id))) : [];
  if (hist.length === 1) return { item: hist[0], via: 'history' };
  return { stop: (n) => `سطر ${fa(n)}: «${name}» چند کالا دارد و بین آن‌ها حدس نمی‌زنم:\n${cands.map((i, k) => `   ${fa(k + 1)}) ${itemLabel(i)} — قیمت ${Number(i.UnitPrice) > 0 ? i.UnitPrice : 'ندارد'}`).join('\n')}\nبنویسید: کد ${name} = <نام دقیق کالا>` };
}

/**
 * Every line against the QuickBooks items. [entries]: [{ raw, cands: [{ item, qty, price|null }] }] (each candidate is one reading of the line).
 * A line resolves only if exactly ONE reading names an item (see pickItem); otherwise it is a stop with the reason and the candidates.
 */
export function resolveEntries(entries, ctx) {
  const lines = []; const stops = [];
  entries.forEach((e, i) => {
    const n = i + 1;
    const cands = e.cands || [];
    if (!cands.length) { stops.push(`سطر ${fa(n)} را نفهمیدم: «${String(e.raw).slice(0, 60)}» — قالب: نام کالا، تعداد، قیمت (قیمت اختیاری)`); return; }
    const tried = cands.map((c) => ({ c, r: pickItem(c.item, ctx) }));
    const ok = tried.filter((t) => t.r.item);
    if (ok.length > 1) { stops.push(`سطر ${fa(n)}: «${String(e.raw).slice(0, 60)}» بیش از یک جور خوانده می‌شود؛ با ویرگول بنویسید: نام کالا، تعداد، قیمت`); return; }
    if (!ok.length) { stops.push(tried[0].r.stop(n)); return; }
    const { c, r } = ok[0];
    if (!(c.qty > 0 && c.qty <= 100000)) { stops.push(`سطر ${fa(n)}: تعداد درست نیست`); return; }
    if (c.price !== null && c.price !== undefined && !(c.price >= 0 && c.price <= 10000000)) { stops.push(`سطر ${fa(n)}: قیمت درست نیست`); return; }
    lines.push({ n, item: r.item, qty: c.qty, price: c.price ?? null, via: r.via });
  });
  return { lines, stops };
}

/** The same for plain text lines (the strict format): [{ lines, stops }]. */
export function resolveLines(rawLines, items, ctx = {}) {
  return resolveEntries(rawLines.map((raw) => ({ raw, cands: lineCandidates(raw) })), { ...ctx, items });
}

/**
 * Every active tax code of the company (zero-rated and exempt ones too) with its sales rate, read from QuickBooks: id -> { id, name, rate }.
 * UAE VAT is by emirate of supply (and exports are zero-rated), so no single code can be right for every customer.
 */
export function taxCodeMap(taxCodes, taxRates) {
  const rate = new Map(taxRates.map((r) => [String(r.Id), Number(r.RateValue)]));
  const out = new Map();
  for (const t of taxCodes) {
    if (t.Active === false) continue;
    const r = (t.SalesTaxRateList?.TaxRateDetail || []).reduce((sum, d) => sum + (rate.get(String(d.TaxRateRef?.value)) || 0), 0);
    out.set(String(t.Id), { id: String(t.Id), name: t.Name, rate: t.Taxable === false ? 0 : r });
  }
  return out;
}

/**
 * The tax code the office itself used on a customer's recent invoices (newest first): the code of at least 90% of all their lines AND the code
 * of the most recent invoice. Otherwise { error } with what was found (no history, or no such majority), so the owner picks.
 */
export function codeFromInvoices(invoices, codes) {
  const count = new Map();
  const codesOf = (inv) => (inv.Line || []).map((l) => l.SalesItemLineDetail?.TaxCodeRef?.value).filter((id) => id !== undefined && id !== null && id !== '').map(String);
  for (const inv of invoices) for (const id of codesOf(inv)) count.set(id, (count.get(id) || 0) + 1);
  const found = [...count.entries()].map(([id, n]) => ({ id, n, name: codes.get(id)?.name || `(${id})`, known: codes.has(id) })).sort((x, y) => y.n - x.n);
  const total = found.reduce((sum, f) => sum + f.n, 0);
  if (!found.length) return { error: 'none', found };
  const top = found[0];
  // the code of the most recent invoice that has any tax line: its own most frequent code
  const newest = invoices.map(codesOf).find((c) => c.length);
  const tally = new Map();
  for (const id of newest || []) tally.set(id, (tally.get(id) || 0) + 1);
  const lead = [...tally.entries()].sort((x, y) => y[1] - x[1]);
  const newestCode = lead.length && (lead.length === 1 || lead[0][1] > lead[1][1]) ? lead[0][0] : '';
  if (top.n / total < 0.9 || top.id !== newestCode) return { error: 'disagree', found };
  if (!top.known) return { error: 'unknown', found };
  return { code: codes.get(top.id), n: top.n, total, found, invoices: invoices.length };
}

/** Totals in fils, the way QuickBooks adds them: each line rounded, the VAT on the sum of the taxable lines. */
export function totals(lines, ratePct) {
  const sub = lines.reduce((s, l) => s + l.amount, 0);
  const vat = Math.round((sub * ratePct) / 100);
  return { subtotal: sub, vat, total: sub + vat };
}

// ---------------------------------------------------------------------------------------------------------------- the stores
/** Who the owner authorized to ask for invoices and statements (their numbers), kept on the VM. */
export class AuthStore {
  constructor(dir = '') { this.file = dir ? path.join(dir, 'qbo-authorized.json') : ''; this.d = { people: [] }; try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ } }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  static clean(number) { const d = latin(number).replace(/\D/g, ''); return d.length >= 8 && d.length <= 15 ? d : ''; }
  numbers() { return this.d.people.map((p) => p.number); }
  add(number, now = Date.now()) { const n = AuthStore.clean(number); if (!n) return false; if (!this.d.people.some((p) => p.number === n)) this.d.people.push({ number: n, at: new Date(now).toISOString() }); this.save(); return n; }
  remove(number) { const n = AuthStore.clean(number); const len = this.d.people.length; this.d.people = this.d.people.filter((p) => p.number !== n); this.save(); return this.d.people.length < len; }
  /** Is this sender (jid, alt jid, lid mapped) an authorized person? */
  isAuthorized(who, lidToPhone = new Map()) { return staffChecker(this.numbers(), lidToPhone)(who) === true; }
}

/** The item codes the owner taught ("کد 1810 = PVC 1810"): for one customer (by QuickBooks id) or for everybody. Kept on the VM. */
export class ItemCodes {
  constructor(dir = '') { this.file = dir ? path.join(dir, 'qbo-itemcodes.json') : ''; this.d = { byKey: {} }; try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ } }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  static key(customerId, code) { return `${customerId || '*'}|${nameKey(code)}`; }
  /** The item taught for this customer's code, else the global one, else null. */
  get(customerId, code) { return this.d.byKey[ItemCodes.key(customerId, code)] || this.d.byKey[ItemCodes.key('', code)] || null; }
  set(customerId, code, item, now = Date.now()) { this.d.byKey[ItemCodes.key(customerId, code)] = { itemId: String(item.Id), name: item.Name, at: new Date(now).toISOString() }; this.save(); }
}

/** The tax code the owner chose for a customer (by QuickBooks customer id), for a customer with no clear invoices of his own. */
export class TaxChoices {
  constructor(dir = '') { this.file = dir ? path.join(dir, 'qbo-taxcodes.json') : ''; this.d = { byCustomer: {} }; try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ } }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  get(customerId) { return this.d.byCustomer[String(customerId)] || null; }
  set(customerId, code, now = Date.now()) { this.d.byCustomer[String(customerId)] = { codeId: code.id, name: code.name, at: new Date(now).toISOString() }; this.save(); }
}

/** The append-only audit log: time, requester, approver, preview id, QuickBooks id, document number, total. Never a message text. */
export class Audit {
  constructor(dir = '', now = () => Date.now()) { this.file = dir ? path.join(dir, 'qbo-audit.log') : ''; this.now = now; }
  add(entry) { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.appendFileSync(this.file, `${JSON.stringify({ at: new Date(this.now()).toISOString(), ...entry })}\n`, { mode: 0o600 }); } catch { /* best effort */ } }
  last(n = 10) { try { return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l)); } catch { return []; } }
  /** Every entry (the undo job reads what a finished job really did from here). */
  all() { try { return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
}

/** The previews and the creations made (for the caps). */
export class InvoiceStore {
  constructor(dir = '') { this.file = dir ? path.join(dir, 'qbo-invoices.json') : ''; this.d = { n: 0, previews: {}, creates: [] }; try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ } }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  nextId() { this.d.n += 1; return `Q${this.d.n}`; }
  add(p) { this.d.previews[p.id] = p; this.save(); return p; }
  get(id) { return this.d.previews[String(id).toUpperCase()] || null; }
  /** Creations in the last hour and the last day. */
  counts(now) { const hour = this.d.creates.filter((t) => now - t < 3600000).length; const day = this.d.creates.filter((t) => now - t < DAY).length; return { hour, day }; }
  recordCreate(now) { this.d.creates = [...this.d.creates.filter((t) => now - t < DAY), now]; this.save(); }
}

// ---------------------------------------------------------------------------------------------------------------- the desk
export class QboInvoiceDesk {
  /**
   * [qbo]; [desk]: the QboDesk (customer matching and the cached customer list); [store]: InvoiceStore; [audit]: Audit; [book]: the owner's price
   * list (PriceBook) or null; [config]; [today]: () => yyyy-mm-dd; [now]; [post]: async (jid, buffer, fileName, caption); [ownerJid]: () => jid;
   * [groups]: async () => [{ id, subject }]; [testGroup]: (groups) => group|null.
   */
  constructor({ qbo, desk, store, audit, book = null, taxChoices = new TaxChoices(''), itemCodes = new ItemCodes(''), extract = null, config, today, now = () => Date.now(), post, ownerJid, groups, testGroup, log = () => {} }) {
    Object.assign(this, { qbo, desk, store, audit, book, taxChoices, itemCodes, extract, config, today, now, post, ownerJid, groups, testGroup, log });
    this.cache = { at: 0, items: [], codes: new Map(), currency: '', customTxn: false };
    this.inflight = new Set(); // previews being created right now: a yes that arrives meanwhile does not start a second attempt
  }

  async catalog() {
    if (this.now() - this.cache.at < 10 * 60 * 1000 && this.cache.items.length) return this.cache;
    const [items, taxCodes, taxRates, prefs] = await Promise.all([
      this.qbo.query('select * from Item where Active = true'),
      this.qbo.query('select * from TaxCode').catch(() => []),
      this.qbo.query('select * from TaxRate').catch(() => []),
      this.qbo.get('preferences').then((j) => j?.Preferences || null).catch(() => null),
    ]);
    this.cache = { at: this.now(), items: items.filter((i) => i.Type !== 'Category'), codes: taxCodeMap(taxCodes, taxRates), currency: prefs?.CurrencyPrefs?.HomeCurrency?.value || '', customTxn: prefs?.SalesFormsPrefs?.CustomTxnNumbers === true };
    return this.cache;
  }

  async customerRecord(id) { return (await this.qbo.query(`select * from Customer where Id = '${qboEscape(id)}'`))[0] || null; }

  /** Is this document number already used by an invoice? */
  async docNumberTaken(n) { return (await this.qbo.query(`select Id from Invoice where DocNumber = '${qboEscape(n)}'`)).length > 0; }

  /**
   * The next invoice number when the company numbers by hand: the pattern of the office (the prefix and digits of its newest invoice, "inv-8996"),
   * the highest number of that pattern among the last invoices and the previews still waiting, plus one, and free. { docNumber } or { error }.
   */
  async nextDocNumber(exceptId = '') {
    const j = await this.qbo.get('query', { query: 'select Id, DocNumber from Invoice ORDERBY MetaData.CreateTime DESC STARTPOSITION 1 MAXRESULTS 60' });
    const numbers = (j?.QueryResponse?.Invoice || []).map((r) => String(r.DocNumber || '')).filter(Boolean);
    const pat = (n) => /^(.*?)(\d+)$/.exec(n);
    const newest = numbers.map(pat).find(Boolean);
    if (!newest) return { error: 'الگوی شمارهٔ فاکتورهای دفتر از آخرین فاکتورها خوانده نشد' };
    const [, prefix, digits] = newest;
    const waiting = Object.values(this.store.d.previews).filter((q) => q.id !== exceptId && ['pending', 'creating'].includes(q.status) && q.docNumber && this.now() - q.at <= EXPIRY_MS).map((q) => q.docNumber);
    const same = [...numbers, ...waiting].map(pat).filter((m) => m && m[1].toLowerCase() === prefix.toLowerCase());
    let next = Math.max(...same.map((m) => Number(m[2]))) + 1;
    const pad = digits.startsWith('0') ? digits.length : 0;
    for (let tries = 0; tries < 20; tries++, next++) {
      const candidate = `${prefix}${String(next).padStart(pad, '0')}`;
      if (!(await this.docNumberTaken(candidate))) return { docNumber: candidate };
    }
    return { error: 'شمارهٔ آزاد بعدی پیدا نشد' };
  }

  /** A tax code by its name or id (case-insensitive, exact). */
  codeNamed(codes, name) { const k = norm(name); return [...codes.values()].find((c) => c.id === String(name).trim() || norm(c.name) === k) || null; }

  /**
   * The tax code of an invoice for THIS customer: the owner's override (QBO_TAX_CODE), else the code he chose for the customer, else the code the
   * office itself used on the customer's recent invoices (all of their lines agree). Otherwise { error } with what was found, so the owner picks.
   */
  async recentInvoices(customerId) {
    const j = await this.qbo.get('query', { query: `select * from Invoice where CustomerRef = '${qboEscape(customerId)}' ORDERBY TxnDate DESC STARTPOSITION 1 MAXRESULTS 10` });
    return j?.QueryResponse?.Invoice || [];
  }

  async taxFor(cust, cat, recent, items = []) {
    const names = [...cat.codes.values()].map((c) => `${c.name} (${c.rate}%)`).join(' | ');
    const ask = `کد را خودتان بگویید: «کد مالیات ${cust.name} = <نام کد>». کدهای موجود: ${names}`;
    if (this.config.qboTaxCode) {
      const c = this.codeNamed(cat.codes, this.config.qboTaxCode);
      return c ? { ...c, source: 'override' } : { error: `کد مالیاتی تعیین‌شده در تنظیم (QBO_TAX_CODE) در کوییک‌بوکس پیدا نشد. کدهای موجود: ${names}` };
    }
    const chosen = this.taxChoices.get(cust.id);
    if (chosen && cat.codes.has(String(chosen.codeId))) return { ...cat.codes.get(String(chosen.codeId)), source: 'owner' };
    // the items' own tax code: when every item of the invoice carries the SAME known code, that is the code (the Dubai standard-rated code after the bulk job)
    const own = items.map((i) => String(i?.SalesTaxCodeRef?.value || ''));
    if (own.length && own[0] && own.every((x) => x === own[0]) && cat.codes.has(own[0])) return { ...cat.codes.get(own[0]), source: 'item' };
    const r = codeFromInvoices(recent, cat.codes);
    if (r.code) return { ...r.code, source: 'invoices', n: r.n, total: r.total, others: r.found.filter((f) => f.id !== r.code.id) };
    if (r.error === 'none') return { error: `برای «${cust.name}» فاکتور قبلی با کد مالیات در کوییک‌بوکس نیست تا از دفتر خوانده شود. ${ask}` };
    const seen = r.found.map((f) => `${f.name} (${f.n} سطر)`).join('، ');
    return { error: `کد مالیات فاکتورهای اخیر «${cust.name}» ${r.error === 'unknown' ? 'ناشناخته است' : 'اکثریت روشنی ندارد (دست‌کم ۹۰٪ سطرها و کد آخرین فاکتور باید یکی باشد)'}: ${seen}. ${ask}` };
  }

  /** The ids of the previews the owner can still say yes or no to (pending, not older than a day). */
  openIds() { return Object.values(this.store.d.previews).filter((p) => p.status === 'pending' && this.now() - p.at <= EXPIRY_MS).map((p) => p.id); }

  /** "کد مالیات <مشتری> = <کد>": the owner chooses the code of a customer (stored on the VM). */
  async setTaxChoice({ customer, code }) {
    const guard = this.guard();
    if (guard) return [guard];
    const cust = await this.desk.resolveStrict(customer);
    if (!cust.id) return [`مشتری «${cust.ours}» با نام دقیق یا انتخاب تأییدشدهٔ مالک در کوییک‌بوکس نیست؛ اول معرفی شود (تطبیق کوییک‌بوکس).`];
    const cat = await this.catalog();
    const c = this.codeNamed(cat.codes, code);
    if (!c) return [`کد «${code}» در کوییک‌بوکس نیست. کدهای موجود: ${[...cat.codes.values()].map((x) => `${x.name} (${x.rate}%)`).join(' | ')}`];
    this.taxChoices.set(cust.id, c, this.now());
    this.audit.add({ event: 'tax-code', approver: 'owner', reason: `${cust.id}=${c.id}` });
    return [`ثبت شد: کد مالیات «${cust.name}» = ${c.name} (${c.rate}٪). فاکتورهای بعدی او با همین کد می‌شود.`];
  }

  async taxListText() {
    if (this.guard()) return [this.guard()];
    const cat = await this.catalog();
    return [['کدهای مالیاتی کوییک‌بوکس:', ...[...cat.codes.values()].map((c) => `• ${c.name} — ${c.rate}٪`)].join('\n')];
  }

  guard() {
    if (this.qbo.paused) return 'کوییک‌بوکس با فرمان مالک متوقف است؛ بنویسید: ادامهٔ کوییک‌بوکس';
    if (!this.qbo.configured) return `کوییک‌بوکس هنوز تنظیم نشده است. تنظیم‌های کم: ${this.qbo.missing.join('، ')}`;
    if (this.qbo.needsReconnect) return 'کوییک‌بوکس باید دوباره وصل شود؛ بنویسید: اتصال کوییک‌بوکس';
    if (!this.qbo.connected) return 'کوییک‌بوکس وصل نیست؛ بنویسید: اتصال کوییک‌بوکس';
    return '';
  }

  /**
   * A request in the strict format (customer on the first line, one item per line) or in ANY layout -> a PREVIEW sent to the owner. Free-form
   * requests are first read by the model into { customer, lines } (it only extracts); when it is unsure the request stops and says what was
   * understood. Returns { requester, owner }: the note for the person who asked, and the preview for the owner (null when it stopped). Never creates.
   */
  async request({ text, requester }) {
    const cmd = parseInvoiceCommand(text);
    if (cmd?.type !== 'request') return { requester: 'Write: فاکتور بساز <customer> and then one item per line: item, quantity, price (price optional).', owner: null };
    const stop = (msg) => ({ requester: msg, owner: null });
    const blocked = this.guard();
    if (blocked) return stop(blocked);
    const strict = !cmd.free && cmd.customer && cmd.lines.length && cmd.lines.every((l) => lineCandidates(l).length);
    let customerText = cmd.customer; let entries;
    if (strict) {
      if (cmd.lines.length > MAX_LINES) return stop(`حداکثر ${fa(MAX_LINES)} سطر در یک فاکتور.`);
      entries = cmd.lines.map((raw) => ({ raw, cands: lineCandidates(raw) }));
    } else {
      if (!this.extract) return stop('بعد از نام مشتری، هر کالا را در یک سطر بنویسید: نام کالا، تعداد، قیمت (قیمت اختیاری).');
      let x = null;
      try { x = await this.extract(text); } catch (e) { this.log(`invoice request could not be read: ${e.name}`); }
      if (!x) return stop('درخواست را نفهمیدم. بنویسید: فاکتور بساز <مشتری> و بعد هر کالا در یک سطر: نام کالا، تعداد، قیمت (قیمت اختیاری).');
      const unclear = [...x.unsure];
      if (!x.customer) unclear.push('نام مشتری مشخص نیست');
      if (!x.lines.length) unclear.push('هیچ کالایی با تعدادش خوانده نشد');
      if (x.lines.length > MAX_LINES) unclear.push(`بیش از ${fa(MAX_LINES)} سطر`);
      if (unclear.length) return stop(`این را فهمیدم:\nمشتری: ${x.customer || '—'}\n${x.lines.length ? x.lines.map((l, i) => `${fa(i + 1)}. ${l.item} × ${l.qty}${l.price !== null ? ` @ ${l.price}` : ''}`).join('\n') : 'سطری نیست'}\nولی مطمئن نیستم: ${unclear.join('؛ ')}\nچیزی ساخته نشد. دوباره بنویسید (یا با قالب: فاکتور بساز <مشتری> و هر کالا در یک سطر: نام کالا، تعداد، قیمت).`);
      customerText = x.customer;
      entries = x.lines.map((l) => ({ raw: `${l.item} ${l.qty}${l.price !== null ? ` @ ${l.price}` : ''}`, cands: [{ item: l.item, qty: l.qty, price: l.price }] }));
    }
    return this.makePreview({ customerText, entries, requester, stop });
  }

  async makePreview({ customerText, entries, requester, stop }) {
    const cust = await this.desk.resolveLoose(customerText);
    const problems = { customer: '', items: [], tax: '' };
    if (!cust.id) {
      if (cust.candidates) problems.customer = `مشتری «${cust.ours}» با چند مشتری می‌خواند و بین آن‌ها حدس نمی‌زنم:\n${cust.candidates.map((c, i) => `   ${fa(i + 1)}) ${c}`).join('\n')}\n   نام کامل یکی را بنویسید.`;
      else {
        const how = cust.ambiguous ? `چند مشتری با این نام دقیق هست: ${cust.ambiguous.map((c) => c.DisplayName).join(' | ')}` : cust.options?.length ? `نزدیک‌ها: ${cust.options.map((o) => o.name).join(' | ')}` : 'مشتری مشابهی هم پیدا نشد';
        problems.customer = `مشتری «${cust.ours}» با نام دقیق یا انتخاب تأییدشدهٔ مالک در کوییک‌بوکس نیست؛ اول معرفی شود (تطبیق کوییک‌بوکس). ${how}`;
      }
    }
    const cat = await this.catalog();
    // what this customer bought and was taxed with before (only when the customer is known)
    const recent = cust.id ? await this.recentInvoices(cust.id) : [];
    const history = new Set();
    for (const inv of recent) for (const l of inv.Line || []) { const id = l.SalesItemLineDetail?.ItemRef?.value; if (id !== undefined && id !== null) history.add(String(id)); }
    const taught = (code) => { if (!cust.id) return null; const t = this.itemCodes.get(cust.id, code); return t ? cat.items.find((i) => String(i.Id) === String(t.itemId)) || null : null; };
    const { lines, stops } = resolveEntries(entries, { items: cat.items, history, taught });
    problems.items.push(...stops);
    const warnings = []; const out = [];
    for (const l of lines) {
      const listed = Number(l.item.UnitPrice) > 0 ? Number(l.item.UnitPrice) : null; // no price in QuickBooks (or zero) = no price to default to
      const price = l.price ?? listed;
      if (price === null || Number.isNaN(price)) { problems.items.push(`سطر ${fa(l.n)}: برای کالای «${l.item.Name}» در کوییک‌بوکس قیمتی نیست؛ قیمت را در همان سطر بنویسید.`); continue; }
      const amount = fils(l.qty * price);
      const w = [];
      if (listed !== null && l.price !== null && l.price < listed - 0.005) w.push(`قیمت کمتر از قیمت کوییک‌بوکس (${listed})`);
      const code = l.item.Sku || l.item.Name;
      const pb = this.book?.priceOf?.(code, cust.ours, this.today());
      if (pb && pb.price !== undefined && price < Number(pb.price) - 0.005) w.push(`قیمت کمتر از فهرست قیمت مالک (${pb.price})`);
      if (w.length) warnings.push(`سطر ${fa(l.n)} (${l.item.Name}): ${w.join('، ')}`);
      out.push({ itemId: String(l.item.Id), name: l.item.Name, sku: l.item.Sku || '', description: String(l.item.Description || '').slice(0, 4000), qty: l.qty, price, amount, via: l.via });
    }
    let tax = null;
    if (cust.id) { tax = await this.taxFor(cust, cat, recent, lines.map((l) => l.item)); if (tax.error) problems.tax = tax.error; } else problems.tax = 'کد مالیات بعد از مشخص شدن مشتری بررسی می‌شود.';
    // the company numbers invoices by hand: the next number of the office's own pattern (an invoice is never made without one)
    let docNumber = '';
    if (cat.customTxn && !problems.customer && !problems.items.length && !(problems.tax && cust.id)) {
      const n = await this.nextDocNumber();
      if (n.error) problems.number = `${n.error}. شمارهٔ فاکتور را نمی‌توانم حدس بزنم؛ آخرین شماره‌ها را در کوییک‌بوکس ببینید و به مالک خبر بدهید.`; else docNumber = n.docNumber;
    }
    const rec = cust.id ? await this.customerRecord(cust.id) : null;
    // every stop in ONE reply: customer, items, tax
    const parts = [];
    if (problems.customer) parts.push(`مشتری:\n${problems.customer}`);
    if (problems.items.length) parts.push(`کالاها:\n${problems.items.join('\n')}`);
    if (problems.number) parts.push(`شمارهٔ فاکتور:\n${problems.number}`);
    const taxReal = !!problems.tax && !!cust.id;
    if (problems.tax && !taxReal) parts.push(`مالیات:\n${problems.tax}`);
    if (taxReal && requester === 'owner') parts.push(`مالیات:\n${problems.tax}`);
    if (parts.length || (taxReal && requester !== 'owner')) {
      const message = `فاکتور ساخته نمی‌شود؛ این‌ها را درست کنید:\n${parts.join('\n\n')}`;
      if (taxReal && requester !== 'owner') {
        // an authorized person cannot choose the tax code: the owner is told what was found, the person what he can fix
        const fixable = [problems.customer && `مشتری: ${problems.customer}`, ...problems.items].filter(Boolean);
        return { requester: fixable.length ? `${message}\n\nمالیات: مالک باید کد را انتخاب کند و به او خبر داده شد.` : 'The tax code for this customer must be chosen by the owner first; he has been told. Please ask again afterwards.', owner: `درخواست فاکتور برای «${cust.name}» (از شمارهٔ ${requester}) متوقف شد.\n${problems.tax}` };
      }
      return stop(message);
    }
    const t = totals(out, tax.rate);
    const id = this.store.nextId();
    if (tax.source === 'invoices' && tax.others?.length) warnings.push(`در فاکتورهای قبلی این مشتری چند سطر کد دیگری داشت: ${tax.others.map((x) => `${x.name} (${x.n} سطر)`).join('، ')}`);
    const preview = {
      id, nonce: randomBytes(5).toString('hex'), at: this.now(), status: 'pending', requester, customer: { ours: cust.ours, id: cust.id, name: cust.name, from: cust.loose ? cust.typed : '' },
      docNumber, customTxn: cat.customTxn, termId: rec?.SalesTermRef?.value ? String(rec.SalesTermRef.value) : '', billEmail: rec?.PrimaryEmailAddr?.Address || '',
      lines: out, tax: { id: tax.id, name: tax.name, rate: tax.rate, source: tax.source, n: tax.n, total: tax.total }, ...t, currency: cat.currency, warnings,
    };
    this.store.add(preview);
    this.audit.add({ event: 'preview', requester, previewId: id, total: t.total });
    return { requester: `Your invoice request #${id} for ${cust.name} was sent to the owner for approval (total ${money(t.total)}). You will be told when it is created or refused.`, owner: this.previewText(preview) };
  }

  /** "کد 1810 = PVC 1810 [مشتری X]": the owner teaches which item a code means (for one customer, else for everybody). */
  async setItemCode({ code, item, customer }) {
    const guard = this.guard();
    if (guard) return [guard];
    const cat = await this.catalog();
    const found = itemsNamed(cat.items, item);
    if (found.length !== 1) return [found.length ? `نام «${item}» در کوییک‌بوکس برای بیش از یک کالا است؛ دقیق‌تر بنویسید.` : `کالای «${item}» در کوییک‌بوکس دقیقاً پیدا نشد. نام کامل کالا را بنویسید.${closeItems(cat.items, item).length ? ` نزدیک‌ها: ${closeItems(cat.items, item).join(' | ')}` : ''}`];
    let custId = '';
    let custName = '';
    if (customer) {
      const c = await this.desk.resolveLoose(customer);
      if (!c.id) return [`مشتری «${customer}» یکتا پیدا نشد؛ نام کامل‌تر بنویسید.${c.candidates ? ` ${c.candidates.join(' | ')}` : ''}`];
      custId = c.id; custName = c.name;
    }
    this.itemCodes.set(custId, code, found[0], this.now());
    this.audit.add({ event: 'item-code', approver: 'owner', reason: `${custId || '*'}:${nameKey(code)}=${found[0].Id}` });
    return [`ثبت شد: کد «${code}» = ${itemLabel(found[0])}${custName ? ` برای مشتری ${custName}` : ' برای همهٔ مشتری‌ها'}. در پیش‌نمایش‌های بعدی نشان داده می‌شود.`];
  }

  previewText(p) {
    const who = p.requester === 'owner' ? 'خودتان' : `شمارهٔ ${p.requester}`;
    return [
      `پیش‌نمایش فاکتور #${p.id} (درخواست از ${who}) — هنوز چیزی در کوییک‌بوکس ساخته نشده`,
      `مشتری: ${p.customer.name}${p.customer.from ? ` (از «${p.customer.from}»)` : ''}`,
      ...(p.docNumber ? [`شمارهٔ فاکتور: ${p.docNumber}`] : []),
      ...p.lines.map((l, i) => `${fa(i + 1)}. ${l.name}${l.sku && norm(l.sku) !== norm(l.name) ? ` [${l.sku}]` : ''} × ${l.qty} @ ${l.price} = ${money(l.amount)}${l.via === 'history' ? ' (از خریدهای قبلی مشتری)' : l.via === 'taught' ? ' (کد آموخته‌شدهٔ مالک)' : ''}`),
      `جمع قبل از مالیات: ${money(p.subtotal)}`,
      p.tax.source === 'invoices' ? `مالیات: ${p.tax.name} ${p.tax.rate}٪ (از ${fa(p.tax.n)} سطر از ${fa(p.tax.total)} سطر فاکتورهای قبلی): ${money(p.vat)}` : `مالیات ${p.tax.rate}٪ (${p.tax.name}${p.tax.source === 'owner' ? '، انتخاب مالک' : p.tax.source === 'item' ? '، کد خود کالا' : p.tax.source === 'override' ? '، تنظیم مالک' : ''}): ${money(p.vat)}`,
      `جمع کل: ${money(p.total)}${p.currency ? ` ${p.currency}` : ''}`,
      ...(p.warnings.length ? ['⚠️ هشدارها:', ...p.warnings.map((w) => `• ${w}`)] : []),
      `برای ساخت: «بله #${p.id}» — برای لغو: «نه #${p.id}» (۲۴ ساعت اعتبار)`,
    ].join('\n');
  }

  /** The owner's answer in his own chat. Returns the lines to tell him. */
  async decide({ verb, id }) {
    const p = this.store.get(id);
    if (!p) return [`پیش‌نمایش ${id} پیدا نشد.`];
    if (verb === 'no') {
      if (p.status === 'created') return [`فاکتور ${p.id} پیش‌تر ساخته شده است (شمارهٔ ${p.qbo?.docNumber}). لغو آن از اینجا ممکن نیست.`];
      p.status = 'cancelled'; this.store.save(); this.audit.add({ event: 'cancel', previewId: p.id, approver: 'owner' });
      return [`پیش‌نمایش ${p.id} لغو شد. چیزی ساخته نشد.`];
    }
    if (p.status === 'created') return [`فاکتور ${p.id} پیش‌تر ساخته شده است: شمارهٔ ${p.qbo.docNumber}، جمع ${money(p.qbo.total)}. دوباره ساخته نشد.`];
    if (p.status === 'cancelled') return [`پیش‌نمایش ${p.id} لغو شده بود.`];
    if (p.status === 'expired' || this.now() - p.at > EXPIRY_MS) {
      if (p.status !== 'expired') { p.status = 'expired'; this.store.save(); this.audit.add({ event: 'expire', previewId: p.id }); }
      return [`پیش‌نمایش ${p.id} بیش از ۲۴ ساعت پیش است و منقضی شد. دوباره درخواست کنید.`];
    }
    const blocked = this.guard();
    if (blocked) { this.audit.add({ event: 'refuse', previewId: p.id, reason: 'guard' }); return [blocked]; }
    if (!this.qbo.writeOn) { this.audit.add({ event: 'refuse', previewId: p.id, reason: 'write-off' }); return ['نوشتن در کوییک‌بوکس خاموش است؛ فاکتور ساخته نشد. پیش‌نمایش می‌ماند.']; }
    const c = this.store.counts(this.now());
    if (c.hour >= CAP_HOUR || c.day >= CAP_DAY) { this.audit.add({ event: 'refuse', previewId: p.id, reason: 'cap' }); return [`سقف ساخت فاکتور پر است (${fa(CAP_HOUR)} در ساعت، ${fa(CAP_DAY)} در روز). بعداً دوباره «بله #${p.id}» بنویسید.`]; }
    if (this.inflight.has(p.id)) return [`فاکتور ${p.id} همین حالا در حال ساخته شدن است؛ چند لحظه صبر کنید.`];
    if (p.customTxn && !p.docNumber) { this.audit.add({ event: 'refuse', previewId: p.id, reason: 'no-number' }); return ['شرکت فاکتورها را دستی شماره می‌زند و این پیش‌نمایش شماره ندارد؛ ساخته نشد. دوباره درخواست کنید.']; }
    if (p.docNumber) {
      let taken = true;
      try { taken = await this.docNumberTaken(p.docNumber); } catch (e) { this.log(`invoice number check failed: ${e.name}`); return ['بررسی آزاد بودن شمارهٔ فاکتور نشد؛ ساخته نشد. دوباره «بله» بنویسید.']; }
      if (taken) {
        const n = await this.nextDocNumber(p.id).catch(() => ({ error: 'x' }));
        if (n.docNumber) { const old = p.docNumber; p.docNumber = n.docNumber; this.store.save(); this.audit.add({ event: 'renumber', previewId: p.id, reason: `${old}->${n.docNumber}` }); return [`شمارهٔ ${old} در این فاصله مصرف شد. شمارهٔ تازه ${n.docNumber} شد و چیزی ساخته نشد؛ اگر با آن موافقید دوباره «بله #${p.id}» بنویسید.`]; }
        return ['شمارهٔ فاکتور مصرف شده و شمارهٔ تازه پیدا نشد؛ ساخته نشد. دوباره درخواست کنید.'];
      }
    }
    // the attempt is counted and remembered BEFORE the call; the request id belongs to the preview, so a retry returns the same invoice
    p.status = 'creating'; this.store.recordCreate(this.now()); this.store.save();
    this.inflight.add(p.id);
    const body = this.invoiceBody(p);
    let created;
    try {
      const j = await this.qbo.write('POST', 'invoice', body, { requestId: `atossa-${p.id}-${p.nonce}` });
      created = j?.Invoice;
      if (!created?.Id) throw new Error('no invoice in the answer');
    } catch (e) {
      p.status = 'pending'; this.inflight.delete(p.id); this.store.save();
      this.audit.add({ event: 'failed', previewId: p.id, approver: 'owner', status: e.status || 0 });
      this.log(`QuickBooks invoice create failed: ${e.name} ${e.status || ''}`);
      return [`ساخت فاکتور نشد: ${e.message}. پیش‌نمایش می‌ماند؛ همان «بله #${p.id}» دوباره امن است (دو فاکتور ساخته نمی‌شود).`];
    }
    this.inflight.delete(p.id);
    p.status = 'created';
    p.qbo = { id: String(created.Id), docNumber: created.DocNumber || '', total: fils(created.TotalAmt) };
    this.store.save();
    this.audit.add({ event: 'create', requester: p.requester, approver: 'owner', previewId: p.id, qboId: p.qbo.id, docNumber: p.qbo.docNumber, total: p.qbo.total });
    const out = [`فاکتور ${p.id} در کوییک‌بوکس ساخته شد: شمارهٔ ${p.qbo.docNumber || '(بی‌شماره)'}، جمع ${money(p.qbo.total)}${p.currency ? ` ${p.currency}` : ''}.`];
    // read it back and compare the total with the preview
    try {
      const back = (await this.qbo.get(`invoice/${encodeURIComponent(p.qbo.id)}`))?.Invoice;
      if (back && fils(back.TotalAmt) !== p.total) out.push(`⚠️ جمع کوییک‌بوکس (${money(fils(back.TotalAmt))}) با پیش‌نمایش (${money(p.total)}) نمی‌خواند؛ فاکتور را در کوییک‌بوکس ببینید.`);
    } catch (e) { out.push('خواندن دوبارهٔ فاکتور برای مقایسه نشد.'); }
    // the PDF from QuickBooks to the owner's own chat and to the test group; never to a customer
    try {
      const pdf = await this.qbo.getBinary(`invoice/${encodeURIComponent(p.qbo.id)}/pdf`);
      const caption = `Invoice ${p.qbo.docNumber} - ${p.customer.name} - total ${money(p.qbo.total)}${p.currency ? ` ${p.currency}` : ''}`;
      const fileName = `invoice-${String(p.qbo.docNumber || p.qbo.id).replace(/[^\w.-]+/g, '_')}.pdf`;
      await this.post(this.ownerJid(), pdf, fileName, caption);
      const tg = this.testGroup(await this.groups());
      if (tg) await this.post(tg.id, pdf, fileName, caption); else out.push('گروه آزمایشی پیدا نشد؛ پی‌دی‌اف فقط به گفتگوی خودتان رفت.');
    } catch (e) { out.push('پی‌دی‌اف فاکتور از کوییک‌بوکس گرفته یا فرستاده نشد؛ فاکتور ساخته شده است.'); }
    return out;
  }

  invoiceBody(p) {
    return {
      CustomerRef: { value: p.customer.id },
      ...(p.docNumber ? { DocNumber: p.docNumber } : {}),
      TxnDate: this.today(),
      GlobalTaxCalculation: 'TaxExcluded',
      PrivateNote: `Atossa ${p.id}`,
      ...(p.termId ? { SalesTermRef: { value: p.termId } } : {}),
      ...(p.billEmail ? { BillEmail: { Address: p.billEmail } } : {}),
      Line: p.lines.map((l) => ({
        DetailType: 'SalesItemLineDetail',
        Amount: l.amount / 100,
        ...(l.description ? { Description: l.description } : {}),
        SalesItemLineDetail: { ItemRef: { value: l.itemId }, Qty: l.qty, UnitPrice: l.price, TaxCodeRef: { value: p.tax.id } },
      })),
    };
  }

  /** The last [n] audit lines for the owner (no message text). */
  auditText(n = 10) {
    const rows = this.audit.last(n);
    if (!rows.length) return 'هنوز رویدادی در گزارش کوییک‌بوکس نیست.';
    return ['گزارش کوییک‌بوکس (آخرین رویدادها):', ...rows.map((r) => `${r.at.replace('T', ' ').slice(0, 19)} | ${r.event} | ${r.previewId || '-'}${r.requester ? ` | درخواست: ${r.requester}` : ''}${r.approver ? ` | تأیید: ${r.approver}` : ''}${r.docNumber ? ` | شمارهٔ ${r.docNumber}` : ''}${r.qboId ? ` | شناسه ${r.qboId}` : ''}${r.total !== undefined ? ` | جمع ${money(r.total)}` : ''}${r.reason ? ` | ${r.reason}` : ''}`)].join('\n');
  }
}


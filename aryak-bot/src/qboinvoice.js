// CREATING AN INVOICE IN QUICKBOOKS, WITH THE OWNER'S YES. Who asks: the owner (his own chat) and people the owner authorizes (their private chat with the
// bot). The request is "فاکتور بساز <customer>" and one line per item. It is only ever a PREVIEW (#Q12) sent to the OWNER's own chat; nothing exists in
// QuickBooks until the owner himself writes "بله #Q12" there (no other yes counts, not even the requester's). The create call carries a request id
// that belongs to the preview, so a second yes can never make a second invoice. The customer and every item must match EXACTLY (or a choice the owner
// confirmed): an unknown one stops the preview with the candidates. The VAT code is read from QuickBooks (the 5% standard-rated sales code), never an
// id written here. Safety: a kill switch in the client, at most 10 creations an hour and 40 a day, an append-only audit log, only the "create invoice"
// write exists, and QBO_WRITE off refuses everything. Nothing here sends anything to a customer.

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { staffChecker } from './gate.js';

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
  const first = plain(raw.split('\n')[0]).replace(/^آتوسا[ ,،:]*/u, '');
  let m = /^فاکتور\s+بساز(?:ید)?\s+(.+)$/u.exec(first);
  if (m) return { type: 'request', customer: m[1].trim(), lines: raw.split('\n').slice(1).map((l) => l.trim()).filter(Boolean) };
  const s = plain(raw).replace(/[.!؟?]+$/u, '').trim();
  if ((m = /^(بله|اره|آره|نه|خیر|yes|no)\s*#?\s*Q\s*(\d+)$/iu.exec(s))) return { type: /^(?:بله|اره|آره|yes)$/iu.test(m[1]) ? 'yes' : 'no', id: `Q${m[2]}` };
  if (new RegExp(`^توقف\\s*${QB}$`, 'u').test(s)) return { type: 'pause' };
  if (new RegExp(`^ادامه\\s*${QB}$`, 'u').test(s)) return { type: 'resume' };
  if (new RegExp(`^گزارش\\s*${QB}$`, 'u').test(s)) return { type: 'audit' };
  if ((m = /^لغو\s+مجوز\s+فاکتور\s+\+?([\d\s-]{7,20})$/u.exec(s))) return { type: 'auth_remove', number: m[1] };
  if ((m = /^مجوز\s+فاکتور\s+\+?([\d\s-]{7,20})$/u.exec(s))) return { type: 'auth_add', number: m[1] };
  if (/^مجوزها$/u.test(s)) return { type: 'auth_list' };
  return null;
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

/** Items whose Name, Sku or FullyQualifiedName equals [name] exactly (case-insensitive). */
export function itemsNamed(items, name) {
  const k = norm(name);
  return k ? items.filter((i) => [i.Name, i.Sku, i.FullyQualifiedName].some((x) => x && norm(x) === k)) : [];
}

/** Close names for a stop message: never a choice made for the user. */
function closeItems(items, name) {
  const k = norm(name);
  const first = k.split(' ')[0];
  return items.filter((i) => [i.Name, i.Sku].some((x) => x && (norm(x).includes(k) || k.includes(norm(x)) || (first.length >= 3 && norm(x).includes(first))))).slice(0, 3).map((i) => i.Name);
}

/**
 * Every line of the request against the QuickBooks items. Returns { lines, stops }: a line resolves only if exactly ONE reading names exactly ONE
 * item; otherwise it is a stop with the reason and the candidates.
 */
export function resolveLines(rawLines, items) {
  const lines = []; const stops = [];
  rawLines.forEach((raw, i) => {
    const n = i + 1;
    const cands = lineCandidates(raw);
    if (!cands.length) { stops.push(`سطر ${fa(n)} را نفهمیدم: «${raw.slice(0, 60)}» — قالب: نام کالا، تعداد، قیمت (قیمت اختیاری)`); return; }
    const hits = cands.map((c) => ({ c, found: itemsNamed(items, c.item) })).filter((h) => h.found.length);
    if (hits.length !== 1 || hits[0].found.length !== 1) {
      if (!hits.length) { const close = closeItems(items, cands[0].item); stops.push(`سطر ${fa(n)}: کالای «${cands[0].item}» در کوییک‌بوکس دقیقاً پیدا نشد؛ اول آن را معرفی کنید.${close.length ? ` نزدیک‌ها: ${close.join(' | ')}` : ''}`); } else stops.push(`سطر ${fa(n)}: «${raw.slice(0, 60)}» بیش از یک جور خوانده می‌شود؛ با ویرگول بنویسید: نام کالا، تعداد، قیمت`);
      return;
    }
    const { c, found } = hits[0];
    if (!(c.qty > 0 && c.qty <= 100000)) { stops.push(`سطر ${fa(n)}: تعداد درست نیست`); return; }
    if (c.price !== null && !(c.price >= 0 && c.price <= 10000000)) { stops.push(`سطر ${fa(n)}: قیمت درست نیست`); return; }
    lines.push({ n, item: found[0], qty: c.qty, price: c.price });
  });
  return { lines, stops };
}

/** The 5% standard-rated sales tax code of the company, read from QuickBooks; or { error, candidates }. [wanted]: an optional name to use. */
export function findVatCode(taxCodes, taxRates, wanted = '') {
  const rate = new Map(taxRates.map((r) => [String(r.Id), Number(r.RateValue)]));
  const withRate = taxCodes.filter((t) => t.Active !== false && t.Taxable !== false && t.SalesTaxRateList?.TaxRateDetail?.length)
    .map((t) => ({ id: String(t.Id), name: t.Name, rate: t.SalesTaxRateList.TaxRateDetail.reduce((s, d) => s + (rate.get(String(d.TaxRateRef?.value)) || 0), 0) }));
  if (wanted) { const w = withRate.filter((t) => norm(t.name) === norm(wanted) || t.id === String(wanted)); return w.length === 1 ? w[0] : { error: 'کد مالیاتی تعیین‌شده پیدا نشد', candidates: withRate.map((t) => `${t.name} (${t.rate}%)`) }; }
  const five = withRate.filter((t) => Math.abs(t.rate - 5) < 1e-9);
  if (five.length === 1) return five[0];
  if (!five.length) return { error: 'کد مالیات بر ارزش افزودهٔ ۵ درصد در کوییک‌بوکس پیدا نشد', candidates: withRate.map((t) => `${t.name} (${t.rate}%)`) };
  const std = five.filter((t) => /standard/i.test(t.name));
  if (std.length === 1) return std[0];
  return { error: 'چند کد مالیاتی ۵ درصد هست؛ نام درست را در تنظیم QBO_TAX_CODE بگذارید', candidates: five.map((t) => t.name) };
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

/** The append-only audit log: time, requester, approver, preview id, QuickBooks id, document number, total. Never a message text. */
export class Audit {
  constructor(dir = '', now = () => Date.now()) { this.file = dir ? path.join(dir, 'qbo-audit.log') : ''; this.now = now; }
  add(entry) { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.appendFileSync(this.file, `${JSON.stringify({ at: new Date(this.now()).toISOString(), ...entry })}\n`, { mode: 0o600 }); } catch { /* best effort */ } }
  last(n = 10) { try { return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l)); } catch { return []; } }
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
  constructor({ qbo, desk, store, audit, book = null, config, today, now = () => Date.now(), post, ownerJid, groups, testGroup, log = () => {} }) {
    Object.assign(this, { qbo, desk, store, audit, book, config, today, now, post, ownerJid, groups, testGroup, log });
    this.cache = { at: 0, items: [], tax: null, currency: '' };
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
    this.cache = { at: this.now(), items, tax: findVatCode(taxCodes, taxRates, this.config.qboTaxCode || ''), currency: prefs?.CurrencyPrefs?.HomeCurrency?.value || '' };
    return this.cache;
  }

  guard() {
    if (this.qbo.paused) return 'کوییک‌بوکس با فرمان مالک متوقف است؛ بنویسید: ادامهٔ کوییک‌بوکس';
    if (!this.qbo.configured) return `کوییک‌بوکس هنوز تنظیم نشده است. تنظیم‌های کم: ${this.qbo.missing.join('، ')}`;
    if (this.qbo.needsReconnect) return 'کوییک‌بوکس باید دوباره وصل شود؛ بنویسید: اتصال کوییک‌بوکس';
    if (!this.qbo.connected) return 'کوییک‌بوکس وصل نیست؛ بنویسید: اتصال کوییک‌بوکس';
    return '';
  }

  /**
   * A request to make an invoice -> a PREVIEW sent to the owner. Returns { requester, owner }: the note for the person who asked, and the preview for
   * the owner (null when the request stopped; then the requester's text says why). Never creates anything.
   */
  async request({ text, requester }) {
    const cmd = parseInvoiceCommand(text);
    if (cmd?.type !== 'request') return { requester: 'Write: فاکتور بساز <customer> and then one item per line: item, quantity, price (price optional).', owner: null };
    const stop = (msg) => ({ requester: msg, owner: null });
    const blocked = this.guard();
    if (blocked) return stop(blocked);
    if (!cmd.lines.length) return stop('بعد از نام مشتری، هر کالا را در یک سطر بنویسید: نام کالا، تعداد، قیمت (قیمت اختیاری).');
    if (cmd.lines.length > MAX_LINES) return stop(`حداکثر ${fa(MAX_LINES)} سطر در یک فاکتور.`);
    const cust = await this.desk.resolveStrict(cmd.customer);
    if (!cust.id) {
      const how = cust.ambiguous ? `چند مشتری با این نام دقیق هست: ${cust.ambiguous.map((c) => c.DisplayName).join(' | ')}` : cust.options?.length ? `نزدیک‌ها: ${cust.options.map((o) => o.name).join(' | ')}` : 'مشتری مشابهی هم پیدا نشد';
      return stop(`مشتری «${cust.ours}» با نام دقیق یا انتخاب تأییدشدهٔ مالک در کوییک‌بوکس نیست؛ اول معرفی شود (تطبیق کوییک‌بوکس). ${how}`);
    }
    const cat = await this.catalog();
    if (cat.tax.error) return stop(`${cat.tax.error}.${cat.tax.candidates?.length ? ` کدهای موجود: ${cat.tax.candidates.join(' | ')}` : ''}`);
    const { lines, stops } = resolveLines(cmd.lines, cat.items);
    if (stops.length) return stop(`فاکتور ساخته نمی‌شود؛ این‌ها را درست کنید:\n${stops.join('\n')}`);
    const warnings = []; const out = [];
    for (const l of lines) {
      const listed = Number(l.item.UnitPrice) > 0 ? Number(l.item.UnitPrice) : null; // no price in QuickBooks (or zero) = no price to default to
      const price = l.price ?? listed;
      if (price === null || Number.isNaN(price)) { return stop(`برای کالای «${l.item.Name}» در کوییک‌بوکس قیمتی نیست؛ قیمت را در همان سطر بنویسید.`); }
      const amount = fils(l.qty * price);
      const w = [];
      if (listed !== null && l.price !== null && l.price < listed - 0.005) w.push(`قیمت کمتر از قیمت کوییک‌بوکس (${listed})`);
      const code = l.item.Sku || l.item.Name;
      const pb = this.book?.priceOf?.(code, cust.ours, this.today());
      if (pb && pb.price !== undefined && price < Number(pb.price) - 0.005) w.push(`قیمت کمتر از فهرست قیمت مالک (${pb.price})`);
      if (w.length) warnings.push(`سطر ${fa(l.n)} (${l.item.Name}): ${w.join('، ')}`);
      out.push({ itemId: String(l.item.Id), name: l.item.Name, sku: l.item.Sku || '', qty: l.qty, price, amount });
    }
    const t = totals(out, cat.tax.rate);
    const id = this.store.nextId();
    const preview = {
      id, nonce: randomBytes(5).toString('hex'), at: this.now(), status: 'pending', requester, customer: { ours: cust.ours, id: cust.id, name: cust.name },
      lines: out, tax: { id: cat.tax.id, name: cat.tax.name, rate: cat.tax.rate }, ...t, currency: cat.currency, warnings,
    };
    this.store.add(preview);
    this.audit.add({ event: 'preview', requester, previewId: id, total: t.total });
    return { requester: `Your invoice request #${id} for ${cust.name} was sent to the owner for approval (total ${money(t.total)}). You will be told when it is created or refused.`, owner: this.previewText(preview) };
  }

  previewText(p) {
    const who = p.requester === 'owner' ? 'خودتان' : `شمارهٔ ${p.requester}`;
    return [
      `پیش‌نمایش فاکتور #${p.id} (درخواست از ${who}) — هنوز چیزی در کوییک‌بوکس ساخته نشده`,
      `مشتری: ${p.customer.name}`,
      ...p.lines.map((l, i) => `${fa(i + 1)}. ${l.name} × ${l.qty} @ ${l.price} = ${money(l.amount)}`),
      `جمع قبل از مالیات: ${money(p.subtotal)}`,
      `مالیات ${p.tax.rate}٪ (${p.tax.name}): ${money(p.vat)}`,
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
      TxnDate: this.today(),
      GlobalTaxCalculation: 'TaxExcluded',
      PrivateNote: `Atossa ${p.id}`,
      Line: p.lines.map((l) => ({
        DetailType: 'SalesItemLineDetail',
        Amount: l.amount / 100,
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


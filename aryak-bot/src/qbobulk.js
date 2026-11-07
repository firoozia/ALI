// OWNER-ONLY BULK JOBS IN QUICKBOOKS, all with the same pattern as the name job (#N): a PREVIEW with counts and the first fifteen "old -> new" (id like #E1,
// valid 24 hours), only the owner's "بله #E1" in his own chat applies it, one sparse update at a time with a short pause, each record read fresh just before
// (already done = skipped, so a re-run is harmless), stop at the first unexpected error and say how far it got, the kill switch and QBO_WRITE respected,
// every change audit logged, the bot's caches refreshed. Each job may change ONLY its own fields:
//   E  «ایمیل مشتری‌ها»      customer  PrimaryEmailAddr         (the company's own address, so QuickBooks mail comes to the company)
//   M  «موبایل مشتری‌ها»     customer  Mobile                   (copied from PrimaryPhone / AlternatePhone when it is a UAE or Oman mobile; the phones are never cleared)
//   T  «مالیات کالاها دبی»   item      SalesTaxCodeRef          (the Dubai standard-rated code, found by name at run time)
//   P  «قیمت <کد> = <عدد>»   item      UnitPrice                (a draft of base prices given one by one; «شروع کن» makes the preview)
// Nothing here creates, deletes or deactivates anything.

import fs from 'node:fs';
import path from 'node:path';
import { pickItem } from './qboinvoice.js';

const latinDigits = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const DAY = 86400000;
const SHOWN = 15;
const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ITEM_TYPES = ['Inventory', 'NonInventory', 'Service'];
export const DEFAULT_ITEM_TAX = 'SR Standard Rated (DXB)';

// ---------------------------------------------------------------------------------------------------------------- phones
/** Is this phone text a mobile, a landline or something else? [country]: the customer's country text (an 8-digit 9xxxxxxx / 7xxxxxxx is an Oman mobile only there). */
export function phoneKind(text, country = '') {
  let d = latinDigits(String(text || '')).replace(/\D/g, '');
  if (!d) return 'none';
  if (d.startsWith('00')) d = d.slice(2);
  if (/^05\d{8}$/.test(d) || /^9715\d{8}$/.test(d)) return 'mobile'; // UAE 05x / 9715x / +9715x
  if (/^968[97]\d{7}$/.test(d)) return 'mobile'; // Oman mobile
  if (/^[97]\d{7}$/.test(d) && /oman|عمان/i.test(country)) return 'mobile';
  if (/^0[234679]\d{7}$/.test(d) || /^971[234679]\d{7}$/.test(d) || /^968[2]\d{7}$/.test(d)) return 'landline'; // 04-, 02-, +9714..., Oman 2xxxxxxx
  return 'other';
}

/** The phone text as written: only a leading apostrophe and the spaces at the ends are taken off. */
export const cleanPhone = (t) => String(t || '').trim().replace(/^'+/, '').trim();
const phoneOf = (c, k) => cleanPhone(c?.[k]?.FreeFormNumber);
const countryOf = (c) => `${c?.BillAddr?.Country || ''} ${c?.ShipAddr?.Country || ''}`;

// ---------------------------------------------------------------------------------------------------------------- the plans (pure)
export function planEmails(customers, email) {
  const changes = []; let unchanged = 0;
  for (const c of customers) {
    const cur = String(c.PrimaryEmailAddr?.Address || '');
    if (cur.toLowerCase() === email.toLowerCase()) { unchanged += 1; continue; }
    changes.push({ id: String(c.Id), label: c.DisplayName, old: cur, new: email });
  }
  return { changes, skipped: [], unchanged };
}

export function planMobiles(customers) {
  const changes = []; const skipped = []; let hasMobile = 0; let noPhone = 0;
  for (const c of customers) {
    if (phoneOf(c, 'Mobile')) { hasMobile += 1; continue; }
    const phones = [['PrimaryPhone', phoneOf(c, 'PrimaryPhone')], ['AlternatePhone', phoneOf(c, 'AlternatePhone')]].filter(([, t]) => t);
    if (!phones.length) { noPhone += 1; continue; }
    const hit = phones.find(([, t]) => phoneKind(t, countryOf(c)) === 'mobile');
    if (hit) { changes.push({ id: String(c.Id), label: c.DisplayName, old: '', new: hit[1], from: hit[0] }); continue; }
    const land = phones.find(([, t]) => phoneKind(t, countryOf(c)) === 'landline');
    skipped.push({ id: String(c.Id), label: c.DisplayName, why: land ? 'landline' : 'other', phone: (land || phones[0])[1] });
  }
  return { changes, skipped, unchanged: hasMobile, hasMobile, noPhone };
}

export function planItemTax(items, code) {
  const changes = []; let unchanged = 0;
  for (const i of items) {
    if (!ITEM_TYPES.includes(i.Type)) continue;
    if (String(i.SalesTaxCodeRef?.value || '') === code.id) { unchanged += 1; continue; }
    changes.push({ id: String(i.Id), label: i.Name, old: String(i.SalesTaxCodeRef?.value || ''), new: code.id });
  }
  return { changes, skipped: [], unchanged };
}

// ---- the PVC film series: the code of an item is the three-digit number in its name (PVC FILM108 -> 108); a series 100 is the codes 101 to 199
/** The three-digit code of a PVC film item, or null (edge banding, boards and four-digit codes are never in a series). */
export function pvcCode(i) {
  const name = String(i?.Name || '');
  if (!/pvc\s*film/i.test(name)) return null;
  const m = /pvc\s*film\s*(\d{3})(?!\d)/i.exec(name) || /^(\d{3})$/.exec(String(i.Sku || '').trim());
  return m ? Number(m[1]) : null;
}
/** The active PVC film items whose code is lo..hi: [{ item, code }] by code. */
export function seriesItems(items, lo, hi) {
  return items.filter((i) => i.Active !== false && ITEM_TYPES.includes(i.Type)).map((item) => ({ item, code: pvcCode(item) })).filter((x) => x.code !== null && x.code >= lo && x.code <= hi).sort((a, b) => a.code - b.code);
}
/** "۱۰۱ تا ۱۲۶، بدون ۱۱۳": the range found, with the gaps inside it. */
export function rangeText(codes) {
  if (!codes.length) return '—';
  const have = new Set(codes); const lo = Math.min(...codes); const hi = Math.max(...codes);
  const gaps = []; for (let c = lo; c <= hi; c += 1) if (!have.has(c)) gaps.push(c);
  return `${fa(lo)} تا ${fa(hi)}${gaps.length ? `، بدون ${gaps.map(fa).join('، ')}` : ''}`;
}
/** "۲۰ کالا 10 → 12، ۶ کالا 11 → 12": the old prices grouped. */
export function oldGroups(items, price) {
  const g = new Map(); for (const i of items) { const o = Number(i.UnitPrice) || 0; g.set(o, (g.get(o) || 0) + 1); }
  return [...g.entries()].map(([o, n]) => `${fa(n)} کالا ${o} → ${price}`).join('، ');
}
/** The series bounds from a draft entry: «سری 100» = 101..199; an explicit range as given. null: not a valid series number. */
export function seriesBounds({ series, from, to }) {
  if (series !== undefined) return series > 0 && series % 100 === 0 ? { lo: series + 1, hi: series + 99, label: `سری ${series}` } : null;
  const lo = Math.min(from, to); const hi = Math.max(from, to);
  return { lo, hi, label: `${lo} تا ${hi}` };
}
/** The draft as one list of items: a single code line wins over its series, whatever the order. Each line: { itemId, name, new, group }. */
export function expandDraft(draft, items) {
  const single = new Map(draft.lines.map((l) => [String(l.itemId), l]));
  const out = draft.lines.map((l) => ({ itemId: l.itemId, name: l.name, new: l.new, group: '' }));
  const groups = [];
  for (const s of draft.series) {
    const found = seriesItems(items, s.lo, s.hi);
    const own = found.filter((x) => single.has(String(x.item.Id)));
    groups.push({ ...s, found, own: own.length });
    for (const x of found) if (!single.has(String(x.item.Id))) out.push({ itemId: String(x.item.Id), name: x.item.Name, new: s.price, group: s.label });
  }
  return { lines: out, groups };
}

/** The draft lines against the current items: old -> new and the warnings (a change over 30%, a new price below the purchase cost). */
export function planPrices(lines, items) {
  const byId = new Map(items.map((i) => [String(i.Id), i]));
  const changes = []; const skipped = []; let unchanged = 0;
  for (const l of lines) {
    const it = byId.get(String(l.itemId));
    if (!it) { skipped.push({ id: String(l.itemId), label: l.name, why: 'gone' }); continue; }
    const old = Number(it.UnitPrice) || 0;
    if (old === l.new) { unchanged += 1; continue; }
    const warn = [];
    if (old > 0 && Math.abs(l.new - old) / old > 0.3) warn.push(`تغییر بیش از ۳۰٪ (${Math.round((Math.abs(l.new - old) / old) * 100)}٪)`);
    if (Number(it.PurchaseCost) > 0 && l.new < Number(it.PurchaseCost)) warn.push(`قیمت تازه کمتر از بهای خرید (${it.PurchaseCost})`);
    changes.push({ id: String(it.Id), label: it.Name, old, new: l.new, warn, group: l.group || '' });
  }
  return { changes, skipped, unchanged };
}

// ---------------------------------------------------------------------------------------------------------------- the stores
export class BulkPreviews {
  constructor(dir = '') { this.file = dir ? path.join(dir, 'qbo-bulk.json') : ''; this.d = { n: {}, previews: {} }; try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ } }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  add(kind, p) { this.d.n[kind] = (this.d.n[kind] || 0) + 1; const id = `${kind}${this.d.n[kind]}`; this.d.previews[id] = { ...p, kind, id }; this.save(); return this.d.previews[id]; }
  get(id) { return this.d.previews[String(id).toUpperCase()] || null; }
}

/** The base prices the owner gives one by one, kept on the VM until «شروع کن». */
export class PriceDraft {
  constructor(dir = '') { this.file = dir ? path.join(dir, 'qbo-pricedraft.json') : ''; this.d = { lines: [], series: [] }; try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ } }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  get lines() { return this.d.lines; }
  get series() { return this.d.series; }
  get size() { return this.d.lines.length + this.d.series.length; }
  setSeries(s) { this.d.series = [...this.d.series.filter((x) => !(x.lo === s.lo && x.hi === s.hi)), s]; this.save(); }
  removeSeries(label) { const k = norm(label); const n = this.d.series.length; this.d.series = this.d.series.filter((x) => norm(x.label) !== k); this.save(); return this.d.series.length < n; }
  dropSeries(keys) { const s = new Set(keys); this.d.series = this.d.series.filter((x) => !s.has(`${x.lo}-${x.hi}-${x.price}`)); this.save(); }
  set(line) { this.d.lines = [...this.d.lines.filter((l) => String(l.itemId) !== String(line.itemId)), line]; this.save(); }
  remove(code) { const k = norm(code); const n = this.d.lines.length; this.d.lines = this.d.lines.filter((l) => norm(l.code) !== k && norm(l.name) !== k); this.save(); return this.d.lines.length < n; }
  dropItems(ids) { const s = new Set(ids.map(String)); this.d.lines = this.d.lines.filter((l) => !s.has(String(l.itemId))); this.save(); }
}

// ---------------------------------------------------------------------------------------------------------------- the jobs: the fields each may change
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const JOBS = {
  E: {
    title: 'ایمیل مشتری‌ها', entity: 'customer', fields: ['PrimaryEmailAddr'],
    body: (cur, ch, p) => (same(cur.PrimaryEmailAddr?.Address, p.params.email) ? null : { PrimaryEmailAddr: { Address: p.params.email } }),
    audit: (cur, body) => ({ field: 'PrimaryEmailAddr' }),
  },
  M: {
    title: 'موبایل مشتری‌ها', entity: 'customer', fields: ['Mobile'],
    body: (cur) => { if (phoneOf(cur, 'Mobile')) return null; const hit = planMobiles([cur]).changes[0]; return hit ? { Mobile: { FreeFormNumber: hit.new } } : null; },
    audit: (cur, body) => ({ field: 'Mobile', last4: String(body.Mobile.FreeFormNumber).replace(/\D/g, '').slice(-4) }),
  },
  T: {
    title: 'مالیات کالاها', entity: 'item', fields: ['SalesTaxCodeRef'],
    body: (cur, ch, p) => (String(cur.SalesTaxCodeRef?.value || '') === p.params.codeId ? null : { SalesTaxCodeRef: { value: p.params.codeId } }),
    audit: (cur, body, p) => ({ field: 'SalesTaxCodeRef', old: String(cur.SalesTaxCodeRef?.value || ''), new: p.params.codeId }),
  },
  P: {
    title: 'قیمت پایهٔ کالاها', entity: 'item', fields: ['UnitPrice'],
    body: (cur, ch) => (Number(cur.UnitPrice) === ch.new ? null : { UnitPrice: ch.new }),
    audit: (cur, body) => ({ field: 'UnitPrice', old: Number(cur.UnitPrice) || 0, new: body.UnitPrice }),
  },
};

export class QboBulkDesk {
  /** [qbo]; [desk]: the QboDesk (its customer cache is refreshed); [audit]; [store]: BulkPreviews; [draft]: PriceDraft; [itemCodes]: the taught codes; [config]. */
  constructor({ qbo, desk, audit, store, draft, itemCodes, config = {}, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = 400, log = () => {} }) {
    Object.assign(this, { qbo, desk, audit, store, draft, itemCodes, config, now, sleep, gapMs, log });
    this.busy = false;
    this.finish = null;
    this.itemCache = { at: 0, items: [] };
  }

  guard() {
    if (this.qbo.paused) return 'کوییک‌بوکس با فرمان مالک متوقف است؛ بنویسید: ادامهٔ کوییک‌بوکس';
    if (!this.qbo.configured) return `کوییک‌بوکس هنوز تنظیم نشده است. تنظیم‌های کم: ${this.qbo.missing.join('، ')}`;
    if (this.qbo.needsReconnect) return 'کوییک‌بوکس باید دوباره وصل شود؛ بنویسید: اتصال کوییک‌بوکس';
    if (!this.qbo.connected) return 'کوییک‌بوکس وصل نیست؛ بنویسید: اتصال کوییک‌بوکس';
    return '';
  }

  async items(fresh = false) {
    if (!fresh && this.now() - this.itemCache.at < 5 * 60 * 1000 && this.itemCache.items.length) return this.itemCache.items;
    const items = await this.qbo.query('select * from Item where Active = true');
    this.itemCache = { at: this.now(), items };
    return items;
  }

  /** The ids of the previews the owner can still say yes or no to. */
  openIds() { return Object.values(this.store.d.previews).filter((p) => p.status === 'pending' && this.now() - p.at <= DAY).map((p) => p.id); }

  /** Stores a preview and builds its text. */
  make(kind, r, { header, summary, lines, extra = [], params = {} }) {
    const p = this.store.add(kind, { at: this.now(), status: 'pending', changes: r.changes, skipped: r.skipped, unchanged: r.unchanged, params });
    this.audit.add({ event: 'bulk-preview', kind, previewId: p.id, total: r.changes.length });
    return [[
      `پیش‌نمایش ${header} #${p.id} — هنوز چیزی در کوییک‌بوکس تغییر نکرده`,
      summary,
      ...lines.slice(0, SHOWN),
      ...(lines.length > SHOWN ? [`… و ${fa(lines.length - SHOWN)} مورد دیگر`] : []),
      ...extra,
      `برای اجرا: «بله #${p.id}» — برای لغو: «نه #${p.id}» (۲۴ ساعت اعتبار)`,
    ].join('\n')];
  }

  // ------------------------------------------------------------------------------------------------ E: the e-mail
  async planEmails(email) {
    const blocked = this.guard();
    if (blocked) return [blocked];
    const address = String(email || this.config.qboCustomerEmail || '').trim();
    if (!EMAIL.test(address)) return ['نشانی ایمیل شرکت را بنویسید: «ایمیل مشتری‌ها <نشانی>» (یا در تنظیم‌ها بگذارید).'];
    const customers = await this.qbo.query('select * from Customer');
    const r = planEmails(customers, address);
    if (!r.changes.length) return [`ایمیل همهٔ ${fa(customers.length)} مشتری از پیش ${address} است؛ چیزی برای تغییر نیست.`];
    return this.make('E', r, {
      header: 'ایمیل مشتری‌ها', params: { email: address },
      summary: `از ${fa(customers.length)} مشتری: ${fa(r.changes.length)} تغییر می‌کند و ${fa(r.unchanged)} از پیش درست است. فقط ایمیل اصلی مشتری به ${address} می‌شود؛ تلفن و بقیهٔ فیلدها دست‌نخورده می‌ماند.`,
      lines: r.changes.map((c, i) => `${fa(i + 1)}. ${c.label}: ${c.old || '—'} → ${address}`),
    });
  }

  // ------------------------------------------------------------------------------------------------ M: the mobile
  async planMobiles() {
    const blocked = this.guard();
    if (blocked) return [blocked];
    const customers = await this.qbo.query('select * from Customer');
    const r = planMobiles(customers);
    if (!r.changes.length) return [`موبایلی برای کپی نیست (${fa(r.hasMobile)} مشتری موبایل دارد، ${fa(r.skipped.length)} فقط ثابت یا قالب دیگر، ${fa(r.noPhone)} بدون تلفن).`];
    const land = r.skipped.filter((s) => s.why === 'landline');
    const other = r.skipped.filter((s) => s.why === 'other');
    return this.make('M', r, {
      header: 'موبایل مشتری‌ها',
      summary: `از ${fa(customers.length)} مشتری: ${fa(r.changes.length)} موبایل کپی می‌شود، ${fa(r.hasMobile)} از پیش موبایل دارد، ${fa(land.length)} رد شد (تلفن ثابت)، ${fa(other.length)} رد شد (قالب نامعلوم)، ${fa(r.noPhone)} بدون تلفن. تلفن اصلی هیچ‌جا پاک نمی‌شود؛ فقط کپی می‌شود.`,
      lines: r.changes.map((c, i) => `${fa(i + 1)}. ${c.label}: ${c.new} (از ${c.from === 'PrimaryPhone' ? 'تلفن اصلی' : 'تلفن دوم'})`),
      extra: [...(land.length ? ['رد شد: تلفن ثابت —', ...land.slice(0, SHOWN).map((s) => `• ${s.label}: ${s.phone}`), ...(land.length > SHOWN ? [`… و ${fa(land.length - SHOWN)} مورد دیگر`] : [])] : []),
        ...(other.length ? [`رد شد: قالب نامعلوم — ${fa(other.length)} مشتری`] : [])],
    });
  }

  // ------------------------------------------------------------------------------------------------ T: the items' tax code
  async planItemTax() {
    const blocked = this.guard();
    if (blocked) return [blocked];
    const want = this.config.qboItemTaxCode || DEFAULT_ITEM_TAX;
    const codes = (await this.qbo.query('select * from TaxCode')).filter((t) => t.Active !== false && norm(t.Name) === norm(want));
    if (codes.length !== 1) return [codes.length ? `کد مالیاتی «${want}» بیش از یک بار هست؛ ایستادم.` : `کد مالیاتی «${want}» در کوییک‌بوکس پیدا نشد؛ ایستادم و چیزی تغییر نکرد.`];
    const code = { id: String(codes[0].Id), name: codes[0].Name };
    const allCodes = new Map((await this.qbo.query('select * from TaxCode')).map((t) => [String(t.Id), t.Name]));
    const items = await this.items(true);
    const r = planItemTax(items, code);
    if (!r.changes.length) return [`کد مالیات همهٔ کالاها از پیش «${code.name}» است؛ چیزی برای تغییر نیست.`];
    return this.make('T', r, {
      header: 'مالیات کالاها', params: { codeId: code.id, codeName: code.name },
      summary: `کد «${code.name}» برای کالاهای نوع موجودی، غیرموجودی و خدمت: از ${fa(items.length)} کالا ${fa(r.changes.length)} تغییر می‌کند و ${fa(r.unchanged)} از پیش درست است. فقط کد مالیات فروش کالا عوض می‌شود.`,
      lines: r.changes.map((c, i) => `${fa(i + 1)}. ${c.label}: ${allCodes.get(c.old) || 'بدون کد'} → ${code.name}`),
    });
  }

  // ------------------------------------------------------------------------------------------------ P: base prices one by one
  /** «قیمت 108 = 12» (several lines allowed): each line is resolved to ONE item and added to the draft; an unclear one is not taken. */
  async addPrices(lines) {
    const blocked = this.guard();
    if (blocked) return [blocked];
    const items = await this.items();
    const ctx = { items, history: null, taught: (c) => { const t = this.itemCodes?.get('', c); return t ? items.find((i) => String(i.Id) === String(t.itemId)) || null : null; } };
    const out = [];
    for (const ln of lines) {
      const { code, price } = ln;
      if (code === undefined) {
        const b = seriesBounds(ln);
        if (!b) { out.push(`✖ «سری ${ln.series}» درست نیست؛ سری‌ها صدتا صدتاست (سری ۱۰۰، سری ۲۰۰، …). این خط گرفته نشد.`); continue; }
        const found = seriesItems(items, b.lo, b.hi);
        if (!found.length) { out.push(`✖ ${b.label}: هیچ کالای فیلم پی‌وی‌سی با این کدها پیدا نشد. این خط گرفته نشد.`); continue; }
        this.draft.setSeries({ lo: b.lo, hi: b.hi, price, label: b.label });
        const own = found.filter((x) => this.draft.lines.some((l) => String(l.itemId) === String(x.item.Id)));
        out.push(`✓ ${b.label}: ${rangeText(found.map((x) => x.code))}، ${fa(found.length)} کالا؛ ${oldGroups(found.map((x) => x.item), price)}${own.length ? `\n   ${fa(own.length)} کالای آن خط جدا دارد و قیمت خط جدا را می‌گیرد` : ''}`);
        continue;
      }
      const r = pickItem(code, ctx);
      if (!r.item) { out.push(`✖ ${r.stop(1).replace(/^سطر ۱: /, '')}\n   این خط گرفته نشد.`); continue; }
      const old = Number(r.item.UnitPrice) || 0;
      this.draft.set({ code, itemId: String(r.item.Id), name: r.item.Name, old, new: price });
      const inSeries = this.draft.series.find((s) => { const c = pvcCode(r.item); return c !== null && c >= s.lo && c <= s.hi; });
      out.push(`✓ ${r.item.Name}: ${old} → ${price}${old > 0 && Math.abs(price - old) / old > 0.3 ? ' ⚠️ تغییر بیش از ۳۰٪' : ''}${inSeries ? `\n   این کالا در ${inSeries.label} هم هست؛ خط جدا پیش می‌افتد و ${price} می‌گیرد` : ''}`);
    }
    out.push(`در فهرست پیش‌نویس: ${fa(this.draft.size)} خط. «لیست قیمت» نشان می‌دهد، «حذف قیمت <کد>» برمی‌دارد، «شروع کن» پیش‌نمایش می‌سازد.`);
    return [out.join('\n')];
  }

  showDraft() {
    if (!this.draft.size) return null; // no draft: the older «لیست قیمت» (the office's price book) answers
    const items = this.itemCache.items;
    const sl = this.draft.series.map((s, i) => {
      const found = seriesItems(items, s.lo, s.hi); const own = found.filter((x) => this.draft.lines.some((l) => String(l.itemId) === String(x.item.Id))).length;
      return `${fa(i + 1)}. ${s.label}: ${found.length ? `${rangeText(found.map((x) => x.code))}، ${fa(found.length)} کالا` : 'کالاها بعد از «شروع کن» خوانده می‌شوند'} → ${s.price}${own ? ` (${fa(own)} کالای آن خط جدا دارد و خط جدا پیش می‌افتد)` : ''}`;
    });
    return [['پیش‌نویس قیمت پایه (هنوز چیزی در کوییک‌بوکس عوض نشده):', ...sl, ...this.draft.lines.map((l, i) => `${fa(sl.length + i + 1)}. ${l.name}: ${l.old} → ${l.new}${this.draft.series.some((s) => { const c = pvcCode({ Name: l.name }); return c !== null && c >= s.lo && c <= s.hi; }) ? ' (خط جدا، بر سری پیش می‌افتد)' : ''}`), 'برای ساخت پیش‌نمایش: «شروع کن». فهرست قیمت دفتر: «قیمت‌ها».'].join('\n')];
  }

  removePrice(code) {
    const sm = /^سری\s*(\d+)$/u.exec(String(code).trim());
    const ok = sm ? this.draft.removeSeries(`سری ${sm[1]}`) : (this.draft.remove(code) || this.draft.removeSeries(code));
    return [ok ? `خط «${code}» از پیش‌نویس برداشته شد. ${fa(this.draft.size)} خط مانده.` : `خطی با «${code}» در پیش‌نویس نبود.`];
  }

  async planPrices() {
    if (!this.draft.size) return null; // «شروع کن» with no draft is not ours
    const blocked = this.guard();
    if (blocked) return [blocked];
    const items = await this.items(true);
    const ex = expandDraft(this.draft, items);
    const r = planPrices(ex.lines, items);
    if (!r.changes.length) return [`هیچ قیمتی برای تغییر نیست (${fa(r.unchanged)} خط از پیش درست است${r.skipped.length ? `، ${fa(r.skipped.length)} کالا پیدا نشد` : ''}).`];
    const warned = r.changes.filter((c) => c.warn.length);
    return this.make('P', r, {
      header: 'قیمت پایهٔ کالاها',
      summary: `${fa(r.changes.length)} قیمت تغییر می‌کند${r.unchanged ? `، ${fa(r.unchanged)} از پیش درست است` : ''}${r.skipped.length ? `، ${fa(r.skipped.length)} کالا پیدا نشد` : ''}. فقط قیمت فروش پایهٔ کالا عوض می‌شود.`,
      params: { series: this.draft.series.map((s) => `${s.lo}-${s.hi}-${s.price}`) },
      lines: [
        ...ex.groups.map((g) => {
          const mine = r.changes.filter((c) => c.group === g.label);
          const w = mine.filter((c) => c.warn.length);
          return `${g.label} (${g.found.length ? rangeText(g.found.map((x) => x.code)) : 'کالایی پیدا نشد'}): ${fa(g.found.length - g.own)} کالا، ${fa(mine.length)} تغییر؛ ${oldGroups(mine.map((c) => ({ UnitPrice: c.old })), g.price) || 'همه از پیش درست'}${w.length ? `\n   ⚠️ ${fa(w.length)} کالا هشدار دارد: ${[...new Set(w.flatMap((c) => c.warn.map((x) => x.replace(/\s*\(.*\)$/, ''))))].join('، ')}` : ''}${g.own ? `\n   ${fa(g.own)} کالا خط جدا دارد` : ''}`;
        }),
        ...r.changes.filter((c) => !c.group).map((c) => `${c.label}: ${c.old} → ${c.new}${c.warn.length ? ` ⚠️ ${c.warn.join('، ')}` : ''}`),
      ].map((x, i) => `${fa(i + 1)}. ${x}`),
      extra: warned.length ? [`⚠️ ${fa(warned.length)} قیمت هشدار دارد؛ پیش از «بله» نگاه کنید.`] : [],
    });
  }

  // ------------------------------------------------------------------------------------------------ the owner's yes or no (all jobs)
  async decide({ verb, id }) {
    const p = this.store.get(id);
    if (!p) return [`پیش‌نمایش ${id} پیدا نشد.`];
    const job = JOBS[p.kind];
    if (verb === 'no') {
      if (p.status === 'running' || p.status === 'done') return [`پیش‌نمایش ${p.id} پیش‌تر اجرا شده یا در حال اجراست؛ لغو آن ممکن نیست.`];
      p.status = 'cancelled'; this.store.save(); this.audit.add({ event: 'bulk-cancel', kind: p.kind, previewId: p.id, approver: 'owner' });
      return [`پیش‌نمایش ${p.id} لغو شد. چیزی تغییر نکرد.`];
    }
    if (p.status === 'done') return [`${p.id} پیش‌تر اجرا شده است: ${this.reportLine(p.result)}`];
    if (p.status === 'running' || this.busy) return [`${p.busy ? '' : ''}یک کار دستهٔ دیگر یا همین کار همین حالا در حال اجراست؛ صبر کنید.`];
    if (p.status === 'cancelled') return [`پیش‌نمایش ${p.id} لغو شده بود.`];
    if (p.status === 'expired' || this.now() - p.at > DAY) {
      if (p.status !== 'expired') { p.status = 'expired'; this.store.save(); this.audit.add({ event: 'bulk-expire', kind: p.kind, previewId: p.id }); }
      return [`پیش‌نمایش ${p.id} بیش از ۲۴ ساعت پیش است و منقضی شد. دوباره درخواست کنید.`];
    }
    const blocked = this.guard();
    if (blocked) return [blocked];
    if (!this.qbo.writeOn) { this.audit.add({ event: 'refuse', previewId: p.id, reason: 'write-off' }); return ['نوشتن در کوییک‌بوکس خاموش است؛ چیزی تغییر نکرد. پیش‌نمایش می‌ماند.']; }
    p.status = 'running'; this.busy = true; this.store.save();
    void this.run(p, job);
    return [`اجرا شروع شد (${job.title}): ${fa(p.changes.length)} مورد، یکی‌یکی با فاصله. نتیجه در پایان گفته می‌شود.`];
  }

  reportLine(r) { return `${fa(r.changed)} تغییر کرد، ${fa(r.skipped)} رد شد (از پیش درست یا پیدا نشد)، ${fa(r.failed)} ناموفق${r.stoppedAt ? `؛ در مورد ${fa(r.stoppedAt)} ایستاد: ${r.why}` : ''}${r.remaining ? `؛ ${fa(r.remaining)} مورد انجام نشد` : ''}.`; }

  async run(p, job) {
    const r = { changed: 0, skipped: p.skipped.length, failed: 0, stoppedAt: 0, why: '', remaining: 0 };
    const done = [];
    try {
      for (const [i, ch] of p.changes.entries()) {
        let cur;
        try { cur = (await this.qbo.get(`${job.entity}/${encodeURIComponent(ch.id)}`))?.[job.entity === 'customer' ? 'Customer' : 'Item']; } catch (e) { this.stop(r, p, i, e); break; }
        if (!cur) { r.skipped += 1; continue; }
        const part = job.body(cur, ch, p); // computed from the record as it is NOW: already done = null
        if (!part) { r.skipped += 1; done.push(ch.id); continue; }
        const body = { Id: String(cur.Id), SyncToken: String(cur.SyncToken), sparse: true, ...part };
        if (Object.keys(part).some((k) => !job.fields.includes(k))) { this.stop(r, p, i, new Error('a field this job may not change')); break; } // defence: never beyond the job's fields
        try {
          await this.qbo.write('POST', job.entity, body);
          r.changed += 1; done.push(ch.id);
          this.audit.add({ event: 'bulk-change', kind: p.kind, previewId: p.id, approver: 'owner', qboId: body.Id, ...job.audit(cur, part, p) });
        } catch (e) { this.stop(r, p, i, e); break; }
        if (this.gapMs) await this.sleep(this.gapMs);
      }
    } finally {
      p.status = r.stoppedAt ? 'pending' : 'done'; // after a stop it can be run again: the done ones are skipped
      p.result = r;
      this.busy = false;
      if (p.kind === 'P') { this.draft.dropItems(done); if (!r.stoppedAt) this.draft.dropSeries(p.params.series || []); } // the prices that are in QuickBooks leave the draft
      this.store.save();
      this.itemCache = { at: 0, items: [] };
      this.desk.cache = { at: 0, customers: [] };
      this.audit.add({ event: r.stoppedAt ? 'bulk-stopped' : 'bulk-done', kind: p.kind, previewId: p.id, total: r.changed });
      if (this.finish) { try { await this.finish([`${job.title} (${p.id}): ${this.reportLine(r)}`]); } catch { /* the chat may be gone */ } }
    }
  }

  stop(r, p, index, e) {
    r.stoppedAt = index + 1;
    r.why = e.paused ? 'کلید توقف روشن است' : e.message;
    r.remaining = p.changes.length - index;
    r.failed += e.paused ? 0 : 1;
    this.log(`QuickBooks bulk ${p.kind} stopped at ${index + 1}: ${e.name} ${e.status || ''}`);
  }
}

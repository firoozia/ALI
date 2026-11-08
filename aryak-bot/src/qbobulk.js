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
import { pickItem, pvcCode } from './qboinvoice.js';
export { pvcCode };

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
const inRange = (items, lo, hi) => items.filter((i) => i.Active !== false && ITEM_TYPES.includes(i.Type)).map((item) => ({ item, code: pvcCode(item) })).filter((x) => x.code !== null && x.code >= lo && x.code <= hi);
/** The codes in lo..hi that have SEVERAL active PVC items: { code -> [items] }. They are never taken. */
export function seriesAmbiguous(items, lo, hi) {
  const by = new Map(); for (const x of inRange(items, lo, hi)) by.set(x.code, [...(by.get(x.code) || []), x.item]);
  return new Map([...by].filter(([, v]) => v.length > 1));
}
/** The active PVC items whose code is lo..hi, one item per code (a code with several items is left out, see seriesAmbiguous): [{ item, code }] by code. */
export function seriesItems(items, lo, hi) {
  const dup = seriesAmbiguous(items, lo, hi);
  return inRange(items, lo, hi).filter((x) => !dup.has(x.code)).sort((a, b) => a.code - b.code);
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

// ---------------------------------------------------------------------------------------------------------------- categories and SKUs (job C)
export const CAT_NAME = 'PVC FILM';
export const EDGE_CAT = 'EDGE BANDING';
export const EDGE_SIZES = { 22: 'EDGE 0.8x22', 50: 'EDGE 0.8x50' };
/** The categories of the job in creation order (a parent before its children); [key] is what the item moves name. */
export const CATS = [
  { key: 'pvc', name: CAT_NAME, parent: '' },
  { key: 'edge', name: EDGE_CAT, parent: '' },
  { key: 'e22', name: EDGE_SIZES[22], parent: 'edge' },
  { key: 'e50', name: EDGE_SIZES[50], parent: 'edge' },
];
const inFamily = (c) => c !== null && ((c >= 101 && c <= 799) || (c >= 1801 && c <= 1899));
/** A name reduced to its letters and digits, sorted: "PVC FLIM", "pvc film " and "PVC FILM" are the same (case, spaces, two letters swapped; * and x alike). */
const catKey = (s) => String(s || '').toLowerCase().replace(/[*×]/g, 'x').replace(/[^a-z0-9]/g, '').split('').sort().join('');
/** The category that is [name] exactly or spelled differently: { exact, variants }. */
export function categoryCandidates(items, name = CAT_NAME) {
  const cats = items.filter((i) => i.Type === 'Category' && i.Active !== false);
  const like = cats.filter((c) => catKey(c.Name) === catKey(name));
  return { exact: like.find((c) => c.Name === name) || null, variants: like.filter((c) => c.Name !== name) };
}

// ---- edge banding: the width is read from the name, the SKU and the descriptions; a thickness alone ("0.18") is not a width
const textsOf = (i) => [i?.Name, i?.Sku, i?.Description, i?.PurchaseDesc].map((x) => String(x || ''));
const WIDTH = /(?<![\d.])(22|50|45)(?![\d.])/g;
/** Is this an edge banding item (and not a PVC film)? */
export function isEdgeItem(i) {
  if (inFamily(pvcCode(i))) return false;
  const [name, sku, desc, pdesc] = textsOf(i);
  return /edge/i.test(name) || /^edge/i.test(sku) || /edge\s*band/i.test(desc) || /edge\s*band/i.test(pdesc);
}
/** The width of an edge banding item: { size: 22 | 50 } or { why: 'unknown' | 'both' | 'other' } (45 and a clash between fields are never guessed). */
export function edgeSize(i) {
  const found = new Set();
  for (const t of textsOf(i)) for (const m of t.matchAll(WIDTH)) found.add(Number(m[1]));
  if (!found.size) return { why: 'unknown' };
  if (found.size > 1) return { why: 'both' };
  const [s] = [...found];
  return s === 22 || s === 50 ? { size: s } : { why: 'other' };
}
/** The colour number of an edge banding item (1801, 3019): the first 3 to 5 digit number of the SKU, else of the name. */
export function edgeCode(i) {
  for (const t of [String(i?.Sku || ''), String(i?.Name || '')]) { const m = /(?<![\d.])(\d{3,5})(?![\d.])/.exec(t); if (m) return m[1]; }
  return '';
}

/** What would change: the categories (exists / rename / create), the PVC film and edge banding items to move, their SKUs; clashes and unsure ones listed. */
export function planCatalog(items, { edge = true } = {}) {
  const out = { cats: [], moves: [], skus: [], edgeSkus: [], clashes: [], unsure: [], unchanged: 0, stop: '' };
  for (const spec of CATS.filter((c) => edge || c.key === 'pvc')) { // edge false: the PVC film part only, nothing of edge banding
    const { exact, variants } = categoryCandidates(items, spec.name);
    if (exact) out.cats.push({ ...spec, mode: 'exists', id: String(exact.Id), oldName: exact.Name });
    else if (variants.length === 1) out.cats.push({ ...spec, mode: 'rename', id: String(variants[0].Id), oldName: variants[0].Name });
    else if (variants.length > 1) { out.stop = `چند دستهٔ شبیه «${spec.name}» هست (${variants.map((v) => v.Name).join('، ')}) و بین آن‌ها حدس نمی‌زنم؛ در کوییک‌بوکس یکی را نگه دارید.`; return out; }
    else out.cats.push({ ...spec, mode: 'create', id: '', oldName: '' });
  }
  const idOf = (key) => out.cats.find((c) => c.key === key).id;
  const real = items.filter((i) => i.Type !== 'Category' && i.Active !== false && ITEM_TYPES.includes(i.Type));
  const inPlace = (i, key) => idOf(key) && String(i.ParentRef?.value || '') === idOf(key) && i.SubItem;
  const wanted = []; // { op:'sku', ... }
  for (const i of real) {
    const code = pvcCode(i);
    if (inFamily(code)) {
      if (inPlace(i, 'pvc')) out.unchanged += 1; else out.moves.push({ op: 'move', cat: 'pvc', id: String(i.Id), label: i.Name, old: String(i.ParentRef?.value || ''), new: CAT_NAME });
      wanted.push({ op: 'sku', id: String(i.Id), label: i.Name, old: String(i.Sku || ''), new: `PVC-${code}`, edge: false });
    } else if (isEdgeItem(i)) {
      if (!edge) continue; // not in this job: no move, no SKU, not even listed
      const sz = edgeSize(i); const col = edgeCode(i);
      if (!sz.size) { out.unsure.push({ id: String(i.Id), label: i.Name, why: sz.why === 'unknown' ? 'اندازهٔ پهنا خوانده نشد' : sz.why === 'both' ? 'هر دو اندازه یا اندازهٔ ناهمخوان' : 'پهنای دیگر (۴۵) حدس زده نمی‌شود' }); continue; }
      const key = sz.size === 22 ? 'e22' : 'e50';
      if (inPlace(i, key)) out.unchanged += 1; else out.moves.push({ op: 'move', cat: key, id: String(i.Id), label: i.Name, old: String(i.ParentRef?.value || ''), new: EDGE_SIZES[sz.size] });
      if (!col) out.unsure.push({ id: String(i.Id), label: i.Name, why: 'کد رنگ خوانده نشد؛ کد کالا عوض نمی‌شود' });
      else wanted.push({ op: 'sku', id: String(i.Id), label: i.Name, old: String(i.Sku || ''), new: `EDGE${sz.size}-${col}`, edge: true });
    } else if (/pvc|flim/i.test(String(i.Name))) out.unsure.push({ id: String(i.Id), label: i.Name, why: 'شبیه پی‌وی‌سی ولی کدش در دامنه نیست' });
  }
  // a SKU another item holds (or two items would get) is a clash and is skipped
  const heldBy = new Map(); for (const i of items) if (i.Sku) heldBy.set(String(i.Sku).toLowerCase(), [...(heldBy.get(String(i.Sku).toLowerCase()) || []), String(i.Id)]);
  const planned = new Map(); for (const w of wanted) planned.set(w.new.toLowerCase(), [...(planned.get(w.new.toLowerCase()) || []), w.id]);
  for (const w of wanted) {
    if (w.old === w.new) { out.unchanged += 1; continue; }
    const others = (heldBy.get(w.new.toLowerCase()) || []).filter((x) => x !== w.id);
    if (others.length) { out.clashes.push({ ...w, why: 'این کد را کالای دیگری دارد' }); continue; }
    if ((planned.get(w.new.toLowerCase()) || []).length > 1) { out.clashes.push({ ...w, why: 'دو کالا این کد را می‌گیرند' }); continue; }
    (w.edge ? out.edgeSkus : out.skus).push(w);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the edge banding list (job D): an explicit list, never a guess
export const EDGE_A = Array.from({ length: 20 }, (_, i) => 1801 + i); // "1801 edge banding" .. "1820 edge banding": 0.8x22
export const EDGE_B = [1802, 1804, 1805, 1806, 1807, 1808, 1809, 1810, 1816, 1817, 1818, 1819, 1820]; // "B 1802" ...: 0.8x50
const nameEq = (a, b) => norm(a) === norm(b);
/**
 * [items]: the active items; [cats]: every category, active or not. Returns the parent, the two sub-categories (exists / activate / create),
 * the moves and the SKUs of the 33 listed items only, and what was not found or is ambiguous.
 */
export function planEdgeList(items, cats) {
  const out = { parent: null, subs: [], moves: [], skus: [], clashes: [], missing: [], ambiguous: [], unchanged: 0, stop: '' };
  cats = cats.filter((c) => c.Type === 'Category'); // whatever the query returned, only categories count
  const parents = cats.filter((c) => c.Active !== false && nameEq(c.Name, EDGE_CAT));
  if (parents.length !== 1) { out.stop = parents.length ? `چند دستهٔ «${EDGE_CAT}» هست؛ حدس نمی‌زنم.` : `دستهٔ «${EDGE_CAT}» در کوییک‌بوکس نیست؛ این کار آن را نمی‌سازد. اول آن را بسازید.`; return out; }
  out.parent = { id: String(parents[0].Id), name: parents[0].Name };
  for (const [key, size] of [['e22', 22], ['e50', 50]]) {
    const name = EDGE_SIZES[size];
    const same = cats.filter((c) => nameEq(c.Name, name));
    const active = same.filter((c) => c.Active !== false);
    if (active.length > 1) { out.stop = `چند دستهٔ فعال «${name}» هست؛ حدس نمی‌زنم.`; return out; }
    if (active.length === 1) out.subs.push({ key, name, parent: 'edge', mode: 'exists', id: String(active[0].Id) });
    else if (same.length === 1) out.subs.push({ key, name, parent: 'edge', mode: 'activate', id: String(same[0].Id) });
    else if (same.length > 1) { out.stop = `چند دستهٔ غیرفعال «${name}» هست؛ حدس نمی‌زنم.`; return out; }
    else out.subs.push({ key, name, parent: 'edge', mode: 'create', id: '' });
  }
  const idOf = (key) => out.subs.find((s) => s.key === key).id;
  const real = items.filter((i) => i.Type !== 'Category' && i.Active !== false && ITEM_TYPES.includes(i.Type));
  const wanted = [];
  const listed = [...EDGE_A.map((n) => ({ name: `${n} edge banding`, n, size: 22, key: 'e22' })), ...EDGE_B.map((n) => ({ name: `B ${n}`, n, size: 50, key: 'e50' }))];
  for (const L of listed) {
    const hit = real.filter((i) => nameEq(i.Name, L.name));
    if (!hit.length) { out.missing.push(L.name); continue; }
    if (hit.length > 1) { out.ambiguous.push(L.name); continue; }
    const i = hit[0];
    if (idOf(L.key) && String(i.ParentRef?.value || '') === idOf(L.key) && i.SubItem) out.unchanged += 1;
    else out.moves.push({ op: 'move', cat: L.key, id: String(i.Id), label: i.Name, old: String(i.ParentRef?.value || ''), new: EDGE_SIZES[L.size] });
    wanted.push({ op: 'sku', id: String(i.Id), label: i.Name, old: String(i.Sku || ''), new: `EDGE${L.size}-${L.n}` });
  }
  const held = new Map(); for (const i of items) if (i.Sku) held.set(String(i.Sku).toLowerCase(), [...(held.get(String(i.Sku).toLowerCase()) || []), String(i.Id)]);
  const planned = new Map(); for (const w of wanted) planned.set(w.new.toLowerCase(), [...(planned.get(w.new.toLowerCase()) || []), w.id]);
  for (const w of wanted) {
    if (w.old === w.new) { out.unchanged += 1; continue; }
    if ((held.get(w.new.toLowerCase()) || []).some((x) => x !== w.id)) { out.clashes.push({ ...w, why: 'این کد را کالای دیگری دارد' }); continue; }
    if ((planned.get(w.new.toLowerCase()) || []).length > 1) { out.clashes.push({ ...w, why: 'دو کالا این کد را می‌گیرند' }); continue; }
    out.skus.push(w);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the old edge banding items to switch off (job R): nine named items
export const OLD_EDGE = [
  ['EDGE BAND 1MM*22(3019)', '134'], ['EDGE BAND 1MM*22(3020)', '135'], ['EDGE BAND 1MM*22(394)', '129'], ['EDGE BAND 1MM*22(640)', '130'],
  ['EDGE BAND 1MM*22(726)', '132'], ['EDGE BAND 1MM*22(729)', '133'], ['EDGE BAND 1MM*22(735)', '131'], ['EDGE BAND 1MM*22(840)', '128'], ['edge banding', ''],
];
/** The nine items by exact name (a category is never one): found with their stock and value, missing and ambiguous named. */
export function planOldEdge(items) {
  const real = items.filter((i) => i.Type !== 'Category');
  const out = { found: [], missing: [], ambiguous: [], already: [], total: 0 };
  for (const [name, hintId] of OLD_EDGE) {
    const hit = real.filter((i) => nameEq(i.Name, name));
    const live = hit.filter((i) => i.Active !== false);
    if (!hit.length) { out.missing.push(name); continue; }
    if (!live.length) { out.already.push(name); continue; }
    if (live.length > 1) { out.ambiguous.push(name); continue; }
    const i = live[0]; const qty = Number(i.QtyOnHand) || 0; const cost = Number(i.PurchaseCost) || 0;
    const value = Math.round(qty * cost * 100) / 100;
    out.total = Math.round((out.total + value) * 100) / 100;
    out.found.push({ op: 'deactivate', id: String(i.Id), label: i.Name, hint: hintId && hintId !== String(i.Id) ? hintId : '', qty, cost, value, old: 'active', new: 'inactive' });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- tidy edge banding names and descriptions (job F)
const median = (xs) => { const a = xs.filter((x) => x > 0).sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : 0; };
/**
 * The items now in the categories EDGE 0.8x22 and EDGE 0.8x50 (active only): the new name "EDGE BAND 0.8x22 - 1801" and the description text.
 * [all]: every item including the inactive (the name must be new among them). Returns { changes, unchanged, skipped, warnings }.
 */
export function planEdgeNames(active, all, cats) {
  const out = { changes: [], unchanged: 0, skipped: [], warnings: [], stop: '' };
  const catOf = {};
  for (const [size, name] of [[22, EDGE_SIZES[22]], [50, EDGE_SIZES[50]]]) {
    const c = cats.filter((x) => x.Type === 'Category' && x.Active !== false && nameEq(x.Name, name));
    if (c.length !== 1) { out.stop = c.length ? `چند دستهٔ فعال «${name}» هست؛ حدس نمی‌زنم.` : `دستهٔ «${name}» در کوییک‌بوکس نیست.`; return out; }
    catOf[String(c[0].Id)] = size;
  }
  const members = active.filter((i) => i.Type !== 'Category' && i.Active !== false && catOf[String(i.ParentRef?.value || '')] !== undefined && i.SubItem);
  const taken = new Map(); for (const i of all) taken.set(norm(i.Name), [...(taken.get(norm(i.Name)) || []), String(i.Id)]);
  const rows = [];
  for (const i of members) {
    const size = catOf[String(i.ParentRef.value)];
    const m = /^EDGE(22|50)-(\d{3,5})$/i.exec(String(i.Sku || '').trim());
    if (!m || Number(m[1]) !== size) { out.skipped.push({ id: String(i.Id), label: i.Name, why: 'کد کالا با دسته نمی‌خواند' }); continue; }
    const colour = m[2];
    rows.push({ id: String(i.Id), label: i.Name, cat: String(i.ParentRef.value), size, colour, name: `EDGE BAND 0.8x${size} - ${colour}`, desc: `EDGE BANDING 0.8 x ${size} MM - COLOUR ${colour}`, item: i });
  }
  const planned = new Map(); for (const r of rows) planned.set(norm(r.name), [...(planned.get(norm(r.name)) || []), r.id]);
  for (const r of rows) {
    if ((taken.get(norm(r.name)) || []).some((x) => x !== r.id)) { out.skipped.push({ id: r.id, label: r.label, why: `نام «${r.name}» را کالای دیگری دارد` }); continue; }
    if ((planned.get(norm(r.name)) || []).length > 1) { out.skipped.push({ id: r.id, label: r.label, why: `دو کالا نام «${r.name}» را می‌گیرند` }); continue; }
    const same = r.item.Name === r.name && r.item.Description === r.desc && r.item.PurchaseDesc === r.desc;
    if (same) { out.unchanged += 1; continue; }
    out.changes.push({ op: 'rename-item', id: r.id, label: r.label, cat: r.cat, name: r.name, desc: r.desc, old: r.label, new: r.name, oldDesc: String(r.item.Description || ''), alias: [r.label, ...(r.size === 22 ? [`${r.colour} edge`] : [])] });
  }
  // data warnings: they change nothing
  for (const r of rows) {
    if (!(Number(r.item.PurchaseCost) > 0)) out.warnings.push(`${r.name}: بهای خرید صفر یا خالی است`);
    if (Number(r.item.QtyOnHand) < 0) out.warnings.push(`${r.name}: موجودی منفی است (${r.item.QtyOnHand})`);
  }
  for (const size of [22, 50]) {
    const g = rows.filter((r) => r.size === size); const med = median(g.map((r) => Number(r.item.UnitPrice) || 0));
    for (const r of g) { const p = Number(r.item.UnitPrice) || 0; if (!(p > 0)) out.warnings.push(`${r.name}: قیمت فروش ندارد`); else if (med && (p > 2 * med || p < med / 2)) out.warnings.push(`${r.name}: قیمت ${p} با میانهٔ گروه ${med} فاصلهٔ زیاد دارد`); }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- undo (job U): from what the audit log says a finished job did
/** The preview that created categories last (the one whose edge banding the owner wants back). */
export function latestCreatingPreview(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) if (entries[i].event === 'bulk-change' && entries[i].field === 'category-create') return String(entries[i].previewId || '');
  return '';
}
/**
 * The moves a finished job made and the categories it created, from the audit entries: { created: [{ id, name }], moves: [{ id, old, new }] }.
 * [onlyCreated]: only the moves into a category that this same job created.
 */
export function undoSet(entries, source, { onlyCreated = false } = {}) {
  const mine = entries.filter((e) => e.event === 'bulk-change' && String(e.previewId) === String(source));
  const created = mine.filter((e) => e.field === 'category-create').map((e) => ({ id: String(e.qboId), name: String(e.new || '') }));
  const ids = new Set(created.map((c) => c.id));
  const by = new Map();
  for (const e of mine.filter((x) => x.field === 'move')) {
    const k = String(e.qboId);
    if (!by.has(k)) by.set(k, { id: k, old: String(e.old || ''), new: String(e.new || '') }); else by.get(k).new = String(e.new || '');
  }
  return { created, moves: [...by.values()].filter((m) => m.old !== m.new && (!onlyCreated || ids.has(m.new))) };
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
  C: {
    title: 'دسته و کد کالاها', entity: 'item', fields: ['Type', 'Name', 'ParentRef', 'SubItem', 'Sku'],
    body: (cur, ch, p) => {
      if (ch.op === 'rename') return cur.Type === 'Category' && cur.Name !== ch.new ? { Type: 'Category', Name: ch.new } : null;
      if (cur.Type === 'Category') return null; // a category is only ever renamed
      const cid = String(p.params.cats?.[ch.cat] || '');
      if (ch.op === 'move') return cid && !(String(cur.ParentRef?.value || '') === cid && cur.SubItem) ? { ParentRef: { value: cid }, SubItem: true } : null;
      if (ch.op === 'sku') return String(cur.Sku || '') === ch.new ? null : { Sku: ch.new };
      return null;
    },
    audit: (cur, body, p, ch) => ({ field: ch.op, old: ch.op === 'sku' ? String(cur.Sku || '') : ch.op === 'rename' ? cur.Name : String(cur.ParentRef?.value || ''), new: ch.op === 'sku' || ch.op === 'rename' ? ch.new : String(p.params.cats?.[ch.cat] || '') }),
  },
  D: {
    title: 'دسته و کد نوار لبه', entity: 'item', fields: ['Type', 'Name', 'ParentRef', 'SubItem', 'Sku'],
    body: (cur, ch, p) => {
      if (cur.Type === 'Category') return null;
      const cid = String(p.params.cats?.[ch.cat] || '');
      if (ch.op === 'move') return cid && !(String(cur.ParentRef?.value || '') === cid && cur.SubItem) ? { ParentRef: { value: cid }, SubItem: true } : null;
      if (ch.op === 'sku') return String(cur.Sku || '') === ch.new ? null : { Sku: ch.new };
      return null;
    },
    audit: (cur, body, p, ch) => ({ field: ch.op, old: ch.op === 'sku' ? String(cur.Sku || '') : String(cur.ParentRef?.value || ''), new: ch.op === 'sku' ? ch.new : String(p.params.cats?.[ch.cat] || '') }),
  },
  F: {
    title: 'نام و شرح نوار لبه', entity: 'item', fields: ['Name', 'Description', 'PurchaseDesc'],
    // only a field that differs is sent; an item that left its category since the preview is not touched
    body: (cur, ch) => {
      if (cur.Type === 'Category' || cur.Active === false || String(cur.ParentRef?.value || '') !== ch.cat) return null;
      const part = {};
      if (cur.Name !== ch.name) part.Name = ch.name;
      if (cur.Description !== ch.desc) part.Description = ch.desc;
      if (cur.PurchaseDesc !== ch.desc) part.PurchaseDesc = ch.desc;
      return Object.keys(part).length ? part : null;
    },
    audit: (cur, body, p, ch) => ({ field: 'rename-item', old: String(cur.Name), new: ch.name, oldDesc: String(cur.Description || '').slice(0, 200), newDesc: ch.desc }),
  },
  R: { title: 'غیرفعال کردن نوار لبه‌های قدیمی', entity: 'item', fields: [], body: () => null, audit: () => ({}) },
  U: {
    title: 'برگرداندن دسته', entity: 'item', fields: ['ParentRef', 'SubItem'],
    // an item goes back only if it still sits where the job put it; one that someone moved since is left alone and named
    body: (cur, ch) => (String(cur.ParentRef?.value || '') === ch.expect && cur.SubItem ? (ch.restore ? { ParentRef: { value: ch.restore }, SubItem: true } : { SubItem: false }) : null),
    note: (cur, ch) => (String(cur.ParentRef?.value || '') === ch.restore && (ch.restore ? cur.SubItem : !cur.SubItem) ? '' : `${ch.label}: دسته‌اش از آن زمان عوض شده و دست نخورد`),
    audit: (cur, body, p, ch) => ({ field: 'undo-move', old: String(cur.ParentRef?.value || ''), new: ch.restore, of: p.params.source }),
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
  openIds() { return Object.values(this.store.d.previews).filter((p) => p.status === 'pending' && !p.result && !p.ran && this.now() - p.at <= DAY).map((p) => p.id); }

  /** Stores a preview and builds its text. */
  make(kind, r, { header, summary, lines, extra = [], params = {}, limit = SHOWN }) {
    const p = this.store.add(kind, { at: this.now(), status: 'pending', changes: r.changes, skipped: r.skipped, unchanged: r.unchanged, params });
    this.audit.add({ event: 'bulk-preview', kind, previewId: p.id, total: r.changes.length });
    return [[
      `پیش‌نمایش ${header} #${p.id} — هنوز چیزی در کوییک‌بوکس تغییر نکرده`,
      summary,
      ...lines.slice(0, limit),
      ...(lines.length > limit ? [`… و ${fa(lines.length - limit)} مورد دیگر`] : []),
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

  // ------------------------------------------------------------------------------------------------ C: categories and SKUs
  async planCatalog({ edge = true } = {}) {
    const blocked = this.guard();
    if (blocked) return [blocked];
    const items = await this.items(true);
    const r = planCatalog(items, { edge });
    if (r.stop) return [r.stop];
    const changes = [];
    for (const c of r.cats) {
      if (c.mode === 'rename') changes.push({ op: 'rename', cat: c.key, id: c.id, label: c.oldName, old: c.oldName, new: c.name });
      if (c.mode === 'create') changes.push({ op: 'cat-create', cat: c.key, parent: c.parent, id: '', label: c.name, old: '', new: c.name });
    }
    changes.push(...r.moves, ...r.skus, ...r.edgeSkus);
    if (!changes.length) return [`دسته و کد کالاها از پیش درست است (${fa(r.unchanged)} مورد)${r.clashes.length ? `؛ ${fa(r.clashes.length)} برخورد کد هست و رد شد` : ''}${r.unsure.length ? `؛ ${fa(r.unsure.length)} کالا نامطمئن است و جابه‌جا نمی‌شود` : ''}.`];
    const sample = (arr, f, n = 4) => arr.slice(0, n).map(f);
    const catLines = r.cats.map((c) => ({ rename: `دسته «${c.oldName}» به «${c.name}» تغییر نام می‌دهد (فقط نام آن دسته)`, create: `دستهٔ «${c.name}»${c.parent ? ` زیر «${EDGE_CAT}»` : ''} ساخته می‌شود`, exists: `دستهٔ «${c.name}» از پیش هست` }[c.mode]));
    const perCat = (key) => r.moves.filter((m) => m.cat === key);
    const skuPvc = r.skus; const skuEdge = (n) => r.edgeSkus.filter((s) => s.new.startsWith(`EDGE${n}-`));
    const makes = r.cats.filter((c) => c.mode === 'create').length;
    const cats = Object.fromEntries(r.cats.filter((c) => c.id).map((c) => [c.key, c.id]));
    const pvcSummary = `فاکتورهای قبلی تغییر نمی‌کنند؛ فقط دسته و کد کالا. فقط بخش پی‌وی‌سی؛ به نوار لبه دست زده نمی‌شود. نام، قیمت، مالیات و حساب هیچ کالایی عوض نمی‌شود.\nدسته: ${catLines[0]}.\nانتقال: ${fa(perCat('pvc').length)} کالای پی‌وی‌سی. کد کالا: ${fa(skuPvc.length)} پی‌وی‌سی. ${fa(r.unchanged)} مورد از پیش درست است.`;
    return this.make('C', { changes, skipped: [...r.clashes, ...r.unsure.map((u) => ({ ...u, why: 'unsure' }))], unchanged: r.unchanged }, {
      header: 'دسته و کد کالاها', params: { cats },
      summary: !edge ? pvcSummary : `فاکتورهای قبلی تغییر نمی‌کنند؛ فقط دسته و کد کالا. نام، قیمت، مالیات و حساب هیچ کالایی عوض نمی‌شود.\nدسته‌ها: ${catLines.join('؛ ')}${makes ? ` (جمعاً ${fa(makes)} دستهٔ تازه؛ تنها ساختی که این کار دارد)` : ''}.\nانتقال: ${fa(perCat('pvc').length)} کالای پی‌وی‌سی، ${fa(perCat('e22').length)} نوار لبهٔ ۲۲ و ${fa(perCat('e50').length)} نوار لبهٔ ۵۰.\nکد کالا: ${fa(skuPvc.length)} پی‌وی‌سی، ${fa(skuEdge(22).length)} نوار لبهٔ ۲۲، ${fa(skuEdge(50).length)} نوار لبهٔ ۵۰. ${fa(r.unchanged)} مورد از پیش درست است.`,
      lines: [
        ...sample(perCat('pvc'), (c) => `انتقال: ${c.label} ← ${CAT_NAME}`),
        ...sample(perCat('e22'), (c) => `انتقال: ${c.label} ← ${EDGE_SIZES[22]}`),
        ...sample(perCat('e50'), (c) => `انتقال: ${c.label} ← ${EDGE_SIZES[50]}`),
        ...sample(skuPvc, (c) => `کد: ${c.label}: ${c.old || '—'} → ${c.new}`),
        ...sample(r.edgeSkus, (c) => `کد نوار لبه: ${c.label}: ${c.old || '—'} → ${c.new}`),
      ].map((x, i) => `${fa(i + 1)}. ${x}`),
      extra: [
        ...(r.clashes.length ? [`رد شد (برخورد کد): ${r.clashes.slice(0, 10).map((c) => `${c.label} (${c.new}: ${c.why})`).join('، ')}${r.clashes.length > 10 ? ` و ${fa(r.clashes.length - 10)} مورد دیگر` : ''}`] : []),
        ...(r.unsure.length ? [`مطمئن نیستم و جابه‌جا یا بی‌تغییر می‌ماند (${fa(r.unsure.length)} کالا): ${r.unsure.slice(0, 30).map((u) => `${u.label} [${u.why}]`).join('، ')}${r.unsure.length > 30 ? ` و ${fa(r.unsure.length - 30)} مورد دیگر` : ''}`] : []),
      ],
    });
  }

  // ------------------------------------------------------------------------------------------------ D: the edge banding list
  async planEdgeList() {
    const blocked = this.guard();
    if (blocked) return [blocked];
    const items = await this.items(true);
    const cats = await this.qbo.query("select * from Item where Type = 'Category' and Active in (true, false)");
    const r = planEdgeList(items, cats);
    if (r.stop) return [r.stop];
    const changes = [];
    for (const s of r.subs) {
      if (s.mode === 'activate') changes.push({ op: 'cat-activate', cat: s.key, id: s.id, label: s.name, old: 'inactive', new: s.name });
      if (s.mode === 'create') changes.push({ op: 'cat-create', cat: s.key, parent: 'edge', id: '', label: s.name, old: '', new: s.name });
    }
    changes.push(...r.moves, ...r.skus);
    if (!changes.length) return [`دسته و کد نوار لبه از پیش درست است (${fa(r.unchanged)} مورد)${r.missing.length ? `؛ ${fa(r.missing.length)} کالا در فهرست پیدا نشد` : ''}.`];
    const cats2 = { edge: r.parent.id, ...Object.fromEntries(r.subs.filter((s) => s.id).map((s) => [s.key, s.id])) };
    const subLine = r.subs.map((s) => ({ exists: `دستهٔ «${s.name}» از پیش هست`, activate: `دستهٔ «${s.name}» (غیرفعال) دوباره فعال می‌شود`, create: `دستهٔ «${s.name}» زیر «${EDGE_CAT}» ساخته می‌شود` }[s.mode])).join('؛ ');
    const m22 = r.moves.filter((m) => m.cat === 'e22'); const m50 = r.moves.filter((m) => m.cat === 'e50');
    return this.make('D', { changes, skipped: [...r.clashes, ...r.missing.map((x) => ({ label: x, why: 'missing' })), ...r.ambiguous.map((x) => ({ label: x, why: 'ambiguous' }))], unchanged: r.unchanged }, {
      header: 'دسته و کد نوار لبه', params: { cats: cats2 },
      summary: `فاکتورهای قبلی تغییر نمی‌کنند؛ فقط دسته و کد کالا. فقط همین فهرست ۳۳ کالایی که مالک داد؛ هیچ کالای دیگری، چسب و پی‌وی‌سی دست نمی‌خورد.\n${subLine}.\nانتقال: ${fa(m22.length)} کالا به ${EDGE_SIZES[22]} و ${fa(m50.length)} کالا به ${EDGE_SIZES[50]}. کد کالا: ${fa(r.skus.length)} کد تغییر می‌کند. ${fa(r.unchanged)} مورد از پیش درست است.`,
      lines: [
        ...m22.slice(0, 4).map((c) => `انتقال: ${c.label} ← ${EDGE_SIZES[22]}`),
        ...m50.slice(0, 4).map((c) => `انتقال: ${c.label} ← ${EDGE_SIZES[50]}`),
        ...r.skus.slice(0, 6).map((c) => `کد: ${c.label}: ${c.old || '—'} → ${c.new}`),
      ].map((x, i) => `${fa(i + 1)}. ${x}`),
      extra: [
        ...(r.missing.length ? [`در کوییک‌بوکس پیدا نشد (${fa(r.missing.length)}): ${r.missing.join('، ')}`] : []),
        ...(r.ambiguous.length ? [`چند کالا با این نام هست و رد شد: ${r.ambiguous.join('، ')}`] : []),
        ...(r.clashes.length ? [`رد شد (برخورد کد): ${r.clashes.map((c) => `${c.label} (${c.new}: ${c.why})`).join('، ')}`] : []),
      ],
    });
  }

  // ------------------------------------------------------------------------------------------------ F: edge banding names and descriptions
  async planEdgeNames() {
    const blocked = this.guard();
    if (blocked) return [blocked];
    const active = await this.items(true);
    const cats = await this.qbo.query("select * from Item where Type = 'Category' and Active in (true, false)");
    const all = await this.qbo.query('select * from Item where Active in (true, false)');
    const r = planEdgeNames(active, all, cats);
    if (r.stop) return [r.stop];
    if (!r.changes.length) return [`نام و شرح نوار لبه از پیش درست است (${fa(r.unchanged)} کالا)${r.skipped.length ? `؛ ${fa(r.skipped.length)} کالا رد شد` : ''}.`];
    const s = r.changes[0];
    return this.make('F', { changes: r.changes, skipped: r.skipped.map((x) => ({ ...x })), unchanged: r.unchanged }, {
      header: 'نام و شرح نوار لبه', limit: 40, params: { ids: r.changes.map((c) => c.id) },
      summary: `${fa(r.changes.length)} کالای دو دستهٔ نوار لبه (فعال)؛ ${fa(r.unchanged)} از پیش درست است. فقط نام کالا و شرح فروش و شرح خرید عوض می‌شود؛ قیمت، بها، مالیات، حساب، کد کالا، دسته و واحد دست نمی‌خورد.\nمبلغ و شرح سطرهای فاکتورهای قبلی تغییر نمی‌کند؛ ولی در صفحهٔ فاکتورهای قبلی، ستون نام کالا نام تازه را نشان می‌دهد چون کوییک‌بوکس نام کالا را از خود کالا می‌خواند.\nنام‌های قدیمی (مثل ۱۸۰۱ و «بی ۱۸۰۲») در درخواست فاکتور همچنان همان کالا را پیدا می‌کنند.\nنمونهٔ شرح (فروش و خرید یکی است): ${s.desc}. شرح فروش قبلی همین کالا: ${s.oldDesc || '—'}.`,
      lines: r.changes.map((c, i) => `${fa(i + 1)}. ${c.old} → ${c.new}`),
      extra: [
        ...(r.skipped.length ? [`رد شد (${fa(r.skipped.length)}): ${r.skipped.map((x) => `${x.label} [${x.why}]`).join('، ')}`] : []),
        ...(r.warnings.length ? [`هشدار دادهٔ کالاها (چیزی را تغییر نمی‌دهد، ${fa(r.warnings.length)} مورد): ${r.warnings.slice(0, 20).join('؛ ')}${r.warnings.length > 20 ? ` و ${fa(r.warnings.length - 20)} مورد دیگر` : ''}`] : []),
      ],
    });
  }

  // ------------------------------------------------------------------------------------------------ R: the old edge banding items
  async planOldEdge() {
    const blocked = this.guard();
    if (blocked) return [blocked];
    const items = await this.items(true);
    const r = planOldEdge(items);
    if (!r.found.length) return [`کالایی برای غیرفعال کردن نمانده${r.already.length ? ` (${fa(r.already.length)} کالا از پیش غیرفعال است)` : ''}${r.missing.length ? `؛ پیدا نشد: ${r.missing.join('، ')}` : ''}.`];
    const num = (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return this.make('R', { changes: r.found, skipped: [...r.missing.map((x) => ({ label: x, why: 'missing' })), ...r.ambiguous.map((x) => ({ label: x, why: 'ambiguous' }))], unchanged: r.already.length }, {
      header: 'غیرفعال کردن نوار لبه‌های قدیمی',
      summary: `${fa(r.found.length)} کالا با نام دقیق. در کوییک‌بوکس کالا پاک نمی‌شود؛ غیرفعال می‌شود و موجودی‌اش با سند تعدیل انبار صفر می‌شود؛ فاکتورهای قبلی تغییر نمی‌کنند. ربات خودش هیچ سند تعدیل نمی‌سازد؛ اگر کوییک‌بوکس به‌خاطر موجودی نپذیرد، کالا رد و پیام آن گفته می‌شود تا خودتان در کوییک‌بوکس «غیرفعال» را بزنید.\nجمع ارزش موجودی (تعداد × بهای خرید): ${num(r.total)}.`,
      lines: r.found.map((c, i) => `${fa(i + 1)}. ${c.label} (شناسه ${c.id}${c.hint ? `، در فهرست ${c.hint}` : ''}): موجودی ${num(c.qty)}، بها ${c.cost}، ارزش ${num(c.value)}`),
      extra: [
        ...(r.missing.length ? [`پیدا نشد: ${r.missing.join('، ')}`] : []),
        ...(r.ambiguous.length ? [`چند کالا با این نام هست و رد شد: ${r.ambiguous.join('، ')}`] : []),
        ...(r.already.length ? [`از پیش غیرفعال: ${r.already.join('، ')}`] : []),
      ],
    });
  }

  // ------------------------------------------------------------------------------------------------ U: put a finished job's moves back
  /** [scope] 'edge': the latest job that created categories, only the moves into them; 'all': every move of the job named in [source]. */
  async planUndo({ scope = 'edge', source = '' } = {}) {
    const blocked = this.guard();
    if (blocked) return [blocked];
    const entries = this.audit.all();
    const src = scope === 'edge' ? latestCreatingPreview(entries) : String(source).toUpperCase();
    if (!src) return ['در گزارش حسابرسی کاری که دسته ساخته باشد پیدا نشد؛ چیزی برای برگرداندن نیست.'];
    const set = undoSet(entries, src, { onlyCreated: scope === 'edge' });
    if (!set.moves.length) return [`در گزارش حسابرسی ${src} جابه‌جایی‌ای برای برگرداندن پیدا نشد.`];
    const items = await this.items(true);
    const byId = new Map(items.map((i) => [String(i.Id), i]));
    const name = (id) => byId.get(String(id))?.Name || `کالای ${id}`;
    const changes = []; const left = []; let already = 0;
    for (const m of set.moves) {
      const it = byId.get(m.id);
      const now = String(it?.ParentRef?.value || '');
      if (!it) { left.push(`${name(m.id)}: در کوییک‌بوکس نیست`); continue; }
      if (now === m.old && (m.old ? it.SubItem : !it.SubItem)) { already += 1; continue; }
      if (now !== m.new) { left.push(`${name(m.id)}: دسته‌اش از آن زمان عوض شده`); continue; }
      changes.push({ op: 'undo-move', id: m.id, label: name(m.id), expect: m.new, restore: m.old, old: m.new, new: m.old });
    }
    const cats = scope === 'edge' || set.created.length ? set.created : [];
    for (const c of cats) changes.push({ op: 'undo-cat', id: c.id, label: c.name || `دستهٔ ${c.id}` });
    if (!changes.length) return [`چیزی برای برگرداندن نمانده (${fa(already)} کالا از پیش سر جایش است)${left.length ? `؛ ${fa(left.length)} کالا عوض شده و رد شد` : ''}.`];
    const toNone = changes.filter((c) => c.op === 'undo-move' && !c.restore);
    const toCat = changes.filter((c) => c.op === 'undo-move' && c.restore);
    const lines = changes.filter((c) => c.op === 'undo-move').map((c, i) => `${fa(i + 1)}. ${c.label}: دسته ${c.old} ← ${c.restore ? `دستهٔ ${c.restore}` : 'بدون دسته'}`);
    return this.make('U', { changes, skipped: left.map((x) => ({ label: x, why: 'changed' })), unchanged: already }, {
      header: `برگرداندن جابه‌جایی‌های ${src}`, params: { source: src, createdIds: cats.map((c) => c.id) },
      summary: `فقط دستهٔ کالا برمی‌گردد: ${fa(toNone.length)} کالا به بدون دسته و ${fa(toCat.length)} کالا به دستهٔ پیشین. ${cats.length ? `دسته‌هایی که همان کار ساخته (${cats.map((c) => c.name).join('، ')}) فقط اگر بعد از آن خالی باشند غیرفعال می‌شوند (حذف نمی‌شوند). ` : ''}کد و نام و قیمت دست نمی‌خورد؛ جابه‌جایی‌ها و کدهای پی‌وی‌سی می‌مانند. کالایی که از آن زمان کسی جابه‌جایش کرده رد و فهرست می‌شود.`,
      lines,
      extra: left.length ? [`رد شد (عوض شده): ${left.slice(0, 20).join('، ')}`] : [],
    });
  }

  // ------------------------------------------------------------------------------------------------ P: base prices one by one
  /** «قیمت 108 = 12» (several lines allowed): each line is resolved to ONE item and added to the draft; an unclear one is not taken. */
  async addPrices(lines) {
    const blocked = this.guard();
    if (blocked) return [blocked];
    const items = await this.items();
    const ctx = { items: items.filter((i) => i.Type !== 'Category'), history: null, taught: (c) => { const t = this.itemCodes?.get('', c); return t ? items.find((i) => String(i.Id) === String(t.itemId)) || null : null; } };
    const out = [];
    for (const ln of lines) {
      const { code, price } = ln;
      if (code === undefined) {
        const b = seriesBounds(ln);
        if (!b) { out.push(`✖ «سری ${ln.series}» درست نیست؛ سری‌ها صدتا صدتاست (سری ۱۰۰، سری ۲۰۰، سری ۱۸۰۰، …). این خط گرفته نشد.`); continue; }
        const found = seriesItems(items, b.lo, b.hi);
        if (!found.length) { out.push(`✖ ${b.label}: هیچ کالای فیلم پی‌وی‌سی با این کدها پیدا نشد. این خط گرفته نشد.`); continue; }
        this.draft.setSeries({ lo: b.lo, hi: b.hi, price, label: b.label });
        const own = found.filter((x) => this.draft.lines.some((l) => String(l.itemId) === String(x.item.Id)));
        const dup = seriesAmbiguous(items, b.lo, b.hi);
        out.push(`✓ ${b.label}: ${rangeText(found.map((x) => x.code))}، ${fa(found.length)} کالا؛ ${oldGroups(found.map((x) => x.item), price)}${own.length ? `\n   ${fa(own.length)} کالای آن خط جدا دارد و قیمت خط جدا را می‌گیرد` : ''}${dup.size ? `\n   ⚠️ این کدها چند کالای پی‌وی‌سی دارند و گرفته نشدند: ${[...dup].map(([c, v]) => `${fa(c)} (${v.map((i) => i.Name).join(' | ')})`).join('، ')}\n   برای هرکدام جدا بنویسید: قیمت <نام دقیق کالا> = <عدد>` : ''}`);
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

  reportLine(r) {
    const errs = (r.errors || []).slice(0, 10).map((x) => `\n• ${x.name}: ${x.why}`).join('') + (r.notes || []).slice(0, 15).map((x) => `\n• ${x}`).join('');
    return `${fa(r.changed)} تغییر کرد، ${fa(r.skipped)} رد شد (از پیش درست یا پیدا نشد)، ${fa(r.failed)} را کوییک‌بوکس نپذیرفت${r.stoppedAt ? `؛ در مورد ${fa(r.stoppedAt)} ایستاد: ${r.why}` : ''}${r.remaining ? `؛ ${fa(r.remaining)} مورد انجام نشد` : ''}.${errs}${(r.errors || []).length ? `\nبرای ادامهٔ بقیه همان فرمان کار را دوباره بنویسید (برای قیمت‌ها: «شروع کن»)؛ همان پیش‌نویس می‌ماند و آنچه انجام شده «از پیش درست» حساب می‌شود.` : ''}`;
  }

  async run(p, job) {
    const r = { changed: 0, skipped: p.skipped.length, failed: 0, stoppedAt: 0, why: '', remaining: 0, errors: [] };
    const done = [];
    try {
      for (const [i, ch] of p.changes.entries()) {
        if (ch.op === 'deactivate') { // an old item is switched off (never deleted, no adjustment made by the bot); QuickBooks may refuse: skip, say why
          try {
            const cur = (await this.qbo.get(`item/${encodeURIComponent(ch.id)}`))?.Item;
            if (!cur || !nameEq(cur.Name, ch.label)) { r.skipped += 1; (r.notes = r.notes || []).push(`${ch.label}: نامش با پیش‌نمایش نمی‌خواند و دست نخورد`); continue; }
            if (cur.Active === false) { r.skipped += 1; continue; }
            await this.qbo.write('POST', 'item', { Id: String(cur.Id), SyncToken: String(cur.SyncToken), sparse: true, Active: false }, { inactivateIds: [ch.id] });
            r.changed += 1; this.audit.add({ event: 'bulk-change', kind: p.kind, previewId: p.id, approver: 'owner', qboId: ch.id, field: 'deactivate', name: ch.label, qty: Number(cur.QtyOnHand) || 0, cost: Number(cur.PurchaseCost) || 0, new: 'inactive' });
          } catch (e) {
            if (e.status === 400) {
              r.failed += 1; r.errors.push({ name: ch.label, id: ch.id, why: [e.fault?.message, e.fault?.detail].filter(Boolean).join(' - ') || e.message });
              this.audit.add({ event: 'bulk-skip', kind: p.kind, previewId: p.id, qboId: ch.id, name: ch.label, fault: e.fault || undefined });
              if (this.gapMs) await this.sleep(this.gapMs);
              continue;
            }
            this.stop(r, p, i, e); break;
          }
          if (this.gapMs) await this.sleep(this.gapMs);
          continue;
        }
        if (ch.op === 'cat-activate') { // a category of ours that was switched off comes back (named in the plan, and the only item this step may touch)
          try {
            const cat = (await this.qbo.get(`item/${encodeURIComponent(ch.id)}`))?.Item;
            if (!cat || cat.Type !== 'Category') throw new Error('the category is gone');
            if (cat.Active === false) {
              await this.qbo.write('POST', 'item', { Id: String(cat.Id), SyncToken: String(cat.SyncToken), sparse: true, Active: true }, { categoryIds: [ch.id] });
              r.changed += 1; this.audit.add({ event: 'bulk-change', kind: p.kind, previewId: p.id, approver: 'owner', qboId: ch.id, field: 'category-activate', new: ch.new });
            } else r.skipped += 1;
          } catch (e) { this.stop(r, p, i, e); break; }
          if (this.gapMs) await this.sleep(this.gapMs);
          continue;
        }
        if (ch.op === 'undo-cat') { // a category the job made is switched off only if nothing active sits in it any more
          try {
            const kids = (await this.items(true)).filter((x) => String(x.ParentRef?.value || '') === ch.id && x.Active !== false);
            if (kids.length) { r.skipped += 1; (r.notes = r.notes || []).push(`${ch.label}: خالی نیست (${fa(kids.length)} کالا در آن است) و بسته نشد`); continue; }
            const cat = (await this.qbo.get(`item/${encodeURIComponent(ch.id)}`))?.Item;
            if (!cat || cat.Type !== 'Category' || cat.Active === false) { r.skipped += 1; continue; }
            await this.qbo.write('POST', 'item', { Id: String(cat.Id), SyncToken: String(cat.SyncToken), sparse: true, Active: false }, { categoryIds: p.params.createdIds || [] });
            r.changed += 1; this.audit.add({ event: 'bulk-change', kind: p.kind, previewId: p.id, approver: 'owner', qboId: ch.id, field: 'undo-category', new: 'inactive', of: p.params.source });
          } catch (e) {
            if (e.status === 400) { r.failed += 1; r.errors.push({ name: ch.label, id: ch.id, why: [e.fault?.message, e.fault?.detail].filter(Boolean).join(' - ') || e.message }); continue; }
            this.stop(r, p, i, e); break;
          }
          if (this.gapMs) await this.sleep(this.gapMs);
          continue;
        }
        if (ch.op === 'cat-create') { // the only creates: the categories (looked for again first, so a re-run never makes a second one)
          try {
            p.params.cats = p.params.cats || {};
            const have = categoryCandidates(await this.items(true), ch.new);
            if (have.exact) { p.params.cats[ch.cat] = String(have.exact.Id); r.skipped += 1; continue; }
            const parentId = ch.parent ? String(p.params.cats[ch.parent] || '') : '';
            if (ch.parent && !parentId) throw new Error('the parent category has no id');
            const made = await this.qbo.write('POST', 'item', { Name: ch.new, Type: 'Category', ...(parentId ? { ParentRef: { value: parentId }, SubItem: true } : {}) });
            p.params.cats[ch.cat] = String(made?.Item?.Id || '');
            if (!p.params.cats[ch.cat]) throw new Error('the category was made but its id is missing');
            r.changed += 1; this.audit.add({ event: 'bulk-change', kind: p.kind, previewId: p.id, approver: 'owner', qboId: p.params.cats[ch.cat], field: 'category-create', new: ch.new });
          } catch (e) { this.stop(r, p, i, e); break; }
          if (this.gapMs) await this.sleep(this.gapMs);
          continue;
        }
        let cur;
        try { cur = (await this.qbo.get(`${job.entity}/${encodeURIComponent(ch.id)}`))?.[job.entity === 'customer' ? 'Customer' : 'Item']; } catch (e) { this.stop(r, p, i, e); break; }
        if (!cur) { r.skipped += 1; continue; }
        const part = job.body(cur, ch, p); // computed from the record as it is NOW: already done = null
        if (!part) { r.skipped += 1; done.push(ch.id); const note = job.note?.(cur, ch, p); if (note) (r.notes = r.notes || []).push(note); continue; }
        const body = { Id: String(cur.Id), SyncToken: String(cur.SyncToken), sparse: true, ...part };
        if (Object.keys(part).some((k) => !job.fields.includes(k))) { this.stop(r, p, i, new Error('a field this job may not change')); break; } // defence: never beyond the job's fields
        try {
          await this.qbo.write('POST', job.entity, body, { renameIds: p.params.ids || [] });
          r.changed += 1; done.push(ch.id);
          this.audit.add({ event: 'bulk-change', kind: p.kind, previewId: p.id, approver: 'owner', qboId: body.Id, ...job.audit(cur, part, p, ch) });
          if (p.kind === 'F' && part.Name) for (const a of ch.alias || []) this.itemCodes?.set('', a, { Id: body.Id, Name: ch.name }); // the old names still find the item
        } catch (e) {
          if (e.status === 400) { // QuickBooks refused THIS record (a validation error): skip it, say why, and go on; anything else (401, 403, 429, 5xx, network) stops the job
            r.failed += 1;
            r.errors.push({ name: ch.label, id: ch.id, why: [e.fault?.message, e.fault?.detail].filter(Boolean).join(' - ') || e.message });
            this.audit.add({ event: 'bulk-skip', kind: p.kind, previewId: p.id, qboId: ch.id, name: ch.label, itemType: cur.Type, fault: e.fault || undefined });
            this.log(`QuickBooks bulk ${p.kind}: record ${ch.id} refused (400) ${e.fault?.message || ''} ${e.fault?.detail || ''}`.slice(0, 300));
            if (this.gapMs) await this.sleep(this.gapMs);
            continue;
          }
          this.stop(r, p, i, e); break;
        }
        if (this.gapMs) await this.sleep(this.gapMs);
      }
    } finally {
      p.status = r.stoppedAt ? 'pending' : 'done'; // after a stop it can be run again by its id: the done ones are skipped
      p.result = r; p.ran = true; // but it is no longer an "open" preview for a bare yes or no
      this.busy = false;
      if (p.kind === 'P') { this.draft.dropItems(done); if (!r.stoppedAt && !r.failed) this.draft.dropSeries(p.params.series || []); } // the prices that are in QuickBooks leave the draft
      this.store.save();
      this.itemCache = { at: 0, items: [] };
      this.desk.cache = { at: 0, customers: [] };
      try { this.afterRun?.(); } catch { /* the invoice catalogue is read again at its next use */ }
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

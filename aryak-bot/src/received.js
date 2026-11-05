// GOODS RECEIVED: when goods are bought for the company the storekeeper writes that N of the item arrived ("JUWAT 10 GALLEN
// RECEIVED", "250 Bags Received") in any internal group. Each is kept as an event of type 'received' (item or code, quantity,
// unit, supplier when named, day, group). It is stock arriving: never a sale, an order or a payment. A money-group note such as
// "<customer> 88 Received" has a customer and an amount but no counted unit, so it is not read as goods. Nothing is written to the
// sheet. The owner can ask what came in ("what was received this week", "چه کالایی رسید؟").

import { parseGoodsCaption } from './captions.js';
import { localParts } from './morning.js';

/** The received-goods event for a caption, or null when it is not one. */
export function receivedFrom(text, { group = '', at = Date.now() } = {}) {
  const g = parseGoodsCaption(text);
  if (!g || g.kind !== 'received') return null;
  const supplier = /\bfrom\s+([A-Za-z][A-Za-z .&'-]{1,40})$/i.exec(String(text || '').replace(/[.!?]+$/, '').trim())?.[1]?.trim() || '';
  const item = g.item.replace(/\bfrom\s+.+$/i, '').trim();
  const codes = [...item.matchAll(/(?:^|[^\d])(\d{2,5})(?:[^\d]|$)/g)].map((m) => m[1]);
  return { type: 'received', at, item, codes, quantity: g.quantity, unit: g.unit, supplier, group };
}

/** "what was received this week", "چه کالایی رسید؟" -> { period } ('today' | 'yesterday' | 'week' | 'month' | 'recent'); else null. */
export function parseReceivedQuery(text) {
  const s = String(text || '').toLowerCase().replace(/[?؟!.]+$/g, '').trim();
  const ask = /(?:what|which)\s+(?:goods\s+|items?\s+)?(?:was|were|has|have)\s+(?:been\s+)?received|goods\s+received|what\s+came\s+in|(?:چه|کدام)\s+کالا(?:یی|ها)?(?:\s+\S+)?\s+(?:رسید|رسیده)|کالاهای\s+رسیده|ماذا\s+وصل|البضاعة\s+المستلمة/u.test(s);
  if (!ask) return null;
  if (/today|امروز|اليوم/u.test(s)) return { period: 'today' };
  if (/yesterday|دیروز|امس/u.test(s)) return { period: 'yesterday' };
  if (/month|ماه|شهر/u.test(s)) return { period: 'month' };
  if (/week|هفته|أسبوع/u.test(s)) return { period: 'week' };
  return { period: 'recent' };
}

const SPAN = { today: 0, yesterday: 1, week: 7, month: 30, recent: 14 };

/** The answer: what came in during the period, one line per item and unit, in [lang] ('fa' for the owner, English for everyone else). */
export function receivedSummary(events, { period = 'recent', now = Date.now(), timeZone = 'Asia/Dubai', lang = 'en' } = {}) {
  const today = localParts(now, timeZone).day;
  const dayOf = (e) => localParts(e.at, timeZone).day;
  const since = localParts(now - (SPAN[period] ?? 14) * 86400000, timeZone).day;
  const list = events.filter((e) => e.type === 'received' && dayOf(e) >= since && (period !== 'yesterday' || dayOf(e) === since) && dayOf(e) <= today);
  const fa = lang === 'fa';
  if (!list.length) return fa ? 'در این بازه کالایی دریافت‌شده ثبت نشده است.' : 'No received goods are recorded for this period.';
  const by = new Map();
  for (const e of list) {
    const k = `${e.item.toLowerCase().replace(/\s+/g, ' ')}|${e.unit}`;
    const cur = by.get(k) || { item: e.item, unit: e.unit, quantity: 0, days: new Set(), suppliers: new Set() };
    cur.quantity += e.quantity; cur.days.add(dayOf(e)); if (e.supplier) cur.suppliers.add(e.supplier);
    by.set(k, cur);
  }
  const rows = [...by.values()].map((r) => `- ${r.item}: ${Math.round(r.quantity * 100) / 100} ${r.unit}${r.suppliers.size ? ` (${fa ? 'از' : 'from'} ${[...r.suppliers].join(', ')})` : ''}, ${[...r.days].sort().join(', ')}`);
  return [fa ? `کالاهای دریافت‌شده (${list.length} ثبت):` : `Goods received (${list.length} entr${list.length === 1 ? 'y' : 'ies'}):`, ...rows.slice(0, 15), ...(rows.length > 15 ? [fa ? `و ${rows.length - 15} مورد دیگر` : `and ${rows.length - 15} more`] : [])].join('\n');
}

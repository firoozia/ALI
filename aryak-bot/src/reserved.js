// «Which colours are reserved?»: every code with something reserved in the stock sheet, its reserved metres and who it is reserved for. Read only.
import { askSheet } from './stock.js';

const fmt = (n) => (Math.round(Number(n) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

export async function fetchReserved(config, fetchImpl = fetch, opts = {}) {
  const body = JSON.stringify({ action: 'botStock', token: config.botToken, reservedList: true });
  return askSheet(config, body, 'reserved list', fetchImpl, opts);
}

/** The rows of the sheet answer sorted by code (numbers by value, then letters). */
export const sortedReserved = (rows = []) => [...rows].filter((r) => Number(r.reserved) > 0)
  .sort((a, b) => String(a.code).localeCompare(String(b.code), 'en', { numeric: true, sensitivity: 'base' }));

export function reservedText(result, lang = 'en') {
  const fa = lang === 'fa';
  if (!result || result.ok === false || !Array.isArray(result.rows)) return fa ? 'فهرست رزروها را از جدول نتوانستم بخوانم؛ کمی بعد دوباره بپرسید.' : 'I could not read the reserved list from the sheet; please ask again in a moment.';
  const rows = sortedReserved(result.rows);
  if (!rows.length) return fa ? 'الان هیچ کدی رزرو نیست.' : 'Nothing is reserved right now.';
  const lines = rows.map((r) => `${r.code} — ${fmt(r.reserved)} ${r.unit || ''}`.trim() + (r.customers?.length ? ` — ${fa ? 'برای' : 'for'} ${r.customers.join(', ')}` : ''));
  return [fa ? `رزروشده تا الان (${rows.length} کد)` : `Reserved so far (${rows.length} code${rows.length === 1 ? '' : 's'})`, ...lines].join('\n');
}

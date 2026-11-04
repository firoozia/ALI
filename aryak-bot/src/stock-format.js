// The team's stock answer, in the owner's fixed format (Persian lines, figures exactly as in the sheet).
// Customers never get this: it shows the internal minimum and reserved stock.
//
// The CODE is the product. Staff often type the size of a code differently from one row to the next, so every row
// of a code is added up into ONE block: total free and reserved, all packages and open pieces together, all
// places, and the minimum compared with the code total. The sizes found in the rows are listed in one line.

const GROUPS_FA = {
  'pvc film': 'فیلم PVC', pvc: 'فیلم PVC', 'edge banding': 'لبه‌چسب', glue: 'چسب', glues: 'چسب', rail: 'ریل', hinge: 'لولا', hardware: 'یراق‌آلات',
};

const MAX_PIECES = 6;

/** Figures as the sheet shows them: Latin digits, "." as the decimal point, at most two decimals. */
export const num = (n) => (Math.round(Number(n) * 100) / 100).toString();

/** "5 بسته 120 m + باز: 35 m و 45 m (کل 680 m)"; more than six open pieces: the first six, then "و N قطعهٔ دیگر". */
const packsLine = (s, unit, total) => {
  const parts = [];
  if (s.packs.length) parts.push(s.packs.map((p) => `${p.count} بسته ${num(p.qty)} ${unit}`).join(' + '));
  if (s.pieces.length) {
    const shown = s.pieces.slice(0, MAX_PIECES).map((q) => `${num(q)} ${unit}`);
    const rest = s.pieces.length - shown.length;
    parts.push(`باز: ${shown.join(' و ')}${rest > 0 ? ` و ${rest} قطعهٔ دیگر` : ''}`);
  }
  return `${parts.length ? parts.join(' + ') : 'بدون بسته'} (کل ${num(total)} ${unit})`;
};

/** The wording for a sheet that does not give packs and pieces. */
const packagesLine = (packages, open) => {
  if (!packages) return 'بدون بسته';
  if (open === packages) return `${packages} بسته، باز شده`;
  if (open === 0) return `${packages} بسته، دست‌نخورده`;
  return `${packages} بسته، ${open} باز شده`;
};

const placeNames = (locations) => (locations || []).map((l) => String(l).replace(/:\s*\d+\s*$/, '').trim()).filter(Boolean);

/** An empty row of the sheet: no size, no stock, no packages. It tells the team nothing. */
const isPlaceholder = (s) => !String(s.size || '').trim() && !(Number(s.free) || 0) && !(Number(s.reserved) || 0) && !(Number(s.packages) || 0);

const warning = (limit, unit) => `⚠️  موجودی آزاد زیر حداقل موجودی (${num(limit)} ${unit}) است`;

const sumOf = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

/** All rows of the code as one: totals, packs grouped by pack size, every open piece, every place, the distinct sizes. */
export function aggregate(rows, result) {
  const sizes = [...new Set(rows.map((r) => String(r.size || '').trim()).filter(Boolean))];
  const withPacks = rows.every((r) => Array.isArray(r.packs) && Array.isArray(r.pieces));
  let packs;
  let pieces;
  if (withPacks) {
    const byQty = new Map();
    for (const r of rows) for (const p of r.packs) byQty.set(p.qty, (byQty.get(p.qty) || 0) + p.count);
    packs = [...byQty].sort((a, b) => b[0] - a[0]).map(([qty, count]) => ({ qty, count }));
    pieces = rows.flatMap((r) => r.pieces);
  }
  const ownPlaces = [...new Set(rows.flatMap((r) => placeNames(r.locations)))];
  const reservedKnown = rows.some((r) => r.reserved !== undefined && r.reserved !== null);
  return {
    sizes,
    free: sumOf(rows, 'free'),
    reserved: reservedKnown ? sumOf(rows, 'reserved') : (Number(result.reserved) || 0),
    packages: sumOf(rows, 'packages'),
    open: sumOf(rows, 'open'),
    // The sheet's figure for the whole code; one row alone keeps its own.
    limit: rows.length === 1 ? Number(rows[0].limit) || 0 : Number(result.limit) || sumOf(rows, 'limit'),
    packs,
    pieces,
    places: ownPlaces.length ? ownPlaces : placeNames(result.locations),
  };
}

/** The one block of a botStock result. */
export function stockBlocks(result) {
  const unit = result.unit || '';
  const cat = GROUPS_FA[String(result.category || '').toLowerCase()] || result.category || '';
  let rows = (result.sizes && result.sizes.length ? result.sizes : [{ size: result.size || '', free: result.free, packages: 0, open: 0, limit: result.limit }]);
  const real = rows.filter((s) => !isPlaceholder(s));
  if (real.length) rows = real;
  const a = aggregate(rows, result);
  const low = a.limit > 0 && a.free < a.limit;
  const nothing = a.sizes.length > 1 && a.free === 0 && a.reserved === 0;
  const sizeLine = a.sizes.length > 1 ? `- اندازه‌های ثبت‌شده: ${a.sizes.join(' و ')}` : `- سایز: ${a.sizes[0] || '—'}`;
  if (nothing) return [[`موجودی کد ${result.code} (${cat}) ندارد`, sizeLine].join('\n')];
  const lines = [
    `موجودی کد ${result.code} (${cat}) ${low ? 'خیلی کم است' : 'کافی است'}`,
    sizeLine,
    `- آزاد: ${num(a.free)} ${unit}`,
    `- رزرو: ${num(a.reserved)} ${unit}`,
    `- حداقل موجودی: ${num(a.limit)} ${unit}`,
    `- بسته: ${a.packs ? packsLine(a, unit, a.free + a.reserved) : packagesLine(a.packages, a.open)}`,
    `- محل: ${a.places.length ? a.places.join('، ') : '—'}`,
  ];
  if (low) lines.push('', warning(a.limit, unit));
  return [lines.join('\n')];
}

/**
 * The whole answer for a botStock result. [note]: a line put first (for example "the size you named is not
 * registered, this is the whole code").
 */
export function formatStaffStock(result, askedCode = '', note = '') {
  if (!result.found) return `کد ${result.code || askedCode} در فهرست پیدا نشد.`;
  if (result.ambiguous) return `کد ${askedCode} در چند گروه هست:\n${result.categories.map((c, i) => `${i + 1}) ${c}`).join('\n')}\nکدام را می‌خواهید؟ (نام یا شماره را بنویسید)`;
  if (result.sizeFound === false) return `کد ${result.code} با اندازهٔ ${result.size} نیست. اندازه‌های موجود: ${(result.sizes || []).join('، ') || '—'}`;
  return [note, ...stockBlocks(result)].filter(Boolean).join('\n\n');
}

// The team's stock answer, in the owner's fixed format (Persian lines, figures exactly as in the sheet).
// Customers never get this: it shows the internal limit and reserved stock.

const GROUPS_FA = {
  'pvc film': 'فیلم PVC', pvc: 'فیلم PVC', 'edge banding': 'لبه‌چسب', glue: 'چسب', glues: 'چسب', rail: 'ریل', hinge: 'لولا', hardware: 'یراق‌آلات',
};

/** Figures as the sheet shows them: Latin digits, "." as the decimal point, at most two decimals. */
export const num = (n) => (Math.round(Number(n) * 100) / 100).toString();

/** "5 بسته 120 m + باز: 35 m و 45 m (کل 680 m)": full packs, the open pieces one by one, and free plus reserved. */
const packsLine = (s, unit, total) => {
  const parts = [];
  if (s.packs.length) parts.push(s.packs.map((p) => `${p.count} بسته ${num(p.qty)} ${unit}`).join(' + '));
  if (s.pieces.length) parts.push(`باز: ${s.pieces.map((q) => `${num(q)} ${unit}`).join(' و ')}`);
  return `${parts.length ? parts.join(' + ') : 'بدون بسته'} (کل ${num(total)} ${unit})`;
};

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

/**
 * One block per real size row of a botStock result. A block below its minimum carries the warning under it; when
 * several sizes are below their minimum the warning is written once, at the end, listing them.
 */
export function stockBlocks(result) {
  const unit = result.unit || '';
  const cat = GROUPS_FA[String(result.category || '').toLowerCase()] || result.category || '';
  let rows = (result.sizes && result.sizes.length ? result.sizes : [{ size: result.size || '', free: result.free, packages: 0, open: 0, limit: result.limit }]);
  const real = rows.filter((s) => !isPlaceholder(s));
  if (real.length) rows = real;
  const info = rows.map((s) => {
    const free = Number(s.free) || 0;
    const limit = Number(s.limit) || 0;
    const low = limit > 0 && free < limit;
    const reserved = s.reserved ?? (rows.length === 1 ? result.reserved : 0);
    const places = placeNames(s.locations && s.locations.length ? s.locations : result.locations);
    const lines = [
      `موجودی کد ${result.code} (${cat}) ${low ? 'خیلی کم است' : 'کافی است'}`,
      `- سایز: ${s.size || '—'}`,
      `- آزاد: ${num(free)} ${unit}`,
      `- رزرو: ${num(reserved)} ${unit}`,
      `- حداقل موجودی: ${num(limit)} ${unit}`,
      `- بسته: ${Array.isArray(s.packs) && Array.isArray(s.pieces)
        ? packsLine(s, unit, free + (Number(reserved) || 0))
        : packagesLine(Number(s.packages) || 0, Number(s.open) || 0)}`,
      `- محل: ${places.length ? places.join('، ') : '—'}`,
    ];
    return { s, free, limit, low, lines };
  });
  const lows = info.filter((i) => i.low);
  const grouped = lows.length > 1;
  const blocks = info.map((i) => (i.low && !grouped ? [...i.lines, '', warning(i.limit, unit)].join('
') : i.lines.join('
')));
  if (grouped) {
    blocks.push(['⚠️  موجودی آزاد این اندازه‌ها زیر حداقل موجودی است:',
      ...lows.map((i) => `- ${i.s.size || '—'}: ${num(i.free)} ${unit} (حداقل ${num(i.limit)} ${unit})`)].join('
'));
  }
  return blocks;
}

/** The whole answer for a botStock result: blocks separated by a blank line, or a short line for the odd cases. */
export function formatStaffStock(result, askedCode = '') {
  if (!result.found) return `کد ${result.code || askedCode} در فهرست پیدا نشد.`;
  if (result.ambiguous) return `کد ${askedCode} در چند گروه هست: ${result.categories.join('، ')}. کدام را می‌خواهید؟`;
  if (result.sizeFound === false) return `کد ${result.code} با اندازهٔ ${result.size} نیست. اندازه‌های موجود: ${(result.sizes || []).join('، ') || '—'}`;
  return stockBlocks(result).join('\n\n');
}

// The team's stock answer, in the owner's fixed format (Persian lines, figures exactly as in the sheet).
// Customers never get this: it shows the internal minimum and reserved stock.
//
// A code with ONE real size keeps the original block. A code with several sizes gets one overall verdict on the total,
// a block per size that has stock or a reservation, and one line naming the sizes that have none.

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

/** The size, free, reserved, minimum, packages and place lines of one size row. */
function sizeLines(s, result, unit, reserved) {
  const free = Number(s.free) || 0;
  const places = placeNames(s.locations && s.locations.length ? s.locations : result.locations);
  return [
    `- سایز: ${s.size || '—'}`,
    `- آزاد: ${num(free)} ${unit}`,
    `- رزرو: ${num(reserved)} ${unit}`,
    `- حداقل موجودی: ${num(Number(s.limit) || 0)} ${unit}`,
    `- بسته: ${Array.isArray(s.packs) && Array.isArray(s.pieces)
      ? packsLine(s, unit, free + (Number(reserved) || 0))
      : packagesLine(Number(s.packages) || 0, Number(s.open) || 0)}`,
    `- محل: ${places.length ? places.join('، ') : '—'}`,
  ];
}

/** The minimum of the whole code: the sheet's own figure, else the sizes' minimums added up. */
const codeLimit = (result, rows) => Number(result.limit) || rows.reduce((sum, s) => sum + (Number(s.limit) || 0), 0);

/** Blocks of a botStock result (one block for a single size; for several sizes see multiSizeBlocks). */
export function stockBlocks(result) {
  const unit = result.unit || '';
  const cat = GROUPS_FA[String(result.category || '').toLowerCase()] || result.category || '';
  let rows = (result.sizes && result.sizes.length ? result.sizes : [{ size: result.size || '', free: result.free, packages: 0, open: 0, limit: result.limit }]);
  const real = rows.filter((s) => !isPlaceholder(s));
  if (real.length) rows = real;
  if (rows.length > 1) return multiSizeBlocks(result, rows, unit, cat);

  const s = rows[0];
  const free = Number(s.free) || 0;
  const limit = Number(s.limit) || 0;
  const low = limit > 0 && free < limit;
  const reserved = s.reserved ?? result.reserved ?? 0;
  const lines = [`موجودی کد ${result.code} (${cat}) ${low ? 'خیلی کم است' : 'کافی است'}`, ...sizeLines(s, result, unit, reserved)];
  if (low) lines.push('', warning(limit, unit));
  return [lines.join('\n')];
}

function multiSizeBlocks(result, rows, unit, cat) {
  const has = (s) => (Number(s.free) || 0) > 0 || (Number(s.reserved) || 0) > 0;
  const stocked = rows.filter(has);
  const empty = rows.filter((s) => !has(s));
  if (!stocked.length) {
    return [[`موجودی کد ${result.code} (${cat}) ندارد`, `- سایزها: ${rows.map((s) => s.size || '—').join('، ')}`].join('\n')];
  }
  const total = stocked.reduce((sum, s) => sum + (Number(s.free) || 0), 0);
  const limit = codeLimit(result, rows);
  const low = limit > 0 && total < limit;
  const blocks = [`موجودی کد ${result.code} (${cat}) ${low ? 'خیلی کم است' : 'کافی است'} (کل آزاد: ${num(total)} ${unit})`];
  for (const s of stocked) {
    const lines = sizeLines(s, result, unit, s.reserved ?? 0);
    // A size is called low only when the whole code is low as well.
    const sizeLimit = Number(s.limit) || 0;
    if (low && sizeLimit > 0 && (Number(s.free) || 0) < sizeLimit) lines.push(`⚠️  این اندازه زیر حداقل موجودی (${num(sizeLimit)} ${unit}) است`);
    blocks.push(lines.join('\n'));
  }
  if (empty.length) blocks.push(`بدون موجودی: ${empty.map((s) => s.size || '—').join('، ')}`);
  if (low) blocks.push(warning(limit, unit));
  return blocks;
}

/** The whole answer for a botStock result: blocks separated by a blank line, or a short line for the odd cases. */
export function formatStaffStock(result, askedCode = '') {
  if (!result.found) return `کد ${result.code || askedCode} در فهرست پیدا نشد.`;
  if (result.ambiguous) return `کد ${askedCode} در چند گروه هست: ${result.categories.join('، ')}. کدام را می‌خواهید؟`;
  if (result.sizeFound === false) return `کد ${result.code} با اندازهٔ ${result.size} نیست. اندازه‌های موجود: ${(result.sizes || []).join('، ') || '—'}`;
  return stockBlocks(result).join('\n\n');
}

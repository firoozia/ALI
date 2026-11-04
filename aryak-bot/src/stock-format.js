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

/** One block per size row of a botStock result. */
export function stockBlocks(result) {
  const unit = result.unit || '';
  const cat = GROUPS_FA[String(result.category || '').toLowerCase()] || result.category || '';
  const rows = (result.sizes && result.sizes.length ? result.sizes : [{ size: result.size || '', free: result.free, packages: 0, open: 0, limit: result.limit }]);
  return rows.map((s) => {
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
      `- حد ربات: ${num(limit)} ${unit}`,
      `- بسته: ${Array.isArray(s.packs) && Array.isArray(s.pieces)
        ? packsLine(s, unit, free + (Number(reserved) || 0))
        : packagesLine(Number(s.packages) || 0, Number(s.open) || 0)}`,
      `- محل: ${places.length ? places.join('، ') : '—'}`,
    ];
    if (low) lines.push('', `⚠️  موجودی آزاد زیر حد ${num(limit)} ${unit} است`);
    return lines.join('\n');
  });
}

/** The whole answer for a botStock result: blocks separated by a blank line, or a short line for the odd cases. */
export function formatStaffStock(result, askedCode = '') {
  if (!result.found) return `کد ${result.code || askedCode} در فهرست پیدا نشد.`;
  if (result.ambiguous) return `کد ${askedCode} در چند گروه هست: ${result.categories.join('، ')}. کدام را می‌خواهید؟`;
  if (result.sizeFound === false) return `کد ${result.code} با اندازهٔ ${result.size} نیست. اندازه‌های موجود: ${(result.sizes || []).join('، ') || '—'}`;
  return stockBlocks(result).join('\n\n');
}

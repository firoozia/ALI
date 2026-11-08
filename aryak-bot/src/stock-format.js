// The team's stock answer, in the owner's fixed format. Customers never get this: it shows the internal minimum and
// reserved stock.
//
// The CODE is the product. Staff often type the size of a code differently from one row to the next, so every row
// of a code is added up into ONE block: total free and reserved, all packages and open pieces together, all
// places, and the minimum compared with the code total. The sizes found in the rows are listed in one line.
//
// The words follow the language of the question (Persian by default; Arabic, English and Urdu). Figures, units,
// codes and place names are exactly as in the sheet in every language.

import { langOf } from './lang.js';

const MAX_PIECES = 6;

/** Figures as the sheet shows them: Latin digits, "." as the decimal point, at most two decimals. */
export const num = (n) => (Math.round(Number(n) * 100) / 100).toString();

/** Group names in each language, keyed by the sheet's own name in lower case; others stay as the sheet has them. */
const GROUPS = {
  fa: { 'pvc film': 'فیلم PVC', pvc: 'فیلم PVC', 'edge banding': 'لبه‌چسب', glue: 'چسب', glues: 'چسب', rail: 'ریل', hinge: 'لولا', hardware: 'یراق‌آلات' },
  ar: { 'pvc film': 'فيلم PVC', pvc: 'فيلم PVC', 'edge banding': 'شريط حواف', glue: 'غراء', glues: 'غراء', rail: 'سكة', hinge: 'مفصلة', hardware: 'إكسسوارات' },
  ur: { 'pvc film': 'پی وی سی فلم', pvc: 'پی وی سی فلم', 'edge banding': 'ایج بینڈنگ', glue: 'گوند', glues: 'گوند', rail: 'ریل', hinge: 'قبضہ', hardware: 'ہارڈ ویئر' },
  en: {},
};

/** All the fixed words, per language. A function takes the figures it needs. */
const L = {
  fa: {
    codeWord: 'کد', totalWord: 'جمع', freeWord: 'آزاد',
    head: (code, cat, v) => `موجودی کد ${code} (${cat}) ${v}`,
    ok: 'کافی است', low: 'خیلی کم است', none: 'ندارد',
    size: 'سایز', sizes: 'اندازه‌های ثبت‌شده', free: 'آزاد', reserved: 'رزرو', min: 'حداقل موجودی', packages: 'بسته', place: 'محل',
    and: ' و ', comma: '،',
    units: { m: 'متر', mtr: 'متر', meter: 'متر', metre: 'متر', roll: 'رول', rolls: 'رول', pcs: 'عدد', pc: 'عدد', kg: 'کیلوگرم', ctn: 'کارتن' }, // Persian answers carry Persian unit words end to end
    pack: (n, q, u) => `${n} بسته ${q} ${u}`, open: 'باز', more: (n) => `${n} قطعهٔ دیگر`, total: (n, u) => `(کل ${n} ${u})`, noPackages: 'بدون بسته',
    pk: (n) => `${n} بسته`, allOpen: 'باز شده', untouched: 'دست‌نخورده', someOpen: (n) => `${n} باز شده`,
    warning: (n, u) => `⚠️  موجودی آزاد زیر حداقل موجودی (${n} ${u}) است`,
    notFound: (code) => `برای کد ${code} موجودی ثبت‌شده‌ای نیست (ممکن است تمام شده باشد؛ شاید کد مشابه با حرف مانند «${code} C» باشد).`,
    ambiguous: (code, list) => `کد ${code} در چند گروه هست:\n${list}\nکدام را می‌خواهید؟ (نام یا شماره را بنویسید)`,
    noSize: (code, size, list) => `کد ${code} با اندازهٔ ${size} نیست. اندازه‌های موجود: ${list}`,
    stale: (n) => `(آخرین بروزرسانی: ${n} دقیقه پیش، برگه الان پاسخ نداد)`,
    asked: (q, u, f) => `- درخواست: ${q} ${u}، آزاد: ${f}`,
    enough: 'کافی است',
    shortBy: (n, u) => `کافی نیست؛ کمبود ${n} ${u}`,
    tight: 'کافی است ولی از حداقل موجودی کمتر می‌ماند',
    noConv: 'تبدیل واحد ممکن نشد؛ مقدار قابل مقایسه نیست',
  },
  ar: {
    codeWord: 'الكود', totalWord: 'الإجمالي', freeWord: 'المتاح',
    head: (code, cat, v) => `مخزون الكود ${code} (${cat}) ${v}`,
    ok: 'كافٍ', low: 'منخفض جدًا', none: 'غير متوفر',
    size: 'الحجم', sizes: 'الأحجام المسجلة', free: 'المتاح', reserved: 'المحجوز', min: 'الحد الأدنى للمخزون', packages: 'العبوات', place: 'الموقع',
    and: ' و ', comma: '،',
    pack: (n, q, u) => `${n} عبوة ${q} ${u}`, open: 'مفتوح', more: (n) => `${n} قطعة أخرى`, total: (n, u) => `(الإجمالي ${n} ${u})`, noPackages: 'بدون عبوات',
    pk: (n) => `${n} عبوة`, allOpen: 'كلها مفتوحة', untouched: 'لم تُفتح', someOpen: (n) => `${n} مفتوحة`,
    warning: (n, u) => `⚠️  المخزون المتاح أقل من الحد الأدنى (${n} ${u})`,
    notFound: (code) => `لا يوجد مخزون مسجّل للكود ${code} (ربما نفد؛ وربما يوجد كود مشابه بحرف مثل «${code} C»).`,
    ambiguous: (code, list) => `الكود ${code} موجود في عدة مجموعات:\n${list}\nأيها تقصد؟ (اكتب الاسم أو الرقم)`,
    noSize: (code, size, list) => `الكود ${code} غير مسجل بالحجم ${size}. الأحجام المتوفرة: ${list}`,
    stale: (n) => `(آخر تحديث: قبل ${n} دقيقة، الجدول لم يستجب الآن)`,
    asked: (q, u, f) => `- المطلوب: ${q} ${u}، المتاح: ${f}`,
    enough: 'كافٍ',
    shortBy: (n, u) => `غير كافٍ؛ النقص ${n} ${u}`,
    tight: 'كافٍ لكن يبقى أقل من الحد الأدنى للمخزون',
    noConv: 'تعذّر تحويل الوحدة؛ لا يمكن المقارنة',
  },
  en: {
    codeWord: 'Code', totalWord: 'Total', freeWord: 'free',
    head: (code, cat, v) => `Stock of code ${code} (${cat}) ${v}`,
    ok: 'is enough', low: 'is very low', none: 'is none',
    size: 'Size', sizes: 'Sizes on record', free: 'Free', reserved: 'Reserved', min: 'Minimum stock', packages: 'Packages', place: 'Location',
    and: ' and ', comma: ',',
    pack: (n, q, u) => `${n} ${n === 1 ? 'pack' : 'packs'} of ${q} ${u}`, open: 'open', more: (n) => `${n} more ${n === 1 ? 'piece' : 'pieces'}`, total: (n, u) => `(total ${n} ${u})`, noPackages: 'no packages',
    pk: (n) => `${n} ${n === 1 ? 'package' : 'packages'}`, allOpen: 'all opened', untouched: 'untouched', someOpen: (n) => `${n} opened`,
    warning: (n, u) => `⚠️  Free stock is below the minimum stock (${n} ${u})`,
    notFound: (code) => `Code ${code} has no stock on record (it may be sold out; a similar code with a letter such as "${code} C" may exist).`,
    ambiguous: (code, list) => `Code ${code} is in several groups:\n${list}\nWhich one do you mean? (write the name or the number)`,
    noSize: (code, size, list) => `Code ${code} has no size ${size}. Sizes on record: ${list}`,
    stale: (n) => `(Last updated ${n} minutes ago, the sheet did not answer just now)`,
    asked: (q, u, f) => `- Requested: ${q} ${u}, free: ${f}`,
    enough: 'enough',
    shortBy: (n, u) => `NOT enough; short by ${n} ${u}`,
    tight: 'enough, but it leaves less than the minimum stock',
    noConv: 'the unit could not be converted; cannot compare',
  },
  ur: {
    codeWord: 'کوڈ', totalWord: 'کل', freeWord: 'دستیاب',
    head: (code, cat, v) => `کوڈ ${code} (${cat}) کا اسٹاک ${v}`,
    ok: 'کافی ہے', low: 'بہت کم ہے', none: 'دستیاب نہیں',
    size: 'سائز', sizes: 'رجسٹرڈ سائز', free: 'دستیاب', reserved: 'محفوظ شدہ', min: 'کم از کم اسٹاک', packages: 'پیکٹ', place: 'مقام',
    and: ' اور ', comma: '،',
    pack: (n, q, u) => `${n} پیکٹ ${q} ${u}`, open: 'کھلے ہوئے', more: (n) => `${n} ٹکڑے مزید`, total: (n, u) => `(کل ${n} ${u})`, noPackages: 'کوئی پیکٹ نہیں',
    pk: (n) => `${n} پیکٹ`, allOpen: 'سب کھلے ہوئے', untouched: 'بند', someOpen: (n) => `${n} کھلے ہوئے`,
    warning: (n, u) => `⚠️  دستیاب اسٹاک کم از کم اسٹاک (${n} ${u}) سے کم ہے`,
    notFound: (code) => `کوڈ ${code} کا کوئی اسٹاک درج نہیں (شاید ختم ہو گیا ہو؛ حرف والا ملتا جلتا کوڈ جیسے «${code} C» ہو سکتا ہے)۔`,
    ambiguous: (code, list) => `کوڈ ${code} کئی گروپس میں ہے:\n${list}\nآپ کون سا چاہتے ہیں؟ (نام یا نمبر لکھیں)`,
    noSize: (code, size, list) => `کوڈ ${code} میں سائز ${size} نہیں ہے۔ موجود سائز: ${list}`,
    stale: (n) => `(آخری اپڈیٹ: ${n} منٹ پہلے، شیٹ نے ابھی جواب نہیں دیا)`,
    asked: (q, u, f) => `- درخواست: ${q} ${u}، دستیاب: ${f}`,
    enough: 'کافی ہے',
    shortBy: (n, u) => `کافی نہیں؛ کمی ${n} ${u}`,
    tight: 'کافی ہے مگر کم از کم اسٹاک سے کم بچے گا',
    noConv: 'یونٹ تبدیل نہ ہو سکا؛ موازنہ ممکن نہیں',
  },
};

/** Hindi has no table of its own: its stock block is written in English. */
const wordsOf = (lang, units = false) => { const t = L[langOf(lang) === 'hi' ? 'en' : langOf(lang)] || L.fa; return units || !t.units ? t : { ...t, units: undefined }; }; // unit words (متر) only when asked: the older answers keep the sheet's own units
const groupsOf = (lang) => GROUPS[langOf(lang) === 'hi' ? 'en' : langOf(lang)] || GROUPS.fa;

/** "5 بسته 120 m + باز: 35 m و 45 m (کل 680 m)"; more than six open pieces: the first six, then "and N more". */
const packsLine = (s, unit, total, t) => {
  const parts = [];
  if (s.packs.length) parts.push(s.packs.map((p) => t.pack(p.count, num(p.qty), unit)).join(' + '));
  if (s.pieces.length) {
    const shown = s.pieces.slice(0, MAX_PIECES).map((q) => `${num(q)} ${unit}`);
    const rest = s.pieces.length - shown.length;
    parts.push(`${t.open}: ${shown.join(t.and)}${rest > 0 ? `${t.and}${t.more(rest)}` : ''}`);
  }
  return `${parts.length ? parts.join(' + ') : t.noPackages} ${t.total(num(total), unit)}`;
};

/** The wording for a sheet that does not give packs and pieces. */
const packagesLine = (packages, open, t) => {
  if (!packages) return t.noPackages;
  if (open === packages) return `${t.pk(packages)}${t.comma} ${t.allOpen}`;
  if (open === 0) return `${t.pk(packages)}${t.comma} ${t.untouched}`;
  return `${t.pk(packages)}${t.comma} ${t.someOpen(open)}`;
};

const placeNames = (locations) => (locations || []).map((l) => String(l).replace(/:\s*\d+\s*$/, '').trim()).filter(Boolean);

/** An empty row of the sheet: no size, no stock, no packages. It tells the team nothing. */
const isPlaceholder = (s) => !String(s.size || '').trim() && !(Number(s.free) || 0) && !(Number(s.reserved) || 0) && !(Number(s.packages) || 0);

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

/**
 * A requested quantity against the free stock: the request, what is free and a clear verdict (enough / short by N / enough but
 * under the minimum). [want] is { quantity, unit } as asked; the sheet's own conversion (askedInUnit) wins when it has one.
 */
function askedLine(result, a, want, t, unit, shown0 = unit) {
  const q = Number(want?.quantity);
  if (!(q > 0)) return null;
  const shown = `${num(q)}`;
  const shownUnit = want.unit ? (t.units?.[String(want.unit).toLowerCase()] || want.unit) : shown0;
  const line = t.asked(shown, shownUnit, `${num(a.free)} ${shown0}`);
  let inUnit = Number(result.askedInUnit) || 0;
  if (!inUnit && (!want.unit || want.unit === unit)) inUnit = q;
  if (result.qtyChecked === false || !inUnit) return ['', line, `→ ${t.noConv}`];
  const free = a.free;
  const verdict = inUnit > free + 1e-6 ? t.shortBy(num(inUnit - free), unit)
    : a.limit > 0 && free - inUnit < a.limit - 1e-6 ? t.tight : t.enough;
  return ['', line, `→ ${verdict.replace(` ${unit}`, ` ${shown0}`)}`];
}

/** A quantity for the big first line: thousands separated, at most two decimals (1,104.9). */
export const bigNum = (n) => Number(num(n)).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** The one block of a botStock result, in [lang]. [opts.boldTotal]: the total stands alone on the first line in WhatsApp bold. */
export function stockBlocks(result, lang = 'fa', want = null, opts = {}) {
  const t = wordsOf(lang, !!opts.units);
  const unit = result.unit || '';
  const du = t.units?.[unit.toLowerCase()] || unit; // the unit as written in this language
  const cat = groupsOf(lang)[String(result.category || '').toLowerCase()] || result.category || '';
  let rows = (result.sizes && result.sizes.length ? result.sizes : [{ size: result.size || '', free: result.free, packages: 0, open: 0, limit: result.limit }]);
  const real = rows.filter((s) => !isPlaceholder(s));
  if (real.length) rows = real;
  const a = aggregate(rows, result);
  const low = a.limit > 0 && a.free < a.limit;
  const nothing = a.sizes.length > 1 && a.free === 0 && a.reserved === 0;
  const sizeLine = a.sizes.length > 1 ? `- ${t.sizes}: ${a.sizes.join(t.and)}` : `- ${t.size}: ${a.sizes[0] || '—'}`;
  if (nothing) return [[t.head(result.code, cat, t.none), sizeLine].join('\n')];
  const total = a.free + a.reserved;
  const big = opts.boldTotal ? [`*${t.codeWord} ${result.code} — ${t.totalWord}: ${bigNum(total)} ${du}${a.reserved > 0 ? ` (${t.freeWord} ${bigNum(a.free)} ${du})` : ''}*`] : [];
  const lines = [
    ...big,
    t.head(result.code, cat, low ? t.low : t.ok),
    sizeLine,
    `- ${t.free}: ${num(a.free)} ${du}`,
    `- ${t.reserved}: ${num(a.reserved)} ${du}`,
    `- ${t.min}: ${num(a.limit)} ${du}`,
    `- ${t.packages}: ${a.packs ? packsLine(a, du, a.free + a.reserved, t) : packagesLine(a.packages, a.open, t)}`,
    `- ${t.place}: ${a.places.length ? a.places.join(`${t.comma} `) : '—'}`,
  ];
  const ask = askedLine(result, a, want, t, unit, du);
  if (ask) lines.push(...ask);
  if (low) lines.push('', t.warning(num(a.limit), du));
  return [lines.join('\n')];
}

/**
 * The whole answer for a botStock result in [lang]. [note]: a line put first (for example "the size you named is not
 * registered, this is the whole code").
 */
export function formatStaffStock(result, askedCode = '', note = '', lang = 'fa', want = null, opts = {}) {
  const t = wordsOf(lang, !!opts.units);
  if (!result.found) return t.notFound(result.code || askedCode);
  if (result.ambiguous) return t.ambiguous(askedCode, result.categories.map((c, i) => `${i + 1}) ${c}`).join('\n'));
  if (result.sizeFound === false) return t.noSize(result.code, result.size, (result.sizes || []).join(`${t.comma} `) || '—');
  const old = result.stale ? t.stale(result.ageMinutes) : '';
  return [note, old, ...stockBlocks(result, lang, want, opts)].filter(Boolean).join('\n\n');
}

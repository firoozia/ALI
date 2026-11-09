// The report of goods sent out for the team: dates (Gregorian or Jalali in, Gregorian dd/mm/yyyy out) and the short
// answer in the staff format. The figures come from the sheet's botReport action and are shown exactly.

import { withSeparators } from './separator.js';
import { langOf } from './lang.js';
import { normalizeDigits } from './text.js';

const jalaliFormat = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Gregorian ISO day -> { y, m, d } of the Jalali calendar. */
export function toJalali(isoDay) {
  const parts = Object.fromEntries(jalaliFormat.formatToParts(new Date(`${isoDay}T00:00:00Z`)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

/** Jalali y, m, d -> Gregorian ISO day, or null when there is no such day. */
export function fromJalali(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const start = Date.UTC(y + 621, 0, 1);
  for (let k = 0; k < 800; k++) {
    const day = iso(start + k * 86400000);
    const j = toJalali(day);
    if (j.y === y && j.m === m && j.d === d) return day;
    if (j.y > y) break;
  }
  return null;
}

const isJalaliYear = (y) => y >= 1300 && y < 1700;
const pad = (n) => String(n).padStart(2, '0');
const valid = (y, m, d) => {
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/**
 * A day typed by a person -> Gregorian "yyyy-mm-dd", or null. Accepted: 2026-10-31, 2026/10/31, 31/10/2026 and the
 * Jalali ones (1405-08-09, 1405/8/9, 09/08/1405); Persian and Arabic digits too.
 */
export function parseDay(text) {
  const s = normalizeDigits(String(text || '')).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  let y; let mo; let d;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  if (isJalaliYear(y)) return fromJalali(y, mo, d);
  return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
}

/** "2026-10-31" -> "31/10/2026". */
export const toDMY = (isoDay) => `${isoDay.slice(8, 10)}/${isoDay.slice(5, 7)}/${isoDay.slice(0, 4)}`;

/** Today in both calendars, for the model to turn "this month" or "last week" into days. */
export function todayLine(now = new Date(), timeZone = 'Asia/Dubai') {
  const g = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const j = toJalali(g);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(now);
  return `Today is ${g} (Gregorian) = ${j.y}-${pad(j.m)}-${pad(j.d)} (Jalali), ${weekday}.`;
}

const L = {
  fa: {
    title: (a, b) => `خروجی کالا از ${a} تا ${b}`, none: 'در این بازه خروجی کالایی ثبت نشده است.',
    ops: 'تعداد عملیات', total: 'جمع', out: 'جمع خروج', packages: 'تعداد بسته', mainCustomers: 'مشتری‌های اصلی', noCustomer: 'بدون مشتری',
    moreCodes: (n) => `و ${n} کد دیگر`, hint: 'برای فهرست عملیات بنویسید «جزئیات»', comma: '،',
    detailsTitle: (a, b) => `عملیات خروج از ${a} تا ${b}`, outWord: 'خروج', cutWord: 'برش', code: 'کد', moreOps: (n) => `و ${n} عملیات دیگر`,
    invalid: 'تاریخ را نتوانستم بفهمم؛ لطفاً مثلاً بنویسید 1405-08-03 یا 31/10/2026.',
    failed: (slow) => `دریافت گزارش خروج ناموفق بود (${slow ? 'پاسخ برگه دیر رسید' : 'ارتباط با برگه برقرار نشد'}). لطفاً یکی دو دقیقه بعد دوباره بپرسید.`,
  },
  ar: {
    title: (a, b) => `خروج البضاعة من ${a} إلى ${b}`, none: 'لا توجد بضاعة خارجة مسجلة في هذه الفترة.',
    ops: 'عدد العمليات', total: 'الإجمالي', out: 'إجمالي الخروج', packages: 'عدد العبوات', mainCustomers: 'أبرز العملاء', noCustomer: 'بدون عميل',
    moreCodes: (n) => `و${n} كود آخر`, hint: 'لقائمة العمليات اكتب «تفاصيل»', comma: '،',
    detailsTitle: (a, b) => `عمليات الخروج من ${a} إلى ${b}`, outWord: 'خروج', cutWord: 'قص', code: 'الكود', moreOps: (n) => `و${n} عملية أخرى`,
    invalid: 'لم أفهم التاريخ؛ اكتب مثلًا 2026-10-31 أو 31/10/2026.',
    failed: (slow) => `تعذر الحصول على تقرير الخروج (${slow ? 'تأخر رد الجدول' : 'تعذر الاتصال بالجدول'}). يرجى السؤال مرة أخرى بعد دقيقة أو دقيقتين.`,
  },
  en: {
    title: (a, b) => `Goods sent out from ${a} to ${b}`, none: 'No goods sent out are recorded in this period.',
    ops: 'Operations', total: 'Total', out: 'Total out', packages: 'Packages', mainCustomers: 'Main customers', noCustomer: 'no customer',
    moreCodes: (n) => `and ${n} more codes`, hint: 'For the list of operations write "details"', comma: ',',
    detailsTitle: (a, b) => `Operations sent out from ${a} to ${b}`, outWord: 'out', cutWord: 'cut', code: 'Code', moreOps: (n) => `and ${n} more operations`,
    invalid: 'I could not understand the date; please write for example 2026-10-31 or 31/10/2026.',
    failed: (slow) => `Could not get the outgoing report (${slow ? 'the sheet answered too late' : 'could not reach the sheet'}). Please ask again in a minute or two.`,
  },
  ur: {
    title: (a, b) => `${a} سے ${b} تک مال کا اخراج`, none: 'اس مدت میں مال کا کوئی اخراج درج نہیں۔',
    ops: 'کارروائیاں', total: 'کل', out: 'کل اخراج', packages: 'پیکٹ', mainCustomers: 'بڑے گاہک', noCustomer: 'بغیر گاہک',
    moreCodes: (n) => `اور ${n} کوڈ مزید`, hint: 'کارروائیوں کی فہرست کے لیے «تفصیل» لکھیں', comma: '،',
    detailsTitle: (a, b) => `${a} سے ${b} تک اخراج کی کارروائیاں`, outWord: 'اخراج', cutWord: 'کٹائی', code: 'کوڈ', moreOps: (n) => `اور ${n} کارروائیاں مزید`,
    invalid: 'تاریخ سمجھ نہیں آئی؛ براہِ کرم مثلاً 2026-10-31 یا 31/10/2026 لکھیں۔',
    failed: (slow) => `اخراج کی رپورٹ حاصل نہیں ہو سکی (${slow ? 'شیٹ نے دیر سے جواب دیا' : 'شیٹ سے رابطہ نہیں ہو سکا'})۔ براہِ کرم ایک دو منٹ بعد دوبارہ پوچھیں۔`,
  },
};
const wordsOf = (lang) => L[langOf(lang) === 'hi' ? 'en' : langOf(lang)] || L.fa;

export const reportInvalidDate = (lang) => wordsOf(lang).invalid;
export const reportFailed = (lang, slow) => wordsOf(lang).failed(slow);

const qty = (n, unit) => `${Math.round(Number(n) * 100) / 100} ${unit}`;

/** The short answer: the period, the totals, one block per code (at most [maxCodes]) and how to ask for the details. */
export function formatReport(result, lang = 'fa', { maxCodes = 8 } = {}) {
  const t = wordsOf(lang);
  const head = t.title(toDMY(result.from), toDMY(result.to));
  if (!result.operations) return `${head}\n${t.none}`;
  const lines = [head, `- ${t.ops}: ${result.operations}`, `- ${t.total}: ${result.totals.map((x) => qty(x.qty, x.unit)).join(`${t.comma} `)}`];
  const who = (c) => (c.customer === '-' ? t.noCustomer : c.customer);
  const blocks = result.byCode.slice(0, maxCodes).map((c) => [
    `${t.code} ${c.code}${c.category ? ` (${c.category})` : ''}`,
    `- ${t.out}: ${qty(c.total, c.unit)}`,
    `- ${t.ops}: ${c.operations}`,
    `- ${t.packages}: ${c.packages}`,
    ...(c.customers.length ? [`- ${t.mainCustomers}: ${c.customers.map((x) => `${who(x)} ${qty(x.qty, c.unit)}`).join(`${t.comma} `)}`] : []),
  ].join('\n'));
  const rest = result.byCode.length - blocks.length;
  const parts = [lines.join('\n'), withSeparators(blocks)];
  if (rest > 0) parts.push(t.moreCodes(rest));
  parts.push(t.hint);
  return parts.join('\n\n');
}

/** The long list: the latest operations, newest first. */
export function formatDetails(result, lang = 'fa', { maxRows = 40 } = {}) {
  const t = wordsOf(lang);
  const head = t.detailsTitle(toDMY(result.from), toDMY(result.to));
  const rows = result.rows || [];
  if (!rows.length) return `${head}\n${t.none}`;
  const lines = rows.slice(0, maxRows).map((r) => {
    const size = r.size ? ` ${r.size}` : '';
    const who = r.customer ? ` ${r.customer}` : '';
    const inv = r.invoice ? ` (${r.invoice})` : '';
    return `${toDMY(r.day)} ${r.type === 'CUT' ? t.cutWord : t.outWord} ${t.code} ${r.code}${size}: ${qty(r.qty, r.unit)}${who}${inv}`;
  });
  const rest = (result.rowsTotal || rows.length) - lines.length;
  return [head, ...lines, ...(rest > 0 ? [t.moreOps(rest)] : [])].join('\n');
}

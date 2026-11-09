// The period of a statement and the words around it, from what the owner wrote or said: «ماه ۱۰ میلادی»، «برج ۱۰»، «ماه دهم میلادی»، «اکتبر»، «ماه گذشته»،
// «این ماه»، «از ۲۰۲۶-۱۰-۰۱ تا ۲۰۲۶-۱۰-۱۵». Months are the Gregorian months (the books are kept in them); a Persian-calendar month is refused, not guessed.

const DIGITS = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const norm = (s) => DIGITS(String(s || '')).replace(/[‌‎‏]/g, ' ').replace(/[أإ]/g, 'ا').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const ORDINAL = { یکم: 1, اول: 1, دوم: 2, سوم: 3, چهارم: 4, پنجم: 5, ششم: 6, هفتم: 7, هشتم: 8, نهم: 9, دهم: 10, یازدهم: 11, دوازدهم: 12 };
const MONTHS = [
  ['ژانویه', 'ژانویۀ', 'ژانوییه', 'january', 'jan'], ['فوریه', 'فبریه', 'february', 'feb'], ['مارس', 'march', 'mar'], ['آوریل', 'اوریل', 'آپریل', 'april', 'apr'], ['مه', 'می', 'may'],
  ['ژوئن', 'ژون', 'june', 'jun'], ['ژوئیه', 'جولای', 'ژولای', 'july', 'jul'], ['اوت', 'آگوست', 'august', 'aug'], ['سپتامبر', 'سپتمبر', 'september', 'sept', 'sep'],
  ['اکتبر', 'اکتوبر', 'october', 'oct'], ['نوامبر', 'نوامبر', 'november', 'nov'], ['دسامبر', 'december', 'dec'],
];
const MONTH_RE = MONTHS.flat().sort((a, b) => b.length - a.length).join('|');

const monthIndex = (word) => { const w = word.toLowerCase(); const i = MONTHS.findIndex((names) => names.some((n) => n.toLowerCase() === w)); return i < 0 ? 0 : i + 1; };
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const todayParts = (today) => { const [y, m, d] = String(today).slice(0, 10).split('-').map(Number); return { y, m, d }; };

/** The whole month [m] of a year; with no year, the latest such month that has begun. */
function monthRange(m, y, today) {
  const t = todayParts(today);
  const year = y || (m > t.m ? t.y - 1 : t.y);
  const to = year === t.y && m === t.m ? iso(year, m, t.d) : iso(year, m, lastDay(year, m));
  return { from: iso(year, m, 1), to, label: `${year}-${pad(m)}` };
}

/** Day [d] of month [mo] in the latest year in which that day is not after today (the year is the current one unless it would be in the future). */
function yearlessDate(mo, d, today) {
  const t = todayParts(today);
  const y = iso(t.y, mo, d) > String(today).slice(0, 10) ? t.y - 1 : t.y;
  return d >= 1 && d <= lastDay(y, mo) && mo >= 1 && mo <= 12 ? iso(y, mo, d) : '';
}
const fullYear = (y) => (y < 100 ? 2000 + y : y);

/** A real calendar day as yyyy-mm-dd, else '' (31/02 is not guessed). */
function real(y, mo, d) { return mo >= 1 && mo <= 12 && d >= 1 && d <= lastDay(y, mo) ? iso(y, mo, d) : ''; }

function dateAt(text, today) {
  const t = norm(text);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t); if (m) return real(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t))) return real(fullYear(+m[3]), +m[2], +m[1]); // day first (the UAE order)
  if ((m = /^(\d{1,2})[/.-](\d{1,2})$/.exec(t))) return yearlessDate(+m[2], +m[1], today);
  if ((m = new RegExp(`^(\\d{1,2})\\s*(${MONTH_RE})(?:\\s*(\\d{4}))?$`, 'iu').exec(t))) { const mo = monthIndex(m[2]); return m[3] ? real(+m[3], mo, +m[1]) : yearlessDate(mo, +m[1], today); }
  return '';
}

/**
 * The period named in a text: { from, to, label, span: [start, end] (where it stood), unsupported? } or null. [today]: yyyy-mm-dd.
 * A Persian-calendar month ("شمسی") gives { unsupported: 'solar' } so that the caller can say so.
 */
export function parsePeriod(text, today) {
  const t = norm(text);
  // from X to Y
  const D = String.raw`(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[/.-]\d{1,2}|\d{1,2}\s*(?:${MONTH_RE})(?:\s*\d{4})?)`;
  let m = new RegExp(String.raw`(?:(?:از|from)\s+)?${D}\s*(?:تا|to|until|till|-|–)\s*${D}`, 'iu').exec(t);
  if (m) {
    const b = dateAt(m[2], today); let a = dateAt(m[1], today);
    if (a && b && a > b && !/\d{4}/.test(m[1])) a = `${+a.slice(0, 4) - 1}${a.slice(4)}`; // «20/12 to 05/01»: the start is the year before
    if (a && b && a <= b) return { from: a, to: b, label: `${a}..${b}`, span: [m.index, m.index + m[0].length] };
  }
  // «1-15 October», «from 1 to 15 oct 2026», «از ۱ تا ۱۵ اکتبر»: two days of one named month
  if ((m = new RegExp(String.raw`(?:(?:از|from)\s+)?(\d{1,2})\s*(?:تا|to|until|till|-|–)\s*(\d{1,2})\s*(${MONTH_RE})(?:\s*(\d{4}))?(?=\s|$)`, 'iu').exec(t))) {
    const mo = monthIndex(m[3]); const b = m[4] ? iso(+m[4], mo, +m[2]) : yearlessDate(mo, +m[2], today);
    const a = b ? iso(+b.slice(0, 4), mo, +m[1]) : '';
    if (a && b && a <= b && +m[2] <= lastDay(+b.slice(0, 4), mo)) return { from: a, to: b, label: `${a}..${b}`, span: [m.index, m.index + m[0].length] };
  }
  // «10/2026», «10-2026»: a month and its year
  if ((m = /(?:^|\s)(\d{1,2})[/.-](\d{4})(?=\s|$)/.exec(t)) && +m[1] >= 1 && +m[1] <= 12) {
    const at = m.index + (m[0].startsWith(' ') ? 1 : 0);
    return { ...monthRange(+m[1], +m[2], today), span: [at, m.index + m[0].length] };
  }
  if ((m = /(?:ماه|برج)\s+(گذشته|پیش|قبل)|(?:last|previous)\s+month/iu.exec(t))) {
    const tp = todayParts(today); const pm = tp.m === 1 ? 12 : tp.m - 1; const py = tp.m === 1 ? tp.y - 1 : tp.y;
    return { ...monthRange(pm, py, today), to: iso(py, pm, lastDay(py, pm)), span: [m.index, m.index + m[0].length] };
  }
  if ((m = /(?:این|همین)\s+(?:ماه|برج)|this\s+month/iu.exec(t))) { const tp = todayParts(today); return { ...monthRange(tp.m, tp.y, today), span: [m.index, m.index + m[0].length] }; }
  // "ماه ۱۰ میلادی", "برج 10", "ماه دهم میلادی", with an optional year
  if ((m = new RegExp(`(?:ماه|برج|month)\\s+(\\d{1,2}|${Object.keys(ORDINAL).join('|')})(?:\\s*(میلادی|شمسی|ایرانی|هجری))?(?:\\s+(\\d{4}))?`, 'iu').exec(t))) {
    if (/شمسی|ایرانی|هجری/.test(m[2] || '')) return { unsupported: 'solar', span: [m.index, m.index + m[0].length] };
    const n = /^\d+$/.test(m[1]) ? +m[1] : ORDINAL[m[1]];
    if (n >= 1 && n <= 12) return { ...monthRange(n, m[3] ? +m[3] : 0, today), span: [m.index, m.index + m[0].length] };
  }
  // a month name, with an optional year ("اکتبر", "oct 2025")
  if ((m = new RegExp(`(?:^|\\s)(${MONTH_RE})(?:\\s+(\\d{4}))?(?=\\s|$)`, 'iu').exec(t))) {
    const mo = monthIndex(m[1]);
    if (mo) return { ...monthRange(mo, m[2] ? +m[2] : 0, today), span: [m.index + (m[0].startsWith(' ') ? 1 : 0), m.index + m[0].length] };
  }
  return null;
}

const SIMPLE_WORDS = /(?:^|\s)(?:آتوسا|اتوسا|آدرس|لطفا|لطفاً|سلام|atossa|atosa|atousa|atusa|atoosa|hello|hi|hey)(?=\s|$)/giu;
const FILLERS = /(?:^|\s)(?:را|رو|برای|برام|برایم|به|من|ما|از|تا|بفرست|بفرستید|بفرستین|بده|بدید|می‌?خواهم|میخواهم|می‌?خوام|میخوام|لازم|دارم|ارسال|کن|بزن|بساز|ماه|برج|میلادی|کنید|صورت\s*حساب|صورتحساب|حساب|statement|statements|soa|account|accounts|please|send|give|make|get|show|issue|me|the|of|for|my|to|a)(?=\s|$)/giu;

/**
 * A free-form request for a statement ("آتوسا صورتحساب شرکت پالم برد را برای ماه ۱۰ میلادی برام بفرست"): { customer, period, label } or null when the text does not
 * ask for a statement. [customer] is '' when none was named. A text with exactly the older form ("صورت‌حساب <مشتری>") is not taken here.
 */
export function parseStatementRequest(text, today) {
  const t0 = norm(text).replace(/[.!؟?،,]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/(?:صورت\s*حساب|صورتحساب|statement|soa|حساب\s+(?:ماه|برج|شرکت|مشتری|این|آن))/iu.test(t0)) return null;
  if (/فاکتور|invoice/iu.test(t0)) return null; // an invoice is another thing
  const period = parsePeriod(t0, today);
  const style = /(?:^|\s)(?:balance|running|رصید|مانده)(?=\s|$)/iu.test(t0) ? 'balance' : ''; // «statement balance …»: the older layout with a running balance
  const wants = /(?:بفرست|بده|بدید|بدهید|بزن|بزنید|کن\s*$|کنید\s*$|بساز|می‌?خوام|میخوام|می‌?خواهم|لازم|ارسال|send|give|make|need|want|get|show)/iu.test(t0)
    || /(?:^|\s)(?:آتوسا|اتوسا|atossa|atosa|atousa|atusa|atoosa)(?=\s|$)/iu.test(t0); // addressed to her by name (anywhere): a statement word is a request
  if (!period && !wants) return null; // the exact older form keeps its own path
  let rest = period?.span ? `${t0.slice(0, period.span[0])} ${t0.slice(period.span[1])}` : t0;
  if (style) rest = rest.replace(/(?:^|\s)(?:balance|running|رصید|مانده)(?=\s|$)/giu, ' ');
  rest = rest.replace(SIMPLE_WORDS, ' ').replace(FILLERS, ' ').replace(FILLERS, ' ').replace(/\s+/g, ' ').trim();
  const afterCompany = /(?:^|\s)(?:شرکت|company|co)\s+(.+)$/iu.exec(rest);
  let customer = (afterCompany ? afterCompany[1] : rest).replace(/^(?:شرکت|company)\s*$/iu, '').trim();
  if (/^(?:شرکت|مشتری|company|customer)$/iu.test(customer)) customer = '';
  return { customer, period: period && !period.unsupported ? { from: period.from, to: period.to, label: period.label } : null, unsupported: period?.unsupported || '', style };
}

export const hasPeriod = (text, today = new Date().toISOString().slice(0, 10)) => !!parsePeriod(text, today);

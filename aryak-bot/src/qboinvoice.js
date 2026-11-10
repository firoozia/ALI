// CREATING AN INVOICE IN QUICKBOOKS, WITH THE OWNER'S YES. Who asks: the owner (his own chat) and people the owner authorizes (their private chat with the
// bot). The request is "فاکتور بساز <customer>" and one line per item. It is only ever a PREVIEW (#Q12) sent to the OWNER's own chat; nothing exists in
// QuickBooks until the owner himself writes "بله #Q12" there (no other yes counts, not even the requester's). The create call carries a request id
// that belongs to the preview, so a second yes can never make a second invoice. The customer and every item must match EXACTLY (or a choice the owner
// confirmed): an unknown one stops the preview with the candidates. The VAT code is read from QuickBooks (the 5% standard-rated sales code), never an
// id written here. Safety: a kill switch in the client, at most 10 creations an hour and 40 a day, an append-only audit log, only the "create invoice"
// write exists, and QBO_WRITE off refuses everything. Nothing here sends anything to a customer.

import fs from 'node:fs';
import path from 'node:path';
import { parseStatementRequest } from './period.js';
import { looseKey } from './namekey.js';
import { cutTotal, cutLine, faDigits } from './cuts.js';
import { rankNames, scoreName } from './translit.js';
import { createHash, randomBytes } from 'node:crypto';
import { staffChecker } from './gate.js';
import { isEnglishOut } from './outlang.js';
import { nameKey } from './customergroups.js';
import { qboEscape } from './qbo.js';

const latin = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫]/g, '.');
const plain = (s) => latin(String(s || '')).replace(/[‌‎‏ً-ٟ]/g, ' ').replace(/[أإ]/g, 'ا').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();
const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const fils = (x) => Math.round(Number(x || 0) * 100);
const money = (f) => { const n = Math.abs(f); const s = `${Math.floor(n / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(n % 100).padStart(2, '0')}`; return f < 0 ? `-${s}` : s; };
const DAY = 86400000;
export const EXPIRY_MS = DAY;
export const CAP_HOUR = 10;
export const CAP_DAY = 40;
const MAX_LINES = 40;
const QB = 'کو[ئی]*یک\\s*بوکس';

// ---------------------------------------------------------------------------------------------------------------- the words
/** What the owner (or an authorized person) wrote, or null. Multi-line: the first line is "فاکتور بساز <customer>", then one item per line. */
/**
 * The owner's short English commands, read as the Persian ones (one set of rules behind both): «yes #Q8», «stop quickbooks», «permissions»,
 * «grant statement 9715…», «revoke invoice 9715…», «cost today», «customer 2», «line 1 = 3», «tax 2», «yes all». null = not one of them.
 */
export function englishCommand(text) {
  const t = latin(String(text || '')).replace(/[.!]+$/u, '').trim();
  if (!t || /\n/.test(t) || t.length > 80) return null;
  let m;
  const QB = String.raw`quick\s*books?`;
  if ((m = /^(yes|no)\s+all$/i.exec(t))) return `${m[1].toLowerCase() === 'yes' ? 'بله' : 'نه'} همه`;
  if (new RegExp(String.raw`^(?:stop|pause)\s+${QB}$`, 'i').test(t)) return 'توقف کوییک‌بوکس';
  if (new RegExp(String.raw`^(?:continue|resume)\s+${QB}$`, 'i').test(t)) return 'ادامه کوییک‌بوکس';
  if (new RegExp(String.raw`^${QB}\s+(?:report|audit|log)$`, 'i').test(t)) return 'گزارش کوییک‌بوکس';
  if (/^(?:permissions|permission list|who is authori[sz]ed)$/i.test(t)) return 'مجوزها';
  if ((m = /^cost\s+(today|week)$/i.exec(t))) return `هزینه ${m[1].toLowerCase() === 'week' ? 'هفته' : 'امروز'}`;
  if (/^tax codes$/i.test(t)) return 'کدهای مالیات';
  if (/^persian names$/i.test(t)) return 'نام‌های فارسی';
  if ((m = /^(grant|revoke)\s+(invoices?|statements?)\s+(\+?[\d\s-]{7,20})$/i.exec(t))) {
    const word = /^invoice/i.test(m[2]) ? 'فاکتور' : 'صورت‌حساب';
    return `${m[1].toLowerCase() === 'revoke' ? 'لغو ' : ''}مجوز ${word} ${m[3]}`;
  }
  if ((m = /^persian name\s+(.+?)\s*=\s*(.+)$/i.exec(t))) return `نام فارسی ${m[1]} = ${m[2]}`;
  if ((m = /^customer\s+(\d+)(\s+#?\s*Q\s*\d+)?$/i.exec(t))) return `مشتری ${m[1]}${m[2] || ''}`;
  if ((m = /^line\s+(\d+)\s*=\s*(\d+)(\s+#?\s*Q\s*\d+)?$/i.exec(t))) return `سطر ${m[1]} = ${m[2]}${m[3] || ''}`;
  if ((m = /^tax\s+(\d+)(\s+#?\s*Q\s*\d+)?$/i.exec(t))) return `مالیات ${m[1]}${m[2] || ''}`;
  return null;
}

export function parseInvoiceCommand(text) {
  const asPersian = englishCommand(text);
  if (asPersian) return parseInvoiceCommand(asPersian);
  const raw = String(text || '').replace(/\r/g, '');
  const first = plain(raw.split('\n')[0]).replace(/^(?:آتوسا|اتوسا)[ ,،:]*/u, '');
  let m = /^فاکتور\s+بساز(?:ید)?\s+(.+)$/u.exec(first);
  if (m) return { type: 'request', customer: m[1].trim(), lines: raw.split('\n').slice(1).map((l) => l.trim()).filter(Boolean) };
  const s = plain(raw).replace(/[.!؟?]+$/u, '').trim();
  {
    // yes / no with the id before or after (right-to-left typing), with or without spaces and #; or the bare word (the desk then looks for the one open preview)
    const W = 'بله|اره|آره|اوکی|نه|خیر|yes|no|ok|okay';
    const isYes = (w) => /^(?:بله|اره|آره|اوکی|yes|ok|okay)$/iu.test(w);
    if ((m = new RegExp(String.raw`^(${W})$`, 'iu').exec(s))) return { type: isYes(m[1]) ? 'yes' : 'no', id: '' };
    if ((m = new RegExp(String.raw`^(?:(${W})\s*)?#?\s*([QNEMTPCUDRFSIJKLAV])\s*(\d+)\s*#?(?:\s*(${W}))?$`, 'iu').exec(s)) && (m[1] || m[4]) && !(m[1] && m[4])) return { type: isYes(m[1] || m[4]) ? 'yes' : 'no', id: `${m[2].toUpperCase()}${m[3]}` };
  }
  // the owner's bulk QuickBooks jobs (see qbobulk.js)
  if ((m = /^ایمیل\s+مشتری(?:\s*ها)?(?:\s+(\S+@\S+))?$/u.exec(s))) return { type: 'bulk_email', email: m[1] || '' };
  if (/^موبایل\s+مشتری(?:\s*ها)?$/u.test(s)) return { type: 'bulk_mobile' };
  if (/^برگرداندن\s+نوار\s+لبه$/u.test(s)) return { type: 'bulk_undo', scope: 'edge' };
  if (/^دسته\s+و\s+کد\s+نوار\s+لبه$/u.test(s)) return { type: 'bulk_edge' };
  if ((m = /^هزینه\s*(?:ی\s*)?(امروز|هفته)$/u.exec(s))) return { type: 'cost_report', range: m[1] === 'هفته' ? 'week' : 'today' }; // what the paid calls cost: today or this week
  if (/^نام\s+و\s+شرح\s+نوار\s+لبه$/u.test(s)) return { type: 'bulk_edge_names' };
  if (/^حذف\s+نوار\s+لبه(?:\s*ها(?:ی)?)?\s+قدیمی$/u.test(s)) return { type: 'bulk_old_edge' };
  if ((m = /^برگرداندن\s+([CEMTP])\s*(\d+)$/iu.exec(s))) return { type: 'bulk_undo', scope: 'all', source: `${m[1].toUpperCase()}${m[2]}` };
  { // change one guess of the open preview: «مشتری ۲»، «سطر ۱ = ۳»، «مالیات ۲» (optionally with «#Q3»)
    const idPart = String.raw`(?:\s*#?\s*Q\s*(\d+))?`;
    let a = new RegExp(String.raw`^مشتری\s*(\d+)${idPart}$`, 'iu').exec(s);
    if (a) return { type: 'adjust', what: 'customer', pick: Number(a[1]), id: a[2] ? `Q${a[2]}` : '' };
    if ((a = new RegExp(String.raw`^سطر\s*(\d+)\s*=\s*(\d+)${idPart}$`, 'iu').exec(s))) return { type: 'adjust', what: 'line', n: Number(a[1]), pick: Number(a[2]), id: a[3] ? `Q${a[3]}` : '' };
    if ((a = new RegExp(String.raw`^مالیات\s*(\d+)${idPart}$`, 'iu').exec(s))) return { type: 'adjust', what: 'tax', pick: Number(a[1]), id: a[2] ? `Q${a[2]}` : '' };
  }
  if (/^(?:no|cancel|drop|clear)\s+(?:all|everything)$/iu.test(s) || /^(?:لغو|نه|خیر)\s+همه$/u.test(s)) return { type: 'cancel_all' }; // every waiting preview and job of every kind (his own, for a person who is not the owner); nothing is created
  if (/^(?:waiting|queue|pending|صف)$/iu.test(s)) return { type: 'queue_list' };
  if ((m = /^(بله|اره|آره)\s+همه$/u.exec(s))) return { type: 'yes_all' }; // all the previews of the last message
  if (/^دسته\s+و\s+کد\s+کالا(?:\s*ها)?$/u.test(s)) return { type: 'bulk_catalog' };
  if (/^دسته\s+و\s+کد\s+پی\s*وی\s*سی$/u.test(s)) return { type: 'bulk_catalog', edge: false }; // the PVC film part only: no edge banding change at all
  if (/^مالیات\s+کالاها(?:\s+دبی)?$/u.test(s)) return { type: 'bulk_tax' };
  if (/^شروع\s+کن$/u.test(s)) return { type: 'price_start' };
  if (/^لیست\s+قیمت$/u.test(s)) return { type: 'price_list' };
  if ((m = /^حذف\s+قیمت\s+(.+)$/u.exec(s))) return { type: 'price_remove', code: m[1].trim() };
  {
    const rows = raw.split('\n').map((l) => plain(l).replace(/^(?:آتوسا|اتوسا)[ ,،:]*/u, '')).filter((l) => l && !/^قیمت\s*(?:ها|های)?\s+(?:به\s+)?(?:درهم|aed)(?:\s+است)?$/iu.test(l));
    const one = (l) => {
      let x = /^قیمت\s+سری\s*(\d+)\s*[=:]?\s*([\d.,]+)$/u.exec(l);
      if (x) return { series: Number(x[1]), price: x[2] };
      x = /^قیمت\s+(\d+)\s*تا\s*(\d+)\s*[=:]?\s*([\d.,]+)$/u.exec(l);
      if (x) return { from: Number(x[1]), to: Number(x[2]), price: x[3] };
      x = /^قیمت\s+(.+?)\s*[=:]\s*([\d.,]+)$/u.exec(l) || /^قیمت\s+(\d{1,4})\s+([\d.,]+)$/u.exec(l);
      return x ? { code: x[1].trim(), price: x[2] } : null;
    };
    const pr = rows.map(one);
    if (rows.length && rows.length <= 60 && pr.some(Boolean)) {
      const lines = pr.filter(Boolean).map((x) => ({ ...x, price: Number(String(x.price).replace(/,/g, '')) }));
      const okp = (l) => l.price >= 0 && l.price <= 10000000;
      return { type: 'price_set', lines: lines.filter(okp), bad: lines.filter((l) => !okp(l)).length, unread: rows.filter((_, i) => !pr[i]) };
    }
  }
  if (new RegExp(`^نام\\s+مشتری(?:\\s*ها)?\\s+با\\s+حروف\\s+بزرگ$`, 'u').test(s)) return { type: 'names_plan' };
  if (new RegExp(`^توقف\\s*${QB}$`, 'u').test(s)) return { type: 'pause' };
  if (new RegExp(`^ادامه\\s*${QB}$`, 'u').test(s)) return { type: 'resume' };
  if (new RegExp(`^گزارش\\s*${QB}$`, 'u').test(s)) return { type: 'audit' };
  // Every permission is its own word: «مجوز <word> <number>» gives it, «لغو مجوز <word> <number>» takes it. A new one is one row in PERMISSIONS.
  const NUM = String.raw`\+?([\d۰-۹٠-٩\s-]{7,20})`;
  for (const [perm, def] of Object.entries(PERMISSIONS)) {
    if ((m = new RegExp(String.raw`^لغو\s+مجوز\s+(?:${def.words})\s+${NUM}$`, 'iu').exec(s))) return { type: 'auth_remove', number: m[1], perm };
    if ((m = new RegExp(String.raw`^مجوز\s+(?:${def.words})\s+${NUM}$`, 'iu').exec(s))) return { type: 'auth_add', number: m[1], perm };
  }
  { const dm = /^(dup|duplicate|separate)\s*#?\s*(D\d+)$/i.exec(s); if (dm) return { type: 'payment_dup', verb: dm[1].toLowerCase() === 'separate' ? 'separate' : 'dup', id: dm[2].toUpperCase() }; } // the owner's answer about a repeated payment
  { // the expenses and the money received, on request (owner only, read only)
    const rangeWord = (w) => ({ today: 'today', امروز: 'today', week: 'week', هفته: 'week', month: 'month', ماه: 'month' })[String(w).toLowerCase()] || 'today';
    let em = /^(?:expenses?|هزینه(?:‌?ها)?)\s+(today|week|month|امروز|هفته|ماه)$/iu.exec(s); if (em) return { type: 'expenses_report', range: rangeWord(em[1]) };
    em = /^(?:money\s+received|received|دریافتی(?:‌?ها)?)\s+(today|week|month|امروز|هفته|ماه)$/iu.exec(s); if (em) return { type: 'received_report', range: rangeWord(em[1]) };
    if (/^(?:weekly\s+check|بررسی\s*هفتگی)$/iu.test(s)) return { type: 'weekly_check' };
    { // «backfill» / «backfill 01/11» / «پر کردن تاریخچه ۰۱/۱۱»: the history of the groups from that day (owner only)
      const bm = /^(?:backfill|پر\s*کردن\s*تاریخچه)(?:\s+([0-9۰-۹]{1,2})[/.-]([0-9۰-۹]{1,2}))?$/iu.exec(s);
      if (bm) { const num = (x) => Number(String(x).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))); return { type: 'backfill', ...(bm[1] ? { day: num(bm[1]), month: num(bm[2]) } : {}) }; }
    }
    { // a one-off, owner-only test of photo reading: «read photos confirmation 7», «خواندن عکس‌ها گروه تأیید ۷»
      const pm = /^(?:read\s+photos?|خواندن\s+عکس(?:[\s\u200c]*ها)?)\s+(?:group\s+|گروه\s+)?(confirmation|expenses?|تأیید|تاییید|تایید|تأييد|هزینه(?:[\s\u200c]*ها)?)\s+([0-9۰-۹]{1,3})$/iu.exec(s);
      if (pm) { const days = Number(String(pm[2]).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))); if (days >= 1 && days <= 60) return { type: 'read_photos', group: /^(?:confirmation|تأیید|تایید)$/i.test(pm[1]) ? 'confirmation' : 'expenses', days }; }
    }
    em = /^(?:delete|remove|حذف)\s+(?:expense\s+|هزینه\s+)?#?\s*(E\d+)$/iu.exec(s); if (em) return { type: 'expense_delete', id: em[1].toUpperCase() };
  }
  if (/^(?:payments|payment matches|پرداخت\s*ها)$/iu.test(s)) return { type: 'payments' };
  if (/^(?:unbilled|not invoiced|گزارش فاکتور\s*نشده)$/iu.test(s)) return { type: 'unbilled' };
  if (/^(?:cut aliases|alias proposals|نام\s*های مستعار برش)$/iu.test(s)) return { type: 'alias_propose' };
  if ((m = /^(?:drop|حذف)\s+(\d+(?:\s*[,،]\s*\d+)*)\s+#?\s*(A\s*\d+)$/iu.exec(s))) return { type: 'alias_drop', numbers: m[1].split(/[,،]/).map((x) => Number(x)), id: m[2].replace(/\s+/g, '').toUpperCase() };
  if (/^(?:check tax inclusive|tax inclusive|بررسی مالیات شامل(?: قیمت)?|قیمت شامل مالیات)$/iu.test(s)) return { type: 'tax_inclusive' };
  if ((m = /^(?:undo tax inclusive|برگرداندن مالیات شامل(?: قیمت)?)\s+#?\s*([IK]\s*\d+)$/iu.exec(s))) return { type: 'tax_inclusive_undo', source: m[1].replace(/\s+/g, '').toUpperCase() };
  if (/^(?:stock diff(?:erence)?|اختلاف موجودی(?: کوییک‌بوکس)?)$/iu.test(s)) return { type: 'stock_diff' };
  if ((m = /^(?:invoice dry run|dry run|آزمایش فاکتور)\s+#?\s*(Q\s*\d+)\s+(\S+)$/iu.exec(s))) return { type: 'dry_run', id: m[1].replace(/\s+/g, '').toUpperCase(), against: m[2] };
  if ((m = /^(?:compare invoices?|مقایسه فاکتور(?:ها)?)\s+(\S+)\s+(\S+)$/iu.exec(s))) return { type: 'compare', a: m[1], b: m[2] };
  if ((m = /^(?:details|جزئیات)\s*#?\s*(Q\s*\d+)$/iu.exec(s))) return { type: 'details', id: m[1].replace(/\s+/g, '').toUpperCase() };
  if (/^مجوزها$/u.test(s)) return { type: 'auth_list' };
  if (/^نام\s*(?:‌?های|ها)\s+فارسی(?:\s+مشتری(?:\s*ها)?)?$/u.test(s)) return { type: 'persian_list' };
  if ((m = /^نام\s+فارسی\s+(.+?)\s*=\s*(.+)$/u.exec(s)) && /[؀-ۿ]/.test(m[2])) return { type: 'persian_set', customer: m[1].trim(), persian: m[2].trim() };
  if (/^کدهای\s+مالیات$/u.test(s)) return { type: 'tax_list' };
  if ((m = /^کد\s+مالیات\s+(.+?)\s*=\s*(.+)$/u.exec(s))) return { type: 'tax_set', customer: m[1].trim(), code: m[2].trim() };
  if ((m = /^کد\s+(.+?)\s*=\s*(.+?)(?:\s+مشتری\s+(.+))?$/u.exec(s))) return { type: 'item_code', code: m[1].trim(), item: m[2].trim(), customer: m[3]?.trim() || '' };
  { // «صورت‌حساب شرکت … برای ماه ۱۰ میلادی» in any words: the statement of a customer for a period (read only; it goes to the asker's own chat)
    const sr = parseStatementRequest(raw, new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10));
    if (sr) return { type: 'statement_nl', customer: sr.customer, period: sr.period, unsupported: sr.unsupported, style: sr.style || '' };
  }
  const firstLine = String(raw).split(/\n/).map((x) => x.trim()).find(Boolean) || '';
  const englishIntent = invoiceIntent(raw) && !/[؀-ۿ]/.test(firstLine); // Persian requests keep their own flows (the model reads, a send of an existing invoice stays a send)
  if (englishIntent) { const strict = strictRequest(raw); if (strict.type !== 'request' || strict.lines.length) return strict; }
  if (looksLikeInvoiceRequest(raw)) return { type: 'request', customer: '', lines: [], free: true }; // any layout: the model only extracts, the matching stays exact
  return englishIntent ? strictRequest(raw) : null; // a message that opens with «invoice» is never anything else
}

/** A message that asks to make an invoice, in any layout ("فاکتور بساز", "فاکتور بزن", "صادر کن", with or without the assistant's name). Not a question, not a send. */
export function looksLikeInvoiceRequest(text) {
  const s = plain(text);
  if (!s || s.length > 3000 || /[?؟]\s*$/u.test(s)) return false;
  // a verb that MAKES an invoice (also «فاکتور کن», «فاکتور کنید»). With one, «برای من بفرست» only means "show me the preview in my chat"; the send-to-customer
  // flow is for an invoice that already exists (a replied PDF, or «فاکتور <number> را به گروه … بفرست»).
  const MAKE = /(?:بساز|بسازید|بزن|بزنید|صادر\s*کن|صادر\s*کنید|درست\s*کن|ایجاد\s*کن|بنویس|فاکتور\s*(?:کن|کنید)(?=\s|$)|فاکتورش\s*کن|فاکتور\s*(?:می\s*خوا(?:ه?م|هیم)|میخوا(?:ه?م|هیم)|لازم\s*دارم|نیاز\s*دارم|بده|بدید|بدهید|بگیر)|(?:می\s*خوا(?:ه?م|هیم)|میخوا(?:ه?م|هیم))\s*(?:یک\s*)?فاکتور)/u;
  if (/ارسال|بفرست|\bsend\b|\bforward\b/iu.test(s) && !MAKE.test(s) && !/صادر/u.test(s)) return false;
  return (/فاکتور/u.test(s) && MAKE.test(s)) || /(?:create|make|issue|prepare)\s+(?:an?\s+)?invoice/iu.test(s) || !!parseEnglishInvoice(text);
}

const PRICE_PART = String.raw`(?:(?:\s*[/@]\s*|\s+(?=\d+(?:\.\d+)?\s*(?:aed|dhs?|dirhams?)\b))(\d+(?:\.\d+)?)\s*(?:aed|dhs?|dirhams?)?)?`; // «/10aed», «/10 aed», «@10», and «10aed» / «10 aed» right after the quantity: the unit price asked for this line
const QTY_LINE = new RegExp(String.raw`^\s*([A-Za-z]?\d{2,5}[A-Za-z-]*)\s*(?:=|:|-|x|×)?\s*(\d+(?:\.\d+)?)\s*(?:m|mtr|mtrs|meter|meters|metre|metres|pcs?|pieces?|متر)?${PRICE_PART}\s*$`, 'iu');
const INLINE_ITEM = new RegExp(String.raw`(?:^|[\s,;])([A-Za-z]?\d{2,5}[A-Za-z-]*)\s*(?:=|:|x|×)\s*(\d+(?:\.\d+)?)\s*(?:m|mtr|mtrs|meter|meters|metre|metres|pcs?|pieces?|متر)?${PRICE_PART}(?=$|[\s,;])`, 'giu');
const EN_HEAD = /^\s*(?:(?:hey|hi|hello)[\s,]+)?(?:(?:atossa|atosa|atousa|atoosa|atusa|آتوسا|اتوسا)[\s,:]+)?(?:please\s+)?(?:(?:make|create|issue|prepare)\s+(?:an?\s+)?)?(?:invoice|inv(?=\s+(?:for|to)\s))\s+(?:for\s+|to\s+)?(.+?)\s*$/iu;

/**
 * An invoice asked for in plain English: «Atossa invoice for burtomani» then one line per item («603 = 30 mtr», «A603 30 m»). A one-letter prefix before a code
 * (A603) is the sender's own mark: the code is 603. Lines the format does not fit (rolls, prices, words) are not read here (the model reads them).
 * Returns { customer, lines: ['603 30', …] } or null.
 */
export function parseEnglishInvoice(text) {
  const r = readEnglishInvoice(text);
  return r && !r.unread.length && r.lines.length ? { customer: r.customer, lines: r.lines } : null;
}

/** The same reading, but every line it cannot read is listed with its number: { customer, lines, unread: [{ n, text }] } or null when there is no «invoice <customer>» head. */
export function readEnglishInvoice(text) {
  const rows = latin(String(text || '')).replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean);
  if (!rows.length || /[?؟]\s*$/u.test(rows[0])) return null;
  const head = EN_HEAD.exec(rows[0]);
  if (!head) return null;
  // items written on the same line, after the customer: «INVOICE FOR AL EBDA 215=97M 220=12M» (a code, = or : or x, a quantity, an optional unit)
  const inline = [...head[1].matchAll(INLINE_ITEM)];
  const cut = inline.length ? inline[0].index + inline[0][0].indexOf(inline[0][1]) : head[1].length;
  const named = head[1].slice(0, cut).replace(/[\s,;]+$/u, '').replace(/\s+(?:and|with)$/iu, '');
  if (/\b(?:send|forward|check|delete|number|no\.?|inv-?\d+|#)\b/i.test(named) || /^\d/.test(named)) return null;
  const customer = named.replace(/\b(?:please|pls|thanks)\b/gi, '').replace(/\s+/g, ' ').trim();
  if (!customer || customer.split(/\s+/).length > 6) return null;
  const lineOf = (m) => `${m[1].replace(/^[A-Za-z](?=\d)/, '')}${m[3] ? `, ${m[2]}, ${m[3]}` : ` ${m[2]}`}`; // a price given for the line makes it exact: code, quantity, price
  const lines = inline.map(lineOf);
  const unread = [];
  rows.slice(1).forEach((row, i) => {
    const m = QTY_LINE.exec(row);
    if (m) { lines.push(lineOf(m)); return; }
    if (!extractPo(row)) unread.push({ n: i + 2, text: row }); // not an item and not the PO line: said, never guessed
  });
  return { customer, lines, unread };
}

/**
 * A message that opens with «invoice» («Atossa invoice …», «invoice for …», «inv for …», «فاکتور …», «اینویس …»): the invoice path and no other. It is never a stock or order request,
 * and nothing about it goes to the sales manager. Not a question.
 */
export function invoiceIntent(text) {
  const first = String(text || '').replace(/\r/g, '').split('\n').map((x) => x.trim()).find(Boolean) || '';
  if (!first || /[?؟]\s*$/u.test(first)) return false;
  return /^[\s*_~]*(?:(?:hey|hi|hello|سلام)[\s,]+)?(?:(?:atossa|atosa|atousa|atoosa|atusa|آتوسا|اتوسا)[\s,:]+)?(?:please\s+|لطفا\s+)?(?:(?:make|create|issue|prepare)\s+(?:an?\s+)?)?(?:invoice|inv(?=\s+(?:for|to)\s)|فاکتور|اینویس)(?=\s|$)/iu.test(first);
}

/** An invoice request with lines that could not be read (or no readable head): what was read, which line was not understood, and that nothing was made. */
function strictRequest(text) {
  const r = readEnglishInvoice(text);
  if (!r) {
    const first = String(text || '').replace(/\r/g, '').split('\n').map((x) => x.trim()).find(Boolean) || '';
    return { type: 'request_partial', customer: '', lines: [], unread: [{ n: 1, text: first }] };
  }
  if (r.unread.length || !r.lines.length) return { type: 'request_partial', customer: r.customer, lines: r.lines, unread: r.unread, noItems: !r.lines.length && !r.unread.length };
  return { type: 'request', customer: r.customer, lines: r.lines };
}

/** The reply to a request with unreadable lines: financial requests are exact, so nothing is made and nothing is guessed. */
export function partialText(ic) {
  const read = (ic.lines || []).map((l) => { const [code, qty, price] = String(l).split(/,\s*|\s+/).map((x) => x.trim()); return `• ${code} — ${qty}${price ? `, price ${Number(price).toFixed(2)} AED` : ', system price'}`; });
  return [
    `Invoice request${ic.customer ? ` for ${ic.customer}` : ''} was NOT made: ${ic.noItems ? 'no item line was found' : 'a line could not be read'}.`,
    ...(read.length ? ['Read so far:', ...read] : []),
    ...(ic.unread || []).map((u) => `⚠ line ${u.n} not understood: "${u.text}"`),
    'Nothing was created, reserved or sent to anyone. Correct it and send the whole request again (customer on the first line, then one item per line: code = quantity, price optional).',
  ].join('\n');
}

/** The customer's PO number written with the request or in the message it quotes («PN 1029», «PO: 1029», «شماره سفارش ۱۰۲۹»): the request's own text first. */
export function extractPo(...texts) {
  for (const t of texts) {
    const m = /(?:\bP\.?\s?N\b\.?|\bP\.?\s?O\b\.?(?:\s*(?:number|no\.?))?|شماره\s*سفارش)\s*[:#=-]?\s*([A-Za-z0-9][A-Za-z0-9\-/]{0,24})/iu.exec(latin(String(t || '')));
    if (m) return m[1];
  }
  return '';
}

/** The ways one item line can be read: [{ item, qty, price|null }]. Separators (, | ; tab) make it exact; without them the numbers at the end are read. */
export function lineCandidates(line) {
  const t = latin(line).replace(/^\s*(?:\d+\s*[.)]\s+|[-•*]\s+)/u, '').trim();
  const isNum = (x) => /^\d+(?:\.\d+)?$/.test(x);
  if (/[,،|;\t]/.test(t)) {
    const f = t.split(/[,،|;\t]/).map((x) => x.trim());
    if (f.length >= 2 && isNum(f[1]) && (f.length === 2 || (f.length === 3 && isNum(f[2])))) return [{ item: f[0], qty: Number(f[1]), price: f[2] === undefined ? null : Number(f[2]) }];
    return [];
  }
  const tok = t.split(/\s+/);
  const out = [];
  const n = tok.length;
  if (n >= 3 && isNum(tok[n - 1]) && isNum(tok[n - 2])) out.push({ item: tok.slice(0, n - 2).join(' '), qty: Number(tok[n - 2]), price: Number(tok[n - 1]) });
  if (n >= 2 && isNum(tok[n - 1])) out.push({ item: tok.slice(0, n - 1).join(' '), qty: Number(tok[n - 1]), price: null });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- exact matching
const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Every way an item can be named by a code: its name, SKU and full name, and the colour or product number inside them (PVC-108, EDGE22-1810, "... - 1810", "1801 edge banding"). */
export function itemCodeKeys(i) {
  const keys = new Set();
  for (const x of [i?.Name, i?.Sku, i?.FullyQualifiedName]) { const k = norm(x); if (k) keys.add(k); }
  const add = (v) => { if (v !== null && v !== undefined && v !== '') keys.add(String(v).toLowerCase()); };
  add(pvcCode(i));
  const sku = String(i?.Sku || '').trim(); const name = String(i?.Name || '').trim();
  let m = /^(?:PVC|EDGE(?:22|50)?)[-\s]*(\d{3,5})$/i.exec(sku); if (m) add(m[1]);
  m = /\s-\s(\d{3,5})\s*$/.exec(name); if (m) add(m[1]); // "EDGE BAND 0.8x22 - 1810"
  m = /^(\d{3,5})\b/.exec(name); if (m) add(m[1]);
  m = /^B\s*(\d{3,5})$/i.exec(name); if (m) add(m[1]);
  m = /^\d{3,5}$/.exec(sku); if (m) add(sku);
  return keys;
}
/** Is [code] a code of some active item? A code that fits SEVERAL items is known (which one is asked later). */
export function codeKnownInItems(items, code) {
  const c = String(code || '').trim();
  if (!c) return false;
  const k = /^\d+$/.test(c) ? c : norm(c);
  return (items || []).some((i) => i && i.Type !== 'Category' && i.Active !== false && itemCodeKeys(i).has(k));
}

/** The code (three or four digits) of a PVC item (PVC FILM108 -> 108, PVC 1810 -> 1810), or null (edge banding, boards and the like have none). */
export function pvcCode(i) {
  const name = String(i?.Name || '');
  const m = /pvc\s*(?:film|flim)?\s*(\d{3,4})(?!\d)/i.exec(name) || (/pvc/i.test(name) ? /^(\d{3,4})$/.exec(String(i.Sku || '').trim()) : null);
  return m ? Number(m[1]) : null;
}

/**
 * Items whose Name, Sku or FullyQualifiedName equals [name] exactly (case-insensitive). The match is by Item.Name (a sub-item's full name
 * "PVC FILM:PVC FILM108" is one more key) and by the SKU ("PVC-108"). A bare code ("108") also finds the PVC item by its code in itemsContaining,
 * so it keeps being found after the SKU was changed. A category is never an item of an invoice.
 */
export function itemsNamed(items, name) {
  const k = norm(name);
  if (!k) return [];
  const lk = looseKey(name);
  return items.filter((i) => i.Type !== 'Category' && i.Active !== false && [i.Name, i.Sku, i.FullyQualifiedName].some((x) => x && (norm(x) === k || (lk && looseKey(x) === lk))));
}

/** Close names for a stop message: never a choice made for the user. */
function closeItems(items, name) {
  const k = norm(name);
  const first = k.split(' ')[0];
  return items.filter((i) => [i.Name, i.Sku].some((x) => x && (norm(x).includes(k) || k.includes(norm(x)) || (first.length >= 3 && norm(x).includes(first))))).slice(0, 3).map((i) => i.Name);
}

/** Items whose Name, Sku or full name holds all the words of [name] as whole words ("1810" finds "B 1810" and "PVC 1810"), up to eight. */
export function itemsContaining(items, name) {
  const toks = nameKey(name).split(' ').filter(Boolean);
  if (!toks.length) return [];
  const code = /^\d{3,4}$/.test(String(name).trim()) ? Number(String(name).trim()) : null; // a bare code also finds the PVC item that carries it (its SKU may now be PVC-108)
  return items.filter((i) => i.Type !== 'Category' && i.Active !== false && ([i.Name, i.Sku, i.FullyQualifiedName].some((x) => { if (!x) return false; const t = new Set(nameKey(x).split(' ')); return toks.every((k) => t.has(k)); }) || (code !== null && pvcCode(i) === code))).slice(0, 8);
}

const itemLabel = (i) => `${i.Name}${i.Sku && norm(i.Sku) !== norm(i.Name) ? ` [${i.Sku}]` : ''}`;

/**
 * One item text -> an item. In order: the code the owner taught, the one item that equals it exactly (Name or Sku), else the items that hold it as
 * whole words: if exactly one of those is something THIS customer bought before, that one; otherwise a stop that lists them with their prices.
 * Returns { item, via } or { stop(n) }.
 */
export function pickItem(name, ctx = {}) {
  const items = ctx.items || [];
  const taught = ctx.taught?.(name);
  if (taught) return { item: taught, via: 'taught' };
  // "نوار لبه 1801 سایز 22": the colour number and the width name the one edge banding item whose SKU is EDGE22-1801
  const sz = /^(?:نوار\s*لبه\s+|edge\s+)?(\d{3,5})\s+(?:سایز\s+|size\s+|عرض\s+)?(22|50)$/iu.exec(nameKey(name).replace(/(\d)\s*mm\b/g, '$1'));
  if (sz) { const bySize = items.filter((i) => i.Type !== 'Category' && norm(i.Sku) === `edge${sz[2]}-${sz[1]}`); if (bySize.length === 1) return { item: bySize[0], via: 'size' }; }
  const exact = itemsNamed(items, name);
  if (exact.length === 1) return { item: exact[0], via: '' };
  const cands = exact.length ? exact : itemsContaining(items, name);
  if (!cands.length) return { stop: (n) => { const close = closeItems(items, name); return `سطر ${fa(n)}: کالای «${name}» در کوییک‌بوکس دقیقاً پیدا نشد؛ اول آن را معرفی کنید.${close.length ? ` نزدیک‌ها: ${close.join(' | ')}` : ''}`; } };
  // a bare code ("108") that only one PVC item carries is that item, even after its SKU became PVC-108 (the code is the number in its name)
  if (!exact.length && cands.length === 1 && /^\d{3,4}$/.test(String(name).trim()) && pvcCode(cands[0]) === Number(String(name).trim())) return { item: cands[0], via: 'code' };
  // a NAME of two or more words (in any order) that exactly ONE active item holds is that item: no guess is involved; ask only when 2+ remain
  if (!exact.length && cands.length === 1 && nameKey(name).split(' ').filter(Boolean).length >= 2) return { item: cands[0], via: 'name' };
  const hist = ctx.history ? cands.filter((i) => ctx.history.has(String(i.Id))) : [];
  if (hist.length === 1) return { item: hist[0], via: 'history' };
  return { stop: (n) => `سطر ${fa(n)}: «${name}» چند کالا دارد و بین آن‌ها حدس نمی‌زنم:\n${cands.map((i, k) => `   ${fa(k + 1)}) ${itemLabel(i)} — قیمت ${Number(i.UnitPrice) > 0 ? i.UnitPrice : 'ندارد'}`).join('\n')}\nبنویسید: کد ${name} = <نام دقیق کالا>` };
}

/**
 * Every line against the QuickBooks items. [entries]: [{ raw, cands: [{ item, qty, price|null }] }] (each candidate is one reading of the line).
 * A line resolves only if exactly ONE reading names an item (see pickItem); otherwise it is a stop with the reason and the candidates.
 */
export function resolveEntries(entries, ctx) {
  const lines = []; const stops = [];
  entries.forEach((e, i) => {
    const n = i + 1;
    const cands = e.cands || [];
    if (!cands.length) { stops.push(`سطر ${fa(n)} را نفهمیدم: «${String(e.raw).slice(0, 60)}» — قالب: نام کالا، تعداد، قیمت (قیمت اختیاری)`); return; }
    const tried = cands.map((c) => ({ c, r: pickItem(c.item, ctx) }));
    const ok = tried.filter((t) => t.r.item);
    if (ok.length > 1) { stops.push(`سطر ${fa(n)}: «${String(e.raw).slice(0, 60)}» بیش از یک جور خوانده می‌شود؛ با ویرگول بنویسید: نام کالا، تعداد، قیمت`); return; }
    if (!ok.length) { stops.push(tried[0].r.stop(n)); return; }
    const { c, r } = ok[0];
    if (!(c.qty > 0 && c.qty <= 100000)) { stops.push(`سطر ${fa(n)}: تعداد درست نیست`); return; }
    if (c.price !== null && c.price !== undefined && !(c.price >= 0 && c.price <= 10000000)) { stops.push(`سطر ${fa(n)}: قیمت درست نیست`); return; }
    lines.push({ n, item: r.item, qty: c.qty, price: c.price ?? null, via: r.via, typed: c.item });
  });
  return { lines, stops };
}

/**
 * A best guess for an item that could not be settled: { item, alts: [item], reason } or null when nothing is near. The customer's history first, then the
 * word and sound closeness of the names. Used only for a PREVIEW; the owner's yes applies it.
 */
export function guessItem(name, ctx = {}) {
  const items = (ctx.items || []).filter((i) => i && i.Type !== 'Category' && i.Active !== false);
  const exact = itemsNamed(items, name);
  let pool = exact.length ? exact : itemsContaining(items, name);
  let reason = pool.length ? 'چند کالا با این نام' : '';
  if (!pool.length) {
    const ranked = rankNames(name, items.map((i) => ({ name: i.Name, alts: [i.Sku, i.FullyQualifiedName].filter(Boolean), item: i })));
    pool = ranked.filter((r) => r.score >= 0.6).slice(0, 4).map((r) => r.key.item);
    reason = 'نزدیک‌ترین نام';
  }
  if (!pool.length) return null;
  const hist = ctx.history ? pool.filter((i) => ctx.history.has(String(i.Id))) : [];
  const rest = pool.filter((i) => !hist.includes(i)).sort((a, b) => scoreName(name, b.Name) - scoreName(name, a.Name));
  const ordered = [...hist, ...rest];
  return { item: ordered[0], alts: ordered.slice(1, 4), reason: hist.length ? 'از خریدهای قبلی مشتری' : reason };
}

/** Like resolveEntries, but an item that cannot be settled is GUESSED (guessItem) and marked; a line is stopped only when nothing is near. */
export function resolveEntriesGuess(entries, ctx) {
  const lines = []; const stops = [];
  entries.forEach((e, i) => {
    const n = i + 1;
    const cands = e.cands || [];
    if (!cands.length) { stops.push(`سطر ${fa(n)} را نفهمیدم: «${String(e.raw).slice(0, 60)}» — قالب: نام کالا، تعداد، قیمت (قیمت اختیاری)`); return; }
    const tried = cands.map((c) => ({ c, r: pickItem(c.item, ctx) }));
    const ok = tried.filter((t) => t.r.item);
    if (ok.length > 1) { stops.push(`سطر ${fa(n)}: «${String(e.raw).slice(0, 60)}» بیش از یک جور خوانده می‌شود؛ با ویرگول بنویسید: نام کالا، تعداد، قیمت`); return; }
    let c; let r; let guess = null;
    if (ok.length === 1) ({ c, r } = ok[0]);
    else {
      c = cands[0];
      const g = guessItem(c.item, ctx);
      if (!g) { stops.push(tried[0].r.stop(n)); return; }
      r = { item: g.item, via: 'guess' }; guess = { alts: g.alts, reason: g.reason };
    }
    if (c.qty === null || c.qty === undefined) { stops.push(`سطر ${fa(n)}: تعداد «${c.item}» نوشته نشده و برشی هم برایش ثبت نشده که از آن حدس بزنم`); return; }
    if (!(c.qty > 0 && c.qty <= 100000)) { stops.push(`سطر ${fa(n)}: تعداد درست نیست`); return; }
    if (c.price !== null && c.price !== undefined && !(c.price >= 0 && c.price <= 10000000)) { stops.push(`سطر ${fa(n)}: قیمت درست نیست`); return; }
    lines.push({ n, item: r.item, qty: c.qty, price: c.price ?? null, via: r.via, typed: c.item, guess, unit: c.unit || '', qtyGuess: c.qtyGuess || null });
  });
  return { lines, stops };
}

/**
 * A message that lists several customers, each followed by its lines in the form «۲۱۵ =۹۷ متر» (code, equals sign, quantity, unit):
 *   «اتوسا فاکتور میخوام برای مشتری های زیر / AL EBDA / ۲۱۵ =۹۷ متر / NUQOOSH / ۲۲۰ =۱۲ متر». Returns [{ customer, lines: [{ code, qty, unit }] }] or null when the text
 * is not of that shape (then the other readers take it). No model is needed.
 */
export function parseInvoiceBlocks(text) {
  const rows = String(text || '').replace(/\r/g, '').split('\n').map((l) => plain(l)).filter(Boolean);
  if (rows.length < 3 || !looksLikeInvoiceRequest(rows[0])) return null;
  const ITEM = /^([A-Za-z0-9][A-Za-z0-9\-./]{0,30}(?:\s[A-Za-z0-9\-./]{1,12})?)\s*[=:]\s*(\d+(?:[.,]\d+)?)\s*([^\d\s=:]\S{0,12})?$/u;
  const UNITS = { 'متر': 'm', m: 'm', mtr: 'm', meter: 'm', 'رول': 'roll', roll: 'roll', 'عدد': 'pcs', pcs: 'pcs', 'کارتن': 'carton', carton: 'carton' };
  const blocks = [];
  for (const row of rows.slice(1)) {
    const codeOnly = /^([A-Za-z]{0,4}[\s-]?\d{2,5})$/u.exec(row); // a code with no quantity: the cut quantity is proposed
    const m = ITEM.exec(row) || (codeOnly ? [row, codeOnly[1], null, ''] : null);
    if (m) {
      if (!blocks.length) return null; // a line before any customer
      blocks.at(-1).lines.push({ code: m[1].trim(), qty: m[2] === null ? null : Number(m[2].replace(',', '.')), unit: UNITS[String(m[3] || '').toLowerCase()] || String(m[3] || '') });
    } else if (row.length <= 60 && !/[=:]/.test(row)) blocks.push({ customer: row.replace(/[,،:;]+$/u, '').trim(), lines: [] });
    else return null;
  }
  return blocks.length && blocks.every((b) => b.lines.length && b.customer) ? blocks : null;
}

/** The same for plain text lines (the strict format): [{ lines, stops }]. */
export function resolveLines(rawLines, items, ctx = {}) {
  return resolveEntries(rawLines.map((raw) => ({ raw, cands: lineCandidates(raw) })), { ...ctx, items });
}

/**
 * Every active tax code of the company (zero-rated and exempt ones too) with its sales rate, read from QuickBooks: id -> { id, name, rate }.
 * UAE VAT is by emirate of supply (and exports are zero-rated), so no single code can be right for every customer.
 */
export function taxCodeMap(taxCodes, taxRates) {
  const rate = new Map(taxRates.map((r) => [String(r.Id), Number(r.RateValue)]));
  const out = new Map();
  for (const t of taxCodes) {
    if (t.Active === false) continue;
    const r = (t.SalesTaxRateList?.TaxRateDetail || []).reduce((sum, d) => sum + (rate.get(String(d.TaxRateRef?.value)) || 0), 0);
    out.set(String(t.Id), { id: String(t.Id), name: t.Name, rate: t.Taxable === false ? 0 : r });
  }
  return out;
}

/**
 * The tax code the office itself used on a customer's recent invoices (newest first): the code of at least 90% of all their lines AND the code
 * of the most recent invoice. Otherwise { error } with what was found (no history, or no such majority), so the owner picks.
 */
export function codeFromInvoices(invoices, codes) {
  const count = new Map();
  const codesOf = (inv) => (inv.Line || []).map((l) => l.SalesItemLineDetail?.TaxCodeRef?.value).filter((id) => id !== undefined && id !== null && id !== '').map(String);
  for (const inv of invoices) for (const id of codesOf(inv)) count.set(id, (count.get(id) || 0) + 1);
  const found = [...count.entries()].map(([id, n]) => ({ id, n, name: codes.get(id)?.name || `(${id})`, known: codes.has(id) })).sort((x, y) => y.n - x.n);
  const total = found.reduce((sum, f) => sum + f.n, 0);
  if (!found.length) return { error: 'none', found };
  const top = found[0];
  // the code of the most recent invoice that has any tax line: its own most frequent code
  const newest = invoices.map(codesOf).find((c) => c.length);
  const tally = new Map();
  for (const id of newest || []) tally.set(id, (tally.get(id) || 0) + 1);
  const lead = [...tally.entries()].sort((x, y) => y[1] - x[1]);
  const newestCode = lead.length && (lead.length === 1 || lead[0][1] > lead[1][1]) ? lead[0][0] : '';
  if (top.n / total < 0.9 || top.id !== newestCode) return { error: 'disagree', found };
  if (!top.known) return { error: 'unknown', found };
  return { code: codes.get(top.id), n: top.n, total, found, invoices: invoices.length };
}

/** Totals in fils, the way QuickBooks adds them: each line rounded, the VAT on the sum of the taxable lines. */
export function totals(lines, ratePct) {
  const sub = lines.reduce((s, l) => s + l.amount, 0);
  const vat = Math.round((sub * ratePct) / 100);
  return { subtotal: sub, vat, total: sub + vat };
}

// ---------------------------------------------------------------------------------------------------------------- the permissions
/** What the owner can give a person, each SEPARATELY: [words] is how he writes it (regex), [label] how it is listed. Add «موجودی», «گزارش» … here the same way. */
export const PERMISSIONS = {
  invoice: { words: 'فاکتور|invoice', label: 'فاکتور' },
  statement: { words: String.raw`صورت\s*حساب|صورت‌حساب|استیتمنت|استیت‌منت|statement`, label: 'صورت‌حساب' },
};

// ---------------------------------------------------------------------------------------------------------------- the stores
/** Who the owner authorized to ask for invoices and statements (their numbers), kept on the VM. */
export class AuthStore {
  constructor(dir = '') {
    this.file = dir ? path.join(dir, 'qbo-authorized.json') : ''; this.d = { people: [] };
    try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ }
    this.migrate();
  }
  /** Older files: no «grants» meant invoices AND statements, and scope «statement» meant statements only. Each becomes separate grants, so nobody gains or loses anything. */
  migrate() {
    let changed = false;
    for (const p of this.d.people) {
      if (Array.isArray(p.grants)) continue;
      p.grants = p.scope === 'statement' ? ['statement'] : ['invoice', 'statement'];
      delete p.scope; changed = true;
    }
    if (changed) this.save();
  }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  static clean(number) { const d = latin(number).replace(/\D/g, ''); return d.length >= 8 && d.length <= 15 ? d : ''; }
  numbers() { return this.d.people.map((p) => p.number); }
  grantsOf(number) { const p = this.d.people.find((x) => x.number === AuthStore.clean(number)); return p ? [...p.grants] : []; }
  /** Give one permission (the person is added if new). false = the number is not valid or the permission is unknown. */
  grant(number, perm, now = Date.now()) {
    const n = AuthStore.clean(number); if (!n || !PERMISSIONS[perm]) return false;
    let p = this.d.people.find((x) => x.number === n);
    if (!p) { p = { number: n, at: new Date(now).toISOString(), grants: [] }; this.d.people.push(p); }
    if (!p.grants.includes(perm)) p.grants.push(perm);
    this.save(); return n;
  }
  /** Take one permission; a person left with none is removed. false = they did not have it. */
  revoke(number, perm) {
    const n = AuthStore.clean(number); const p = this.d.people.find((x) => x.number === n);
    if (!p || !p.grants.includes(perm)) return false;
    p.grants = p.grants.filter((g) => g !== perm);
    if (!p.grants.length) this.d.people = this.d.people.filter((x) => x !== p);
    this.save(); return true;
  }
  list() { return this.d.people.map((p) => ({ number: p.number, grants: [...p.grants] })); }
  /** Has this sender (jid, alt jid, lid mapped) the permission [perm]? With no [perm]: any permission at all. */
  has(who, perm = '', lidToPhone = new Map()) { return this.d.people.some((p) => (!perm || p.grants.includes(perm)) && staffChecker([p.number], lidToPhone)(who) === true); }
  isAuthorized(who, lidToPhone = new Map()) { return this.has(who, '', lidToPhone); }
  /** The number the sender is authorized under ('' if none) and what that person may do. */
  whoIs(who, lidToPhone = new Map()) { const p = this.d.people.find((x) => staffChecker([x.number], lidToPhone)(who) === true); return p ? { number: p.number, grants: [...p.grants] } : { number: '', grants: [] }; }
}

/** The item codes the owner taught ("کد 1810 = PVC 1810"): for one customer (by QuickBooks id) or for everybody. Kept on the VM. */
export class ItemCodes {
  constructor(dir = '') { this.file = dir ? path.join(dir, 'qbo-itemcodes.json') : ''; this.d = { byKey: {} }; try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ } }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  static key(customerId, code) { return `${customerId || '*'}|${nameKey(code)}`; }
  /** The item taught for this customer's code, else the global one, else null. */
  get(customerId, code) { return this.d.byKey[ItemCodes.key(customerId, code)] || this.d.byKey[ItemCodes.key('', code)] || null; }
  set(customerId, code, item, now = Date.now()) { this.d.byKey[ItemCodes.key(customerId, code)] = { itemId: String(item.Id), name: item.Name, at: new Date(now).toISOString() }; this.save(); }
}

/** The tax code the owner chose for a customer (by QuickBooks customer id), for a customer with no clear invoices of his own. */
export class TaxChoices {
  constructor(dir = '') { this.file = dir ? path.join(dir, 'qbo-taxcodes.json') : ''; this.d = { byCustomer: {} }; try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ } }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  get(customerId) { return this.d.byCustomer[String(customerId)] || null; }
  set(customerId, code, now = Date.now()) { this.d.byCustomer[String(customerId)] = { codeId: code.id, name: code.name, at: new Date(now).toISOString() }; this.save(); }
}

/** The append-only audit log: time, requester, approver, preview id, QuickBooks id, document number, total. Never a message text. */
export class Audit {
  constructor(dir = '', now = () => Date.now()) { this.file = dir ? path.join(dir, 'qbo-audit.log') : ''; this.now = now; }
  add(entry) { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.appendFileSync(this.file, `${JSON.stringify({ at: new Date(this.now()).toISOString(), ...entry })}\n`, { mode: 0o600 }); } catch { /* best effort */ } }
  last(n = 10) { try { return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l)); } catch { return []; } }
  /** Every entry (the undo job reads what a finished job really did from here). */
  all() { try { return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
}

/** The previews and the creations made (for the caps). */
export class InvoiceStore {
  constructor(dir = '') { this.file = dir ? path.join(dir, 'qbo-invoices.json') : ''; this.d = { n: 0, previews: {}, creates: [] }; try { if (this.file) Object.assign(this.d, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* none yet */ }
    // a number is claimed only by a create attempt: a waiting preview from before that rule carries no number
    for (const q of Object.values(this.d.previews)) if (q.status === 'pending' && !q.attempted && q.docNumber) q.docNumber = '';
  }
  save() { if (!this.file) return; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.d), { mode: 0o600 }); } catch { /* best effort */ } }
  nextId() { this.d.n += 1; return `Q${this.d.n}`; }
  add(p) { this.d.previews[p.id] = p; this.save(); return p; }
  get(id) { return this.d.previews[String(id).toUpperCase()] || null; }
  /** Creations in the last hour and the last day. */
  counts(now) { const hour = this.d.creates.filter((t) => now - t < 3600000).length; const day = this.d.creates.filter((t) => now - t < DAY).length; return { hour, day }; }
  recordCreate(now) { this.d.creates = [...this.d.creates.filter((t) => now - t < DAY), now]; this.save(); }
}

// ---------------------------------------------------------------------------------------------------------------- the desk
// What QuickBooks fills in by itself whatever the API sends: not worth the owner's eye in a dry run.
const HARMLESS = ['PrivateNote', 'AllowIPN', 'AllowOnlineAffirmPayment', 'AllowOnlinePayPalPayment', 'CustomField', 'EmailStatus', 'ExchangeRate'];
const HARMLESS_LINE = ['Id', 'LineNum', 'CustomExtensions', 'SalesItemLineDetail.ItemAccountRef'];

// What a PhysicalAddress may carry on a create; and the optional «as the screen does» fields: if QuickBooks refuses the invoice (400) they are the first suspects
// and the create is tried once more without them (a 400 creates nothing, so this cannot make two invoices).
const PHYSICAL_ADDRESS = ['Line1', 'Line2', 'Line3', 'Line4', 'Line5', 'City', 'Country', 'CountrySubDivisionCode', 'PostalCode'];
export const OPTIONAL_PARITY = ['BillAddr', 'ShipAddr', 'CurrencyRef', 'TransactionLocationType', 'AllowOnlineACHPayment', 'AllowOnlineCreditCardPayment', 'AllowOnlinePayment', 'PrintStatus', 'TemplateRef'];

export class QboInvoiceDesk {
  /**
   * [qbo]; [desk]: the QboDesk (customer matching and the cached customer list); [store]: InvoiceStore; [audit]: Audit; [book]: the owner's price
   * list (PriceBook) or null; [config]; [today]: () => yyyy-mm-dd; [now]; [post]: async (jid, buffer, fileName, caption); [ownerJid]: () => jid;
   * [groups]: async () => [{ id, subject }]; [testGroup]: (groups) => group|null.
   */
  constructor({ cutsOf = null, markCuts = null, crossOf = null, cutLabel = 'گروه سفارش آریاک', stockOf = null, qbo, desk, store, audit, book = null, taxChoices = new TaxChoices(''), itemCodes = new ItemCodes(''), extract = null, config, today, now = () => Date.now(), post, ownerJid, groups, testGroup, log = () => {} }) {
    Object.assign(this, { targets: null, crossOf, cutsOf, markCuts, cutLabel, stockOf, qbo, desk, store, audit, book, taxChoices, itemCodes, extract, config, today, now, post, ownerJid, groups, testGroup, log });
    this.cache = { at: 0, items: [], codes: new Map(), currency: '', customTxn: false };
    this.inflight = new Set(); // previews being created right now: a yes that arrives meanwhile does not start a second attempt
  }

  async catalog() {
    if (this.now() - this.cache.at < 10 * 60 * 1000 && this.cache.items.length) return this.cache;
    const [items, taxCodes, taxRates, prefs] = await Promise.all([
      this.qbo.query('select * from Item where Active = true'),
      this.qbo.query('select * from TaxCode').catch(() => []),
      this.qbo.query('select * from TaxRate').catch(() => []),
      this.qbo.get('preferences').then((j) => j?.Preferences || null).catch(() => null),
    ]);
    this.cache = { at: this.now(), items: items.filter((i) => i.Type !== 'Category'), codes: taxCodeMap(taxCodes, taxRates), currency: prefs?.CurrencyPrefs?.HomeCurrency?.value || '', customTxn: prefs?.SalesFormsPrefs?.CustomTxnNumbers === true };
    return this.cache;
  }

  /**
   * What the QuickBooks screen fills in by itself and the API does not: the company's default terms (Net 30 …) and the «message on invoice» (the thank-you,
   * bank charges and bank details block). Read LIVE at the create, never typed here: the default message of the company's sales-form preferences, else the
   * message of the newest invoice the OFFICE made (not one of ours). Nothing is invented; a field that cannot be read stays empty. { terms, memo, source }.
   */
  async salesDefaults(customerId = '') {
    let terms = ''; let memo = ''; let source = ''; let customer = null;
    if (customerId) { try { customer = await this.customerRecord(customerId); } catch (e) { this.log(`sales defaults: the customer could not be read (${e.name})`); } } // addresses, terms, e-mail, currency: as the screen takes them
    try {
      const forms = (await this.qbo.get('preferences'))?.Preferences?.SalesFormsPrefs || {};
      if (/^\d+$/.test(String(forms.DefaultTerms || ''))) terms = String(forms.DefaultTerms);
      memo = String(forms.DefaultCustomerMessage || '').trim(); if (memo) source = 'preference';
    } catch (e) { this.log(`sales defaults: the preferences could not be read (${e.name})`); }
    let office = null;
    try { // the newest invoices the OFFICE made on the screen: the message (when the preference is empty) and the switches the screen sets (online payment, print status)
      const rows = (await this.qbo.get('query', { query: 'select * from Invoice ORDERBY MetaData.CreateTime DESC STARTPOSITION 1 MAXRESULTS 25' }))?.QueryResponse?.Invoice || [];
      const offices = rows.filter((r) => !/^Atossa/i.test(String(r.PrivateNote || '')));
      office = offices[0] || null;
      if (!memo) {
        const lender = offices.find((r) => String(r.CustomerMemo?.value || '').trim());
        if (lender) { memo = String(lender.CustomerMemo.value).trim(); source = `invoice ${lender.DocNumber || lender.Id}`; }
      }
    } catch (e) { this.log(`sales defaults: the latest invoices could not be read (${e.name})`); }
    let mine = null; // the newest invoice the office made for THIS customer (his terms, his place of supply)
    if (customerId) {
      try {
        const rows = (await this.qbo.get('query', { query: `select * from Invoice where CustomerRef = '${qboEscape(customerId)}' ORDERBY MetaData.CreateTime DESC STARTPOSITION 1 MAXRESULTS 10` }))?.QueryResponse?.Invoice || [];
        mine = rows.find((r) => !/^Atossa/i.test(String(r.PrivateNote || ''))) || null;
      } catch (e) { this.log(`sales defaults: the customer's invoices could not be read (${e.name})`); }
    }
    const ref = mine || office; // his own, else the newest overall
    if (!terms && ref?.SalesTermRef?.value) terms = String(ref.SalesTermRef.value);
    const place = ref?.TransactionLocationType ? String(ref.TransactionLocationType) : ''; // the place of supply (UAE VAT), as the office used it
    const flags = {};
    for (const k of ['AllowOnlineACHPayment', 'AllowOnlineCreditCardPayment', 'AllowOnlinePayment']) if (typeof office?.[k] === 'boolean') flags[k] = office[k];
    if (office?.PrintStatus === 'NotSet') flags.PrintStatus = 'NotSet'; // the API would otherwise set NeedToPrint
    let template = '';
    try { // the form styles QuickBooks lists (the default one cannot be read through the API; a style is named in QBO_INVOICE_TEMPLATE to force it)
      const styles = await this.qbo.query('select * from Template');
      const names = styles.map((t) => `${t.Name}${t.TemplateType ? ` [${t.TemplateType}]` : ''}`);
      if (names.length) this.log(`sales defaults: form styles in QuickBooks: ${names.join(', ')}`);
      const want = String(this.config.qboInvoiceTemplate || '').trim().toLowerCase();
      const hit = want ? styles.find((t) => String(t.Name || '').trim().toLowerCase() === want) : null;
      if (hit) template = String(hit.Id); else if (want) this.log(`sales defaults: the form style "${this.config.qboInvoiceTemplate}" was not found; the company default is used`);
    } catch (e) { this.log(`sales defaults: the form styles could not be read (${e.name})`); }
    this.log(`sales defaults: terms ${terms || 'none'}, message ${memo ? `${memo.length} characters from ${source}` : 'none'}`);
    if (place) flags.TransactionLocationType = place;
    return { terms, memo, source, template, customer, flags };
  }

  /**
   * The customer's invoice lines in QuickBooks of the last 40 days (the office's on the screen and ours), for the cross-check with the cutting group:
   * [{ codes: [item sku, item name], qty, number, at }], or null when QuickBooks could not be read.
   */
  async customerInvoiceLines(customerId, cat = null) {
    if (!customerId) return null;
    try {
      const since = new Date(this.now() - 40 * DAY).toISOString().slice(0, 10);
      const rows = await this.qbo.query(`select * from Invoice where CustomerRef = '${qboEscape(customerId)}' and TxnDate >= '${since}'`);
      const items = new Map((cat?.items || []).map((i) => [String(i.Id), i]));
      return rows.flatMap((inv) => (inv.Line || []).filter((l) => l.DetailType === 'SalesItemLineDetail').map((l) => {
        const it = items.get(String(l.SalesItemLineDetail?.ItemRef?.value)) || null;
        const name = it?.Name || l.SalesItemLineDetail?.ItemRef?.name || '';
        return { codes: [String(it?.Sku || '').replace(/^(?:PVC|EDGE\d*)-/i, ''), String(name).replace(/^.*?(\d{3,5})$/, '$1'), name].filter(Boolean), qty: Number(l.SalesItemLineDetail?.Qty) || 0, number: String(inv.DocNumber || ''), at: Date.parse(`${inv.TxnDate}T00:00:00Z`) || 0 };
      }));
    } catch (e) { this.log(`cross-check: the customer's invoices could not be read (${e.name})`); return null; }
  }

  async customerRecord(id) { return (await this.qbo.query(`select * from Customer where Id = '${qboEscape(id)}'`))[0] || null; }

  /** Is this document number already used by an invoice? */
  async docNumberTaken(n) { return (await this.qbo.query(`select Id from Invoice where DocNumber = '${qboEscape(n)}'`)).length > 0; }

  /**
   * The next invoice number when the company numbers by hand: the pattern of the office (the prefix and digits of its newest invoice, "inv-8996"),
   * the highest number of that pattern among QuickBooks' own latest invoices (created and last changed), plus one, and free. { docNumber } or { error }.
   */
  async nextDocNumber(exceptId = '') {
    // ONLY QuickBooks, read now (no cache, no number kept by Atossa): the last invoices by creation AND by last change, so an invoice the office renumbered by hand is seen
    const read = async (order) => (await this.qbo.get('query', { query: `select Id, DocNumber from Invoice ORDERBY ${order} DESC STARTPOSITION 1 MAXRESULTS 60` }))?.QueryResponse?.Invoice || [];
    const created = await read('MetaData.CreateTime');
    let changed = [];
    try { changed = await read('MetaData.LastUpdatedTime'); } catch (e) { this.log(`next number: the last-changed list could not be read (${e.name})`); }
    const byId = new Map();
    for (const r of [...changed, ...created]) if (r.DocNumber) byId.set(String(r.Id), String(r.DocNumber));
    const numbers = created.map((r) => String(r.DocNumber || '')).filter(Boolean);
    const all = [...byId.values()];
    const pat = (n) => /^(.*?)(\d+)$/.exec(n);
    const newest = numbers.map(pat).find(Boolean);
    if (!newest) return { error: 'الگوی شمارهٔ فاکتورهای دفتر از آخرین فاکتورها خوانده نشد' };
    const [, prefix, digits] = newest;
    // only QuickBooks' own invoices count: a preview never holds a number
    const same = all.map(pat).filter((m) => m && m[1].toLowerCase() === prefix.toLowerCase());
    let next = Math.max(...same.map((m) => Number(m[2]))) + 1;
    const pad = digits.startsWith('0') ? digits.length : 0;
    for (let tries = 0; tries < 20; tries++, next++) {
      const candidate = `${prefix}${String(next).padStart(pad, '0')}`;
      if (!(await this.docNumberTaken(candidate))) { this.log(`next number: max ${prefix}${String(Math.max(...same.map((m) => Number(m[2])))).padStart(pad, '0')} in QuickBooks (${all.length} invoices read) -> ${candidate}`); return { docNumber: candidate }; }
    }
    return { error: 'شمارهٔ آزاد بعدی پیدا نشد' };
  }

  /** A tax code by its name or id (case-insensitive, exact). */
  codeNamed(codes, name) { const k = norm(name); return [...codes.values()].find((c) => c.id === String(name).trim() || norm(c.name) === k) || null; }

  /**
   * The tax code of an invoice for THIS customer: the owner's override (QBO_TAX_CODE), else the code he chose for the customer, else the code the
   * office itself used on the customer's recent invoices (all of their lines agree). Otherwise { error } with what was found, so the owner picks.
   */
  async recentInvoices(customerId) {
    const j = await this.qbo.get('query', { query: `select * from Invoice where CustomerRef = '${qboEscape(customerId)}' ORDERBY TxnDate DESC STARTPOSITION 1 MAXRESULTS 10` });
    return j?.QueryResponse?.Invoice || [];
  }

  async taxFor(cust, cat, recent, items = []) {
    const names = [...cat.codes.values()].map((c) => `${c.name} (${c.rate}%)`).join(' | ');
    const ask = `کد را خودتان بگویید: «کد مالیات ${cust.name} = <نام کد>». کدهای موجود: ${names}`;
    if (this.config.qboTaxCode) {
      const c = this.codeNamed(cat.codes, this.config.qboTaxCode);
      return c ? { ...c, source: 'override' } : { error: `کد مالیاتی تعیین‌شده در تنظیم (QBO_TAX_CODE) در کوییک‌بوکس پیدا نشد. کدهای موجود: ${names}` };
    }
    const chosen = this.taxChoices.get(cust.id);
    if (chosen && cat.codes.has(String(chosen.codeId))) return { ...cat.codes.get(String(chosen.codeId)), source: 'owner' };
    // the items' own tax code: when every item of the invoice carries the SAME known code, that is the code (the Dubai standard-rated code after the bulk job)
    const own = items.map((i) => String(i?.SalesTaxCodeRef?.value || ''));
    if (own.length && own[0] && own.every((x) => x === own[0]) && cat.codes.has(own[0])) return { ...cat.codes.get(own[0]), source: 'item' };
    const r = codeFromInvoices(recent, cat.codes);
    if (r.code) return { ...r.code, source: 'invoices', n: r.n, total: r.total, others: r.found.filter((f) => f.id !== r.code.id) };
    if (r.error === 'none') return { guessable: true, error: `برای «${cust.name}» فاکتور قبلی با کد مالیات در کوییک‌بوکس نیست تا از دفتر خوانده شود. ${ask}` };
    const seen = r.found.map((f) => `${f.name} (${f.n} سطر)`).join('، ');
    return { guessable: true, error: `کد مالیات فاکتورهای اخیر «${cust.name}» ${r.error === 'unknown' ? 'ناشناخته است' : 'اکثریت روشنی ندارد (دست‌کم ۹۰٪ سطرها و کد آخرین فاکتور باید یکی باشد)'}: ${seen}. ${ask}` };
  }

  /**
   * A tax code to propose when the history gives no clear one: the code most used in the customer's recent invoices, else the one most items carry, else the
   * only 5% code of the books. { ...code, source: 'guess', reason, alts: [codes] } or null. It is only proposed in a preview; the owner's yes applies it.
   */
  taxGuess(cat, recent, items = []) {
    const count = (ids) => { const m = new Map(); for (const id of ids) if (cat.codes.has(String(id))) m.set(String(id), (m.get(String(id)) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).map(([id]) => id); };
    const fromInvoices = count(recent.flatMap((inv) => (inv.Line || []).map((l) => l.SalesItemLineDetail?.TaxCodeRef?.value).filter(Boolean)));
    let order = fromInvoices; let reason = 'بیشترین کد در فاکتورهای قبلی مشتری';
    if (!order.length) { order = count(items.map((i) => i?.SalesTaxCodeRef?.value).filter(Boolean)); reason = 'کدی که بیشتر کالاها دارند'; }
    if (!order.length) { const five = [...cat.codes.values()].filter((c) => Number(c.rate) === 5); if (five.length === 1) { order = [String(five[0].id)]; reason = 'تنها کد ۵٪ کوییک‌بوکس'; } }
    if (!order.length) return null;
    const best = cat.codes.get(order[0]);
    return { ...best, source: 'guess', reason, alts: order.slice(1, 4).map((id) => cat.codes.get(id)) };
  }

  /** The ids of the previews the owner can still say yes or no to (pending, not older than a day). */
  openIds() { return Object.values(this.store.d.previews).filter((p) => p.status === 'pending' && this.now() - p.at <= EXPIRY_MS).map((p) => p.id); }

  /** "کد مالیات <مشتری> = <کد>": the owner chooses the code of a customer (stored on the VM). */
  async setTaxChoice({ customer, code }) {
    const guard = this.guard();
    if (guard) return [guard];
    const cust = await this.desk.resolveStrict(customer);
    if (!cust.id) return [`مشتری «${cust.ours}» با نام دقیق یا انتخاب تأییدشدهٔ مالک در کوییک‌بوکس نیست؛ اول معرفی شود (تطبیق کوییک‌بوکس).`];
    const cat = await this.catalog();
    const c = this.codeNamed(cat.codes, code);
    if (!c) return [`کد «${code}» در کوییک‌بوکس نیست. کدهای موجود: ${[...cat.codes.values()].map((x) => `${x.name} (${x.rate}%)`).join(' | ')}`];
    this.taxChoices.set(cust.id, c, this.now());
    this.audit.add({ event: 'tax-code', approver: 'owner', reason: `${cust.id}=${c.id}` });
    return [`ثبت شد: کد مالیات «${cust.name}» = ${c.name} (${c.rate}٪). فاکتورهای بعدی او با همین کد می‌شود.`];
  }

  async taxListText() {
    if (this.guard()) return [this.guard()];
    const cat = await this.catalog();
    return [['کدهای مالیاتی کوییک‌بوکس:', ...[...cat.codes.values()].map((c) => `• ${c.name} — ${c.rate}٪`)].join('\n')];
  }

  guard() {
    if (this.qbo.paused) return 'کوییک‌بوکس با فرمان مالک متوقف است؛ بنویسید: ادامهٔ کوییک‌بوکس';
    if (!this.qbo.configured) return `کوییک‌بوکس هنوز تنظیم نشده است. تنظیم‌های کم: ${this.qbo.missing.join('، ')}`;
    if (this.qbo.needsReconnect) return 'کوییک‌بوکس باید دوباره وصل شود؛ بنویسید: اتصال کوییک‌بوکس';
    if (!this.qbo.connected) return 'کوییک‌بوکس وصل نیست؛ بنویسید: اتصال کوییک‌بوکس';
    return '';
  }

  /**
   * A request in the strict format (customer on the first line, one item per line) or in ANY layout -> a PREVIEW sent to the owner. Free-form
   * requests are first read by the model into { customer, lines } (it only extracts); when it is unsure the request stops and says what was
   * understood. Returns { requester, owner }: the note for the person who asked, and the preview for the owner (null when it stopped). Never creates.
   */
  async request({ text, requester, quotedText = '', origin = null, test = false }) {
    const cmd = parseInvoiceCommand(text);
    if (cmd?.type === 'request_partial') return { requester: partialText(cmd), owner: cmd.fromOwner ? partialText(cmd) : null }; // unreadable lines: said, nothing made, nobody else told
    if (cmd?.type !== 'request') return { requester: 'Write: فاکتور بساز <customer> and then one item per line: item, quantity, price (price optional).', owner: null };
    const stop = (msg) => ({ requester: msg, owner: null });
    const blocked = this.guard();
    if (blocked) return stop(blocked);
    const strict = !cmd.free && cmd.customer && cmd.lines.length && cmd.lines.every((l) => lineCandidates(l).length);
    const po = extractPo(text, quotedText);
    const en = strict ? null : parseEnglishInvoice(text);
    let customerText = cmd.customer; let entries;
    if (en) {
      customerText = en.customer;
      entries = en.lines.map((raw) => ({ raw, cands: lineCandidates(raw) }));
    } else if (strict) {
      if (cmd.lines.length > MAX_LINES) return stop(`حداکثر ${fa(MAX_LINES)} سطر در یک فاکتور.`);
      entries = cmd.lines.map((raw) => ({ raw, cands: lineCandidates(raw) }));
    } else {
      const blocks = parseInvoiceBlocks(text);
      if (blocks) return this.requestBlocks({ blocks, requester, origin, test });
      if (!this.extract) return stop('بعد از نام مشتری، هر کالا را در یک سطر بنویسید: نام کالا، تعداد، قیمت (قیمت اختیاری).');
      let x = null;
      try { x = await this.extract(text); } catch (e) { this.log(`invoice request could not be read: ${e.name}`); }
      if (!x) return stop('درخواست را نفهمیدم. بنویسید: فاکتور بساز <مشتری> و بعد هر کالا در یک سطر: نام کالا، تعداد، قیمت (قیمت اختیاری).');
      const unclear = [...x.unsure];
      if (!x.customer) unclear.push('نام مشتری مشخص نیست');
      if (!x.lines.length) unclear.push('هیچ کالایی با تعدادش خوانده نشد');
      if (x.lines.length > MAX_LINES) unclear.push(`بیش از ${fa(MAX_LINES)} سطر`);
      if (unclear.length) return stop(`این را فهمیدم:\nمشتری: ${x.customer || '—'}\n${x.lines.length ? x.lines.map((l, i) => `${fa(i + 1)}. ${l.item} × ${l.qty}${l.price !== null ? ` @ ${l.price}` : ''}`).join('\n') : 'سطری نیست'}\nولی مطمئن نیستم: ${unclear.join('؛ ')}\nچیزی ساخته نشد. دوباره بنویسید (یا با قالب: فاکتور بساز <مشتری> و هر کالا در یک سطر: نام کالا، تعداد، قیمت).`);
      customerText = x.customer;
      entries = x.lines.map((l) => ({ raw: `${l.item} ${l.qty}${l.price !== null ? ` @ ${l.price}` : ''}`, cands: [{ item: l.item, qty: l.qty, price: l.price }] }));
    }
    return this.makePreview({ customerText, entries, requester, stop, po, origin, test });
  }

  /**
   * Several customers in one message: one PREVIEW per customer, each with its own yes, never merged (separate customers keep separate balances).
   * The reply lists them all; «بله همه» approves every preview of this message.
   */
  async requestBlocks({ blocks, requester, origin = null, test = false }) {
    // one preview per block, never merged: two names that look alike in the WhatsApp groups can be two customers with separate balances in QuickBooks
    const groups = blocks.map((b) => ({ names: [b.customer], lines: [...b.lines] }));
    const batch = `B${this.now()}`;
    const parts = []; let made = 0;
    for (const g of groups) {
      const entries = g.lines.map((l) => ({ raw: `${l.code} ${l.qty}`, cands: [{ item: l.code, qty: l.qty, price: null, unit: l.unit }] }));
      const stop = (msg) => ({ requester: msg, owner: null });
      const r = await this.makePreview({ customerText: g.names[0], entries, requester, stop, batch, origin, test });
      if (r.owner) { made += 1; parts.push(r.owner); } else parts.push(`مشتری «${g.names[0]}»: ${r.requester}`);
    }
    const foot = made > 1 ? '\n\nبرای پذیرفتن همهٔ این پیش‌نمایش‌ها: «بله همه» — برای لغو همه: «نه همه» (هر کدام را جدا هم می‌توانید با شماره‌اش بپذیرید).' : '';
    return { requester: `Your invoice requests (${made}) were sent to the owner for approval.`, owner: `${parts.join('\n\n— — —\n\n')}${foot}` };
  }

  /** «بله همه» / «نه همه»: every pending preview of the newest message that made several. */
  async decideAll({ verb }) {
    const open = Object.values(this.store.d.previews).filter((p) => p.status === 'pending' && p.batch && this.now() - p.at <= EXPIRY_MS);
    if (!open.length) return ['پیش‌نمایش بازی از یک پیام چندمشتری نیست.'];
    const newest = open.sort((a, b) => b.at - a.at)[0].batch;
    const out = [];
    for (const p of open.filter((x) => x.batch === newest).sort((a, b) => (a.id < b.id ? -1 : 1))) out.push(...(await this.decide({ verb, id: p.id })));
    return out;
  }

  async makePreview({ customerText, entries, requester, stop, overrides = {}, reuseId = '', batch = '', po = '', origin = null, test = false }) {
    let cust = overrides.customer ? { ours: customerText, id: overrides.customer.id, name: overrides.customer.name, loose: true, typed: customerText, chosen: true } : await this.desk.resolveLoose(customerText);
    const problems = { customer: '', items: [], tax: '' };
    const guesses = { customer: null, lines: [], tax: null }; // what was GUESSED (shown with alternatives; applied only by the owner's yes)
    if (!cust.id) {
      const g = await this.desk.guessCustomer(customerText, cust);
      if (g) { guesses.customer = { text: customerText, reason: g.reason, alts: g.alts }; cust = { ours: cust.ours || customerText, id: g.best.id, name: g.best.name, loose: true, typed: customerText, guessed: true }; }
    }
    if (!cust.id) {
      if (cust.candidates) problems.customer = `مشتری «${cust.ours}» با چند مشتری می‌خواند و بین آن‌ها حدس نمی‌زنم:\n${cust.candidates.map((c, i) => `   ${fa(i + 1)}) ${c}`).join('\n')}\n   نام کامل یکی را بنویسید.`;
      else {
        const how = cust.ambiguous ? `چند مشتری با این نام دقیق هست: ${cust.ambiguous.map((c) => c.DisplayName).join(' | ')}` : cust.options?.length ? `نزدیک‌ترین‌ها (حتی اگر ضعیف): ${cust.options.map((o) => o.label || o.name).join(' | ')}` : 'مشتری مشابهی هم میان همهٔ مشتری‌های کوییک‌بوکس (فعال و غیرفعال) پیدا نشد؛ اگر مشتری تازه است، خودتان در کوییک‌بوکس بسازید (من مشتری نمی‌سازم) و دوباره بنویسید';
        problems.customer = `مشتری «${cust.ours}» با نام دقیق یا انتخاب تأییدشدهٔ مالک در کوییک‌بوکس نیست؛ اول معرفی شود (تطبیق کوییک‌بوکس). ${how}`;
      }
    }
    const cat = await this.catalog();
    // what this customer bought and was taxed with before (only when the customer is known)
    const recent = cust.id ? await this.recentInvoices(cust.id) : [];
    const history = new Set();
    for (const inv of recent) for (const l of inv.Line || []) { const id = l.SalesItemLineDetail?.ItemRef?.value; if (id !== undefined && id !== null) history.add(String(id)); }
    const taught = (code) => { if (!cust.id) return null; const t = this.itemCodes.get(cust.id, code); return t ? cat.items.find((i) => String(i.Id) === String(t.itemId)) || null : null; };
    const cutName = cust.name || customerText;
    if (this.cutsOf) { // no quantity written: the cut quantity of this customer and code is proposed (a guess)
      for (const e of entries) {
        const c0 = e.cands?.[0];
        if (c0 && (c0.qty === null || c0.qty === undefined) && !c0.qtyGuess) { const t = cutTotal(this.cutsOf(cutName, [c0.item])); if (t) { c0.qty = t.qty; c0.qtyGuess = { unit: t.unit, at: t.at }; } }
      }
    }
    const { lines, stops } = resolveEntriesGuess(entries, { items: cat.items, history, taught });
    for (const l of lines) { // the owner's choice of another item for a line
      const pick = overrides.items?.[l.n];
      const alt = pick ? cat.items.find((i) => String(i.Id) === String(pick)) : null;
      if (alt) { l.item = alt; l.via = 'chosen'; l.guess = null; l.chosen = true; }
    }
    problems.items.push(...stops);
    const warnings = []; const out = [];
    for (const l of lines) {
      const listed = Number(l.item.UnitPrice) > 0 ? Number(l.item.UnitPrice) : null; // no price in QuickBooks (or zero) = no price to default to
      const price = l.price ?? listed;
      if (price === null || Number.isNaN(price)) { problems.items.push(`سطر ${fa(l.n)}: برای کالای «${l.item.Name}» در کوییک‌بوکس قیمتی نیست؛ قیمت را در همان سطر بنویسید.`); continue; }
      const amount = fils(l.qty * price);
      const w = []; const fl = []; // [fl]: the same warnings, one short English line each (the short preview)
      if (listed !== null && l.price !== null && l.price < listed - 0.005) w.push(`قیمت کمتر از قیمت کوییک‌بوکس (${listed})`);
      if (listed !== null && l.price !== null && l.price > listed + 0.005) w.push(`قیمت شما ${l.price} است و قیمت کوییک‌بوکس ${listed}؛ قیمت شما می‌ماند`); // a note, not a stop
      if (this.stockOf && l.typed && /^[\w\-./ ]{1,30}$/.test(l.typed)) { // the free stock beside the line: a warning, never a stop, and nothing is reported to anyone
        try {
          const st = await this.stockOf(l.typed);
          if (st && Number.isFinite(st.free) && st.free < l.qty) { w.push(`موجودی از شیت زیناکس — کد ${fa(l.typed)}: آزاد ${fa(st.free).replace(".", "٫")} ${st.unit === 'm' || !st.unit ? 'متر' : st.unit}، کمتر از ${fa(l.qty)}`); fl.push(`stock ${st.free} ${st.unit === 'm' || !st.unit ? 'm' : st.unit} < ${l.qty}`); }
        } catch { /* the stock sheet did not answer: no warning */ }
      }
      let cutInfo = null;
      if (this.cutsOf) { // the final cut of this customer and code, read from what the cutting group posted (read only)
        const codes = [l.typed, String(l.item.Sku || '').replace(/^(?:PVC|EDGE\d*)-/i, ''), String(l.item.Name || '').replace(/^.*?(\d{3,5})$/, '$1')];
        cutInfo = cutTotal(this.cutsOf(cutName, codes));
        const u = cutInfo ? (cutInfo.unit === 'm' ? 'متر' : cutInfo.unit === 'roll' ? 'رول' : cutInfo.unit) : '';
        if (cutInfo && !l.qtyGuess && Math.abs(cutInfo.qty - l.qty) > 0.001) w.push(`درخواست ${faDigits(l.qty)} ${u}، برش ثبت‌شده ${faDigits(cutInfo.qty)} ${u}`);
        if (!cutInfo) w.push('برشی ثبت نشده');
      }
      const code = l.item.Sku || l.item.Name;
      const pb = this.book?.priceOf?.(code, cust.ours, this.today());
      if (pb && pb.price !== undefined && price < Number(pb.price) - 0.005) { w.push(`قیمت کمتر از فهرست قیمت مالک (${pb.price})`); fl.push(`price is below the owner's price list (${pb.price})`); }
      if (w.length) warnings.push(`سطر ${fa(l.n)} (${l.item.Name}): ${w.join('، ')}`);
      out.push({ itemId: String(l.item.Id), name: l.item.Name, sku: l.item.Sku || '', description: String(l.item.Description || '').slice(0, 4000), qty: l.qty, price, amount, via: l.via, typed: l.typed || '', n: l.n, chosen: !!l.chosen, cut: cutInfo, qtyGuess: !!l.qtyGuess, flags: fl, override: (l.price !== null && listed !== null && Math.abs(l.price - listed) > 0.005) ? { system: listed } : null });
      if (l.guess) guesses.lines.push({ n: l.n, typed: l.typed, reason: l.guess.reason, alts: l.guess.alts.map((a) => ({ itemId: String(a.Id), name: a.Name, price: Number(a.UnitPrice) || 0 })) });
    }
    let tax = null;
    if (cust.id) {
      const picked = overrides.tax ? cat.codes.get(String(overrides.tax)) : null;
      tax = picked ? { ...picked, source: 'chosen' } : await this.taxFor(cust, cat, recent, lines.map((l) => l.item));
      if (tax.error) {
        const g = tax.guessable ? this.taxGuess(cat, recent, lines.map((l) => l.item)) : null;
        if (g) { guesses.tax = { reason: g.reason, alts: g.alts.map((a) => ({ id: String(a.id), name: a.name, rate: a.rate })) }; tax = g; } else problems.tax = tax.error;
      }
    } else problems.tax = 'کد مالیات بعد از مشخص شدن مشتری بررسی می‌شود.';
    // the company numbers invoices by hand: the next number of the office's own pattern (an invoice is never made without one)
    const docNumber = ''; // the preview reserves NO number: QuickBooks gives it when the invoice is created (a cancelled preview leaves no gap)
    const rec = cust.id ? await this.customerRecord(cust.id) : null;
    // every stop in ONE reply: customer, items, tax
    const parts = [];
    if (problems.customer) parts.push(`مشتری:\n${problems.customer}`);
    if (problems.items.length) parts.push(`کالاها:\n${problems.items.join('\n')}`);
    if (problems.number) parts.push(`شمارهٔ فاکتور:\n${problems.number}`);
    const taxReal = !!problems.tax && !!cust.id;
    if (problems.tax && !taxReal) parts.push(`مالیات:\n${problems.tax}`);
    if (taxReal && requester === 'owner') parts.push(`مالیات:\n${problems.tax}`);
    if (parts.length && out.length) parts.push(`کالاهای فهمیده‌شده (تا اینجا درست است):\n${out.map((l, i) => `${fa(i + 1)}. ${l.name} × ${l.qty} @ ${l.price}${l.via === 'name' && l.typed ? ` («${l.typed}» را همین کالا گرفتم)` : ''}`).join('\n')}${warnings.length ? `\n${warnings.join('\n')}` : ''}`);
    if (parts.length || (taxReal && requester !== 'owner')) {
      const message = `فاکتور ساخته نمی‌شود؛ این‌ها را درست کنید:\n${parts.join('\n\n')}`;
      if (taxReal && requester !== 'owner') {
        // an authorized person cannot choose the tax code: the owner is told what was found, the person what he can fix
        const fixable = [problems.customer && `مشتری: ${problems.customer}`, ...problems.items].filter(Boolean);
        return { requester: fixable.length ? `${message}\n\nمالیات: مالک باید کد را انتخاب کند و به او خبر داده شد.` : 'The tax code for this customer must be chosen by the owner first; he has been told. Please ask again afterwards.', owner: `درخواست فاکتور برای «${cust.name}» (از شمارهٔ ${requester}) متوقف شد.\n${problems.tax}` };
      }
      return stop(message);
    }
    const t = totals(out, tax.rate);
    const id = reuseId || this.store.nextId();
    if (tax.source === 'invoices' && tax.others?.length) warnings.push(`در فاکتورهای قبلی این مشتری چند سطر کد دیگری داشت: ${tax.others.map((x) => `${x.name} (${x.n} سطر)`).join('، ')}`);
    const preview = {
      id, nonce: randomBytes(5).toString('hex'), at: this.now(), status: 'pending', requester, customer: { ours: cust.ours, id: cust.id, name: cust.name, from: cust.loose ? cust.typed : '' },
      docNumber, customTxn: cat.customTxn, termId: rec?.SalesTermRef?.value ? String(rec.SalesTermRef.value) : '', billEmail: rec?.PrimaryEmailAddr?.Address || '',
      lines: out, tax: { id: tax.id, name: tax.name, rate: tax.rate, source: tax.source, n: tax.n, total: tax.total, reason: tax.reason || '' }, ...t, currency: cat.currency, warnings,
      guesses: (guesses.customer || guesses.lines.length || guesses.tax) ? guesses : null,
      // what the owner's yes will remember, so that the next time it is exact and not a guess
      aliases: { customer: (cust.guessed || cust.chosen) ? { text: customerText, id: cust.id, name: cust.name } : null, items: out.filter((l) => (l.via === 'guess' || l.chosen) && l.typed).map((l) => ({ typed: l.typed, itemId: l.itemId, name: l.name })) },
      cross: this.crossOf ? this.crossOf(cutName, out.map((l) => ({ code: l.typed, sku: l.sku, name: l.name, qty: l.qty })), await this.customerInvoiceLines(cust.id, cat), { test }) : null, // against the cutting group: warnings only
      req: { customerText, entries, overrides, po },
      ...(po ? { po } : {}),
      ...(origin ? { origin } : {}), // the chat the request came from: the PDF goes back there
      ...(test ? { test: true } : {}), // made in the test group: its yes only SIMULATES
      ...(batch ? { batch } : {}),
    };
    this.store.add(preview);
    this.audit.add({ event: 'preview', requester, previewId: id, total: t.total, ...(preview.guesses ? { guessed: true } : {}) });
    return { requester: `Your invoice request #${id} for ${cust.name} was sent to the owner for approval (total ${money(t.total)}). You will be told when it is created or refused.`, owner: this.previewText(preview) };
  }

  /** "کد 1810 = PVC 1810 [مشتری X]": the owner teaches which item a code means (for one customer, else for everybody). */
  async setItemCode({ code, item, customer }) {
    const guard = this.guard();
    if (guard) return [guard];
    const cat = await this.catalog();
    const found = itemsNamed(cat.items, item);
    if (found.length !== 1) return [found.length ? `نام «${item}» در کوییک‌بوکس برای بیش از یک کالا است؛ دقیق‌تر بنویسید.` : `کالای «${item}» در کوییک‌بوکس دقیقاً پیدا نشد. نام کامل کالا را بنویسید.${closeItems(cat.items, item).length ? ` نزدیک‌ها: ${closeItems(cat.items, item).join(' | ')}` : ''}`];
    let custId = '';
    let custName = '';
    if (customer) {
      const c = await this.desk.resolveLoose(customer);
      if (!c.id) return [`مشتری «${customer}» یکتا پیدا نشد؛ نام کامل‌تر بنویسید.${c.candidates ? ` ${c.candidates.join(' | ')}` : ''}`];
      custId = c.id; custName = c.name;
    }
    this.itemCodes.set(custId, code, found[0], this.now());
    this.audit.add({ event: 'item-code', approver: 'owner', reason: `${custId || '*'}:${nameKey(code)}=${found[0].Id}` });
    return [`ثبت شد: کد «${code}» = ${itemLabel(found[0])}${custName ? ` برای مشتری ${custName}` : ' برای همهٔ مشتری‌ها'}. در پیش‌نمایش‌های بعدی نشان داده می‌شود.`];
  }

  /** The preview the owner reads: SHORT in English (a few lines, the problems that matter one line each); the full old text on «details #Q14». */
  previewText(p) { return isEnglishOut() ? this.previewShort(p) : this.previewFull(p); }

  previewShort(p) {
    const code = (l) => String(l.typed || '').trim() || (/\d{2,}/.exec(l.sku || l.name) || [''])[0];
    const named = (l) => { const k = code(l); if (!k) return l.name; const i = l.name.toLowerCase().indexOf(k.toLowerCase()); if (i < 0) return `${l.name} *${k}*`;
      const before = l.name.slice(0, i); const after = l.name.slice(i + k.length);
      // WhatsApp shows *bold* only when the opening asterisk follows a space (or the start) and the closing one a space (or the end): a name that glues the code gets a space
      return `${before}${before && !/\s$/.test(before) ? ' ' : ''}*${l.name.slice(i, i + k.length)}*${after && !/^[\s.,;:)]/.test(after) ? ' ' : ''}${after}`; };
    const many = p.lines.length > 1;
    const flags = [];
    if (p.guesses?.customer) flags.push(`⚠ guess: ${p.guesses.customer.text} → ${p.customer.name}`);
    for (const l of p.lines) {
      if (l.via === 'guess' && l.typed) flags.push(`⚠ guess: ${l.typed} → ${l.name}`);
      if (l.qtyGuess) flags.push(`⚠ ${many ? `${code(l)}: ` : ''}quantity guessed from the cut`);
      for (const f of l.flags || []) flags.push(`⚠ ${many ? `${code(l)}: ` : ''}${f}`);
    }
    if (p.guesses?.tax) flags.push(`⚠ guess: tax code ${p.tax.name}`);
    const open = this.openIds();
    const answer = open.length > 1 ? `Yes #${p.id} / No #${p.id}` : 'Yes/No';
    return [
      `*Invoice* #${p.id}`,
      `Customer: *${p.customer.name}*`,
      ...(p.po ? [`PO: *${p.po}*`] : []),
      ...p.lines.map((l, i) => `${i + 1}. ${named(l)} (${l.qty} ×${l.price} = ${money(l.amount)})${l.override ? ` ✎ your price (system ${Number(l.override.system).toFixed(2)})` : ''}`),
      `Total: *${money(p.total)}${p.currency ? ` ${p.currency}` : ''}*`,
      ...(p.cross?.problems?.length ? ['Cross-check (Aryak Orders):', ...p.cross.problems.map((x) => `⚠ ${x}`), ...(p.cross.more ? [`+${p.cross.more} more`] : [])] : []), // nothing at all when everything matches
      ...flags,
      answer,
    ].join('\n');
  }

  /** The differences between two invoice records (the office's, ours or the body we would send), one line each. Pure. */
  static diffInvoices(x, y, { skipExtra = [], skipLine = [] } = {}) {
    const skip = new Set(['Id', 'SyncToken', 'MetaData', 'DocNumber', 'TxnDate', 'CustomerRef', 'TotalAmt', 'HomeTotalAmt', 'Balance', 'HomeBalance', 'Deposit', 'Line', 'TxnTaxDetail', 'LinkedTxn', 'domain', 'sparse', 'DueDate', 'TxnStatus', 'InvoiceLink', ...skipExtra]);
    const show = (v) => { const t = typeof v === 'string' ? v : JSON.stringify(v); return t === undefined ? '(missing)' : t.length > 110 ? `${t.slice(0, 110)}…` : t; };
    const out = [];
    const empty = (v) => v === undefined || v === null || (Array.isArray(v) && !v.length);
    for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
      if (skip.has(k) || (empty(x[k]) && empty(y[k]))) continue;
      if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push(`${k}: ${show(x[k])} | ${show(y[k])}${k === 'PrivateNote' ? '   (intended: ours is "Atossa Qn")' : ''}`);
    }
    if (JSON.stringify(x.TxnTaxDetail?.TxnTaxCodeRef) !== JSON.stringify(y.TxnTaxDetail?.TxnTaxCodeRef)) out.push(`TxnTaxDetail.TxnTaxCodeRef: ${show(x.TxnTaxDetail?.TxnTaxCodeRef)} | ${show(y.TxnTaxDetail?.TxnTaxCodeRef)}`);
    const items = (inv) => (inv.Line || []).filter((l) => l.DetailType === 'SalesItemLineDetail');
    const lx = items(x); const ly = items(y);
    if (lx.length !== ly.length) out.push(`item lines: ${lx.length} | ${ly.length}`);
    for (let i = 0; i < Math.min(lx.length, ly.length); i++) {
      const keys = (l) => new Set([...Object.keys(l), ...Object.keys(l.SalesItemLineDetail || {}).map((k) => `SalesItemLineDetail.${k}`)]);
      const kx = keys(lx[i]); const ky = keys(ly[i]);
      for (const k of [...new Set([...kx, ...ky])].sort()) if (!skipLine.includes(k) && kx.has(k) !== ky.has(k)) out.push(`line ${i + 1} field ${k}: ${kx.has(k) ? 'present' : 'missing'} | ${ky.has(k) ? 'present' : 'missing'}`);
      for (const k of ['TaxCodeRef', 'ServiceDate', 'ClassRef']) {
        const vx = lx[i].SalesItemLineDetail?.[k]; const vy = ly[i].SalesItemLineDetail?.[k];
        if (kx.has(`SalesItemLineDetail.${k}`) && ky.has(`SalesItemLineDetail.${k}`) && JSON.stringify(vx) !== JSON.stringify(vy)) out.push(`line ${i + 1} ${k}: ${show(vx)} | ${show(vy)}`);
      }
    }
    return out;
  }

  /** Lines cut into messages that WhatsApp does not cut (about a thousand characters each at most). */
  static pages(lines, head) {
    const pages = []; let cur = [head];
    for (const line of lines) { if (cur.join('\n').length + line.length > 1200) { pages.push(cur.join('\n')); cur = []; } cur.push(line); }
    pages.push(cur.join('\n'));
    return pages;
  }

  /**
   * «compare invoices inv-9982 inv-9983»: what differs between two invoices field by field (the office's own, made on the screen, against ours). Read only, shown only
   * to the owner, never stored. Returns messages (several when long). The only intended difference is our private note.
   */
  async compareInvoices(a, b) {
    const get = async (n) => (await this.qbo.query(`select * from Invoice where DocNumber = '${qboEscape(n)}'`))[0] || null;
    const [x, y] = [await get(a), await get(b)];
    if (!x || !y) return [`Not found in QuickBooks: ${[!x && a, !y && b].filter(Boolean).join(', ')}`];
    const lines = QboInvoiceDesk.diffInvoices(x, y);
    return lines.length ? QboInvoiceDesk.pages(lines, `Comparing ${a} (first) with ${b} (second): ${lines.length} difference(s)`) : [`Comparing ${a} with ${b}: no difference in the compared fields.`];
  }

  /**
   * «invoice dry run Q16 inv-9982»: builds the EXACT body that «yes #Q16» would send (the same defaults, read now) and compares it field by field with a given office
   * invoice. Nothing is created and no number is taken. Fields QuickBooks fills in itself (totals, due date, ids) are not compared.
   */
  async dryRun(id, againstNumber) {
    const p = this.store.get(id);
    if (!p) return [`Preview ${id} was not found.`];
    const office = (await this.qbo.query(`select * from Invoice where DocNumber = '${qboEscape(againstNumber)}'`))[0] || null;
    if (!office) return [`Not found in QuickBooks: ${againstNumber}`];
    const defaults = await this.salesDefaults(p.customer.id);
    const body = this.invoiceBody(p, defaults); // no DocNumber: the number is chosen only at a real create
    const lines = QboInvoiceDesk.diffInvoices(office, body, { skipExtra: HARMLESS, skipLine: HARMLESS_LINE });
    const head = `Dry run of ${id} against ${againstNumber} (nothing created, no number taken): ${lines.length} difference(s). Left = ${againstNumber}, right = what ${id} would send; "(missing)" on the right = not sent.`;
    return lines.length ? QboInvoiceDesk.pages(lines, head) : [`Dry run of ${id} against ${againstNumber} (nothing created, no number taken): the body matches in every compared field.`];
  }

  /**
   * The yes of a preview made in the TEST group: the exact body is built (the same defaults, read now) and described; NOTHING is written to QuickBooks and no number is taken.
   */
  async simulate(p) {
    const defaults = await this.salesDefaults(p.customer.id);
    const body = this.invoiceBody(p, defaults);
    const next = p.customTxn ? (await this.nextDocNumber(p.id).catch(() => ({}))).docNumber : '';
    p.status = 'simulated'; this.store.save();
    this.audit.add({ event: 'simulated', previewId: p.id });
    const set = (k) => (k in body ? 'yes' : 'no');
    return [[
      `SIMULATION: would create an invoice for ${p.customer.name} — nothing was created in QuickBooks and no number was taken.`,
      ...body.Line.map((l, i) => `${i + 1}. ${p.lines[i].name} ×${l.SalesItemLineDetail.Qty} @ ${l.SalesItemLineDetail.UnitPrice} = ${Number(l.Amount).toFixed(2)}`),
      `Total ${money(p.total)}${p.currency ? ` ${p.currency}` : ''} (tax ${p.tax.name}, ${p.tax.rate}%)`,
      `Number: ${next ? `would be ${next} (read now, not taken)` : 'assigned by QuickBooks when created'}`,
      `Would send: terms ${body.SalesTermRef ? body.SalesTermRef.value : 'none'}; message on invoice ${body.CustomerMemo ? `${body.CustomerMemo.value.length} characters` : 'none'}; bill-to ${set('BillAddr')}; ship-to ${set('ShipAddr')}; currency ${set('CurrencyRef')}; place of supply ${body.TransactionLocationType || 'none'}; online payment switches ${set('AllowOnlinePayment')}; print status ${body.PrintStatus || 'default'}`,
    ].join('\n')];
  }

  /** «details #Q14»: the full old preview. */
  previewDetails(id) { const p = this.store.get(id); return p ? this.previewFull(p) : `Preview ${id} was not found.`; }

  previewFull(p) {
    const who = p.requester === 'owner' ? 'خودتان' : `شمارهٔ ${p.requester}`;
    return [
      `پیش‌نمایش فاکتور #${p.id} (درخواست از ${who}) — هنوز چیزی در کوییک‌بوکس ساخته نشده`,
      p.guesses?.customer ? `مشتری: ${p.customer.name} (حدس از «${p.guesses.customer.text}»: ${p.guesses.customer.reason})` : `مشتری: ${p.customer.name}${p.customer.from ? ` (از «${p.customer.from}»)` : ''}`,
      ...(p.guesses?.customer?.alts?.length ? [...p.guesses.customer.alts.map((a, i) => `   ${fa(i + 1)}) ${a.label || a.name}`), '   (برای تغییر: «مشتری ۱» و …)'] : []),
      'شمارهٔ فاکتور: هنگام ساخت را کوییک‌بوکس می‌دهد',
      ...(p.po ? [`شمارهٔ سفارش مشتری: ${fa(p.po)}`] : []),
      ...p.lines.flatMap((l, i) => [`${fa(i + 1)}. ${l.name}${l.sku && norm(l.sku) !== norm(l.name) ? ` [${l.sku}]` : ''} × ${l.qty}${l.qtyGuess ? ' (حدس از برش)' : ''} @ ${l.price} = ${money(l.amount)}${l.via === 'history' ? ' (از خریدهای قبلی مشتری)' : l.via === 'taught' ? ' (کد آموخته‌شدهٔ مالک)' : l.via === 'name' && l.typed ? ` («${l.typed}» را همین کالا گرفتم)` : l.via === 'guess' && l.typed ? ` («${l.typed}» ← ${l.name} (حدس: ${(p.guesses?.lines || []).find((g) => g.n === l.n)?.reason || 'نزدیک‌ترین'}))` : l.via === 'chosen' ? ' (انتخاب شما)' : ''}`,
        ...(l.cut ? [`   ${cutLine(l.cut, { label: this.cutLabel })}`] : []),
        ...((p.guesses?.lines || []).find((g) => g.n === l.n)?.alts || []).map((a, k) => `   ${fa(k + 1)}) ${a.name} — قیمت ${a.price || 'ندارد'}${k === 0 ? `   (برای تغییر: «سطر ${fa(l.n)} = ${fa(k + 1)}»)` : ''}`)]),
      `جمع قبل از مالیات: ${money(p.subtotal)}`,
      p.tax.source === 'invoices' ? `مالیات: ${p.tax.name} ${p.tax.rate}٪ (از ${fa(p.tax.n)} سطر از ${fa(p.tax.total)} سطر فاکتورهای قبلی): ${money(p.vat)}` : `مالیات ${p.tax.rate}٪ (${p.tax.name}${p.tax.source === 'owner' ? '، انتخاب مالک' : p.tax.source === 'item' ? '، کد خود کالا' : p.tax.source === 'override' ? '، تنظیم مالک' : ''}): ${money(p.vat)}`,
      ...(p.guesses?.tax ? [`   مالیات حدس است (${p.guesses.tax.reason})${p.guesses.tax.alts.length ? '؛ دیگر کدها:' : ''}`, ...p.guesses.tax.alts.map((a, i) => `   ${fa(i + 1)}) ${a.name} (${a.rate}٪)${i === 0 ? '   (برای تغییر: «مالیات ۱»)' : ''}`)] : []),
      `جمع کل: ${money(p.total)}${p.currency ? ` ${p.currency}` : ''}`,
      ...(p.warnings.length ? ['⚠️ هشدارها:', ...p.warnings.map((w) => `• ${w}`)] : []),
      ...(p.guesses ? ['🔶 مواردی که «حدس» نوشته شده تا «بله» شما اعمال نمی‌شود؛ با «بله» همان حدس‌ها پذیرفته و یاد گرفته می‌شود.'] : []),
      `برای ساخت: «بله #${p.id}» — برای لغو: «نه #${p.id}» (۲۴ ساعت اعتبار)`,
    ].join('\n');
  }

  /**
   * «مشتری ۲»، «سطر ۱ = ۳»، «مالیات ۲»: another alternative for one guess of an open preview. The preview is rebuilt under the same number and shown again;
   * nothing is created. [id]: a preview number, or the newest open one that holds guesses.
   */
  async adjust({ what, n = 0, pick, id = '' }) {
    const guard = this.guard();
    if (guard) return [guard];
    const p = id ? this.store.get(id) : Object.values(this.store.d.previews).filter((x) => x.status === 'pending' && x.guesses && this.now() - x.at <= EXPIRY_MS).sort((a, b) => b.at - a.at)[0];
    if (!p || p.status !== 'pending' || !p.guesses || !p.req) return ['پیش‌نمایشی با حدس باز نیست که چیزی در آن عوض شود.'];
    const g = p.guesses;
    const ov = JSON.parse(JSON.stringify(p.req.overrides || {}));
    if (what === 'customer') {
      const alt = g.customer?.alts?.[pick - 1];
      if (!alt) return [`برای مشتری گزینهٔ ${fa(pick)} نیست.`];
      ov.customer = { id: alt.id, name: alt.name };
    } else if (what === 'line') {
      const entry = g.lines.find((x) => x.n === n);
      const alt = entry?.alts?.[pick - 1];
      if (!alt) return [`برای سطر ${fa(n)} گزینهٔ ${fa(pick)} نیست.`];
      ov.items = { ...(ov.items || {}), [n]: alt.itemId };
    } else {
      const alt = g.tax?.alts?.[pick - 1];
      if (!alt) return [`برای مالیات گزینهٔ ${fa(pick)} نیست.`];
      ov.tax = alt.id;
    }
    const stop = (msg) => ({ requester: msg, owner: null });
    const r = await this.makePreview({ customerText: p.req.customerText, entries: p.req.entries, requester: p.requester, stop, overrides: ov, reuseId: p.id, po: p.req.po || p.po || "", origin: p.origin || null, test: !!p.test });
    return [r.owner || r.requester];
  }

  /** What the owner's yes teaches: the customer text and the item texts he accepted become exact next time. */
  rememberGuesses(p) {
    try {
      const a = p.aliases || {};
      if (a.customer?.id) this.desk.map.set(a.customer.text, a.customer.id, a.customer.name, 'owner');
      for (const it of a.items || []) this.itemCodes.set('', it.typed, { Id: it.itemId, Name: it.name }, this.now());
      if ((a.customer || (a.items || []).length)) this.audit.add({ event: 'alias', approver: 'owner', previewId: p.id });
    } catch (e) { this.log(`aliases could not be saved: ${e.message}`); }
  }

  /** The owner's answer in his own chat. Returns the lines to tell him. */
  async decide({ verb, id, decidedIn = '' }) {
    const p = this.store.get(id);
    if (!p) return [`پیش‌نمایش ${id} پیدا نشد.`];
    if (verb === 'no') {
      if (p.status === 'created') return [`فاکتور ${p.id} پیش‌تر ساخته شده است (شمارهٔ ${p.qbo?.docNumber}). لغو آن از اینجا ممکن نیست.`];
      p.status = 'cancelled'; this.store.save(); this.audit.add({ event: 'cancel', previewId: p.id, approver: 'owner' });
      return [`پیش‌نمایش ${p.id} لغو شد. چیزی ساخته نشد.`];
    }
    if (p.status === 'created') return [`فاکتور ${p.id} پیش‌تر ساخته شده است: شمارهٔ ${p.qbo.docNumber}، جمع ${money(p.qbo.total)}. دوباره ساخته نشد.`];
    if (p.status === 'cancelled') return [`پیش‌نمایش ${p.id} لغو شده بود.`];
    if (p.status === 'expired' || this.now() - p.at > EXPIRY_MS) {
      if (p.status !== 'expired') { p.status = 'expired'; this.store.save(); this.audit.add({ event: 'expire', previewId: p.id }); }
      return [`پیش‌نمایش ${p.id} بیش از ۲۴ ساعت پیش است و منقضی شد. دوباره درخواست کنید.`];
    }
    if (p.test) return this.simulate(p); // made in the test group: nothing is created and no number is taken
    const blocked = this.guard();
    if (blocked) { this.audit.add({ event: 'refuse', previewId: p.id, reason: 'guard' }); return [blocked]; }
    if (!this.qbo.writeOn) { this.audit.add({ event: 'refuse', previewId: p.id, reason: 'write-off' }); return ['نوشتن در کوییک‌بوکس خاموش است؛ فاکتور ساخته نشد. پیش‌نمایش می‌ماند.']; }
    const c = this.store.counts(this.now());
    if (c.hour >= CAP_HOUR || c.day >= CAP_DAY) { this.audit.add({ event: 'refuse', previewId: p.id, reason: 'cap' }); return [`سقف ساخت فاکتور پر است (${fa(CAP_HOUR)} در ساعت، ${fa(CAP_DAY)} در روز). بعداً دوباره «بله #${p.id}» بنویسید.`]; }
    if (this.inflight.has(p.id)) return [`فاکتور ${p.id} همین حالا در حال ساخته شدن است؛ چند لحظه صبر کنید.`];
    // The number is QuickBooks' own: with custom numbers OFF it is simply left out (QuickBooks assigns it); with them ON (the API cannot ask for the next one) the next
    // number after the latest invoice is read at this moment, exactly what the QuickBooks screen proposes. A retry of the same preview keeps the number it chose.
    if (p.customTxn && !(p.attempted && p.docNumber)) { // a number chosen by an earlier attempt of THIS preview (a lost answer) is kept; any other is read from QuickBooks now
      const n = await this.nextDocNumber(p.id).catch(() => ({ error: 'x' }));
      if (!n.docNumber) { this.audit.add({ event: 'refuse', previewId: p.id, reason: 'no-number' }); return [`شمارهٔ بعدی فاکتور را از کوییک‌بوکس نتوانستم بخوانم؛ ساخته نشد. کمی بعد دوباره «بله #${p.id}» بنویسید.`]; }
      p.docNumber = n.docNumber; p.attempted = true; this.store.save();
    }
    // the attempt is counted and remembered BEFORE the call; the request id belongs to the preview, so a retry returns the same invoice
    p.status = 'creating'; this.store.recordCreate(this.now()); this.store.save();
    this.inflight.add(p.id);
    const body = this.invoiceBody(p, await this.salesDefaults(p.customer.id));
    let created; let dropped = [];
    const attempt = async (payload, suffix) => {
      const j = await this.qbo.write('POST', 'invoice', payload, { requestId: `atossa-${p.id}-${p.nonce}${suffix}` });
      created = j?.Invoice;
      if (!created?.Id) throw new Error('no invoice in the answer');
    };
    try {
      try { await attempt(body, ''); } catch (e1) {
        const optional = OPTIONAL_PARITY.filter((k) => k in body);
        if (e1.status !== 400 || !optional.length) throw e1; // only a refusal (400), which creates nothing; never a network error or a 5xx
        this.log(`QuickBooks refused the invoice (400): ${JSON.stringify(e1.fault || {})}; trying once without ${optional.join(', ')}`);
        this.audit.add({ event: 'refused-400', previewId: p.id, fault: e1.fault || null, dropping: optional });
        const lean = { ...body }; for (const k of optional) delete lean[k];
        await attempt(lean, '-lean'); dropped = optional;
      }
    } catch (e) {
      p.status = 'pending'; this.inflight.delete(p.id); if (e.status >= 400 && e.status < 500) { p.docNumber = ''; p.attempted = false; } this.store.save(); // a refusal of the number is not repeated; a lost answer keeps it (same request, same invoice)
      this.audit.add({ event: 'failed', previewId: p.id, approver: 'owner', status: e.status || 0, fault: e.fault || null });
      this.log(`QuickBooks invoice create failed: ${e.name} ${e.status || ''} ${JSON.stringify(e.fault || {})}`);
      return [`ساخت فاکتور نشد: ${e.message}. پیش‌نمایش می‌ماند؛ همان «بله #${p.id}» دوباره امن است (دو فاکتور ساخته نمی‌شود).`];
    }
    this.inflight.delete(p.id);
    p.status = 'created';
    this.rememberGuesses(p);
    try { const refs = p.lines.flatMap((l) => l.cut?.refs || []); if (refs.length && this.markCuts) this.markCuts(refs, created.DocNumber || p.docNumber || ''); } catch (e) { this.log(`cuts could not be marked: ${e.message}`); }
    p.qbo = { id: String(created.Id), docNumber: created.DocNumber || '', total: fils(created.TotalAmt) };
    this.store.save();
    this.audit.add({ event: 'create', requester: p.requester, approver: 'owner', previewId: p.id, qboId: p.qbo.id, docNumber: p.qbo.docNumber, total: p.qbo.total });
    if (dropped.length) this.audit.add({ event: 'created-lean', previewId: p.id, dropped });
    const okParts = isEnglishOut() ? [`*Invoice* ${p.qbo.docNumber || '(no number)'} — *${p.customer.name}* — *${money(p.qbo.total)}${p.currency ? ` ${p.currency}` : ''}*`] : [`فاکتور ${p.id} در کوییک‌بوکس ساخته شد: شمارهٔ ${p.qbo.docNumber || '(بی‌شماره)'}، جمع ${money(p.qbo.total)}${p.currency ? ` ${p.currency}` : ''}.`];
    const out = []; // the PDF with its caption is the result; the text line below is only for the case that no PDF could be sent
    let posted = 0;
    if (dropped.length) out.push(`Note: QuickBooks refused some optional fields (${dropped.join(', ')}); the invoice was created without them.`);
    // read it back and compare the total with the preview
    try {
      const back = (await this.qbo.get(`invoice/${encodeURIComponent(p.qbo.id)}`))?.Invoice;
      if (back && fils(back.TotalAmt) !== p.total) out.push(`⚠️ جمع کوییک‌بوکس (${money(fils(back.TotalAmt))}) با پیش‌نمایش (${money(p.total)}) نمی‌خواند؛ فاکتور را در کوییک‌بوکس ببینید.`);
    } catch (e) { out.push('خواندن دوبارهٔ فاکتور برای مقایسه نشد.'); }
    // the PDF from QuickBooks to the owner's own chat and to the test group; never to a customer
    try {
      const pdf = await this.qbo.getBinary(`invoice/${encodeURIComponent(p.qbo.id)}/pdf`);
      const caption = `Invoice ${p.qbo.docNumber} - ${p.customer.name} - total ${money(p.qbo.total)}${p.currency ? ` ${p.currency}` : ''}`;
      const fileName = `invoice-${String(p.qbo.docNumber || p.qbo.id).replace(/[^\w.-]+/g, '_')}.pdf`;
      if (this.targets) { // the chat of the request, the chat of the yes, and the owner's copy when somebody else asked (never a customer group)
        for (const jid of await this.targets(p, decidedIn)) { await this.post(jid, pdf, fileName, caption); posted += 1; }
      } else {
        await this.post(this.ownerJid(), pdf, fileName, caption); posted += 1;
        const tg = this.testGroup(await this.groups());
        if (tg) { await this.post(tg.id, pdf, fileName, caption); posted += 1; } else out.push('گروه آزمایشی پیدا نشد؛ پی‌دی‌اف فقط به گفتگوی خودتان رفت.');
      }
    } catch (e) { out.push('پی‌دی‌اف فاکتور از کوییک‌بوکس گرفته یا فرستاده نشد؛ فاکتور ساخته شده است.'); }
    if (!posted) out.unshift(...okParts); // no PDF went out: the result is said in text, never silent
    return out;
  }

  invoiceBody(p, defaults = {}) {
    const memo = [p.po ? `PO ${p.po}` : '', defaults.memo || ''].filter(Boolean).join('\n\n'); // the customer's PO number first, then the company's message
    const cu = defaults.customer || null; // the customer's record, read now
    const terms = cu?.SalesTermRef?.value ? String(cu.SalesTermRef.value) : (p.termId || defaults.terms || ''); // the customer's own terms, else the company default
    const addr = (a) => { // a PhysicalAddress holds only these (no record id, no coordinates, no FreeFormAddress flag: that one is read-only)
      if (!a || typeof a !== 'object') return null;
      const keep = Object.fromEntries(PHYSICAL_ADDRESS.map((k) => [k, String(a[k] || '').trim()]).filter(([, v]) => v));
      return Object.keys(keep).length ? keep : null;
    };
    const phone = String(cu?.PrimaryPhone?.FreeFormNumber || cu?.Mobile?.FreeFormNumber || '').trim();
    const raw = cu?.BillAddr || {};
    const billLines = [cu?.DisplayName || cu?.CompanyName || '', phone, ...['Line1', 'Line2', 'Line3', 'Line4', 'Line5'].map((k) => String(raw[k] || '').trim()), String(raw.City || '').trim()]
      .map((x) => String(x || '').trim()).filter(Boolean).filter((x, i, all) => all.indexOf(x) === i).slice(0, 5); // the screen's block: the name, the phone, then the address lines and the city
    const billAddr = billLines.length ? Object.fromEntries(billLines.map((x, i) => [`Line${i + 1}`, x])) : null;
    const shipAddr = addr(cu?.ShipAddr);
    const email = cu?.PrimaryEmailAddr?.Address || p.billEmail || '';
    return {
      CustomerRef: { value: p.customer.id },
      ...(p.docNumber ? { DocNumber: p.docNumber } : {}),
      TxnDate: this.today(),
      GlobalTaxCalculation: 'TaxExcluded',
      PrivateNote: `Atossa ${p.id}`,
      ...(memo ? { CustomerMemo: { value: memo } } : {}),
      ...(terms ? { SalesTermRef: { value: terms } } : {}),
      ...(defaults.template ? { TemplateRef: { value: defaults.template } } : {}),
      ...(email ? { BillEmail: { Address: email } } : {}),
      ...(billAddr ? { BillAddr: billAddr } : {}),
      ...(shipAddr ? { ShipAddr: shipAddr } : {}),
      ...(cu?.CurrencyRef?.value ? { CurrencyRef: cu.CurrencyRef } : {}),
      ...(defaults.flags || {}),
      Line: p.lines.map((l) => ({
        DetailType: 'SalesItemLineDetail',
        Amount: l.amount / 100,
        ...(l.description ? { Description: l.description } : {}),
        SalesItemLineDetail: { ItemRef: { value: l.itemId }, Qty: l.qty, UnitPrice: l.price, TaxCodeRef: { value: p.tax.id } },
      })),
    };
  }

  /** The last [n] audit lines for the owner (no message text). */
  auditText(n = 10) {
    const rows = this.audit.last(n);
    if (!rows.length) return 'هنوز رویدادی در گزارش کوییک‌بوکس نیست.';
    return ['گزارش کوییک‌بوکس (آخرین رویدادها):', ...rows.map((r) => `${r.at.replace('T', ' ').slice(0, 19)} | ${r.event} | ${r.previewId || '-'}${r.requester ? ` | درخواست: ${r.requester}` : ''}${r.approver ? ` | تأیید: ${r.approver}` : ''}${r.docNumber ? ` | شمارهٔ ${r.docNumber}` : ''}${r.qboId ? ` | شناسه ${r.qboId}` : ''}${r.total !== undefined ? ` | جمع ${money(r.total)}` : ''}${r.reason ? ` | ${r.reason}` : ''}`)].join('\n');
  }
}


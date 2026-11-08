// The report texts are written in Persian (the owner reads them in Persian), but the Information group, the Invoices group and
// every colleague except the owner read English. One place turns the program's fixed Persian report sentences into English,
// line by line: a line it knows is translated, a line with no Persian in it is left alone, and an unknown line passes through
// unchanged (a test feeds every report generator through it and fails when a Persian letter is left).

const PERSIAN = /[؀-ۿ]/;

const KIND = {
  'قلم جاافتاده': 'Missing item', 'قلم اضافه': 'Extra item', 'کد اشتباه': 'Wrong code', 'اندازه اشتباه': 'Wrong size', 'مقدار اشتباه': 'Wrong quantity',
  'قیمت اشتباه': 'Wrong price', 'جمع کل اشتباه': 'Wrong total', 'نام مشتری': 'Customer name', ناخوانا: 'Unreadable', 'مبلغ ردیف': 'Line amount',
  'جمع جزء': 'Subtotal', مالیات: 'VAT', 'قیمت کمتر از لیست': 'Price below list', 'قیمت بیشتر از لیست': 'Price above list', 'قیمت چاپ نشده': 'Price not printed',
  'قیمت در لیست نیست': 'Price not in list', 'قیمت‌ها سنجیده نشد': 'Prices not checked', 'واحد قیمت': 'Price unit', 'واحد کالا': 'Item unit', 'واحد پول': 'Currency',
  'شمارهٔ تکراری': 'Duplicate number', 'شمارهٔ جاافتاده': 'Missing number',
  'یادداشت سفارش': 'Order note', 'پوشش با تأمین': 'Covered by sourcing', 'برش بیشتر از فاکتور': 'Cut above the invoice', 'برش کمتر از فاکتور': 'Cut below the invoice',
};

const SOURCE = { 'سفارش فقط از گروه برش شناخته شد': 'order known only from the cut group', 'سفارش ثبت‌شده': 'recorded order' };
const THIS_CUSTOMER = (s) => s.replace('این مشتری', 'this customer');
const YES_NO = (s) => (s === 'بله' ? 'yes' : 'no');
const kinds = Object.keys(KIND).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

/** [pattern, replacement string or function(match)] for a whole line (its list or warning prefix is kept). */
const RULES = [
  // the problem lines of a report: "1. ⚠️ LABEL: item"
  [new RegExp(`^(${kinds}): (.*)$`), (m) => `${KIND[m[1]]}: ${m[2]}`],
  [/^درست: (.+?) \| فاکتور: (.+)$/, 'Correct: $1 | Invoice: $2'],
  [/^درست: (.+)$/, 'Correct: $1'],
  [/^فاکتور: (.+)$/, 'Invoice: $1'],
  // audit notes
  [/^این شماره پیش‌تر هم فرستاده شده است$/, 'This number was already posted'],
  [/^شماره‌های (\d+) فاکتور بین این و فاکتور قبلی دیده نشد$/, '$1 invoice number(s) between this one and the previous invoice were not seen'],
  [/^واحد پول فاکتور باید درهم باشد$/, 'The invoice currency must be dirhams (AED)'],
  [/^مبلغ ردیف با مقدار ضربدر قیمت نمی‌خواند$/, 'The line amount does not equal quantity × price'],
  [/^واحد این ردیف با واحد کالا در برگه موجودی فرق دارد \(مثلاً متر به جای عدد\)$/, 'The unit of this line differs from the item unit in the stock sheet (for example metres instead of pieces)'],
  [/^قیمت (.+) درصد کمتر از لیست است( \(قیمت استثنای مشتری\))?(، فاصله غیرعادی)?$/, (m) => `The price is ${m[1]}% below the list${m[2] ? ' (customer exception price)' : ''}${m[3] ? ', unusually far' : ''}`],
  [/^قیمت (.+) درصد بیشتر از لیست است( \(قیمت استثنای مشتری\))?(، فاصله غیرعادی)?$/, (m) => `The price is ${m[1]}% above the list${m[2] ? ' (customer exception price)' : ''}${m[3] ? ', unusually far' : ''}`],
  [/^واحد قیمت با لیست فرق دارد$/, 'The price unit differs from the list'],
  [/^قیمتی روی این ردیف چاپ نشده است$/, 'No price is printed on this line'],
  [/^قیمت این کد در لیست نیست، سنجیده نشد$/, 'This code has no price in the list; not checked'],
  [/^لیست قیمت بارگذاری نشده است؛ قیمت‌های این فاکتور سنجیده نشد$/, 'No price list is loaded; the prices of this invoice were not checked'],
  [/^جمع ردیف‌ها با جمع جزء فاکتور نمی‌خواند$/, 'The lines do not add up to the invoice subtotal'],
  [/^مالیات (.+) درصدِ داخل جمع کل نمی‌شود$/, 'The $1% VAT inside the total does not match'],
  [/^قیمت‌ها با مالیات است؛ جمع ردیف‌ها باید برابر جمع کل باشد$/, 'Prices include VAT; the lines must add up to the grand total'],
  [/^مالیات (.+) درصد از جمع جزء نمی‌شود$/, 'VAT of $1% on the subtotal does not match'],
  [/^جمع کل با جمع جزء به‌اضافهٔ مالیات نمی‌خواند$/, 'The total does not equal subtotal plus VAT'],
  // the invoice report
  [/^⚠️ بررسی فاکتور انجام نشد$/, '⚠️ The invoice check could not be done'],
  [/^فایل فاکتور: (.*)$/, 'Invoice file: $1'],
  [/^علت: (.*)$/, 'Reason: $1'],
  [/^⚠️ فاکتور یا درخواست خوانا نبود$/, '⚠️ The invoice or the request was not readable'],
  [/^ℹ️ یادداشت دربارهٔ فاکتور \(ایرادی که نیاز به اصلاح فوری داشته باشد نیست\)$/, 'ℹ️ Note about the invoice (nothing that needs urgent correction)'],
  [/^⚠️ فاکتور ایراد دارد$/, '⚠️ The invoice has problems'],
  [/^گروه: (.*)$/, 'Group: $1'],
  [/^مشتری: (.*)$/, 'Customer: $1'],
  [/^شمارهٔ فاکتور: هنگام ساخت را کوییک‌بوکس می‌دهد$/, 'Invoice no.: assigned by QuickBooks when created'],
  [/^شمارهٔ فاکتور: (.*)$/, 'Invoice number: $1'],
  [/^فاکتور را فرستاد: (.*)$/, 'Sent by: $1'],
  [/^⚠️ فاکتور (.*) را اصلاح کنید \((\d+) مورد\) و پیش از اصلاح برای مشتری نفرستید:$/, 'Please correct invoice $1 ($2 point(s)) and do not send it to the customer before it is corrected:'],
  [/^و (\d+) مورد دیگر در گروه اطلاعات$/, 'and $1 more in the Information group'],
  [/^⚠️ سفارش مشتری برای این فاکتور پیدا نشد، بررسی انجام نشد$/, '⚠️ No customer order was found for this invoice; the check was not done'],
  [/^فاکتور: (.*)$/, 'Invoice: $1'],
  [/^فرستاد: (.*)$/, 'Sent by: $1'],
  [/^مشتری روی فاکتور: (.*)$/, 'Customer on the invoice: $1'],
  [/^شمارهٔ سفارش روی فاکتور: (.*)$/, 'Order number on the invoice: $1'],
  [/^چند سفارش با این شماره هست: (.*)$/, 'Several orders have this number: $1'],
  [/^فاکتور(?: (\S+))?(?: (.*?))? بررسی شد؛ حساب، مالیات و قیمت‌ها ایرادی نداشت\.$/, (m) => `Invoice${m[1] ? ` ${m[1]}` : ''}${m[2] ? ` ${m[2]}` : ''} checked: arithmetic, VAT and prices had no problems.`],
  // order memory, cuts, deliveries
  [/^برای (.*) در (\d+) روز پیش از این فاکتور برشی در گروه برش ثبت نشده است\.$/, (m) => `No cut was recorded in the cut group for ${THIS_CUSTOMER(m[1])} in the ${m[2]} days before this invoice.`],
  [/^کد (.*): در فاکتور (.*)، در گروه برش (.*)\.$/, 'Code $1: $2 on the invoice, $3 in the cut group.'],
  [/^⛔ (.*): تحویل تا تأیید نقدی نباید انجام شود\.(?: — (.*))?$/, (m) => `⛔ ${m[1]}: delivery must not be made until the cash is confirmed.${m[2] ? ` — ${m[2]}` : ''}`],
  [/^برای (.*) فاکتوری در (\d+) روز گذشته ثبت نشده است\.$/, (m) => `No invoice was recorded for ${THIS_CUSTOMER(m[1])} in the last ${m[2]} days.`],
  [/^کد (.*) تحویل شد ولی در فاکتورهای این مشتری نیست\.$/, "Code $1 was delivered but is not on this customer's invoices."],
  [/^کد (.*): تحویل (.*) است و فاکتور (.*)\.$/, 'Code $1: $2 delivered but the invoice says $3.'],
  [/^سفارشی برای این مشتری در حافظهٔ دستیار نیست \(شاید فقط در گفتگوی خصوصی آمده\)؛ فقط حساب و قیمت سنجیده شد$/, "No order for this customer is in the assistant's memory (it may have come only in a private chat); only arithmetic and prices were checked"],
  [/^برای این مشتری سفارش ثبت شده ولی هیچ‌کدام کد مشترکی با این فاکتور ندارد \((\d+) سفارش\)$/, 'Orders are recorded for this customer but none shares a code with this invoice ($1 order(s))'],
  [/^سفارش این مشتری فقط از گروه برش شناخته شد$/, 'The order of this customer is known only from the cut group'],
  [/^این کد در (.*) نیست$/, (m) => `This code is not in the ${SOURCE[m[1]] || m[1]}`],
  [/^مقدار با (.*) فرق دارد$/, (m) => `The quantity differs from the ${SOURCE[m[1]] || m[1]}`],
  [/^در (.*) بود و در فاکتور نیست$/, (m) => `It was in the ${SOURCE[m[1]] || m[1]} and is not on the invoice`],
  [/^مبلغ دریافتی هنگام تحویل با فاکتور یا مجموع فاکتورهای ثبت‌شدهٔ این مشتری نمی‌خواند\.$/, "The cash received on delivery matches neither an invoice nor the sum of this customer's recorded invoices."],
  [/^Covered by sourcing.*$/, '$&'],
  // reminders, balance, info messages
  [/^یادآوری:$/, 'Reminder:'],
  [/^سفارش (?:شمارهٔ (.*?) )?(.*?) هنوز فاکتور ندارد\.$/, (m) => `Order${m[1] ? ` ${m[1]}` : ''} of ${m[2]} has no invoice yet.`],
  [/^فاکتور (.*?) (.*) هنوز تحویل ثبت‌شده ندارد\.$/, 'Invoice $1 $2 has no recorded delivery yet.'],
  [/^صورت‌حساب ماهانهٔ این مشتری‌ها هنوز ثبت نشده است:$/, 'The monthly statement of these customers is not recorded yet:'],
  [/^ℹ️ تحویل (.*):$/, 'ℹ️ Delivery $1:'],
  [/^ℹ️ مقایسهٔ فاکتور (.*) با گروه برش:$/, 'ℹ️ Invoice $1 compared with the cut group:'],
  [/^ℹ️ پرداخت ثبت شد: (.*)، (.*) درهم$/, 'ℹ️ Payment recorded: $1, AED $2'],
  [/^مانده (.*): فاکتورها (.*) درهم، پرداخت‌ها (.*) درهم، مانده (.*) درهم$/, 'Balance of $1: invoices AED $2, payments AED $3, open AED $4'],
  [/^\(از آغاز ثبت در ربات، نه حساب کامل؛ فاکتورها با مالیات\)$/, '(Since the assistant started recording, not the full account; invoices include VAT)'],
  [/^سفارش‌های اخیر و گام‌های آن‌ها:$/, 'Recent orders and their steps:'],
  [/^سفارشی ثبت نشده است\.$/, 'No orders recorded.'],
  [/^(.*?)(?: \(سفارش (.*?)\))?: برش (بله|نه)، فاکتور (بله|نه)، تحویل (بله|نه)، پرداخت (بله|نه)$/, (m) => `${m[1]}${m[2] ? ` (order ${m[2]})` : ''}: cut ${YES_NO(m[3])}, invoice ${YES_NO(m[4])}, delivery ${YES_NO(m[5])}, payment ${YES_NO(m[6])}`],
  // the daily summary
  [/^خلاصهٔ روز (.*)$/, 'Summary of $1'],
  [/^- سفارش‌های دریافتی: (\d+)$/, '- Orders received: $1'],
  [/^- فاکتورهای بررسی‌شده: (\d+)$/, '- Invoices checked: $1'],
  [/^- بدون ایراد: (\d+)$/, '- Without problems: $1'],
  [/^- دارای ایراد: (\d+)(?: \(هشدار قیمت: (\d+)\))?$/, (m) => `- With problems: ${m[1]}${m[2] ? ` (price alerts: ${m[2]})` : ''}`],
  [/^- فاکتور بدون سفارش پیدا شده: (\d+)$/, '- Invoices with no order found: $1'],
  [/^- از این‌ها با سفارش مقایسه شد: (\d+)$/, '- Of these, compared with an order: $1'],
  [/^- از این‌ها با سفارش متنی \(اطمینان کم\): (\d+)$/, '- Of these, compared with a text order (low confidence): $1'],
  [/^- فاکتور بدون سفارش در حافظه: (\d+)$/, '- Invoices with no order in memory: $1'],
  [/^- سفارش‌های متنی و عکسی گروه‌ها \(اطمینان کم\): (\d+)$/, '- Text and photo orders seen in groups (low confidence): $1'],
  [/^- فاکتور ناخوانا: (\d+)$/, '- Unreadable invoices: $1'],
  [/^- فاکتورهای فقط دارای یادداشت: (\d+)$/, '- Invoices with notes only: $1'],
  [/^- کالاهای رسیده‌شده: (\d+)$/, '- Goods received entries: $1'],
  [/^- برش‌های ثبت‌شده: (\d+)$/, '- Cuts recorded: $1'],
  [/^- تحویل‌ها: (\d+)$/, '- Deliveries: $1'],
  [/^- پرداخت‌های ثبت‌شده: (\d+)$/, '- Payments recorded: $1'],
  [/^- پرداخت‌های هنوز تأییدنشده \(«CLEARED» نخورده\): (\d+)$/, '- Payments not cleared yet: $1'],
  [/^امروز سفارش یا فاکتوری ثبت نشد\.$/, 'No order or invoice was recorded today.'],
  // failures and short answers to colleagues
  [/^بررسی فاکتور با خطا روبه‌رو شد؛ دوباره بفرستید یا به مدیر خبر بدهید\.$/, 'The invoice check failed with an error; please send it again or tell the manager.'],
  [/^ثبت یا بررسی این سفارش با خطا روبه‌رو شد؛ دوباره بفرستید یا به مدیر خبر بدهید\.$/, 'Recording or checking this order failed with an error; please send it again or tell the manager.'],
  [/^این را به‌عنوان فاکتور نخواندم؛ خوانا نبود یا ردیفی در آن ندیدم\.$/, 'I could not read this as an invoice; it was unclear or had no lines.'],
  [/^این فایل برای بررسی بزرگ است\.$/, 'This file is too large to check.'],
  [/^درخواست (.*):$/, 'Request of $1:'],
  [/^(→ .*?): (?:کافی است؛ می‌شود به مشتری موجود گفت)$/, '$1: enough; the customer can be told it is available'],
  [/^(→ .*?): (?:کافی نیست یا کمتر از حداقل می‌ماند؛ به مدیر فروش گزارش شد)$/, '$1: not enough or it leaves less than the minimum; reported to the sales manager'],
  [/^(→ .*?): (?:کد ناشناخته یا در چند گروه است)$/, '$1: unknown code or in several groups'],
  // the sales manager's messages
  [/^⚠️ درخواست #(\d+): موجودی برای پاسخ به مشتری کافی نیست$/, '⚠️ Request #$1: stock is not enough to answer the customer'],
  [/^کد: (.*)$/, 'Code: $1'],
  [/^مقدار درخواست: (.*)$/, 'Requested quantity: $1'],
  [/^واحد درخواست به متر تبدیل نشد؛ مقدار هر رول در برگه نیست\.$/, 'The requested unit could not be converted to metres; the roll size is not in the sheet.'],
  [/^موجودی آزاد: (.*)$/, 'Free stock: $1'],
  [/^رزرو: (.*)$/, 'Reserved: $1'],
  [/^حداقل موجودی: (.*)$/, 'Minimum stock: $1'],
  [/^آیا اجازه می‌دهید به مشتری «موجود است» بگویم، یا خودتان جواب می‌دهید؟$/, 'May I tell the customer "available", or will you answer yourself?'],
  [/^پاسخ با «#(\d+) بله» یا «#\d+ نه» یا «#\d+ خودم»، یا متن پاسخ را بنویسید \(روی همین پیام پاسخ بدهید یا شمارهٔ #\d+ را اول بنویسید\)\.$/, 'Reply "#$1 yes", "#$1 no" or "#$1 me", or write the answer text (reply to this message or start with the number #$1).'],
  [/^باشه، #(\d+) را خودتان جواب می‌دهید و در گروه چیزی نمی‌گویم\.$/, 'OK, you answer #$1 yourself and I say nothing in the group.'],
  [/^به مشتری «موجود است» گفتم \(#(\d+)\)\.$/, 'I told the customer it is available (#$1).'],
  [/^به مشتری «فعلاً موجود نیست» گفتم \(#(\d+)\)\.$/, 'I told the customer it is not available for now (#$1).'],
  [/^متن شما را به مشتری رساندم \(#(\d+)\)\.$/, 'I passed your text to the customer (#$1).'],
  [/^پاسخ #(\d+) را نفهمیدم؛ بنویسید بله، نه، خودم، یا متن پاسخ\.$/, 'I did not understand the answer to #$1; write yes, no, me, or the answer text.'],
  [/^یادآوری: درخواست #(\d+) \(کد (.*?)، (.*)\) هنوز بی‌پاسخ است\. به مشتری چیزی گفته نشده\.$/, 'Reminder: request #$1 (code $2, $3) is still unanswered. Nothing has been said to the customer.'],
  [/^⚠️ موجودی کم — به مشتری جوابی داده نشد$/, '⚠️ Low stock — the customer was not answered'],
  [/^درخواست: (.*)$/, 'Requested: $1'],
  [/^مقدار هر رول\/کارتن در کاتالوگ نیست؛ مقدار درخواستی بررسی نشد\.$/, 'The quantity per roll/carton is not in the catalogue; the requested quantity was not checked.'],
  [/^اندازه‌های ثبت‌شده: (.*)$/, (m) => `Registered sizes: ${m[1].replace(/ و /g, ' and ')}`],
  [/^محل: (.*)$/, 'Location: $1'],
  [/^پیام مشتری: (.*)$/, 'Customer message: $1'],
];

// words inside a line that a template above did not take whole
const INLINE = [[' · رزرو: ', ' · Reserved: '], [' · حد: ', ' · Limit: '], [' · سایز: ', ' · Size: '], [' · محل: ', ' · Location: '], [/ و /g, ' and '], [' | درست: ', ' | Correct: '], [' | فاکتور: ', ' | Invoice: ']];

const LABELS = new RegExp(`^(\\d+\\.\\s*)?(⚠️\\s*)?(${kinds})(?=: | \\||$)`);

function line(raw) {
  if (!PERSIAN.test(raw)) return raw;
  const indent = /^\s*/.exec(raw)[0];
  // "1. ⚠️ Label: item" keeps its number and sign, the label is translated
  const lm = LABELS.exec(raw);
  const tidy = (s) => { let out = s; for (const [x, y] of INLINE) out = out.replace(x, y); return out.replace(/،/g, ','); };
  if (lm) return tidy(`${lm[1] || ''}${lm[2] || ''}${KIND[lm[3]]}${raw.slice(lm[0].length)}`);
  const text = raw.trim();
  const num = /^(?:\d+\.\s*)?/.exec(text)[0]; // a list number
  const afterNum = text.slice(num.length);
  const dash = /^-\s*/.exec(afterNum)?.[0] || ''; // a list dash
  for (const [re, to] of RULES) {
    for (const [lead, body] of [[num, afterNum], [num + dash, afterNum.slice(dash.length)]]) {
      const m = re.exec(body);
      if (m) return tidy(`${indent}${lead}${typeof to === 'function' ? to(m) : body.replace(re, to)}`);
    }
  }
  return tidy(raw);
}

/**
 * The language of an answer follows the PLACE it is sent to:
 *  - any company group (staff, command, invoice, information, cut, delivery, confirmation, goods, test): English only, whoever asked;
 *  - a customer group: the language the customer wrote in [written];
 *  - a private chat: Persian only with the owner, English with every other colleague.
 * [persona] ('customer' | 'staff' | 'owner') is the test-only prefix that plays another person in the test group.
 */
export function placeLanguage({ kind, owner = false, persona = '', written = 'en', sentence = true }) {
  if (persona === 'customer') return written;
  if (persona === 'owner') return 'fa';
  if (persona === 'staff') return 'en';
  if (kind === 'customer-group') return written;
  if (kind === 'private') return owner ? 'fa' : 'en';
  return sentence ? 'en' : 'fa'; // a company group: Persian unless the asker wrote a full English sentence ([sentence] false)
}

/** A full English sentence (three Latin words or more, no Persian or Arabic letter): the one thing that gets an English answer in a company group. */
export const isEnglishSentence = (text) => !/[؀-ۿ]/.test(String(text || '')) && (String(text || '').match(/[A-Za-z]{2,}/g) || []).length >= 3;

/** English for a report text: every line it knows; lines without Persian are left as they are. */
export function toEnglish(text) {
  return String(text ?? '').split('\n').map(line).join('\n');
}

/** True when a text still holds a Persian letter (used by the tests and by the guard on what colleagues read). */
export const hasPersian = (text) => PERSIAN.test(String(text || ''));

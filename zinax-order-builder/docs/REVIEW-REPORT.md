# گزارش فنی — ZINAX Order Builder (Phase 1B: Export-Ready Prototype)

**تاریخ:** 2026-09-16
**برنچ:** `claude/zinax-order-builder-ui-jrk0vb`
**PR:** https://github.com/firoozia/ALI/pull/1 (باز، بدون تعارض، بدون CI پیکربندی‌شده)
**مسیر پروژه در ریپو:** `zinax-order-builder/` (پروژه‌ی مستقل، جدا از کد Python/CNC موجود در ریشه‌ی ریپو)

> این نسخه‌ی به‌روزشده‌ی گزارش قبلی است. تفاوت اصلی نسبت به نسخه‌ی قبل: دیگر یک UI صرفاً mock نیست — Export ها واقعی هستند (فایل واقعی دانلود می‌شود)، و کل UI به TypeScript تبدیل شده.

---

## 1. هدف پروژه

ابزار ثبت سفارش تولید درب کابینت/MDF/ممبران PVC. **این یک اپلیکیشن CNC/CAM نیست** — هیچ G-code، DXF، Tool Database، تنظیمات ماشین یا شبیه‌سازی CNC ندارد و عمداً از آن‌ها اجتناب شده.

محصول فقط این خروجی‌ها را می‌سازد (همه‌شان الان **واقعی** هستند، نه mock):

1. **Production CSV** — برای import به FIROO CAM
2. **Order PDF** — برگه‌ی سفارش کامل
3. **Proforma Invoice PDF** — فاکتور پیش‌فاکتور (اختیاری، فقط وقتی invoice mode روشن است)
4. **Order Project JSON** (`.zinax_order.json`) — ذخیره/بازکردن یک سفارش در حال کار

هنوز: بدون بک‌اند، بدون دیتابیس واقعی. تنها «دیتابیس» موجود `localStorage` مرورگر برای تنظیمات (Settings) است.

---

## 2. استک فنی

| بخش | ابزار |
|---|---|
| فریم‌ورک | React 19 + Vite 8 |
| زبان | **TypeScript در کل پروژه** (همه‌ی `.jsx` قبلی به `.tsx` تبدیل شدند) |
| استایل | Tailwind CSS 3 |
| PDF واقعی | `jspdf` + `html2canvas` (رندر همان پیش‌نمایش HTML به PDF چندصفحه‌ای A4) |
| تست | `vitest` — ۵ فایل، ۲۵ تست، همه پاس |
| Lint | oxlint — بدون warning |
| Type-check | `tsc --noEmit` — بدون خطا |

---

## 3. معماری Shared-Core (بدون تغییر نسبت به قبل، فقط تقویت‌شده)

`src/core/` جایگزین mock برای پکیج آینده‌ی `zinax_order_core` است که هم Web Edition (React) و هم Windows Edition (PySide6) از آن استفاده خواهند کرد. کامپوننت‌های UI هیچ قانون کسب‌وکاری را خودشان تکرار نمی‌کنند.

```
src/core/
├── orderSchema.ts        # مدل سفارش + ستون‌های جدول + generateOrderNo
├── invoiceSchema.ts       # مدل فاکتور + generateInvoiceNo + نام فایل PDF فاکتور
├── calculations.ts        # فرمول‌های محاسباتی (بدون تغییر، دقیقاً طبق spec)
├── validators.ts          # اعتبارسنجی ردیف + هدر + فاکتور + لیست خطاهای قابل‌نمایش
├── csvSchema.ts            # ستون‌های CSV + escaping واقعی (RFC 4180) + سریالایز کامل
├── pdfSchema.ts            # مدل داده‌ی PDF (حالا شامل برندینگ از Settings هم هست)
├── exportContracts.ts     # قرارداد هر Export — مصرف صفحه‌ی Export Schema
├── mockData.ts             # داده‌ی نمونه (بدون کاتالوگ‌ها — کاتالوگ‌ها منتقل شدند)
│
│  --- جدید در این فاز ---
├── jsonOrderFile.ts        # ذخیره/بازخوانی سفارش به‌صورت .zinax_order.json + validation نسخه
├── companyProfile.ts       # پروفایل شرکت (نام، لوگو، بانک، VAT پیش‌فرض، ...)
├── catalogSchema.ts        # کاتالوگ قابل‌ویرایش: کد درب، رنگ PVC، ضخامت MDF، جهت گریین
└── settingsSchema.ts       # بسته‌بندی تنظیمات + localStorage adapter + merge/replace
```

و دو فایل جدید خارج از `core/` (چون DOM/مرورگر-محور هستند، نه منطق کسب‌وکار):

```
src/lib/
├── download.ts   # دانلود واقعی فایل (Blob) — CSV و JSON
└── pdfExport.ts  # رندر واقعی PDF از یک DOM node (html2canvas + jsPDF)
```

**نکته‌ی مهم معماری:** `core/` هیچ import از DOM/مرورگر ندارد (جز یک `localStorage` adapter مشخص‌شده در `settingsSchema.ts` که با کامنت علامت‌گذاری شده تا نسخه‌ی ویندوز جایگزینش کند). تولید فایل واقعی (دانلود CSV/JSON، رندر PDF) در `src/lib/` است، نه در `core/` — چون این‌ها کاملاً مخصوص مرورگرند و نسخه‌ی ویندوز باید پیاده‌سازی کاملاً متفاوتی داشته باشد (نوشتن مستقیم روی دیسک، رندر PDF با یک کتابخانه‌ی پایتونی).

---

## 4. چیزی که از قبل تغییر کرد: تبدیل کامل به TypeScript

در نسخه‌ی قبلی گزارش، این محدودیت را صریحاً نوشته بودم: *«کامپوننت‌های UI به TSX تبدیل نشده‌اند»*. این محدودیت **رفع شد** — همه‌ی ۲۲ فایل `.jsx` باقی‌مانده به `.tsx` تبدیل شدند و هیچ فایل `.jsx` در پروژه باقی نمانده. Props همه از تایپ‌های `core/` (مثل `OrderRow`, `OrderHeader`, `Invoice`, `OrderTotals`) استفاده می‌کنند.

---

## 5. Export های واقعی — چی الان کار می‌کند

| Export | قبل | الان | فایل خروجی نمونه |
|---|---|---|---|
| Production CSV | فقط toast (mock) | ✅ دانلود واقعی، UTF-8 BOM، ترتیب دقیق ستون‌ها، escaping صحیح کاما/کوتیشن/خط جدید | `ZX-2026-0149_production.csv` |
| Order PDF | فقط toast (mock) | ✅ فایل PDF واقعی (چندصفحه‌ای در صورت نیاز، A4 landscape) | `ZX-2026-0149_order_sheet.pdf` |
| Proforma Invoice PDF | فقط toast (mock) | ✅ فایل PDF واقعی (A4 portrait) | `INV-2026-0091_proforma_invoice.pdf` |
| Order Project | وجود نداشت | ✅ Save/Open به‌صورت `.zinax_order.json` با schema_version | `ZX-2026-0149.zinax_order.json` |
| Settings | وجود نداشت | ✅ Export/Import JSON + Replace/Merge + اتوسیو در localStorage | `zinax_settings.json` |

همه‌ی این‌ها با **Playwright واقعی** روی dev server تست شدند (نه فقط build/lint) — فایل‌ها واقعاً دانلود و محتوایشان بررسی شد.

### اعتبارسنجی قبل از Export

قبل از هر Export، `core/validators.ts` بررسی می‌کند:
- فیلدهای اجباری هدر (Order No., Order Date, Customer Name)
- فیلدهای اجباری هر ردیف (Design Code, Width, Height, Qty)
- (برای فاکتور) فیلدهای اجباری فاکتور (Invoice No., Invoice Date, Due Date)

اگر خطا باشد: Export متوقف می‌شود، toast قرمز با **لیست دقیق خطاها** نمایش داده می‌شود (مثلاً «Row 2: Width mm is required»)، و هیچ فایلی دانلود نمی‌شود. دکمه‌ی Export Invoice PDF هم وقتی داده نامعتبر است، `disabled` می‌شود.

---

## 6. صفحات

| # | صفحه | وضعیت |
|---|---|---|
| 1 | Dashboard | ✅ کامل |
| 2 | New Order Builder | ✅ کامل — با Export های واقعی |
| 3 | Order PDF Preview | ✅ کامل — دانلود واقعی |
| 4 | Proforma Invoice PDF Preview | ✅ کامل — دانلود واقعی |
| 5 | Export Schema Preview | ✅ کامل |
| 6 | **Settings** | ✅ **کامل شد** (قبلاً جزئی بود) — پروفایل شرکت، آپلود لوگو، کاتالوگ کد درب/رنگ PVC/ضخامت MDF/جهت گریین (همه قابل افزودن/ویرایش/حذف)، Export/Import با انتخاب Replace یا Merge، ذخیره‌ی خودکار در localStorage |
| 7 | Customers / Designs / PDF Templates | ⚪ هنوز فقط Placeholder |

نکته: کاتالوگ Settings حالا واقعاً به Door Order Table وصل است — کدهای درب/PVC/ضخامت/جهت که در Settings تعریف می‌شوند، همان‌هایی هستند که در dropdown های جدول سفارش دیده می‌شوند (نه یک لیست ثابت جدا).

---

## 7. تست‌ها

۵ فایل تست در `src/core/__tests__/` با vitest، جمعاً ۲۵ تست:

| فایل | چی رو تست می‌کند |
|---|---|
| `csvSchema.test.ts` | ترتیب دقیق ستون‌ها، escaping RFC 4180، عدم وجود فیلدهای فاکتور |
| `calculations.test.ts` | فرمول‌های discount/VAT/subtotal/total، VAT قابل‌تغییر، محاسبه‌ی متراژ |
| `jsonOrderFile.test.ts` | شکل فایل ذخیره‌شده، رد فایل با نسخه/app نامعتبر، رد JSON خراب |
| `settingsSchema.test.ts` | رفتار merge (upsert بر اساس code) در برابر replace (جایگزینی کامل) |
| `pdfSchema.test.ts` | مدل PDF دقیقاً همان ردیف‌ها و جمع‌های سفارش را حمل می‌کند |

اجرا: `npm run test` (یا `npx vitest run`)

---

## 8. چیزهایی که هنوز ساخته **نشده**

1. **صفحات Customers / Designs / PDF Templates واقعی** — فقط placeholder.
2. **نسخه‌ی Windows (Electron/Tauri wrapper)** — فقط تصمیم معماری؛ کدی نوشته نشده. اما حالا لایه‌ی `core/` و `src/lib/` به‌وضوح جدا هستند، پس این کار آینده ساده‌تر شد.
3. **چندزبانه/RTL واقعی (عربی)** — فقط دکمه‌ی تاگل EN/AR، بدون ترجمه واقعی.
4. **PDF بهینه‌تر** — روش فعلی (`html2canvas` + `jsPDF`) خروجی را به عکس تبدیل می‌کند، پس فایل نسبتاً بزرگ است (برای سفارش ۳ ردیفی حدود ۱۱ مگابایت) و متن قابل انتخاب/کپی نیست. جایگزین بهتر: `@react-pdf/renderer` (متن واقعی، فایل کوچک‌تر) — نیاز به یک لایه‌ی layout جدا دارد، برای فاز بعد گذاشته شده.
5. **Code-splitting** — باندل نهایی یک فایل JS حدود ۹۰۰ کیلوبایت است (به‌خاطر jsPDF/html2canvas). قبل از هر انتشار واقعی باید با `dynamic import()` جدا شود.
6. **پیش‌فرض‌های Settings در سفارش جدید** — پروفایل شرکت (VAT پیش‌فرض، فروشنده‌ی پیش‌فرض و...) هنوز به فرم «سفارش جدید» وصل نیست؛ Builder همیشه از یک سفارش نمونه‌ی ثابت شروع می‌شود.

---

## 9. نحوه‌ی اجرا و تست برای ریویو

```bash
git clone -b claude/zinax-order-builder-ui-jrk0vb https://github.com/firoozia/ALI.git
cd ALI/zinax-order-builder
npm install

npm run dev          # dev server روی http://localhost:5173
npm run build         # باید بدون خطا تمام شود
npm run lint           # oxlint — باید بدون warning تمام شود
npx tsc --noEmit       # type-check کامل — باید بدون خطا تمام شود
npm run test            # vitest — باید ۲۵/۲۵ پاس شود
```

---

## 10. چک‌لیست پیشنهادی برای ریویو برنامه‌نویس ارشد

- [ ] آیا مرز `core/` در برابر `src/lib/` (منطق کسب‌وکار در برابر رندر مرورگر) منطقی است؟
- [ ] آیا فرمت PDF فعلی (تصویر رندرشده) برای MVP قابل قبول است یا باید همین الان به `@react-pdf/renderer` سوییچ کنیم؟
- [ ] آیا شکل `.zinax_order.json` و `zinax_settings.json` (schema_version + app id) با چیزی که بک‌اند/دسکتاپ واقعی نیاز دارد هم‌خوانی دارد؟
- [ ] اولویت فاز بعدی: صفحات Customers/Designs واقعی، بسته‌بندی Windows، یا بهینه‌سازی PDF/باندل؟

---

*این گزارش توسط دستیار (Claude) بر اساس کد فعلی روی برنچ `claude/zinax-order-builder-ui-jrk0vb` (کامیت `d693d0a`) تهیه شده است.*

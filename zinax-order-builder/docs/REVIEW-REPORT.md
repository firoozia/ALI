# گزارش فنی — ZINAX Order Builder (Phase 1C: Production PDF, Real Catalog Pages, Settings Integration)

**تاریخ:** 2026-09-16
**برنچ:** `claude/zinax-order-builder-ui-jrk0vb`
**PR:** https://github.com/firoozia/ALI/pull/1 (باز)
**کامیت این فاز:** `ea9706f`
**مسیر پروژه در ریپو:** `zinax-order-builder/` (پروژه‌ی مستقل، جدا از کد Python/CNC موجود در ریشه‌ی ریپو — این فاز هم هیچ فایلی از FIROO CAM را لمس نکرده)

> این نسخه‌ی به‌روزشده‌ی گزارش Phase 1B است. تفاوت اصلی: موتور PDF از تصویر (html2canvas) به متن واقعی (`@react-pdf/renderer`) عوض شد، صفحات Customers/Designs/PDF Templates که قبلاً فقط placeholder بودند حالا کاملاً کار می‌کنند، و «سفارش جدید» به‌صورت پیش‌فرض خالی شروع می‌شود (به‌جای دیتای نمونه‌ی ثابت) و از پیش‌فرض‌های Settings استفاده می‌کند.

---

## 1. هدف پروژه (بدون تغییر)

ابزار ثبت سفارش تولید درب کابینت/MDF/ممبران PVC. **این یک اپلیکیشن CNC/CAM نیست** — هیچ G-code، DXF، Tool Database، تنظیمات ماشین یا شبیه‌سازی CNC ندارد.

محصول فقط این خروجی‌ها را می‌سازد (همه واقعی‌اند):

1. **Production CSV** — برای import به FIROO CAM
2. **Order PDF** — برگه‌ی سفارش کامل (حالا متن واقعی، نه تصویر)
3. **Proforma Invoice PDF** — فاکتور پیش‌فاکتور (اختیاری، فقط وقتی invoice mode روشن است)
4. **Order Project JSON** (`.zinax_order.json`)
5. **Settings JSON**, **Customers JSON**, **Catalog JSON** — export/import مستقل با replace/merge

---

## 2. تغییر اصلی: موتور PDF از تصویر به متن واقعی

| | قبل (Phase 1B) | الان (Phase 1C) |
|---|---|---|
| کتابخانه | `html2canvas` + `jspdf` | `@react-pdf/renderer` |
| نوع خروجی | عکس رندرشده از DOM چسبانده‌شده در PDF | PDF متنی واقعی با فونت embedded |
| حجم فایل (سفارش ۳ ردیفی) | ~۱۱ مگابایت | **۴.۵ کیلوبایت** (Order) / **۵.۷ کیلوبایت** (Invoice) |
| متن قابل انتخاب/کپی/جستجو | ❌ خیر | ✅ آره — تأیید شده (فایل دارای `/Font` واقعی است) |
| اثر روی باندل اصلی | مستقیماً import شده، همیشه لود می‌شود | فقط با `import()` دینامیک، فقط وقتی کاربر Export می‌زند لود می‌شود |

موتور قدیمی (`html2canvas`/`jspdf`) **حذف نشده** — به‌صورت یک فایل fallback غیرفعال (`src/lib/pdf/legacyCanvasPdfExport.ts`) نگه داشته شده که خودش هم به‌صورت دینامیک import می‌شود، پس در باندل نهایی حتی یک بایت هم اضافه نمی‌کند (در build واقعی چک شد — chunk جدا برایش ساخته نمی‌شود چون هیچ‌جا صدا زده نمی‌شود).

معماری abstraction (`src/lib/pdf/`):
```
pdfExportTypes.ts          # تایپ‌های PdfExportResult, PdfEngine
exportOrderPdf.ts           # API عمومی: exportOrderPdf(order) → دانلود واقعی
exportInvoicePdf.ts         # API عمومی: exportInvoicePdf(order) → دانلود واقعی
reactPdfOrderDocument.tsx    # کامپوننت @react-pdf/renderer برای Order (A4 landscape)
reactPdfInvoiceDocument.tsx  # کامپوننت @react-pdf/renderer برای Invoice (A4 portrait)
legacyCanvasPdfExport.ts     # موتور قدیمی، غیرفعال، فقط fallback
```
هیچ محاسبه‌ی totals داخل کامپوننت‌های PDF انجام نمی‌شود — همه از `core/pdfSchema.ts` و `core/calculations.ts` خوانده می‌شود.

### تأثیر روی حجم باندل (Code-splitting — نیاز صریح این فاز)

| باندل | قبل | الان |
|---|---|---|
| باندل اصلی (بار اول صفحه) | ~906 KB (gzip ~267 KB) | **~340 KB (gzip ~96 KB)** |
| موتور PDF (`react-pdf.browser`) | بخشی از باندل اصلی | **1.2 MB جدا، فقط lazy-load موقع Export** (gzip ~445 KB) |

کاهش ~۶۴٪ در حجم JS بار اولیه — تأیید شده با `npm run build`.

---

## 3. صفحات جدید (قبلاً فقط Placeholder بودند، الان کاملاً واقعی‌اند)

| صفحه | چه کاری می‌کند |
|---|---|
| **Customers** | افزودن/ویرایش/حذف مشتری، جستجو (نام/شرکت/تلفن/واتساپ/ایمیل/شماره‌مالیاتی)، Export/Import JSON با Replace یا Merge (upsert بر اساس `customerId`)، ذخیره‌ی خودکار در `localStorage` (کلید جدا از Settings) |
| **Designs** (کاتالوگ) | ۴ بخش مستقل: کد درب، رنگ PVC، ضخامت MDF، جهت گریین — هرکدام افزودن/ویرایش/حذف/غیرفعال‌کردن (soft-deactivate، نه حذف کامل)، Export/Import با Replace/Merge |
| **PDF Templates** | عنوان Order PDF / Invoice PDF، ۴ سوییچ نمایش/عدم‌نمایش (شماره‌مالیاتی، اطلاعات بانکی، امضاها، قیمت روی Order PDF)، آپلود مهر (stamp)، یادداشت پایین صفحه، جای‌گیر زبان (EN/AR) |

نکته‌ی مهم: کد درب/رنگ PVC که در یک سفارش قبلی استفاده شده ولی بعداً در Designs غیرفعال شده، در آن سفارش قدیمی **همچنان نمایش داده می‌شود** (با برچسب «(inactive)») به‌جای این‌که خالی/گم شود — دیتای تاریخی خراب نمی‌شود.

---

## 4. اتصال Settings به «سفارش جدید» (نیاز صریح این فاز)

| قبل | الان |
|---|---|
| Builder همیشه با یک سفارش نمونه‌ی ثابت شروع می‌شد | دکمه‌ی **«New Blank Order»** — کاملاً خالی، شماره‌ی سفارش با `generateOrderNo` واقعی ساخته می‌شود، ارز/VAT پیش‌فرض/فروشنده/شرایط پرداخت از Settings خوانده می‌شود |
| دیتای نمونه پیش‌فرض بود | دکمه‌ی **«Load Sample Order»** — الان اختیاری، با تأیید (`window.confirm`) قبل از پاک‌کردن کار در حال انجام |
| — | انتخاب مشتری موجود از dropdown داخل Order Header → پر شدن خودکار نام/شرکت/تلفن/واتساپ/ایمیل/آدرس/شماره‌مالیاتی |
| — | شماره‌ی فاکتور فقط یک‌بار، دقیقاً لحظه‌ی روشن‌شدن اولِ Invoice Mode ساخته می‌شود — با خاموش/روشن‌کردن دوباره عوض نمی‌شود |

تأیید شده با تست دستی زنده (Playwright روی dev server): بارگذاری سفارش نمونه → Grand Total به‌درستی AED 1,267.35 محاسبه شد، شماره‌ی فاکتور `INV-2026-0091` فقط یک‌بار ساخته شد.

---

## 5. قانون حیاتی اعتبارسنجی که رعایت شده

> **«قیمت واحد صفر نباید وقتی Invoice Mode خاموش است بلاک شود.»**

`core/validators.ts` → `getInvoiceValidationErrors(invoice, rows, invoiceMode)` وقتی `invoiceMode === false` بلافاصله `[]` برمی‌گرداند — قبل از هرگونه بررسی قیمت/تخفیف/VAT. این دقیقاً با یک تست واحد (`validators.test.ts`) پوشش داده شده: *"does NOT block a zero unit price when invoice mode is OFF"*.

---

## 6. تست‌ها

**۹ فایل، ۵۱ تست، همه پاس** (`npm run test`):

| فایل | تعداد | چی رو تست می‌کند |
|---|---|---|
| `orderSchema.test.ts` | ۲ (جدید) | فرمت `generateOrderNo`/`generateInvoiceNo` |
| `csvSchema.test.ts` | — (به‌روزشده) | ستون‌ها + فیلدهای جدید هدر، بدون فیلد فاکتور |
| `pdfSchema.test.ts` | — (به‌روزشده) | امضای جدید ۵/۶-آرگومانی builder ها، برندینگ سفارشی |
| `settingsSchema.test.ts` | +۲ | merge برای `pdfTemplate`، پارس lenient فایل قدیمی بدون `pdfTemplate` |
| `catalogSchema.test.ts` | ۵ (جدید) | فرمت ضخامت MDF، فقط‌آیتم‌فعال پیش‌فرض، merge بر اساس code/thickness، replace، round-trip |
| `customerSchema.test.ts` | ۵ (جدید) | جستجوی case-insensitive، merge بر اساس `customerId`، replace، round-trip |
| `validators.test.ts` | ۹ (جدید) | تمام قوانین سفارش/فاکتور، از‌جمله قانون بالا |

اجرا: `npm run test` — نتیجه: `Test Files 9 passed | Tests 51 passed`

---

## 7. تست دستی زنده (Playwright روی dev server واقعی)

موارد زیر واقعاً در مرورگر headless اجرا و تأیید شدند (نه فقط unit test):

- ✅ New Blank Order: شماره‌ی سفارش تازه، ارز/فروشنده از Settings پر می‌شود، ۰ ردیف
- ✅ Customers: افزودن مشتری از UI، ذخیره در `localStorage`، **باقی‌ماندن بعد از رفرش واقعی صفحه**
- ✅ Load Sample Order → محاسبه‌ی صحیح Total Doors/Area/Grand Total
- ✅ Export Production CSV → فایل واقعی دانلود شد، محتوا بررسی شد: **هیچ فیلد مخصوص فاکتور (قیمت/تخفیف/VAT) در آن نیست**
- ✅ Export Order PDF → فایل ۴.۵ کیلوبایتی با فونت embedded (نه تصویر)
- ✅ روشن‌کردن Proforma Invoice → شماره‌ی فاکتور یک‌بار ساخته شد، جدول قیمت/تخفیف/VAT/Line Total درست نمایش داده شد
- ✅ Export Proforma Invoice PDF → فایل ۵.۷ کیلوبایتی با فونت embedded

---

## 8. چیزهایی که هنوز ساخته **نشده** / محدودیت‌های شناخته‌شده

1. **نسخه‌ی Windows** — فقط تصمیم معماری؛ کدی نوشته نشده. جداسازی `core/`/`lib/` این کار را آسان‌تر کرده.
2. **چندزبانه/RTL واقعی (عربی)** — فقط جای‌گیر (`PdfLanguage: "EN" | "AR"` در تنظیمات Template)، بدون ترجمه یا layout راست‌به‌چپ واقعی.
3. **یک مکانیزم انتخاب مشتری، نه دو تا** — طبق spec باید بشود مشتری را «در سفارش جدید انتخاب کرد»؛ این با یک dropdown داخل Order Header پیاده شده (نه یک UI انتخاب جداگانه‌ی دوم در خود صفحه‌ی Customers) — یک تصمیم عمدی برای جلوگیری از تکرار UI.
4. باندل موتور PDF (`react-pdf.browser`) با gzip حدود ۴۴۵ کیلوبایت است — قابل قبول چون فقط lazy-load می‌شود، ولی در صورت نیاز به بارگذاری سریع‌تر Export می‌توان بعداً بررسی‌اش کرد.
5. هنوز بدون بک‌اند واقعی/دیتابیس — «دیتابیس»ها سه `localStorage` جدا هستند (Settings، Customers، و کاتالوگ که داخل Settings است).

---

## 9. نحوه‌ی اجرا و تست برای ریویو

```bash
git clone -b claude/zinax-order-builder-ui-jrk0vb https://github.com/firoozia/ALI.git
cd ALI/zinax-order-builder
npm install

npm run dev          # dev server روی http://localhost:5173
npm run build         # باید بدون خطا تمام شود — چک کنید chunk جدا برای react-pdf ساخته شود
npm run lint           # oxlint — باید بدون warning تمام شود
npx tsc --noEmit       # باید بدون خطا تمام شود
npm run test            # vitest — باید ۵۱/۵۱ پاس شود
```

---

## 10. چک‌لیست پیشنهادی برای ریویو برنامه‌نویس ارشد

- [ ] آیا مکانیزم انتخاب مشتری (فقط dropdown در Order Header) کافی است یا باید UI انتخاب جدا هم در صفحه‌ی Customers اضافه شود؟
- [ ] آیا حجم gzip ~۴۴۵ کیلوبایتی موتور PDF (حتی به‌صورت lazy) قابل قبول است؟
- [ ] اولویت فاز بعدی: نسخه‌ی Windows (Electron/Tauri یا PySide6)، ترجمه‌ی واقعی عربی/RTL، یا اتصال به یک بک‌اند واقعی؟

---

*این گزارش توسط دستیار (Claude) بر اساس کد فعلی روی برنچ `claude/zinax-order-builder-ui-jrk0vb` (کامیت `ea9706f`) تهیه شده است.*

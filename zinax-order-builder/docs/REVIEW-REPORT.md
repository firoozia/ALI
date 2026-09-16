# گزارش فنی — ZINAX Order Builder (UI Prototype)

**تاریخ:** 2026-09-16
**برنچ:** `claude/zinax-order-builder-ui-jrk0vb`
**PR:** https://github.com/firoozia/ALI/pull/1 (باز، بدون تعارض، بدون CI پیکربندی‌شده)
**مسیر پروژه در ریپو:** `zinax-order-builder/` (پروژه‌ی مستقل، جدا از کد Python/CNC موجود در ریشه‌ی ریپو)

---

## 1. هدف پروژه

یک **UI پروتوتایپ** برای "ZINAX Order Builder" — ابزار ثبت سفارش تولید درب کابینت/MDF/ممبران PVC.

**این یک اپلیکیشن CNC/CAM نیست.** فقط سه خروجی تولید می‌کند:

1. Production CSV (برای import به FIROO CAM)
2. Order PDF کامل
3. Proforma Invoice PDF (اختیاری)

هیچ G-code، DXF، Tool Database، تنظیمات ماشین، یا شبیه‌سازی CNC در این محصول وجود ندارد و عمداً از آن‌ها اجتناب شده.

**مهم:** فقط UI است. بدون بک‌اند، بدون دیتابیس، بدون تولید واقعی فایل. دکمه‌های Export فقط toast نمایش می‌دهند.

---

## 2. استک فنی

| بخش | ابزار |
|---|---|
| فریم‌ورک | React 19 + Vite 8 |
| استایل | Tailwind CSS 3 |
| آیکون | lucide-react |
| زبان | JavaScript (کامپوننت‌های UI) + **TypeScript** (لایه‌ی `core/`) |
| Lint | oxlint (پاس بدون warning) |
| Type-check | `tsc --noEmit` (پاس بدون خطا) |

پروژه هیچ backend/DB ندارد و به‌صورت SPA با state داخلی React کار می‌کند.

---

## 3. معماری — نکته‌ی کلیدی این نسخه

درخواست بود که پروژه با **معماری Shared-Core** طراحی شود، چون در آینده دو نسخه از این محصول عرضه می‌شود:

- **Web Edition:** React (این پروژه) + احتمالاً FastAPI در بک‌اند واقعی
- **Windows Edition:** PySide6 (دسکتاپ)

هر دو نسخه باید از **یک منطق مشترک** استفاده کنند: همان schema سفارش، همان قوانین validation، همان فرمول محاسبات فاکتور، همان ساختار CSV، همان data model پی‌دی‌اف.

### راه‌حل در این پروتوتایپ

یک پوشه‌ی `src/core/` ساخته شده که **جایگزین mock برای پکیج آینده‌ی `zinax_order_core`** است. کامپوننت‌های UI هیچ قانون کسب‌وکاری (validation, calculation, schema) را خودشان تکرار نمی‌کنند — همه را از `core/` import می‌کنند.

```
src/core/
├── orderSchema.ts      # مدل داده‌ی سفارش + تعریف ستون‌های جدول (ORDER_ROW_COLUMNS)
├── invoiceSchema.ts     # مدل داده‌ی فاکتور + ساختار شماره‌ی فاکتور
├── calculations.ts      # تمام فرمول‌های محاسباتی (خط زیر را ببینید)
├── validators.ts        # قوانین اعتبارسنجی فیلدهای اجباری
├── csvSchema.ts          # ستون‌های دقیق Production CSV + تابع تولید ردیف‌ها
├── pdfSchema.ts          # مدل داده‌ی Order PDF و Invoice PDF (builder functions)
├── exportContracts.ts   # قرارداد هر Export (چه فایلی، چه ستون‌هایی، برای چه کسی)
└── mockData.ts           # داده‌های نمونه (کاتالوگ درب/PVC، مشتری‌ها، ...)
```

**فرمول‌های محاسباتی (`calculations.ts`) — دقیقاً طبق spec:**

```
line_subtotal   = quantity × unit_price
discount_amount = line_subtotal × discount_percent / 100
taxable_amount   = line_subtotal − discount_amount
vat_amount       = taxable_amount × vat_percent / 100
line_total       = taxable_amount + vat_amount
```

این فرمول‌ها فقط در یک جا نوشته شده‌اند و همه‌ی صفحات (جدول سفارش، پنل فاکتور، پیش‌نمایش فاکتور PDF) از همان تابع استفاده می‌کنند.

### محدودیت این پیاده‌سازی (باید برای برنامه‌نویس ارشد شفاف باشد)

- `core/*.ts` واقعاً TypeScript تایپ‌دار است و `tsc --noEmit` پاس می‌شود.
- کامپوننت‌های UI (`.jsx`) **به TSX تبدیل نشده‌اند** — چون Vite/esbuild فایل‌های JS و TS مخلوط را بدون مشکل بیلد می‌کند، و تبدیل کامل UI به TSX در این مرحله هزینه/فایده نداشت. یعنی خود کامپوننت‌های React از نظر type-safety، فقط مصرف‌کننده‌ی توابع تایپ‌دار `core/` هستند، ولی خودشان بدون type-checking اجرا می‌شوند.
- در محصول واقعی، `core/` باید به یک پکیج جدا (`zinax_order_core`) تبدیل شود که هم از React (از طریق API/بایندینگ) و هم از PySide6 (مستقیم، اگر پایتون باشد) قابل استفاده باشد. این پروتوتایپ فقط **الگو و مرز معماری** را نشان می‌دهد، نه پکیج نهایی.

---

## 4. صفحات ساخته‌شده

| # | صفحه | وضعیت | توضیح |
|---|---|---|---|
| 1 | Dashboard | ✅ کامل | ۵ کارت آمار + جدول سفارش‌های اخیر با Badge وضعیت |
| 2 | New Order Builder | ✅ کامل | فرم هدر، جدول قابل ویرایش (Add/Duplicate/Delete row)، تاگل فاکتور، پنل خلاصه، نوار Export چسبان |
| 3 | Order PDF Preview | ✅ کامل | پیش‌نمایش A4-landscape، دکمه Download/Print/Back |
| 4 | Proforma Invoice PDF Preview | ✅ کامل | جدول فاکتور، جمع‌ها، اطلاعات پرداخت، امضا |
| 5 | **Export Schema Preview** (جدید) | ✅ کامل | نمایش زنده‌ی ستون‌های CSV، خروجی‌های PDF، و ویژگی‌های غیرفعال CNC — مستقیم از `core/` |
| 6 | Settings | 🟡 جزئی | کارت "System Architecture" کامل؛ بخش Company/Defaults هنوز placeholder |
| 7 | Customers / Designs / PDF Templates | ⚪ Placeholder | فقط صفحه‌ی "به‌زودی" — هیچ CRUD واقعی ندارند |

### رفتار مهم جدول سفارش (Door Order Table)

- ستون‌ها از `ORDER_ROW_COLUMNS` در `core/orderSchema.ts` خوانده می‌شوند (نه هاردکد در JSX).
- وقتی "Generate Proforma Invoice" خاموش است، ستون‌های قیمتی (Unit Price / Discount % / VAT % / Line Total) **حذف نمی‌شوند، فقط مات و غیرفعال (disabled) می‌شوند** — طبق spec جدید. ساختار ستون همیشه ثابت است.
- اعتبارسنجی فیلدهای اجباری (Design Code, Width, Height, Qty) از `core/validators.ts` می‌آید.

---

## 5. چیزهایی که هنوز ساخته **نشده** (باز برای تصمیم/کار بعدی)

این بخش برای شفافیت با ریویوکننده مهم است — این‌ها در گفتگو مطرح شدند ولی هنوز پیاده‌سازی نشدند:

1. **Settings واقعی + Export/Import تنظیمات به فایل JSON** — طرح کامل بحث شده (کد درب، رنگ PVC، مشتری‌ها، پروفایل شرکت، با گزینه‌ی Replace/Merge)، اما کدی نوشته نشده. نیاز به `localStorage` برای persist بین رفرش‌ها هم مصوب شده ولی ساخته نشده.
2. **صفحات Customers / Designs / PDF Templates واقعی** — فقط placeholder هستند؛ باید جدول قابل ویرایش (مثل Door Order Table) بگیرند.
3. **نسخه‌ی Windows (Electron/Tauri wrapper)** — فقط در سطح تصمیم معماری مطرح شده (لایه‌ی storage باید abstract باشد تا بعداً به فایل‌سیستم واقعی سوییچ کند)؛ هیچ packaging یا کد Electron نوشته نشده.
4. **تولید واقعی فایل CSV/PDF** — طبق خواسته‌ی پروژه فعلاً عمداً mock است (فقط toast)، اما چون Export/CSV در مرورگر بدون بک‌اند هم قابل انجام است (`Blob` + دانلود)، این یک گزینه‌ی آماده برای فاز بعدی است.
5. **چندزبانه/RTL واقعی (عربی)** — فقط دکمه‌ی تاگل EN/AR در Topbar وجود دارد، بدون ترجمه یا layout راست‌به‌چپ واقعی.

---

## 6. نحوه‌ی اجرای پروژه برای ریویو

```bash
git clone -b claude/zinax-order-builder-ui-jrk0vb https://github.com/firoozia/ALI.git
cd ALI/zinax-order-builder
npm install
npm run dev       # اجرای local dev server (پیش‌فرض http://localhost:5173)

npm run build      # بیلد production — باید بدون خطا تمام شود
npm run lint        # oxlint — باید بدون warning تمام شود
npx tsc --noEmit    # type-check لایه‌ی core/ — باید بدون خطا تمام شود
```

هیچ env variable یا سرویس خارجی لازم نیست.

---

## 7. چک‌لیست پیشنهادی برای ریویو برنامه‌نویس ارشد

- [ ] آیا مرز `core/` در برابر `components/`/`pages/` منطقی و کافی است، یا باید عمیق‌تر جدا شود؟
- [ ] آیا نام‌گذاری/شکل schema در `orderSchema.ts` و `csvSchema.ts` با ساختار احتمالی دیتابیس/بک‌اند واقعی هم‌خوان است؟
- [ ] آیا تصمیم به نگه‌داشتن UI به‌صورت `.jsx` (بدون تبدیل کامل به `.tsx`) قابل قبول است یا باید کل UI هم تایپ‌دار شود؟
- [ ] آیا فرمول‌های محاسباتی (`calculations.ts`) دقیقاً با نیازهای مالی واقعی (رند کردن اعشار، مالیات مرکب و ...) هم‌خوانی دارد؟
- [ ] اولویت فاز بعدی: تکمیل Settings/Import-Export یا شروع بسته‌بندی Windows؟

---

*این گزارش توسط دستیار (Claude) بر اساس کد فعلی روی برنچ `claude/zinax-order-builder-ui-jrk0vb` تهیه شده است.*

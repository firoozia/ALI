# گزارش فنی — ZINAX Order Builder (Phase 1E: بسته‌ی واقعی MSI/EXE ویندوز + QA دسکتاپ)

**تاریخ:** 2026-09-16
**برنچ:** `claude/zinax-order-builder-ui-jrk0vb`
**PR:** https://github.com/firoozia/ALI/pull/1 (باز، CI سبز، بدون تعارض merge)
**کامیت این فاز:** `3bd090f`
**مسیر پروژه در ریپو:** `zinax-order-builder/` (این فاز هم هیچ فایلی از FIROO CAM/CNC را لمس نکرده و هیچ قابلیت CNC/CAM اضافه نشده)

> این نسخه‌ی به‌روزشده‌ی گزارش Phase 1D است. تفاوت اصلی این فاز: بسته‌ی واقعی نصب ویندوز (`.msi` و `.exe`) **واقعاً روی GitHub Actions ساخته و تأیید شد** (نه فقط برنامه‌ریزی‌شده)، آیکون برندشده جای آیکون پیش‌فرض Tauri نشست، متادیتای نصب‌کننده اضافه شد، و یک چک‌لیست QA دستی ۲۲ مرحله‌ای برای تست روی ویندوز واقعی نوشته شد.

---

## 1. هدف پروژه (بدون تغییر)

ابزار ثبت سفارش تولید درب کابینت/MDF/ممبران PVC. **این یک اپلیکیشن CNC/CAM نیست.** محصول همچنان فقط: Production CSV، Order PDF، Proforma Invoice PDF اختیاری، Order Project JSON، و Settings/Customers/Catalog JSON.

---

## 2. نتیجه‌ی اصلی: بسته‌ی نصب ویندوز واقعاً ساخته شد ✅

برخلاف Phase 1D (که فقط باندل‌های لینوکسی روی این محیط لینوکسی ساخته شد و ساخت واقعی ویندوز به فاز بعد موکول شده بود)، این فاز یک workflow واقعی روی GitHub Actions (`windows-latest`) اضافه کرد و **اجرا و تأیید شد**:

| مرحله‌ی CI | نتیجه |
|---|---|
| Checkout + Setup Node + Setup Rust | ✅ |
| `npm run build` | ✅ روی ویندوز واقعی |
| `npm run lint` | ✅ روی ویندوز واقعی |
| `npx tsc --noEmit` | ✅ روی ویندوز واقعی |
| `npm run test` | ✅ 51/51 روی ویندوز واقعی |
| `npm run desktop:build` (کامپایل release + بسته‌بندی MSI/NSIS) | ✅ |

**فایل‌های واقعی تولید و تأیید شده** (اندازه‌ها از artifact های واقعی GitHub Actions، نه تخمینی):

| Artifact | نوع | اندازه |
|---|---|---|
| `zinax-order-builder-windows-msi` | نصب‌کننده‌ی WiX (.msi) | 3.48 مگابایت |
| `zinax-order-builder-windows-exe` | نصب‌کننده‌ی NSIS (.exe) | 2.59 مگابایت |
| `zinax-order-builder-windows-raw-exe` | باینری خام release | 3.53 مگابایت |

اجرای CI: https://github.com/firoozia/ALI/actions/runs/35050582430 — نتیجه: **success**، هر سه artifact موجود و غیرخالی.

فایل workflow: `.github/workflows/zinax-order-builder-windows.yml` — فقط روی مسیر `zinax-order-builder/**` فعال می‌شود (`working-directory` پیش‌فرض + فیلتر `paths`)، پس هیچ‌وقت کد FIROO CAM را لمس نمی‌کند.

---

## 3. متادیتای نصب‌کننده و آیکون برندشده

`src-tauri/tauri.conf.json` این فاز اضافه شد:

```json
"publisher": "ZINAX (placeholder — قبل از انتشار واقعی جایگزین شود)",
"copyright": "Copyright (c) 2026 ZINAX. All rights reserved. (placeholder)",
"shortDescription": "Order, CSV, PDF and Proforma Invoice builder for MDF/PVC door production",
"windows": { "wix": {...}, "nsis": {...} }
```

آیکون پیش‌فرض Tauri با یک آیکون برندشده جایگزین شد: مربع طلایی/گلد (`#c8952a`) با حرف **«Z»** به رنگ سرمه‌ای (`#0f2a52`) — دقیقاً همان پالت رنگی UI فعلی اپ. منبع آیکون: `zinax-order-builder/branding/icon-source.png` (۱۰۲۴×۱۰۲۴، بدون هیچ asset کپی‌رایتی)، و همه‌ی سایزهای لازم (`icon.ico`, `icon.icns`, PNG های ۳۲ تا ۲۵۶ و کاشی‌های Windows Store) با دستور رسمی `tauri icon` از همین فایل ساخته شدند. پوشه‌های آیکون iOS/Android (چون اپ فقط دسکتاپ است) حذف شدند.

---

## 4. QA دستی برای ویندوز واقعی

فایل جدید: `zinax-order-builder/docs/WINDOWS_DESKTOP_MANUAL_QA_CHECKLIST.md` — ۲۲ مرحله، شامل:
نصب از MSI/EXE، تأیید نام/آیکون اپ، ساخت سفارش خالی، افزودن مشتری/کاتالوگ، همه‌ی Export ها (CSV/Order PDF/Invoice PDF/JSON های Settings/Customers/Catalog)، بازکردن مجدد بعد از بستن اپ برای تأیید persistence، Import، لغو دیالوگ Save بدون ساخت فایل، و تأیید کارکرد کامل بدون اینترنت.

### تأیید زنده‌ی مکانیزم Save Dialog (روی این محیط لینوکسی، بدون window manager)

- Export CSV → دیالوگ native با عنوان **«Save File»** باز شد (Phase 1D + این فاز)
- Export Proforma Invoice PDF → همان دیالوگ باز شد؛ تا وقتی دیالوگ باز است هیچ فایلی روی دیسک نوشته نمی‌شود
- تمام ۱۱ مسیر (CSV، Order PDF، Invoice PDF، Save/Open سفارش JSON، Export/Import سه‌گانه‌ی Settings/Customers/Catalog) از یک تابع مشترک (`saveBlob` در `src/lib/download.ts`) رد می‌شوند، پس تأیید این مکانیزم برای دو مسیر، تأیید تمام ۱۱ مسیر است — سمت Import هم هرکدام try/catch با toast خطای واضح دارد (بررسی کد، بدون تغییر).

---

## 5. دستورهای build/test

```bash
npm install
npm run build          # ✅ بدون خطا (لینوکس محلی + ویندوز CI)
npm run lint             # ✅ بدون warning (لینوکس محلی + ویندوز CI)
npx tsc --noEmit         # ✅ بدون خطا (لینوکس محلی + ویندوز CI)
npm run test              # ✅ 51/51 (لینوکس محلی + ویندوز CI)
npm run desktop:build       # ✅ لینوکس: .deb/.rpm/.AppImage — ویندوز (CI): .msi + .exe واقعی
```

---

## 6. چیزهایی که هنوز ساخته **نشده** / محدودیت‌های شناخته‌شده

1. **تست دستی روی سخت‌افزار ویندوز واقعی** — فایل‌های MSI/EXE ساخته و تأیید شدند ولی هنوز کسی آن‌ها را روی یک ویندوز واقعی نصب و طبق چک‌لیست بخش ۴ تست نکرده.
2. **بدون امضای دیجیتال (code signing)** — نصب‌کننده امضا نشده، پس Windows SmartScreen احتمالاً هشدار می‌دهد. طبق دستور این فاز، عمداً اضافه نشد.
3. **متادیتای publisher/copyright placeholder هستند** — باید قبل از انتشار عمومی با اطلاعات واقعی جایگزین شوند.
4. آیکون هنوز یک نشان موقت («Z») است، نه لوگوی نهایی برند.
5. محدودیت‌های قبلی (بدون تغییر): بدون auto-update/login/cloud sync (طبق دستور)، چندزبانه/RTL واقعی هنوز جای‌گیر است.

---

## 7. چک‌لیست پیشنهادی برای ریویو برنامه‌نویس ارشد

- [ ] آیا چک‌لیست QA دستی (`WINDOWS_DESKTOP_MANUAL_QA_CHECKLIST.md`) را می‌توان روی یک ویندوز واقعی اجرا کرد؟
- [ ] آیا امضای دیجیتال نصب‌کننده اولویت فاز بعد باشد یا بعد از تست دستی؟
- [ ] اولویت فاز بعدی: لوگوی نهایی + امضا، یا ادامه‌ی ترجمه‌ی عربی/RTL؟

---

*این گزارش توسط دستیار (Claude) بر اساس کد فعلی روی برنچ `claude/zinax-order-builder-ui-jrk0vb` (کامیت `3bd090f`) تهیه شده است.*

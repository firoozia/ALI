# Grasshopper File Analyzer

آپلود فایل‌های Grasshopper و تحلیل ساختار و منطق آن‌ها با Claude AI — خروجی: پرامپت آماده برای Cursor.

## راه‌اندازی

```bash
pip install -r requirements.txt
cp .env.example .env
# کلید API آنتروپیک را در .env وارد کنید
uvicorn main:app --reload
```

مرورگر را روی `http://localhost:8000` باز کنید.

## نحوه استفاده

1. کلید API آنتروپیک را وارد کنید (یا در `.env` تنظیم کنید)
2. فایل `.ghx` یا `.gh` را آپلود کنید
3. روی «تحلیل کن» کلیک کنید
4. نتیجه را کپی کرده و در Cursor paste کنید

## فرمت‌های پشتیبانی‌شده

| فرمت | پشتیبانی |
|------|-----------|
| `.ghx` (XML) | کامل |
| `.gh` (باینری) | محدود — ترجیحاً `.ghx` ذخیره کنید |

برای ذخیره به فرمت `.ghx` در Grasshopper: **File → Save As → Grasshopper XML (*.ghx)**

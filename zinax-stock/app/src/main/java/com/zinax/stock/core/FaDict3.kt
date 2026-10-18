package com.zinax.stock.core

/** Catalog, customers, locations, label size, printing. */
internal object FaDict3 {
    const val TEXT = """
Products & groups ⇒ محصول‌ها و گروه‌ها
Add product ⇒ افزودن محصول
Add group ⇒ افزودن گروه
Products ({}) ⇒ محصول‌ها ({})
Groups ({}) ⇒ گروه‌ها ({})
Units written in different ways ⇒ واحدهایی که به شکل‌های مختلف نوشته شده‌اند
“{}” → “{}”: {} ⇒ «{1}» → «{2}»: {3}
{} label(s) in stock ⇒ {} لیبل در موجودی
{} product(s) ⇒ {} محصول
{} line(s) to receive ⇒ {} ردیف برای ورود
The same product with different spellings shows as separate rows in Stock and reports. ⇒ یک محصول با املاهای مختلف در موجودی و گزارش‌ها چند ردیف جدا دیده می‌شود.
Tidying… ⇒ در حال یکدست‌سازی…
Tidy units ⇒ یکدست‌سازی واحدها
Tidy units? ⇒ واحدها یکدست شوند؟
Search code, size or note ⇒ جستجوی کد، سایز یا یادداشت
Show removed ⇒ نمایش حذف‌شده‌ها
No products yet. Tap Add product. ⇒ هنوز محصولی نیست. «افزودن محصول» را بزنید.
{} per {} ⇒ {1} در هر {2}
none in stock ⇒ در موجودی نیست
removed ⇒ حذف‌شده
{} products ⇒ {} محصول
{} in stock ⇒ {} در موجودی
{} roll ⇒ {} رول
{} rolls ⇒ {} رول
{} carton ⇒ {} کارتن
{} cartons ⇒ {} کارتن
{} bag ⇒ {} کیسه
{} bags ⇒ {} کیسه
{} gallon ⇒ {} گالن
{} gallons ⇒ {} گالن
{} pack ⇒ {} بسته
{} packs ⇒ {} بسته
{} sheet ⇒ {} ورق
{} sheets ⇒ {} ورق
{} joined the same product already in {} ⇒ {1} با همان محصول موجود در {2} یکی شد
Saved {} ⇒ {} ذخیره شد
{} label(s) moved ⇒ {} لیبل جابه‌جا شد
{} removed from the catalog. Labels in stock stay. ⇒ {} از کاتالوگ حذف شد. لیبل‌های موجود می‌مانند.
{} is back ⇒ {} برگشت
{} removed ⇒ {} حذف شد
Could not remove ⇒ حذف انجام نشد
Labels in stock are corrected and logged under Reports → Edited. Products that become the same ⇒ لیبل‌های موجود اصلاح می‌شوند و در گزارش‌ها ← ویرایش ثبت می‌شوند. محصول‌هایی که یکی شوند
are joined. Printed labels can stay; the QR still works. Past ship-outs and cuts keep their spelling. ⇒ با هم ادغام می‌شوند. لیبل‌های چاپ‌شده می‌توانند بمانند؛ QR همچنان کار می‌کند. خروج‌ها و برش‌های گذشته املای خودشان را نگه می‌دارند.
Units tidied: {} change(s) ⇒ واحدها یکدست شد: {} تغییر
Could not tidy units ⇒ یکدست‌سازی واحدها انجام نشد
Group ⇒ گروه
Size (optional) ⇒ سایز (اختیاری)
Usual quantity per {} (optional) ⇒ مقدار معمول در هر {} (اختیاری)
Colour or description (optional) ⇒ رنگ یا توضیح (اختیاری)
Also correct the {} label(s) of this product in stock (logged under Reports → Edited) ⇒ {} لیبل این محصول که در موجودی است هم اصلاح شود (در گزارش‌ها ← ویرایش ثبت می‌شود)
Bring back to the catalog ⇒ برگرداندن به کاتالوگ
Remove from the catalog ⇒ حذف از کاتالوگ
Removing only stops suggesting it. Labels in stock stay; delete those from Stock. ⇒ حذف فقط پیشنهاد دادنش را متوقف می‌کند. لیبل‌های موجود می‌مانند؛ آن‌ها را از موجودی حذف کنید.
Name, e.g. MDF board ⇒ نام، مثلاً MDF board
Usual unit ⇒ واحد معمول
One package is a ⇒ هر بسته یک
Unit: m, kg, pcs… Package: roll, gallon, bag, carton, sheet… ⇒ واحد: m، kg، pcs… بسته: roll، gallon، bag، carton، sheet…
Bring back ⇒ برگرداندن
Remove group ⇒ حذف گروه
{} label(s) in stock are in this group. They stay in stock under this name; it is only no longer offered for new labels. ⇒ {} لیبل موجود در این گروه است. با همین نام در موجودی می‌مانند؛ فقط دیگر برای لیبل‌های جدید پیشنهاد نمی‌شود.
Customer ⇒ مشتری
Customers ⇒ مشتری‌ها
New customer ⇒ مشتری جدید
New customer, added to the library when saved ⇒ مشتری جدید، با ذخیره به فهرست مشتری‌ها اضافه می‌شود
{} customers ⇒ {} مشتری
shared with other phones and the Customers tab of the sheet ⇒ مشترک با گوشی‌های دیگر و تب Customers شیت
Added {} by {} ⇒ {1} اضافه شد توسط {2}
Added {} ⇒ {} اضافه شد
Rename ⇒ تغییر نام
Remove ⇒ حذف
Rename customer ⇒ تغییر نام مشتری
Remove {}? ⇒ {} حذف شود؟
The name stops being suggested. Past cuts and reports keep it. Typing it again on a cut adds it back. ⇒ این نام دیگر پیشنهاد نمی‌شود. برش‌ها و گزارش‌های قبلی آن را نگه می‌دارند. اگر دوباره موقع برش تایپ شود برمی‌گردد.
No location ⇒ بدون مکان
Put away in ⇒ قرار دادن در
No location chosen. Add locations in Settings. ⇒ مکانی انتخاب نشده. مکان‌ها را در تنظیمات اضافه کنید.
Choose a place ⇒ انتخاب مکان
Or type a place, e.g. Warehouse 2 - Floor 1 ⇒ یا مکانی را تایپ کنید، مثلاً Warehouse 2 - Floor 1
Label size (mm) ⇒ اندازه‌ی لیبل (میلی‌متر)
Width ⇒ عرض
Height ⇒ ارتفاع
Width {}–{} mm, height {}–{} mm. ⇒ عرض {1} تا {2} میلی‌متر، ارتفاع {3} تا {4} میلی‌متر.
Small label: text and QR print small, and long customer names may be hard to read. ⇒ لیبل کوچک: متن و QR کوچک چاپ می‌شود و نام‌های بلند مشتری ممکن است سخت خوانده شود.
After changing the paper roll, calibrate the printer once: hold FEED until one label comes out. ⇒ بعد از عوض کردن رول کاغذ، یک بار پرینتر را کالیبره کنید: دکمه‌ی FEED را نگه دارید تا یک لیبل بیرون بیاید.
Label preview ⇒ پیش‌نمایش لیبل
Printing {} ⇒ در حال چاپ {}
Connecting to the printer… ⇒ در حال اتصال به پرینتر…
Label {} of {} sent to the printer ⇒ لیبل {1} از {2} به پرینتر فرستاده شد
Did all {} labels print? ⇒ آیا هر {} لیبل چاپ شد؟
Printing stopped ⇒ چاپ متوقف شد
{} of {} labels were sent. The labels are saved; you can print them again from here or from Stock. ⇒ {1} لیبل از {2} فرستاده شد. لیبل‌ها ذخیره‌اند؛ از اینجا یا از موجودی می‌توانید دوباره چاپشان کنید.
If the paper ran out or a label came out blank, reprint from that label number. ⇒ اگر کاغذ تمام شد یا لیبلی خالی بیرون آمد، از همان شماره‌ی لیبل دوباره چاپ کنید.
Reprint from label number (1–{}) ⇒ چاپ دوباره از شماره‌ی لیبل (۱ تا {})
Yes, all printed ⇒ بله، همه چاپ شدند
Reprint from… ⇒ چاپ دوباره از…
test label ⇒ لیبل آزمایشی
cut for {} ⇒ برش برای {}
label for {} ⇒ لیبل برای {}
remainder {} ⇒ باقی‌مانده {}
damage {} ⇒ خرابی {}
open roll {} ⇒ رول باز {}
ship to {} ⇒ خروج به {}
corrected {} ⇒ اصلاح‌شده {}
Zinax-Stock ⇒ زیناکس استوک
"""
}

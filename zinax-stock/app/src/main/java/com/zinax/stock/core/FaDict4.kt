package com.zinax.stock.core

/** Settings, receive, shipments, print by hand, import. */
internal object FaDict4 {
    const val TEXT = """
Appearance ⇒ ظاهر
Language ⇒ زبان
Changes only colours and styling on this phone. Stock, users and settings stay the same. ⇒ فقط رنگ‌ها و ظاهر را روی این گوشی عوض می‌کند. موجودی، کاربران و تنظیمات همان می‌مانند.
Persian changes only the words of menus and messages on this phone. Layout, numbers, codes and printed labels stay the same. ⇒ فارسی فقط کلمه‌های منوها و پیام‌ها را روی این گوشی عوض می‌کند. چیدمان، عددها، کدها و لیبل‌های چاپی همان می‌مانند.
Theme 1 · Teal ⇒ تم ۱ · سبزآبی
Theme 2 · Emerald ⇒ تم ۲ · زمردی
Printer ⇒ پرینتر
Allow Nearby devices so the app can see the printer. ⇒ دسترسی «دستگاه‌های اطراف» را بدهید تا برنامه پرینتر را ببیند.
Bluetooth is off. ⇒ بلوتوث خاموش است.
No paired devices. Pair the XP-420B in Android Bluetooth settings first (PIN is usually 0000 or 1234). ⇒ دستگاه جفت‌شده‌ای نیست. اول XP-420B را در تنظیمات بلوتوث اندروید جفت کنید (رمز معمولاً 0000 یا 1234 است).
Refresh paired devices ⇒ تازه‌سازی دستگاه‌های جفت‌شده
Gap mm ⇒ فاصله‌ی لیبل (mm)
Darkness 1–15 ⇒ تیرگی ۱ تا ۱۵
Speed ⇒ سرعت
If barcodes print faint or patchy: Darkness 10–12 and Speed 2–3, then Print test label. ⇒ اگر بارکد کم‌رنگ یا لکه‌لکه چاپ می‌شود: تیرگی ۱۰ تا ۱۲ و سرعت ۲ یا ۳ بگذارید، بعد «چاپ لیبل آزمایشی» را بزنید.
Clean the print head with alcohol if a white line runs through every label. ⇒ اگر یک خط سفید روی همه‌ی لیبل‌ها هست، هد چاپ را با الکل تمیز کنید.
Rotate label 180° ⇒ چرخاندن لیبل ۱۸۰ درجه
Invert (if labels print as negatives) ⇒ معکوس (اگر لیبل‌ها منفی چاپ می‌شوند)
Print test label ⇒ چاپ لیبل آزمایشی
Calibrating… ⇒ در حال کالیبره…
Calibrate printer ⇒ کالیبره‌ی پرینتر
Blank labels skipped between prints? Set the label size and gap to the real roll (measure with a ruler), ⇒ لیبل خالی رد می‌شود؟ اندازه و فاصله‌ی لیبل را مطابق رول واقعی (با خط‌کش) تنظیم کنید،
then Calibrate printer. Calibrate again after every new roll. ⇒ بعد «کالیبره‌ی پرینتر» را بزنید. بعد از هر رول جدید دوباره کالیبره کنید.
Print the customer label automatically after Cut ⇒ چاپ خودکار لیبل مشتری بعد از برش
Print the customer label automatically after Ship out ⇒ چاپ خودکار لیبل مشتری بعد از خروج
Print a DAMAGED label automatically after Report damage ⇒ چاپ خودکار لیبل DAMAGED بعد از ثبت خرابی
Print an OPEN label for the new roll when a cut is undone ⇒ چاپ لیبل OPEN برای رول جدید وقتی برشی لغو می‌شود
When a switch is off, a Print customer label button appears after each cut or ship out, and a Label button ⇒ وقتی یک کلید خاموش باشد، بعد از هر برش یا خروج دکمه‌ی «چاپ لیبل مشتری» می‌آید و یک دکمه‌ی «لیبل»
sits beside every earlier ship out, cut or damage report of a roll in Ship out. ⇒ کنار هر خروج، برش یا گزارش خرابی قبلی یک رول در صفحه‌ی خروج کالا هست.
Cut and Ship out both need a customer name. ⇒ برش و خروج هر دو نام مشتری لازم دارند.
Locations ⇒ مکان‌ها
Places where goods are kept, e.g. Warehouse 1, Warehouse 2 - Floor 1, Showroom. ⇒ جاهایی که کالا نگه داشته می‌شود، مثل Warehouse 1، Warehouse 2 - Floor 1، Showroom.
They appear as buttons on Receive, Print by hand and Stock. ⇒ در ورود کالا، چاپ دستی و موجودی به‌صورت دکمه دیده می‌شوند.
New location ⇒ مکان جدید
Cutting ⇒ برش
Short end below ⇒ ته رول کوتاه‌تر از
When a cut would leave less than this on the roll, the app asks: give the whole roll, ⇒ وقتی برشی کمتر از این مقدار روی رول باقی بگذارد، برنامه می‌پرسد: کل رول داده شود،
write the end off as waste, or keep it. Set 0 to never ask. ⇒ ته رول دورریز شود، یا نگه داشته شود. برای اینکه هیچ‌وقت نپرسد 0 بگذارید.
Customers library ⇒ فهرست مشتری‌ها
This phone ⇒ این گوشی
Signed in as {} ⇒ وارد شده با نام {}
User, can receive ⇒ کاربر، اجازه‌ی ورود کالا دارد
Change my PIN ⇒ تغییر رمز من
Lock / switch user ⇒ قفل / تغییر کاربر
Unlock with fingerprint or face as {} ⇒ باز کردن قفل با اثر انگشت یا چهره به‌جای {}
Use fingerprint or face ⇒ استفاده از اثر انگشت یا چهره
To unlock as {} on this phone ⇒ برای باز کردن قفل به‌جای {} روی این گوشی
Anyone whose fingerprint or face is saved in this phone can then open the app as {}. ⇒ هر کسی که اثر انگشت یا چهره‌اش روی این گوشی ثبت است می‌تواند برنامه را به‌جای {} باز کند.
Only one person per phone; others use their PIN. ⇒ برای هر گوشی فقط یک نفر؛ بقیه با رمز وارد می‌شوند.
Device letter in label IDs (A, B, C… one per phone) ⇒ حرف دستگاه در شناسه‌ی لیبل‌ها (A، B، C… برای هر گوشی یکی)
Users and security ⇒ کاربران و امنیت
Lock when leaving the app ⇒ قفل شدن هنگام خروج از برنامه
Lock after minutes without use (0 = never) ⇒ قفل پس از چند دقیقه بدون استفاده (0 = هرگز)
For this phone. With both off the app stays open until someone taps the lock on Home. ⇒ برای این گوشی. اگر هر دو خاموش باشند برنامه باز می‌ماند تا کسی در صفحه‌ی اصلی قفل را بزند.
Google Sheet ⇒ گوگل‌شیت
Web app URL (…/exec) ⇒ آدرس وب‌اپ (…/exec)
Sheet link (filled in after the first sync) ⇒ لینک شیت (بعد از اولین همگام‌سازی پر می‌شود)
Open sheet ⇒ باز کردن شیت
WhatsApp report ⇒ گزارش واتس‌اپ
Daily reminder to send the stock list ⇒ یادآور روزانه برای فرستادن فهرست موجودی
Hour ⇒ ساعت
Minute ⇒ دقیقه
Save time ⇒ ذخیره‌ی زمان
Reminder set for {} ⇒ یادآور برای {} تنظیم شد
Send the reminder report as an Excel file ⇒ گزارش یادآور به‌صورت فایل اکسل فرستاده شود
WhatsApp does not allow apps to post to a group by themselves. At this time the phone shows a notification; ⇒ واتس‌اپ اجازه نمی‌دهد برنامه‌ها خودشان در گروه پیام بگذارند. در این ساعت گوشی یک اعلان نشان می‌دهد؛
tap it, pick WhatsApp (or WhatsApp Business) in the share list, then pick the group. ⇒ آن را بزنید، در فهرست اشتراک‌گذاری واتس‌اپ (یا واتس‌اپ بیزینس) را انتخاب کنید و بعد گروه را انتخاب کنید.
Send stock Excel now ⇒ ارسال اکسل موجودی همین حالا
Send stock list now ⇒ ارسال فهرست موجودی همین حالا
Receive · {} ⇒ ورود کالا · {}
Pallet {} ✓ ⇒ پالت {} ✓
Find a code on any pallet ⇒ پیدا کردن کد در هر پالت
Complete ⇒ کامل
This pallet has fewer? Print a smaller number ⇒ این پالت کمتر دارد؟ تعداد کمتری چاپ کنید
{} already printed ⇒ {} قبلاً چاپ شده
All labels for pallet {} are printed. ⇒ همه‌ی لیبل‌های پالت {} چاپ شده‌اند.
Pallet {} complete ⇒ پالت {} کامل شد
Pallet {} not finished ⇒ پالت {} تمام نشده
{} still to print. ⇒ {} هنوز برای چاپ مانده.
+ Add an item that is not on the list ⇒ + افزودن کالایی که در فهرست نیست
How many {} on pallet {}? ⇒ چند {1} روی پالت {2}؟
Labels to print (max {}) ⇒ لیبل برای چاپ (حداکثر {})
pallet {} ⇒ پالت {}
{} (reprint) ⇒ {} (چاپ دوباره)
No shipments yet. Import the packing list that came with the container. ⇒ هنوز محموله‌ای نیست. پکینگ‌لیستی که همراه کانتینر آمده را وارد کنید.
{} pallets ⇒ {} پالت
{} of {} labelled ⇒ {1} از {2} لیبل خورده
Shipment check ⇒ بررسی محموله
{} / {} labelled ⇒ {1} / {2} لیبل خورده
Every package on the list has a label. ⇒ همه‌ی بسته‌های فهرست لیبل دارند.
All correct ⇒ همه درست است
{} package(s) of {} code(s) have no label yet. They were not found on the pallets opened so far. ⇒ {1} بسته از {2} کد هنوز لیبل ندارند. در پالت‌هایی که تا الان باز شده پیدا نشدند.
Missing ⇒ کم‌شده
{} missing ⇒ {} کم است
{} expected ⇒ {} مورد انتظار
{} labelled ⇒ {} لیبل خورده
{} not on the list ⇒ {} در فهرست نیست
Added by hand ⇒ دستی اضافه شده
Extra ⇒ اضافه
Share report ⇒ ارسال گزارش
Add item to shipment ⇒ افزودن کالا به محموله
Print by hand ⇒ چاپ دستی
Known codes — tap to fill in ⇒ کدهای شناخته‌شده — برای پر کردن بزنید
Item code ⇒ کد کالا
Size or model (optional), e.g. 0.30*1400 ⇒ سایز یا مدل (اختیاری)، مثلاً 0.30*1400
Left now ⇒ باقی‌مانده فعلی
Qty per {} ⇒ تعداد در هر {}
Already cut (open roll) ⇒ قبلاً برش خورده (رول باز)
For a roll that was cut before it got a label. It shows as OPEN and is offered first in Cut. ⇒ برای رولی که قبل از گرفتن لیبل برش خورده. به‌صورت «باز» دیده می‌شود و در برش اول پیشنهاد می‌شود.
Original length of the full {} ({}) ⇒ طول اصلی {1} کامل ({2})
Needed so the label can say how much is left of how much, e.g. 120 ⇒ لازم است تا لیبل بگوید از چه مقداری چه مقدار مانده، مثلاً 120
Must be more than what is left now ⇒ باید بیشتر از باقی‌مانده فعلی باشد
Labels (rolls) ⇒ لیبل‌ها (رول)
Labels (cartons) ⇒ لیبل‌ها (کارتن)
Labels (bags) ⇒ لیبل‌ها (کیسه)
Labels (gallons) ⇒ لیبل‌ها (گالن)
Labels (packs) ⇒ لیبل‌ها (بسته)
Labels (sheets) ⇒ لیبل‌ها (ورق)
Prints {} {} of {}, {} each. ⇒ {1} {2} از {3} چاپ می‌شود، هرکدام {4}.
Prints {} {} of {}, {} each, as OPEN rolls (left of {}). ⇒ {1} {2} از {3} چاپ می‌شود، هرکدام {4}، به‌صورت رول باز (باقی‌مانده از {5}).
Print {} labels ⇒ چاپ {} لیبل
Print {} label ⇒ چاپ {} لیبل
{} open ⇒ {} باز
Could not read the file: {}. Use .xlsx or .csv. ⇒ فایل خوانده نشد: {}. از .xlsx یا .csv استفاده کنید.
Import list ⇒ وارد کردن فهرست
Product family for files without a Category column ⇒ خانواده‌ی محصول برای فایل‌های بدون ستون Category
Choose Excel or CSV file ⇒ انتخاب فایل اکسل یا CSV
Reading… ⇒ در حال خواندن…
Read from file ({}) ⇒ خوانده‌شده از فایل ({})
Pallets ⇒ پالت‌ها
Labels to print ⇒ لیبل برای چاپ
Item codes ⇒ کدهای کالا
Sizes ⇒ سایزها
Not in the product catalog: {}. Check for typing mistakes, or add them in Settings → Products & groups. You can still save. ⇒ در کاتالوگ محصول‌ها نیست: {}. غلط تایپی را بررسی کنید، یا در تنظیمات ← محصول‌ها و گروه‌ها اضافه کنید. باز هم می‌توانید ذخیره کنید.
Not in the product catalog: {} and {} more. Check for typing mistakes, or add them in Settings → Products & groups. You can still save. ⇒ در کاتالوگ محصول‌ها نیست: {1} و {2} مورد دیگر. غلط تایپی را بررسی کنید، یا در تنظیمات ← محصول‌ها و گروه‌ها اضافه کنید. باز هم می‌توانید ذخیره کنید.
New codes ⇒ کدهای جدید
Save shipment ⇒ ذخیره‌ی محموله
Supplier packing lists are read as they come. For other goods use a table with the columns ⇒ پکینگ‌لیست تأمین‌کننده همان‌طور که می‌آید خوانده می‌شود. برای کالاهای دیگر جدولی با این ستون‌ها بگذارید:
Pallet, Category, Code, Size, Qty, Unit, Packs. Each row prints Packs labels holding Qty each. ⇒ Pallet, Category, Code, Size, Qty, Unit, Packs. هر ردیف به تعداد Packs لیبل چاپ می‌کند که هرکدام Qty دارد.
"""
}

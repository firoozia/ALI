package com.zinax.stock.core

/** Cut, damage, ship out, stock, reports, move by scan, edit. */
internal object FaDict2 {
    const val TEXT = """
OPEN ⇒ باز
FULL ⇒ کامل
No label {} in this phone. Sync and try again. ⇒ لیبل {} روی این گوشی نیست. همگام‌سازی کنید و دوباره امتحان کنید.
No label {} in this phone. Sync and try again, or check the ID. ⇒ لیبل {} روی این گوشی نیست. همگام‌سازی کنید و دوباره امتحان کنید، یا شناسه را بررسی کنید.
Not found ⇒ پیدا نشد
{} is not in stock ⇒ {} در موجودی نیست
Could not open the camera: {} ⇒ دوربین باز نشد: {}
Cut {} ⇒ برش {}
Scan roll ⇒ اسکن رول
This roll is no longer in stock. Pick another. ⇒ این رول دیگر در موجودی نیست. رول دیگری انتخاب کنید.
Colour code ⇒ کد رنگ
No rolls of {} in stock. ⇒ از {} رولی در موجودی نیست.
Open rolls first, smallest first ⇒ اول رول‌های باز، از کوچک به بزرگ
Full rolls, oldest first ⇒ رول‌های کامل، قدیمی‌ترین اول
Suggested ⇒ پیشنهادی
Cut {} of {}, {} written off ⇒ {1} از {2} برش خورد، {3} دورریز شد
Cut {} of {}, {} left ⇒ {1} از {2} برش خورد، {3} مانده
Cut {} of {}, roll used up ⇒ {1} از {2} برش خورد، رول تمام شد
Could not cut ⇒ برش انجام نشد
Change roll ⇒ تغییر رول
Invoice no. (optional) ⇒ شماره فاکتور (اختیاری)
Length ⇒ طول
Length ({}) ⇒ طول ({})
Only {} on this roll. Pick a bigger roll or cut less. ⇒ فقط {} روی این رول است. رول بزرگ‌تری انتخاب کنید یا کمتر ببرید.
Left on this roll after the cut ⇒ باقی‌مانده روی این رول بعد از برش
✂ Cut & print customer label ⇒ ✂ برش و چاپ لیبل مشتری
✂ Cut ⇒ ✂ برش
Enter the customer to cut. ⇒ برای برش، مشتری را وارد کنید.
Print remainder label ({}) ⇒ چاپ لیبل باقی‌مانده ({})
Report damage on this roll ⇒ ثبت خرابی روی این رول
Only {} would be left ⇒ فقط {} باقی می‌ماند
That is below the short-end limit ({} m in Settings). What should happen to the end? ⇒ این کمتر از حد ته‌رول کوتاه ({} متر در تنظیمات) است. با ته رول چه شود؟
Give the whole roll to this customer ⇒ کل رول به این مشتری داده شود
{} on the label ⇒ {} روی لیبل
Cut as asked, write off the end as waste ⇒ همان‌قدر که خواسته شد برش بخورد، ته رول دورریز ثبت شود
Logged under Waste with your name ⇒ با نام شما در دورریز ثبت می‌شود
Cut as asked, keep the end in stock ⇒ همان‌قدر که خواسته شد برش بخورد، ته رول در موجودی بماند
Stays as an open roll ⇒ به‌صورت رول باز می‌ماند
Customer label not printed yet ⇒ لیبل مشتری هنوز چاپ نشده
Print customer label ⇒ چاپ لیبل مشتری
Torn ⇒ پارگی
Stained ⇒ لکه
Water damage ⇒ آب‌خوردگی
Crushed core ⇒ له‌شدن مغزی رول
Factory defect ⇒ عیب کارخانه
Other ⇒ سایر
Report damage ⇒ ثبت خرابی
{} on the roll ⇒ {} روی رول
Damaged length ⇒ طول خراب
Damaged length ({}) ⇒ طول خراب ({})
Whole roll ({}) ⇒ کل رول ({})
Only {} on this roll. ⇒ فقط {} روی این رول است.
What happened ⇒ چه اتفاقی افتاد
Note (optional) ⇒ یادداشت (اختیاری)
Report this damage? ⇒ این خرابی ثبت شود؟
{} of {} ({}): {}. It leaves the stock and shows in Reports under Damage. An admin can undo it later. ⇒ {1} از {2} ({3}): {4}. از موجودی خارج می‌شود و در گزارش‌ها زیر «خرابی» دیده می‌شود. مدیر بعداً می‌تواند آن را لغو کند.
It leaves the stock and shows in Reports under Damage. An admin can undo it later. ⇒ از موجودی خارج می‌شود و در گزارش‌ها زیر «خرابی» دیده می‌شود. مدیر بعداً می‌تواند آن را لغو کند.
Damage reported: {} of {} ⇒ خرابی ثبت شد: {1} از {2}
Could not report the damage ⇒ ثبت خرابی انجام نشد
Damage ⇒ خرابی
Report ⇒ گزارش
Scan label ⇒ اسکن لیبل
Or type the label ID, e.g. ZX-251009-A0007 ⇒ یا شناسه‌ی لیبل را تایپ کنید، مثلاً ZX-251009-A0007
In stock ⇒ در موجودی
Shipped ⇒ خارج شده
Deleted ⇒ حذف‌شده
Left on this {} ⇒ باقی‌مانده روی این {}
roll ⇒ رول
gallon ⇒ گالن
bag ⇒ کیسه
carton ⇒ کارتن
pack ⇒ بسته
sheet ⇒ ورق
rolls ⇒ رول
cartons ⇒ کارتن
bags ⇒ کیسه
gallons ⇒ گالن
packs ⇒ بسته
Pallet {} ⇒ پالت {}
This label was deleted as a mistake. Do not use it. ⇒ این لیبل به‌خاطر اشتباه حذف شده. از آن استفاده نکنید.
This label was already shipped out. ⇒ این لیبل قبلاً خارج شده است.
{} ({}) came in on {}. Ship that one first if you can. ⇒ {1} ({2}) در {3} وارد شده. اگر می‌توانید اول آن را خارج کنید.
{} ({}) came in on {}, pallet {}. Ship that one first if you can. ⇒ {1} ({2}) در {3} وارد شده، پالت {4}. اگر می‌توانید اول آن را خارج کنید.
{} ({}) came in on {}, at {}. Ship that one first if you can. ⇒ {1} ({2}) در {3} وارد شده، در {4}. اگر می‌توانید اول آن را خارج کنید.
{} ({}) came in on {}, pallet {}, at {}. Ship that one first if you can. ⇒ {1} ({2}) در {3} وارد شده، پالت {4}، در {5}. اگر می‌توانید اول آن را خارج کنید.
Older {} available ⇒ {} قدیمی‌تر موجود است
{} to ship ⇒ {} برای خروج
Enter the customer to ship out. ⇒ برای خروج، مشتری را وارد کنید.
Shipped {} of {} ⇒ {1} از {2} خارج شد
Shipped {} of {}, {} left ⇒ {1} از {2} خارج شد، {3} مانده
Could not ship out ⇒ خروج انجام نشد
Confirm ship out ⇒ تأیید خروج
Move to another place ⇒ جابه‌جایی به مکان دیگر
Shipped and cut this session ⇒ خروج‌ها و برش‌های این نشست
Move {} ⇒ جابه‌جایی {}
Move all {} of {} ⇒ جابه‌جایی همه‌ی {1} مورد از {2}
Move all {} of {}? ⇒ جابه‌جایی همه‌ی {1} مورد از {2}؟
{} moved to {} ⇒ {1} به {2} منتقل شد
Undone {}: new open roll {} with {} of {} ⇒ {1} لغو شد: رول باز جدید {2} با {3} از {4}
Undone {}: {} of {} is back in stock ⇒ {1} لغو شد: {2} از {3} به موجودی برگشت
Could not undo ⇒ لغو انجام نشد
Written off ⇒ دورریز شده
Damaged ⇒ خراب
Shipped {} ⇒ خروج {}
Written off {} ⇒ دورریز {}
Damaged {} ⇒ خرابی {}
Taken from this label ⇒ برداشت‌شده از این لیبل
Move by scan ⇒ جابه‌جایی با اسکن
Search code, label ID or colour ⇒ جستجوی کد، شناسه‌ی لیبل یا رنگ
All groups ⇒ همه‌ی گروه‌ها
Open rolls ({}) ⇒ رول‌های باز ({})
All places ⇒ همه‌ی مکان‌ها
{} codes in stock ⇒ {} کد در موجودی
{} codes in {} ⇒ {1} کد در {2}
open rolls only ⇒ فقط رول‌های باز
Delete all {} of {}? ⇒ حذف همه‌ی {1} مورد از {2}؟
Delete all {} ⇒ حذف همه‌ی {}
Move all {} ⇒ جابه‌جایی همه‌ی {}
Delete {}? ⇒ {} حذف شود؟
Save changes to {}? ⇒ تغییرات {} ذخیره شود؟
Save changes to {} labels? ⇒ تغییرات {} لیبل ذخیره شود؟
Saved {} label(s) ⇒ {} لیبل ذخیره شد
Could not save ⇒ ذخیره انجام نشد
Print new labels? ⇒ لیبل‌های جدید چاپ شوند؟
The code, size or unit on {} printed label(s) is now different. Print new labels and stick them over the old ones. ⇒ کد، سایز یا واحد روی {} لیبل چاپ‌شده حالا فرق دارد. لیبل‌های جدید را چاپ کنید و روی قدیمی‌ها بچسبانید.
Print {} ⇒ چاپ {}
Use this only for labels entered by mistake. They leave stock and the Stock tab of the sheet ⇒ این را فقط برای لیبل‌هایی که اشتباه ثبت شده‌اند به کار ببرید. از موجودی و تب Stock شیت خارج می‌شوند
and stay in the Items tab marked VOID. Throw the printed label away. ⇒ و در تب Items با علامت VOID می‌مانند. لیبل چاپ‌شده را دور بیندازید.
If it came from a packing list, it goes back to "to print" in Receive. ⇒ اگر از یک پکینگ‌لیست آمده بود، در بخش ورود کالا به «برای چاپ» برمی‌گردد.
Today ⇒ امروز
Yesterday ⇒ دیروز
Last 7 days ⇒ ۷ روز گذشته
This month ⇒ این ماه
Pick dates… ⇒ انتخاب تاریخ…
Search customer, invoice or code ⇒ جستجوی مشتری، فاکتور یا کد
All users ⇒ همه‌ی کاربران
Nothing shipped in this period. ⇒ در این بازه خروجی ثبت نشده.
Nothing cut in this period. ⇒ در این بازه برشی ثبت نشده.
Nothing written off in this period. ⇒ در این بازه دورریزی ثبت نشده.
Nothing damaged in this period. ⇒ در این بازه خرابی ثبت نشده.
Nothing received in this period. ⇒ در این بازه ورودی ثبت نشده.
Nothing deleted in this period. ⇒ در این بازه چیزی حذف نشده.
Nothing moved in this period. ⇒ در این بازه جابه‌جایی ثبت نشده.
Nothing edited in this period. ⇒ در این بازه ویرایشی ثبت نشده.
Nothing {} matches "{}" in this period. ⇒ در این بازه چیزی با «{2}» مطابقت ندارد.
Nothing matches "{}" in this period. ⇒ در این بازه چیزی با «{}» مطابقت ندارد.
Nothing happened in this period. ⇒ در این بازه چیزی ثبت نشده.
Total ⇒ جمع
Includes other phones after they sync. ⇒ شامل گوشی‌های دیگر پس از همگام‌سازی.
By customer ⇒ بر اساس مشتری
{} cuts ⇒ {} برش
{} cut ⇒ {} برش
Inv {} ⇒ فاکتور {}
by {} ⇒ توسط {}
To: {} ⇒ به: {}
By: {} ⇒ توسط: {}
{} (cut) ⇒ {} (برش)
Everything in this period ⇒ همه‌ی ثبت‌های این بازه
Tap a line to see only that kind. ⇒ روی یک خط بزنید تا فقط همان نوع را ببینید.
UNDONE ⇒ لغوشده
undone by {} ⇒ لغو توسط {}
Undone in this period ({}) ⇒ لغوشده‌ها در این بازه ({})
not counted above ⇒ در جمع‌های بالا حساب نشده
Sync to include other phones ⇒ همگام‌سازی برای گرفتن گوشی‌های دیگر
New open roll {}: {} of {} ⇒ رول باز جدید {1}: {2} از {3}
Ship-outs ⇒ خروج‌ها
Cuts ⇒ برش‌ها
Waste ⇒ دورریز
Received ⇒ ورود
Moved ⇒ جابه‌جایی
Edited ⇒ ویرایش
Ship-out ⇒ خروج
Not in this phone. Sync and scan again. ⇒ روی این گوشی نیست. همگام‌سازی کنید و دوباره اسکن کنید.
already in {} ⇒ از قبل در {}
from {} ⇒ از {}
Move to ⇒ جابه‌جایی به
Keep scanning ⇒ ادامه‌ی اسکن
The camera opens again after each roll. Press Back on the camera to stop. ⇒ دوربین بعد از هر رول دوباره باز می‌شود. برای توقف روی دوربین Back بزنید.
Choose where to move first ⇒ اول مقصد جابه‌جایی را انتخاب کنید
Scan rolls to move to {} ⇒ رول‌ها را اسکن کنید تا به {} بروند
Or type the label ID ⇒ یا شناسه‌ی لیبل را تایپ کنید
{} moved to {} ⇒ {1} به {2} منتقل شد
{} scanned ⇒ {} اسکن شد
Moved back to {} ⇒ به {} برگشت
Move back ⇒ برگرداندن
Category ⇒ دسته
Code ⇒ کد
Size ⇒ سایز
Unit ⇒ واحد
Edit {} ⇒ ویرایش {}
Edit {} labels of {} ⇒ ویرایش {1} لیبل از {2}
Code, size and unit are printed on the label. After saving you can print new labels. ⇒ کد، سایز و واحد روی لیبل چاپ می‌شود. بعد از ذخیره می‌توانید لیبل‌های جدید چاپ کنید.
Quantities and history stay as they are. The change is logged under Reports → Edited with your name. ⇒ مقدارها و تاریخچه همان می‌مانند. تغییر با نام شما در گزارش‌ها ← ویرایش ثبت می‌شود.
PVC film ⇒ فیلم PVC
Edge banding ⇒ نوار لبه
Vacuum glue ⇒ چسب وکیوم
Edge banding glue ⇒ چسب نوار لبه
Hinge ⇒ لولا
Rail ⇒ ریل
{} ({}) ⇒ {1} ({2})
"""
}

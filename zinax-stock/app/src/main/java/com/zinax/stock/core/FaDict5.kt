package com.zinax.stock.core

/** Messages and errors from the data layer, printer and sync, request summaries, report lines. */
internal object FaDict5 {
    const val TEXT = """
Enter the customer ⇒ مشتری را وارد کنید
Unknown label {} ⇒ لیبل {} شناخته نشد
{} was already shipped ⇒ {} قبلاً خارج شده بود
Enter a quantity above zero ⇒ مقداری بیشتر از صفر وارد کنید
Only {} {} left on {} ⇒ فقط {1} {2} روی {3} مانده است
Enter a length above zero ⇒ طولی بیشتر از صفر وارد کنید
Only {} left on {} ⇒ فقط {1} روی {2} مانده است
Short end ⇒ ته رول کوتاه
Ship-out not found ⇒ خروج پیدا نشد
Only ship-outs, cuts, waste and damage reports can be undone ⇒ فقط خروج، برش، دورریز و گزارش خرابی قابل لغو است
This was already undone ⇒ این قبلاً لغو شده است
Label {} not found ⇒ لیبل {} پیدا نشد
{} was deleted ⇒ {} حذف شده بود
Pick a reason ⇒ یک دلیل انتخاب کنید
Enter a code ⇒ کد را وارد کنید
Enter a unit ⇒ واحد را وارد کنید
Enter a name ⇒ نام را وارد کنید
{} {} is already in {} ⇒ {1} {2} از قبل در {3} هست
There is already a group called {} ⇒ از قبل گروهی به نام {} هست
Other cannot be removed ⇒ «سایر» را نمی‌شود حذف کرد
PIN must be {} to {} digits ⇒ رمز باید {1} تا {2} رقم باشد
There is already a user called {} ⇒ از قبل کاربری به نام {} هست
User not found ⇒ کاربر پیدا نشد
Keep at least one active admin ⇒ دست‌کم یک مدیر فعال باید بماند
Already waiting for an admin ⇒ قبلاً منتظر مدیر است
Nothing in stock to delete ⇒ چیزی در موجودی برای حذف نیست
Nothing would change ⇒ چیزی عوض نمی‌شود
Request not found ⇒ درخواست پیدا نشد
{}'s change has not reached this phone yet. Sync and try again. ⇒ تغییر {} هنوز به این گوشی نرسیده. همگام‌سازی کنید و دوباره امتحان کنید.
The damage details did not reach this phone. Update the Apps Script and sync. ⇒ جزئیات خرابی به این گوشی نرسید. Apps Script را به‌روز کنید و همگام‌سازی کنید.
The new values did not reach this phone. Update the Apps Script to 2.1.0 and sync. ⇒ مقدارهای جدید به این گوشی نرسید. Apps Script را به نسخه‌ی 2.1.0 به‌روز کنید و همگام‌سازی کنید.
Unknown request ⇒ درخواست ناشناخته
Undo {} {} of {} ({}) ⇒ لغو {1} {2} از {3} ({4})
Undo {} {} of {} ({}) to {} ⇒ لغو {1} {2} از {3} ({4}) برای {5}
Undo {} {} of {} ({}) (done by {}) ⇒ لغو {1} {2} از {3} ({4}) (انجام‌شده توسط {5})
Undo {} {} of {} ({}) to {} (done by {}) ⇒ لغو {1} {2} از {3} ({4}) برای {5} (انجام‌شده توسط {6})
{} (done by {}) ⇒ {1} (انجام‌شده توسط {2})
Damage {} of {} ({}): {} ⇒ خرابی {1} از {2} ({3}): {4}
Delete {} labels of {} ⇒ حذف {1} لیبل از {2}
Edit {}: {} ⇒ ویرایش {1}: {2}
Edit {} labels of {}: {} ⇒ ویرایش {1} لیبل از {2}: {3}
Category {} → {} ⇒ دسته {1} → {2}
Code {} → {} ⇒ کد {1} → {2}
Size {} → {} ⇒ سایز {1} → {2}
Unit {} → {} ⇒ واحد {1} → {2}
{} package ⇒ {} بسته
{} packages ⇒ {} بسته
{} ({} cut) ⇒ {1} ({2} برش)
Allow Nearby devices (Bluetooth) for Zinax Stock in Android settings. ⇒ در تنظیمات اندروید دسترسی «دستگاه‌های اطراف (بلوتوث)» را به زیناکس استوک بدهید.
This phone has no Bluetooth. ⇒ این گوشی بلوتوث ندارد.
Turn on Bluetooth and try again. ⇒ بلوتوث را روشن کنید و دوباره امتحان کنید.
Printer not found. Check it is on, in range and not printing for another phone. ⇒ پرینتر پیدا نشد. مطمئن شوید روشن است، در برد است و برای گوشی دیگری چاپ نمی‌کند.
No printer selected. Pick the XP-420B in Settings. ⇒ پرینتری انتخاب نشده. XP-420B را در تنظیمات انتخاب کنید.
No printer selected. Pick the XP-420B first. ⇒ پرینتری انتخاب نشده. اول XP-420B را انتخاب کنید.
Printing cancelled. ⇒ چاپ لغو شد.
Printing failed. ⇒ چاپ ناموفق بود.
Wait until printing has finished. ⇒ صبر کنید تا چاپ تمام شود.
Calibrating: the printer feeds a few labels and stops at the start of one. Then print a test label. ⇒ در حال کالیبره: پرینتر چند لیبل جلو می‌برد و سر یک لیبل می‌ایستد. بعد یک لیبل آزمایشی چاپ کنید.
Could not reach the printer. ⇒ به پرینتر وصل نشد.
Add the web app URL and token in Settings to sync. ⇒ برای همگام‌سازی آدرس وب‌اپ و توکن را در تنظیمات وارد کنید.
Add the web app URL and token first. ⇒ اول آدرس وب‌اپ و توکن را وارد کنید.
Unknown action ⇒ عملیات ناشناخته
Update the Apps Script to version 1.9.0 and deploy a new version first. ⇒ اول Apps Script را به نسخه‌ی 1.9.0 به‌روز کنید و یک نسخه‌ی جدید Deploy کنید.
Wrong admin code ⇒ کد مدیر اشتباه است
Wrong token. Copy it again from the Apps Script log. ⇒ توکن اشتباه است. دوباره از لاگ Apps Script کپی کنید.
The web app asks for a Google sign-in. In Apps Script set the deployment's "Who has access" to Anyone. ⇒ وب‌اپ ورود با گوگل می‌خواهد. در Apps Script گزینه‌ی «Who has access» را روی Anyone بگذارید.
The web app did not return data. Check the Web app URL in Settings and deploy a new version of the script. ⇒ وب‌اپ داده‌ای برنگرداند. آدرس وب‌اپ را در تنظیمات بررسی کنید و یک نسخه‌ی جدید از اسکریپت Deploy کنید.
Web app not found (404). In Apps Script open Deploy → Manage deployments, copy the Web app URL of the active deployment and paste it in Settings → Google Sheet. ⇒ وب‌اپ پیدا نشد (404). در Apps Script به Deploy ← Manage deployments بروید، آدرس وب‌اپ همان Deployment فعال را کپی کنید و در تنظیمات ← گوگل‌شیت بگذارید.
No access to the web app ({}). The deployment must run as Me with "Who has access" set to Anyone. ⇒ دسترسی به وب‌اپ نیست ({}). Deployment باید با «Me» اجرا شود و «Who has access» روی Anyone باشد.
Google is busy (429). The app tries again by itself in a minute. ⇒ گوگل مشغول است (429). برنامه یک دقیقه‌ی دیگر خودش دوباره امتحان می‌کند.
Google had a problem ({}). The app tries again by itself in a minute. ⇒ گوگل مشکل داشت ({}). برنامه یک دقیقه‌ی دیگر خودش دوباره امتحان می‌کند.
The web app answered with error {} ⇒ وب‌اپ با خطای {} پاسخ داد
Bad request ⇒ درخواست نامعتبر
Shipment name ⇒ نام محموله
Manual ⇒ دستی
{} of {} ⇒ {1} از {2}
Delete {} ⇒ حذف {}
"""
}

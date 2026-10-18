package com.zinax.stock.core

/** Messages and errors from the data layer, printer and sync, request summaries, report lines. */
internal object ArDict5 {
    const val TEXT = """
Enter the customer ⇒ أدخل العميل
Unknown label {} ⇒ ملصق غير معروف {}
{} was already shipped ⇒ سبق إخراج {}
Enter a quantity above zero ⇒ أدخل كمية أكبر من الصفر
Only {} {} left on {} ⇒ تبقّى {1} {2} فقط على {3}
Enter a length above zero ⇒ أدخل طولاً أكبر من الصفر
Only {} left on {} ⇒ تبقّى {1} فقط على {2}
Short end ⇒ طرف قصير
Ship-out not found ⇒ لم يُعثر على الإخراج
Only ship-outs, cuts, waste and damage reports can be undone ⇒ يمكن التراجع فقط عن الإخراج والقطع والهدر وتقارير التلف
This was already undone ⇒ سبق التراجع عن هذا
Label {} not found ⇒ لم يُعثر على الملصق {}
{} was deleted ⇒ تم حذف {}
Pick a reason ⇒ اختر سبباً
Enter a code ⇒ أدخل الرمز
Enter a unit ⇒ أدخل الوحدة
Enter a name ⇒ أدخل الاسم
{} {} is already in {} ⇒ {1} {2} موجود أصلاً في {3}
There is already a group called {} ⇒ توجد مجموعة باسم {} بالفعل
Other cannot be removed ⇒ لا يمكن حذف «أخرى»
PIN must be {} to {} digits ⇒ يجب أن يكون الرمز السري من {1} إلى {2} أرقام
There is already a user called {} ⇒ يوجد مستخدم باسم {} بالفعل
User not found ⇒ لم يُعثر على المستخدم
Keep at least one active admin ⇒ أبقِ مديراً نشطاً واحداً على الأقل
Already waiting for an admin ⇒ بانتظار المدير بالفعل
Nothing in stock to delete ⇒ لا شيء في المخزون للحذف
Nothing would change ⇒ لن يتغير شيء
Request not found ⇒ لم يُعثر على الطلب
{}'s change has not reached this phone yet. Sync and try again. ⇒ لم يصل تغيير {} إلى هذا الهاتف بعد. زامن وحاول مرة أخرى.
The damage details did not reach this phone. Update the Apps Script and sync. ⇒ لم تصل تفاصيل التلف إلى هذا الهاتف. حدّث Apps Script وزامن.
The new values did not reach this phone. Update the Apps Script to 2.1.0 and sync. ⇒ لم تصل القيم الجديدة إلى هذا الهاتف. حدّث Apps Script إلى الإصدار 2.1.0 وزامن.
Unknown request ⇒ طلب غير معروف
Undo {} {} of {} ({}) ⇒ تراجع عن {1} {2} من {3} ({4})
Undo {} {} of {} ({}) to {} ⇒ تراجع عن {1} {2} من {3} ({4}) إلى {5}
Undo {} {} of {} ({}) (done by {}) ⇒ تراجع عن {1} {2} من {3} ({4}) (نفّذه {5})
Undo {} {} of {} ({}) to {} (done by {}) ⇒ تراجع عن {1} {2} من {3} ({4}) إلى {5} (نفّذه {6})
{} (done by {}) ⇒ {1} (نفّذه {2})
Damage {} of {} ({}): {} ⇒ تلف {1} من {2} ({3}): {4}
Delete {} labels of {} ⇒ حذف {1} ملصق من {2}
Edit {}: {} ⇒ تعديل {1}: {2}
Edit {} labels of {}: {} ⇒ تعديل {1} ملصق من {2}: {3}
Category {} → {} ⇒ الفئة {1} → {2}
Code {} → {} ⇒ الرمز {1} → {2}
Size {} → {} ⇒ المقاس {1} → {2}
Unit {} → {} ⇒ الوحدة {1} → {2}
{} package ⇒ {} طرد
{} packages ⇒ {} طرد
{} ({} cut) ⇒ {1} ({2} قطع)
Allow Nearby devices (Bluetooth) for Zinax Stock in Android settings. ⇒ اسمح بإذن «الأجهزة القريبة (بلوتوث)» لزيناكس ستوك من إعدادات أندرويد.
This phone has no Bluetooth. ⇒ هذا الهاتف ليس فيه بلوتوث.
Turn on Bluetooth and try again. ⇒ شغّل البلوتوث وحاول مرة أخرى.
Printer not found. Check it is on, in range and not printing for another phone. ⇒ لم تُوجد الطابعة. تأكد أنها تعمل وفي النطاق ولا تطبع لهاتف آخر.
No printer selected. Pick the XP-420B in Settings. ⇒ لم تُختر طابعة. اختر XP-420B من الإعدادات.
No printer selected. Pick the XP-420B first. ⇒ لم تُختر طابعة. اختر XP-420B أولاً.
Printing cancelled. ⇒ أُلغيت الطباعة.
Printing failed. ⇒ فشلت الطباعة.
Wait until printing has finished. ⇒ انتظر حتى تنتهي الطباعة.
Calibrating: the printer feeds a few labels and stops at the start of one. Then print a test label. ⇒ جارٍ المعايرة: تسحب الطابعة بضعة ملصقات وتتوقف عند بداية ملصق. بعدها اطبع ملصقاً تجريبياً.
Could not reach the printer. ⇒ تعذر الوصول إلى الطابعة.
Add the web app URL and token in Settings to sync. ⇒ أضف رابط تطبيق الويب والتوكن في الإعدادات للمزامنة.
Add the web app URL and token first. ⇒ أضف رابط تطبيق الويب والتوكن أولاً.
Unknown action ⇒ إجراء غير معروف
Update the Apps Script to version 1.9.0 and deploy a new version first. ⇒ حدّث Apps Script إلى الإصدار 1.9.0 وانشر نسخة جديدة أولاً.
Wrong admin code ⇒ رمز المدير خاطئ
Wrong token. Copy it again from the Apps Script log. ⇒ التوكن خاطئ. انسخه من جديد من سجل Apps Script.
The web app asks for a Google sign-in. In Apps Script set the deployment's "Who has access" to Anyone. ⇒ يطلب تطبيق الويب تسجيل الدخول إلى Google. في Apps Script اجعل «Who has access» للنشر Anyone.
The web app did not return data. Check the Web app URL in Settings and deploy a new version of the script. ⇒ لم يُرجع تطبيق الويب بيانات. تحقق من رابط تطبيق الويب في الإعدادات وانشر نسخة جديدة من السكربت.
Web app not found (404). In Apps Script open Deploy → Manage deployments, copy the Web app URL of the active deployment and paste it in Settings → Google Sheet. ⇒ لم يُعثر على تطبيق الويب (404). في Apps Script افتح Deploy ← Manage deployments وانسخ رابط تطبيق الويب للنشر النشط والصقه في الإعدادات ← Google Sheet.
No access to the web app ({}). The deployment must run as Me with "Who has access" set to Anyone. ⇒ لا يوجد وصول إلى تطبيق الويب ({}). يجب أن يعمل النشر بصفة Me وأن يكون «Who has access» على Anyone.
Google is busy (429). The app tries again by itself in a minute. ⇒ Google مشغول (429). يعيد التطبيق المحاولة تلقائياً بعد دقيقة.
Google had a problem ({}). The app tries again by itself in a minute. ⇒ حدثت مشكلة في Google ({}). يعيد التطبيق المحاولة تلقائياً بعد دقيقة.
The web app answered with error {} ⇒ ردّ تطبيق الويب بالخطأ {}
Bad request ⇒ طلب غير صالح
Receive by scan ⇒ الاستلام بالمسح
No supplier-labelled list yet. Import the carton labels file with Import list first, then wait for it to sync to the other phones. ⇒ لا توجد قائمة بملصقات المورّد بعد. استورد ملف ملصقات الكراتين عبر Import list أولاً ثم انتظر مزامنتها مع الهواتف الأخرى.
{} of {} cartons received ⇒ {1} من {2} كرتون تم استلامها
The camera opens again after each carton. Press Back on the camera to stop. ⇒ تُفتح الكاميرا مجدداً بعد كل كرتون. اضغط Back في الكاميرا للإيقاف.
Scan cartons ⇒ مسح الكراتين
Not in any imported list. Check the list was imported and synced. ⇒ غير موجود في أي قائمة مستوردة. تأكد من استيراد القائمة ومزامنتها.
already received ⇒ تم استلامه سابقاً
Hide cartons not received ⇒ إخفاء الكراتين غير المستلمة
Show {} cartons not received ⇒ عرض {} كرتون غير مستلمة
Receiving · {} scanned · Back to stop ⇒ جارٍ الاستلام · {1} تم مسحها · للإيقاف Back
Count ⇒ جرد
Stock count ⇒ جرد المخزون
Place to count ⇒ مكان الجرد
{}: {} packages in the app ⇒ {1}: {2} طرد في التطبيق
Scan every label on the shelves of this place. Press Back on the camera to stop. ⇒ امسح كل ملصق على رفوف هذا المكان. اضغط Back في الكاميرا للإيقاف.
Scan labels ⇒ مسح الملصقات
already counted ⇒ تم عدّه سابقاً
not in this phone ⇒ غير موجود في هذا الهاتف
recorded as shipped ⇒ مسجّل كمشحون
recorded as deleted ⇒ مسجّل كمحذوف
recorded in {} ⇒ مسجّل في {}
Found {} of {} ⇒ وُجد {1} من {2}
All found ⇒ وُجد الكل
Extra {} ⇒ زائد {}
Missing {} ⇒ مفقود {}
Move here ⇒ نقل إلى هنا
Look for missing packages in other places first: scanning them there shows them as extra. Remove only those that are really gone. ⇒ ابحث عن الطرود المفقودة في الأماكن الأخرى أولاً: مسحها هناك يظهرها كزائدة. احذف فقط ما فُقد فعلاً.
Remove {} missing from stock ⇒ حذف {} مفقود من المخزون
Send count result ⇒ إرسال نتيجة الجرد
Finish and start a new count ⇒ إنهاء وبدء جرد جديد
Start a new count? ⇒ بدء جرد جديد؟
The {} labels scanned in {} will be cleared. ⇒ سيتم مسح {1} ملصق ممسوح في {2}.
Start new count ⇒ بدء جرد جديد
Finish this count? ⇒ إنهاء هذا الجرد؟
Send the result first if you need it. The scanned list will be cleared. ⇒ أرسل النتيجة أولاً إذا احتجتها. سيتم مسح قائمة المسح.
Finish ⇒ إنهاء
Remove {} missing ⇒ حذف {} مفقود
Use this only for packages that are really gone. They leave stock and stay in the Items tab of the sheet marked VOID. ⇒ استخدمه فقط للطرود المفقودة فعلاً. تخرج من المخزون وتبقى في ورقة Items بعلامة VOID.
Counting {} · {} scanned · Back to stop ⇒ جارٍ جرد {1} · {2} تم مسحها · للإيقاف Back
History ⇒ السجل
Shipped out ⇒ تم الشحن
Left ⇒ المتبقي
Place ⇒ المكان
Shipment ⇒ الشحنة
Pallet ⇒ المنصة
Received by ⇒ استلمه
Scan a label ⇒ مسح ملصق
Label history ⇒ سجل الملصق
Scan a label to see its history ⇒ امسح ملصقاً لرؤية سجله
{} is not in this phone. Sync and scan again. ⇒ {} غير موجود في هذا الهاتف. زامن وامسح مجدداً.
open ⇒ مفتوح
No history on this phone yet. Sync to get it. ⇒ لا يوجد سجل في هذا الهاتف بعد. زامن للحصول عليه.
Undone by {} ⇒ أُلغي بواسطة {}
phone {} ⇒ الهاتف {}
No sheet backup yet. In Apps Script run setup once to start the nightly backup. ⇒ لا توجد نسخة احتياطية للورقة بعد. في Apps Script شغّل setup مرة واحدة لبدء النسخ الليلي.
Last sheet backup {} ⇒ آخر نسخة احتياطية للورقة {}
more than 2 days ago ⇒ منذ أكثر من يومين
"""
}

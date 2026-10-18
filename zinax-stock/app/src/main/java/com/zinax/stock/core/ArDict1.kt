package com.zinax.stock.core

/** Common words, Home, sign-in, users, approvals, requests, undo. */
internal object ArDict1 {
    const val TEXT = """
Cancel ⇒ إلغاء
Close ⇒ إغلاق
Save ⇒ حفظ
Add ⇒ إضافة
Edit ⇒ تعديل
Delete ⇒ حذف
Back ⇒ رجوع
Next ⇒ التالي
Yes ⇒ نعم
No ⇒ لا
OK ⇒ موافق
Search ⇒ بحث
Clear ⇒ مسح
All ⇒ الكل
Show ⇒ عرض
Retry ⇒ إعادة المحاولة
Skip ⇒ تخطي
Later ⇒ لاحقاً
Name ⇒ الاسم
Note ⇒ ملاحظة
Reason ⇒ السبب
Print ⇒ طباعة
Reprint ⇒ إعادة الطباعة
Move ⇒ نقل
Label ⇒ ملصق
Remainder ⇒ ملصق المتبقي
Unlock ⇒ فتح القفل
Lock ⇒ قفل
Admin ⇒ مدير
User ⇒ مستخدم
Zinax Stock ⇒ زيناكس ستوك
Receive ⇒ استلام البضاعة
Ship out ⇒ إخراج البضاعة
Cut ⇒ قطع
Stock ⇒ المخزون
Shipments ⇒ الشحنات
Reports ⇒ التقارير
Settings ⇒ الإعدادات
Requests ⇒ الطلبات
My requests ⇒ طلباتي
Requests ({}) ⇒ الطلبات ({})
My requests ({}) ⇒ طلباتي ({})
Sync now ⇒ مزامنة الآن
Send Excel ⇒ إرسال Excel
Send as text ⇒ إرسال كنص
Send report ⇒ إرسال التقرير
Only admins, or users allowed to receive, can do this ⇒ المدير أو المستخدم المسموح له باستلام البضاعة فقط يمكنه فعل ذلك
Daily {} ⇒ يومياً {}
Off ⇒ متوقف
The app closed unexpectedly ⇒ أُغلق التطبيق بشكل غير متوقع
The last time, Zinax Stock closed by itself. Send this report (for example on WhatsApp) so the problem can be fixed. ⇒ في المرة الأخيرة أُغلق التطبيق من تلقاء نفسه. أرسل هذا التقرير (مثلاً عبر واتساب) ليتم إصلاح المشكلة.
It contains only the error, the phone model and the app version. ⇒ يحتوي فقط على الخطأ وموديل الهاتف وإصدار التطبيق.
Sync failed ⇒ فشلت المزامنة
Sync failed {} ⇒ فشلت المزامنة {}
Sync failed {}: {} ⇒ فشلت المزامنة {1}: {2}
Synced {} · sent {} change(s) ⇒ تمت المزامنة {1} · أُرسل {2} تغيير
Syncing… ⇒ جارٍ المزامنة…
{} · Admin ⇒ {} · مدير
{} · User ⇒ {} · مستخدم
Printer: {} ⇒ الطابعة: {}
No printer ⇒ لا توجد طابعة
{} to sync ⇒ {} بانتظار المزامنة
Open a pallet, print labels ⇒ فتح باليت وطباعة الملصقات
Admin only ⇒ للمدير فقط
Scan or type a label ⇒ امسح أو اكتب ملصقاً
Metres for a customer ⇒ أمتار لعميل
{} packages ⇒ {} طرد
{} codes ⇒ {} رمز
{} open ⇒ {} مفتوح
{} full ⇒ {} كامل
None yet ⇒ لا شيء بعد
Out, cuts, waste, in, moved ⇒ خروج، قطع، هدر، دخول، نقل
Last receive {} ⇒ آخر استلام {}
WhatsApp {} ⇒ واتساب {}
Open Google Sheet ⇒ فتح Google Sheet
Google Sheet (set up in Settings) ⇒ Google Sheet (يُعدّ من الإعدادات)
Not available here ⇒ غير متاح هنا
No fingerprint or face set up on this phone ⇒ لم تُضبط بصمة أو وجه على هذا الهاتف
Use PIN ⇒ استخدام الرمز السري
Unlock Zinax Stock ⇒ فتح قفل زيناكس ستوك
Sign in as {} ⇒ الدخول باسم {}
Locked. Pick your name and enter your PIN. ⇒ مقفل. اختر اسمك وأدخل الرمز السري.
Fingerprint or face · {} ⇒ بصمة أو وجه · {}
PIN for {} ⇒ الرمز السري لـ {}
PIN of {} ⇒ الرمز السري لـ {}
PIN ⇒ الرمز السري
Wrong PIN ⇒ الرمز السري خاطئ
Too many wrong PINs. Wait 30 seconds. ⇒ محاولات خاطئة كثيرة. انتظر 30 ثانية.
{} ({} s) ⇒ {1} ({2} ث)
Forgot PIN? ⇒ نسيت الرمز السري؟
Sync to get new users ⇒ زامن للحصول على المستخدمين الجدد
Set a new PIN ⇒ تعيين رمز سري جديد
Needs the admin code from the Apps Script log (run setup to see it) and internet. ⇒ يحتاج رمز المدير من سجل Apps Script (شغّل setup لرؤيته) والإنترنت.
Admin code ⇒ رمز المدير
New PIN ({}–{} digits) ⇒ رمز سري جديد ({1}–{2} أرقام)
New PIN again ⇒ أعد الرمز السري الجديد
Could not check the code ⇒ تعذر التحقق من الرمز
Save PIN ⇒ حفظ الرمز السري
Set up users ⇒ إعداد المستخدمين
From this version everyone signs in with a PIN. Admins approve undo and delete, receive goods and change settings. ⇒ من هذا الإصدار يدخل الجميع بالرمز السري. المديرون يوافقون على التراجع والحذف ويستلمون البضاعة ويغيّرون الإعدادات.
1. Google Sheet ⇒ 1. Google Sheet
Web app URL (…/exec) ⇒ رابط تطبيق الويب (…/exec)
Token ⇒ التوكن
. No users in the sheet yet. ⇒ . لا يوجد مستخدمون في الشيت بعد.
Get users from the sheet ⇒ جلب المستخدمين من الشيت
If an admin already set up users on another phone, this is all you need. ⇒ إذا كان مدير قد أنشأ المستخدمين على هاتف آخر فهذا كل ما تحتاجه.
2. Or create the first admin ⇒ 2. أو أنشئ أول مدير
Your name ⇒ اسمك
PIN ({}–{} digits) ⇒ الرمز السري ({1}–{2} أرقام)
PIN again ⇒ أعد الرمز السري
The PINs are not the same ⇒ الرمزان غير متطابقين
Admin code from the Apps Script log ⇒ رمز المدير من سجل Apps Script
In Apps Script run setup once; the log shows the token and the admin code. ⇒ في Apps Script شغّل setup مرة واحدة؛ يعرض السجل التوكن ورمز المدير.
Could not create the admin ⇒ تعذر إنشاء المدير
Create admin and sign in ⇒ إنشاء المدير والدخول
Users ⇒ المستخدمون
Add user ⇒ إضافة مستخدم
Edit {} ⇒ تعديل {}
Shared with every phone and the Users tab of the sheet. Users can ship out, cut, move and print; ⇒ مشترك بين كل الهواتف وتبويب Users في الشيت. يستطيع المستخدمون الإخراج والقطع والنقل والطباعة؛
their undo and delete wait for an admin. Turn on Can receive for users who receive goods. ⇒ أما التراجع والحذف فينتظران المدير. فعّل «يمكنه الاستلام» للمستخدمين الذين يستلمون البضاعة.
can receive ⇒ يمكنه الاستلام
turned off ⇒ معطّل
Can receive goods and print labels ⇒ يمكنه استلام البضاعة وطباعة الملصقات
Active (can sign in) ⇒ نشط (يمكنه الدخول)
{} added. Tell them their PIN. ⇒ تمت إضافة {}. أخبره برمزه السري.
New PIN for {} ⇒ رمز سري جديد لـ {}
PIN changed for {} ⇒ تم تغيير الرمز السري لـ {}
PIN changed ⇒ تم تغيير الرمز السري
Current PIN ⇒ الرمز السري الحالي
Current PIN is wrong ⇒ الرمز السري الحالي خاطئ
Admin approves now ⇒ المدير يوافق الآن
Ask an admin ⇒ اطلب من مدير
Only an admin can do this. Nothing changes until an admin approves; they get a notification. ⇒ المدير فقط يمكنه ذلك. لن يتغير شيء حتى يوافق المدير؛ سيصله إشعار.
Reason (optional) ⇒ السبب (اختياري)
No admin on this phone yet. Sync and try again. ⇒ لا يوجد مدير على هذا الهاتف بعد. زامن وحاول مرة أخرى.
Done, approved by {} ⇒ تم، وافق {}
 · new open roll {} ⇒  · رول مفتوح جديد {}
Could not do it ⇒ تعذر التنفيذ
Approve and {} ⇒ موافقة و{}
Send to admin ⇒ إرسال إلى المدير
Send instead ⇒ أرسل بدلاً من ذلك
Admin is here ⇒ المدير هنا
Sent to the admins. It happens when one approves. ⇒ أُرسل إلى المديرين. يتم التنفيذ عندما يوافق أحدهم.
Sent to the admins. It happens when one approves ⇒ أُرسل إلى المديرين. يتم التنفيذ عندما يوافق أحدهم
Could not send ⇒ تعذر الإرسال
Already {} by {} ⇒ سبق أن {1} من قبل {2}
approved ⇒ وُوفق عليه
rejected ⇒ رُفض
Undo and delete asked by users. Approving does it now, in your name. ⇒ طلبات التراجع والحذف من المستخدمين. الموافقة تنفذها الآن باسمك.
Your undo and delete requests. ⇒ طلبات التراجع والحذف الخاصة بك.
Undo and delete requests waiting for an admin, and their answers ⇒ طلبات التراجع والحذف بانتظار المدير وردودها
Waiting ({}) ⇒ بالانتظار ({})
Nothing waiting. ⇒ لا شيء بالانتظار.
Approve ⇒ موافقة
Reject ⇒ رفض
Waiting for an admin ⇒ بانتظار المدير
Waiting for admin ⇒ بانتظار المدير
Answered ⇒ تم الرد عليها
Approved ⇒ تمت الموافقة
Rejected ⇒ تم الرفض
Approved by {} ⇒ وافق عليه {}
Rejected by {} ⇒ رفضه {}
Approved and done ⇒ تمت الموافقة والتنفيذ
Approved and done · new open roll {} ⇒ تمت الموافقة والتنفيذ · رول مفتوح جديد {}
Approve? ⇒ الموافقة؟
Reject? ⇒ الرفض؟
This is done now, in your name. ⇒ سيتم هذا الآن باسمك.
Note for {} (optional) ⇒ ملاحظة لـ {} (اختياري)
Approval needed · {} ⇒ مطلوب موافقة · {}
Undo this {}? ⇒ التراجع عن هذا {}؟
Undo {} ⇒ تراجع عن {}
Undo ⇒ تراجع
ship-out ⇒ إخراج
cut ⇒ قطع
write-off ⇒ هدر
damage report ⇒ تقرير التلف
undo ship-out ⇒ التراجع عن الإخراج
undo cut ⇒ التراجع عن القطع
undo write-off ⇒ التراجع عن الهدر
undo damage report ⇒ التراجع عن تقرير التلف
delete ⇒ الحذف
save ⇒ الحفظ
report damage ⇒ تسجيل التلف
becomes a new open roll with its own label (printed after the undo) and leaves the reports. ⇒ يصبح رولاً مفتوحاً جديداً بملصقه الخاص (يُطبع بعد التراجع) ويخرج من التقارير.
goes back into stock and leaves the reports. A part of a roll becomes a new open roll with its own label. ⇒ يعود إلى المخزون ويخرج من التقارير. وجزء من الرول يصبح رولاً مفتوحاً جديداً بملصقه الخاص.
The sheet keeps the {} with an UNDO line showing who cancelled it. ⇒ يحتفظ الشيت بـ {} مع سطر UNDO يبيّن من ألغاه.
"""
}

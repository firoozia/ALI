package com.zinax.stock.core

/** Settings, receive, shipments, print by hand, import. */
internal object ArDict4 {
    const val TEXT = """
Appearance ⇒ المظهر
Language ⇒ اللغة
Changes only colours and styling on this phone. Stock, users and settings stay the same. ⇒ يغيّر الألوان والمظهر فقط على هذا الهاتف. يبقى المخزون والمستخدمون والإعدادات كما هي.
Persian and Arabic change only the words of menus and messages on this phone. Layout, numbers, codes and printed labels stay the same. ⇒ الفارسية والعربية تغيّران كلمات القوائم والرسائل فقط على هذا الهاتف. يبقى التصميم والأرقام والرموز والملصقات المطبوعة كما هي.
Theme 1 · Teal ⇒ السمة 1 · أزرق مخضر
Theme 2 · Emerald ⇒ السمة 2 · زمردي
Printer ⇒ الطابعة
Allow Nearby devices so the app can see the printer. ⇒ اسمح بإذن «الأجهزة القريبة» ليرى التطبيق الطابعة.
Bluetooth is off. ⇒ البلوتوث متوقف.
No paired devices. Pair the XP-420B in Android Bluetooth settings first (PIN is usually 0000 or 1234). ⇒ لا توجد أجهزة مقترنة. اقرن XP-420B أولاً من إعدادات بلوتوث أندرويد (الرمز عادةً 0000 أو 1234).
Refresh paired devices ⇒ تحديث الأجهزة المقترنة
Gap mm ⇒ الفراغ بين الملصقات (مم)
Darkness 1–15 ⇒ الكثافة 1–15
Speed ⇒ السرعة
If barcodes print faint or patchy: Darkness 10–12 and Speed 2–3, then Print test label. ⇒ إذا طُبع الباركود باهتاً أو متقطعاً: اجعل الكثافة 10–12 والسرعة 2–3 ثم اضغط «طباعة ملصق تجريبي».
Clean the print head with alcohol if a white line runs through every label. ⇒ نظّف رأس الطباعة بالكحول إذا ظهر خط أبيض على كل الملصقات.
Rotate label 180° ⇒ تدوير الملصق 180°
Invert (if labels print as negatives) ⇒ عكس (إذا طُبعت الملصقات كنسخة سالبة)
Print test label ⇒ طباعة ملصق تجريبي
Calibrating… ⇒ جارٍ المعايرة…
Calibrate printer ⇒ معايرة الطابعة
Blank labels skipped between prints? Set the label size and gap to the real roll (measure with a ruler), ⇒ تُتخطى ملصقات فارغة أثناء الطباعة؟ اضبط مقاس الملصق والفراغ حسب الرول الفعلي (قِس بمسطرة)،
then Calibrate printer. Calibrate again after every new roll. ⇒ ثم اضغط «معايرة الطابعة». عاير مجدداً بعد كل رول جديد.
Print the customer label automatically after Cut ⇒ طباعة ملصق العميل تلقائياً بعد القطع
Print the customer label automatically after Ship out ⇒ طباعة ملصق العميل تلقائياً بعد الإخراج
Print a DAMAGED label automatically after Report damage ⇒ طباعة ملصق DAMAGED تلقائياً بعد تسجيل التلف
Print an OPEN label for the new roll when a cut is undone ⇒ طباعة ملصق OPEN للرول الجديد عند التراجع عن قطع
When a switch is off, a Print customer label button appears after each cut or ship out, and a Label button ⇒ عندما يكون المفتاح متوقفاً يظهر زر «طباعة ملصق العميل» بعد كل قطع أو إخراج، وزر «ملصق»
sits beside every earlier ship out, cut or damage report of a roll in Ship out. ⇒ بجانب كل إخراج أو قطع أو تقرير تلف سابق لرول في صفحة الإخراج.
Cut and Ship out both need a customer name. ⇒ القطع والإخراج كلاهما يحتاجان اسم العميل.
Locations ⇒ الأماكن
Places where goods are kept, e.g. Warehouse 1, Warehouse 2 - Floor 1, Showroom. ⇒ أماكن حفظ البضاعة، مثل Warehouse 1 وWarehouse 2 - Floor 1 وShowroom.
They appear as buttons on Receive, Print by hand and Stock. ⇒ تظهر كأزرار في استلام البضاعة والطباعة اليدوية والمخزون.
New location ⇒ مكان جديد
Cutting ⇒ القطع
Short end below ⇒ الطرف القصير أقل من
When a cut would leave less than this on the roll, the app asks: give the whole roll, ⇒ عندما يترك القطع أقل من هذا على الرول يسأل التطبيق: إعطاء الرول كاملاً،
write the end off as waste, or keep it. Set 0 to never ask. ⇒ أو تسجيل الطرف كهدر، أو إبقاؤه. ضع 0 كي لا يسأل أبداً.
Customers library ⇒ قائمة العملاء
This phone ⇒ هذا الهاتف
Signed in as {} ⇒ تم الدخول باسم {}
User, can receive ⇒ مستخدم، يمكنه الاستلام
Change my PIN ⇒ تغيير رمزي السري
Lock / switch user ⇒ قفل / تبديل المستخدم
Unlock with fingerprint or face as {} ⇒ فتح القفل بالبصمة أو الوجه باسم {}
Use fingerprint or face ⇒ استخدام البصمة أو الوجه
To unlock as {} on this phone ⇒ لفتح القفل باسم {} على هذا الهاتف
Anyone whose fingerprint or face is saved in this phone can then open the app as {}. ⇒ يمكن لأي شخص بصمته أو وجهه محفوظ في هذا الهاتف أن يفتح التطبيق باسم {}.
Only one person per phone; others use their PIN. ⇒ شخص واحد لكل هاتف؛ والآخرون يستخدمون رمزهم السري.
Device letter in label IDs (A, B, C… one per phone) ⇒ حرف الجهاز في أرقام الملصقات (A وB وC… واحد لكل هاتف)
Users and security ⇒ المستخدمون والأمان
Lock when leaving the app ⇒ القفل عند الخروج من التطبيق
Lock after minutes without use (0 = never) ⇒ القفل بعد دقائق دون استخدام (0 = أبداً)
For this phone. With both off the app stays open until someone taps the lock on Home. ⇒ لهذا الهاتف. إذا توقف الاثنان يبقى التطبيق مفتوحاً حتى يضغط أحدهم القفل في الصفحة الرئيسية.
Google Sheet ⇒ Google Sheet
Web app URL (…/exec) ⇒ رابط تطبيق الويب (…/exec)
Sheet link (filled in after the first sync) ⇒ رابط الشيت (يُملأ بعد أول مزامنة)
Open sheet ⇒ فتح الشيت
WhatsApp report ⇒ تقرير واتساب
Daily reminder to send the stock list ⇒ تذكير يومي بإرسال قائمة المخزون
Hour ⇒ الساعة
Minute ⇒ الدقيقة
Save time ⇒ حفظ الوقت
Reminder set for {} ⇒ تم ضبط التذكير على {}
Send the reminder report as an Excel file ⇒ إرسال تقرير التذكير كملف Excel
WhatsApp does not allow apps to post to a group by themselves. At this time the phone shows a notification; ⇒ لا يسمح واتساب للتطبيقات بالنشر في مجموعة من تلقاء نفسها. في هذا الوقت يعرض الهاتف إشعاراً؛
tap it, pick WhatsApp (or WhatsApp Business) in the share list, then pick the group. ⇒ اضغط عليه، واختر واتساب (أو واتساب للأعمال) من قائمة المشاركة، ثم اختر المجموعة.
Send stock Excel now ⇒ إرسال Excel المخزون الآن
Send stock list now ⇒ إرسال قائمة المخزون الآن
Receive · {} ⇒ استلام البضاعة · {}
Pallet {} ✓ ⇒ باليت {} ✓
Find a code on any pallet ⇒ ابحث عن رمز في أي باليت
Complete ⇒ مكتمل
This pallet has fewer? Print a smaller number ⇒ هذا الباليت أقل؟ اطبع عدداً أصغر
{} already printed ⇒ طُبع {} مسبقاً
All labels for pallet {} are printed. ⇒ طُبعت كل ملصقات الباليت {}.
Pallet {} complete ⇒ اكتمل الباليت {}
Pallet {} not finished ⇒ الباليت {} لم ينتهِ
{} still to print. ⇒ {} ما زال للطباعة.
+ Add an item that is not on the list ⇒ + إضافة بند غير موجود في القائمة
How many {} on pallet {}? ⇒ كم عدد {1} على الباليت {2}؟
Labels to print (max {}) ⇒ ملصقات للطباعة (الحد الأقصى {})
pallet {} ⇒ باليت {}
{} (reprint) ⇒ {} (إعادة طباعة)
No shipments yet. Import the packing list that came with the container. ⇒ لا توجد شحنات بعد. استورد قائمة التعبئة المرفقة مع الحاوية.
{} pallets ⇒ {} باليت
{} of {} labelled ⇒ {1} من {2} عليها ملصقات
Shipment check ⇒ مراجعة الشحنة
{} / {} labelled ⇒ {1} / {2} عليها ملصقات
Every package on the list has a label. ⇒ كل طرد في القائمة له ملصق.
All correct ⇒ كله صحيح
{} package(s) of {} code(s) have no label yet. They were not found on the pallets opened so far. ⇒ {1} طرد من {2} رمز بلا ملصق بعد. لم تُوجد في الباليتات المفتوحة حتى الآن.
Missing ⇒ ناقص
{} missing ⇒ ينقص {}
{} expected ⇒ {} متوقع
{} labelled ⇒ {} عليها ملصقات
{} not on the list ⇒ {} ليست في القائمة
Added by hand ⇒ أُضيف يدوياً
Extra ⇒ زائد
Share report ⇒ مشاركة التقرير
Add item to shipment ⇒ إضافة بند إلى الشحنة
Print by hand ⇒ طباعة يدوية
Known codes — tap to fill in ⇒ رموز معروفة — اضغط للتعبئة
Item code ⇒ رمز البند
Size or model (optional), e.g. 0.30*1400 ⇒ المقاس أو الموديل (اختياري)، مثل 0.30*1400
Left now ⇒ المتبقي الآن
Qty per {} ⇒ الكمية لكل {}
Already cut (open roll) ⇒ سبق قطعه (رول مفتوح)
For a roll that was cut before it got a label. It shows as OPEN and is offered first in Cut. ⇒ لرول قُطع قبل أن يأخذ ملصقاً. يظهر كمفتوح ويُعرض أولاً في القطع.
Original length of the full {} ({}) ⇒ الطول الأصلي لل{1} الكاملة ({2})
Needed so the label can say how much is left of how much, e.g. 120 ⇒ مطلوب ليقول الملصق كم تبقى من كم، مثل 120
Must be more than what is left now ⇒ يجب أن يكون أكثر من المتبقي الآن
Labels (rolls) ⇒ الملصقات (رولات)
Labels (cartons) ⇒ الملصقات (كراتين)
Labels (bags) ⇒ الملصقات (أكياس)
Labels (gallons) ⇒ الملصقات (جالونات)
Labels (packs) ⇒ الملصقات (عبوات)
Labels (sheets) ⇒ الملصقات (ألواح)
Prints {} {} of {}, {} each. ⇒ يطبع {1} {2} من {3}، في كلٍّ {4}.
Prints {} {} of {}, {} each, as OPEN rolls (left of {}). ⇒ يطبع {1} {2} من {3}، في كلٍّ {4}، كرولات مفتوحة (المتبقي من {5}).
Print {} labels ⇒ طباعة {} ملصق
Print {} label ⇒ طباعة {} ملصق
Could not read the file: {}. Use .xlsx or .csv. ⇒ تعذرت قراءة الملف: {}. استخدم .xlsx أو .csv.
Import list ⇒ استيراد قائمة
Product family for files without a Category column ⇒ فئة المنتج للملفات التي ليس فيها عمود Category
Choose Excel or CSV file ⇒ اختر ملف Excel أو CSV
Reading… ⇒ جارٍ القراءة…
Read from file ({}) ⇒ مقروء من الملف ({})
Pallets ⇒ الباليتات
Labels to print ⇒ ملصقات للطباعة
Item codes ⇒ رموز البنود
Sizes ⇒ المقاسات
Not in the product catalog: {}. Check for typing mistakes, or add them in Settings → Products & groups. You can still save. ⇒ غير موجودة في كتالوج المنتجات: {}. تحقق من الأخطاء الإملائية، أو أضفها من الإعدادات ← المنتجات والمجموعات. ما زال بإمكانك الحفظ.
Not in the product catalog: {} and {} more. Check for typing mistakes, or add them in Settings → Products & groups. You can still save. ⇒ غير موجودة في كتالوج المنتجات: {1} و{2} أخرى. تحقق من الأخطاء الإملائية، أو أضفها من الإعدادات ← المنتجات والمجموعات. ما زال بإمكانك الحفظ.
New codes ⇒ رموز جديدة
Save shipment ⇒ حفظ الشحنة
Supplier packing lists are read as they come. For other goods use a table with the columns ⇒ تُقرأ قوائم التعبئة من المورّد كما هي. للبضائع الأخرى استخدم جدولاً بالأعمدة
Pallet, Category, Code, Size, Qty, Unit, Packs. Each row prints Packs labels holding Qty each. ⇒ Pallet, Category, Code, Size, Qty, Unit, Packs. كل صف يطبع عدد Packs من الملصقات، في كل منها Qty.
Shipment name ⇒ اسم الشحنة
Manual ⇒ يدوي
{} of {} ⇒ {1} من {2}
Delete {} ⇒ حذف {}
"""
}

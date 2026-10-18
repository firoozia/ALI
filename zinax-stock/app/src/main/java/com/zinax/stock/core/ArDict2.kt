package com.zinax.stock.core

/** Cut, damage, ship out, stock, reports, move by scan, edit. */
internal object ArDict2 {
    const val TEXT = """
OPEN ⇒ مفتوح
FULL ⇒ كامل
No label {} in this phone. Sync and try again. ⇒ الملصق {} غير موجود على هذا الهاتف. زامن وحاول مرة أخرى.
No label {} in this phone. Sync and try again, or check the ID. ⇒ الملصق {} غير موجود على هذا الهاتف. زامن وحاول مرة أخرى، أو تحقق من الرقم.
Not found ⇒ غير موجود
{} is not in stock ⇒ {} غير موجود في المخزون
Could not open the camera: {} ⇒ تعذر فتح الكاميرا: {}
Cut {} ⇒ قطع {}
Scan roll ⇒ مسح الرول
This roll is no longer in stock. Pick another. ⇒ هذا الرول لم يعد في المخزون. اختر رولاً آخر.
Colour code ⇒ رمز اللون
No rolls of {} in stock. ⇒ لا توجد رولات من {} في المخزون.
Open rolls first, smallest first ⇒ الرولات المفتوحة أولاً، الأصغر أولاً
Full rolls, oldest first ⇒ الرولات الكاملة، الأقدم أولاً
Suggested ⇒ مقترح
Cut {} of {}, {} written off ⇒ قُطع {1} من {2}، وسُجّل {3} كهدر
Cut {} of {}, {} left ⇒ قُطع {1} من {2}، تبقّى {3}
Cut {} of {}, roll used up ⇒ قُطع {1} من {2}، انتهى الرول
Could not cut ⇒ تعذر القطع
Change roll ⇒ تغيير الرول
Invoice no. (optional) ⇒ رقم الفاتورة (اختياري)
Length ⇒ الطول
Length ({}) ⇒ الطول ({})
Only {} on this roll. Pick a bigger roll or cut less. ⇒ يوجد {} فقط على هذا الرول. اختر رولاً أكبر أو اقطع أقل.
Left on this roll after the cut ⇒ المتبقي على هذا الرول بعد القطع
✂ Cut & print customer label ⇒ ✂ قطع وطباعة ملصق العميل
✂ Cut ⇒ ✂ قطع
Enter the customer to cut. ⇒ أدخل العميل لإجراء القطع.
Print remainder label ({}) ⇒ طباعة ملصق المتبقي ({})
Report damage on this roll ⇒ تسجيل تلف على هذا الرول
Only {} would be left ⇒ سيتبقى {} فقط
That is below the short-end limit ({} m in Settings). What should happen to the end? ⇒ هذا أقل من حد الطرف القصير ({} م في الإعدادات). ماذا نفعل بالطرف؟
Give the whole roll to this customer ⇒ إعطاء الرول كاملاً لهذا العميل
{} on the label ⇒ {} على الملصق
Cut as asked, write off the end as waste ⇒ القطع كما طُلب وتسجيل الطرف كهدر
Logged under Waste with your name ⇒ يُسجّل في الهدر باسمك
Cut as asked, keep the end in stock ⇒ القطع كما طُلب وإبقاء الطرف في المخزون
Stays as an open roll ⇒ يبقى رولاً مفتوحاً
Customer label not printed yet ⇒ لم يُطبع ملصق العميل بعد
Print customer label ⇒ طباعة ملصق العميل
Torn ⇒ تمزق
Stained ⇒ بقع
Water damage ⇒ تلف بالماء
Crushed core ⇒ نواة الرول مهروسة
Factory defect ⇒ عيب مصنعي
Other ⇒ أخرى
Report damage ⇒ تسجيل التلف
{} on the roll ⇒ {} على الرول
Damaged length ⇒ الطول التالف
Damaged length ({}) ⇒ الطول التالف ({})
Whole roll ({}) ⇒ الرول كاملاً ({})
Only {} on this roll. ⇒ يوجد {} فقط على هذا الرول.
What happened ⇒ ماذا حدث
Note (optional) ⇒ ملاحظة (اختياري)
Report this damage? ⇒ تسجيل هذا التلف؟
{} of {} ({}): {}. It leaves the stock and shows in Reports under Damage. An admin can undo it later. ⇒ {1} من {2} ({3}): {4}. يخرج من المخزون ويظهر في التقارير تحت «تلف». يمكن للمدير التراجع عنه لاحقاً.
It leaves the stock and shows in Reports under Damage. An admin can undo it later. ⇒ يخرج من المخزون ويظهر في التقارير تحت «تلف». يمكن للمدير التراجع عنه لاحقاً.
Damage reported: {} of {} ⇒ تم تسجيل التلف: {1} من {2}
Could not report the damage ⇒ تعذر تسجيل التلف
Damage ⇒ تلف
Report ⇒ تقرير
Scan label ⇒ مسح الملصق
Or type the label ID, e.g. ZX-251009-A0007 ⇒ أو اكتب رقم الملصق، مثل ZX-251009-A0007
In stock ⇒ في المخزون
Shipped ⇒ تم إخراجه
Deleted ⇒ محذوف
Left on this {} ⇒ المتبقي على هذه ال{}
roll ⇒ رول
gallon ⇒ جالون
bag ⇒ كيس
carton ⇒ كرتونة
pack ⇒ عبوة
sheet ⇒ لوح
rolls ⇒ رول
cartons ⇒ كرتونة
bags ⇒ كيس
gallons ⇒ جالون
packs ⇒ عبوة
Pallet {} ⇒ باليت {}
This label was deleted as a mistake. Do not use it. ⇒ حُذف هذا الملصق بالخطأ. لا تستخدمه.
This label was already shipped out. ⇒ سبق إخراج هذا الملصق.
{} ({}) came in on {}. Ship that one first if you can. ⇒ {1} ({2}) دخل في {3}. أخرج ذلك أولاً إن أمكن.
{} ({}) came in on {}, pallet {}. Ship that one first if you can. ⇒ {1} ({2}) دخل في {3}، باليت {4}. أخرج ذلك أولاً إن أمكن.
{} ({}) came in on {}, at {}. Ship that one first if you can. ⇒ {1} ({2}) دخل في {3}، في {4}. أخرج ذلك أولاً إن أمكن.
{} ({}) came in on {}, pallet {}, at {}. Ship that one first if you can. ⇒ {1} ({2}) دخل في {3}، باليت {4}، في {5}. أخرج ذلك أولاً إن أمكن.
Older {} available ⇒ يوجد {} أقدم
{} to ship ⇒ {} للإخراج
Enter the customer to ship out. ⇒ أدخل العميل لإجراء الإخراج.
Shipped {} of {} ⇒ أُخرج {1} من {2}
Shipped {} of {}, {} left ⇒ أُخرج {1} من {2}، تبقّى {3}
Could not ship out ⇒ تعذر الإخراج
Confirm ship out ⇒ تأكيد الإخراج
Move to another place ⇒ النقل إلى مكان آخر
Shipped and cut this session ⇒ ما أُخرج وقُطع في هذه الجلسة
Move {} ⇒ نقل {}
Move all {} of {} ⇒ نقل كل {1} من {2}
Move all {} of {}? ⇒ نقل كل {1} من {2}؟
{} moved to {} ⇒ نُقل {1} إلى {2}
Undone {}: new open roll {} with {} of {} ⇒ تم التراجع عن {1}: رول مفتوح جديد {2} فيه {3} من {4}
Undone {}: {} of {} is back in stock ⇒ تم التراجع عن {1}: {2} من {3} عاد إلى المخزون
Could not undo ⇒ تعذر التراجع
Written off ⇒ مُسجّل كهدر
Damaged ⇒ تالف
Shipped {} ⇒ إخراج {}
Written off {} ⇒ هدر {}
Damaged {} ⇒ تلف {}
Taken from this label ⇒ المأخوذ من هذا الملصق
Move by scan ⇒ النقل بالمسح
Search code, label ID or colour ⇒ بحث بالرمز أو رقم الملصق أو اللون
All groups ⇒ كل المجموعات
Open rolls ({}) ⇒ الرولات المفتوحة ({})
All places ⇒ كل الأماكن
{} codes in stock ⇒ {} رمز في المخزون
{} codes in {} ⇒ {1} رمز في {2}
open rolls only ⇒ الرولات المفتوحة فقط
Delete all {} of {}? ⇒ حذف كل {1} من {2}؟
Delete all {} ⇒ حذف كل {}
Move all {} ⇒ نقل كل {}
Delete {}? ⇒ حذف {}؟
Save changes to {}? ⇒ حفظ التغييرات على {}؟
Save changes to {} labels? ⇒ حفظ التغييرات على {} ملصق؟
Saved {} label(s) ⇒ تم حفظ {} ملصق
Could not save ⇒ تعذر الحفظ
Print new labels? ⇒ طباعة ملصقات جديدة؟
The code, size or unit on {} printed label(s) is now different. Print new labels and stick them over the old ones. ⇒ الرمز أو المقاس أو الوحدة على {} ملصق مطبوع أصبح مختلفاً. اطبع ملصقات جديدة والصقها فوق القديمة.
Print {} ⇒ طباعة {}
Use this only for labels entered by mistake. They leave stock and the Stock tab of the sheet ⇒ استخدم هذا فقط للملصقات المُدخلة بالخطأ. تخرج من المخزون ومن تبويب Stock في الشيت
and stay in the Items tab marked VOID. Throw the printed label away. ⇒ وتبقى في تبويب Items بعلامة VOID. ارمِ الملصق المطبوع.
If it came from a packing list, it goes back to "to print" in Receive. ⇒ وإن كان من قائمة التعبئة فيعود إلى «للطباعة» في استلام البضاعة.
Today ⇒ اليوم
Yesterday ⇒ أمس
Last 7 days ⇒ آخر 7 أيام
This month ⇒ هذا الشهر
Pick dates… ⇒ اختيار التواريخ…
Search customer, invoice or code ⇒ بحث عن عميل أو فاتورة أو رمز
All users ⇒ كل المستخدمين
Nothing shipped in this period. ⇒ لا يوجد إخراج في هذه الفترة.
Nothing cut in this period. ⇒ لا يوجد قطع في هذه الفترة.
Nothing written off in this period. ⇒ لا يوجد هدر في هذه الفترة.
Nothing damaged in this period. ⇒ لا يوجد تلف في هذه الفترة.
Nothing received in this period. ⇒ لا يوجد استلام في هذه الفترة.
Nothing deleted in this period. ⇒ لا يوجد حذف في هذه الفترة.
Nothing moved in this period. ⇒ لا يوجد نقل في هذه الفترة.
Nothing edited in this period. ⇒ لا يوجد تعديل في هذه الفترة.
Nothing {} matches "{}" in this period. ⇒ لا يوجد ما يطابق «{2}» في هذه الفترة.
Nothing matches "{}" in this period. ⇒ لا يوجد ما يطابق «{}» في هذه الفترة.
Nothing happened in this period. ⇒ لم يُسجّل شيء في هذه الفترة.
Total ⇒ الإجمالي
Includes other phones after they sync. ⇒ يشمل الهواتف الأخرى بعد مزامنتها.
By customer ⇒ حسب العميل
{} cuts ⇒ {} قطع
{} cut ⇒ {} قطع
Inv {} ⇒ فاتورة {}
by {} ⇒ بواسطة {}
To: {} ⇒ إلى: {}
By: {} ⇒ بواسطة: {}
{} (cut) ⇒ {} (قطع)
Everything in this period ⇒ كل ما سُجّل في هذه الفترة
Tap a line to see only that kind. ⇒ اضغط على سطر لعرض هذا النوع فقط.
UNDONE ⇒ تم التراجع
undone by {} ⇒ تراجع بواسطة {}
Undone in this period ({}) ⇒ ما تم التراجع عنه في هذه الفترة ({})
not counted above ⇒ غير محسوب في الإجماليات أعلاه
Sync to include other phones ⇒ زامن لتشمل الهواتف الأخرى
New open roll {}: {} of {} ⇒ رول مفتوح جديد {1}: {2} من {3}
Ship-outs ⇒ الإخراج
Cuts ⇒ القطع
Waste ⇒ الهدر
Received ⇒ دخول
Moved ⇒ نقل
Edited ⇒ تعديل
Ship-out ⇒ إخراج
Not in this phone. Sync and scan again. ⇒ غير موجود على هذا الهاتف. زامن وامسح مرة أخرى.
already in {} ⇒ موجود أصلاً في {}
from {} ⇒ من {}
Move to ⇒ النقل إلى
Keep scanning ⇒ متابعة المسح
The camera opens again after each roll. Press Back on the camera to stop. ⇒ تفتح الكاميرا من جديد بعد كل رول. اضغط رجوع على الكاميرا للتوقف.
Choose where to move first ⇒ اختر وجهة النقل أولاً
Scan rolls to move to {} ⇒ امسح الرولات لنقلها إلى {}
Or type the label ID ⇒ أو اكتب رقم الملصق
{} scanned ⇒ تم مسح {}
Moved back to {} ⇒ أُعيد إلى {}
Move back ⇒ إعادة
Category ⇒ الفئة
Code ⇒ الرمز
Size ⇒ المقاس
Unit ⇒ الوحدة
Edit {} ⇒ تعديل {}
Edit {} labels of {} ⇒ تعديل {1} ملصق من {2}
Code, size and unit are printed on the label. After saving you can print new labels. ⇒ الرمز والمقاس والوحدة مطبوعة على الملصق. بعد الحفظ يمكنك طباعة ملصقات جديدة.
Quantities and history stay as they are. The change is logged under Reports → Edited with your name. ⇒ تبقى الكميات والسجل كما هي. يُسجّل التغيير باسمك في التقارير ← تعديل.
PVC film ⇒ فيلم PVC
Edge banding ⇒ شريط حافة
Vacuum glue ⇒ غراء التفريغ
Edge banding glue ⇒ غراء شريط الحافة
Hinge ⇒ مفصلة
Rail ⇒ سكة
{} ({}) ⇒ {1} ({2})
"""
}

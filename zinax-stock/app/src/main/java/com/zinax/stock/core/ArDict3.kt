package com.zinax.stock.core

/** Catalog, customers, locations, label size, printing. */
internal object ArDict3 {
    const val TEXT = """
Products & groups ⇒ المنتجات والمجموعات
Add product ⇒ إضافة منتج
Add group ⇒ إضافة مجموعة
Products ({}) ⇒ المنتجات ({})
Groups ({}) ⇒ المجموعات ({})
Units written in different ways ⇒ وحدات مكتوبة بصيغ مختلفة
“{}” → “{}”: {} ⇒ «{1}» → «{2}»: {3}
{} label(s) in stock ⇒ {} ملصق في المخزون
{} product(s) ⇒ {} منتج
{} line(s) to receive ⇒ {} سطر للاستلام
The same product with different spellings shows as separate rows in Stock and reports. ⇒ المنتج نفسه بكتابات مختلفة يظهر في المخزون والتقارير كصفوف منفصلة.
Tidying… ⇒ جارٍ التوحيد…
Tidy units ⇒ توحيد الوحدات
Tidy units? ⇒ توحيد الوحدات؟
Search code, size or note ⇒ بحث بالرمز أو المقاس أو الملاحظة
Show removed ⇒ عرض المحذوفة
No products yet. Tap Add product. ⇒ لا توجد منتجات بعد. اضغط «إضافة منتج».
{} per {} ⇒ {1} لكل {2}
none in stock ⇒ لا شيء في المخزون
removed ⇒ محذوف
{} products ⇒ {} منتج
{} in stock ⇒ {} في المخزون
{} roll ⇒ {} رول
{} rolls ⇒ {} رول
{} carton ⇒ {} كرتونة
{} cartons ⇒ {} كرتونة
{} bag ⇒ {} كيس
{} bags ⇒ {} كيس
{} gallon ⇒ {} جالون
{} gallons ⇒ {} جالون
{} pack ⇒ {} عبوة
{} packs ⇒ {} عبوة
{} sheet ⇒ {} لوح
{} sheets ⇒ {} لوح
{} joined the same product already in {} ⇒ تم دمج {1} مع المنتج نفسه الموجود في {2}
Saved {} ⇒ تم حفظ {}
{} label(s) moved ⇒ تم نقل {} ملصق
{} removed from the catalog. Labels in stock stay. ⇒ تم حذف {} من الكتالوج. تبقى الملصقات في المخزون.
{} is back ⇒ عاد {}
{} removed ⇒ تم حذف {}
Could not remove ⇒ تعذر الحذف
Labels in stock are corrected and logged under Reports → Edited. Products that become the same ⇒ تُصحَّح الملصقات في المخزون وتُسجَّل في التقارير ← تعديل. المنتجات التي تصبح متطابقة
are joined. Printed labels can stay; the QR still works. Past ship-outs and cuts keep their spelling. ⇒ تُدمج. يمكن إبقاء الملصقات المطبوعة؛ فرمز QR يعمل كما هو. أما عمليات الإخراج والقطع السابقة فتحتفظ بكتابتها.
Units tidied: {} change(s) ⇒ تم توحيد الوحدات: {} تغيير
Could not tidy units ⇒ تعذر توحيد الوحدات
Group ⇒ المجموعة
Size (optional) ⇒ المقاس (اختياري)
Usual quantity per {} (optional) ⇒ الكمية المعتادة لكل {} (اختياري)
Colour or description (optional) ⇒ اللون أو الوصف (اختياري)
Also correct the {} label(s) of this product in stock (logged under Reports → Edited) ⇒ صحّح أيضاً {} ملصق من هذا المنتج في المخزون (يُسجَّل في التقارير ← تعديل)
Bring back to the catalog ⇒ إعادة إلى الكتالوج
Remove from the catalog ⇒ حذف من الكتالوج
Removing only stops suggesting it. Labels in stock stay; delete those from Stock. ⇒ الحذف يوقف اقتراحه فقط. تبقى الملصقات في المخزون؛ احذفها من المخزون.
Name, e.g. MDF board ⇒ الاسم، مثل MDF board
Usual unit ⇒ الوحدة المعتادة
One package is a ⇒ الطرد الواحد هو
Unit: m, kg, pcs… Package: roll, gallon, bag, carton, sheet… ⇒ الوحدة: m, kg, pcs… الطرد: roll, gallon, bag, carton, sheet…
Bring back ⇒ إعادة
Remove group ⇒ حذف المجموعة
{} label(s) in stock are in this group. They stay in stock under this name; it is only no longer offered for new labels. ⇒ يوجد {} ملصق في المخزون ضمن هذه المجموعة. تبقى في المخزون بهذا الاسم؛ فقط لم تعد تُقترح للملصقات الجديدة.
Customer ⇒ العميل
Customers ⇒ العملاء
New customer ⇒ عميل جديد
New customer, added to the library when saved ⇒ عميل جديد، يُضاف إلى القائمة عند الحفظ
{} customers ⇒ {} عميل
shared with other phones and the Customers tab of the sheet ⇒ مشترك مع الهواتف الأخرى وتبويب Customers في الشيت
Added {} by {} ⇒ أُضيف {1} بواسطة {2}
Added {} ⇒ أُضيف {}
Rename ⇒ إعادة تسمية
Remove ⇒ حذف
Rename customer ⇒ إعادة تسمية العميل
Remove {}? ⇒ حذف {}؟
The name stops being suggested. Past cuts and reports keep it. Typing it again on a cut adds it back. ⇒ يتوقف اقتراح الاسم. تحتفظ به عمليات القطع والتقارير السابقة. كتابته مجدداً عند القطع تعيده.
No location ⇒ بلا مكان
Put away in ⇒ التخزين في
No location chosen. Add locations in Settings. ⇒ لم يُختر مكان. أضف الأماكن من الإعدادات.
Choose a place ⇒ اختر مكاناً
Or type a place, e.g. Warehouse 2 - Floor 1 ⇒ أو اكتب مكاناً، مثل Warehouse 2 - Floor 1
Label size (mm) ⇒ مقاس الملصق (مم)
Width ⇒ العرض
Height ⇒ الارتفاع
Width {}–{} mm, height {}–{} mm. ⇒ العرض {1}–{2} مم، الارتفاع {3}–{4} مم.
Small label: text and QR print small, and long customer names may be hard to read. ⇒ ملصق صغير: يُطبع النص وQR صغيرين وقد يصعب قراءة أسماء العملاء الطويلة.
After changing the paper roll, calibrate the printer once: hold FEED until one label comes out. ⇒ بعد تغيير رول الورق، عاير الطابعة مرة واحدة: اضغط FEED مطولاً حتى يخرج ملصق واحد.
Label preview ⇒ معاينة الملصق
Printing {} ⇒ جارٍ طباعة {}
Connecting to the printer… ⇒ جارٍ الاتصال بالطابعة…
Label {} of {} sent to the printer ⇒ أُرسل الملصق {1} من {2} إلى الطابعة
Did all {} labels print? ⇒ هل طُبعت كل {} ملصق؟
Printing stopped ⇒ توقفت الطباعة
{} of {} labels were sent. The labels are saved; you can print them again from here or from Stock. ⇒ أُرسل {1} من {2} ملصق. الملصقات محفوظة؛ يمكنك طباعتها مجدداً من هنا أو من المخزون.
If the paper ran out or a label came out blank, reprint from that label number. ⇒ إذا انتهى الورق أو خرج ملصق فارغ، أعد الطباعة من رقم ذلك الملصق.
Reprint from label number (1–{}) ⇒ إعادة الطباعة من رقم الملصق (1–{})
Yes, all printed ⇒ نعم، طُبعت كلها
Reprint from… ⇒ إعادة الطباعة من…
test label ⇒ ملصق تجريبي
cut for {} ⇒ قطع لـ {}
label for {} ⇒ ملصق لـ {}
remainder {} ⇒ المتبقي {}
damage {} ⇒ تلف {}
open roll {} ⇒ رول مفتوح {}
ship to {} ⇒ إخراج إلى {}
corrected {} ⇒ تصحيح {}
Zinax-Stock ⇒ زيناكس ستوك
"""
}

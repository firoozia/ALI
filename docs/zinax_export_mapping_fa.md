# قرارداد خروجی به زیناکس (ORDER_CSV_V2) — قفل‌شده

> منبع: مستقیم از مخزن خودت `firoozia/zinax-cam` خوانده شد:
> `docs/contracts/ORDER_CSV_V2.md`، parserِ `csv_handler.py`،
> مدل `zinax_cam/domain/edge_band.py`، و فایل‌های نمونه‌ی واقعی
> `docs/crosscheck/real_zinax/{melamine_single,vacuum_single}/ORDER.csv`.
> دیگر نیازی به حدس یا نمونه‌ی جدید نیست؛ اپ لیست‌ساز باید **عیناً** همین را بنویسد.

## نکته‌ی کلیدی
فایلِ `ORDER.csv` **یکی است برای هر دو مدل**. ستونِ `product_type` تعیین می‌کند هر
ردیف **`vacuum_door`** است یا **`melamine`**. پس دو «فرمت» جدا نداریم؛ یک فرمت با
یک ستونِ نوع.

- `vacuum_door` → در لیستِ درب وکیوم، در **اندازه‌ی سفارش** نست می‌شود؛ ستون‌های نوار
  را نادیده می‌گیرد.
- `melamine` → در **اندازه‌ی برشِ بعد از کسر نوار** بریده می‌شود، ستون‌های نوار را
  می‌گیرد، و در متراژ نوار شمرده می‌شود.
- اگر `product_type` نبود ولی `edge_1..4` بود → ملامین؛ وگرنه وکیوم.

## ستون‌ها
فایل UTF-8 با ردیف هدر. زیناکس هدرها را بدون توجه به حروف بزرگ/کوچک، فاصله و
آندرلاین می‌خواند (`width_mm` = `Width mm`). CRLF مجاز است.

**اجباری** (نبودن/نامعتبر بودن → ردیف رد می‌شود):

| ستون | معنی |
|---|---|
| `order_no` | شماره سفارش. با `line_no` می‌شود کدِ قطعه `order_no-NN` |
| `line_no` | شماره ردیف |
| `design_code` | کد طرح (خالی → `cd0`) |
| `width_mm` | عرضِ سفارش از روبه‌رو (همان Width گرید؛ جابه‌جا نمی‌شود) |
| `height_mm` | ارتفاعِ سفارش از روبه‌رو |
| `quantity` | تعداد؛ عددِ صحیحِ مثبت (`2.7`/`0`/خالی/متن رد می‌شود) |

**اختیاری (ذخیره می‌شود)**: `order_id`، `order_date`، `project_name`،
`customer_name`، `customer_code`، `design_name`، `mdf_thickness_mm` (نبودِ ستون=۱۸؛
ستونِ خالی=خطا)، `pvc_code`، `pvc_color`، `grain_direction`، `notes`،
`schema_version`، `product_type` (`vacuum_door`|`melamine`)،
`edge_1..edge_4`، `rotation`. هر ستونِ دیگر زیر `extra` نگه داشته می‌شود.

## نوار: `edge_1..edge_4`
قطعه از روبه‌رو دیده می‌شود:
- `edge_1` = **پایین** (موازی عرض)
- `edge_2` = **بالا** (موازی عرض)
- `edge_3` = **چپ** (موازی ارتفاع)
- `edge_4` = **راست** (موازی ارتفاع)

مقدارِ هر سلول:
- `N` → بدون نوار و بدون علامت شیار (سلولِ خالیِ ستونِ موجود = `N`).
- `<band>` → کدی از کتابخانه‌ی نوار، مثل `P1`.
- `S` → علامتِ شیار (فقط برای لیبل و نقشه؛ toolpath نمی‌سازد).
- `S/<band>` → همان نوار + علامت شیار (`S/P1` یعنی نوارِ `P1`).

### کسر اندازه‌ی برش (وقتی گزینه‌ی «کسر ضخامت نوار» روشن است)
```
cut_width  = width  − thickness(edge_3) − thickness(edge_4)
cut_height = height − thickness(edge_1) − thickness(edge_2)
```
`N` و `S` ضخامتِ ۰ دارند. مثال: ۵۰۰×۴۰۰، edge_1=`P3`(۲.۰)، edge_2=`S/P1`(۰.۵)،
edge_3=`N`، edge_4=`S` → اندازه‌ی برش = ۵۰۰×۳۹۷.۵.

> مهم: **زیناکس خودش موقع import کسر برش و متراژ نوار را حساب می‌کند.** پس اپ
> لیست‌ساز باید `width_mm/height_mm` را به‌صورت **اندازه‌ی سفارش (نهایی)** بنویسد، نه
> اندازه‌ی برش. (اندازه‌ی برش را فقط برای نمایش به کاربر حساب کن.)

### متراژ نوار
بر اساس **اندازه‌ی سفارش**: لبه‌های ۱و۲ به طول `width_mm`، لبه‌های ۳و۴ به طول
`height_mm`؛ هر لبه‌ی نواردار + پرتِ نوار (پیش‌فرض ۵۰mm). مثال: ۴۰۰×۴۰۰ با هر ۴ لبه
`P1` و پرت ۵۰ → ۴×(۴۰۰+۵۰)=۱۸۰۰mm=۱.۸m.

## کتابخانه‌ی نوارِ پیش‌فرض (از `edge_band.py`)
| کد | ضخامت | عرض |
|---|---|---|
| `P1` | ۰.۵ mm | ۲۲ mm |
| `P2` | ۱.۰ mm | ۲۲ mm |
| `P3` | ۲.۰ mm | ۲۲ mm |
- `subtract=True`، `default_waste_mm=50`.
- قانون کد: باید با `P` شروع شود، بدون فاصله و بدون `/`.
- **اپ لیست‌ساز باید همین کدها را به کار ببرد** (کدها از «تنظیمات زیناکس →
  نوار → Export codes» می‌آیند؛ هر دو برنامه باید یکی باشند).

## `rotation`
`Y/yes/1/true/90/allowed` = مجاز به چرخش. `N/no/0/false/none/locked` = قفل.
خالی = آزاد. قفلِ قطعه تنها تصمیمِ چرخش است (الیاف، اگر فعال باشد، باز هم چرخش را
می‌بندد).

## نمونه‌ی واقعی — ملامین
```csv
order_no,line_no,customer_name,project_name,product_type,width_mm,height_mm,quantity,design_code,mdf_thickness_mm,pvc_code,pvc_color,grain_direction,rotation,edge_1,edge_2,edge_3,edge_4
XM01,1,Matrix test,melamine list,melamine,720,560,2,,18,,MEL-W,,Y,P1,N,P1,P1
XM01,2,Matrix test,melamine list,melamine,600,300,3,,18,,MEL-W,,Y,N,N,N,N
```

## نمونه‌ی واقعی — درب وکیوم
```csv
order_no,line_no,customer_name,project_name,product_type,width_mm,height_mm,quantity,design_code,mdf_thickness_mm,pvc_code,pvc_color,grain_direction,rotation,edge_1,edge_2,edge_3,edge_4
XM01,1,Matrix test,vacuum list,vacuum_door,500,900,1,ZV01,18,WHT-001,WHT-001,,Y,,,,
XM01,2,Matrix test,vacuum list,vacuum_door,500,900,1,ZV02,18,WHT-001,WHT-001,,Y,,,,
```

## نتیجه برای اپ لیست‌ساز
- خروجی = **همین ORDER_CSV_V2** (نه یک فرمت اختراعی). این «قراردادِ قفل‌شده»ی بین دو
  برنامه‌ی توست؛ قرارداد زیناکس حتی می‌گوید این فایل از «Order Builder / Customer
  Order» می‌آید — یعنی **اپ رایگانِ تو همان Order Builder است.**
- بخش «روسازی» اپ: برای هر قطعه `product_type` + `edge_1..4` (+ `pvc_code` برای
  وکیوم) + `grain_direction` + `rotation` را پر کن.
- کدهای نوار (`P1/P2/P3…`) و design_codeها باید با زیناکس مشترک باشند.
- **درب وکیوم**: نوار ندارد؛ در عوض `design_code` و `pvc_code` مهم‌اند (طرحِ درب).
- این قرارداد، طراحیِ بخش روسازیِ ما را ۱۰۰٪ تأیید می‌کند (۴ لبه + کسر ضخامت +
  متراژ نوار) — دقیقاً مثل OpenCutList.

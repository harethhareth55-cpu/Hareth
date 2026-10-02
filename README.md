# محاسب الكاشير

برنامج كاشير عربي للمتاجر والماركتات في العراق. يعمل على المتصفح بدون إنترنت بعد فتحه مرة واحدة، ويُحفظ كل شيء على الجهاز: المواد، المبيعات، المخزون، الديون، والورديات.

النسخة السابقة من هذا الفرع كانت مربوطة بتسجيل الدخول برقم الهاتف عبر Firebase. رسائل التحقق تحتاج خطة Blaze المدفوعة، لذلك استُبدل الدخول برمز محلي على الجهاز، والاشتراك برمز تفعيل موقّع. لا توجد كلفة تشغيل شهرية للرسائل أو لقاعدة سحابية.

## التشغيل

لا توجد خطوة بناء. من مجلد المشروع:

```bash
python3 -m http.server 8080
```

ثم افتح `http://localhost:8080`. على الهاتف يمكن تثبيت الصفحة من المتصفح (إضافة إلى الشاشة الرئيسية).

النشر على Cloudflare Pages: اربط المستودع واجعل مجلد النشر هو جذر المشروع. لا تضبط أمر بناء. ملف `_headers` يُطبَّق تلقائيًا.

## يوم العمل

1. يدخل المالك أو الكاشير برمزه.
2. تُفتح الوردية ويُكتب النقد الموجود في الصندوق.
3. تُمسح المواد بالكاميرا أو بسكانر USB/Bluetooth الذي يكتب كلوحة مفاتيح، أو بالبحث عن الاسم.
4. تُغلق الوردية في نهاية اليوم بعد عدّ الصندوق. الفرق يظهر في تقرير الإغلاق.

اختصارات لوحة المفاتيح على الحاسوب:

| المفتاح | الوظيفة |
| --- | --- |
| F2 | الانتقال إلى خانة الباركود |
| Enter | إضافة المادة المطابقة |
| F4 | فتح الدفع |
| F8 | تعليق الفاتورة |
| F9 | الفواتير المعلقة |
| Esc | إغلاق النافذة |

المواد الموزونة (كغم، غرام، لتر) تطلب الكمية عند إضافتها. المجاميع تُقرَّب إلى دينار عراقي صحيح، والكمية تبقى حتى ثلاثة أرقام عشرية.

الدفع يقبل نقدًا وبطاقة وآجلًا في نفس الفاتورة. الباقي يُحسب من النقد المستلم. البطاقة هنا تسجيل فقط، وليست ربطًا مع جهاز البنك.

## الديون

الديون جزء أساسي من الشاشة وليست ملاحظة على الفاتورة.

- لكل زبون اسم وهاتف وعنوان وسقف دين. بدون سقف لا يُقبل البيع الآجل.
- يمكن بيع الفاتورة كلها آجلًا أو أخذ جزء نقدًا وتسجيل الباقي دينًا، مع تاريخ استحقاق.
- تسديد الدفعة يدخل الصندوق النقدي للوردية المفتوحة.
- كشف الحساب يعرض الفواتير والدفعات والرصيد الجاري، ويُطبع أو يُرسل واتساب.
- شاشة الديون تعرض إجمالي المعلق والمتأخر وعدد الزبائن. الدين يُعدّ متأخرًا إذا بقي من أقدم فاتورة بعد تاريخ استحقاقها. الدفعات تُخصم من أقدم دين أولًا.

المرتجع إما يُرد نقدًا من الصندوق أو يُخصم من دين الزبون.

## المخزون والربح

فاتورة الشراء تزيد الكمية وتحدّث سعر الكلفة بالمتوسط الموزون. إذا نزل المخزون تحت حد التنبيه يظهر في البيع وفي شاشة المخزون. البيع لا يتوقف عند النقص، لكن البرنامج ينبّه.

الربح في التقارير = صافي المبيعات − كلفة البضاعة المباعة. الكلفة تُحفظ على الفاتورة وقت البيع. المالك فقط يرى الربح والكلفة والتقارير والإعدادات.

## النسخ والطباعة

من الإعدادات: نسخة احتياطية JSON واسترجاعها، وتصدير المواد واستيرادها من إكسل. أعمدة الاستيراد: الباركود، الاسم، التصنيف، الوحدة، سعر البيع، سعر الكلفة، الكمية، حد التنبيه. اجعل عمود الباركود نصًا حتى لا يحذف إكسل الأصفار من أوله.

الفاتورة الحرارية 58 مم أو 80 مم من الإعدادات. الطباعة من المتصفح. للشعار، اختر صورة صغيرة من الإعدادات.

واتساب يفتح رسالة جاهزة للفاتورة أو لكشف الحساب. إذا كان للزبون رقم عراقي يبدأ بـ 07 تُحوَّل الرسالة إلى `964`.

## التفعيل

أول 14 يومًا تجربة من تاريخ إعداد المحل. بعدها يتوقف البيع حتى إدخال رمز، ويبقى تنزيل النسخة الاحتياطية متاحًا.

إصدار رمز لمدة سنة (المفتاح الخاص يبقى عندك ولا يُرفع مع الموقع):

```bash
node scripts/issue-license.mjs year 2027-10-02
```

`month` و `year` يحتاجان تاريخ انتهاء. `life` بلا تاريخ. المستودع عام، لذلك المفتاح الخاص غير موجود فيه. إن لم يكن الملف `scripts/license-private.pem` عندك، شغّل `node scripts/rotate-license-key.mjs` ثم أعد نشر الموقع حتى يطابق المفتاح العام الجديد.

مسح بيانات المتصفح يعيد التجربة على هذا الجهاز. الرمز يمنع الاستخدام العادي بعد انتهاء المدة، ومن لديه مصدر البرنامج يستطيع تعديل صفحة القفل. هذا مناسب لنسخة تُوزَّع جاهزة، وليس لقفل لا يمكن كسره.

## الصلاحيات

المالك يدير المواد والمخزون والتقارير والإعدادات والكاشيرات، ويرى الربح. الكاشير يبيع ويرجع البضاعة ويفتح حسابات الزبائن ويسجّل الدفعات على ورديته. يمكن عند إضافة كاشير منحه الخصم أو منعه من المرتجع.

## الاختبارات

```bash
node --test tests/*.test.js
```

تغطي الدينار، الخصم والباقي، الوزن، متوسط الكلفة، سقف الدين، المتأخرات، الصندوق، والربح.

## ما تُرك للاحق

- مزامنة أكثر من جهاز أو فرع. الجهاز الواحد صندوق واحد، والنقل بين الأجهزة يتم بالنسخة الاحتياطية.
- حسابات الموردين الآجلة. الشراء إما من الصندوق أو بلا أثر نقدي.
- ربط جهاز البطاقة المصرفية.
- جرد دوري بفروقات معتمدة.

---

# Cashier POS

Arabic, offline cashier for Iraqi shops and supermarkets. Products, sales, stock, customer debts, and shifts stay in IndexedDB on the device. After the first load it keeps working without a connection. Deploy the repository root to Cloudflare Pages with no build command.

Firebase phone login was removed. SMS verification needs the paid Blaze plan. Sign-in is now a local PIN, and the subscription is a signed activation code, so there is no monthly SMS or database bill.

## Daily use

Open a shift by counting the drawer, scan barcodes with the camera or a USB/Bluetooth scanner that types like a keyboard, then take cash, card, and credit on one ticket. The change is the cash handed over minus the cash portion of the bill. Close the shift to print the expected cash and the difference.

Keyboard: F2 barcode, Enter add, F4 pay, F8 hold, F9 recall, Esc close. Weighed units ask for a quantity. Money is whole Iraqi dinars; quantities keep up to three decimal places.

## Debts

A customer needs a credit limit before an on-account sale. A ticket can be fully or partly on credit, with a due date. Installments are cash payments and go into the open shift. The statement shows every charge and payment with a running balance, and it can be printed or sent through WhatsApp. The debts screen shows total outstanding, overdue amount, and how many customers owe money. Payments clear the oldest charge first. A remaining charge is overdue after its due date.

## Stock, profit, backup

A purchase increases stock and sets a weighted-average cost. Low stock is a warning, not a hard stop. Profit is net sales minus the cost captured on each ticket, and only the owner can see it.

Settings export and restore a JSON backup and Excel product sheets. Thermal receipts are 58mm or 80mm. Put the shop logo, phone, and footer in settings.

## Activation

The first 14 days are a trial. Then the register locks until a code is entered; backup download still works.

```bash
node scripts/issue-license.mjs year 2027-10-02
```

Plans are `month`, `year`, and `life`. The private key is not in this public repository. Keep `scripts/license-private.pem` private. If you do not have it, run `node scripts/rotate-license-key.mjs` and redeploy so the new public key is the one in the app. Clearing the browser resets the trial. The code stops ordinary use after expiry; anyone with this source can remove the check.

## Tests

```bash
node --test tests/*.test.js
```

They cover dinar rounding, discounts, change, weighed items, average cost, credit limits, overdue balances, the cash drawer, and profit.

## Left for later

Sync across devices or branches (move data with a backup file for now), supplier credit accounts, card-terminal integration, and a formal stock-count workflow.

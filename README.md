# محاسب التوصيل

دفتر يومي لتوصيل المحلات والماركتات في العراق. صاحب المحل يسجّل الطلب، يطلع رمز QR، المندوب يمسحه عند الاستلام والتسليم ويثبت النقد، وبعدها تتصفى حسابات المندوب بالدينار.

التطبيق يشتغل من المتصفح كتطبيق ثابت (PWA). ما يحتاج سيرفر عشان تشتغل الدورة اليومية: البيانات تنحفظ على الجهاز، والنسخة الاحتياطية ملف تنزّله. ربط جهاز المندوب الثاني يصير برمز QR بدون إنترنت.

## English

A daily ledger for deliveries from Iraqi shops and supermarkets. The owner creates an order and a QR code, the driver scans it to confirm pickup, delivery, and cash collected, then the owner settles that driver's cash in Iraqi dinars.

It is a static progressive web app. The daily loop does not need a server: data stays on the device, and backup is a file you download. A second phone joins with a QR code and works offline.

## التشغيل / Run

تحتاج خادم ملفات بسيط. فتح `index.html` مباشرة (`file://`) ما يكفي: الكاميرا وحفظ البيانات والتثبيت كتطبيق يبون `http` أو `https`.

You need a static file server. Opening `index.html` as `file://` is not enough: the camera, storage, and install prompt need `http` or `https`.

```bash
python3 -m http.server 8000
```

ثم افتح `http://localhost:8000` من الموبايل أو الكمبيوتر. من Chrome أو Safari: «إضافة إلى الشاشة الرئيسية» عشان يشتغل كتطبيق.

Then open `http://localhost:8000`. In Chrome or Safari, use “Add to Home Screen” to install it.

أول تشغيل يفتح دفتر المحل: الاسم، اسمك، رمز سري من ٤ إلى ٦ أرقام، وأجرة التوصيل الافتراضية، ولمن تروح الأجرة (المندوب أو المحل).

The first launch creates the shop ledger: shop name, your name, a 4–6 digit PIN, the default delivery fee, and whether that fee belongs to the driver or the shop.

الاختبارات:

```bash
npm test
```

ما في خطوة بناء. الملفات الجاهزة هي التطبيق.

There is no build step. The files in this folder are the app.

## الاستخدام اليومي / Daily use

1. **مندوب**: من «المندوبون» أضف الاسم والهاتف ورمز دخوله. من صفحته انسخ «رمز ربط جهاز المندوب» وافتحه على موبايله (زر «عندي رمز جهاز مندوب» قبل ما يتأسس دفتر ثاني). على نفس جهاز المحل يقدر يدخل برمزه من شاشة القفل.
2. **طلب**: «طلب جديد». اسم الزبون، وهاتفه أو عنوانه، والأصناف أو مبلغ البضاعة، والخصم، وأجرة التوصيل. «حفظ وإظهار الرمز» يعرض QR.
3. **استلام**: المندوب يمسح رمز الطلب، أو صاحب المحل يضغط «تأكيد الاستلام». الطلب يصير «عند المندوب» (عهدة بضاعة).
4. **تسليم ونقد**: من الطلب اكتب النقد المستلم من الزبون. الشاشة تبين إذا في نقص أو زيادة وكم يسلّم للمحل. بعد الحفظ، جهاز المندوب يعرض رمز تأكيد يمسحه صاحب المحل إذا الطلب انسجل على جهاز ثاني.
5. **تصفية**: من صفحة المندوب «تصفية الحساب». اختَر الطلبات المسلّمة غير المصفّاة، طابق النقد المستلم، وثبّت. الفرق السالب نقص على المندوب، والموجب زيادة دخلت الصندوق. التصفية القديمة تتلغى إذا انسجلت بالغلط، والطلبات ترجع مفتوحة.
6. **تقرير**: من «المزيد» ثم «التقارير». اليوم، أمس، أو هذا الشهر (بتوقيت بغداد). تنزيل إكسل أو طباعة PDF من نافذة الطباعة في المتصفح.
7. **نسخة**: من الإعدادات نزّل JSON (يرجع كما هو على جهاز ثاني) أو إكسل. الاستيراد يستبدل بيانات الجهاز.

1. **Driver**: under المندوبون add a name, phone, and PIN. Open that driver and show «رمز ربط جهاز المندوب» on their phone (the fresh phone uses «عندي رمز جهاز مندوب»). On the shop phone they can also sign in from the lock screen.
2. **Order**: طلب جديد. Customer name plus phone or address, line items or a lump goods amount, discount, and delivery fee. حفظ وإظهار الرمز shows the QR.
3. **Pickup**: the driver scans the order QR, or the owner presses تأكيد الاستلام. The order becomes «عند المندوب» (goods in the driver's custody).
4. **Delivery and cash**: enter the cash taken from the customer. The screen shows any shortage or surplus and what must be handed to the shop. On the driver's phone a confirmation QR appears for the owner to scan if the order was recorded on another device.
5. **Settlement**: on the driver page, تصفية الحساب. Choose delivered orders that are not settled yet, enter the cash received, and confirm. A negative difference is a shortage the driver still owes; a positive one is extra cash in the till. A mistaken settlement can be voided, which reopens its orders.
6. **Report**: المزيد → التقارير. Today, yesterday, or this month in Baghdad time. Download Excel, or print to PDF from the browser print dialog.
7. **Backup**: settings can download JSON (restore it on another phone) or Excel. Import replaces the data on that device.

إذا الكاميرا ما اشتغلت: انسخ الرمز النصي من تحت صورة QR والصقه في شاشة «مسح»، أو اكتب رقم الطلب. تقدر هم ترفع صورة الرمز.

If the camera fails: copy the text under the QR into مسح, type the order number, or upload a picture of the code.

قفل الشاشة من زر «قفل» إذا الجهاز مشترك. الرمز يفصل صاحب المحل عن المندوب على نفس الموبايل. هذا مو بديل عن قفل الجهاز نفسه.

Use قفل on a shared phone. The PIN separates the owner from a driver on that device. It does not replace the phone's own lock.

## الحساب / Money

المبالغ بالدينار العراقي أعداد صحيحة. الكمية تقدر تكون كسرية لحد ٣ خانات (مثل ١٫٥ كيلو) والإجمالي يقرّب لأقرب دينار.

- صافي البضاعة = البضاعة − الخصم.
- المطلوب من الزبون = صافي البضاعة + أجرة التوصيل.
- إذا الأجرة للمندوب: يسلّم للمحل صافي البضاعة، ويحتفظ بالأجرة إذا الزبون دفعها. النقص يأكله من أجرته أول وبعدين يظل مطالبًا بصافي البضاعة. أي زيادة فوق المطلوب تروح للمحل.
- إذا الأجرة للمحل: يسلّم كل المطلوب من الزبون، والزيادة كمان.
- الطلب الجديد، أو اللي لسا عند المندوب، أو المرتجع، أو الملغى: ما يدخل نقد بالتصفية. البضاعة اللي «عند المندوب» تنحسب عهدة.

Amounts are whole Iraqi dinars. Quantity may have up to 3 decimal places (for example 1.5 kg) and the line total rounds to the nearest dinar.

- Net goods = goods − discount.
- Customer due = net goods + delivery fee.
- When the fee belongs to the driver: they hand the shop the net goods and keep the fee if the customer paid it. A shortage consumes their fee first, and they still owe the net goods. Any surplus goes to the shop.
- When the fee belongs to the shop: they hand over the full customer due, plus any surplus.
- New, out-for-delivery, returned, and cancelled orders do not move cash into a settlement. Goods marked «عند المندوب» are custody, not cash.

تغيير «لمن تروح الأجرة» يأثر على التصفية الجاية بس. التصفية المثبتة تبقى كما انسجلت.

Changing who keeps the fee affects the next settlement only. A posted settlement stays as it was recorded.

## النشر على Cloudflare Pages / Deploy

ما في أمر بناء. في لوحة Pages:

- أنشئ مشروع واربط هذا المستودع، أو ارفع المجلد.
- Build command: فاضي.
- Output directory: `/` (جذر المستودع).
- الملف `_headers` يضيف رؤوس حماية بسيطة، و`manifest.webmanifest` مع `sw.js` يخلّون التثبيت والعمل بدون نت بعد أول زيارة.

There is no build command. In Cloudflare Pages:

- Create a project from this repository, or upload the folder.
- Build command: empty.
- Output directory: `/` (the repository root).
- `_headers` sets a few security headers. `manifest.webmanifest` and `sw.js` enable install and offline use after the first visit.

الكاميرا تشتغل على `https` (Pages يوفرها) وعلى `localhost`.

The camera works on `https` (Pages provides that) and on `localhost`.

## لماذا ما في سيرفر / Why there is no backend

النسخة السابقة على هذا الفرع كانت كاشير باركود مربوط بـ Firebase (دخول برقم هاتف وSMS، واشتراك شهري يوافق عليه المدير). دورة التوصيل تحتاج جهاز المحل وجهاز المندوب يشتغلون حتى والنت ضعيف، ورسائل SMS تحتاج خطة Firebase المدفوعة. لذلك الدفتر صار على الجهاز:

- نفس الموبايل: صاحب المحل والمندوب يدخلون برمز.
- موبايلين بدون نت: رمز ربط المندوب، ثم رمز الطلب، ثم رمز التأكيد.
- نقل الدفتر كامل: ملف JSON.

مزامنة لحظية لكل الأجهزة تحتاج سيرفر لاحقًا. ما انبنت هنا لأن الدورة اليومية تكتمل بدونها، والقواعد القديمة لـ Firebase ما تطابق الدفتر الجديد.

The earlier app on this branch was a barcode cashier on Firebase (phone SMS login and a subscription an admin approved by hand). Delivery needs the shop phone and the driver phone to work on a weak connection, and SMS login needs Firebase's paid plan. This ledger is on the device:

- One phone: owner and driver sign in with a PIN.
- Two phones, no network: a driver-join QR, then the order QR, then a confirmation QR.
- Moving the whole ledger: a JSON file.

Live sync across every phone would need a server later. It is not included because the daily loop works without it, and the old Firebase rules do not match this ledger.

## الاختبارات / Tests

`npm test` يشغّل حساب الدينار، حدود يوم بغداد، التصفية، ورمز QR. المنطق في `js/money.js` و`js/report.js` و`js/domain.js` و`js/qr.js` منفصل عن الشاشة عشان ينفحص بدون متصفح.

`npm test` covers dinar math, the Baghdad day boundary, settlement, and QR payloads. That logic lives in `js/money.js`, `js/report.js`, `js/domain.js`, and `js/qr.js`, separate from the screen, so it runs without a browser.

## حدود / Limitations

- الرمز السري يحمي الشاشات على الجهاز. أي شخص بيده الموبايل المفتوح يقدر يشوف الدفتر. اقفل الجهاز.
- رمز QR يحمل مجاميع الطلب (مو قائمة الأصناف) عشان تبقى الصورة قابلة للمسح. التفاصيل الكاملة تبقى على الجهاز اللي أنشأ الطلب، وتنتقل بملف النسخة.
- ما في كميات سالبة ولا فلوس بالفلس. الدينار بدون كسور.
- إلغاء التصفية يفتح الطلبات مرة ثانية وما يسجّل حركة صندوق مستقلة. أعد التصفية بالمبلغ الصح.
- الطباعة إلى PDF تعتمد على متصفح الجهاز وخطه العربي.
- النسخة السابقة (بيع الباركود داخل المحل، واشتراك ZainCash / الرافدين / FIB) مو موجودة في هذا الدفتر.

- The PIN only guards screens on that device. Anyone holding an unlocked phone can read the ledger. Lock the phone.
- The QR carries order totals, not the item list, so the code stays scannable. Full detail stays on the phone that created the order and moves with the backup file.
- No negative quantities and no fils. Dinars are whole numbers.
- Voiding a settlement reopens its orders and does not post a separate cash-drawer entry. Settle again with the right amount.
- Print-to-PDF depends on the phone's browser and its Arabic font.
- The previous in-store barcode sale flow and the ZainCash / Rafidain / FIB subscription are not part of this ledger.

## الملفات / Files

```
index.html              الشاشات
css/style.css           التنسيق
js/app.js               الشاشة والتنقل
js/money.js             الدينار وتقسيم النقد
js/domain.js            الطلب، التصفية، النسخة
js/report.js            تقارير بغداد
js/qr.js                رمز الطلب والتأكيد والربط
js/db.js                IndexedDB
js/format.js            عرض التاريخ والحالة
js/util.js              أدوات
sw.js                   العمل بدون نت
manifest.webmanifest    تثبيت التطبيق
vendor/                 إكسل، مسح الكاميرا، رسم QR
icons/                  أيقونة التطبيق
tests/                  اختبارات الحساب
```

import { formatDate, formatDateTime, formatIQD, formatQty } from './format.js';
import { UNITS } from './stock.js';
import { escapeHtml } from './util.js';

export function money(value) {
  return escapeHtml(formatIQD(value));
}

function safeLogo(logo) {
  return typeof logo === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/.test(logo) ? logo : '';
}

export function navItems(perms) {
  const items = [{ id: 'sale', label: 'البيع', short: 'بيع' }];
  if (perms.products) items.push({ id: 'products', label: 'المواد', short: 'مواد' });
  if (perms.debts) items.push({ id: 'debts', label: 'الديون', short: 'ديون' });
  if (perms.stock) items.push({ id: 'stock', label: 'المخزون', short: 'مخزون' });
  if (perms.reports) items.push({ id: 'reports', label: 'التقارير', short: 'تقارير' });
  items.push({ id: 'shift', label: 'الوردية', short: 'وردية' });
  if (perms.settings) items.push({ id: 'settings', label: 'الإعدادات', short: 'إعداد' });
  return items;
}

function navHtml(items, current, compact = false) {
  return items.map((item) => `<button data-action="nav" data-view="${item.id}" class="${item.id === current ? 'active' : ''}">${escapeHtml(compact ? item.short : item.label)}</button>`).join('');
}

export function shell({ shop, title, current, perms, cashier, shift, trialDays, body }) {
  const items = navItems(perms);
  return `
    <div class="app">
      <aside class="side">
        <div class="brand"><div class="brand-mark">ك</div><div><h1>${escapeHtml(shop.name)}</h1><p>محاسب الكاشير</p></div></div>
        <nav class="nav">${navHtml(items, current)}</nav>
      </aside>
      <section class="main">
        <header class="top">
          <div>
            <h2>${escapeHtml(title)}</h2>
            <div class="who">${escapeHtml(cashier.name)} · ${shift ? 'وردية مفتوحة' : 'لا توجد وردية'}</div>
          </div>
          <div class="btn-row">
            ${trialDays ? `<span class="trial">تجريبي ${trialDays} يوم</span>` : ''}
            <button class="btn-line" data-action="lock">قفل</button>
          </div>
        </header>
        ${body}
      </section>
      <nav class="tabbar">${navHtml(items, current, true)}</nav>
    </div>`;
}

export function setupView() {
  return `<div class="auth"><form class="auth-card" data-form="setup">
    <h2>إعداد المحل</h2>
    <p class="muted">يُحفظ الحساب على هذا الجهاز ويعمل بدون إنترنت.</p>
    <label class="field">اسم المحل<input name="shop" required></label>
    <label class="field">الهاتف<input name="phone" class="num"></label>
    <label class="field">العنوان<input name="address"></label>
    <label class="field">اسم المالك<input name="owner" required></label>
    <label class="field">رمز المالك (4–6 أرقام)<input name="pin" type="password" inputmode="numeric" class="num" required></label>
    <label class="field">تأكيد الرمز<input name="pin2" type="password" inputmode="numeric" class="num" required></label>
    <button class="btn" type="submit">بدء الاستخدام</button>
  </form></div>`;
}

export function activateView(message) {
  return `<div class="auth"><form class="auth-card" data-form="activate">
    <h2>تفعيل البرنامج</h2>
    <p>${escapeHtml(message)}</p>
    <label class="field">رمز التفعيل<input name="code" class="num" required></label>
    <button class="btn" type="submit">تفعيل</button>
    <button class="btn-line" type="button" data-action="backup" style="margin-top:8px">تنزيل نسخة احتياطية</button>
  </form></div>`;
}

export function lockView(cashiers, selectedId) {
  return `<div class="auth"><form class="auth-card" data-form="login">
    <h2>دخول الكاشير</h2>
    <div class="cashier-list">
      ${cashiers.filter((c) => c.active !== false).map((c) => `<button type="button" data-action="pick-cashier" data-id="${c.id}" class="${c.id === selectedId ? 'active' : ''}">${escapeHtml(c.name)} · ${c.role === 'owner' ? 'مالك' : 'كاشير'}</button>`).join('')}
    </div>
    <label class="field">الرمز<input id="pin" name="pin" type="password" inputmode="numeric" class="num" required></label>
    <button class="btn" type="submit">دخول</button>
  </form></div>`;
}

export function saleView({ stats, perms, shift, mine, cart, discount, customerId, customers, heldCount, lowCount }) {
  if (!shift) {
    return `<form class="card" data-form="open-shift" style="max-width:420px">
      <h3>فتح الوردية</h3>
      <p class="muted">عدّ النقد الموجود في الصندوق قبل أول فاتورة.</p>
      <label class="field">النقد الافتتاحي<input name="opening" class="num" inputmode="numeric" value="0" required></label>
      <button class="btn" type="submit">فتح الوردية</button>
    </form>`;
  }
  if (!mine && !perms.settings) {
    return `<div class="card"><p>الوردية مفتوحة باسم كاشير آخر. يطلب من المالك إغلاقها قبل البيع.</p></div>`;
  }
  const lines = cart.map((line) => `
    <div class="cart-line">
      <div>
        <div class="line-name">${escapeHtml(line.name)}</div>
        <div class="muted">${escapeHtml(line.barcode || '')} · ${money(line.unitPrice)} / ${escapeHtml(UNITS[line.unit] || '')}</div>
      </div>
      <div class="line-controls">
        <label>الكمية<input class="num" data-qty="${line.productId}" value="${line.qty}" inputmode="decimal"></label>
        ${perms.discount ? `<label>خصم<input class="num" data-discount="${line.productId}" value="${line.discount || 0}" inputmode="numeric"></label>` : '<span></span>'}
        <button class="btn-danger" type="button" data-action="remove-line" data-id="${line.productId}">حذف</button>
      </div>
    </div>`).join('');
  return `
    <div class="sale-screen">
    <div class="stats">
      <div class="stat"><span>مبيعات اليوم</span><strong>${money(stats.net)}</strong></div>
      <button class="stat warn" data-action="nav" data-view="debts"><span>ديون معلقة</span><strong>${money(stats.outstanding)}</strong>${stats.overdue ? `<em>متأخر ${formatIQD(stats.overdue)}</em>` : ''}</button>
      <div class="stat"><span>نواقص المخزون</span><strong class="${lowCount ? 'low' : ''}">${lowCount}</strong></div>
    </div>
    <div class="sale-layout">
      <div class="card">
        <div class="scan-row">
          <input id="barcode" placeholder="باركود أو اسم المادة" autocomplete="off">
          <button class="btn-line" type="button" data-action="camera">كاميرا</button>
        </div>
        <div id="search-results" class="search-results"></div>
        ${lines || '<p class="empty">امسح الباركود أو ابحث عن المادة. السكانر السلكي يكتب هنا ثم يضغط Enter.</p>'}
      </div>
      <aside class="ticket">
        <div class="ticket-meta">
          ${perms.discount ? `<label class="field">خصم الفاتورة<input id="invoice-discount" class="num" inputmode="numeric" value="${discount || 0}"></label>` : ''}
          <label class="field">الزبون
            <select id="cart-customer">
              <option value="">بدون زبون</option>
              ${customers.map((c) => `<option value="${c.id}" ${c.id === customerId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="btn-row ticket-secondary">
          <button class="btn-line" type="button" data-action="hold" ${cart.length ? '' : 'disabled'}>تعليق</button>
          <button class="btn-line" type="button" data-action="held">معلقة (${heldCount})</button>
          ${perms.returnSale ? '<button class="btn-line" type="button" data-action="start-return">مرتجع</button>' : ''}
        </div>
        <div class="paybar">
          <div>
            <div class="muted">المطلوب</div>
            <div class="total-due" id="due-total">0 د.ع</div>
          </div>
          <button class="btn" type="button" data-action="pay" ${cart.length ? '' : 'disabled'}>دفع</button>
        </div>
        <p class="keys">F2 البحث · F4 الدفع · F8 تعليق · F9 استرجاع المعلقة · Esc إغلاق</p>
      </aside>
    </div>
    </div>`;
}

export function productsView(products, categories) {
  const nameOf = (id) => categories.find((c) => c.id === id)?.name || '—';
  return `
    <div class="btn-row" style="margin-bottom:12px">
      <input id="product-filter" placeholder="بحث بالاسم أو الباركود" style="flex:2;min-height:44px;border:1px solid var(--line);border-radius:12px;padding:8px 12px">
      <button class="btn" data-action="edit-product" data-id="new">مادة جديدة</button>
      <button class="btn-line" data-action="export-products">تصدير إكسل</button>
      <button class="btn-line" data-action="import-products">استيراد إكسل</button>
      <input id="import-file" type="file" accept=".xlsx,.xls,.csv" hidden>
    </div>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>المادة</th><th>الباركود</th><th>التصنيف</th><th>السعر</th><th>المخزون</th><th></th></tr></thead>
        <tbody>
          ${products.filter((p) => p.active !== false).map((p) => `
            <tr data-product-row data-name="${escapeHtml(p.name)}" data-barcode="${escapeHtml(p.barcode || '')}">
              <td>${escapeHtml(p.name)}</td>
              <td class="num">${escapeHtml(p.barcode || '')}</td>
              <td>${escapeHtml(nameOf(p.categoryId))}</td>
              <td>${money(p.price)}</td>
              <td class="${p.trackStock !== false && Number(p.stock) <= Number(p.lowStock ?? 0) ? 'low' : ''}">${formatQty(p.stock, UNITS[p.unit] || '')}</td>
              <td><button class="btn-line" data-action="edit-product" data-id="${p.id}">تعديل</button></td>
            </tr>`).join('') || '<tr><td colspan="6">لا توجد مواد بعد.</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

export function productForm(product, categories) {
  const p = product || { barcode: '', name: '', categoryId: '', unit: 'piece', price: '', cost: '', stock: 0, lowStock: 3, trackStock: true };
  return `<form class="card" data-form="product" style="max-width:560px">
    <input type="hidden" name="id" value="${p.id || ''}">
    <label class="field">الباركود<input name="barcode" class="num" value="${escapeHtml(p.barcode || '')}"></label>
    <label class="field">الاسم<input name="name" required value="${escapeHtml(p.name || '')}"></label>
    <label class="field">التصنيف
      <select name="categoryId"><option value="">بدون</option>${categories.map((c) => `<option value="${c.id}" ${c.id === p.categoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
    </label>
    <label class="field">أو تصنيف جديد<input name="newCategory"></label>
    <label class="field">الوحدة
      <select name="unit">${Object.entries(UNITS).map(([id, label]) => `<option value="${id}" ${p.unit === id ? 'selected' : ''}>${label}</option>`).join('')}</select>
    </label>
    <label class="field">سعر البيع<input name="price" class="num" required value="${p.price ?? ''}"></label>
    <label class="field">سعر الكلفة<input name="cost" class="num" value="${p.cost ?? 0}"></label>
    <label class="field">المخزون<input name="stock" class="num" value="${p.stock ?? 0}"></label>
    <label class="field">حد التنبيه<input name="lowStock" class="num" value="${p.lowStock ?? 0}"></label>
    <label class="check"><input type="checkbox" name="trackStock" ${p.trackStock === false ? '' : 'checked'}> متابعة المخزون</label>
    <div class="btn-row">
      <button class="btn" type="submit">حفظ</button>
      ${p.id ? `<button class="btn-danger" type="button" data-action="delete-product" data-id="${p.id}">إيقاف</button>` : ''}
    </div>
  </form>`;
}

export function debtsView(rows) {
  const outstanding = rows.reduce((sum, row) => sum + Math.max(0, row.balance), 0);
  const overdue = rows.reduce((sum, row) => sum + row.overdue, 0);
  const debtors = rows.filter((row) => row.balance > 0).length;
  return `
    <div class="stats">
      <div class="stat warn"><span>إجمالي الديون</span><strong>${money(outstanding)}</strong></div>
      <div class="stat"><span>المتأخر</span><strong class="low">${money(overdue)}</strong></div>
      <div class="stat"><span>زبائن عليهم دين</span><strong>${debtors}</strong></div>
    </div>
    <div class="btn-row" style="margin-bottom:12px">
      <button class="btn" data-action="edit-customer" data-id="new">زبون جديد</button>
    </div>
    <div class="card">
      ${rows.map((row) => `
        <button class="list-btn" data-action="open-customer" data-id="${row.customer.id}">
          <span><strong>${escapeHtml(row.customer.name)}</strong><br><span class="muted">${escapeHtml(row.customer.phone || '')}</span></span>
          <span>${money(row.balance)}${row.overdue > 0 ? `<br><em class="badge bad">متأخر ${formatIQD(row.overdue)}</em>` : ''}</span>
        </button>`).join('') || '<p class="empty">لا يوجد زبائن. أضف زبونًا قبل البيع الآجل.</p>'}
    </div>`;
}

export function customerView({ customer, rows, balance, overdue, editing }) {
  if (editing || !customer) {
    const c = customer || { name: '', phone: '', address: '', creditLimit: '', note: '' };
    return `<form class="card" data-form="customer" style="max-width:560px">
      <input type="hidden" name="id" value="${c.id || ''}">
      <label class="field">الاسم<input name="name" required value="${escapeHtml(c.name || '')}"></label>
      <label class="field">الهاتف<input name="phone" class="num" value="${escapeHtml(c.phone || '')}"></label>
      <label class="field">العنوان<input name="address" value="${escapeHtml(c.address || '')}"></label>
      <label class="field">سقف الدين<input name="creditLimit" class="num" value="${c.creditLimit ?? ''}" placeholder="فارغ = لا يسمح بالآجل"></label>
      <label class="field">ملاحظة<textarea name="note">${escapeHtml(c.note || '')}</textarea></label>
      <button class="btn" type="submit">حفظ الزبون</button>
    </form>`;
  }
  return `
    <div class="stats">
      <div class="stat warn"><span>الرصيد</span><strong>${money(balance)}</strong></div>
      <div class="stat"><span>المتأخر</span><strong class="low">${money(overdue)}</strong></div>
      <div class="stat"><span>السقف</span><strong>${customer.creditLimit == null || customer.creditLimit === '' ? 'غير محدد' : money(customer.creditLimit)}</strong></div>
    </div>
    <div class="btn-row" style="margin-bottom:12px">
      <button class="btn-line" data-action="edit-customer" data-id="${customer.id}">تعديل</button>
      <button class="btn-line" data-action="print-statement" data-id="${customer.id}">طباعة الكشف</button>
      <button class="btn" data-action="share-statement" data-id="${customer.id}">واتساب</button>
    </div>
    <form class="card" data-form="payment">
      <input type="hidden" name="customerId" value="${customer.id}">
      <h3>تسديد دفعة</h3>
      <label class="field">المبلغ<input name="amount" class="num" required inputmode="numeric"></label>
      <label class="field">ملاحظة<input name="note" placeholder="دفعة / قسط"></label>
      <button class="btn" type="submit">تسجيل الدفعة النقدية</button>
    </form>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>التاريخ</th><th>البيان</th><th>الحركة</th><th>الرصيد</th></tr></thead>
        <tbody>
          ${rows.map((row) => `<tr><td>${escapeHtml(formatDateTime(row.at))}</td><td>${escapeHtml(entryLabel(row))}</td><td>${money(row.effect)}</td><td>${money(row.balance)}</td></tr>`).join('') || '<tr><td colspan="4">لا حركات بعد.</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

export function entryLabel(entry) {
  if (entry.type === 'charge') return entry.note || 'بيع آجل';
  if (entry.type === 'payment' && entry.method === 'return') return entry.note || 'مرتجع';
  if (entry.type === 'payment') return entry.note || 'تسديد';
  return entry.note || 'تعديل';
}

export function stockView(products, purchases) {
  const low = products.filter((p) => p.active !== false && p.trackStock !== false && Number(p.stock) <= Number(p.lowStock ?? 0));
  return `
    <div class="btn-row" style="margin-bottom:12px"><button class="btn" data-action="nav" data-view="purchase">فاتورة شراء</button></div>
    <div class="card"><h3>نواقص (${low.length})</h3>
      ${low.map((p) => `<p>${escapeHtml(p.name)} · <span class="low">${formatQty(p.stock, UNITS[p.unit] || '')}</span></p>`).join('') || '<p class="empty">المخزون فوق حد التنبيه.</p>'}
    </div>
    <div class="card"><h3>آخر المشتريات</h3>
      ${purchases.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8).map((p) => `<p>${escapeHtml(formatDateTime(p.at))} · ${escapeHtml(p.supplier || 'مورد')} · ${money(p.total)}</p>`).join('') || '<p class="empty">لا توجد فواتير شراء.</p>'}
    </div>`;
}

export function purchaseView(products, lines) {
  return `
    <form class="card" data-form="purchase-line" style="max-width:640px">
      <label class="field">المادة
        <select name="productId" required><option value="">اختر</option>${products.filter((p) => p.active !== false).map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select>
      </label>
      <label class="field">الكمية<input name="qty" class="num" required></label>
      <label class="field">سعر الكلفة<input name="unitCost" class="num" required></label>
      <button class="btn-line" type="submit">إضافة للفاتورة</button>
    </form>
    <form class="card" data-form="purchase" style="max-width:640px">
      <label class="field">المورد<input name="supplier" required></label>
      <label class="check"><input type="checkbox" name="paidCash" checked> دُفع من الصندوق</label>
      ${lines.map((line, index) => `<p>${escapeHtml(line.name)} · ${line.qty} × ${money(line.unitCost)} <button type="button" class="btn-danger" data-action="remove-purchase" data-index="${index}">حذف</button></p>`).join('') || '<p class="empty">أضف مواد الفاتورة.</p>'}
      <button class="btn" type="submit" ${lines.length ? '' : 'disabled'}>حفظ الشراء وتحديث المخزون</button>
    </form>`;
}

export function reportsView(report, from, to) {
  return `
    <form class="card" data-form="report-range">
      <div class="btn-row">
        <label class="field">من<input type="date" name="from" value="${from}"></label>
        <label class="field">إلى<input type="date" name="to" value="${to}"></label>
        <button class="btn" type="submit">عرض</button>
      </div>
    </form>
    <div class="stats">
      <div class="stat"><span>صافي المبيعات</span><strong>${money(report.net)}</strong></div>
      <div class="stat"><span>الربح</span><strong>${money(report.profit)}</strong></div>
      <div class="stat"><span>ديون الفترة</span><strong>${money(report.credit)}</strong></div>
    </div>
    <div class="card">
      <p class="row-between"><span>الفواتير</span><strong>${report.invoices}</strong></p>
      <p class="row-between"><span>الخصومات</span><strong>${money(report.discounts)}</strong></p>
      <p class="row-between"><span>المرتجعات</span><strong>${money(report.returnsTotal)}</strong></p>
      <p class="row-between"><span>نقد</span><strong>${money(report.cash)}</strong></p>
      <p class="row-between"><span>بطاقة</span><strong>${money(report.card)}</strong></p>
      <p class="row-between"><span>تحصيل ديون</span><strong>${money(report.debtCollected)}</strong></p>
      <p class="row-between"><span>مشتريات</span><strong>${money(report.purchaseTotal)}</strong></p>
      <p class="row-between"><span>كلفة البضاعة</span><strong>${money(report.cogs)}</strong></p>
    </div>
    <div class="card"><h3>حسب التصنيف</h3>${report.byCategory.map((row) => `<p class="row-between"><span>${escapeHtml(row.name)}</span><strong>${money(row.total)}</strong></p>`).join('') || '<p class="empty">لا مبيعات.</p>'}</div>
    <div class="card"><h3>الأكثر مبيعًا</h3>${report.bestSellers.map((row) => `<p class="row-between"><span>${escapeHtml(row.name)}</span><strong>${money(row.total)}</strong></p>`).join('') || '<p class="empty">لا مبيعات.</p>'}</div>
    <button class="btn-line" data-action="export-report">تصدير إكسل</button>`;
}

export function shiftView({ shift, cashierName, preview, canClose }) {
  if (!shift) return `<div class="card"><p>لا توجد وردية مفتوحة.</p><button class="btn" data-action="nav" data-view="sale">العودة للبيع</button></div>`;
  return `
    <div class="card">
      <p>الكاشير: ${escapeHtml(cashierName)}</p>
      <p>فُتحت: ${escapeHtml(formatDateTime(shift.openedAt))}</p>
      <p class="row-between"><span>افتتاحي</span><strong>${money(shift.opening)}</strong></p>
      <p class="row-between"><span>المتوقع في الصندوق</span><strong>${money(preview.expected)}</strong></p>
      <p class="muted">يشمل مبيعات النقد وتحصيل الديون، ويخصم المرتجعات والمشتريات المدفوعة من الصندوق.</p>
    </div>
    ${canClose ? `<form class="card" data-form="close-shift" style="max-width:420px">
      <label class="field">النقد المعدود<input name="counted" class="num" required inputmode="numeric"></label>
      <label class="field">ملاحظة<input name="note"></label>
      <button class="btn" type="submit">إغلاق الوردية وطباعة التقرير</button>
    </form>` : '<div class="card">إغلاق هذه الوردية من صلاحية صاحبها أو المالك.</div>'}`;
}

export function settingsView(shop, cashiers) {
  return `
    <form class="card" data-form="settings" style="max-width:560px">
      <label class="field">اسم المحل<input name="name" value="${escapeHtml(shop.name)}" required></label>
      <label class="field">الهاتف<input name="phone" class="num" value="${escapeHtml(shop.phone || '')}"></label>
      <label class="field">العنوان<input name="address" value="${escapeHtml(shop.address || '')}"></label>
      <label class="field">تذييل الفاتورة<input name="footer" value="${escapeHtml(shop.footer || 'شكرًا لزيارتكم')}"></label>
      <label class="field">عرض الورق
        <select name="paper"><option value="80" ${shop.paper === '58' ? '' : 'selected'}>80 مم</option><option value="58" ${shop.paper === '58' ? 'selected' : ''}>58 مم</option></select>
      </label>
      <label class="field">أيام استحقاق الآجل<input name="creditDays" class="num" value="${shop.creditDays ?? 30}"></label>
      <label class="field">شعار المحل<input name="logo" type="file" accept="image/*"></label>
      ${safeLogo(shop.logo) ? `<img class="logo-preview" src="${safeLogo(shop.logo)}" alt="">` : ''}
      <button class="btn" type="submit">حفظ الإعدادات</button>
    </form>
    <form class="card" data-form="license" style="max-width:560px">
      <label class="field">رمز التفعيل<input name="code" class="num" placeholder="KSH1...."></label>
      <button class="btn-line" type="submit">تفعيل</button>
    </form>
    <div class="card">
      <h3>الكاشيرات</h3>
      ${cashiers.map((c) => `<p>${escapeHtml(c.name)} · ${c.role === 'owner' ? 'مالك' : 'كاشير'}</p>`).join('')}
      <form data-form="cashier">
        <label class="field">اسم الكاشير<input name="name" required></label>
        <label class="field">الرمز<input name="pin" type="password" inputmode="numeric" class="num" required></label>
        <label class="check"><input type="checkbox" name="discount"> السماح بالخصم</label>
        <label class="check"><input type="checkbox" name="returnSale" checked> السماح بالمرتجع</label>
        <button class="btn" type="submit">إضافة كاشير</button>
      </form>
    </div>
    <div class="btn-row">
      <button class="btn-line" data-action="backup">نسخة احتياطية</button>
      <button class="btn-line" data-action="restore">استرجاع</button>
      <input id="restore-file" type="file" accept="application/json" hidden>
    </div>`;
}

export function returnView(sale) {
  if (!sale) {
    return `<form class="card" data-form="find-sale" style="max-width:420px">
      <label class="field">رقم الفاتورة<input name="number" class="num" required></label>
      <button class="btn" type="submit">بحث</button>
    </form>`;
  }
  const lines = sale.lines.map((line, index) => {
    const left = Math.round((Number(line.qty) - Number(line.returnedQty || 0)) * 1000) / 1000;
    if (left <= 0) return '';
    return `<label class="field">${escapeHtml(line.name)} · المتبقي ${left}<input class="num" name="qty-${index}" inputmode="decimal" placeholder="0"></label>`;
  }).join('');
  return `<form class="card" data-form="return-sale" style="max-width:520px">
    <input type="hidden" name="saleId" value="${sale.id}">
    <p>فاتورة ${sale.number} · ${money(sale.total)}</p>
    ${lines || '<p>هذه الفاتورة مرتجعة بالكامل.</p>'}
    <label class="field">طريقة الرد<select name="method"><option value="cash">نقد من الصندوق</option><option value="debt">خصم من دين الزبون</option></select></label>
    <button class="btn" type="submit">تنفيذ المرتجع</button>
  </form>`;
}

export function modalWrap(inner) {
  return `<div class="modal"><div class="modal-card">${inner}</div></div>`;
}

export function payModal({ total, customers, customerId, dueKey, minDue }) {
  return modalWrap(`
    <h3>الدفع</h3>
    <p class="row-between"><span>قيمة الفاتورة</span><strong>${money(total)}</strong></p>
    <form data-form="pay" novalidate>
      <label class="field">نقد مستلم<input name="tendered" class="num" inputmode="numeric" value="${total}"></label>
      <label class="field">بطاقة<input name="card" class="num" inputmode="numeric" value="0"></label>
      <label class="field">آجل على الزبون<input name="debt" class="num" inputmode="numeric" value="0"></label>
      <p class="row-between"><span>المطلوب نقدًا</span><strong id="cash-due">${money(total)}</strong></p>
      <p class="row-between"><span>الباقي للزبون</span><strong id="change-due">${money(0)}</strong></p>
      <label class="field">الزبون
        <select name="customerId"><option value="">بدون</option>${customers.map((c) => `<option value="${c.id}" ${c.id === customerId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
      </label>
      <label class="field">استحقاق الآجل<input type="date" name="due" value="${dueKey}" min="${minDue || dueKey}"></label>
      <div class="btn-row">
        <button class="btn" type="submit">إتمام الفاتورة</button>
        <button class="btn-line" type="button" data-action="close-modal">رجوع</button>
      </div>
    </form>`);
}

export function receiptHtml(shop, sale, customer, balance) {
  const paper = shop.paper === '58' ? 'paper-58' : '';
  const rows = (sale.lines || []).map((line) => `<tr><td>${escapeHtml(line.name)} × ${line.qty}</td><td>${formatIQD(line.total)}</td></tr>`).join('');
  return `<article class="receipt ${paper}">
    <div class="center">
      ${safeLogo(shop.logo) ? `<img src="${safeLogo(shop.logo)}" alt="" style="max-height:64px">` : ''}
      <h3>${escapeHtml(shop.name)}</h3>
      <p>${escapeHtml(shop.phone || '')}</p>
      <p>${escapeHtml(shop.address || '')}</p>
    </div>
    <hr>
    <p>فاتورة ${sale.number}</p>
    <p>${escapeHtml(formatDateTime(sale.at))}</p>
    <p>الكاشير: ${escapeHtml(sale.cashierName || '')}</p>
    <hr>
    <table>${rows}</table>
    <hr>
    <p class="row-between"><span>المجموع</span><span>${formatIQD(sale.subtotal)}</span></p>
    ${sale.invoiceDiscount ? `<p class="row-between"><span>الخصم</span><span>${formatIQD(sale.invoiceDiscount)}</span></p>` : ''}
    <p class="row-between"><strong>الإجمالي</strong><strong>${formatIQD(sale.total)}</strong></p>
    ${(sale.payments || []).map((p) => `<p class="row-between"><span>${p.method === 'cash' ? 'نقد' : p.method === 'card' ? 'بطاقة' : 'آجل'}</span><span>${formatIQD(p.amount)}</span></p>`).join('')}
    ${sale.change ? `<p class="row-between"><span>الباقي</span><span>${formatIQD(sale.change)}</span></p>` : ''}
    ${customer ? `<hr><p>الزبون: ${escapeHtml(customer.name)}</p><p>رصيد الدين: ${formatIQD(balance)}</p>` : ''}
    <hr>
    <p class="center">${escapeHtml(shop.footer || 'شكرًا لزيارتكم')}</p>
  </article>`;
}

export function statementHtml(shop, customer, rows, balance, overdue) {
  const body = rows.map((row) => `<tr><td>${escapeHtml(formatDate(row.at))}</td><td>${escapeHtml(entryLabel(row))}</td><td>${formatIQD(row.effect)}</td><td>${formatIQD(row.balance)}</td></tr>`).join('');
  return `<article class="receipt statement-print">
    <div class="center"><h3>${escapeHtml(shop.name)}</h3><p>كشف حساب</p></div>
    <p>الزبون: ${escapeHtml(customer.name)}</p>
    <p>الهاتف: ${escapeHtml(customer.phone || '—')}</p>
    <p>الرصيد: ${formatIQD(balance)}</p>
    <p>المتأخر: ${formatIQD(overdue)}</p>
    <table>
      <thead><tr><th>التاريخ</th><th>البيان</th><th>الحركة</th><th>الرصيد</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </article>`;
}

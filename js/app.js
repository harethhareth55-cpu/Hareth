'use strict';

import {
  commitSettlement,
  deleteItem,
  loadAll,
  replaceAll,
  saveDriver,
  saveItem,
  saveNewOrder,
  saveOrder,
  saveShop,
  voidSettlement as voidSettlementTx,
  wipeDatabase,
} from './db.js';
import {
  applyCancel,
  applyConfirmation,
  applyDelivery,
  applyPickup,
  applyReturn,
  assertCanDeactivate,
  buildSettlement,
  createDriverRecord,
  createItemRecord,
  createOrderRecord,
  createShopRecord,
  driverBalance,
  exportBackup,
  hashPin,
  normalizeLine,
  parseBackup,
  sameConfirmation,
  shopFromJoin,
  updateDriverRecord,
  updateOpenOrder,
  updateShopSettings,
  verifyPin,
} from './domain.js';
import { formatDay, formatWhen, orderNo, STATUS_META } from './format.js';
import { deliverySplit, formatIQD, lineAmount, quoteOrder } from './money.js';
import { confirmToQR, decodePayload, joinToQR, orderFromQR, orderToQR } from './qr.js';
import { baghdadDateKey, inBaghdadRange, periodReport, shiftDateKey, summarizeOrders } from './report.js';
import { downloadBlob, escapeHtml, userMessage } from './util.js';

const SESSION_KEY = 'da.session.v1';

const state = {
  shop: null,
  drivers: [],
  orders: [],
  settlements: [],
  items: [],
  session: null,
  view: 'home',
  params: {},
  draftLines: [],
  lockTarget: null,
  joinPayload: null,
  query: '',
  filter: 'all',
  lastReport: null,
};

let scanner = null;
let scanGen = 0;

function today() {
  return baghdadDateKey(new Date());
}

function isOwner() {
  return state.session?.role === 'owner';
}

function driverById(id) {
  return state.drivers.find((driver) => driver.id === id) || null;
}

function driverName(id) {
  if (!id) return 'بدون مندوب';
  return driverById(id)?.name || 'مندوب محذوف';
}

function ordersForSession() {
  const all = state.orders.slice().sort((a, b) => (b.number || 0) - (a.number || 0));
  if (isOwner()) return all;
  const id = state.session?.driverId;
  return all.filter((order) => order.driverId === id || (order.status === 'new' && !order.driverId));
}

function findOrder(id) {
  return state.orders.find((order) => order.id === id) || null;
}

function dueText(order) {
  try {
    return formatIQD(quoteOrder(order).customerDue);
  } catch {
    return '—';
  }
}

function feeRuleText() {
  if (state.shop?.feeBeneficiary === 'shop') {
    return 'أجرة التوصيل للمحل. المندوب يسلّم كل المبلغ المطلوب من الزبون، وإذا استلم أقل يتحمّل الفرق.';
  }
  return 'أجرة التوصيل للمندوب. يسلّم للمحل قيمة البضاعة بعد الخصم. النقص على المندوب، والزيادة للمحل.';
}

function setSession(session) {
  state.session = session;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  state.session = null;
  state.lockTarget = null;
  localStorage.removeItem(SESSION_KEY);
}

function restoreSession() {
  if (state.shop?.roleDevice === 'driver') {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (saved?.role === 'driver' && saved.driverId === state.shop.linkedDriverId) return saved;
    } catch { /* يبقى مقفل */ }
    return null;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (saved?.role === 'owner') return saved;
    if (saved?.role === 'driver' && driverById(saved.driverId)?.active) return saved;
  } catch { /* تجاهل */ }
  return null;
}

function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3400);
}

function ask(message, okLabel = 'تأكيد') {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="modal-card">
        <p>${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-no>رجوع</button>
          <button type="button" class="btn primary" data-yes>${escapeHtml(okLabel)}</button>
        </div>
      </div>`;
    const close = (value) => { wrap.remove(); resolve(value); };
    wrap.querySelector('[data-no]').onclick = () => close(false);
    wrap.querySelector('[data-yes]').onclick = () => close(true);
    document.body.appendChild(wrap);
  });
}

function beep(ok = true) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
    osc.onended = () => ctx.close();
  } catch { /* الصوت اختياري */ }
}

function canOpen(view) {
  if (!state.session) return false;
  if (isOwner()) return view !== 'account';
  return ['home', 'orders', 'order', 'scan', 'account'].includes(view);
}

async function reload() {
  const data = await loadAll();
  state.shop = data.shop;
  state.drivers = data.drivers;
  state.orders = data.orders;
  state.settlements = data.settlements;
  state.items = data.items;
}

async function go(view, params = {}) {
  if (state.shop && state.session && !canOpen(view)) {
    toast('هذه الشاشة لصاحب المحل');
    view = 'home';
    params = {};
  }
  await stopCamera();
  if (view === 'order-form') {
    const existing = params.id ? findOrder(params.id) : null;
    if (existing && existing.status !== 'new') throw new Error('ما يتعدل الطلب بعد ما يطلع مع المندوب');
    state.draftLines = existing ? (existing.lines || []).map((line) => ({ ...line })) : [];
  } else {
    state.draftLines = [];
  }
  state.view = view;
  state.params = params;
  render();
  window.scrollTo(0, 0);
}

function render() {
  const root = document.getElementById('app');
  if (!state.shop) {
    root.innerHTML = state.view === 'join' ? viewJoin() : viewSetup();
    return;
  }
  if (!state.session) {
    root.innerHTML = viewLock();
    return;
  }
  root.innerHTML = viewShell((() => {
    try {
      return viewBody();
    } catch (err) {
      console.error(err);
      return `<section class="page"><p class="empty">${escapeHtml(userMessage(err))}</p></section>`;
    }
  })());
  drawQrs();
  if (state.view === 'scan') startCamera();
  if (state.view === 'order-form') {
    paintLines();
    paintDue();
  }
  if (state.view === 'order') paintDeliverHint();
  if (state.view === 'settle') paintSettle();
  if (state.view === 'reports') runReport();
}

function viewBody() {
  switch (state.view) {
    case 'orders': return viewOrders();
    case 'order': return viewOrder();
    case 'order-form': return viewOrderForm();
    case 'scan': return viewScan();
    case 'drivers': return viewDrivers();
    case 'driver': return viewDriver();
    case 'driver-form': return viewDriverForm();
    case 'settle': return viewSettle();
    case 'more': return viewMore();
    case 'reports': return viewReports();
    case 'items': return viewItems();
    case 'settings': return viewSettings();
    case 'account': return viewAccount();
    default: return viewHome();
  }
}

function viewShell(body) {
  const nav = isOwner()
    ? [
      ['home', 'اليوم', '🏠'],
      ['orders', 'الطلبات', '📋'],
      ['scan', 'مسح', '📷'],
      ['drivers', 'المندوبون', '🛵'],
      ['more', 'المزيد', '☰'],
    ]
    : [
      ['home', 'اليوم', '🏠'],
      ['orders', 'طلباتي', '📋'],
      ['scan', 'مسح', '📷'],
      ['account', 'حسابي', '💰'],
    ];
  const active = {
    order: 'orders',
    'order-form': 'orders',
    driver: 'drivers',
    'driver-form': 'drivers',
    settle: 'drivers',
    reports: 'more',
    items: 'more',
    settings: 'more',
  }[state.view] || state.view;
  const who = isOwner() ? 'صاحب المحل' : driverName(state.session.driverId);
  return `
    <div class="app">
      <header class="top">
        <div>
          <div class="shop-name">${escapeHtml(state.shop.name)}</div>
          <div class="role-line">${escapeHtml(who)}</div>
        </div>
        <button type="button" class="icon-btn" data-action="lock">قفل</button>
      </header>
      <main class="main">${body}</main>
      <nav class="tabbar">
        ${nav.map(([id, label, icon]) => `
          <button type="button" data-nav="${id}" class="${active === id ? 'active' : ''}">
            <span class="tab-icon">${icon}</span><span>${label}</span>
          </button>`).join('')}
      </nav>
    </div>`;
}

function viewSetup() {
  return `
    <section class="gate">
      <div class="gate-card">
        <p class="eyebrow">للمحلات والماركتات</p>
        <h1>محاسب التوصيل</h1>
        <p class="lead">سجّل طلبات التوصيل، سلّمها للمندوب برمز QR، وثبّت النقد لما يرجّع الحساب.</p>
        <form id="setup-form" class="stack">
          <label class="field">اسم المحل<input name="name" required maxlength="60" placeholder="ماركت النور"></label>
          <label class="field">اسم صاحب المحل<input name="ownerName" required maxlength="60" placeholder="اسمك"></label>
          <label class="field">هاتف المحل<input name="phone" inputmode="tel" placeholder="07xxxxxxxxx"></label>
          <label class="field">أجرة التوصيل الافتراضية<input name="defaultDeliveryFee" inputmode="numeric" value="2000"></label>
          <fieldset class="choice">
            <legend>أجرة التوصيل تروح لـ</legend>
            <label><input type="radio" name="feeBeneficiary" value="driver" checked> المندوب</label>
            <label><input type="radio" name="feeBeneficiary" value="shop"> المحل</label>
          </fieldset>
          <label class="field">رمز سري لصاحب المحل<input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="6" required placeholder="٤ إلى ٦ أرقام"></label>
          <label class="field">تأكيد الرمز<input name="pin2" type="password" inputmode="numeric" minlength="4" maxlength="6" required></label>
          <button class="btn primary" type="submit">فتح الدفتر</button>
        </form>
        <button type="button" class="btn ghost" data-action="show-join">عندي رمز جهاز مندوب</button>
      </div>
    </section>`;
}

function viewJoin() {
  const known = state.joinPayload;
  return `
    <section class="gate">
      <div class="gate-card">
        <h1>ربط جهاز المندوب</h1>
        <p class="lead">${known ? `الجهاز راح يصير لمندوب ${escapeHtml(known.dn)} في ${escapeHtml(known.sn)}.` : 'الصق رمز الربط من شاشة المندوب عند صاحب المحل، أو امسحه بالكاميرا.'}</p>
        <form id="join-form" class="stack">
          ${known ? '' : `<label class="field">رمز الربط<textarea name="code" placeholder="DA1...."></textarea></label>
          <button type="button" class="btn secondary" data-action="start-camera">تشغيل الكاميرا</button>
          <p id="scan-msg" class="hint"></p>
          <div id="reader"></div>`}
          <label class="field">رمز لهذا الجهاز<input name="pin" type="password" inputmode="numeric" required minlength="4" maxlength="6" placeholder="٤ إلى ٦ أرقام"></label>
          <label class="field">تأكيد الرمز<input name="pin2" type="password" inputmode="numeric" required minlength="4" maxlength="6"></label>
          <button class="btn primary" type="submit">ربط الجهاز</button>
        </form>
        <button type="button" class="btn ghost" data-action="show-setup">رجوع لتأسيس محل</button>
      </div>
    </section>`;
}

function viewLock() {
  if (state.shop.roleDevice === 'driver') {
    const driver = driverById(state.shop.linkedDriverId);
    return `
      <section class="gate">
        <div class="gate-card">
          <p class="eyebrow">${escapeHtml(state.shop.name)}</p>
          <h1>${escapeHtml(driver?.name || 'المندوب')}</h1>
          <form id="pin-form" class="stack">
            <label class="field">رمز الجهاز<input id="pin" name="pin" type="password" inputmode="numeric" required></label>
            <button class="btn primary" type="submit">دخول</button>
          </form>
          <button type="button" class="btn ghost" data-action="wipe">نسيت الرمز؟ مسح هذا الجهاز</button>
        </div>
      </section>`;
  }
  const target = state.lockTarget;
  return `
    <section class="gate">
      <div class="gate-card">
        <p class="eyebrow">${escapeHtml(state.shop.name)}</p>
        <h1>من يدخل؟</h1>
        <div class="stack">
          <button type="button" class="btn secondary ${target?.role === 'owner' ? 'selected' : ''}" data-action="choose-login" data-role="owner">صاحب المحل — ${escapeHtml(state.shop.ownerName)}</button>
          ${state.drivers.filter((driver) => driver.active).map((driver) => `
            <button type="button" class="btn secondary ${target?.driverId === driver.id ? 'selected' : ''}" data-action="choose-login" data-role="driver" data-driver="${escapeHtml(driver.id)}">${escapeHtml(driver.name)}</button>
          `).join('') || '<p class="empty">ماكو مندوبين بعد. ادخل كصاحب محل وأضفهم.</p>'}
        </div>
        <form id="pin-form" class="stack">
          <label class="field">الرمز السري<input id="pin" name="pin" type="password" inputmode="numeric" required></label>
          <button class="btn primary" type="submit">دخول</button>
        </form>
      </div>
    </section>`;
}

function viewHome() {
  const day = today();
  const mine = ordersForSession();
  const report = periodReport(mine, { from: day, to: day, feeBeneficiary: state.shop.feeBeneficiary });
  const openCash = summarizeOrders(mine.filter((order) => order.status === 'delivered' && !order.settlementId), state.shop.feeBeneficiary);
  const custody = summarizeOrders(mine.filter((order) => order.status === 'picked_up'), state.shop.feeBeneficiary);
  const recent = mine.slice(0, 5);
  return `
    <section class="page">
      <p class="eyebrow">${escapeHtml(formatDay(new Date().toISOString()))}</p>
      <h2>حركة اليوم</h2>
      <div class="stats">
        ${stat('طلبات جديدة', report.createdCount)}
        ${stat('تم تسليمها', report.deliveredCount)}
        ${stat('نقد مستلم', formatIQD(report.cash.cashCollected))}
        ${stat('بانتظار التصفية', formatIQD(openCash.expectedHandover))}
      </div>
      ${custody.custodyCount ? `<div class="banner">عهدة عند المندوبين: ${custody.custodyCount} طلب — بضاعة ${formatIQD(custody.custodyValue)}</div>` : ''}
      ${isOwner() ? `<button type="button" class="btn primary" data-action="new-order">طلب جديد</button>` : ''}
      <h3>آخر الطلبات</h3>
      <div class="list">${recent.length ? recent.map(orderCard).join('') : '<p class="empty">ماكو طلبات بعد.</p>'}</div>
    </section>`;
}

function stat(label, value) {
  return `<div class="stat"><span>${label}</span><strong class="num">${value}</strong></div>`;
}

function viewOrders() {
  return `
    <section class="page">
      <div class="page-head">
        <h2>${isOwner() ? 'الطلبات' : 'طلباتي'}</h2>
        ${isOwner() ? '<button type="button" class="btn primary small" data-action="new-order">طلب جديد</button>' : ''}
      </div>
      <input id="order-search" placeholder="اسم، هاتف، أو رقم الطلب" value="${escapeHtml(state.query)}">
      <div class="chips">
        ${['all', 'new', 'picked_up', 'delivered', 'returned', 'cancelled'].map((key) => `
          <button type="button" class="chip ${state.filter === key ? 'active' : ''}" data-action="filter" data-status="${key}">
            ${key === 'all' ? 'الكل' : STATUS_META[key].label}
          </button>`).join('')}
      </div>
      <div id="order-list" class="list">${orderCardsHtml()}</div>
    </section>`;
}

function filteredOrders() {
  const q = state.query.trim();
  return ordersForSession().filter((order) => {
    if (state.filter !== 'all' && order.status !== state.filter) return false;
    if (!q) return true;
    const hay = `${order.number} ${order.customerName} ${order.customerPhone} ${order.area} ${order.address}`.toLowerCase();
    return hay.includes(q.toLowerCase()) || String(order.number) === q.replace('#', '');
  });
}

function orderCardsHtml() {
  const rows = filteredOrders();
  if (!rows.length) return '<p class="empty">لا توجد طلبات بهالفلتر.</p>';
  return rows.map(orderCard).join('');
}

function orderCard(order) {
  const meta = STATUS_META[order.status] || STATUS_META.new;
  return `
    <button type="button" class="row-card" data-action="open-order" data-id="${escapeHtml(order.id)}">
      <div class="row-top">
        <b>${orderNo(order.number)}</b>
        <span class="badge ${meta.cls}">${meta.label}</span>
        ${order.settlementId ? '<span class="badge st-off">مصفّى</span>' : ''}
      </div>
      <div class="row-title">${escapeHtml(order.customerName)}</div>
      <div class="row-sub">${escapeHtml(order.area || order.address || order.customerPhone || 'بدون عنوان')}</div>
      <div class="row-bottom">
        <span>${escapeHtml(driverName(order.driverId))}</span>
        <span class="num">${dueText(order)}</span>
      </div>
    </button>`;
}

function viewOrder() {
  const order = findOrder(state.params.id);
  if (!order || !ordersForSession().some((row) => row.id === order.id)) {
    return '<section class="page"><p class="empty">الطلب غير موجود.</p></section>';
  }
  const meta = STATUS_META[order.status];
  const quote = quoteOrder(order);
  const payload = orderToQR(order);
  const showConfirm = !isOwner() && (order.status === 'picked_up' || order.status === 'delivered' || order.status === 'returned');
  const confirmPayload = showConfirm ? confirmToQR({
    shopId: order.shopId,
    orderId: order.id,
    token: order.token,
    status: order.status === 'new' ? 'picked_up' : order.status,
    cashCollected: order.cashCollected || 0,
    driverId: order.driverId || '',
  }) : '';
  const lines = (order.lines || []).map((line) => `
    <div class="kv"><span>${escapeHtml(line.name)} × ${line.qty}</span><b class="num">${formatIQD(lineAmount(line.qty, line.unitPrice))}</b></div>
  `).join('');
  return `
    <section class="page">
      <div class="page-head">
        <h2>طلب ${orderNo(order.number)}</h2>
        <span class="badge ${meta.cls}">${meta.label}</span>
      </div>
      <section class="card">
        <h3>${escapeHtml(order.customerName)}</h3>
        <p>${escapeHtml(order.customerPhone || 'بدون هاتف')}</p>
        <p>${escapeHtml([order.area, order.address].filter(Boolean).join(' — ') || 'بدون عنوان')}</p>
        <p class="muted">المندوب: ${escapeHtml(driverName(order.driverId))}</p>
        ${order.notes ? `<p class="muted">ملاحظة: ${escapeHtml(order.notes)}</p>` : ''}
        ${lines}
        ${moneyRow('البضاعة', quote.goodsTotal)}
        ${moneyRow('الخصم', quote.discount)}
        ${moneyRow('أجرة التوصيل', quote.deliveryFee)}
        ${moneyRow('المطلوب من الزبون', quote.customerDue)}
        ${order.status === 'delivered' ? moneyRow('النقد المستلم', order.cashCollected || 0) : ''}
        ${order.returnReason ? `<p>سبب الإرجاع: ${escapeHtml(order.returnReason)}</p>` : ''}
      </section>
      <section class="card">
        <h3>التتبع</h3>
        <ul class="timeline">
          <li>أُنشئ ${escapeHtml(formatWhen(order.createdAt))}</li>
          ${order.pickedUpAt ? `<li>استلمه المندوب ${escapeHtml(formatWhen(order.pickedUpAt))}</li>` : ''}
          ${order.deliveredAt ? `<li>تم التسليم ${escapeHtml(formatWhen(order.deliveredAt))}</li>` : ''}
          ${order.returnedAt ? `<li>مرتجع ${escapeHtml(formatWhen(order.returnedAt))}</li>` : ''}
          ${order.cancelledAt ? `<li>أُلغي ${escapeHtml(formatWhen(order.cancelledAt))}</li>` : ''}
          ${order.settlementId ? '<li>دخل بتصفية</li>' : ''}
        </ul>
      </section>
      ${order.status === 'new' ? qrBlock('رمز الطلب — المندوب يمسحه عند الاستلام', payload) : ''}
      ${isOwner() && order.status !== 'new' ? qrBlock('رمز الطلب', payload) : ''}
      ${confirmPayload ? qrBlock('اعرض هذا الرمز لصاحب المحل', confirmPayload) : ''}
      ${order.status === 'new' && isOwner() ? `<label class="field">المندوب اللي راح يستلم<select id="pickup-driver">${driverOptions(order.driverId)}</select></label>` : ''}
      ${order.status === 'picked_up' ? `
        <form id="deliver-form" class="card stack dock">
          <h3>تسليم الزبون</h3>
          <label class="field">النقد المستلم من الزبون<input id="deliver-cash" name="cash" inputmode="numeric" value="${quote.customerDue}"></label>
          <p id="deliver-hint" class="hint"></p>
          <button class="btn primary" type="submit">تأكيد التسليم</button>
        </form>` : ''}
      <div class="stack dock">
        ${order.status === 'new' ? '<button type="button" class="btn primary" data-action="pickup">تأكيد الاستلام</button>' : ''}
        ${(order.status === 'picked_up' || (isOwner() && order.status === 'delivered' && !order.settlementId)) ? `
          <label class="field">سبب الإرجاع إن وجد<input id="return-reason" placeholder="اختياري"></label>
          <button type="button" class="btn secondary" data-action="return-order">تسجيل مرتجع</button>` : ''}
        ${isOwner() && order.status === 'new' ? '<button type="button" class="btn secondary" data-action="edit-order">تعديل الطلب</button>' : ''}
        ${isOwner() && (order.status === 'new' || order.status === 'picked_up') ? '<button type="button" class="btn danger" data-action="cancel-order">إلغاء الطلب</button>' : ''}
        <button type="button" class="btn ghost" data-action="share-order">مشاركة تفاصيل الطلب</button>
      </div>
    </section>`;
}

function moneyRow(label, value) {
  return `<div class="kv"><span>${label}</span><b class="num">${formatIQD(value)}</b></div>`;
}

function qrBlock(title, text) {
  return `
    <section class="card">
      <h3>${title}</h3>
      <div class="qr-box" data-qr="${escapeHtml(text)}"></div>
      <textarea class="code-box" readonly>${escapeHtml(text)}</textarea>
      <button type="button" class="btn secondary" data-action="copy-code">نسخ الرمز</button>
    </section>`;
}

function driverOptions(selected) {
  const rows = ['<option value="">اختر المندوب</option>'];
  for (const driver of state.drivers) {
    if (!driver.active && driver.id !== selected) continue;
    rows.push(`<option value="${escapeHtml(driver.id)}" ${driver.id === selected ? 'selected' : ''}>${escapeHtml(driver.name)}</option>`);
  }
  return rows.join('');
}

function viewOrderForm() {
  const existing = state.params.id ? findOrder(state.params.id) : null;
  const fee = existing ? existing.deliveryFee : state.shop.defaultDeliveryFee;
  return `
    <section class="page">
      <h2>${existing ? `تعديل ${orderNo(existing.number)}` : 'طلب جديد'}</h2>
      <form id="order-form" class="stack">
        <label class="field">اسم الزبون<input name="customerName" required value="${escapeHtml(existing?.customerName || '')}"></label>
        <label class="field">هاتف الزبون<input name="customerPhone" inputmode="tel" value="${escapeHtml(existing?.customerPhone || '')}" placeholder="07xxxxxxxxx"></label>
        <label class="field">المنطقة<input name="area" value="${escapeHtml(existing?.area || '')}" placeholder="الكرادة، المنصور..."></label>
        <label class="field">العنوان<input name="address" value="${escapeHtml(existing?.address || '')}"></label>
        <label class="field">المندوب<select name="driverId">${driverOptions(existing?.driverId || '')}</select></label>
        <div class="card stack">
          <h3>الأصناف</h3>
          <div id="lines"></div>
          <label class="field">من القائمة<select id="pick-item"><option value="">اختر صنف محفوظ</option>
            ${state.items.filter((item) => item.active !== false).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} — ${formatIQD(item.price)}</option>`).join('')}
          </select></label>
          <div class="grid-3">
            <input id="line-name" placeholder="اسم الصنف">
            <input id="line-qty" inputmode="decimal" placeholder="1">
            <input id="line-price" inputmode="numeric" placeholder="السعر">
          </div>
          <button type="button" class="btn secondary" data-action="add-line">إضافة الصنف</button>
        </div>
        <label class="field">مبلغ البضاعة إذا ماكو أصناف<input id="goods-total" name="goodsTotal" inputmode="numeric" value="${existing && !(existing.lines || []).length ? existing.goodsTotal : ''}"></label>
        <label class="field">خصم<input name="discount" inputmode="numeric" value="${existing?.discount || 0}"></label>
        <label class="field">أجرة التوصيل<input name="deliveryFee" inputmode="numeric" value="${fee || 0}"></label>
        <label class="field">ملاحظة<input name="notes" value="${escapeHtml(existing?.notes || '')}"></label>
        <div class="due-preview"><span>المطلوب من الزبون</span><strong id="due-preview" class="num">—</strong></div>
        <button class="btn primary" type="submit">${existing ? 'حفظ التعديل' : 'حفظ وإظهار الرمز'}</button>
      </form>
    </section>`;
}

function viewScan() {
  return `
    <section class="page">
      <h2>مسح الرمز</h2>
      <p class="hint">يمسح رمز الطلب، رمز تأكيد المندوب، أو باركود صنف محفوظ. إذا الكاميرا ما اشتغلت، الصق الرمز أو اكتب رقم الطلب.</p>
      <div id="reader"></div>
      <p id="scan-msg" class="hint"></p>
      <button type="button" class="btn secondary" data-action="start-camera">تشغيل الكاميرا</button>
      <form id="manual-scan" class="stack">
        <label class="field">رقم الطلب أو الرمز النصي<textarea name="code" placeholder="#0012 أو DA1...."></textarea></label>
        <button class="btn primary" type="submit">فتح</button>
      </form>
      <label class="btn ghost file-btn">رفع صورة الرمز<input id="qr-file" type="file" accept="image/*" hidden></label>
      <div id="file-reader" class="hidden"></div>
    </section>`;
}

function viewDrivers() {
  if (!isOwner()) return '';
  const rows = state.drivers.slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return `
    <section class="page">
      <div class="page-head">
        <h2>المندوبون</h2>
        <button type="button" class="btn primary small" data-action="new-driver">إضافة</button>
      </div>
      <div class="list">
        ${rows.length ? rows.map((driver) => {
          const balance = driverBalance(state.orders, driver.id, state.shop.feeBeneficiary);
          return `
            <button type="button" class="row-card" data-action="open-driver" data-id="${escapeHtml(driver.id)}">
              <div class="row-top"><b>${escapeHtml(driver.name)}</b>${driver.active ? '' : '<span class="badge st-off">موقوف</span>'}</div>
              <div class="row-sub">${escapeHtml(driver.phone || 'بدون هاتف')}</div>
              <div class="row-bottom">
                <span>عهدة ${balance.custody.custodyCount}</span>
                <span class="num">${formatIQD(balance.unsettled.expectedHandover)}</span>
              </div>
            </button>`;
        }).join('') : '<p class="empty">أضف أول مندوب عشان تقدر تسند الطلبات.</p>'}
      </div>
    </section>`;
}

function viewDriverForm() {
  return `
    <section class="page">
      <h2>مندوب جديد</h2>
      <form id="driver-form" class="stack">
        <label class="field">الاسم<input name="name" required></label>
        <label class="field">الهاتف<input name="phone" inputmode="tel"></label>
        <label class="field">رمز دخوله على هذا الجهاز<input name="pin" type="password" inputmode="numeric" required minlength="4" maxlength="6"></label>
        <label class="field">تأكيد الرمز<input name="pin2" type="password" inputmode="numeric" required></label>
        <button class="btn primary" type="submit">حفظ المندوب</button>
      </form>
    </section>`;
}

function viewDriver() {
  const driver = driverById(state.params.id);
  if (!driver) return '<section class="page"><p class="empty">المندوب غير موجود.</p></section>';
  const balance = driverBalance(state.orders, driver.id, state.shop.feeBeneficiary);
  const history = state.settlements.filter((row) => row.driverId === driver.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const join = joinToQR(state.shop, driver);
  return `
    <section class="page">
      <h2>${escapeHtml(driver.name)}</h2>
      <div class="stats">
        ${stat('يسلّم للمحل', formatIQD(balance.unsettled.expectedHandover))}
        ${stat('طلبات مفتوحة', balance.unsettled.count)}
        ${stat('عهدة بضاعة', balance.custody.custodyCount)}
        ${stat('قيمة العهدة', formatIQD(balance.custody.custodyValue))}
      </div>
      <p class="hint">${feeRuleText()}</p>
      ${balance.unsettled.count ? '<button type="button" class="btn primary" data-action="start-settle">تصفية الحساب</button>' : '<p class="empty">ماكو طلبات مسلّمة بانتظار التصفية.</p>'}
      <form id="driver-edit" class="card stack">
        <h3>بيانات المندوب</h3>
        <label class="field">الاسم<input name="name" value="${escapeHtml(driver.name)}"></label>
        <label class="field">الهاتف<input name="phone" value="${escapeHtml(driver.phone || '')}"></label>
        <label class="check"><input type="checkbox" name="active" ${driver.active ? 'checked' : ''}> الحساب شغال</label>
        <button class="btn secondary" type="submit">حفظ</button>
      </form>
      ${qrBlock('رمز ربط جهاز هذا المندوب', join)}
      <h3>تصفيات سابقة</h3>
      <div class="list">
        ${history.length ? history.map((row) => `
          <article class="card">
            <div class="row-top"><b>${escapeHtml(formatWhen(row.createdAt))}</b><span class="badge ${row.difference === 0 ? 'st-ok' : 'st-back'}">${row.difference === 0 ? 'مطابق' : formatIQD(row.difference)}</span></div>
            <p>المطلوب ${formatIQD(row.summary.expectedHandover)} — المستلم ${formatIQD(row.actualHandover)} — ${row.orderIds.length} طلب</p>
            ${row.note ? `<p class="muted">${escapeHtml(row.note)}</p>` : ''}
            <button type="button" class="btn ghost" data-action="void-settlement" data-id="${escapeHtml(row.id)}">إلغاء هذه التصفية</button>
          </article>`).join('') : '<p class="empty">ما تمت تصفية بعد.</p>'}
      </div>
    </section>`;
}

function viewSettle() {
  const driver = driverById(state.params.id);
  if (!driver) return '<section class="page"><p class="empty">المندوب غير موجود.</p></section>';
  const rows = driverBalance(state.orders, driver.id, state.shop.feeBeneficiary).unsettledOrders;
  return `
    <section class="page">
      <h2>تصفية ${escapeHtml(driver.name)}</h2>
      <p class="hint">${feeRuleText()}</p>
      <form id="settle-form" class="stack">
        ${rows.map((order) => {
          const split = deliverySplit(order, state.shop.feeBeneficiary);
          return `<label class="check card">
            <input type="checkbox" name="settle" value="${escapeHtml(order.id)}" checked>
            <span><b>${orderNo(order.number)}</b> ${escapeHtml(order.customerName)}<br>
            نقد ${formatIQD(split.cashCollected)} — للمحل ${formatIQD(split.expectedHandover)}</span>
          </label>`;
        }).join('')}
        <div id="settle-summary" class="card"></div>
        <label class="field">النقد المستلم من المندوب الآن<input id="actual" name="actual" inputmode="numeric"></label>
        <label class="field">ملاحظة<input name="note" placeholder="اختياري"></label>
        <button class="btn primary" type="submit">تثبيت التصفية</button>
      </form>
    </section>`;
}

function viewAccount() {
  const balance = driverBalance(state.orders, state.session.driverId, state.shop.feeBeneficiary);
  const day = today();
  const report = periodReport(ordersForSession(), { from: day, to: day, feeBeneficiary: state.shop.feeBeneficiary });
  return `
    <section class="page">
      <h2>حسابي</h2>
      <p class="hint">الأرقام للعرض. التصفية يثبتها صاحب المحل.</p>
      <div class="stats">
        ${stat('أسلّم للمحل', formatIQD(balance.unsettled.expectedHandover))}
        ${stat('حصتي من المفتوح', formatIQD(balance.unsettled.driverShare))}
        ${stat('عهدة', balance.custody.custodyCount)}
        ${stat('سلّمت اليوم', report.deliveredCount)}
      </div>
      ${moneyRow('نقد اليوم', report.cash.cashCollected)}
      <h3>غير مصفّى</h3>
      <div class="list">${balance.unsettledOrders.map(orderCard).join('') || '<p class="empty">ماكو مبلغ مفتوح.</p>'}</div>
      ${state.shop.roleDevice === 'driver' ? '<button type="button" class="btn danger" data-action="wipe">مسح هذا الجهاز</button>' : ''}
    </section>`;
}

function viewMore() {
  return `
    <section class="page">
      <h2>المزيد</h2>
      <div class="stack">
        <button type="button" class="btn secondary" data-nav="reports">التقارير وتصدير إكسل / PDF</button>
        <button type="button" class="btn secondary" data-nav="items">أصناف محفوظة</button>
        <button type="button" class="btn secondary" data-nav="settings">إعدادات المحل والنسخة الاحتياطية</button>
      </div>
      <p class="muted foot">محاسب التوصيل ١٫٠ — البيانات محفوظة على هذا الجهاز.</p>
    </section>`;
}

function viewReports() {
  const day = today();
  return `
    <section class="page">
      <h2>التقارير</h2>
      <div class="chips">
        <button type="button" class="chip" data-action="set-range" data-range="today">اليوم</button>
        <button type="button" class="chip" data-action="set-range" data-range="yesterday">أمس</button>
        <button type="button" class="chip" data-action="set-range" data-range="month">هذا الشهر</button>
      </div>
      <div class="grid-2">
        <label class="field">من<input id="from" type="date" value="${day}"></label>
        <label class="field">إلى<input id="to" type="date" value="${day}"></label>
      </div>
      <button type="button" class="btn secondary" data-action="run-report">عرض التقرير</button>
      <div id="report-body"></div>
      <div class="stack row-actions">
        <button type="button" class="btn secondary" data-action="export-report">تصدير إكسل</button>
        <button type="button" class="btn secondary" data-action="print-report">طباعة PDF</button>
      </div>
    </section>`;
}

function viewItems() {
  const rows = state.items.slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return `
    <section class="page">
      <h2>أصناف محفوظة</h2>
      <form id="item-form" class="stack">
        <label class="field">الاسم<input name="name" required></label>
        <label class="field">السعر<input name="price" inputmode="numeric" required></label>
        <label class="field">باركود اختياري<input name="barcode"></label>
        <button class="btn primary" type="submit">حفظ الصنف</button>
      </form>
      <div class="list">
        ${rows.map((item) => `
          <article class="row-card static">
            <div class="row-top"><b>${escapeHtml(item.name)}</b><span class="num">${formatIQD(item.price)}</span></div>
            <div class="row-bottom"><span>${escapeHtml(item.barcode || 'بدون باركود')}</span>
              <button type="button" data-action="delete-item" data-id="${escapeHtml(item.id)}">حذف</button></div>
          </article>`).join('') || '<p class="empty">القائمة فارغة. الأصناف تسرّع كتابة الطلب.</p>'}
      </div>
    </section>`;
}

function viewSettings() {
  const shop = state.shop;
  return `
    <section class="page">
      <h2>الإعدادات</h2>
      <form id="settings-form" class="stack">
        <label class="field">اسم المحل<input name="name" value="${escapeHtml(shop.name)}"></label>
        <label class="field">اسم صاحب المحل<input name="ownerName" value="${escapeHtml(shop.ownerName || '')}"></label>
        <label class="field">الهاتف<input name="phone" value="${escapeHtml(shop.phone || '')}"></label>
        <label class="field">أجرة التوصيل الافتراضية<input name="defaultDeliveryFee" inputmode="numeric" value="${shop.defaultDeliveryFee || 0}"></label>
        <fieldset class="choice">
          <legend>أجرة التوصيل تروح لـ</legend>
          <label><input type="radio" name="feeBeneficiary" value="driver" ${shop.feeBeneficiary !== 'shop' ? 'checked' : ''}> المندوب</label>
          <label><input type="radio" name="feeBeneficiary" value="shop" ${shop.feeBeneficiary === 'shop' ? 'checked' : ''}> المحل</label>
        </fieldset>
        <p class="hint">تغيير جهة الأجرة يأثر على التصفية الجاية، مو التصفية القديمة.</p>
        <button class="btn primary" type="submit">حفظ الإعدادات</button>
      </form>
      <form id="pin-change" class="card stack">
        <h3>تغيير الرمز السري</h3>
        <label class="field">الرمز الحالي<input name="old" type="password" inputmode="numeric" required></label>
        <label class="field">الرمز الجديد<input name="pin" type="password" inputmode="numeric" required></label>
        <label class="field">تأكيد الجديد<input name="pin2" type="password" inputmode="numeric" required></label>
        <button class="btn secondary" type="submit">تحديث الرمز</button>
      </form>
      <section class="card stack">
        <h3>نسخة احتياطية</h3>
        <p class="hint">انسخ الملف لمكان ثاني أو أرسله لجهاز ثاني ثم استورده هناك. هذا ينقل الدفتر كامل.</p>
        <button type="button" class="btn secondary" data-action="export-json">تنزيل نسخة JSON</button>
        <button type="button" class="btn secondary" data-action="export-excel">تنزيل إكسل لكل الدفتر</button>
        <label class="btn ghost file-btn">استيراد نسخة<input id="import-file" type="file" accept="application/json,.json" hidden></label>
      </section>
      <button type="button" class="btn danger" data-action="wipe">مسح كل بيانات هذا الجهاز</button>
    </section>`;
}

function reportHtml(report) {
  const cash = report.cash;
  const drivers = report.byDriver.map((row) => `
    <div class="kv"><span>${escapeHtml(driverName(row.driverId))}</span><b class="num">${formatIQD(row.expectedHandover)}</b></div>
  `).join('');
  return `
    <section class="card" id="report-card">
      <h3>من ${escapeHtml(report.from)} إلى ${escapeHtml(report.to)}</h3>
      <div class="stats">
        ${stat('أُنشئت', report.createdCount)}
        ${stat('سُلّمت', report.deliveredCount)}
        ${stat('مرتجع', report.returnedCount)}
        ${stat('ملغى', report.cancelledCount)}
      </div>
      ${moneyRow('نقد مستلم', cash.cashCollected)}
      ${moneyRow('صافي البضاعة', cash.netGoods)}
      ${moneyRow('أجور التوصيل', cash.fees)}
      ${moneyRow('المطلوب للمحل', cash.expectedHandover)}
      ${moneyRow('حصة المندوبين', cash.driverShare)}
      ${moneyRow('نقص التحصيل', cash.shortage)}
      ${moneyRow('زيادة', cash.surplus)}
      ${drivers ? `<h3>للمحل حسب المندوب</h3>${drivers}` : ''}
    </section>`;
}

function paintLines() {
  const el = document.getElementById('lines');
  if (!el) return;
  if (!state.draftLines.length) {
    el.innerHTML = '<p class="empty">ماكو أصناف. تقدر تكتب مبلغ البضاعة مباشرة.</p>';
  } else {
    el.innerHTML = state.draftLines.map((line, index) => `
      <div class="line">
        <span>${escapeHtml(line.name)}</span>
        <span class="num">${line.qty} × ${formatIQD(line.unitPrice)}</span>
        <b class="num">${formatIQD(lineAmount(line.qty, line.unitPrice))}</b>
        <button type="button" data-action="remove-line" data-index="${index}">حذف</button>
      </div>`).join('');
  }
  const goods = document.getElementById('goods-total');
  if (goods) {
    goods.disabled = state.draftLines.length > 0;
    if (state.draftLines.length) {
      try {
        goods.value = quoteOrder({ lines: state.draftLines, discount: 0, deliveryFee: 0 }).goodsTotal;
      } catch { /* يظهر الخطأ بالتسعير */ }
    }
  }
}

function readOrderInput(form) {
  return {
    customerName: form.customerName.value,
    customerPhone: form.customerPhone.value,
    area: form.area.value,
    address: form.address.value,
    notes: form.notes.value,
    driverId: form.driverId.value,
    goodsTotal: form.goodsTotal.value || 0,
    discount: form.discount.value || 0,
    deliveryFee: form.deliveryFee.value || 0,
    lines: state.draftLines,
  };
}

function paintDue() {
  const form = document.getElementById('order-form');
  const target = document.getElementById('due-preview');
  if (!form || !target) return;
  try {
    target.textContent = formatIQD(quoteOrder(readOrderInput(form)).customerDue);
  } catch (err) {
    target.textContent = userMessage(err);
  }
}

function paintDeliverHint() {
  const order = findOrder(state.params.id);
  const input = document.getElementById('deliver-cash');
  const hint = document.getElementById('deliver-hint');
  if (!order || !input || !hint) return;
  try {
    const split = deliverySplit({ ...order, status: 'delivered', cashCollected: input.value || 0 }, state.shop.feeBeneficiary);
    if (split.shortage) hint.textContent = `نقص ${formatIQD(split.shortage)}. المندوب يسلّم للمحل ${formatIQD(split.expectedHandover)}.`;
    else if (split.surplus) hint.textContent = `زيادة ${formatIQD(split.surplus)}. للمحل ${formatIQD(split.expectedHandover)} وللمندوب ${formatIQD(split.driverShare)}.`;
    else hint.textContent = `المبلغ مطابق. للمحل ${formatIQD(split.expectedHandover)} وللمندوب ${formatIQD(split.driverShare)}.`;
  } catch (err) {
    hint.textContent = userMessage(err);
  }
}

function paintSettle() {
  const box = document.getElementById('settle-summary');
  const actual = document.getElementById('actual');
  if (!box) return;
  const ids = [...document.querySelectorAll('input[name="settle"]:checked')].map((el) => el.value);
  const rows = state.orders.filter((order) => ids.includes(order.id));
  const summary = summarizeOrders(rows, state.shop.feeBeneficiary);
  box.innerHTML = `
    <div class="kv"><span>عدد الطلبات</span><b class="num">${summary.count}</b></div>
    ${moneyRow('النقد المحصّل', summary.cashCollected)}
    ${moneyRow('المطلوب للمحل', summary.expectedHandover)}
    ${moneyRow('يبقى للمندوب', summary.driverShare)}
    ${moneyRow('نقص', summary.shortage)}
  `;
  if (actual && actual.dataset.dirty !== '1') actual.value = summary.expectedHandover;
}

function runReport() {
  const fromEl = document.getElementById('from');
  const toEl = document.getElementById('to');
  const body = document.getElementById('report-body');
  if (!fromEl || !body) return;
  const from = fromEl.value || today();
  const to = toEl.value || from;
  try {
    state.lastReport = periodReport(state.orders, { from, to, feeBeneficiary: state.shop.feeBeneficiary });
    state.lastReport.from = from;
    state.lastReport.to = to;
    body.innerHTML = reportHtml(state.lastReport);
  } catch (err) {
    state.lastReport = null;
    body.innerHTML = `<p class="empty">${escapeHtml(userMessage(err))}</p>`;
  }
}

function drawQrs() {
  if (typeof qrcode !== 'function') return;
  if (qrcode.stringToBytesFuncs?.['UTF-8']) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  document.querySelectorAll('[data-qr]').forEach((el) => {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(el.dataset.qr, 'Byte');
      qr.make();
      el.innerHTML = `<img alt="رمز QR" src="${qr.createDataURL(5, 4)}">`;
    } catch (err) {
      console.error(err);
      el.textContent = 'تعذر رسم الرمز. انسخ النص بالأسفل.';
    }
  });
}

async function stopCamera() {
  scanGen += 1;
  const local = scanner;
  scanner = null;
  if (!local) return;
  try { await local.stop(); } catch { /* قد ما تكون بدأت */ }
  try { await local.clear(); } catch { /* تجاهل */ }
}

async function startCamera() {
  const gen = ++scanGen;
  if (typeof Html5Qrcode === 'undefined') {
    const msg = document.getElementById('scan-msg');
    if (msg) msg.textContent = 'مكتبة المسح ما تحمّلت. حدّث الصفحة وأنت متصل مرة واحدة.';
    return;
  }
  if (!document.getElementById('reader')) return;
  await stopCamera();
  const myGen = ++scanGen;
  if (gen && myGen < gen) return;
  const local = new Html5Qrcode('reader');
  scanner = local;
  try {
    await local.start(
      { facingMode: 'environment' },
      { fps: 8, qrbox: { width: 220, height: 220 } },
      (decoded) => { handleScan(decoded); },
      () => {}
    );
    if (scanner !== local) {
      try { await local.stop(); } catch { /* استُبدل */ }
    }
  } catch (err) {
    if (scanner === local) scanner = null;
    try { await local.clear(); } catch { /* تجاهل */ }
    const msg = document.getElementById('scan-msg');
    if (msg) msg.textContent = 'الكاميرا ما اشتغلت. اسمح بها من المتصفح، أو الصق الرمز، أو ارفع صورته.';
  }
}

async function handleScan(text) {
  const value = String(text || '').trim();
  if (!value) return;
  const now = Date.now();
  if (value === handleScan.last && now - handleScan.at < 2000) return;
  handleScan.last = value;
  handleScan.at = now;
  try {
    await routeCode(value);
  } catch (err) {
    console.error(err);
    beep(false);
    toast(userMessage(err));
  }
}

async function routeCode(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('الصق الرمز أو اكتب رقم الطلب');
  if (/^#?\d+$/.test(text)) {
    const number = Number(text.replace('#', ''));
    const order = state.orders.find((row) => row.number === number);
    if (!order) throw new Error('ما لكينا طلب بهذا الرقم');
    if (!isOwner() && order.driverId && order.driverId !== state.session?.driverId && order.status !== 'new') {
      throw new Error('هذا الطلب لمندوب آخر');
    }
    beep(true);
    await go('order', { id: order.id });
    return;
  }
  if (!text.startsWith('DA1.')) {
    const item = state.items.find((row) => row.barcode && row.barcode === text);
    if (!item) throw new Error('الرمز غير معروف');
    beep(true);
    toast(`${item.name} — ${formatIQD(item.price)}`);
    return;
  }
  const payload = decodePayload(text);
  if (!state.shop) {
    if (payload.t !== 'j') throw new Error('أول شي اربط الجهاز برمز المندوب');
    state.joinPayload = payload;
    state.view = 'join';
    render();
    toast(`تم التعرف على ${payload.dn}`);
    return;
  }
  if (payload.t === 'j') {
    if (state.shop.roleDevice === 'driver' && state.shop.linkedDriverId === payload.id) {
      toast('هذا الجهاز مربوط بهذا المندوب');
      return;
    }
    throw new Error('الربط يكون على جهاز فاضي. إذا هذا جهاز المحل، خلّ الرمز للمندوب.');
  }
  if (payload.s !== state.shop.id) throw new Error('الرمز من محل آخر');
  if (payload.t === 'o') {
    await receiveOrder(payload);
    return;
  }
  if (payload.t === 'c') {
    await receiveConfirm(payload);
    return;
  }
  throw new Error('نوع الرمز غير معروف');
}

async function receiveOrder(payload) {
  let order = findOrder(payload.id);
  if (!isOwner() && payload.dr && payload.dr !== state.session?.driverId) {
    throw new Error('هذا الطلب لمندوب آخر');
  }
  if (!order) {
    order = orderFromQR(payload);
    quoteOrder(order);
    await saveOrder(order);
    if ((order.number || 0) >= (state.shop.nextOrderSeq || 1)) {
      await saveShop({ ...state.shop, nextOrderSeq: order.number + 1 });
    }
    await reload();
    toast('تم قراءة الطلب على هذا الجهاز');
  }
  beep(true);
  await go('order', { id: order.id });
}

async function receiveConfirm(payload) {
  const order = findOrder(payload.id);
  if (!order) throw new Error('الطلب مو موجود على هذا الجهاز. امسح رمز الطلب أول.');
  if (order.status === 'delivered' && payload.st === 'delivered' && !sameConfirmation(order, payload)) {
    throw new Error('الطلب مسلّم بمبلغ مختلف عن هذا الرمز');
  }
  if (sameConfirmation(order, payload) || order.status === payload.st) {
    toast('هذه الحالة مسجلة مسبقًا');
    await go('order', { id: order.id });
    return;
  }
  const label = payload.st === 'delivered'
    ? `تأكيد التسليم والنقد ${formatIQD(payload.cash)} للطلب ${orderNo(order.number)}؟`
    : payload.st === 'returned'
      ? `تأكيد إرجاع الطلب ${orderNo(order.number)}؟`
      : `تأكيد استلام الطلب ${orderNo(order.number)}؟`;
  if (!await ask(label)) return;
  const next = applyConfirmation(order, payload, state.session, new Date().toISOString());
  await saveOrder(next);
  await reload();
  beep(true);
  toast('تم تسجيل الحركة');
  await go('order', { id: order.id });
}

function orderShareText(order) {
  const quote = quoteOrder(order);
  return [
    `طلب ${orderNo(order.number)} — ${state.shop.name}`,
    `الزبون: ${order.customerName}`,
    order.customerPhone ? `الهاتف: ${order.customerPhone}` : '',
    order.area ? `المنطقة: ${order.area}` : '',
    order.address ? `العنوان: ${order.address}` : '',
    `المطلوب: ${formatIQD(quote.customerDue)}`,
    `المندوب: ${driverName(order.driverId)}`,
    order.notes ? `ملاحظة: ${order.notes}` : '',
  ].filter(Boolean).join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('تم النسخ');
  } catch {
    toast('حدد النص وانسخه يدويًا');
  }
}

function writeWorkbook(filename, sheets) {
  if (typeof XLSX === 'undefined') throw new Error('مكتبة الإكسل ما تحمّلت. حدّث الصفحة وأنت متصل مرة واحدة.');
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const rows = sheet.rows.length ? sheet.rows : [{ ملاحظة: 'لا توجد بيانات' }];
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), sheet.name.slice(0, 31));
  }
  XLSX.writeFile(book, filename);
}

function orderRows(orders) {
  return orders.map((order) => {
    const quote = quoteOrder(order);
    const split = order.status === 'delivered' ? deliverySplit(order, state.shop.feeBeneficiary) : null;
    return {
      'رقم الطلب': order.number,
      'تاريخ الإنشاء': formatWhen(order.createdAt),
      'الزبون': order.customerName,
      'الهاتف': order.customerPhone,
      'المنطقة': order.area,
      'العنوان': order.address,
      'الحالة': STATUS_META[order.status]?.label || order.status,
      'المندوب': driverName(order.driverId),
      'البضاعة': quote.goodsTotal,
      'الخصم': quote.discount,
      'أجرة التوصيل': quote.deliveryFee,
      'المطلوب من الزبون': quote.customerDue,
      'النقد المستلم': order.status === 'delivered' ? order.cashCollected : '',
      'للمحل': split ? split.expectedHandover : '',
      'حصة المندوب': split ? split.driverShare : '',
      'مصفى': order.settlementId ? 'نعم' : 'لا',
      'ملاحظة': order.notes || '',
    };
  });
}

function exportReport() {
  if (!state.lastReport) throw new Error('اعرض التقرير أول');
  const { from, to, cash } = state.lastReport;
  const delivered = state.orders.filter((order) => order.status === 'delivered' && inBaghdadRange(order.deliveredAt, from, to));
  const created = state.orders.filter((order) => inBaghdadRange(order.createdAt, from, to));
  writeWorkbook(`تقرير-${from}.xlsx`, [
    { name: 'ملخص', rows: [{
      'من': from,
      'إلى': to,
      'المحل': state.shop.name,
      'طلبات أُنشئت': state.lastReport.createdCount,
      'سُلّمت': state.lastReport.deliveredCount,
      'مرتجع': state.lastReport.returnedCount,
      'ملغى': state.lastReport.cancelledCount,
      'نقد مستلم': cash.cashCollected,
      'صافي البضاعة': cash.netGoods,
      'أجور': cash.fees,
      'المطلوب للمحل': cash.expectedHandover,
      'حصة المندوبين': cash.driverShare,
      'نقص': cash.shortage,
      'زيادة': cash.surplus,
    }] },
    { name: 'تسليم الفترة', rows: orderRows(delivered) },
    { name: 'طلبات الفترة', rows: orderRows(created) },
  ]);
}

function printReport() {
  if (!state.lastReport) throw new Error('اعرض التقرير أول');
  const root = document.getElementById('print-root');
  root.innerHTML = `<h1>${escapeHtml(state.shop.name)}</h1><p>تقرير التوصيل</p>${reportHtml(state.lastReport)}`;
  root.hidden = false;
  document.body.classList.add('printing');
  window.print();
  document.body.classList.remove('printing');
  root.hidden = true;
  root.innerHTML = '';
}

async function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const known = ['setup-form', 'join-form', 'pin-form', 'order-form', 'deliver-form', 'manual-scan', 'driver-form', 'driver-edit', 'settle-form', 'item-form', 'settings-form', 'pin-change'];
  if (!known.includes(form.id)) return;
  event.preventDefault();
  if (form.dataset.busy === '1') return;
  form.dataset.busy = '1';
  try {
    await submitForm(form);
  } catch (err) {
    console.error(err);
    toast(userMessage(err));
  } finally {
    form.dataset.busy = '';
  }
}

async function submitForm(form) {
  if (form.id === 'setup-form') {
    const pin = form.pin.value.trim();
    if (pin !== form.pin2.value.trim()) throw new Error('الرمز وتأكيده مختلفين');
    const shop = createShopRecord({
      name: form.name.value,
      ownerName: form.ownerName.value,
      phone: form.phone.value,
      defaultDeliveryFee: form.defaultDeliveryFee.value || 0,
      feeBeneficiary: form.feeBeneficiary.value,
    }, 'pending');
    shop.pinHash = await hashPin(pin, shop.id);
    await saveShop(shop);
    await reload();
    setSession({ role: 'owner' });
    toast('تم فتح الدفتر');
    await go('home');
    return;
  }
  if (form.id === 'join-form') {
    let payload = state.joinPayload;
    if (!payload && form.code?.value.trim()) payload = decodePayload(form.code.value.trim());
    if (!payload || payload.t !== 'j') throw new Error('الصق رمز الربط أو امسحه');
    const pin = form.pin.value.trim();
    if (pin !== form.pin2.value.trim()) throw new Error('الرمز وتأكيده مختلفين');
    const pinHash = await hashPin(pin, payload.s);
    const created = shopFromJoin(payload, pinHash);
    await replaceAll({ shop: created.shop, drivers: [created.driver], orders: [], settlements: [], items: [] });
    state.joinPayload = null;
    await reload();
    setSession({ role: 'driver', driverId: created.driver.id });
    toast('تم ربط جهاز المندوب');
    await go('home');
    return;
  }
  if (form.id === 'pin-form') {
    const pin = form.pin.value.trim();
    if (state.shop.roleDevice === 'driver') {
      if (!await verifyPin(pin, state.shop.id, state.shop.pinHash)) throw new Error('الرمز غير صحيح');
      setSession({ role: 'driver', driverId: state.shop.linkedDriverId });
      await go('home');
      return;
    }
    const target = state.lockTarget;
    if (!target) throw new Error('اختر صاحب المحل أو المندوب');
    if (target.role === 'owner') {
      if (!await verifyPin(pin, state.shop.id, state.shop.pinHash)) throw new Error('الرمز غير صحيح');
      setSession({ role: 'owner' });
      await go('home');
      return;
    }
    const driver = driverById(target.driverId);
    if (!driver?.active) throw new Error('المندوب موقوف');
    if (!await verifyPin(pin, driver.id, driver.pinHash)) throw new Error('الرمز غير صحيح');
    setSession({ role: 'driver', driverId: driver.id });
    await go('home');
    return;
  }
  if (form.id === 'order-form') {
    const input = readOrderInput(form);
    if (state.params.id) {
      const updated = updateOpenOrder(findOrder(state.params.id), input, state.session);
      await saveOrder(updated);
      await reload();
      toast('تم حفظ التعديل');
      await go('order', { id: updated.id });
      return;
    }
    const order = createOrderRecord(state.shop, input);
    await saveNewOrder(state.shop, order);
    await reload();
    toast('تم إنشاء الطلب');
    await go('order', { id: order.id });
    return;
  }
  if (form.id === 'deliver-form') {
    const order = findOrder(state.params.id);
    const next = applyDelivery(order, { cashCollected: form.cash.value, at: new Date().toISOString(), actor: state.session });
    await saveOrder(next);
    await reload();
    beep(true);
    toast('تم تسجيل التسليم');
    await go('order', { id: order.id });
    return;
  }
  if (form.id === 'manual-scan') {
    await routeCode(form.code.value);
    return;
  }
  if (form.id === 'driver-form') {
    const pin = form.pin.value.trim();
    if (pin !== form.pin2.value.trim()) throw new Error('الرمز وتأكيده مختلفين');
    const driver = createDriverRecord({ name: form.name.value, phone: form.phone.value }, 'pending');
    driver.pinHash = await hashPin(pin, driver.id);
    await saveDriver(driver);
    await reload();
    toast('تمت إضافة المندوب');
    await go('driver', { id: driver.id });
    return;
  }
  if (form.id === 'driver-edit') {
    const driver = driverById(state.params.id);
    const active = form.active.checked;
    if (driver.active && !active) assertCanDeactivate(driver, state.orders);
    const next = updateDriverRecord(driver, { name: form.name.value, phone: form.phone.value, active });
    await saveDriver(next);
    await reload();
    toast('تم حفظ بيانات المندوب');
    render();
    return;
  }
  if (form.id === 'settle-form') {
    const driver = driverById(state.params.id);
    const orderIds = [...form.querySelectorAll('input[name="settle"]:checked')].map((el) => el.value);
    const settlement = buildSettlement({
      driverId: driver.id,
      driverName: driver.name,
      orders: state.orders,
      orderIds,
      actualHandover: form.actual.value,
      feeBeneficiary: state.shop.feeBeneficiary,
      note: form.note.value,
      at: new Date().toISOString(),
      actor: state.session,
    });
    if (!await ask(`تثبيت التصفية بمبلغ ${formatIQD(settlement.actualHandover)}؟ الفرق ${formatIQD(settlement.difference)}.`)) return;
    await commitSettlement(settlement, state.orders);
    await reload();
    toast('تمت التصفية');
    await go('driver', { id: driver.id });
    return;
  }
  if (form.id === 'item-form') {
    const barcode = form.barcode.value.trim();
    const existing = barcode ? state.items.find((item) => item.barcode === barcode) : null;
    const item = existing
      ? { ...existing, name: form.name.value.trim(), price: quoteOrder({ goodsTotal: form.price.value, discount: 0, deliveryFee: 0 }).goodsTotal }
      : createItemRecord({ name: form.name.value, price: form.price.value, barcode });
    if (!item.name) throw new Error('اكتب اسم الصنف');
    await saveItem(item);
    await reload();
    toast(existing ? 'تم تحديث الصنف' : 'تم حفظ الصنف');
    render();
    return;
  }
  if (form.id === 'settings-form') {
    const shop = updateShopSettings(state.shop, {
      name: form.name.value,
      ownerName: form.ownerName.value,
      phone: form.phone.value,
      defaultDeliveryFee: form.defaultDeliveryFee.value || 0,
      feeBeneficiary: form.feeBeneficiary.value,
    });
    await saveShop(shop);
    await reload();
    toast('تم حفظ الإعدادات');
    render();
    return;
  }
  if (form.id === 'pin-change') {
    const pin = form.pin.value.trim();
    if (pin !== form.pin2.value.trim()) throw new Error('الرمز وتأكيده مختلفين');
    const salt = state.shop.roleDevice === 'driver' ? state.shop.id : state.shop.id;
    if (!await verifyPin(form.old.value.trim(), salt, state.shop.pinHash)) throw new Error('الرمز الحالي غير صحيح');
    await saveShop({ ...state.shop, pinHash: await hashPin(pin, salt) });
    await reload();
    form.reset();
    toast('تم تحديث الرمز');
  }
}

async function runAction(action, el) {
  if (action === 'show-join') { state.view = 'join'; render(); return; }
  if (action === 'show-setup') { state.view = 'home'; state.joinPayload = null; render(); return; }
  if (action === 'lock') { clearSession(); await stopCamera(); render(); return; }
  if (action === 'choose-login') {
    state.lockTarget = { role: el.dataset.role, driverId: el.dataset.driver || null };
    render();
    document.getElementById('pin')?.focus();
    return;
  }
  if (action === 'new-order') { await go('order-form'); return; }
  if (action === 'edit-order') { await go('order-form', { id: state.params.id }); return; }
  if (action === 'open-order') { await go('order', { id: el.dataset.id }); return; }
  if (action === 'filter') {
    state.filter = el.dataset.status;
    document.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.status === state.filter));
    const list = document.getElementById('order-list');
    if (list) list.innerHTML = orderCardsHtml();
    return;
  }
  if (action === 'add-line') {
    state.draftLines.push(normalizeLine({
      name: document.getElementById('line-name').value,
      qty: document.getElementById('line-qty').value || 1,
      unitPrice: document.getElementById('line-price').value,
    }));
    document.getElementById('line-name').value = '';
    document.getElementById('line-price').value = '';
    paintLines();
    paintDue();
    return;
  }
  if (action === 'remove-line') {
    state.draftLines.splice(Number(el.dataset.index), 1);
    paintLines();
    paintDue();
    return;
  }
  if (action === 'pickup') {
    const order = findOrder(state.params.id);
    const select = document.getElementById('pickup-driver');
    const driverId = isOwner() ? (select?.value || order.driverId) : state.session.driverId;
    const next = applyPickup(order, { driverId, at: new Date().toISOString(), actor: state.session });
    await saveOrder(next);
    await reload();
    beep(true);
    toast('تم تأكيد الاستلام');
    await go('order', { id: order.id });
    return;
  }
  if (action === 'return-order') {
    const order = findOrder(state.params.id);
    if (!await ask('تسجيل الطلب مرتجع؟ ما راح ينحسب نقد على المندوب.')) return;
    const next = applyReturn(order, {
      at: new Date().toISOString(),
      reason: document.getElementById('return-reason')?.value || '',
      actor: state.session,
    });
    await saveOrder(next);
    await reload();
    toast('تم تسجيل المرتجع');
    await go('order', { id: order.id });
    return;
  }
  if (action === 'cancel-order') {
    const order = findOrder(state.params.id);
    if (!await ask('إلغاء هذا الطلب؟')) return;
    const next = applyCancel(order, { at: new Date().toISOString(), actor: state.session });
    await saveOrder(next);
    await reload();
    toast('تم إلغاء الطلب');
    await go('order', { id: order.id });
    return;
  }
  if (action === 'copy-code') {
    const text = el.closest('.card')?.querySelector('textarea')?.value || '';
    await copyText(text);
    return;
  }
  if (action === 'share-order') {
    const text = orderShareText(findOrder(state.params.id));
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    await copyText(text);
    return;
  }
  if (action === 'start-camera') { await startCamera(); return; }
  if (action === 'new-driver') { await go('driver-form'); return; }
  if (action === 'open-driver') { await go('driver', { id: el.dataset.id }); return; }
  if (action === 'start-settle') { await go('settle', { id: state.params.id }); return; }
  if (action === 'void-settlement') {
    const settlement = state.settlements.find((row) => row.id === el.dataset.id);
    if (!settlement) return;
    if (!await ask('إلغاء التصفية يفتح الطلبات مرة ثانية. النقد اللي استلمته ما ينحذف لحاله، لازم تعيد التصفية.')) return;
    await voidSettlementTx(settlement, state.orders);
    await reload();
    toast('تم إلغاء التصفية');
    render();
    return;
  }
  if (action === 'run-report') { runReport(); return; }
  if (action === 'set-range') {
    const day = today();
    let from = day;
    let to = day;
    if (el.dataset.range === 'yesterday') from = to = shiftDateKey(day, -1);
    if (el.dataset.range === 'month') from = `${day.slice(0, 8)}01`;
    document.getElementById('from').value = from;
    document.getElementById('to').value = to;
    runReport();
    return;
  }
  if (action === 'export-report') { exportReport(); toast('تم تنزيل الإكسل'); return; }
  if (action === 'print-report') { printReport(); return; }
  if (action === 'delete-item') {
    if (!await ask('حذف هذا الصنف من القائمة؟')) return;
    await deleteItem(el.dataset.id);
    await reload();
    render();
    return;
  }
  if (action === 'export-json') {
    const payload = exportBackup(state);
    downloadBlob(`نسخة-${today()}.json`, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    toast('تم تنزيل النسخة');
    return;
  }
  if (action === 'export-excel') {
    writeWorkbook(`دفتر-${today()}.xlsx`, [
      { name: 'الطلبات', rows: orderRows(state.orders) },
      { name: 'التصفية', rows: state.settlements.map((row) => ({
        'التاريخ': formatWhen(row.createdAt),
        'المندوب': row.driverName || driverName(row.driverId),
        'عدد الطلبات': row.orderIds.length,
        'المطلوب': row.summary.expectedHandover,
        'المستلم': row.actualHandover,
        'الفرق': row.difference,
        'ملاحظة': row.note || '',
      })) },
      { name: 'المندوبون', rows: state.drivers.map((driver) => ({
        'الاسم': driver.name,
        'الهاتف': driver.phone,
        'الحالة': driver.active ? 'شغال' : 'موقوف',
      })) },
    ]);
    toast('تم تنزيل الإكسل');
    return;
  }
  if (action === 'wipe') {
    const driverDevice = state.shop?.roleDevice === 'driver';
    if (state.session && !isOwner() && !driverDevice) throw new Error('هذا الإجراء لصاحب المحل فقط');
    if (!await ask(`مسح دفتر ${state.shop.name} من هذا الجهاز؟ ما يتراجع إلا إذا عندك نسخة.`, 'مسح')) return;
    clearSession();
    await wipeDatabase();
    state.shop = null;
    state.drivers = [];
    state.orders = [];
    state.settlements = [];
    state.items = [];
    toast('تم مسح البيانات');
    render();
  }
}

function onInput(event) {
  const target = event.target;
  if (target.id === 'order-search') {
    state.query = target.value;
    const list = document.getElementById('order-list');
    if (list) list.innerHTML = orderCardsHtml();
  }
  if (target.id === 'actual') target.dataset.dirty = '1';
  if (target.form?.id === 'order-form') paintDue();
  if (target.id === 'deliver-cash') paintDeliverHint();
}

function onChange(event) {
  const target = event.target;
  if (target.name === 'settle') paintSettle();
  if (target.id === 'pick-item' && target.value) {
    const item = state.items.find((row) => row.id === target.value);
    target.value = '';
    if (!item) return;
    try {
      state.draftLines.push(normalizeLine({ name: item.name, qty: 1, unitPrice: item.price, itemId: item.id }));
      paintLines();
      paintDue();
    } catch (err) {
      toast(userMessage(err));
    }
  }
  if (target.id === 'qr-file' && target.files?.[0]) {
    const file = target.files[0];
    target.value = '';
    scanImage(file);
  }
  if (target.id === 'import-file' && target.files?.[0]) {
    const file = target.files[0];
    target.value = '';
    importBackup(file);
  }
  if (target.id === 'from' || target.id === 'to') runReport();
}

async function scanImage(file) {
  if (typeof Html5Qrcode === 'undefined') {
    toast('مكتبة المسح ما تحمّلت');
    return;
  }
  await stopCamera();
  const local = new Html5Qrcode('file-reader');
  try {
    const text = await local.scanFile(file, false);
    await routeCode(text);
  } catch (err) {
    toast('ما قدرنا نقرأ الرمز من الصورة');
  } finally {
    try { await local.clear(); } catch { /* تجاهل */ }
    if (state.view === 'scan') startCamera();
  }
}

async function importBackup(file) {
  try {
    const data = parseBackup(await file.text());
    if (!await ask('استبدال كل بيانات هذا الجهاز بالنسخة؟')) return;
    await replaceAll(data);
    clearSession();
    await reload();
    state.session = restoreSession();
    toast('تم استرجاع النسخة');
    render();
  } catch (err) {
    console.error(err);
    toast(userMessage(err));
  }
}

async function boot() {
  document.body.addEventListener('click', async (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      try { await go(nav.dataset.nav); } catch (err) { toast(userMessage(err)); }
      return;
    }
    const el = event.target.closest('[data-action]');
    if (!el) return;
    try { await runAction(el.dataset.action, el); } catch (err) {
      console.error(err);
      toast(userMessage(err));
    }
  });
  document.body.addEventListener('submit', onSubmit);
  document.body.addEventListener('input', onInput);
  document.body.addEventListener('change', onChange);

  try {
    const data = await loadAll();
    Object.assign(state, data);
    state.session = restoreSession();
  } catch (err) {
    console.error(err);
    document.getElementById('app').innerHTML = `<section class="gate"><div class="gate-card"><h1>تعذر فتح الدفتر</h1><p>${escapeHtml(userMessage(err))}</p></div></section>`;
    return;
  }
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();

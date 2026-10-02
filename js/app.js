import * as db from './db.js';
import { assertCredit, assertDueDate, balanceOf, overdueAmount, portfolio, statementRows } from './debt.js';
import { formatDateTime, formatIQD } from './format.js';
import { accessState, verifyLicense } from './license.js';
import { parseQty, priceLines, refundLine, settlePayment, toIQD } from './money.js';
import { summarizePeriod } from './report.js';
import { closeShift } from './shift.js';
import { isLowStock, isWeighed, receiveStock, releaseStock, restoreStock } from './stock.js';
import {
  addBaghdadDays, baghdadDateKey, checkPin, downloadBlob, escapeHtml, hashPin, permissionsFor, uid, whatsAppPhone,
} from './util.js';
import * as view from './view.js';

const state = {
  shop: null,
  cashiers: [],
  categories: [],
  products: [],
  customers: [],
  entries: [],
  sales: [],
  returns: [],
  purchases: [],
  shifts: [],
  sessionId: sessionStorage.getItem('cashier-session') || '',
  loginId: '',
  view: 'sale',
  editingId: '',
  customerEdit: false,
  returnSaleId: '',
  cart: [],
  invoiceDiscount: 0,
  customerId: '',
  heldId: null,
  purchaseLines: [],
  modal: null,
  access: null,
  reportFrom: baghdadDateKey(),
  reportTo: baghdadDateKey(),
  tenderDirty: false,
  busy: false,
  scanner: null,
};

const app = document.getElementById('app');

function me() {
  return state.cashiers.find((cashier) => cashier.id === state.sessionId) || null;
}
function perms() {
  return permissionsFor(me());
}
function openShift() {
  return state.shifts.find((shift) => !shift.closedAt) || null;
}
let activeToast = '';
function toast(message) {
  activeToast = String(message || '');
  paintToast();
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    activeToast = '';
    document.getElementById('toast')?.remove();
  }, 3400);
}
function paintToast() {
  if (!activeToast) return;
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = activeToast;
}
function saveDraft() {
  localStorage.setItem('cashier-draft', JSON.stringify({
    cart: state.cart,
    invoiceDiscount: state.invoiceDiscount,
    customerId: state.customerId,
    heldId: state.heldId,
  }));
}
function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem('cashier-draft') || 'null');
    if (!draft) return;
    state.cart = draft.cart || [];
    state.invoiceDiscount = draft.invoiceDiscount || 0;
    state.customerId = draft.customerId || '';
    state.heldId = draft.heldId || null;
  } catch { /* ignore broken draft */ }
}
function customerEntries(id) {
  return state.entries.filter((entry) => entry.customerId === id);
}
function endOfDay(key) {
  return new Date(`${key}T23:59:59+03:00`).toISOString();
}
function bounds(from, to) {
  return { from: new Date(`${from}T00:00:00+03:00`).toISOString(), to: endOfDay(to) };
}
function todayStats() {
  const key = baghdadDateKey();
  return summarizePeriod({ ...state, ...bounds(key, key) });
}
function shiftSlice(shift) {
  if (!shift) return { sales: [], returns: [], debtPayments: [], purchases: [] };
  return {
    sales: state.sales.filter((sale) => sale.shiftId === shift.id),
    returns: state.returns.filter((row) => row.shiftId === shift.id),
    debtPayments: state.entries.filter((entry) => entry.shiftId === shift.id && entry.type === 'payment'),
    purchases: state.purchases.filter((row) => row.shiftId === shift.id),
  };
}
function searchProducts(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return state.products.filter((product) => product.active !== false && (
    String(product.barcode || '') === query.trim()
    || String(product.barcode || '').includes(query.trim())
    || product.name.toLowerCase().includes(q)
  )).slice(0, 8);
}
function readCart() {
  for (const line of state.cart) {
    const qty = document.querySelector(`[data-qty="${CSS.escape(line.productId)}"]`);
    const discount = document.querySelector(`[data-discount="${CSS.escape(line.productId)}"]`);
    if (qty && String(qty.value).trim()) line.qty = qty.value;
    if (discount) line.discount = toIQD(discount.value || 0);
  }
  const invoice = document.getElementById('invoice-discount');
  if (invoice) state.invoiceDiscount = toIQD(invoice.value || 0);
  const customer = document.getElementById('cart-customer');
  if (customer) state.customerId = customer.value;
}
function paintDue() {
  const el = document.getElementById('due-total');
  if (!el) return;
  try {
    if (!state.cart.length) { el.textContent = formatIQD(0); return; }
    readCart();
    el.textContent = formatIQD(priceLines(state.cart, state.invoiceDiscount).total);
  } catch (error) {
    el.textContent = error.message;
  }
}
function paintSearch(query) {
  const box = document.getElementById('search-results');
  if (!box) return;
  const q = String(query || '').trim();
  if (!q) { box.innerHTML = ''; return; }
  const items = searchProducts(q);
  if (!items.length) {
    box.innerHTML = perms().products && /^\d{4,}$/.test(q)
      ? `<button type="button" data-action="quick-add" data-code="${escapeHtml(q)}">إضافة مادة جديدة بهذا الباركود</button>`
      : '<p class="muted">لا توجد نتيجة</p>';
    return;
  }
  box.innerHTML = items.map((product) => `<button type="button" data-action="stage" data-id="${product.id}"><span>${escapeHtml(product.name)}</span><span>${formatIQD(product.price)}</span></button>`).join('');
}

function render() {
  const cashier = me();
  if (!state.shop) { app.innerHTML = view.setupView(); return; }
  if (!state.access?.ok) { app.innerHTML = view.activateView(state.access?.message || 'أدخل رمز التفعيل'); return; }
  if (!cashier) { app.innerHTML = view.lockView(state.cashiers, state.loginId || state.cashiers[0]?.id); return; }
  const rights = perms();
  if ((state.view === 'products' || state.view === 'product') && !rights.products) state.view = 'sale';
  if (state.view === 'stock' || state.view === 'purchase') { if (!rights.stock) state.view = 'sale'; }
  if (state.view === 'reports' && !rights.reports) state.view = 'sale';
  if (state.view === 'settings' && !rights.settings) state.view = 'sale';
  if ((state.view === 'debts' || state.view === 'customer') && !rights.debts) state.view = 'sale';
  const titles = {
    sale: 'البيع', products: 'المواد', product: 'المادة', debts: 'الديون', customer: 'حساب الزبون',
    stock: 'المخزون', purchase: 'شراء', reports: 'التقارير', shift: 'الوردية', settings: 'الإعدادات', return: 'مرتجع',
  };
  const shift = openShift();
  let body = '';
  if (state.view === 'sale') {
    body = view.saleView({
      stats: todayStats(), perms: rights, shift, mine: shift && (shift.cashierId === cashier.id || rights.settings),
      cart: state.cart, discount: state.invoiceDiscount, customerId: state.customerId,
      customers: state.customers, heldCount: state.sales.filter((sale) => sale.status === 'held').length,
      lowCount: state.products.filter(isLowStock).length,
    });
  } else if (state.view === 'products') body = view.productsView(state.products, state.categories);
  else if (state.view === 'product') body = view.productForm(state.products.find((p) => p.id === state.editingId), state.categories);
  else if (state.view === 'debts') body = view.debtsView(portfolio(state.customers, state.entries).rows.sort((a, b) => b.balance - a.balance));
  else if (state.view === 'customer') {
    const customer = state.customers.find((c) => c.id === state.editingId);
    const rows = customer ? statementRows(customerEntries(customer.id)) : [];
    body = view.customerView({
      customer, rows, editing: state.customerEdit || !customer,
      balance: customer ? balanceOf(customerEntries(customer.id)) : 0,
      overdue: customer ? overdueAmount(customerEntries(customer.id)) : 0,
    });
  } else if (state.view === 'stock') body = view.stockView(state.products, state.purchases);
  else if (state.view === 'purchase') body = view.purchaseView(state.products, state.purchaseLines);
  else if (state.view === 'reports') {
    body = view.reportsView(summarizePeriod({ ...state, ...bounds(state.reportFrom, state.reportTo) }), state.reportFrom, state.reportTo);
  } else if (state.view === 'shift') {
    const preview = shift ? closeShift({ opening: shift.opening, counted: 0, ...shiftSlice(shift) }) : null;
    body = view.shiftView({
      shift, cashierName: state.cashiers.find((c) => c.id === shift?.cashierId)?.name || '',
      preview, canClose: shift && (shift.cashierId === cashier.id || rights.settings),
    });
  } else if (state.view === 'settings') body = view.settingsView(state.shop, state.cashiers);
  else if (state.view === 'return') body = view.returnView(state.sales.find((sale) => sale.id === state.returnSaleId));
  app.innerHTML = view.shell({
    shop: state.shop, title: titles[state.view] || 'البيع', current: state.view, perms: rights,
    cashier, shift, trialDays: state.access?.mode === 'trial' ? state.access.daysLeft : 0, body,
  }) + modalHtml();
  paintDue();
  paintToast();
  if (state.view === 'sale' && !state.modal && matchMedia('(pointer:fine)').matches) document.getElementById('barcode')?.focus();
}

function modalHtml() {
  const modal = state.modal;
  if (!modal) return '';
  if (modal.name === 'pay') return view.payModal({ total: modal.total, customers: state.customers, customerId: state.customerId, dueKey: modal.dueKey, minDue: baghdadDateKey() });
  if (modal.name === 'weight') {
    return view.modalWrap(`<form data-form="weight"><h3>${escapeHtml(modal.product.name)}</h3><input type="hidden" name="productId" value="${modal.product.id}"><label class="field">الكمية<input name="qty" class="num" required autofocus></label><button class="btn" type="submit">إضافة</button></form>`);
  }
  if (modal.name === 'quick') {
    return view.modalWrap(`<form data-form="quick"><h3>مادة جديدة</h3><label class="field">الباركود<input name="barcode" class="num" value="${escapeHtml(modal.barcode)}"></label><label class="field">الاسم<input name="name" required></label><label class="field">السعر<input name="price" class="num" required></label><label class="field">الكلفة<input name="cost" class="num" value="0"></label><button class="btn" type="submit">حفظ وإضافة</button></form>`);
  }
  if (modal.name === 'hold') return view.modalWrap('<form data-form="hold"><h3>تعليق الفاتورة</h3><label class="field">اسم مختصر<input name="label" placeholder="زبون أو طاولة"></label><button class="btn" type="submit">تعليق</button></form>');
  if (modal.name === 'held') {
    const rows = state.sales.filter((sale) => sale.status === 'held');
    return view.modalWrap(`<h3>فواتير معلقة</h3>${rows.map((sale) => `<div class="btn-row" style="margin-bottom:8px"><button class="btn" data-action="recall" data-id="${sale.id}">${escapeHtml(sale.label || 'معلقة')}</button><button class="btn-danger" data-action="drop-held" data-id="${sale.id}">حذف</button></div>`).join('') || '<p class="empty">لا توجد فواتير معلقة.</p>'}<button class="btn-line" data-action="close-modal">إغلاق</button>`);
  }
  if (modal.name === 'camera') return view.modalWrap('<h3>ماسح الكاميرا</h3><div id="qr-reader"></div><button class="btn-line" data-action="close-modal">إغلاق</button>');
  if (modal.name === 'receipt') {
    const sale = state.sales.find((row) => row.id === modal.saleId);
    const customer = state.customers.find((row) => row.id === sale?.customerId);
    const balance = customer ? balanceOf(customerEntries(customer.id)) : 0;
    return view.modalWrap(`${view.receiptHtml(state.shop, sale, customer, balance)}<div class="btn-row"><button class="btn" data-action="print-receipt" data-id="${sale.id}">طباعة</button><button class="btn-line" data-action="share-receipt" data-id="${sale.id}">واتساب</button><button class="btn-line" data-action="close-modal">إغلاق</button></div>`);
  }
  return '';
}

async function boot() {
  const loaded = await db.loadState();
  Object.assign(state, loaded);
  state.shop = loaded.shop;
  if (state.shop) state.access = await accessState(state.shop);
  if (!state.loginId) state.loginId = state.cashiers[0]?.id || '';
  loadDraft();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

document.body.addEventListener('focusin', (event) => {
  if (event.target.matches('input.num')) event.target.select();
});
document.body.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  onAction(button.dataset.action, button).catch((error) => toast(error.message || 'تعذر إكمال العملية'));
});
document.body.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
  event.preventDefault();
  onSubmit(form.dataset.form, new FormData(form), form).catch((error) => toast(error.message || 'تعذر إكمال العملية'));
});
document.body.addEventListener('input', (event) => {
  if (event.target.id === 'barcode') paintSearch(event.target.value);
  if (event.target.matches('[data-qty],[data-discount],#invoice-discount')) {
    try { readCart(); paintDue(); } catch { /* keep typing */ }
  }
  if (event.target.id === 'product-filter') {
    const q = event.target.value.trim();
    document.querySelectorAll('[data-product-row]').forEach((row) => {
      row.hidden = !!q && !row.dataset.name.includes(q) && !row.dataset.barcode.includes(q);
    });
  }
  if (event.target.form?.dataset.form === 'pay') {
    try { paintPay(event.target.form, event.target.name); }
    catch (error) { const el = document.getElementById('change-due'); if (el) el.textContent = error.message; }
  }
});
document.body.addEventListener('change', (event) => {
  if (event.target.matches('[data-qty],[data-discount],#invoice-discount,#cart-customer')) {
    try { readCart(); saveDraft(); paintDue(); } catch (error) { toast(error.message); }
  }
  if (event.target.id === 'import-file') importProducts(event.target.files[0]);
  if (event.target.id === 'restore-file') restoreBackup(event.target.files[0]);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { if (state.modal) closeModal(); return; }
  if (event.key === 'F2') { event.preventDefault(); document.getElementById('barcode')?.focus(); }
  if (state.modal) return;
  if (event.key === 'F4') { event.preventDefault(); document.querySelector('[data-action="pay"]')?.click(); }
  if (event.key === 'F8') { event.preventDefault(); document.querySelector('[data-action="hold"]')?.click(); }
  if (event.key === 'F9') { event.preventDefault(); document.querySelector('[data-action="held"]')?.click(); }
  if (event.key === 'Enter' && event.target?.id === 'barcode') {
    event.preventDefault();
    const value = event.target.value;
    event.target.value = '';
    paintSearch('');
    addByCode(value).catch((error) => toast(error.message));
  }
});

async function onAction(action, button) {
  if (action === 'nav') {
    state.view = button.dataset.view;
    state.modal = null;
    state.customerEdit = false;
    render();
    return;
  }
  if (action === 'lock') {
    sessionStorage.removeItem('cashier-session');
    state.sessionId = '';
    state.modal = null;
    render();
    return;
  }
  if (action === 'pick-cashier') { state.loginId = button.dataset.id; render(); return; }
  if (action === 'close-modal') { await closeModal(); return; }
  if (action === 'camera') { await openCamera(); return; }
  if (action === 'stage') { await stageProduct(state.products.find((p) => p.id === button.dataset.id)); return; }
  if (action === 'quick-add') { state.modal = { name: 'quick', barcode: button.dataset.code }; render(); return; }
  if (action === 'remove-line') {
    state.cart = state.cart.filter((line) => line.productId !== button.dataset.id);
    saveDraft(); render(); return;
  }
  if (action === 'pay') { openPay(); return; }
  if (action === 'hold') { readCart(); state.modal = { name: 'hold' }; render(); return; }
  if (action === 'held') { state.modal = { name: 'held' }; render(); return; }
  if (action === 'recall') { recall(button.dataset.id); return; }
  if (action === 'drop-held') { await db.deleteRecord('sales', button.dataset.id); state.sales = state.sales.filter((s) => s.id !== button.dataset.id); state.modal = { name: 'held' }; render(); return; }
  if (action === 'start-return') { state.view = 'return'; state.returnSaleId = ''; state.modal = null; render(); return; }
  if (action === 'edit-product') { state.view = 'product'; state.editingId = button.dataset.id === 'new' ? '' : button.dataset.id; render(); return; }
  if (action === 'delete-product') {
    const product = state.products.find((p) => p.id === button.dataset.id);
    product.active = false;
    await db.putRecord('products', product);
    state.view = 'products'; render(); toast('أُوقفت المادة'); return;
  }
  if (action === 'edit-customer') { state.view = 'customer'; state.editingId = button.dataset.id === 'new' ? '' : button.dataset.id; state.customerEdit = true; render(); return; }
  if (action === 'open-customer') { state.view = 'customer'; state.editingId = button.dataset.id; state.customerEdit = false; render(); return; }
  if (action === 'remove-purchase') { state.purchaseLines.splice(Number(button.dataset.index), 1); render(); return; }
  if (action === 'print-receipt') { printSale(button.dataset.id); return; }
  if (action === 'share-receipt') { shareSale(button.dataset.id); return; }
  if (action === 'print-statement') { printStatement(button.dataset.id); return; }
  if (action === 'share-statement') { shareStatement(button.dataset.id); return; }
  if (action === 'backup') { exportBackup(); return; }
  if (action === 'restore') { document.getElementById('restore-file').click(); return; }
  if (action === 'export-products') { exportProducts(); return; }
  if (action === 'import-products') { document.getElementById('import-file').click(); return; }
  if (action === 'export-report') { exportReport(); return; }
}

async function onSubmit(name, data, form) {
  if (state.busy) return;
  if (name === 'setup') return setup(data);
  if (name === 'activate' || name === 'license') return activate(data.get('code'));
  if (name === 'login') return login(data);
  if (name === 'open-shift') return startShift(data.get('opening'));
  if (name === 'close-shift') return finishShift(data);
  if (name === 'pay') return finishSale(data);
  if (name === 'weight') return stageProduct(state.products.find((p) => p.id === data.get('productId')), data.get('qty'));
  if (name === 'quick') return quickAdd(data);
  if (name === 'hold') return holdSale(data.get('label'));
  if (name === 'product') return saveProduct(data);
  if (name === 'customer') return saveCustomer(data);
  if (name === 'payment') return takePayment(data);
  if (name === 'purchase-line') return addPurchaseLine(data);
  if (name === 'purchase') return savePurchase(data);
  if (name === 'find-sale') return findSale(data.get('number'));
  if (name === 'return-sale') return saveReturn(data);
  if (name === 'report-range') { state.reportFrom = data.get('from'); state.reportTo = data.get('to'); render(); return; }
  if (name === 'settings') return saveSettings(data, form);
  if (name === 'cashier') return addCashier(data);
}

async function setup(data) {
  if (data.get('pin') !== data.get('pin2')) throw new Error('الرمزان غير متطابقين');
  const salt = uid('salt');
  const owner = await hashPin(data.get('pin'), salt);
  const cashier = { id: uid('cas'), name: String(data.get('owner')).trim(), role: 'owner', active: true, pinHash: owner.pinHash, salt, perms: {} };
  const shop = {
    name: String(data.get('shop')).trim(), phone: String(data.get('phone') || '').trim(), address: String(data.get('address') || '').trim(),
    logo: '', footer: 'شكرًا لزيارتكم', paper: '80', creditDays: 30, nextInvoice: 1001, createdAt: new Date().toISOString(), licenseCode: '',
  };
  if (!shop.name || !cashier.name) throw new Error('أكمل اسم المحل واسم المالك');
  await db.saveShop(shop);
  await db.putRecord('cashiers', cashier);
  state.shop = shop;
  state.cashiers = [cashier];
  state.access = await accessState(shop);
  state.sessionId = cashier.id;
  sessionStorage.setItem('cashier-session', cashier.id);
  render();
}

async function activate(code) {
  const payload = await verifyLicense(code);
  state.shop.licenseCode = String(code).trim();
  await db.saveShop(state.shop);
  state.access = await accessState(state.shop);
  toast(payload.plan === 'life' ? 'تم التفعيل مدى الحياة' : 'تم التفعيل');
  render();
}

async function login(data) {
  const cashier = state.cashiers.find((row) => row.id === (state.loginId || state.cashiers[0]?.id));
  if (!cashier || cashier.active === false) throw new Error('اختر الكاشير');
  if (!(await checkPin(data.get('pin'), cashier))) throw new Error('الرمز غير صحيح');
  state.sessionId = cashier.id;
  sessionStorage.setItem('cashier-session', cashier.id);
  render();
}

async function startShift(opening) {
  if (openShift()) throw new Error('توجد وردية مفتوحة');
  const shift = { id: uid('shf'), cashierId: me().id, openedAt: new Date().toISOString(), closedAt: null, opening: toIQD(opening || 0) };
  await db.putRecord('shifts', shift);
  state.shifts.push(shift);
  render();
}

function requireShift() {
  const shift = openShift();
  if (!shift) throw new Error('افتح الوردية أولاً');
  if (shift.cashierId !== me().id && !perms().settings) throw new Error('الوردية مفتوحة لكاشير آخر');
  return shift;
}

async function stageProduct(product, qty) {
  if (!product || product.active === false) throw new Error('المادة غير موجودة');
  requireShift();
  if (qty == null && isWeighed(product.unit)) {
    state.modal = { name: 'weight', product };
    render();
    return;
  }
  const amount = qty == null ? 1 : parseQty(qty);
  const existing = state.cart.find((line) => line.productId === product.id);
  if (existing) existing.qty = Math.round((Number(existing.qty) + Number(amount)) * 1000) / 1000;
  else state.cart.push({
    productId: product.id, barcode: product.barcode || '', name: product.name, unit: product.unit,
    qty: amount, unitPrice: product.price, cost: product.cost || 0, discount: 0,
    categoryName: state.categories.find((c) => c.id === product.categoryId)?.name || 'بدون تصنيف',
  });
  state.modal = null;
  saveDraft();
  render();
}

async function quickAdd(data) {
  requireShift();
  const product = {
    id: uid('prd'), barcode: String(data.get('barcode') || '').trim(), name: String(data.get('name')).trim(),
    categoryId: '', unit: 'piece', price: toIQD(data.get('price')), cost: toIQD(data.get('cost') || 0),
    stock: 0, lowStock: 3, trackStock: true, active: true,
  };
  if (!product.name) throw new Error('اكتب اسم المادة');
  await db.putRecord('products', product);
  state.products.push(product);
  await stageProduct(product, 1);
}

function openPay() {
  readCart();
  if (!state.cart.length) return;
  const priced = priceLines(state.cart, state.invoiceDiscount);
  const due = new Date(addBaghdadDays(Number(state.shop.creditDays) || 30));
  state.tenderDirty = false;
  state.modal = { name: 'pay', total: priced.total, dueKey: baghdadDateKey(due) };
  render();
}

function paintPay(form, field) {
  const total = state.modal?.total || 0;
  const card = toIQD(form.card.value || 0);
  const debt = toIQD(form.debt.value || 0);
  if (field === 'tendered') state.tenderDirty = true;
  const cashDue = Math.max(0, total - card - debt);
  if (!state.tenderDirty && (field === 'card' || field === 'debt')) form.tendered.value = String(cashDue);
  const tendered = toIQD(form.tendered.value || 0);
  document.getElementById('cash-due').textContent = formatIQD(cashDue);
  document.getElementById('change-due').textContent = card + debt > total ? 'المدفوع أكبر من الفاتورة' : formatIQD(Math.max(0, tendered - cashDue));
}

async function finishSale(data) {
  const shift = requireShift();
  readCart();
  const priced = priceLines(state.cart, state.invoiceDiscount);
  const settled = settlePayment({ total: priced.total, tendered: data.get('tendered'), card: data.get('card'), onAccount: data.get('debt') });
  const customerId = String(data.get('customerId') || state.customerId || '');
  const customer = state.customers.find((row) => row.id === customerId);
  if (settled.debt > 0 && !customer) throw new Error('اختر الزبون قبل تسجيل الآجل');
  let entry = null;
  if (settled.debt > 0) {
    const dueKey = String(data.get('due') || '');
    assertDueDate(dueKey, baghdadDateKey());
    assertCredit({ balance: balanceOf(customerEntries(customer.id)), limit: customer.creditLimit, add: settled.debt });
    entry = {
      id: uid('ent'), customerId: customer.id, type: 'charge', amount: settled.debt, method: 'credit',
      at: new Date().toISOString(), dueAt: endOfDay(dueKey), note: 'بيع آجل',
      shiftId: shift.id, cashierId: me().id,
    };
  }
  const updated = [];
  const warnings = [];
  for (const line of priced.lines) {
    const product = state.products.find((row) => row.id === line.productId);
    if (!product || product.trackStock === false) continue;
    const next = releaseStock(product, line.qty);
    if (next.short) warnings.push(product.name);
    updated.push({ ...product, stock: next.stock });
  }
  const number = state.shop.nextInvoice || 1001;
  const sale = {
    id: uid('sal'), number, status: 'completed', at: new Date().toISOString(), shiftId: shift.id,
    cashierId: me().id, cashierName: me().name, customerId: customer?.id || '', customerName: customer?.name || '',
    lines: priced.lines.map((line) => ({ ...line, returnedQty: 0 })),
    subtotal: priced.subtotal, invoiceDiscount: priced.invoiceDiscount, total: priced.total,
    cost: priced.cost, profit: priced.profit, debt: settled.debt, change: settled.change, tendered: settled.tendered,
    payments: [
      settled.cash ? { method: 'cash', amount: settled.cash } : null,
      settled.card ? { method: 'card', amount: settled.card } : null,
      settled.debt ? { method: 'debt', amount: settled.debt } : null,
    ].filter(Boolean),
  };
  if (entry) entry.saleId = sale.id;
  const shop = { ...state.shop, nextInvoice: number + 1 };
  state.busy = true;
  try {
    await db.completeSale({ shop, sale, products: updated, entry, removeHeldId: state.heldId });
  } finally { state.busy = false; }
  state.shop = shop;
  state.sales = state.sales.filter((row) => row.id !== state.heldId);
  state.sales.push(sale);
  for (const product of updated) {
    const index = state.products.findIndex((row) => row.id === product.id);
    state.products[index] = product;
  }
  if (entry) state.entries.push(entry);
  state.cart = [];
  state.invoiceDiscount = 0;
  state.customerId = customer?.id || '';
  state.heldId = null;
  saveDraft();
  state.modal = { name: 'receipt', saleId: sale.id };
  render();
  if (warnings.length) toast(`تم البيع مع نقص مخزون: ${warnings.join('، ')}`);
}

async function holdSale(label) {
  readCart();
  if (!state.cart.length) return;
  const doc = {
    id: state.heldId || uid('hld'), status: 'held', label: String(label || '').trim() || formatDateTime(new Date().toISOString()),
    at: new Date().toISOString(), cashierId: me().id, cart: state.cart, invoiceDiscount: state.invoiceDiscount, customerId: state.customerId,
  };
  await db.putRecord('sales', doc);
  const index = state.sales.findIndex((sale) => sale.id === doc.id);
  if (index >= 0) state.sales[index] = doc; else state.sales.push(doc);
  state.cart = [];
  state.invoiceDiscount = 0;
  state.heldId = null;
  state.modal = null;
  saveDraft();
  render();
  toast('عُلّقت الفاتورة');
}

function recall(id) {
  const held = state.sales.find((sale) => sale.id === id && sale.status === 'held');
  if (!held) return;
  state.cart = held.cart || [];
  state.invoiceDiscount = held.invoiceDiscount || 0;
  state.customerId = held.customerId || '';
  state.heldId = held.id;
  state.modal = null;
  saveDraft();
  render();
}

async function finishShift(data) {
  const shift = openShift();
  if (!shift) throw new Error('لا توجد وردية');
  if (shift.cashierId !== me().id && !perms().settings) throw new Error('لا يمكنك إغلاق وردية كاشير آخر');
  const closed = closeShift({ opening: shift.opening, counted: data.get('counted'), ...shiftSlice(shift) });
  const next = { ...shift, ...closed, closedAt: new Date().toISOString(), note: String(data.get('note') || '') };
  await db.putRecord('shifts', next);
  const index = state.shifts.findIndex((row) => row.id === shift.id);
  state.shifts[index] = next;
  printHtml(`<article class="receipt"><h3>إغلاق الوردية</h3><p>${escapeHtml(state.shop.name)}</p><p>المتوقع ${formatIQD(next.expected)}</p><p>المعدود ${formatIQD(next.counted)}</p><p>الفرق ${formatIQD(next.difference)}</p></article>`);
  render();
}

async function saveProduct(data) {
  let categoryId = String(data.get('categoryId') || '');
  const newCategory = String(data.get('newCategory') || '').trim();
  if (newCategory) {
    const found = state.categories.find((row) => row.name === newCategory);
    if (found) categoryId = found.id;
    else {
      const category = { id: uid('cat'), name: newCategory };
      await db.putRecord('categories', category);
      state.categories.push(category);
      categoryId = category.id;
    }
  }
  const barcode = String(data.get('barcode') || '').trim();
  if (barcode && state.products.some((row) => row.active !== false && row.barcode === barcode && row.id !== data.get('id'))) throw new Error('الباركود مستخدم');
  const product = {
    id: data.get('id') || uid('prd'), barcode, name: String(data.get('name')).trim(), categoryId,
    unit: data.get('unit') || 'piece', price: toIQD(data.get('price')), cost: toIQD(data.get('cost') || 0),
    stock: Number(data.get('stock') || 0), lowStock: toIQD(data.get('lowStock') || 0),
    trackStock: data.get('trackStock') === 'on', active: true,
  };
  if (!product.name) throw new Error('اكتب اسم المادة');
  await db.putRecord('products', product);
  const index = state.products.findIndex((row) => row.id === product.id);
  if (index >= 0) state.products[index] = product; else state.products.push(product);
  state.view = 'products';
  render();
}

async function saveCustomer(data) {
  const limit = String(data.get('creditLimit') || '').trim();
  const customer = {
    id: data.get('id') || uid('cus'), name: String(data.get('name')).trim(), phone: String(data.get('phone') || '').trim(),
    address: String(data.get('address') || '').trim(), note: String(data.get('note') || '').trim(),
    creditLimit: limit ? toIQD(limit) : null, createdAt: new Date().toISOString(),
  };
  if (!customer.name) throw new Error('اكتب اسم الزبون');
  const previous = state.customers.find((row) => row.id === customer.id);
  if (previous) customer.createdAt = previous.createdAt;
  await db.putRecord('customers', customer);
  const index = state.customers.findIndex((row) => row.id === customer.id);
  if (index >= 0) state.customers[index] = customer; else state.customers.push(customer);
  state.editingId = customer.id;
  state.customerEdit = false;
  state.view = 'customer';
  render();
}

async function takePayment(data) {
  const shift = requireShift();
  const amount = toIQD(data.get('amount'));
  if (amount <= 0) throw new Error('أدخل مبلغ التسديد');
  const entry = {
    id: uid('ent'), customerId: String(data.get('customerId')), type: 'payment', method: 'cash', amount,
    at: new Date().toISOString(), note: String(data.get('note') || 'تسديد'), shiftId: shift.id, cashierId: me().id,
  };
  await db.recordDebtPayment(entry);
  state.entries.push(entry);
  render();
  toast('سُجّلت الدفعة في الصندوق');
}

function addPurchaseLine(data) {
  const product = state.products.find((row) => row.id === data.get('productId'));
  if (!product) throw new Error('اختر المادة');
  state.purchaseLines.push({ productId: product.id, name: product.name, qty: data.get('qty'), unitCost: toIQD(data.get('unitCost')) });
  render();
}

async function savePurchase(data) {
  if (!state.purchaseLines.length) throw new Error('أضف مواد الشراء');
  const paidCash = data.get('paidCash') === 'on';
  const shift = paidCash ? requireShift() : openShift();
  const lines = state.purchaseLines.map((line) => ({ ...line, qty: Number(line.qty), unitCost: toIQD(line.unitCost) }));
  const updated = [];
  let total = 0;
  for (const line of lines) {
    const product = updated.find((row) => row.id === line.productId) || state.products.find((row) => row.id === line.productId);
    const received = receiveStock(product, line.qty, line.unitCost);
    total += Math.round(line.qty * line.unitCost);
    const next = { ...product, stock: received.stock, cost: received.cost };
    const index = updated.findIndex((row) => row.id === next.id);
    if (index >= 0) updated[index] = next; else updated.push(next);
  }
  const purchase = {
    id: uid('pur'), supplier: String(data.get('supplier')).trim(), at: new Date().toISOString(),
    lines, total, paidCash, shiftId: shift?.id || '', cashierId: me().id,
  };
  if (!purchase.supplier) throw new Error('اكتب اسم المورد');
  await db.completePurchase({ purchase, products: updated });
  state.purchases.push(purchase);
  for (const product of updated) state.products[state.products.findIndex((row) => row.id === product.id)] = product;
  state.purchaseLines = [];
  state.view = 'stock';
  render();
  toast('تحدّث المخزون وسعر الكلفة');
}

function findSale(number) {
  const sale = state.sales.find((row) => row.status === 'completed' && String(row.number) === String(number).trim());
  if (!sale) throw new Error('لا توجد فاتورة بهذا الرقم');
  state.returnSaleId = sale.id;
  render();
}

async function saveReturn(data) {
  const sale = state.sales.find((row) => row.id === data.get('saleId'));
  if (!sale) throw new Error('الفاتورة غير موجودة');
  const method = data.get('method') === 'debt' ? 'debt' : 'cash';
  if (method === 'cash') requireShift();
  if (method === 'debt' && !sale.customerId) throw new Error('هذه الفاتورة بلا زبون، ردها نقدًا');
  const picked = [];
  sale.lines.forEach((line, index) => {
    const raw = String(data.get(`qty-${index}`) || '').trim();
    if (!raw || raw === '0') return;
    picked.push({ index, ...refundLine(line, raw), line });
  });
  if (!picked.length) throw new Error('حدد كمية مرتجعة');
  const total = picked.reduce((sum, line) => sum + line.total, 0);
  const cost = picked.reduce((sum, line) => sum + line.cost, 0);
  const updated = [];
  const lines = sale.lines.map((line, index) => {
    const item = picked.find((row) => row.index === index);
    if (!item) return line;
    const product = state.products.find((row) => row.id === line.productId);
    if (product && product.trackStock !== false) updated.push({ ...product, stock: restoreStock(product, item.qty).stock });
    return { ...line, returnedQty: Math.round((Number(line.returnedQty || 0) + item.qty) * 1000) / 1000 };
  });
  const nextSale = { ...sale, lines };
  const returnDoc = {
    id: uid('ret'), saleId: sale.id, number: sale.number, at: new Date().toISOString(), method, total, cost,
    shiftId: openShift()?.id || '', cashierId: me().id,
    lines: picked.map((item) => ({ name: item.line.name, qty: item.qty, total: item.total })),
  };
  const entry = method === 'debt' ? {
    id: uid('ent'), customerId: sale.customerId, type: 'payment', method: 'return', amount: total,
    at: returnDoc.at, note: `مرتجع فاتورة ${sale.number}`, saleId: sale.id, shiftId: returnDoc.shiftId, cashierId: me().id,
  } : null;
  await db.completeReturn({ sale: nextSale, returnDoc, products: updated, entry });
  const index = state.sales.findIndex((row) => row.id === sale.id);
  state.sales[index] = nextSale;
  state.returns.push(returnDoc);
  for (const product of updated) state.products[state.products.findIndex((row) => row.id === product.id)] = product;
  if (entry) state.entries.push(entry);
  state.returnSaleId = '';
  state.view = 'sale';
  render();
  toast(`تم المرتجع ${formatIQD(total)}`);
}

async function saveSettings(data, form) {
  const file = form.querySelector('input[type=file]').files[0];
  let logo = state.shop.logo || '';
  if (file) logo = await resizeLogo(file);
  state.shop = {
    ...state.shop,
    name: String(data.get('name')).trim(),
    phone: String(data.get('phone') || '').trim(),
    address: String(data.get('address') || '').trim(),
    footer: String(data.get('footer') || '').trim(),
    paper: data.get('paper') === '58' ? '58' : '80',
    creditDays: toIQD(data.get('creditDays') || 30),
    logo,
  };
  await db.saveShop(state.shop);
  toast('حُفظت الإعدادات');
  render();
}

async function addCashier(data) {
  const salt = uid('salt');
  const hashed = await hashPin(data.get('pin'), salt);
  const cashier = {
    id: uid('cas'), name: String(data.get('name')).trim(), role: 'cashier', active: true,
    pinHash: hashed.pinHash, salt,
    perms: { discount: data.get('discount') === 'on', returnSale: data.get('returnSale') === 'on', debts: true },
  };
  if (!cashier.name) throw new Error('اكتب اسم الكاشير');
  await db.putRecord('cashiers', cashier);
  state.cashiers.push(cashier);
  render();
  toast('أُضيف الكاشير');
}

function saleText(sale) {
  const customer = state.customers.find((row) => row.id === sale.customerId);
  const lines = [
    state.shop.name, `فاتورة ${sale.number}`, formatDateTime(sale.at),
    ...(sale.lines || []).map((line) => `${line.name} × ${line.qty} = ${formatIQD(line.total)}`),
    `الإجمالي: ${formatIQD(sale.total)}`,
    sale.change ? `الباقي: ${formatIQD(sale.change)}` : '',
    customer ? `الزبون: ${customer.name}` : '',
    customer ? `رصيد الدين: ${formatIQD(balanceOf(customerEntries(customer.id)))}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}
function statementText(customer) {
  const rows = statementRows(customerEntries(customer.id));
  const lines = [
    `كشف حساب — ${state.shop.name}`, `الزبون: ${customer.name}`,
    `الرصيد: ${formatIQD(balanceOf(rows))}`, `المتأخر: ${formatIQD(overdueAmount(rows))}`,
    ...rows.slice(-15).map((row) => `${formatDateTime(row.at)} | ${view.entryLabel(row)} | ${formatIQD(row.effect)} | الرصيد ${formatIQD(row.balance)}`),
  ];
  return lines.join('\n');
}
function share(text, phone) {
  const number = whatsAppPhone(phone);
  const url = number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
}
function printSale(id) {
  const sale = state.sales.find((row) => row.id === id);
  const customer = state.customers.find((row) => row.id === sale.customerId);
  printHtml(view.receiptHtml(state.shop, sale, customer, customer ? balanceOf(customerEntries(customer.id)) : 0));
}
function shareSale(id) {
  const sale = state.sales.find((row) => row.id === id);
  const customer = state.customers.find((row) => row.id === sale.customerId);
  share(saleText(sale), customer?.phone);
}
function printStatement(id) {
  const customer = state.customers.find((row) => row.id === id);
  const rows = statementRows(customerEntries(id));
  printHtml(view.statementHtml(state.shop, customer, rows, balanceOf(rows), overdueAmount(rows)));
}
function shareStatement(id) {
  const customer = state.customers.find((row) => row.id === id);
  share(statementText(customer), customer.phone);
}
function printHtml(html) {
  document.getElementById('print-root').innerHTML = html;
  window.print();
}

function exportProducts() {
  const rows = state.products.filter((p) => p.active !== false).map((p) => ({
    الباركود: p.barcode || '', الاسم: p.name,
    التصنيف: state.categories.find((c) => c.id === p.categoryId)?.name || '',
    الوحدة: p.unit, 'سعر البيع': p.price, 'سعر الكلفة': p.cost || 0, الكمية: p.stock || 0, 'حد التنبيه': p.lowStock || 0,
  }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'المواد');
  XLSX.writeFile(book, 'products.xlsx');
}
async function importProducts(file) {
  if (!file) return;
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' });
  let count = 0;
  for (const row of rows) {
    const name = cell(row, ['الاسم', 'اسم', 'name']);
    if (!name) continue;
    const barcode = String(cell(row, ['باركود', 'barcode']) || '').trim();
    const categoryName = String(cell(row, ['تصنيف', 'category']) || '').trim();
    let categoryId = '';
    if (categoryName) {
      let category = state.categories.find((item) => item.name === categoryName);
      if (!category) {
        category = { id: uid('cat'), name: categoryName };
        await db.putRecord('categories', category);
        state.categories.push(category);
      }
      categoryId = category.id;
    }
    const existing = barcode ? state.products.find((item) => item.barcode === barcode) : null;
    const product = {
      id: existing?.id || uid('prd'), barcode, name: String(name).trim(), categoryId,
      unit: normalizeUnit(cell(row, ['وحدة', 'unit'])),
      price: toIQD(cell(row, ['سعر البيع', 'سعر', 'price']) || 0),
      cost: toIQD(cell(row, ['كلفة', 'تكلفة', 'cost']) || 0),
      stock: Number(cell(row, ['كمية', 'مخزون', 'stock']) || 0),
      lowStock: toIQD(cell(row, ['حد', 'low']) || 0),
      trackStock: true, active: true,
    };
    await db.putRecord('products', product);
    if (existing) Object.assign(existing, product); else state.products.push(product);
    count += 1;
  }
  render();
  toast(`استُوردت ${count} مادة`);
}
function cell(row, names) {
  for (const key of Object.keys(row)) {
    const folded = String(key).trim().toLowerCase();
    if (names.some((name) => folded.includes(String(name).toLowerCase()))) return row[key];
  }
  return '';
}
function normalizeUnit(value) {
  const text = String(value || '').trim();
  if (text === 'kg' || text.includes('كغ') || text.includes('كغم')) return 'kg';
  if (text === 'g' || text.includes('غرام')) return 'g';
  if (text === 'l' || text.includes('لتر')) return 'l';
  return 'piece';
}
function exportReport() {
  const report = summarizePeriod({ ...state, ...bounds(state.reportFrom, state.reportTo) });
  const books = portfolio(state.customers, state.entries).rows.filter((row) => row.balance > 0).map((row) => ({
    الزبون: row.customer.name, الهاتف: row.customer.phone || '', الرصيد: row.balance, المتأخر: row.overdue,
  }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{
    'صافي المبيعات': report.net, الربح: report.profit, النقد: report.cash, الآجل: report.credit, 'تحصيل الديون': report.debtCollected,
  }]), 'الملخص');
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(books), 'الديون');
  XLSX.writeFile(book, 'report.xlsx');
}
function exportBackup() {
  const payload = {
    version: 1, exportedAt: new Date().toISOString(), shop: state.shop,
    cashiers: state.cashiers, categories: state.categories, products: state.products, customers: state.customers,
    entries: state.entries, sales: state.sales, returns: state.returns, purchases: state.purchases, shifts: state.shifts,
  };
  downloadBlob(`cashier-backup-${baghdadDateKey()}.json`, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
}
async function restoreBackup(file) {
  if (!file) return;
  const payload = JSON.parse(await file.text());
  if (payload.version !== 1 || !payload.shop?.name || !Array.isArray(payload.cashiers)) throw new Error('ملف النسخة غير صالح');
  await db.replaceAll(payload);
  location.reload();
}

async function openCamera() {
  if (!window.Html5Qrcode) throw new Error('الكاميرا غير متاحة في هذا المتصفح');
  state.modal = { name: 'camera' };
  render();
  const scanner = new Html5Qrcode('qr-reader');
  state.scanner = scanner;
  await scanner.start({ facingMode: 'environment' }, { fps: 8, qrbox: { width: 220, height: 160 } }, async (text) => {
    await closeModal();
    await addByCode(text);
  }, () => {});
}
async function closeModal() {
  if (state.scanner) {
    try { await state.scanner.stop(); } catch { /* already stopped */ }
    state.scanner = null;
  }
  state.modal = null;
  render();
}
async function addByCode(raw) {
  const code = String(raw || '').trim();
  if (!code) return;
  const exact = state.products.find((product) => product.active !== false && String(product.barcode) === code);
  if (exact) return stageProduct(exact);
  const matches = searchProducts(code);
  if (matches.length === 1 && matches[0].name === code) return stageProduct(matches[0]);
  if (exact == null && matches.length === 1 && String(matches[0].barcode) === code) return stageProduct(matches[0]);
  paintSearch(code);
  if (!matches.length && perms().products && /^\d{4,}$/.test(code)) {
    state.modal = { name: 'quick', barcode: code };
    render();
    return;
  }
  if (!matches.length) toast('المادة غير موجودة');
}

function resizeLogo(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 320 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', 0.8);
      if (url.length > 140000) reject(new Error('الشعار كبير. اختر صورة أصغر'));
      else resolve(url);
    };
    image.onerror = () => reject(new Error('تعذر قراءة الصورة'));
    image.src = URL.createObjectURL(file);
  });
}

boot().catch((error) => { app.textContent = error.message || 'تعذر فتح قاعدة البيانات'; });

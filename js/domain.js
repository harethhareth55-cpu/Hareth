'use strict';

import { quoteOrder, toIQD, parseQty } from './money.js';
import { summarizeOrders, unsettledOrders, custodyOrders } from './report.js';
import { assertOwner, randomToken, uid } from './util.js';

const STATUSES = new Set(['new', 'picked_up', 'delivered', 'returned', 'cancelled']);

export function assertPinFormat(pin) {
  if (!/^\d{4,6}$/.test(String(pin || ''))) throw new Error('الرمز السري ٤ إلى ٦ أرقام');
}

export async function hashPin(pin, salt) {
  assertPinFormat(pin);
  const data = new TextEncoder().encode(`da1|${salt}|${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPin(pin, salt, expectedHash) {
  if (!expectedHash) return false;
  let hash;
  try {
    hash = await hashPin(pin, salt);
  } catch {
    return false;
  }
  if (hash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i += 1) diff |= hash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return diff === 0;
}

function clean(value) {
  return String(value || '').trim();
}

export function normalizeLine(line) {
  const name = clean(line.name);
  if (!name) throw new Error('اسم الصنف مطلوب');
  return {
    itemId: line.itemId || null,
    name,
    qty: parseQty(line.qty),
    unitPrice: toIQD(line.unitPrice),
  };
}

export function createShopRecord(input, pinHash, at = new Date().toISOString()) {
  const name = clean(input.name);
  const ownerName = clean(input.ownerName);
  if (name.length < 2) throw new Error('اكتب اسم المحل');
  if (ownerName.length < 2) throw new Error('اكتب اسم صاحب المحل');
  if (!pinHash) throw new Error('الرمز السري مطلوب');
  if (input.feeBeneficiary !== 'driver' && input.feeBeneficiary !== 'shop') {
    throw new Error('حدد لمن تروح أجرة التوصيل');
  }
  return {
    id: uid('s'),
    name,
    ownerName,
    phone: clean(input.phone),
    pinHash,
    currency: 'IQD',
    feeBeneficiary: input.feeBeneficiary,
    defaultDeliveryFee: toIQD(input.defaultDeliveryFee || 0),
    createdAt: at,
    nextOrderSeq: 1,
    roleDevice: 'owner',
    linkedDriverId: null,
  };
}

export function updateShopSettings(shop, input) {
  const name = clean(input.name);
  if (name.length < 2) throw new Error('اكتب اسم المحل');
  const ownerName = clean(input.ownerName || shop.ownerName);
  if (shop.roleDevice !== 'driver' && ownerName.length < 2) throw new Error('اكتب اسم صاحب المحل');
  if (input.feeBeneficiary !== 'driver' && input.feeBeneficiary !== 'shop') {
    throw new Error('حدد لمن تروح أجرة التوصيل');
  }
  return {
    ...shop,
    name,
    ownerName,
    phone: clean(input.phone),
    feeBeneficiary: input.feeBeneficiary,
    defaultDeliveryFee: toIQD(input.defaultDeliveryFee || 0),
  };
}

export function createDriverRecord(input, pinHash, at = new Date().toISOString()) {
  const name = clean(input.name);
  if (name.length < 2) throw new Error('اكتب اسم المندوب');
  if (!pinHash) throw new Error('رمز المندوب مطلوب');
  return {
    id: uid('d'),
    name,
    phone: clean(input.phone),
    pinHash,
    active: true,
    createdAt: at,
  };
}

export function updateDriverRecord(driver, input) {
  const name = clean(input.name);
  if (name.length < 2) throw new Error('اكتب اسم المندوب');
  return {
    ...driver,
    name,
    phone: clean(input.phone),
    active: input.active !== false,
  };
}

export function assertCanDeactivate(driver, orders) {
  const blocked = orders.some((order) => (
    order.driverId === driver.id
    && (order.status === 'picked_up' || (order.status === 'delivered' && !order.settlementId))
  ));
  if (blocked) throw new Error('صفّي حساب المندوب وأرجع العهدة قبل إيقافه');
}

export function createItemRecord(input) {
  const name = clean(input.name);
  if (!name) throw new Error('اكتب اسم الصنف');
  return {
    id: uid('i'),
    name,
    price: toIQD(input.price),
    barcode: clean(input.barcode),
    active: true,
  };
}

function orderDraft(input) {
  const customerName = clean(input.customerName);
  if (customerName.length < 2) throw new Error('اكتب اسم الزبون');
  const customerPhone = clean(input.customerPhone);
  const address = clean(input.address);
  if (!customerPhone && !address) throw new Error('اكتب هاتف الزبون أو العنوان');
  const lines = (input.lines || []).map(normalizeLine);
  const quote = quoteOrder({ ...input, lines });
  return {
    customerName,
    customerPhone,
    address,
    area: clean(input.area),
    notes: clean(input.notes),
    lines,
    goodsTotal: quote.goodsTotal,
    discount: quote.discount,
    deliveryFee: quote.deliveryFee,
    driverId: input.driverId || null,
  };
}

export function createOrderRecord(shop, input, at = new Date().toISOString()) {
  const draft = orderDraft(input);
  const number = shop.nextOrderSeq || 1;
  return {
    id: uid('o'),
    number,
    token: randomToken(),
    shopId: shop.id,
    ...draft,
    status: 'new',
    cashCollected: null,
    settlementId: null,
    createdAt: at,
    pickedUpAt: null,
    deliveredAt: null,
    returnedAt: null,
    cancelledAt: null,
    returnReason: '',
  };
}

export function updateOpenOrder(order, input, actor) {
  assertOwner(actor);
  if (order.status !== 'new') throw new Error('ما يتعدل الطلب بعد ما يطلع مع المندوب');
  if (order.settlementId) throw new Error('الطلب داخل تصفية');
  return { ...order, ...orderDraft(input) };
}

function assertDriverOwns(order, actor) {
  if (actor?.role === 'driver' && order.driverId && order.driverId !== actor.driverId) {
    throw new Error('هذا الطلب لمندوب آخر');
  }
}

export function applyPickup(order, { driverId, at, actor }) {
  if (order.status !== 'new') throw new Error('الطلب ليس بانتظار الاستلام');
  assertDriverOwns(order, actor);
  const nextDriver = driverId || order.driverId || (actor?.role === 'driver' ? actor.driverId : null);
  if (!nextDriver) throw new Error('حدد المندوب قبل تأكيد الاستلام');
  if (actor?.role === 'driver' && nextDriver !== actor.driverId) {
    throw new Error('المندوب يؤكد استلام طلباته فقط');
  }
  return { ...order, status: 'picked_up', driverId: nextDriver, pickedUpAt: at };
}

export function applyDelivery(order, { cashCollected, at, actor }) {
  if (order.status !== 'picked_up') throw new Error('أكد الاستلام قبل تسجيل التسليم');
  assertDriverOwns(order, actor);
  return {
    ...order,
    status: 'delivered',
    cashCollected: toIQD(cashCollected),
    deliveredAt: at,
  };
}

export function applyReturn(order, { at, reason = '', actor }) {
  if (order.settlementId) throw new Error('الطلب مصفّى. ما ينرجّع من داخل التصفية');
  if (order.status !== 'new' && order.status !== 'picked_up' && order.status !== 'delivered') {
    throw new Error('ما ينرجّع هذا الطلب');
  }
  if (actor?.role === 'driver') {
    if (order.status !== 'picked_up' || order.driverId !== actor.driverId) {
      throw new Error('المندوب يرجّع الطلبات اللي عنده فقط');
    }
  }
  return {
    ...order,
    status: 'returned',
    returnedAt: at,
    returnReason: clean(reason),
    cashCollected: 0,
  };
}

export function applyCancel(order, { at, actor }) {
  assertOwner(actor);
  if (order.settlementId) throw new Error('الطلب داخل تصفية');
  if (order.status === 'delivered') throw new Error('الطلب المسلّم ما ينلغى. سجّله مرتجع إذا رجعت البضاعة');
  if (order.status === 'cancelled') throw new Error('الطلب ملغى');
  if (order.status === 'returned') throw new Error('الطلب مرتجع');
  return { ...order, status: 'cancelled', cancelledAt: at };
}

export function applyConfirmation(order, confirm, actor, at) {
  if (!confirm || confirm.t !== 'c') throw new Error('هذا ليس رمز تأكيد');
  if (confirm.s !== order.shopId) throw new Error('الرمز من محل آخر');
  if (confirm.id !== order.id) throw new Error('الرمز لطلب آخر');
  if (!confirm.k || confirm.k !== order.token) throw new Error('رمز التأكيد لا يطابق الطلب');
  if (confirm.st === 'picked_up') {
    return applyPickup(order, { driverId: confirm.dr || actor?.driverId, at, actor });
  }
  if (confirm.st === 'delivered') {
    const picked = order.status === 'new'
      ? applyPickup(order, { driverId: confirm.dr || order.driverId, at, actor })
      : order;
    return applyDelivery(picked, { cashCollected: confirm.cash, at, actor });
  }
  if (confirm.st === 'returned') {
    return applyReturn(order, { at, reason: '', actor });
  }
  throw new Error('حالة التأكيد غير معروفة');
}

export function sameConfirmation(order, confirm) {
  if (!confirm || confirm.k !== order.token || confirm.id !== order.id) return false;
  if (confirm.st === 'delivered' && order.status === 'delivered') {
    return toIQD(confirm.cash) === toIQD(order.cashCollected ?? 0);
  }
  return confirm.st === order.status;
}

export function buildSettlement({
  driverId,
  driverName,
  orders,
  orderIds,
  actualHandover,
  feeBeneficiary,
  note,
  at,
  actor,
}) {
  assertOwner(actor);
  if (!driverId) throw new Error('اختر المندوب');
  const eligible = unsettledOrders(orders, driverId);
  const wanted = orderIds ? eligible.filter((order) => orderIds.includes(order.id)) : eligible;
  if (orderIds && wanted.length !== orderIds.length) {
    throw new Error('بعض الطلبات المختارة لا تصلح للتصفية');
  }
  if (wanted.length === 0) throw new Error('لا توجد طلبات مسلّمة غير مصفّاة لهذا المندوب');
  const summary = summarizeOrders(wanted, feeBeneficiary);
  const actual = toIQD(actualHandover);
  const settlement = {
    id: uid('st'),
    driverId,
    driverName: driverName || '',
    createdAt: at,
    orderIds: wanted.map((order) => order.id),
    summary,
    actualHandover: actual,
    difference: actual - summary.expectedHandover,
    note: clean(note),
  };
  return settlement;
}

export function driverBalance(orders, driverId, feeBeneficiary) {
  const unsettled = unsettledOrders(orders, driverId);
  const custody = custodyOrders(orders, driverId);
  return {
    unsettled: summarizeOrders(unsettled, feeBeneficiary),
    custody: summarizeOrders(custody, feeBeneficiary),
    unsettledOrders: unsettled,
    custodyOrders: custody,
  };
}

export function shopFromJoin(payload, pinHash, at = new Date().toISOString()) {
  if (!payload || payload.t !== 'j') throw new Error('هذا ليس رمز ربط جهاز');
  if (!payload.s || !payload.id || !payload.dn) throw new Error('رمز الربط ناقص');
  if (!pinHash) throw new Error('اختر رمزًا لهذا الجهاز');
  const fee = toIQD(payload.df || 0);
  return {
    shop: {
      id: payload.s,
      name: payload.sn || 'المحل',
      ownerName: '',
      phone: '',
      pinHash,
      currency: 'IQD',
      feeBeneficiary: payload.fb === 'shop' ? 'shop' : 'driver',
      defaultDeliveryFee: fee,
      createdAt: at,
      nextOrderSeq: 1,
      roleDevice: 'driver',
      linkedDriverId: payload.id,
    },
    driver: {
      id: payload.id,
      name: payload.dn,
      phone: '',
      pinHash: '',
      active: true,
      createdAt: at,
    },
  };
}

export function exportBackup({ shop, drivers, orders, settlements, items }) {
  return {
    app: 'delivery-accountant',
    version: 1,
    exportedAt: new Date().toISOString(),
    shop,
    drivers,
    orders,
    settlements,
    items: items || [],
  };
}

export function parseBackup(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('الملف مو بصيغة النسخة الاحتياطية');
    }
  }
  if (!data || data.app !== 'delivery-accountant' || data.version !== 1) {
    throw new Error('ملف النسخة غير معروف');
  }
  if (!data.shop || !data.shop.id || !data.shop.name) throw new Error('النسخة ناقصة بيانات المحل');
  if (!data.shop.pinHash) throw new Error('النسخة ناقصة رمز الدخول');
  if (!Array.isArray(data.orders) || !Array.isArray(data.drivers) || !Array.isArray(data.settlements)) {
    throw new Error('النسخة ناقصة');
  }
  const items = Array.isArray(data.items) ? data.items : [];
  const ids = new Set();
  for (const order of data.orders) {
    if (!order || !order.id || !order.token || !STATUSES.has(order.status)) {
      throw new Error('في طلب تالف داخل النسخة');
    }
    if (ids.has(order.id)) throw new Error('في طلب مكرر داخل النسخة');
    ids.add(order.id);
    toIQD(order.goodsTotal || 0);
    toIQD(order.discount || 0);
    toIQD(order.deliveryFee || 0);
    if (order.status === 'delivered') toIQD(order.cashCollected ?? 0);
  }
  const maxNumber = data.orders.reduce((max, order) => Math.max(max, Number(order.number) || 0), 0);
  const shop = { ...data.shop };
  if (!shop.nextOrderSeq || shop.nextOrderSeq <= maxNumber) shop.nextOrderSeq = maxNumber + 1;
  if (shop.feeBeneficiary !== 'shop' && shop.feeBeneficiary !== 'driver') shop.feeBeneficiary = 'driver';
  return {
    shop,
    drivers: data.drivers,
    orders: data.orders,
    settlements: data.settlements,
    items,
  };
}

'use strict';

function bytesToBase64Url(bytes) {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(text) {
  let b64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function encodePayload(obj) {
  const json = JSON.stringify(obj);
  return `DA1.${bytesToBase64Url(new TextEncoder().encode(json))}`;
}

export function decodePayload(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('DA1.')) throw new Error('هذا الرمز ليس من محاسب التوصيل');
  let bytes;
  try {
    bytes = base64UrlToBytes(raw.slice(4));
  } catch {
    throw new Error('الرمز تالف');
  }
  let obj;
  try {
    obj = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('الرمز تالف');
  }
  if (!obj || obj.v !== 1 || typeof obj.t !== 'string') throw new Error('نسخة الرمز غير مدعومة');
  return obj;
}

function clip(value, max) {
  const text = String(value || '').trim();
  return text.length <= max ? text : text.slice(0, max);
}

export function orderToQR(order) {
  return encodePayload({
    t: 'o',
    v: 1,
    s: order.shopId,
    id: order.id,
    n: order.number,
    k: order.token,
    c: clip(order.customerName, 60),
    p: clip(order.customerPhone, 20),
    a: clip(order.address, 80),
    r: clip(order.area, 40),
    g: order.goodsTotal,
    d: order.discount || 0,
    f: order.deliveryFee || 0,
    dr: order.driverId || '',
    ca: Date.parse(order.createdAt) || Date.now(),
  });
}

export function confirmToQR({ shopId, orderId, token, status, cashCollected = 0, driverId = '' }) {
  return encodePayload({
    t: 'c',
    v: 1,
    s: shopId,
    id: orderId,
    k: token,
    st: status,
    cash: cashCollected,
    dr: driverId || '',
  });
}

export function joinToQR(shop, driver) {
  return encodePayload({
    t: 'j',
    v: 1,
    s: shop.id,
    sn: clip(shop.name, 40),
    fb: shop.feeBeneficiary,
    df: shop.defaultDeliveryFee || 0,
    id: driver.id,
    dn: clip(driver.name, 40),
  });
}

export function orderFromQR(payload) {
  if (payload.t !== 'o') throw new Error('هذا ليس رمز طلب');
  if (!payload.id || !payload.k || !payload.s) throw new Error('رمز الطلب ناقص');
  return {
    id: payload.id,
    number: Number(payload.n) || 0,
    token: payload.k,
    shopId: payload.s,
    customerName: payload.c || 'زبون',
    customerPhone: payload.p || '',
    address: payload.a || '',
    area: payload.r || '',
    notes: '',
    lines: [],
    goodsTotal: payload.g,
    discount: payload.d || 0,
    deliveryFee: payload.f || 0,
    driverId: payload.dr || null,
    status: 'new',
    cashCollected: null,
    settlementId: null,
    createdAt: new Date(payload.ca || Date.now()).toISOString(),
    pickedUpAt: null,
    deliveredAt: null,
    returnedAt: null,
    cancelledAt: null,
    returnReason: '',
    imported: true,
  };
}

'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCancel,
  applyConfirmation,
  applyDelivery,
  applyPickup,
  applyReturn,
  buildSettlement,
  createOrderRecord,
  hashPin,
  parseBackup,
  sameConfirmation,
  updateOpenOrder,
  verifyPin,
  exportBackup,
} from '../js/domain.js';

const owner = { role: 'owner' };
const driver = { role: 'driver', driverId: 'd1' };
const other = { role: 'driver', driverId: 'd2' };
const at = '2026-10-02T09:00:00.000Z';

function shop() {
  return {
    id: 's1',
    nextOrderSeq: 12,
    feeBeneficiary: 'driver',
  };
}

function makeOrder(overrides = {}) {
  const order = createOrderRecord(shop(), {
    customerName: 'سارة أحمد',
    customerPhone: '07701234567',
    address: 'الكرادة',
    goodsTotal: 10000,
    deliveryFee: 2000,
    discount: 0,
    driverId: 'd1',
  }, at);
  return { ...order, id: 'o1', token: 'tokentokentoken', shopId: 's1', driverId: 'd1', ...overrides };
}

test('pins match only the same salt', async () => {
  const hash = await hashPin('1234', 's1');
  assert.equal(await verifyPin('1234', 's1', hash), true);
  assert.equal(await verifyPin('1235', 's1', hash), false);
  assert.equal(await verifyPin('1234', 's2', hash), false);
  await assert.rejects(() => hashPin('12', 's1'), /٤ إلى ٦/);
});

test('pickup then delivery records the cash; delivery before pickup is rejected', () => {
  const fresh = makeOrder();
  assert.throws(() => applyDelivery(fresh, { cashCollected: 12000, at, actor: driver }), /الاستلام/);
  const picked = applyPickup(fresh, { at, actor: driver });
  assert.equal(picked.status, 'picked_up');
  assert.equal(picked.driverId, 'd1');
  const delivered = applyDelivery(picked, { cashCollected: '١٢٬٠٠٠', at, actor: driver });
  assert.equal(delivered.cashCollected, 12000);
  assert.equal(delivered.status, 'delivered');
});

test('a driver cannot take or deliver another driver order', () => {
  const fresh = makeOrder();
  assert.throws(() => applyPickup(fresh, { at, actor: other }), /مندوب آخر/);
  const picked = applyPickup(fresh, { at, actor: owner, driverId: 'd1' });
  assert.throws(() => applyDelivery(picked, { cashCollected: 12000, at, actor: other }), /مندوب آخر/);
});

test('owner can cancel a new order, not a delivered one; driver cannot cancel', () => {
  const fresh = makeOrder();
  assert.throws(() => applyCancel(fresh, { at, actor: driver }), /صاحب المحل/);
  const cancelled = applyCancel(fresh, { at, actor: owner });
  assert.equal(cancelled.status, 'cancelled');
  const delivered = applyDelivery(applyPickup(makeOrder(), { at, actor: driver }), {
    cashCollected: 12000, at, actor: driver,
  });
  assert.throws(() => applyCancel(delivered, { at, actor: owner }), /ما ينلغى/);
});

test('open order can be edited; an order out with the driver cannot', () => {
  const fresh = makeOrder();
  const edited = updateOpenOrder(fresh, {
    customerName: 'منى',
    customerPhone: '07700000000',
    goodsTotal: 8000,
    deliveryFee: 1500,
  }, owner);
  assert.equal(edited.goodsTotal, 8000);
  assert.equal(edited.deliveryFee, 1500);
  const picked = applyPickup(fresh, { at, actor: driver });
  assert.throws(() => updateOpenOrder(picked, {
    customerName: 'منى', customerPhone: '07700000000', goodsTotal: 1, deliveryFee: 0,
  }, owner), /بعد ما يطلع/);
});

test('return before settlement drops the cash; a settled order cannot be returned', () => {
  const delivered = applyDelivery(applyPickup(makeOrder(), { at, actor: driver }), {
    cashCollected: 12000, at, actor: owner,
  });
  const returned = applyReturn(delivered, { at, reason: 'الزبون رفض', actor: owner });
  assert.equal(returned.status, 'returned');
  assert.equal(returned.cashCollected, 0);
  assert.throws(() => applyReturn({ ...delivered, settlementId: 'st' }, { at, actor: owner }), /مصفّى/);
  assert.throws(() => applyReturn(applyPickup(makeOrder(), { at, actor: driver }), { at, actor: other }), /عنده فقط/);
});

test('confirmation QR must carry the order token', () => {
  const picked = applyPickup(makeOrder(), { at, actor: driver });
  assert.throws(() => applyConfirmation(picked, {
    t: 'c', s: 's1', id: 'o1', k: 'wrong', st: 'delivered', cash: 12000,
  }, owner, at), /لا يطابق/);
  const delivered = applyConfirmation(picked, {
    t: 'c', s: 's1', id: 'o1', k: picked.token, st: 'delivered', cash: 12000, dr: 'd1',
  }, owner, at);
  assert.equal(delivered.status, 'delivered');
  assert.equal(sameConfirmation(delivered, {
    id: 'o1', k: picked.token, st: 'delivered', cash: 12000,
  }), true);
});

test('a delivery code closes a new order in one step', () => {
  const fresh = makeOrder();
  const delivered = applyConfirmation(fresh, {
    t: 'c', s: 's1', id: fresh.id, k: fresh.token, st: 'delivered', cash: 9000, dr: 'd1',
  }, owner, at);
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.cashCollected, 9000);
  assert.equal(delivered.driverId, 'd1');
  assert.ok(delivered.pickedUpAt);
});

test('settlement sums only the selected unsettled orders and records the shortage', () => {
  const a = applyDelivery(applyPickup(makeOrder({ id: 'a' }), { at, actor: driver }), {
    cashCollected: 12000, at, actor: driver,
  });
  const b = applyDelivery(applyPickup(makeOrder({ id: 'b', goodsTotal: 5000, deliveryFee: 2000 }), { at, actor: driver }), {
    cashCollected: 5000, at, actor: driver,
  });
  const otherDriver = applyDelivery(applyPickup(makeOrder({ id: 'c', driverId: 'd2' }), {
    at, actor: owner, driverId: 'd2',
  }), { cashCollected: 12000, at, actor: owner });
  const settled = { ...a, id: 'already', settlementId: 'old' };

  const settlement = buildSettlement({
    driverId: 'd1',
    driverName: 'علي',
    orders: [a, b, otherDriver, settled],
    actualHandover: 14000,
    feeBeneficiary: 'driver',
    note: 'نقص من جيب المندوب',
    at,
    actor: owner,
  });
  assert.deepEqual(settlement.orderIds.sort(), ['a', 'b']);
  assert.equal(settlement.summary.expectedHandover, 15000);
  assert.equal(settlement.actualHandover, 14000);
  assert.equal(settlement.difference, -1000);
  assert.throws(() => buildSettlement({
    driverId: 'd1',
    orders: [a],
    orderIds: ['a', 'missing'],
    actualHandover: 10000,
    feeBeneficiary: 'driver',
    at,
    actor: owner,
  }), /لا تصلح/);
  assert.throws(() => buildSettlement({
    driverId: 'd1', orders: [a], actualHandover: 1, feeBeneficiary: 'driver', at, actor: driver,
  }), /صاحب المحل/);
});

test('backup rejects a damaged file and keeps the next order number', () => {
  const order = makeOrder({ number: 40, status: 'new', cashCollected: null });
  const raw = exportBackup({
    shop: { id: 's1', name: 'ماركت النور', pinHash: 'abc', nextOrderSeq: 1, feeBeneficiary: 'driver' },
    drivers: [],
    orders: [order],
    settlements: [],
    items: [],
  });
  const parsed = parseBackup(JSON.stringify(raw));
  assert.equal(parsed.shop.nextOrderSeq, 41);
  assert.throws(() => parseBackup('{}'), /غير معروف/);
  assert.throws(() => parseBackup({
    app: 'delivery-accountant',
    version: 1,
    shop: { id: 's', name: 'محل', pinHash: 'x' },
    drivers: [],
    settlements: [],
    orders: [{ id: '1', token: 't', status: 'nope', goodsTotal: 1 }],
  }), /تالف/);
});

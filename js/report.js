'use strict';

import { deliverySplit } from './money.js';

export function baghdadDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('تاريخ غير صالح');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function shiftDateKey(key, days) {
  const [year, month, day] = String(key).split('-').map(Number);
  if (!year || !month || !day) throw new Error('تاريخ غير صالح');
  const date = new Date(Date.UTC(year, month - 1, day, 9, 0, 0));
  date.setUTCDate(date.getUTCDate() + days);
  return baghdadDateKey(date);
}

export function emptyTotals() {
  return {
    count: 0,
    netGoods: 0,
    fees: 0,
    customerDue: 0,
    cashCollected: 0,
    expectedHandover: 0,
    driverShare: 0,
    shortage: 0,
    surplus: 0,
    custodyCount: 0,
    custodyValue: 0,
    returnedCount: 0,
    cancelledCount: 0,
    newCount: 0,
  };
}

function absorb(acc, order, feeBeneficiary) {
  const split = deliverySplit(order, feeBeneficiary);
  if (order.status === 'returned') acc.returnedCount += 1;
  else if (order.status === 'cancelled') acc.cancelledCount += 1;
  else if (order.status === 'new') acc.newCount += 1;
  else if (order.status === 'picked_up') {
    acc.custodyCount += 1;
    acc.custodyValue += split.netGoods;
  }
  if (!split.countsAsCash) return;
  acc.count += 1;
  acc.netGoods += split.netGoods;
  acc.fees += split.deliveryFee;
  acc.customerDue += split.customerDue;
  acc.cashCollected += split.cashCollected;
  acc.expectedHandover += split.expectedHandover;
  acc.driverShare += split.driverShare;
  acc.shortage += split.shortage;
  acc.surplus += split.surplus;
}

export function summarizeOrders(orders, feeBeneficiary = 'driver') {
  const acc = emptyTotals();
  for (const order of orders) absorb(acc, order, feeBeneficiary);
  return acc;
}

export function inBaghdadRange(iso, from, to) {
  if (!iso) return false;
  const key = baghdadDateKey(iso);
  return key >= from && key <= to;
}

export function periodReport(orders, { from, to, feeBeneficiary = 'driver', driverId = null } = {}) {
  if (!from || !to) throw new Error('حدد بداية الفترة ونهايتها');
  if (from > to) throw new Error('تاريخ البداية بعد النهاية');
  const scoped = driverId ? orders.filter((order) => order.driverId === driverId) : orders.slice();
  const created = scoped.filter((order) => inBaghdadRange(order.createdAt, from, to));
  const delivered = scoped.filter((order) => order.status === 'delivered' && inBaghdadRange(order.deliveredAt, from, to));
  const returned = scoped.filter((order) => order.status === 'returned' && inBaghdadRange(order.returnedAt, from, to));
  const cancelled = scoped.filter((order) => order.status === 'cancelled' && inBaghdadRange(order.cancelledAt, from, to));

  const byDriver = new Map();
  for (const order of delivered) {
    const id = order.driverId || '';
    if (!byDriver.has(id)) byDriver.set(id, []);
    byDriver.get(id).push(order);
  }

  return {
    from,
    to,
    createdCount: created.length,
    deliveredCount: delivered.length,
    returnedCount: returned.length,
    cancelledCount: cancelled.length,
    cash: summarizeOrders(delivered, feeBeneficiary),
    byDriver: [...byDriver.entries()].map(([id, list]) => ({
      driverId: id || null,
      ...summarizeOrders(list, feeBeneficiary),
    })),
  };
}

export function unsettledOrders(orders, driverId) {
  return orders.filter((order) => (
    order.driverId === driverId
    && order.status === 'delivered'
    && !order.settlementId
  ));
}

export function custodyOrders(orders, driverId) {
  return orders.filter((order) => order.driverId === driverId && order.status === 'picked_up');
}

'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmToQR, decodePayload, joinToQR, orderFromQR, orderToQR } from '../js/qr.js';

test('order QR round-trips Arabic text and money', () => {
  const order = {
    shopId: 's_abc',
    id: 'o_abc',
    number: 12,
    token: 'tok_123',
    customerName: 'فاطمة الزبيدي',
    customerPhone: '07701112233',
    address: 'حي الجامعة، شارع الربيع',
    area: 'الكرادة',
    goodsTotal: 18500,
    discount: 500,
    deliveryFee: 2000,
    driverId: 'd_1',
    createdAt: '2026-10-02T08:00:00.000Z',
  };
  const text = orderToQR(order);
  assert.match(text, /^DA1\./);
  const back = orderFromQR(decodePayload(text));
  assert.equal(back.customerName, order.customerName);
  assert.equal(back.address, order.address);
  assert.equal(back.goodsTotal, 18500);
  assert.equal(back.discount, 500);
  assert.equal(back.deliveryFee, 2000);
  assert.equal(back.token, order.token);
  assert.equal(back.shopId, order.shopId);
  assert.equal(back.createdAt, order.createdAt);
});

test('confirm and join payloads keep their type', () => {
  const confirm = decodePayload(confirmToQR({
    shopId: 's1', orderId: 'o1', token: 't1', status: 'delivered', cashCollected: 9000, driverId: 'd1',
  }));
  assert.equal(confirm.t, 'c');
  assert.equal(confirm.cash, 9000);
  assert.equal(confirm.st, 'delivered');

  const join = decodePayload(joinToQR(
    { id: 's1', name: 'ماركت النور', feeBeneficiary: 'driver', defaultDeliveryFee: 2000 },
    { id: 'd1', name: 'علي' },
  ));
  assert.equal(join.t, 'j');
  assert.equal(join.dn, 'علي');
  assert.equal(join.df, 2000);
});

test('foreign and damaged codes are rejected', () => {
  assert.throws(() => decodePayload('https://example.com'), /ليس من محاسب التوصيل/);
  assert.throws(() => decodePayload('DA1.@@@'), /تالف/);
  assert.throws(() => orderFromQR(decodePayload(confirmToQR({
    shopId: 's', orderId: 'o', token: 't', status: 'delivered', cashCollected: 1,
  }))), /ليس رمز طلب/);
});

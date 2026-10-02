'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toIQD,
  parseQty,
  lineAmount,
  quoteOrder,
  deliverySplit,
  formatIQD,
  differenceLabel,
} from '../js/money.js';

test('accepts integer dinars, thousands separators, and Arabic digits', () => {
  assert.equal(toIQD(12500), 12500);
  assert.equal(toIQD('12,500'), 12500);
  assert.equal(toIQD('١٢٬٥٠٠'), 12500);
  assert.equal(toIQD('۱۲٬۵۰۰'), 12500);
  assert.equal(toIQD(' 2500 '), 2500);
});

test('rejects fractions, negatives, and junk', () => {
  assert.throws(() => toIQD(10.5), /بدون كسور/);
  assert.throws(() => toIQD(-1), /سالب/);
  assert.throws(() => toIQD('abc'), /غير صالح/);
  assert.throws(() => toIQD(''), /مطلوب/);
});

test('quantities allow up to 3 decimals and line totals round to the dinar', () => {
  assert.equal(parseQty('١٫٥'), 1.5);
  assert.equal(lineAmount(1.5, 2000), 3000);
  assert.equal(lineAmount('0.25', 1500), 375);
  assert.equal(lineAmount(0.1, 333), 33);
  assert.throws(() => parseQty(0), /غير صالحة/);
  assert.throws(() => parseQty('1.2345'), /٣ خانات/);
});

test('quote uses line totals and blocks a discount above the goods', () => {
  const quote = quoteOrder({
    lines: [{ qty: 2, unitPrice: 4000 }, { qty: 1, unitPrice: 1500 }],
    discount: 500,
    deliveryFee: 2000,
    goodsTotal: 1,
  });
  assert.equal(quote.goodsTotal, 9500);
  assert.equal(quote.netGoods, 9000);
  assert.equal(quote.customerDue, 11000);
  assert.throws(() => quoteOrder({ goodsTotal: 1000, discount: 1001, deliveryFee: 0 }), /الخصم/);
});

test('full payment: driver keeps the fee and the shop gets net goods', () => {
  const split = deliverySplit({
    status: 'delivered',
    goodsTotal: 10000,
    discount: 0,
    deliveryFee: 2000,
    cashCollected: 12000,
  }, 'driver');
  assert.equal(split.expectedHandover, 10000);
  assert.equal(split.driverShare, 2000);
  assert.equal(split.shortage, 0);
  assert.equal(split.surplus, 0);
});

test('customer paid the goods only: driver loses the fee and still owes the shop', () => {
  const split = deliverySplit({
    status: 'delivered',
    goodsTotal: 10000,
    discount: 0,
    deliveryFee: 2000,
    cashCollected: 10000,
  }, 'driver');
  assert.equal(split.expectedHandover, 10000);
  assert.equal(split.driverShare, 0);
  assert.equal(split.shortage, 2000);
});

test('short payment below the goods is covered by the driver', () => {
  const split = deliverySplit({
    status: 'delivered',
    goodsTotal: 10000,
    discount: 0,
    deliveryFee: 2000,
    cashCollected: 8000,
  }, 'driver');
  assert.equal(split.expectedHandover, 10000);
  assert.equal(split.driverShare, 0);
  assert.equal(split.shortage, 4000);
});

test('surplus over the amount due goes to the shop, fee stays with the driver', () => {
  const split = deliverySplit({
    status: 'delivered',
    goodsTotal: 10000,
    discount: 0,
    deliveryFee: 2000,
    cashCollected: 13000,
  }, 'driver');
  assert.equal(split.expectedHandover, 11000);
  assert.equal(split.driverShare, 2000);
  assert.equal(split.surplus, 1000);
});

test('discount reduces what the shop is owed', () => {
  const split = deliverySplit({
    status: 'delivered',
    goodsTotal: 10000,
    discount: 1000,
    deliveryFee: 2000,
    cashCollected: 11000,
  }, 'driver');
  assert.equal(split.netGoods, 9000);
  assert.equal(split.customerDue, 11000);
  assert.equal(split.expectedHandover, 9000);
  assert.equal(split.driverShare, 2000);
});

test('when the fee belongs to the shop the driver hands over the full due', () => {
  const paid = deliverySplit({
    status: 'delivered', goodsTotal: 10000, deliveryFee: 2000, cashCollected: 12000,
  }, 'shop');
  assert.equal(paid.expectedHandover, 12000);
  assert.equal(paid.driverShare, 0);

  const short = deliverySplit({
    status: 'delivered', goodsTotal: 10000, deliveryFee: 2000, cashCollected: 8000,
  }, 'shop');
  assert.equal(short.expectedHandover, 12000);
  assert.equal(short.shortage, 4000);

  const extra = deliverySplit({
    status: 'delivered', goodsTotal: 10000, deliveryFee: 2000, cashCollected: 13000,
  }, 'shop');
  assert.equal(extra.expectedHandover, 13000);
  assert.equal(extra.surplus, 1000);
});

test('pickup, return, cancel, and new orders do not move cash', () => {
  for (const status of ['new', 'picked_up', 'returned', 'cancelled']) {
    const split = deliverySplit({
      status, goodsTotal: 10000, deliveryFee: 2000, cashCollected: 12000,
    }, 'driver');
    assert.equal(split.countsAsCash, false);
    assert.equal(split.expectedHandover, 0);
    assert.equal(split.inCustody, status === 'picked_up');
  }
});

test('unknown fee beneficiary is rejected', () => {
  assert.throws(() => deliverySplit({
    status: 'delivered', goodsTotal: 1, deliveryFee: 0, cashCollected: 1,
  }, 'other'), /غير معروفة/);
});

test('formats dinars with grouping and a signed shortage', () => {
  assert.equal(formatIQD(12500), '12,500 د.ع');
  assert.equal(formatIQD(-1500), '−1,500 د.ع');
  assert.equal(formatIQD(1500, { signed: true }), '+1,500 د.ع');
  assert.deepEqual(differenceLabel(-500).key, 'short');
  assert.equal(differenceLabel(0).label, 'مطابق');
  assert.equal(differenceLabel(500).label, 'زيادة');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { lineGross, priceLines, refundLine, settlePayment, toIQD, parseQty } from '../js/money.js';

test('parses Iraqi dinars and Arabic digits', () => {
  assert.equal(toIQD('١٥,٠٠٠'), 15000);
  assert.equal(toIQD('2500.4'), 2500);
  assert.equal(toIQD(''), 0);
});

test('rounds weighed line totals to whole dinars', () => {
  assert.equal(lineGross(1.25, 2000), 2500);
  assert.equal(lineGross(0.333, 1000), 333);
});

test('applies line and invoice discounts', () => {
  const priced = priceLines([
    { name: 'رز', qty: 2, unitPrice: 1500, discount: 500, cost: 1000 },
    { name: 'سكر', qty: '١٫٥', unitPrice: '٢٬٠٠٠', cost: 1200 },
  ], 300);
  assert.equal(priced.lines[0].total, 2500);
  assert.equal(priced.lines[1].total, 3000);
  assert.equal(priced.subtotal, 5500);
  assert.equal(priced.total, 5200);
  assert.equal(priced.cost, 3800);
  assert.equal(priced.profit, 1400);
});

test('rejects a discount bigger than the line', () => {
  assert.throws(() => priceLines([{ qty: 1, unitPrice: 1000, discount: 1001 }]), /خصم الصنف/);
});

test('computes change and partial credit', () => {
  const paid = settlePayment({ total: 10000, tendered: 7000, card: 0, onAccount: 4000 });
  assert.deepEqual(paid, { total: 10000, cash: 6000, card: 0, debt: 4000, tendered: 7000, change: 1000 });
});

test('rejects short cash', () => {
  assert.throws(() => settlePayment({ total: 5000, tendered: 4999 }), /أقل من المطلوب/);
});

test('rejects a non-positive quantity', () => {
  assert.throws(() => parseQty('0'), /الكمية/);
});

test('refunds a weighed line without exceeding what was sold', () => {
  const line = { qty: 2, total: 3000, costTotal: 1800, returnedQty: 0.5 };
  assert.deepEqual(refundLine(line, 0.5), { qty: 0.5, total: 750, cost: 450 });
  assert.throws(() => refundLine(line, 2), /المرتجعة/);
});

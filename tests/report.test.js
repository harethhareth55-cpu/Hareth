'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { baghdadDateKey, periodReport, shiftDateKey, summarizeOrders } from '../js/report.js';

function order(overrides) {
  return {
    id: overrides.id || 'o1',
    driverId: 'd1',
    status: 'delivered',
    goodsTotal: 10000,
    discount: 0,
    deliveryFee: 2000,
    cashCollected: 12000,
    createdAt: '2026-10-02T12:00:00.000Z',
    deliveredAt: '2026-10-02T12:00:00.000Z',
    settlementId: null,
    ...overrides,
  };
}

test('Baghdad day starts at 21:00 UTC', () => {
  assert.equal(baghdadDateKey('2026-10-02T20:30:00.000Z'), '2026-10-02');
  assert.equal(baghdadDateKey('2026-10-02T21:30:00.000Z'), '2026-10-03');
  assert.equal(shiftDateKey('2026-10-02', 1), '2026-10-03');
  assert.equal(shiftDateKey('2026-10-31', 1), '2026-11-01');
});

test('daily cash follows the delivery day, not the day the order was created', () => {
  const late = order({
    createdAt: '2026-10-02T18:00:00.000Z',
    deliveredAt: '2026-10-02T21:30:00.000Z',
  });
  const report = periodReport([late], {
    from: '2026-10-03',
    to: '2026-10-03',
    feeBeneficiary: 'driver',
  });
  assert.equal(report.createdCount, 0);
  assert.equal(report.deliveredCount, 1);
  assert.equal(report.cash.expectedHandover, 10000);
  assert.equal(report.cash.cashCollected, 12000);
  assert.equal(report.cash.driverShare, 2000);
});

test('summary ignores other drivers, settled rows, returns, and goods still out', () => {
  const rows = [
    order({ id: 'a' }),
    order({ id: 'b', driverId: 'd2', goodsTotal: 50000, cashCollected: 52000 }),
    order({ id: 'c', settlementId: 'st1' }),
    order({ id: 'd', status: 'picked_up', cashCollected: null, goodsTotal: 7000, deliveryFee: 0 }),
    order({ id: 'e', status: 'returned', cashCollected: 0 }),
    order({ id: 'f', status: 'cancelled', cashCollected: null }),
  ];
  const summary = summarizeOrders(rows.filter((row) => row.driverId === 'd1' && !row.settlementId), 'driver');
  assert.equal(summary.count, 1);
  assert.equal(summary.expectedHandover, 10000);
  assert.equal(summary.custodyCount, 1);
  assert.equal(summary.custodyValue, 7000);
  assert.equal(summary.returnedCount, 1);
  assert.equal(summary.cancelledCount, 1);
});

test('period rejects an inverted range', () => {
  assert.throws(() => periodReport([], { from: '2026-10-05', to: '2026-10-01' }), /البداية/);
});

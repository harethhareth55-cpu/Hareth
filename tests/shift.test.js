import test from 'node:test';
import assert from 'node:assert/strict';
import { closeShift, expectedDrawer } from '../js/shift.js';
import { summarizePeriod } from '../js/report.js';

test('drawer expects cash sales and debt collections minus refunds and purchases', () => {
  const expected = expectedDrawer({
    opening: 50000,
    sales: [
      { status: 'completed', payments: [{ method: 'cash', amount: 20000 }, { method: 'debt', amount: 5000 }] },
      { status: 'held', payments: [{ method: 'cash', amount: 999 }] },
    ],
    returns: [{ method: 'cash', total: 3000 }],
    debtPayments: [{ type: 'payment', method: 'cash', amount: 7000 }],
    purchases: [{ paidCash: true, total: 4000 }, { paidCash: false, total: 9000 }],
  });
  assert.equal(expected, 70000);
  const closed = closeShift({
    opening: 50000,
    counted: 68000,
    sales: [{ status: 'completed', payments: [{ method: 'cash', amount: 20000 }, { method: 'debt', amount: 5000 }] }],
    returns: [{ method: 'cash', total: 3000 }],
    debtPayments: [{ method: 'cash', amount: 7000 }],
    purchases: [{ paidCash: true, total: 4000 }],
  });
  assert.equal(closed.expected, 70000);
  assert.equal(closed.difference, -2000);
});

test('period report nets returns and keeps profit for the owner', () => {
  const report = summarizePeriod({
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-02T00:00:00.000Z',
    now: new Date('2026-10-02T00:00:00.000Z'),
    sales: [{
      status: 'completed',
      at: '2026-10-01T10:00:00.000Z',
      subtotal: 10000,
      invoiceDiscount: 1000,
      total: 9000,
      cost: 6000,
      debt: 2000,
      lines: [{ name: 'شاي', productId: 'p', categoryName: 'مواد', qty: 2, discount: 0, total: 10000 }],
      payments: [{ method: 'cash', amount: 7000 }, { method: 'debt', amount: 2000 }],
    }],
    returns: [{ at: '2026-10-01T12:00:00.000Z', total: 1000, cost: 700, method: 'cash' }],
    entries: [{ type: 'payment', method: 'cash', amount: 2000, at: '2026-10-01T13:00:00.000Z', customerId: 'a' }],
    purchases: [],
    customers: [{ id: 'a', name: 'علي' }],
  });
  assert.equal(report.net, 8000);
  assert.equal(report.profit, 2700);
  assert.equal(report.cash, 6000);
  assert.equal(report.credit, 2000);
  assert.equal(report.debtCollected, 2000);
  assert.equal(report.byCategory[0].total, 10000);
});

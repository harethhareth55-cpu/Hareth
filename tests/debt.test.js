import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateCharges, assertCredit, balanceOf, overdueAmount, portfolio, statementRows } from '../js/debt.js';

const charges = [
  { id: 'c1', customerId: 'a', type: 'charge', amount: 10000, at: '2026-09-01T00:00:00.000Z', dueAt: '2026-09-10T00:00:00.000Z' },
  { id: 'c2', customerId: 'a', type: 'charge', amount: 5000, at: '2026-09-20T00:00:00.000Z', dueAt: '2026-10-20T00:00:00.000Z' },
];
const payment = { id: 'p1', customerId: 'a', type: 'payment', amount: 8000, method: 'cash', at: '2026-09-15T00:00:00.000Z' };

test('balance, statement, and FIFO overdue allocation', () => {
  const entries = [...charges, payment];
  assert.equal(balanceOf(entries), 7000);
  const rows = statementRows(entries);
  assert.deepEqual(rows.map((row) => row.balance), [10000, 2000, 7000]);
  const now = new Date('2026-10-01T00:00:00.000Z');
  const allocated = allocateCharges(entries, now);
  assert.equal(allocated[0].remaining, 2000);
  assert.equal(allocated[0].overdue, true);
  assert.equal(allocated[1].remaining, 5000);
  assert.equal(allocated[1].overdue, false);
  assert.equal(overdueAmount(entries, now), 2000);
});

test('credit limit blocks a sale that would exceed the ceiling', () => {
  assert.throws(() => assertCredit({ balance: 8000, limit: 10000, add: 3000 }), /سقف الدين/);
  assert.equal(assertCredit({ balance: 8000, limit: 10000, add: 2000 }), 10000);
  assert.throws(() => assertCredit({ balance: 0, limit: null, add: 1000 }), /سقف الدين/);
});

test('portfolio totals outstanding and overdue customers', () => {
  const customers = [{ id: 'a', name: 'علي' }, { id: 'b', name: 'هدى' }];
  const entries = [
    ...charges,
    payment,
    { id: 'c3', customerId: 'b', type: 'charge', amount: 4000, at: '2026-09-01T00:00:00.000Z', dueAt: '2026-12-01T00:00:00.000Z' },
  ];
  const books = portfolio(customers, entries, new Date('2026-10-01T00:00:00.000Z'));
  assert.equal(books.outstanding, 11000);
  assert.equal(books.overdue, 2000);
  assert.equal(books.debtors, 2);
});

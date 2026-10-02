import test from 'node:test';
import assert from 'node:assert/strict';
import { isLowStock, receiveStock, releaseStock, restoreStock } from '../js/stock.js';

test('purchase updates stock and weighted average cost', () => {
  const first = receiveStock({ stock: 0, cost: 0 }, 10, 1000);
  assert.deepEqual(first, { stock: 10, cost: 1000 });
  const next = receiveStock({ stock: first.stock, cost: first.cost }, 10, 2000);
  assert.equal(next.stock, 20);
  assert.equal(next.cost, 1500);
});

test('a sale can take stock below zero and a return puts it back', () => {
  const sold = releaseStock({ stock: 2 }, 3);
  assert.equal(sold.stock, -1);
  assert.equal(sold.short, true);
  assert.equal(restoreStock({ stock: sold.stock }, 1).stock, 0);
});

test('low stock respects the threshold and untracked items', () => {
  assert.equal(isLowStock({ stock: 2, lowStock: 3, trackStock: true }), true);
  assert.equal(isLowStock({ stock: 2, lowStock: 3, trackStock: false }), false);
});

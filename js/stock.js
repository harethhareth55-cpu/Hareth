import { parseQty, roundQty, toIQD } from './money.js';

export const UNITS = {
  piece: 'قطعة',
  kg: 'كغم',
  g: 'غرام',
  l: 'لتر',
};

export function isWeighed(unit) {
  return unit === 'kg' || unit === 'g' || unit === 'l';
}

/** Weighted-average cost. A non-positive on-hand quantity takes the new cost as-is. */
export function receiveStock(product, qty, unitCost) {
  const incoming = parseQty(qty);
  const costIn = toIQD(unitCost);
  if (costIn < 0) throw new Error('سعر الكلفة غير صالح');
  const oldQty = roundQty(product.stock || 0);
  const oldCost = toIQD(product.cost || 0);
  const nextQty = roundQty(oldQty + incoming);
  let cost = costIn;
  if (oldQty > 0) {
    cost = Math.round((oldQty * oldCost + incoming * costIn) / nextQty);
  }
  return { stock: nextQty, cost };
}

export function releaseStock(product, qty) {
  const out = parseQty(qty);
  const oldQty = roundQty(product.stock || 0);
  return { stock: roundQty(oldQty - out), short: oldQty < out };
}

export function restoreStock(product, qty) {
  const back = parseQty(qty);
  return { stock: roundQty((Number(product.stock) || 0) + back) };
}

export function isLowStock(product) {
  if (product.trackStock === false || product.active === false) return false;
  const limit = product.lowStock == null ? 0 : Number(product.lowStock);
  return Number(product.stock || 0) <= limit;
}

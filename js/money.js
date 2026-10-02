'use strict';

export const IQD_SUFFIX = 'د.ع';

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXT_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeDigits(value) {
  return String(value)
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(EXT_ARABIC_INDIC.indexOf(d)));
}

export function cleanNumeric(value) {
  return normalizeDigits(value)
    .replace(/[,\s٬،]/g, '')
    .replace(/٫/g, '.')
    .trim();
}

export function toIQD(value) {
  if (value == null || value === '') throw new Error('المبلغ مطلوب');
  const n = typeof value === 'number' ? value : Number(cleanNumeric(value));
  if (!Number.isFinite(n)) throw new Error('المبلغ غير صالح');
  if (n < 0) throw new Error('المبلغ لا يكون سالب');
  if (Math.abs(n - Math.round(n)) > 1e-6) throw new Error('الدينار العراقي بدون كسور');
  if (n > 1_000_000_000_000) throw new Error('المبلغ كبير جدًا');
  return Math.round(n);
}

export function parseQty(value) {
  if (value == null || value === '') throw new Error('الكمية مطلوبة');
  const n = Number(cleanNumeric(value));
  if (!Number.isFinite(n) || n <= 0) throw new Error('الكمية غير صالحة');
  if (n > 100000) throw new Error('الكمية كبيرة جدًا');
  const rounded = Math.round(n * 1000) / 1000;
  if (Math.abs(n - rounded) > 1e-6) throw new Error('الكمية لحد ٣ خانات عشرية');
  return rounded;
}

export function lineAmount(qty, unitPrice) {
  return Math.round(parseQty(qty) * toIQD(unitPrice));
}

export function sumLines(lines) {
  if (!lines || lines.length === 0) return null;
  return lines.reduce((sum, line) => sum + lineAmount(line.qty, line.unitPrice), 0);
}

export function quoteOrder({ goodsTotal = 0, discount = 0, deliveryFee = 0, lines = [] } = {}) {
  const fromLines = sumLines(lines);
  const goods = fromLines == null ? toIQD(goodsTotal || 0) : fromLines;
  const discountIqd = toIQD(discount || 0);
  const fee = toIQD(deliveryFee || 0);
  if (discountIqd > goods) throw new Error('الخصم أكبر من قيمة البضاعة');
  const netGoods = goods - discountIqd;
  return {
    goodsTotal: goods,
    discount: discountIqd,
    deliveryFee: fee,
    netGoods,
    customerDue: netGoods + fee,
  };
}

/**
 * Cash split for one order.
 * Driver keeps the delivery fee only when the customer actually paid it.
 * Any shortfall is the driver's: the shop still expects its net goods.
 * Surplus over the amount due goes to the shop.
 * When the fee belongs to the shop, the driver hands over the full amount due.
 * Orders that are not delivered do not move cash.
 */
export function deliverySplit(order, feeBeneficiary = 'driver') {
  const quote = quoteOrder(order);
  if (feeBeneficiary !== 'driver' && feeBeneficiary !== 'shop') {
    throw new Error('جهة أجرة التوصيل غير معروفة');
  }
  if (order.status !== 'delivered') {
    return {
      ...quote,
      cashCollected: 0,
      expectedHandover: 0,
      driverShare: 0,
      shortage: 0,
      surplus: 0,
      inCustody: order.status === 'picked_up',
      countsAsCash: false,
    };
  }

  const collected = toIQD(order.cashCollected ?? 0);
  const gap = collected - quote.customerDue;
  const surplus = Math.max(gap, 0);
  const shortage = Math.max(-gap, 0);
  const expectedHandover = feeBeneficiary === 'shop'
    ? Math.max(quote.customerDue, collected)
    : quote.netGoods + surplus;
  const driverShare = Math.max(collected - expectedHandover, 0);

  return {
    ...quote,
    cashCollected: collected,
    expectedHandover,
    driverShare,
    shortage,
    surplus,
    inCustody: false,
    countsAsCash: true,
  };
}

export function formatIQD(amount, { signed = false } = {}) {
  const n = Math.round(Number(amount) || 0);
  const body = Math.abs(n).toLocaleString('en-US');
  const sign = n < 0 ? '−' : signed && n > 0 ? '+' : '';
  return `${sign}${body} ${IQD_SUFFIX}`;
}

export function differenceLabel(diff) {
  const n = Math.round(Number(diff) || 0);
  if (n < 0) return { key: 'short', label: 'نقص' };
  if (n > 0) return { key: 'over', label: 'زيادة' };
  return { key: 'even', label: 'مطابق' };
}

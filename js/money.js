/** Whole Iraqi dinars. Quantities may be fractional (weighed goods). */

export function toIQD(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('المبلغ غير صالح');
    return Math.round(value);
  }
  let text = String(value ?? '').trim();
  if (!text) return 0;
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  text = text.replace(/[٠-٩]/g, (d) => String(arabic.indexOf(d)));
  text = text.replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)));
  text = text.replace(/[,\s٬]/g, '').replace(/٫/g, '.');
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error('المبلغ غير صالح');
  return Math.round(Number(text));
}

export function roundQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('الكمية غير صالحة');
  return Math.round(n * 1000) / 1000;
}

export function parseQty(value) {
  let text = String(value ?? '').trim();
  if (!text) throw new Error('أدخل الكمية');
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  text = text.replace(/[٠-٩]/g, (d) => String(arabic.indexOf(d)));
  text = text.replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)));
  text = text.replace(/[,\s٬]/g, '').replace(/٫/g, '.');
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) throw new Error('الكمية يجب أن تكون أكبر من صفر');
  return roundQty(n);
}

export function lineGross(qty, unitPrice) {
  return Math.round(roundQty(qty) * toIQD(unitPrice));
}

export function refundLine(line, qty) {
  const sold = roundQty(line.qty);
  const already = roundQty(line.returnedQty || 0);
  const q = parseQty(qty);
  const left = roundQty(sold - already);
  if (q > left + 0.0001) throw new Error('الكمية المرتجعة أكبر من المتبقي');
  const net = sold ? toIQD(line.total) / sold : 0;
  const cost = sold ? toIQD(line.costTotal || 0) / sold : 0;
  return { qty: q, total: Math.round(q * net), cost: Math.round(q * cost) };
}

export function priceLines(lines, invoiceDiscount = 0) {
  if (!lines.length) throw new Error('السلة فارغة');
  const priced = lines.map((line) => {
    const qty = parseQty(line.qty);
    const unitPrice = toIQD(line.unitPrice);
    if (unitPrice < 0) throw new Error('السعر غير صالح');
    const gross = lineGross(qty, unitPrice);
    const discount = toIQD(line.discount || 0);
    if (discount < 0 || discount > gross) throw new Error('خصم الصنف غير صالح');
    const total = gross - discount;
    const cost = toIQD(line.cost || 0);
    const costTotal = Math.round(qty * cost);
    return { ...line, qty, unitPrice, discount, gross, total, cost, costTotal, profit: total - costTotal };
  });
  const subtotal = priced.reduce((sum, line) => sum + line.total, 0);
  const discount = toIQD(invoiceDiscount || 0);
  if (discount < 0 || discount > subtotal) throw new Error('خصم الفاتورة غير صالح');
  const total = subtotal - discount;
  const cost = priced.reduce((sum, line) => sum + line.costTotal, 0);
  return { lines: priced, subtotal, invoiceDiscount: discount, total, cost, profit: total - cost };
}

/**
 * tendered = cash the customer handed over.
 * card and onAccount are amounts applied to the bill, not tendered cash.
 */
export function settlePayment({ total, tendered = 0, card = 0, onAccount = 0 }) {
  const due = toIQD(total);
  const cardAmt = toIQD(card || 0);
  const debt = toIQD(onAccount || 0);
  if (cardAmt < 0 || debt < 0) throw new Error('المبلغ غير صالح');
  if (cardAmt + debt > due) throw new Error('المدفوع أكبر من قيمة الفاتورة');
  const cash = due - cardAmt - debt;
  const given = toIQD(tendered || 0);
  if (given < cash) throw new Error('النقد المستلم أقل من المطلوب');
  return { total: due, cash, card: cardAmt, debt, tendered: given, change: given - cash };
}

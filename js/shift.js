import { toIQD } from './money.js';

export function cashFromSale(sale) {
  if (!sale || sale.status !== 'completed') return 0;
  return (sale.payments || []).reduce((sum, payment) => sum + (payment.method === 'cash' ? toIQD(payment.amount) : 0), 0);
}

export function expectedDrawer({ opening = 0, sales = [], returns = [], debtPayments = [], purchases = [] }) {
  const cashSales = sales.reduce((sum, sale) => sum + cashFromSale(sale), 0);
  const cashRefunds = returns.reduce((sum, row) => sum + (row.method === 'cash' ? toIQD(row.total) : 0), 0);
  const collected = debtPayments.reduce((sum, entry) => sum + (entry.method === 'cash' ? toIQD(entry.amount) : 0), 0);
  const paidOut = purchases.reduce((sum, row) => sum + (row.paidCash ? toIQD(row.total) : 0), 0);
  return toIQD(opening) + cashSales + collected - cashRefunds - paidOut;
}

export function closeShift({ opening, counted, sales, returns, debtPayments, purchases }) {
  const expected = expectedDrawer({ opening, sales, returns, debtPayments, purchases });
  const actual = toIQD(counted);
  if (actual < 0) throw new Error('النقد المعدود غير صالح');
  return { expected, counted: actual, difference: actual - expected };
}

import { toIQD } from './money.js';
import { balanceOf, overdueAmount, portfolio } from './debt.js';
import { cashFromSale } from './shift.js';

function inRange(at, from, to) {
  const value = String(at || '');
  return value >= from && value <= to;
}

export function summarizePeriod({ sales = [], returns = [], entries = [], purchases = [], customers = [], from, to, now = new Date() }) {
  const done = sales.filter((sale) => sale.status === 'completed' && inRange(sale.at, from, to));
  const backs = returns.filter((row) => inRange(row.at, from, to));
  const gross = done.reduce((sum, sale) => sum + toIQD(sale.subtotal), 0);
  const discounts = done.reduce((sum, sale) => sum + toIQD(sale.invoiceDiscount) + (sale.lines || []).reduce((s, line) => s + toIQD(line.discount), 0), 0);
  const salesTotal = done.reduce((sum, sale) => sum + toIQD(sale.total), 0);
  const returnsTotal = backs.reduce((sum, row) => sum + toIQD(row.total), 0);
  const net = salesTotal - returnsTotal;
  const cogs = done.reduce((sum, sale) => sum + toIQD(sale.cost), 0) - backs.reduce((sum, row) => sum + toIQD(row.cost || 0), 0);
  const cash = done.reduce((sum, sale) => sum + cashFromSale(sale), 0) - backs.filter((row) => row.method === 'cash').reduce((sum, row) => sum + toIQD(row.total), 0);
  const card = done.reduce((sum, sale) => sum + (sale.payments || []).reduce((s, p) => s + (p.method === 'card' ? toIQD(p.amount) : 0), 0), 0);
  const credit = done.reduce((sum, sale) => sum + toIQD(sale.debt || 0), 0);
  const debtCollected = entries
    .filter((entry) => entry.type === 'payment' && entry.method === 'cash' && inRange(entry.at, from, to))
    .reduce((sum, entry) => sum + toIQD(entry.amount), 0);
  const purchaseTotal = purchases.filter((row) => inRange(row.at, from, to)).reduce((sum, row) => sum + toIQD(row.total), 0);

  const byCategory = new Map();
  for (const sale of done) {
    for (const line of sale.lines || []) {
      const key = line.categoryName || 'بدون تصنيف';
      byCategory.set(key, (byCategory.get(key) || 0) + toIQD(line.total));
    }
  }

  const byProduct = new Map();
  for (const sale of done) {
    for (const line of sale.lines || []) {
      const key = line.productId || line.name;
      const row = byProduct.get(key) || { name: line.name, qty: 0, total: 0 };
      row.qty += Number(line.qty) || 0;
      row.total += toIQD(line.total);
      byProduct.set(key, row);
    }
  }
  const bestSellers = [...byProduct.values()].sort((a, b) => b.total - a.total).slice(0, 8);

  const books = portfolio(customers, entries, now);
  return {
    invoices: done.length,
    gross,
    discounts,
    salesTotal,
    returnsTotal,
    net,
    cogs,
    profit: net - cogs,
    cash,
    card,
    credit,
    debtCollected,
    purchaseTotal,
    byCategory: [...byCategory.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
    bestSellers,
    outstanding: books.outstanding,
    overdue: books.overdue,
    debtors: books.debtors,
  };
}

export function customerSnapshot(customer, entries, now = new Date()) {
  return {
    customer,
    balance: balanceOf(entries),
    overdue: overdueAmount(entries, now),
  };
}

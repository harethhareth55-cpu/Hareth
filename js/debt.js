import { toIQD } from './money.js';

export function entryEffect(entry) {
  const amount = toIQD(entry.amount);
  if (entry.type === 'charge') return amount;
  if (entry.type === 'payment') return -amount;
  if (entry.type === 'adjustment') return amount;
  throw new Error('حركة دين غير معروفة');
}

export function balanceOf(entries) {
  return entries.reduce((sum, entry) => sum + entryEffect(entry), 0);
}

export function statementRows(entries) {
  const sorted = [...entries].sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id)));
  let balance = 0;
  return sorted.map((entry) => {
    const effect = entryEffect(entry);
    balance += effect;
    return { ...entry, effect, balance };
  });
}

/**
 * Payments (and negative adjustments) clear the oldest charges first.
 * A charge with a remaining balance past its due date is overdue.
 */
export function allocateCharges(entries, now = new Date()) {
  const charges = entries
    .filter((entry) => entry.type === 'charge' || (entry.type === 'adjustment' && toIQD(entry.amount) > 0))
    .map((entry) => ({
      id: entry.id,
      amount: Math.abs(toIQD(entry.amount)),
      dueAt: entry.dueAt || null,
      at: entry.at,
      remaining: Math.abs(toIQD(entry.amount)),
    }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id)));

  let pool = entries.reduce((sum, entry) => {
    if (entry.type === 'payment') return sum + toIQD(entry.amount);
    if (entry.type === 'adjustment' && toIQD(entry.amount) < 0) return sum + Math.abs(toIQD(entry.amount));
    return sum;
  }, 0);

  for (const charge of charges) {
    const applied = Math.min(charge.remaining, pool);
    charge.remaining -= applied;
    pool -= applied;
  }

  const today = now instanceof Date ? now.toISOString() : String(now);
  return charges.map((charge) => ({
    ...charge,
    overdue: charge.remaining > 0 && !!charge.dueAt && String(charge.dueAt) < today,
  }));
}

export function overdueAmount(entries, now = new Date()) {
  return allocateCharges(entries, now)
    .filter((charge) => charge.overdue)
    .reduce((sum, charge) => sum + charge.remaining, 0);
}

export function assertCredit({ balance, limit, add }) {
  const next = toIQD(balance) + toIQD(add);
  if (toIQD(add) <= 0) return next;
  if (limit == null || limit === '') throw new Error('حدد سقف الدين لهذا الزبون قبل البيع الآجل');
  const cap = toIQD(limit);
  if (next > cap) throw new Error('المبلغ يتجاوز سقف الدين');
  return next;
}

export function portfolio(customers, entries, now = new Date()) {
  const byCustomer = new Map();
  for (const entry of entries) {
    if (!byCustomer.has(entry.customerId)) byCustomer.set(entry.customerId, []);
    byCustomer.get(entry.customerId).push(entry);
  }
  const rows = customers.map((customer) => {
    const list = byCustomer.get(customer.id) || [];
    const balance = balanceOf(list);
    const overdue = overdueAmount(list, now);
    return { customer, balance, overdue };
  });
  return {
    rows,
    outstanding: rows.reduce((sum, row) => sum + Math.max(0, row.balance), 0),
    overdue: rows.reduce((sum, row) => sum + row.overdue, 0),
    debtors: rows.filter((row) => row.balance > 0).length,
  };
}

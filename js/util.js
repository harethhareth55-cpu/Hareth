export function uid(prefix) {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const rand = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function normalizeDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

export async function hashPin(pin, salt) {
  const clean = normalizeDigits(pin).replace(/\D/g, '');
  if (!/^\d{4,6}$/.test(clean)) throw new Error('الرمز من 4 إلى 6 أرقام');
  const data = new TextEncoder().encode(`${salt}:${clean}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { pinHash: hex, salt, pin: clean };
}

export async function checkPin(pin, cashier) {
  const { pinHash } = await hashPin(pin, cashier.salt);
  return pinHash === cashier.pinHash;
}

export function baghdadDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function addBaghdadDays(days, from = new Date()) {
  const key = baghdadDateKey(from);
  const base = new Date(`${key}T12:00:00+03:00`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
}

export function whatsAppPhone(phone) {
  const digits = normalizeDigits(phone).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('964')) return digits;
  if (digits.startsWith('0')) return `964${digits.slice(1)}`;
  return digits;
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function permissionsFor(cashier) {
  const owner = cashier?.role === 'owner';
  const base = {
    sell: true,
    discount: owner,
    editPrice: owner,
    returnSale: true,
    voidSale: owner,
    products: owner,
    stock: owner,
    debts: true,
    reports: owner,
    profit: owner,
    settings: owner,
    cashiers: owner,
  };
  const extra = cashier?.perms || {};
  if (owner) return base;
  for (const key of ['discount', 'returnSale', 'debts']) {
    if (typeof extra[key] === 'boolean') base[key] = extra[key];
  }
  return base;
}

const iqd = new Intl.NumberFormat('ar-IQ');

export function formatIQD(value) {
  const n = Math.round(Number(value) || 0);
  return `${iqd.format(n)} د.ع`;
}

export function formatQty(value, unitLabel = '') {
  const n = Number(value) || 0;
  const text = Number.isInteger(n) ? iqd.format(n) : iqd.format(n);
  return unitLabel ? `${text} ${unitLabel}` : text;
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-IQ', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-IQ', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

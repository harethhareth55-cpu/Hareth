'use strict';

export function formatWhen(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-IQ-u-nu-latn', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDay(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-IQ-u-nu-latn', {
    timeZone: 'Asia/Baghdad',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function orderNo(number) {
  return `#${String(number || 0).padStart(4, '0')}`;
}

export const STATUS_META = {
  new: { label: 'جديد', cls: 'st-new' },
  picked_up: { label: 'عند المندوب', cls: 'st-out' },
  delivered: { label: 'تم التسليم', cls: 'st-ok' },
  returned: { label: 'مرتجع', cls: 'st-back' },
  cancelled: { label: 'ملغى', cls: 'st-off' },
};

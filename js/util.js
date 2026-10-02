'use strict';

export function randomToken() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function uid(prefix) {
  return `${prefix}_${randomToken()}`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

export function userMessage(err) {
  const msg = err && err.message ? String(err.message) : '';
  if (/[\u0600-\u06FF]/.test(msg)) return msg;
  return 'صار خطأ غير متوقع. حاول مرة ثانية.';
}

export function assertOwner(actor) {
  if (!actor || actor.role !== 'owner') {
    throw new Error('هذا الإجراء لصاحب المحل فقط');
  }
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ed25519 activation codes. The private key never ships in the page. */

export const PUBLIC_KEY_B64URL = 'KMGNJ9FoOOFL1DoIpihe4y-Qck0adoFVgFEVYiJH5j8';
export const TRIAL_DAYS = 14;

function b64urlToBytes(value) {
  const pad = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = pad + '='.repeat((4 - (pad.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToB64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function importPublicKey(b64url = PUBLIC_KEY_B64URL) {
  return crypto.subtle.importKey('raw', b64urlToBytes(b64url), { name: 'Ed25519' }, false, ['verify']);
}

export async function verifyLicense(code, publicKeyB64 = PUBLIC_KEY_B64URL, now = new Date()) {
  const parts = String(code || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'KSH1') throw new Error('رمز التفعيل غير صحيح');
  let payloadBytes;
  let signature;
  try {
    payloadBytes = b64urlToBytes(parts[1]);
    signature = b64urlToBytes(parts[2]);
  } catch {
    throw new Error('رمز التفعيل غير صحيح');
  }
  const key = await importPublicKey(publicKeyB64);
  const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, payloadBytes);
  if (!ok) throw new Error('رمز التفعيل غير صحيح');
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    throw new Error('رمز التفعيل غير صحيح');
  }
  if (payload.v !== 1) throw new Error('رمز التفعيل غير مدعوم');
  if (payload.exp && new Date(payload.exp).getTime() < now.getTime()) throw new Error('انتهت صلاحية التفعيل');
  return payload;
}

export function trialEndsAt(startedAt, days = TRIAL_DAYS) {
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

export function trialDaysLeft(startedAt, now = new Date(), days = TRIAL_DAYS) {
  const end = trialEndsAt(startedAt, days);
  if (!end) return 0;
  return Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

export async function accessState(shop, now = new Date()) {
  if (shop?.licenseCode) {
    try {
      const payload = await verifyLicense(shop.licenseCode, PUBLIC_KEY_B64URL, now);
      return { ok: true, mode: 'license', payload, daysLeft: null };
    } catch (error) {
      return { ok: false, mode: 'license', message: error.message };
    }
  }
  const left = trialDaysLeft(shop?.createdAt, now);
  if (left > 0) return { ok: true, mode: 'trial', daysLeft: left, payload: null };
  return { ok: false, mode: 'trial', message: 'انتهت الفترة التجريبية. أدخل رمز التفعيل.' };
}

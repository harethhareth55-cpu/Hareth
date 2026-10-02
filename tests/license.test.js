import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, generateKeyPairSync, sign } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { PUBLIC_KEY_B64URL, accessState, trialDaysLeft, verifyLicense } from '../js/license.js';

function issue(payload, privateKey) {
  const body = Buffer.from(JSON.stringify(payload));
  const signature = sign(null, body, privateKey);
  const b64 = (buf) => Buffer.from(buf).toString('base64url');
  return `KSH1.${b64(body)}.${b64(signature)}`;
}

test('accepts a signed code and rejects a tampered one', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'jwk' }).x;
  const code = issue({ v: 1, plan: 'year', exp: '2027-10-02T20:59:59.000Z' }, privateKey);
  const payload = await verifyLicense(code, pub, new Date('2026-10-02T00:00:00.000Z'));
  assert.equal(payload.plan, 'year');
  await assert.rejects(() => verifyLicense(`${code}x`, pub), /غير صحيح/);
});

test('the shipped public key matches the local private key', { skip: !existsSync(new URL('../scripts/license-private.pem', import.meta.url)) }, async () => {
  const key = createPrivateKey(readFileSync(new URL('../scripts/license-private.pem', import.meta.url)));
  const code = issue({ v: 1, plan: 'life', exp: null }, key);
  const payload = await verifyLicense(code, PUBLIC_KEY_B64URL, new Date('2026-10-02T00:00:00.000Z'));
  assert.equal(payload.plan, 'life');
});

test('an expired code and an ended trial both lock the register', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'jwk' }).x;
  const code = issue({ v: 1, plan: 'month', exp: '2026-01-01T00:00:00.000Z' }, privateKey);
  await assert.rejects(() => verifyLicense(code, pub, new Date('2026-10-02T00:00:00.000Z')), /انتهت صلاحية/);
  const started = new Date('2026-09-01T00:00:00.000Z').toISOString();
  assert.equal(trialDaysLeft(started, new Date('2026-09-10T00:00:00.000Z')), 5);
  const locked = await accessState({ createdAt: started }, new Date('2026-10-02T00:00:00.000Z'));
  assert.equal(locked.ok, false);
  const open = await accessState({ createdAt: new Date().toISOString() });
  assert.equal(open.ok, true);
  assert.equal(open.mode, 'trial');
});

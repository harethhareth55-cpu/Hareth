import { createPrivateKey, sign } from 'crypto';
import { readFileSync } from 'fs';

const pemPath = new URL('./license-private.pem', import.meta.url);
const plan = process.argv[2] || 'year';
const expArg = process.argv[3] || '';

if (!['month', 'year', 'life'].includes(plan)) {
  console.error('Usage: node scripts/issue-license.mjs <month|year|life> [YYYY-MM-DD]');
  process.exit(1);
}

let exp = null;
if (plan !== 'life') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expArg)) {
    console.error('Give an expiry date: node scripts/issue-license.mjs year 2027-10-02');
    process.exit(1);
  }
  exp = new Date(`${expArg}T23:59:59+03:00`).toISOString();
}

const key = createPrivateKey(readFileSync(pemPath));
const payload = Buffer.from(JSON.stringify({ v: 1, plan, exp }));
const signature = sign(null, payload, key);
const b64 = (buf) => Buffer.from(buf).toString('base64url');
console.log(`KSH1.${b64(payload)}.${b64(signature)}`);

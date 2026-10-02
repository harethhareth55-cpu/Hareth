import { generateKeyPairSync } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const x = publicKey.export({ format: 'jwk' }).x;
writeFileSync(new URL('./license-private.pem', import.meta.url), privateKey.export({ type: 'pkcs8', format: 'pem' }));
const file = new URL('../js/license.js', import.meta.url);
const source = readFileSync(file, 'utf8');
if (!source.includes('PUBLIC_KEY_B64URL = ')) throw new Error('license.js is missing PUBLIC_KEY_B64URL');
writeFileSync(file, source.replace(/PUBLIC_KEY_B64URL = '[^']+'/, `PUBLIC_KEY_B64URL = '${x}'`));
console.log('Updated js/license.js. Keep scripts/license-private.pem off the internet.');

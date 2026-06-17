/**
 * crypto-interop-test.js — Compatibilità Node ↔ Web Crypto (formato WFENC1)
 * Uso: node scripts/crypto-interop-test.js
 */

const crypto = require('crypto');
const photoCrypto = require('../server/services/photoCrypto');

let pass = 0, fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

// Simula il layout Web Crypto: ct include il tag GCM in coda
function webCryptoEncrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ctWithTag = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([Buffer.from('WFENC1'), iv, ctWithTag]);
}

function webCryptoDecrypt(blob, key) {
  const iv = blob.subarray(6, 18);
  const body = blob.subarray(18); // ct + tag (Web Crypto style)
  const tag = body.subarray(body.length - 16);
  const ct = body.subarray(0, body.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

console.log('\n— Interop Node → Web-style decrypt —');
const key = photoCrypto.generateTripKey();
const plain = Buffer.from('test immagine jpeg fake');
const nodeBlob = photoCrypto.encryptBuffer(plain, key);
let ok = false;
try {
  const back = webCryptoDecrypt(nodeBlob, key);
  ok = back.equals(plain);
} catch (e) { ok = false; }
check('Node cifra, Web-style decifra', ok);

console.log('\n— Interop Web-style → Node decrypt —');
const webBlob = webCryptoEncrypt(plain, key);
let ok2 = false;
try {
  const back = photoCrypto.decryptBuffer(webBlob, key);
  ok2 = back.equals(plain);
} catch (e) { ok2 = false; }
check('Web-style cifra, Node decifra', ok2);

console.log('\n— Blob troppo corto —');
let shortOk = false;
try {
  photoCrypto.decryptBuffer(Buffer.from('WFENC1'), key);
} catch { shortOk = true; }
check('Blob minimo (< 34 byte) rifiutato', shortOk);

console.log('\n— Magic spoof (JPEG + prefisso WFENC1) —');
const fakeEnc = Buffer.concat([Buffer.from('WFENC1'), Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(20)]);
check('isEncrypted rileva solo il prefisso', photoCrypto.isEncrypted(fakeEnc));
let spoofDecrypt = false;
try {
  photoCrypto.decryptBuffer(fakeEnc, key);
} catch { spoofDecrypt = true; }
check('Spoof non decifrabile (GCM fallisce)', spoofDecrypt);

console.log(`\n═══ Risultato: ${pass} passati, ${fail} falliti ═══`);
process.exit(fail ? 1 : 0);

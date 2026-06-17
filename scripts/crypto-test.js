/**
 * crypto-test.js — Test unitari del formato WFENC1 (server)
 * Uso: node scripts/crypto-test.js
 * Non richiede il server attivo.
 */

const crypto = require('crypto');
const photoCrypto = require('../server/services/photoCrypto');

let pass = 0, fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

console.log('\n— Round-trip encrypt/decrypt —');
const key = photoCrypto.generateTripKey();
check('generateTripKey → 32 byte', key.length === 32);

const plain = crypto.randomBytes(4096);
const blob = photoCrypto.encryptBuffer(plain, key);
check('Cifrato inizia col magic WFENC1', photoCrypto.isEncrypted(blob));
check('Cifrato diverso dal chiaro', !blob.subarray(6).equals(plain));

const back = photoCrypto.decryptBuffer(blob, key);
check('Decifrato == originale', back.equals(plain));

console.log('\n— Chiave errata —');
let threw = false;
try { photoCrypto.decryptBuffer(blob, photoCrypto.generateTripKey()); } catch { threw = true; }
check('Decifratura con chiave sbagliata fallisce', threw);

console.log('\n— Manomissione (tamper) —');
const tampered = Buffer.from(blob);
tampered[tampered.length - 1] ^= 0xFF;
let threw2 = false;
try { photoCrypto.decryptBuffer(tampered, key); } catch { threw2 = true; }
check('Tag GCM rileva la manomissione', threw2);

console.log('\n— Escrow wrap/unwrap —');
if (photoCrypto.escrowAvailable()) {
  const wrapped = photoCrypto.wrapTripKey(key);
  const unwrapped = photoCrypto.unwrapTripKey(wrapped);
  check('unwrap(wrap(key)) == key', unwrapped.equals(key));
} else {
  console.log('  · PHOTO_BOT_ESCROW_KEY non configurata: test escrow saltato');
}

console.log(`\n═══ Risultato: ${pass} passati, ${fail} falliti ═══`);
process.exit(fail ? 1 : 0);

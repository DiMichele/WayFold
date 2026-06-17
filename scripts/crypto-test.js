/**
 * crypto-test.js — Test formato WFENC1 (validazione server)
 * Uso: node scripts/crypto-test.js
 */

const photoCrypto = require('../server/services/photoCrypto');

let pass = 0, fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

console.log('\n— Validazione magic WFENC1 —');
const magic = Buffer.concat([Buffer.from('WFENC1'), Buffer.alloc(20)]);
check('isEncrypted rileva WFENC1', photoCrypto.isEncrypted(magic));
check('Plaintext non rilevato come cifrato', !photoCrypto.isEncrypted(Buffer.from([0xFF, 0xD8, 0xFF])));
check('Buffer corto non cifrato', !photoCrypto.isEncrypted(Buffer.from('WF')));

console.log(`\n═══ Risultato: ${pass} passati, ${fail} falliti ═══`);
console.log('  · Cifratura E2E: chiavi e AES-GCM gestiti solo nel browser.');
process.exit(fail ? 1 : 0);

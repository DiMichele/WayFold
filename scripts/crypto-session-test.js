/**
 * crypto-session-test.js — Verifica flusso login → persistDeviceSession (exportKey)
 * Uso: node scripts/crypto-session-test.js
 *
 * Riprodice il bug "key is not extractable": la chiave privata importata al login
 * deve essere esportabile per salvare la sessione nel vault locale.
 */

let pass = 0;
let fail = 0;

function check(name, ok, extra = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

/** Come userKeys.js loadSessionFromPassword (post-fix: extractable true). */
async function importPrivateKeyLikeLogin(privateKeyRaw, extractable) {
  return crypto.subtle.importKey(
    'pkcs8',
    privateKeyRaw,
    { name: 'X25519' },
    extractable,
    ['deriveKey', 'deriveBits'],
  );
}

/** Come deviceVault.js persistDeviceSession. */
async function exportPrivateKeyLikePersist(privateKey) {
  return crypto.subtle.exportKey('pkcs8', privateKey);
}

async function run() {
  console.log('\n— Sessione E2E: exportKey dopo import (login / deviceVault) —');

  const pair = await crypto.subtle.generateKey(
    { name: 'X25519' },
    true,
    ['deriveKey', 'deriveBits'],
  );
  const privateKeyRaw = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));

  let threw = false;
  try {
    const locked = await importPrivateKeyLikeLogin(privateKeyRaw, false);
    await exportPrivateKeyLikePersist(locked);
  } catch (e) {
    threw = e instanceof Error && e.message.includes('not extractable');
  }
  check('import non-estraibile → exportKey fallisce (regressione)', threw);

  let exportOk = false;
  try {
    const unlocked = await importPrivateKeyLikeLogin(privateKeyRaw, true);
    const out = await exportPrivateKeyLikePersist(unlocked);
    exportOk = out instanceof ArrayBuffer && out.byteLength > 0;
  } catch {
    exportOk = false;
  }
  check('import estraibile (fix) → exportKey per deviceVault ok', exportOk);

  console.log(`\n═══ Risultato: ${pass} passati, ${fail} falliti ═══`);
  process.exit(fail ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

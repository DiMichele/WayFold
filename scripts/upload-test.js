/**
 * upload-test.js — Test end-to-end upload foto (web → Telegram → DB → serve)
 * Uso: node scripts/upload-test.js
 * Richiede il server attivo su localhost (npm run server).
 */

const fs = require('fs');
const config = require('../server/config');
const photoCrypto = require('../server/services/photoCrypto');

const BASE = `http://localhost:${config.PORT}`;
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let pass = 0;
let fail = 0;

function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

function client() {
  let cookie = '';
  return {
    async req(method, p, { body, headers = {}, raw } = {}) {
      const res = await fetch(BASE + p, {
        method,
        headers: {
          ...(body && !raw ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        body: raw ? body : (body ? JSON.stringify(body) : undefined),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      let json = null;
      try { json = await res.clone().json(); } catch { /* non json */ }
      return { status: res.status, json };
    },
    async bytes(p) {
      const res = await fetch(BASE + p, { headers: cookie ? { Cookie: cookie } : {} });
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, buf, contentType: res.headers.get('content-type') || '' };
    },
  };
}

function verifyUserEmailInDb(username) {
  const dbPath = config.DB_PATH;
  if (!fs.existsSync(dbPath)) return;
  const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const user = data.users?.find(u => u.username === username);
  if (!user || user.emailVerified) return;
  user.emailVerified = true;
  user.emailVerifyCodeHash = null;
  user.emailVerifyExpiresAt = null;
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

async function ensureTrip(c) {
  const trips = await c.req('GET', '/api/trips');
  let trip = (trips.json || []).find(t => t.linked && t.isOwner);
  if (trip) return trip;

  const created = await c.req('POST', '/api/trips', { body: { dest: 'Upload E2E', year: 2026 } });
  if (created.status === 201) return created.json;
  return null;
}

async function uploadBlob(c, tripId, blob, name) {
  const fd = new FormData();
  fd.append('photos', blob, name);
  return c.req('POST', `/api/trips/${tripId}/photos`, { body: fd, raw: true });
}

async function getTripKeyBuf(c, tripId) {
  const keyRes = await c.req('GET', `/api/trips/${tripId}/crypto-key`);
  if (keyRes.status !== 200 || !keyRes.json?.key) return null;
  return Buffer.from(keyRes.json.key, 'base64');
}

async function uploadEncrypted(c, tripId, plainBuf, tripKey, name = 'photo.wfenc') {
  const encBlob = photoCrypto.encryptBuffer(plainBuf, tripKey);
  const fd = new FormData();
  fd.append('photos', new Blob([encBlob], { type: 'application/octet-stream' }), name);
  fd.append('encrypted', '1');
  fd.append('meta', JSON.stringify([{ originalMime: 'image/png', originalExt: 'png' }]));
  return c.req('POST', `/api/trips/${tripId}/photos`, { body: fd, raw: true });
}

async function main() {
  console.log('\n— Login test user —');
  const c = client();
  const uname = 'testuser_upload_e2e';
  const upass = 'password-sicura-1';

  let auth = await c.req('POST', '/api/auth/register', {
    body: { username: uname, password: upass, email: `${uname}@test.local` },
  });
  if (auth.status === 409 || auth.status === 429) {
    auth = await c.req('POST', '/api/auth/login', { body: { username: uname, password: upass } });
  } else if (auth.status === 201 && auth.json?.emailVerified === false) {
    verifyUserEmailInDb(uname);
    auth = await c.req('POST', '/api/auth/login', { body: { username: uname, password: upass } });
  }
  check('Login → 200', auth.status === 200, `got ${auth.status}`);

  const trip = await ensureTrip(c);
  check('Viaggio collegato a Telegram', Boolean(trip?.linked), trip ? '' : 'creazione fallita');
  if (!trip) {
    console.log(`\n═══ Risultato: ${pass} passati, ${fail} falliti ═══`);
    process.exit(1);
  }

  console.log('\n— Upload PNG valido —');
  const tripKey = await getTripKeyBuf(c, trip.id);
  let saved;
  if (tripKey) {
    const ok = await uploadEncrypted(c, trip.id, PNG_1X1, tripKey, 'pixel.wfenc');
    check('POST /photos cifrato → 201', ok.status === 201, `got ${ok.status} ${JSON.stringify(ok.json)}`);
    saved = ok.json?.photos?.[0];
    const bypass = await uploadBlob(c, trip.id, new Blob([PNG_1X1], { type: 'image/png' }), 'bypass.png');
    check('Upload in chiaro respinto → 415', bypass.status === 415, `got ${bypass.status}`);
  } else {
    const ok = await uploadBlob(c, trip.id, new Blob([PNG_1X1], { type: 'image/png' }), 'pixel.png');
    check('POST /photos → 201', ok.status === 201, `got ${ok.status} ${JSON.stringify(ok.json)}`);
    saved = ok.json?.photos?.[0];
  }
  check('Risposta contiene url foto', Boolean(saved?.url));

  const list = await c.req('GET', `/api/trips/${trip.id}/photos`);
  check('GET /photos elenca la nuova foto', (list.json || []).some(p => p.id === saved?.id));

  console.log('\n— Upload batch (2 file) —');
  if (tripKey) {
    const fd = new FormData();
    for (const n of ['a.wfenc', 'b.wfenc']) {
      const enc = photoCrypto.encryptBuffer(PNG_1X1, tripKey);
      fd.append('photos', new Blob([enc], { type: 'application/octet-stream' }), n);
    }
    fd.append('encrypted', '1');
    fd.append('meta', JSON.stringify([
      { originalMime: 'image/png', originalExt: 'png' },
      { originalMime: 'image/png', originalExt: 'png' },
    ]));
    const batch = await c.req('POST', `/api/trips/${trip.id}/photos`, { body: fd, raw: true });
    check('Batch cifrato → 201', batch.status === 201, `got ${batch.status}`);
    check('Batch salva 2 foto', (batch.json?.photos || []).length === 2);
  } else {
    const fd = new FormData();
    fd.append('photos', new Blob([PNG_1X1], { type: 'image/png' }), 'a.png');
    fd.append('photos', new Blob([PNG_1X1], { type: 'image/png' }), 'b.png');
    const batch = await c.req('POST', `/api/trips/${trip.id}/photos`, { body: fd, raw: true });
    check('Batch → 201', batch.status === 201, `got ${batch.status}`);
    check('Batch salva 2 foto', (batch.json?.photos || []).length === 2);
  }

  console.log('\n— Upload senza MIME (simula iOS) —');
  if (tripKey) {
    const noMime = await uploadEncrypted(c, trip.id, PNG_1X1, tripKey, 'ios-photo.wfenc');
    check('Upload cifrato senza type client → 201', noMime.status === 201, `got ${noMime.status}`);
  } else {
    const noMime = await uploadBlob(c, trip.id, new Blob([PNG_1X1]), 'ios-photo.jpg');
    check('Blob senza type accettato → 201', noMime.status === 201, `got ${noMime.status}`);
  }

  console.log('\n— Upload rifiutato (non immagine) —');
  const bad = await uploadBlob(
    c, trip.id, new Blob([Buffer.from('testo')], { type: 'image/jpeg' }), 'fake.jpg'
  );
  check('File non immagine → 4xx/5xx', bad.status >= 400, `got ${bad.status}`);

  console.log('\n— Serve immagine autenticata —');
  if (saved?.url) {
    const raw = await c.req('GET', saved.url);
    check('GET /photos/... → 200', raw.status === 200, `got ${raw.status}`);
  }

  console.log('\n— Upload cifrato (round-trip) —');
  const keyRes = await c.req('GET', `/api/trips/${trip.id}/crypto-key`);
  if (keyRes.status === 200 && keyRes.json?.key) {
    const tripKey = Buffer.from(keyRes.json.key, 'base64');
    const encBlob = photoCrypto.encryptBuffer(PNG_1X1, tripKey);
    const fdEnc = new FormData();
    fdEnc.append('photos', new Blob([encBlob], { type: 'application/octet-stream' }), 'photo_0.wfenc');
    fdEnc.append('encrypted', '1');
    fdEnc.append('meta', JSON.stringify([{ originalMime: 'image/png', originalExt: 'png', date: Math.floor(Date.now() / 1000) }]));
    const enc = await c.req('POST', `/api/trips/${trip.id}/photos`, { body: fdEnc, raw: true });
    check('Upload cifrato → 201', enc.status === 201, `got ${enc.status} ${JSON.stringify(enc.json)}`);
    const encPhoto = enc.json?.photos?.[0];
    check('Foto marcata encrypted', encPhoto?.encrypted === true);

    if (encPhoto?.url) {
      const served = await c.bytes(encPhoto.url);
      check('Byte serviti iniziano col magic WFENC1', photoCrypto.isEncrypted(served.buf));
      check('Byte serviti NON sono un PNG in chiaro',
        !(served.buf[0] === 0x89 && served.buf[1] === 0x50));
      try {
        const plain = photoCrypto.decryptBuffer(served.buf, tripKey);
        check('Decifratura ricostruisce il PNG originale', plain.equals(PNG_1X1));
      } catch (e) {
        check('Decifratura ricostruisce il PNG originale', false, e.message);
      }
    }
  } else {
    console.log('  · Saltato: PHOTO_BOT_ESCROW_KEY non configurata (cifratura disattivata)');
  }

  console.log(`\n═══ Risultato: ${pass} passati, ${fail} falliti ═══`);
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });

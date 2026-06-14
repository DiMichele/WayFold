/**
 * upload-test.js — Test end-to-end upload foto (web → Telegram → DB → serve)
 * Uso: node scripts/upload-test.js
 * Richiede il server attivo su localhost (npm run server).
 */

const fs = require('fs');
const config = require('../server/config');

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
  const ok = await uploadBlob(
    c, trip.id, new Blob([PNG_1X1], { type: 'image/png' }), 'pixel.png'
  );
  check('POST /photos → 201', ok.status === 201, `got ${ok.status} ${JSON.stringify(ok.json)}`);
  const saved = ok.json?.photos?.[0];
  check('Risposta contiene url foto', Boolean(saved?.url));

  const list = await c.req('GET', `/api/trips/${trip.id}/photos`);
  check('GET /photos elenca la nuova foto', (list.json || []).some(p => p.id === saved?.id));

  console.log('\n— Upload batch (2 file) —');
  const fd = new FormData();
  fd.append('photos', new Blob([PNG_1X1], { type: 'image/png' }), 'a.png');
  fd.append('photos', new Blob([PNG_1X1], { type: 'image/png' }), 'b.png');
  const batch = await c.req('POST', `/api/trips/${trip.id}/photos`, { body: fd, raw: true });
  check('Batch → 201', batch.status === 201, `got ${batch.status}`);
  check('Batch salva 2 foto', (batch.json?.photos || []).length === 2);

  console.log('\n— Upload senza MIME (simula iOS) —');
  const noMime = await uploadBlob(
    c, trip.id, new Blob([PNG_1X1]), 'ios-photo.jpg'
  );
  check('Blob senza type accettato → 201', noMime.status === 201, `got ${noMime.status}`);

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

  console.log(`\n═══ Risultato: ${pass} passati, ${fail} falliti ═══`);
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });

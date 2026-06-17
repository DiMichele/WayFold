/**
 * security-test.js — Batteria di test di sicurezza end-to-end
 * Uso: node scripts/security-test.js
 * Richiede il server attivo su localhost:3000.
 */

const fs = require('fs');
const path = require('path');
const config = require('../server/config');
const photoCrypto = require('../server/services/photoCrypto');

const BASE = `http://localhost:${config.PORT}`;
let pass = 0, fail = 0;

function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

/** Client con cookie jar minimale. */
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
      return { status: res.status, json, res };
    },
  };
}

/** Dopo registrazione, marca l'email come verificata (solo test e2e). */
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

async function main() {
  console.log('\n— Accesso anonimo —');
  const anon = client();
  check('GET /api/trips senza sessione → 401', (await anon.req('GET', '/api/trips')).status === 401);
  check('GET /api/status senza sessione → 401', (await anon.req('GET', '/api/status')).status === 401);

  console.log('\n— Registrazione —');
  const userB = client();
  const uname = 'testuser_e2e';
  const upass = 'password-sicura-1';
  let reg = await userB.req('POST', '/api/auth/register', { body: { username: uname, password: upass, email: `${uname}@test.local` } });
  if (reg.status === 409 || reg.status === 429) {
    // Utente già esistente o rate limit registrazioni: si rientra col login
    reg = await userB.req('POST', '/api/auth/login', { body: { username: uname, password: upass } });
    check(`Login utente B esistente (${uname}) → 200`, reg.status === 200, `got ${reg.status}`);
  } else {
    check(`Registrazione valida (${uname}) → 201`, reg.status === 201, `got ${reg.status} ${JSON.stringify(reg.json)}`);
    if (reg.status === 201 && reg.json?.emailVerified === false) verifyUserEmailInDb(uname);
  }
  check('Risposta senza passwordHash', !JSON.stringify(reg.json || {}).includes('passwordHash'));

  console.log('\n— Utente A (isolamento) —');
  const userA = client();
  const unameA = 'testuser_a_e2e';
  const upassA = 'password-sicura-1';
  let regA = await userA.req('POST', '/api/auth/register', { body: { username: unameA, password: upassA, email: `${unameA}@test.local` } });
  if (regA.status === 409 || regA.status === 429) {
    regA = await userA.req('POST', '/api/auth/login', { body: { username: unameA, password: upassA } });
    check(`Login utente A esistente (${unameA}) → 200`, regA.status === 200, `got ${regA.status}`);
  } else {
    check(`Registrazione utente A (${unameA}) → 201`, regA.status === 201, `got ${regA.status}`);
    if (regA.status === 201 && regA.json?.emailVerified === false) verifyUserEmailInDb(unameA);
  }

  const createdA = await userA.req('POST', '/api/trips', { body: { dest: 'Isolamento A', year: 2026 } });
  let tripA = createdA.status === 201 ? createdA.json : null;
  if (!tripA) {
    const aTrips = await userA.req('GET', '/api/trips');
    tripA = (aTrips.json || [])[0] || null;
  }
  check('Utente A ha almeno un viaggio', Boolean(tripA));

  const serial = JSON.stringify(tripA ? [tripA] : []);
  check('Serializzazione senza topicId/userId', !serial.includes('topicId') && !serial.includes('userId'));

  console.log('\n— Isolamento utente B —');
  const bTrips = await userB.req('GET', '/api/trips');
  check('Utente B vede 0 viaggi', Array.isArray(bTrips.json) && bTrips.json.length === 0);

  if (tripA) {
    check('B: GET viaggio di A → 404', (await userB.req('GET', `/api/trips/${tripA.id}`)).status === 404);
    check('B: DELETE viaggio di A → 404', (await userB.req('DELETE', `/api/trips/${tripA.id}`)).status === 404);
    check('B: PATCH viaggio di A → 404', (await userB.req('PATCH', `/api/trips/${tripA.id}`, { body: { dest: 'hack' } })).status === 404);
    check('B: foto del viaggio di A → 404', (await userB.req('GET', `/api/trips/${tripA.id}/photos`)).status === 404);
    check('B: cover del viaggio di A → 404', (await userB.req('POST', `/api/trips/${tripA.id}/cover`, { body: { photoId: 1 } })).status === 404);
    check('B: chiave di cifratura del viaggio di A → 404', (await userB.req('GET', `/api/trips/${tripA.id}/crypto-key`)).status === 404);

    // Foto fisica di A
    const aPhotos = await userA.req('GET', `/api/trips/${tripA.id}/photos`);
    const ph = (aPhotos.json || [])[0];
    if (ph) {
      check('A accede alla sua foto → 200', (await userA.req('GET', ph.url)).status === 200);
      check('B: foto fisica di A → 404', (await userB.req('GET', ph.url)).status === 404);
      check('Anonimo: foto fisica → 401', (await anon.req('GET', ph.url)).status === 401);
      check('B: PATCH foto di A → 404', (await userB.req('PATCH', `/api/photos/${ph.id}`, { body: { note: 'hack' } })).status === 404);
      check('B: DELETE foto di A → 404', (await userB.req('DELETE', `/api/photos/${ph.id}`)).status === 404);
    }
  }

  console.log('\n— Path traversal (richieste raw, senza normalizzazione client) —');
  const http = require('http');
  const rawGet = p => new Promise(resolve => {
    const req = http.request({ host: 'localhost', port: config.PORT, path: p, method: 'GET' }, res => {
      let body = '';
      res.on('data', c => { body += c; if (body.length > 4096) res.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('close', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });

  for (const p of [
    '/photos/3/..%2F..%2Fdb.json',
    '/photos/3/....%2F%2Fdb.json',
    '/photos/3/%2e%2e/%2e%2e/db.json',
    '/photos/../db.json',
    '/photos/..%2f../db.json',
    '/.env',
    '/db.json',
    '/server/config.js',
    '/sessions/',
  ]) {
    const r = await rawGet(p);
    const leaked = r.body.includes('passwordHash') || r.body.includes('BOT_TOKEN') || r.body.includes('_nextTripId');
    check(`Raw ${p} → nessun dato sensibile`, !leaked, `status ${r.status}`);
  }

  console.log('\n— Upload malevoli (su viaggio di B) —');
  // B crea un viaggio (topic Telegram); se i permessi topic mancano, fallback sul viaggio di A
  let bTrip = null;
  const created = await userB.req('POST', '/api/trips', { body: { dest: 'Security Test', year: 2026 } });
  if (created.status === 201) {
    bTrip = created.json;
    check('B crea il suo viaggio → 201', true);
  } else {
    check(`B crea viaggio (Telegram: ${created.json?.error})`, false, '— uso il viaggio A per i test upload');
  }

  const upClient = bTrip ? userB : userA;
  const upTrip = bTrip || tripA;

  if (upTrip) {
    const tmp = path.join(__dirname, 'tmp-evil');
    fs.mkdirSync(tmp, { recursive: true });

    const cases = [
      ['exe-rinominato.jpg', Buffer.concat([Buffer.from('MZ\x90\x00\x03'), Buffer.alloc(200)])],
      ['svg-script.jpg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
      ['vuoto.jpg', Buffer.alloc(0)],
      ['testo.png', Buffer.from('ciao sono un file di testo')],
    ];

    for (const [name, buf] of cases) {
      const file = path.join(tmp, name);
      fs.writeFileSync(file, buf);
      const fd = new FormData();
      fd.append('photos', new Blob([buf], { type: 'image/jpeg' }), name);
      const r = await upClient.req('POST', `/api/trips/${upTrip.id}/photos`, { body: fd, raw: true });
      check(`Upload "${name}" respinto`, r.status >= 400, `got ${r.status}`);
    }

    // Upload legittimo: cifrato se escrow attivo, altrimenti PNG in chiaro (legacy)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const keyRes = await upClient.req('GET', `/api/trips/${upTrip.id}/crypto-key`);

    if (keyRes.status === 200 && keyRes.json?.key) {
      const tripKey = Buffer.from(keyRes.json.key, 'base64');

      const fdBypass = new FormData();
      fdBypass.append('photos', new Blob([png], { type: 'image/png' }), 'bypass.png');
      const bypass = await upClient.req('POST', `/api/trips/${upTrip.id}/photos`, { body: fdBypass, raw: true });
      check('Upload in chiaro respinto (cifratura obbligatoria) → 415', bypass.status === 415, `got ${bypass.status}`);

      const encBuf = photoCrypto.encryptBuffer(png, tripKey);
      const fdEnc = new FormData();
      fdEnc.append('photos', new Blob([encBuf], { type: 'application/octet-stream' }), 'photo_0.wfenc');
      fdEnc.append('encrypted', '1');
      fdEnc.append('meta', JSON.stringify([{ originalMime: 'image/png', originalExt: 'png' }]));
      const enc = await upClient.req('POST', `/api/trips/${upTrip.id}/photos`, { body: fdEnc, raw: true });
      check('Upload cifrato → 201', enc.status === 201, `got ${enc.status}`);
      const encPhoto = enc.json?.photos?.[0];
      if (encPhoto?.url) {
        const r = await upClient.req('GET', encPhoto.url);
        const buf = Buffer.from(await r.res.arrayBuffer());
        check('Foto cifrata: byte serviti col magic WFENC1', photoCrypto.isEncrypted(buf));
        check('Foto cifrata: nessun magic PNG/JPEG in chiaro',
          !(buf[0] === 0x89 && buf[1] === 0x50) && !(buf[0] === 0xFF && buf[1] === 0xD8));
      }
    } else {
      console.log('  · Cifratura non configurata: test foto cifrata saltato');
      const fd = new FormData();
      fd.append('photos', new Blob([png], { type: 'image/png' }), 'pixel.png');
      const ok = await upClient.req('POST', `/api/trips/${upTrip.id}/photos`, { body: fd, raw: true });
      check('Upload PNG valido → 201', ok.status === 201, `got ${ok.status} ${JSON.stringify(ok.json)}`);
    }

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('\n— Brute force login —');
  const brute = client();
  let last = 0;
  for (let i = 0; i < 7; i++) {
    last = (await brute.req('POST', '/api/auth/login', { body: { username: 'vittima', password: 'sbagliata' + i } })).status;
  }
  check('7 login falliti → 429', last === 429, `got ${last}`);

  console.log('\n— Cleanup —');
  if (bTrip) {
    const del = await userB.req('DELETE', `/api/trips/${bTrip.id}`);
    check('B elimina il suo viaggio → 200', del.status === 200, `got ${del.status}`);
  }
  const logout = await userB.req('POST', '/api/auth/logout');
  check('Logout → 200', logout.status === 200);
  check('Dopo logout: /api/trips → 401', (await userB.req('GET', '/api/trips')).status === 401);

  console.log(`\n═══ Risultato: ${pass} passati, ${fail} falliti ═══`);
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });

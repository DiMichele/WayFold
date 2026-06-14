/**
 * tripService.js — Logica di business dei viaggi
 *
 * Unico punto in cui i viaggi vengono creati/arricchiti/serializzati.
 * Usato sia dalle route API che dal bot Telegram, così il comportamento
 * è identico indipendentemente da dove nasce il viaggio.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const { geocode } = require('./geocode');
const telegram = require('./telegram');
const { extractPhotoMeta } = require('./exif');

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

function telegramTopicName(username, tripName) {
  return `[${username}] ${tripName}`;
}

/** Rimuove il prefisso Telegram "[username] " dal titolo del topic. */
function stripTopicUserPrefix(name) {
  return String(name || '').trim().replace(/^\[[a-zA-Z0-9_.]{3,20}\]\s*/, '');
}

/** Da "[username] Santorini 2024" al utente che possiede il topic. */
function resolveUserFromTopicName(name) {
  const m = String(name || '').trim().match(/^\[([a-zA-Z0-9_.]{3,20})\]\s*(.+)$/);
  if (!m) return null;
  return db.getUserByUsername(m[1]);
}

// ─── Parsing e arricchimento ───────────────────────────────────────────────

/**
 * "Santorini 2024" → { dest: "Santorini", year: 2024 }
 * "[michele] Santorini 2024" → { dest: "Santorini", year: 2024 }
 */
function parseTripName(name) {
  const raw = stripTopicUserPrefix(name);
  const match = raw.match(/\b(19|20)\d{2}\b/);
  const year = match ? Number(match[0]) : null;
  const dest = raw.replace(/\b(19|20)\d{2}\b/, '').replace(/\s{2,}/g, ' ').replace(/[-–—,]\s*$/, '').trim();
  return { dest: dest || raw, year };
}

function tripDisplayName(dest, year) {
  const clean = stripTopicUserPrefix(dest);
  return year ? `${clean} ${year}` : clean;
}

/** Scena canvas illustrativa più adatta in base a tipo/geografia. */
function pickScene({ type, lat, countryCode, dest }) {
  const TYPE_SCENES = {
    'mare': 'coast', 'oceano': 'tropical', 'isola': 'aegean',
    'deserto': 'desert', 'montagna': 'mountain', 'avventura': 'mountain',
    'artico': 'fjord', 'cultura': 'temple', "città d'arte": 'coast',
  };
  const byType = TYPE_SCENES[String(type || '').toLowerCase()];
  if (byType) return byType;

  const cc = String(countryCode || '').toUpperCase();
  const inGroup = (codes) => codes.split(' ').includes(cc);
  if (inGroup('MA EG TN DZ LY JO AE SA QA OM NA MN')) return 'desert';
  if (inGroup('JP CN TH KH VN KR TW MM LA')) return 'temple';
  if (inGroup('GR CY MT HR')) return 'aegean';
  if (inGroup('MV FJ PF SC MU ID PH')) return 'tropical';
  if (lat != null) {
    if (lat >= 58) return 'fjord';
    if (Math.abs(lat) <= 20) return 'tropical';
    if (Math.abs(lat) >= 40 && inGroup('AR CL CH AT NP PE NZ')) return 'mountain';
  }
  // Fallback deterministico sul nome
  const scenes = ['coast', 'desert', 'fjord', 'temple', 'tropical', 'mountain', 'aegean'];
  let hash = 0;
  for (const ch of String(dest || '')) hash = (hash * 31 + ch.codePointAt(0)) % 9973;
  return scenes[hash % scenes.length];
}

/** Geocodifica la destinazione e restituisce i campi arricchiti. */
async function enrichLocation(dest, country) {
  const query = country ? `${dest}, ${country}` : dest;
  let geo = await geocode(query);
  // Se "dest, paese" non dà risultati, riprova con la sola destinazione
  if (!geo && country) geo = await geocode(dest);
  if (!geo) return {};
  return {
    lat: geo.lat,
    lon: geo.lon,
    country: country || geo.country,
    countryCode: geo.countryCode,
    flag: geo.flag,
    continent: geo.continent,
  };
}

// ─── Creazione ─────────────────────────────────────────────────────────────

/**
 * Crea (o recupera) un viaggio a partire da un topic Telegram.
 * Il proprietario si ricava dal prefisso [username] nel nome del topic.
 */
async function createFromTopic({ topicId, name }) {
  const existing = db.getTripByTopicId(topicId);
  if (existing) return existing;

  const topicUser = resolveUserFromTopicName(name);
  const { dest, year } = parseTripName(name);
  const cleanName = tripDisplayName(dest, year);

  // Collega un viaggio creato manualmente dalla UI (stesso nome, nessun topic)
  const manual = db.findTripByName(dest) || db.findTripByName(stripTopicUserPrefix(name));
  if (manual && manual.topicId == null) {
    return db.updateTrip(manual.id, { topicId: String(topicId), name: cleanName });
  }

  const loc = await enrichLocation(dest);
  const createdAt = new Date();
  return db.createTrip({
    userId: topicUser?.id ?? null,
    topicId,
    name: cleanName,
    dest,
    year: year ?? createdAt.getFullYear(),
    month: MONTHS[createdAt.getMonth()],
    ...loc,
    scene: pickScene({ lat: loc.lat, countryCode: loc.countryCode, dest }),
  });
}

/**
 * Crea un viaggio dal form della web app per l'utente indicato.
 * Il topic viene creato PRIMA su Telegram (storage), poi localmente.
 * Ogni topic è prefissato con [username] nel gruppo Telegram.
 */
async function createManual(user, { dest, country, year, month, days, type, tags }) {
  const cleanDest = String(dest || '').trim().slice(0, 60);
  if (!cleanDest) throw Object.assign(new Error('La destinazione è obbligatoria'), { status: 400 });

  const baseName = year ? `${cleanDest} ${year}` : cleanDest;
  const topicName = telegramTopicName(user.username, baseName);
  const topic = await telegram.createTopic(topicName);

  const loc = await enrichLocation(cleanDest, country ? String(country).trim() : null);
  const now = new Date();
  return db.createTrip({
    userId: user.id,
    topicId: topic.message_thread_id,
    name: baseName,
    dest: cleanDest,
    year: year ? Number(year) : now.getFullYear(),
    month: month || MONTHS[now.getMonth()],
    days: days ? Number(days) : null,
    type: type || null,
    tags: parseTags(tags),
    ...loc,
    scene: pickScene({ type, lat: loc.lat, countryCode: loc.countryCode, dest: cleanDest }),
  });
}

function parseTags(tags) {
  if (Array.isArray(tags)) return tags.map(t => String(t).trim()).filter(Boolean).slice(0, 6);
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 6);
  return [];
}

// ─── Aggiornamento ─────────────────────────────────────────────────────────

async function updateManual(user, id, patch) {
  const trip = db.getTripById(id);
  if (!trip) return null;

  const fields = {};
  if (patch.dest !== undefined) fields.dest = String(patch.dest).trim();
  if (patch.country !== undefined) fields.country = patch.country ? String(patch.country).trim() : null;
  if (patch.year !== undefined) fields.year = patch.year ? Number(patch.year) : null;
  if (patch.month !== undefined) fields.month = patch.month || null;
  if (patch.days !== undefined) fields.days = patch.days ? Number(patch.days) : null;
  if (patch.type !== undefined) fields.type = patch.type || null;
  if (patch.tags !== undefined) fields.tags = parseTags(patch.tags);

  // Se cambia la destinazione o il paese, ricalcola geocoding e scena
  const destChanged = fields.dest && fields.dest.toLowerCase() !== (trip.dest || '').toLowerCase();
  const countryChanged = fields.country !== undefined && fields.country !== trip.country;
  if (destChanged || countryChanged) {
    const loc = await enrichLocation(fields.dest || trip.dest, fields.country ?? trip.country);
    Object.assign(fields, loc);
    fields.scene = pickScene({
      type: fields.type ?? trip.type,
      lat: loc.lat ?? trip.lat,
      countryCode: loc.countryCode ?? trip.countryCode,
      dest: fields.dest || trip.dest,
    });
  }
  if (fields.dest || fields.year !== undefined) {
    const d = fields.dest || trip.dest;
    const y = fields.year !== undefined ? fields.year : trip.year;
    fields.name = y ? `${d} ${y}` : d;
  }

  // Propaga la rinomina al topic Telegram (best effort: il db resta la verità locale)
  if (fields.name && fields.name !== trip.name && trip.topicId != null && telegram.enabled()) {
    const owner = db.getUserById(trip.userId);
    const topicName = telegramTopicName(owner?.username || user.username, fields.name);
    try {
      await telegram.renameTopic(trip.topicId, topicName);
    } catch (err) {
      console.warn('⚠️  Rinomina topic Telegram fallita:', err.message);
    }
  }

  return db.updateTrip(id, fields);
}

/** Imposta la foto di copertina del viaggio (deve appartenere al viaggio). */
async function setCover(tripId, photoId) {
  const trip = db.getTripById(tripId);
  if (!trip) return null;
  if (photoId === null) return db.updateTrip(tripId, { coverPhotoId: null });

  const photo = db.getPhotoById(photoId);
  if (!photo || photo.tripId !== trip.id) {
    throw Object.assign(new Error('La foto non appartiene a questo viaggio'), { status: 400 });
  }
  return db.updateTrip(tripId, { coverPhotoId: photo.id });
}

/** Rinomina viaggio quando il topic Telegram viene rinominato. */
async function renameFromTopic(topicId, newName) {
  const trip = db.getTripByTopicId(topicId);
  if (!trip) return null;
  const { dest, year } = parseTripName(newName);
  const fields = { name: tripDisplayName(dest, year), dest };
  if (year) fields.year = year;
  if (dest.toLowerCase() !== (trip.dest || '').toLowerCase()) {
    const loc = await enrichLocation(dest);
    Object.assign(fields, loc);
    fields.scene = pickScene({ type: trip.type, lat: loc.lat, countryCode: loc.countryCode, dest });
  }
  return db.updateTrip(trip.id, fields);
}

// ─── Upload foto dal web ───────────────────────────────────────────────────

/**
 * Foto caricata dalla web app: viene PRIMA inviata su Telegram come file
 * (il gruppo resta l'archivio principale), poi salvata localmente con il
 * message_id ricevuto — identica a una foto arrivata dal bot.
 *
 * Il file DEVE essere già passato da uploadGuard.validateUpload:
 * estensione e mime derivano dal tipo binario rilevato, mai dal client.
 */
async function addPhotoFromWeb(trip, file, { caption, uploadedByUserId } = {}) {
  if (trip.topicId == null) {
    throw Object.assign(new Error('Viaggio non collegato allo storage'), { status: 409 });
  }
  if (!file.detectedExt || !file.detectedMime) {
    throw Object.assign(new Error('File non validato'), { status: 415 });
  }

  const cleanCaption = String(caption || '').slice(0, 500);
  // Nome neutro generato dal server: il nome originale non tocca mai il filesystem
  const safeName = `photo_${Date.now()}.${file.detectedExt}`;

  const tgMsg = await telegram.sendDocument(trip.topicId, file.path, {
    fileName: safeName,
    mime: file.detectedMime,
    caption: cleanCaption,
  });

  const fileId = tgMsg.document?.file_id ?? null;
  const fileName = `${Date.now()}_${tgMsg.message_id}.${file.detectedExt}`;
  const meta = await extractPhotoMeta(file.path);

  // Salva in DB prima di toccare il file temp: se unlink/rename fallisce (es. EBUSY
  // su Windows) la foto resta comunque in archivio e visibile in webapp.
  const photo = await db.addPhoto({
    tripId: trip.id,
    fileName,
    fileId,
    caption: cleanCaption,
    msgId: tgMsg.message_id,
    date: meta.date ?? Math.floor(Date.now() / 1000),
    takenAt: meta.takenAt || null,
    lat: meta.lat,
    lon: meta.lon,
    size: file.size || null,
    uploadedByUserId: uploadedByUserId ?? trip.userId,
  });

  try {
    if (config.PHOTOS_KEEP_LOCAL) {
      const tripDir = path.join(config.PHOTOS_DIR, String(trip.id));
      fs.mkdirSync(tripDir, { recursive: true });
      fs.renameSync(file.path, path.join(tripDir, fileName));
    } else {
      fs.unlinkSync(file.path);
    }
  } catch (err) {
    console.warn(`⚠️  Cleanup file upload web (${fileName}):`, err.message);
  }

  console.log(`🌐  [${trip.name}] foto caricata dal web → Telegram msg ${tgMsg.message_id}`);
  return photo;
}

// ─── Eliminazione (sincronizzata con Telegram) ─────────────────────────────

/** Elimina il viaggio: prima il topic su Telegram, poi il db e i file. */
async function removeTrip(id) {
  const trip = db.getTripById(id);
  if (!trip) return null;

  if (trip.topicId != null) {
    try {
      await telegram.deleteTopic(trip.topicId);
    } catch (err) {
      // Topic già rimosso a mano su Telegram → procedi; altri errori → blocca
      if (!/not found|TOPIC_/i.test(err.tgDescription || '')) throw err;
    }
  }

  const result = await db.deleteTrip(id);
  if (!result) return null;
  const dir = path.join(config.PHOTOS_DIR, String(result.trip.id));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return result.trip;
}

/** Elimina la foto: prima il messaggio su Telegram, poi il db e il file. */
async function removePhoto(id) {
  const existing = db.getPhotoById(id);
  if (!existing) return null;

  if (existing.msgId != null && telegram.enabled()) {
    try {
      await telegram.deleteMessage(existing.msgId);
    } catch (err) {
      if (!/not found|message to delete/i.test(err.tgDescription || '')) throw err;
    }
  }

  const photo = await db.deletePhoto(id);
  if (!photo) return null;
  const file = path.join(config.PHOTOS_DIR, String(photo.tripId), photo.fileName);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });

  // Se era la copertina, torna alla prima foto
  const trip = db.getTripById(photo.tripId);
  if (trip?.coverPhotoId === photo.id) {
    await db.updateTrip(trip.id, { coverPhotoId: null });
  }
  return photo;
}

async function updatePhoto(id, patch) {
  const photo = await db.updatePhoto(id, patch);
  if (!photo) return null;
  return photo;
}

// ─── Geocoding retroattivo ─────────────────────────────────────────────────

function coordsFromPhotos(tripId) {
  const pts = db.getPhotos(tripId).filter(p => p.lat != null && p.lon != null);
  if (!pts.length) return null;
  const lat = pts.reduce((s, p) => s + Number(p.lat), 0) / pts.length;
  const lon = pts.reduce((s, p) => s + Number(p.lon), 0) / pts.length;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Geocodifica viaggi senza coordinate (dest → foto EXIF). Rispetta il rate limit Nominatim. */
async function backfillMissingGeocoding() {
  const pending = db.getAllTrips().filter(t => {
    const dest = String(t.dest || '').trim();
    return dest && (t.lat == null || t.lon == null);
  });
  let updated = 0;
  for (const trip of pending) {
    let loc = await enrichLocation(trip.dest, trip.country);
    if (loc.lat == null) {
      const fromPhotos = coordsFromPhotos(trip.id);
      if (fromPhotos) loc = fromPhotos;
    }
    if (loc.lat != null && loc.lon != null) {
      db.updateTrip(trip.id, loc);
      updated++;
    }
    await sleep(1100);
  }
  return updated;
}

let _geoBackfill = null;

/** Avvia il backfill una sola volta; le chiamate successive attendono lo stesso job. */
function ensureGeocodingBackfill() {
  if (!_geoBackfill) {
    _geoBackfill = backfillMissingGeocoding()
      .then(n => {
        if (n > 0) console.log(`📍  Coordinate aggiornate per ${n} viaggi`);
        return n;
      })
      .catch(err => {
        console.warn('⚠️  Backfill geocoding:', err.message);
        return 0;
      });
  }
  return _geoBackfill;
}

// ─── Serializzazione per l'API ─────────────────────────────────────────────

/** Giorni di viaggio: valore manuale, oppure calcolato dallo span delle foto. */
function computeDays(trip, photos) {
  if (trip.days) return trip.days;
  if (photos.length >= 2) {
    const span = photos[photos.length - 1].date - photos[0].date;
    return Math.max(1, Math.round(span / 86400) + 1);
  }
  return photos.length === 1 ? 1 : null;
}

/**
 * Allowlist esplicita dei campi: topicId, msgId, userId, fileName e
 * percorsi interni NON escono mai dall'API.
 */
function serializeTrip(trip, viewer = null) {
  const photos = db.getPhotos(trip.id);
  const coverPhoto =
    (trip.coverPhotoId != null && photos.find(p => p.id === trip.coverPhotoId)) || photos[0] || null;
  const created = new Date(trip.createdAt);
  const isOwner = viewer ? trip.userId === viewer.id : true;
  const member = viewer && !isOwner ? db.getTripMember(trip.id, viewer.id) : null;
  return {
    id: trip.id,
    dest: stripTopicUserPrefix(trip.dest) || trip.dest,
    country: trip.country,
    flag: trip.flag,
    continent: trip.continent,
    lat: trip.lat,
    lon: trip.lon,
    year: trip.year ?? created.getFullYear(),
    month: trip.month ?? MONTHS[created.getMonth()],
    days: computeDays(trip, photos),
    type: trip.type,
    tags: trip.tags || [],
    scene: trip.scene,
    name: stripTopicUserPrefix(trip.name) || trip.name,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    photoCount: photos.length,
    coverUrl: coverPhoto ? photoUrl(coverPhoto) : null,
    coverPhotoId: coverPhoto?.id ?? null,
    linked: trip.topicId != null,
    isOwner,
    shared: Boolean(member),
    sharedPermission: member?.permission ?? null,
  };
}

function serializeTripForUser(trip, viewer) {
  return serializeTrip(trip, viewer);
}

function photoUrl(photo) {
  // URL relativo: funziona in locale e in produzione senza configurazione
  return `/photos/${photo.tripId}/${encodeURIComponent(photo.fileName)}`;
}

function canViewerDeletePhoto(viewer, photo, trip) {
  if (!viewer || !trip) return true;
  if (trip.userId === viewer.id) return true;
  const member = db.getTripMember(trip.id, viewer.id);
  if (!member || member.permission !== 'upload') return false;
  const uploader = photo.uploadedByUserId ?? trip.userId;
  return uploader === viewer.id;
}

function serializePhoto(photo, viewer = null) {
  const trip = db.getTripById(photo.tripId);
  const canDelete = canViewerDeletePhoto(viewer, photo, trip);
  return {
    id: photo.id,
    tripId: photo.tripId,
    caption: photo.caption,
    note: photo.note || '',
    date: photo.date,
    takenAt: photo.takenAt,
    lat: photo.lat,
    lon: photo.lon,
    addedAt: photo.addedAt,
    url: photoUrl(photo),
    hasExifDate: Boolean(photo.takenAt),
    canDelete,
  };
}

module.exports = {
  MONTHS,
  parseTripName,
  createFromTopic,
  createManual,
  updateManual,
  renameFromTopic,
  setCover,
  addPhotoFromWeb,
  removeTrip,
  removePhoto,
  updatePhoto,
  backfillMissingGeocoding,
  ensureGeocodingBackfill,
  serializeTrip,
  serializeTripForUser,
  serializePhoto,
};

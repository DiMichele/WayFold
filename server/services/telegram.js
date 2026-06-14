/**
 * telegram.js — Ponte server → Bot API Telegram
 *
 * Permette alla web app di agire sul gruppo Telegram come farebbe l'utente:
 * creare/rinominare/eliminare topic, inviare foto come file, eliminare messaggi.
 * Usa chiamate HTTPS dirette (fetch nativo Node 18+): nessun conflitto con il
 * polling del bot, che gira in un processo separato.
 *
 * Richiede che il bot sia amministratore del gruppo con i permessi
 * "Gestione argomenti" e "Eliminazione messaggi".
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const config = require('../config');

const BASE = () => `https://api.telegram.org/bot${config.BOT_TOKEN}`;

function enabled() {
  return Boolean(config.BOT_TOKEN && config.GROUP_ID);
}

// Cache breve per non martellare getChat ad ogni poll del frontend (~12s)
let _probeCache = null;
const PROBE_TTL_MS = 30_000;

function invalidateProbe() {
  _probeCache = null;
}

/** Verifica che bot e gruppo siano raggiungibili (GROUP_ID valido, rete ok). */
async function probe() {
  if (!enabled()) return false;

  const now = Date.now();
  if (_probeCache && now - _probeCache.at < PROBE_TTL_MS) {
    return _probeCache.ok;
  }

  let ok = false;
  try {
    const res = await fetch(`${BASE()}/getChat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.GROUP_ID }),
    });
    const body = await res.json().catch(() => null);
    ok = Boolean(body?.ok);
    if (!ok) {
      console.error('⚠️  Telegram probe:', body?.description || `HTTP ${res.status}`);
    }
  } catch (err) {
    console.error('⚠️  Telegram probe:', err.message);
  }

  _probeCache = { ok, at: now };
  return ok;
}

/**
 * Verso il client esce SOLO un messaggio neutro: il dettaglio reale
 * (che rivelerebbe l'infrastruttura) finisce nei log del server.
 */
function storageError(detail) {
  invalidateProbe();
  console.error('⚠️  Telegram:', detail);
  return Object.assign(
    new Error("L'archivio non è al momento disponibile, riprova più tardi"),
    { status: 502 }
  );
}

function requireEnabled() {
  if (!enabled()) throw storageError('BOT_TOKEN/GROUP_ID mancanti nel .env');
}

function requireToken() {
  if (!config.BOT_TOKEN) throw storageError('BOT_TOKEN mancante nel .env');
}

async function apiCall(method, params = {}) {
  requireToken();
  const res = await fetch(`${BASE()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await res.json().catch(() => null);
  if (!body?.ok) {
    const err = storageError(`${method} → ${body?.description || `HTTP ${res.status}`}`);
    err.tgDescription = body?.description || '';
    throw err;
  }
  return body.result;
}

async function call(method, params = {}) {
  return apiCall(method, { chat_id: config.GROUP_ID, ...params });
}

function pipeUrlToResponse(url, res, redirects = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (tgRes) => {
      if ([301, 302, 307, 308].includes(tgRes.statusCode) && tgRes.headers.location) {
        if (redirects > 5) return reject(new Error('Troppi redirect'));
        return pipeUrlToResponse(tgRes.headers.location, res, redirects + 1).then(resolve, reject);
      }
      if (tgRes.statusCode !== 200) {
        return reject(new Error(`HTTP ${tgRes.statusCode}`));
      }
      tgRes.pipe(res);
      tgRes.on('end', resolve);
      tgRes.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout download')); });
  });
}

async function getFileDownloadUrl(fileId) {
  const file = await apiCall('getFile', { file_id: fileId });
  return `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`;
}

/** Inoltra un file Telegram alla risposta HTTP (galleria senza copia su disco). */
async function pipeFile(fileId, res) {
  const url = await getFileDownloadUrl(fileId);
  await pipeUrlToResponse(url, res);
}

/** Messaggio nella chat generale del gruppo (senza topic). Best-effort, non propaga errori. */
async function notifyUserRegistered({ username, totalUsers }) {
  if (!enabled()) {
    console.warn('⚠️  Telegram: notifica registrazione non inviata (BOT_TOKEN/GROUP_ID mancanti)');
    return;
  }

  const text = [
    '👤 Nuovo utente registrato',
    `Username: ${username}`,
    `Utenti totali: ${totalUsers}`,
  ].join('\n');

  try {
    await call('sendMessage', { text });
    console.log(`📣  Telegram: registrazione "${username}" (${totalUsers} utenti)`);
  } catch (err) {
    console.error('⚠️  Telegram notifica registrazione:', err.message || err);
  }
}

/** Crea un topic nel gruppo. Ritorna { message_thread_id, name, ... } */
async function createTopic(name) {
  requireEnabled();
  return call('createForumTopic', { name: String(name).slice(0, 128) });
}

/** Rinomina un topic esistente. */
async function renameTopic(topicId, name) {
  requireEnabled();
  return call('editForumTopic', {
    message_thread_id: Number(topicId),
    name: String(name).slice(0, 128),
  });
}

/** Elimina un topic con tutti i suoi messaggi. */
async function deleteTopic(topicId) {
  requireEnabled();
  return call('deleteForumTopic', { message_thread_id: Number(topicId) });
}

/** Elimina un singolo messaggio (es. una foto). */
async function deleteMessage(messageId) {
  requireEnabled();
  return call('deleteMessage', { message_id: Number(messageId) });
}

// ─── Coda invii (anti-flood: max 1 in volo, spacing tra messaggi) ──────────

const SEND_SPACING_MS = 2500;
const MAX_QUEUE = 40;

let _queue = Promise.resolve();
let _pending = 0;

function enqueueSend(fn) {
  if (_pending >= MAX_QUEUE) {
    throw Object.assign(
      new Error('Server occupato: troppe foto in coda, riprova tra qualche minuto'),
      { status: 503 }
    );
  }
  _pending++;
  const run = _queue
    .then(fn)
    .finally(() => {
      _pending--;
      return new Promise(r => setTimeout(r, SEND_SPACING_MS));
    });
  // La catena prosegue anche se un invio fallisce
  _queue = run.then(() => {}, () => {});
  return run;
}

/**
 * Invia un file immagine in un topic come documento (qualità originale).
 * Passa dalla coda sequenziale per rispettare i rate limit Bot API.
 * Ritorna il messaggio Telegram creato (serve message_id per la sync).
 */
async function sendDocument(topicId, filePath, { fileName, mime, caption } = {}) {
  requireEnabled();
  return enqueueSend(() => sendDocumentNow(topicId, filePath, { fileName, mime, caption }));
}

async function sendDocumentNow(topicId, filePath, { fileName, mime, caption } = {}) {
  const fd = new FormData();
  fd.append('chat_id', String(config.GROUP_ID));
  fd.append('message_thread_id', String(Number(topicId)));
  if (caption) fd.append('caption', String(caption).slice(0, 1024));
  fd.append(
    'document',
    new Blob([fs.readFileSync(filePath)], { type: mime || 'application/octet-stream' }),
    fileName || path.basename(filePath)
  );

  const res = await fetch(`${BASE()}/sendDocument`, { method: 'POST', body: fd });
  const body = await res.json().catch(() => null);
  if (!body?.ok) {
    throw storageError(`sendDocument → ${body?.description || `HTTP ${res.status}`}`);
  }
  return body.result;
}

module.exports = {
  enabled,
  probe,
  notifyUserRegistered,
  createTopic,
  renameTopic,
  deleteTopic,
  deleteMessage,
  sendDocument,
  pipeFile,
};

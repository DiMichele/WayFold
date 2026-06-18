/**
 * sw.js — Service worker WayFold (PWA)
 *
 * Strategia: app shell sì, dati no.
 *  - Cache SOLO asset statici same-origin (css, js, img, vendor, manifest, shell).
 *  - Mai cache di /api/* o /photos/* (contenuti privati) né di richieste non-GET.
 *  - Navigazioni offline: shell cached, altrimenti pagina /offline.html.
 *  - Aggiornamenti: nuovo worker resta in waiting finché il client non invia
 *    SKIP_WAITING (vedi public/js/pwa.js), evitando reload durante l'uso.
 */

const CACHE_NAME = 'wayfold-shell-v23';
const OFFLINE_URL = '/offline.html';
const LOGIN_URL = '/login';

const APP_SHELL = [
  LOGIN_URL,
  OFFLINE_URL,
  '/css/styles.css',
  '/js/login.js',
  '/js/main.js',
  '/img/favicon.svg',
  '/img/icon-192.png',
  '/img/icon-512.png',
  '/manifest.webmanifest',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
  '/vendor/maplibre/maplibre-gl.css',
  '/vendor/maplibre/maplibre-gl-csp.js',
  '/vendor/maplibre/maplibre-gl-csp-worker.js',
  '/vendor/maplibre/leaflet-maplibre-gl.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Solo same-origin: font, tile OSM e altre risorse esterne passano alla rete.
  if (url.origin !== self.location.origin) return;

  // Mai toccare dati privati: nessuna lettura/scrittura cache.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/photos/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(handleStatic(request));
});

async function handleNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const login = await cache.match(LOGIN_URL);
    if (login) return login;
    const offline = await cache.match(OFFLINE_URL);
    return offline || Response.error();
  }
}

async function handleStatic(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return Response.error();
  }
}

const CACHE_NAME = __CACHE_NAME__;
const PRECACHE_URLS = __PRECACHE_URLS__;
const PRECACHE_SET = new Set(PRECACHE_URLS);
const CACHE_PREFIX = "wayfold-relay-precache-";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function htmlFallbackPath(pathname) {
  if (pathname.endsWith("/")) return `${pathname}index.html`;
  return pathname.endsWith(".html") ? pathname : `${pathname}/index.html`;
}

async function networkFirstHtml(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE_NAME);
    return (
      (await cache.match(request)) ||
      (await cache.match(htmlFallbackPath(new URL(request.url).pathname))) ||
      Response.error()
    );
  }
}

let uvProxy = null;
function ultraviolet() {
  if (!uvProxy) {
    importScripts("/browse/uv/uv.bundle.js");
    importScripts("/browse/uv/uv.config.js");
    importScripts("/browse/uv/uv.sw.js");
    uvProxy = new UVServiceWorker();
  }
  return uvProxy;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // The browse frame is created by a page this worker already controls, so Chrome
  // delivers that navigation here. Leaving it to the network makes nginx answer 404
  // and the frame stays blank.
  if (url.origin === self.location.origin && url.pathname.startsWith("/browse/uv/service/")) {
    event.respondWith(ultraviolet().fetch(event));
    return;
  }
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  const acceptsHtml = request.mode === "navigate" || request.headers.get("accept")?.includes("text/html");
  if (acceptsHtml) {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  if (PRECACHE_SET.has(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        // Refresh in the background while online, so a device that later goes
        // offline does not keep serving an outdated copy forever.
        const fresh = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || fresh;
      }),
    );
  }
});

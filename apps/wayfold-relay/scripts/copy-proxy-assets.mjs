import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Ultraviolet and the bare-mux worker are served as plain files: the service
// worker imports them with importScripts and bare-mux needs a fixed worker URL.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const uvDist = join(root, "node_modules", "@titaniumnetwork-dev", "ultraviolet", "dist");
const bareDist = join(root, "node_modules", "@mercuryworkshop", "bare-mux", "dist");
const uvOut = join(root, "public", "browse", "uv");
const bareOut = join(root, "public", "browse", "baremux");

const UV_CONFIG = `/*global Ultraviolet*/
// A slash in the xor text becomes %2F in the path. Chrome then skips this
// service worker and nginx answers 404, so the frame stays blank.
function wfShield(value) {
  return value.replaceAll("~", "~t").replaceAll("/", "~s");
}
function wfUnshield(value) {
  return value.replaceAll("~s", "/").replaceAll("~t", "~");
}
self.__uv$config = {
  prefix: "/browse/uv/service/",
  encodeUrl(url) {
    if (!url) return url;
    let out = "";
    for (let i = 0; i < url.length; i++) out += i % 2 ? String.fromCharCode(url.charCodeAt(i) ^ 2) : url[i];
    return encodeURIComponent(wfShield(out));
  },
  decodeUrl(url) {
    if (!url) return url;
    const parts = String(url).split("?");
    const path = parts.shift();
    const text = wfUnshield(decodeURIComponent(path));
    let out = "";
    for (let i = 0; i < text.length; i++) out += i % 2 ? String.fromCharCode(text.charCodeAt(i) ^ 2) : text[i];
    return out + (parts.length ? "?" + parts.join("?") : "");
  },
  handler: "/browse/uv/uv.handler.js",
  client: "/browse/uv/uv.client.js",
  bundle: "/browse/uv/uv.bundle.js",
  config: "/browse/uv/uv.config.js",
  sw: "/browse/uv/uv.sw.js",
};
`;

const SW = `/*global UVServiceWorker,__uv$config*/
/* wf-sw 2: reload clients after the path codec change */
importScripts("/browse/uv/uv.bundle.js");
importScripts("/browse/uv/uv.config.js");
importScripts(__uv$config.sw);

const uv = new UVServiceWorker();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (uv.route(event)) {
    event.respondWith(uv.fetch(event));
    return;
  }
  // Proxied pages load UV's own scripts through this worker; offline they come from the app precache.
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
`;

await mkdir(uvOut, { recursive: true });
await mkdir(bareOut, { recursive: true });
for (const name of ["uv.bundle.js", "uv.client.js", "uv.handler.js", "uv.sw.js"]) {
  await copyFile(join(uvDist, name), join(uvOut, name));
}
await writeFile(join(uvOut, "uv.config.js"), UV_CONFIG);
await writeFile(join(uvOut, "sw.js"), SW);
await copyFile(join(bareDist, "worker.js"), join(bareOut, "worker.js"));
console.log("Proxy assets copied to public/browse/");

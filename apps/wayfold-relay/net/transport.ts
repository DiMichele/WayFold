import { BareMuxConnection } from "@mercuryworkshop/bare-mux";
import EpoxyTransport from "@mercuryworkshop/epoxy-transport";
import type { LocalLink } from "./link.ts";

export const BARE_WORKER = "/browse/baremux/worker.js";

/**
 * Makes this page the network for the browsing window: the proxy's service
 * worker asks bare-mux, bare-mux asks this page, and epoxy speaks Wisp over
 * the optical link instead of a WebSocket. Loaded on demand (epoxy is ~1.7 MB).
 */
/** Only the offline package's own exit is trusted with skipped certificate checks. */
function intranetExit(): boolean {
  return location.protocol === "http:" && (location.hostname === "localhost" || location.hostname === "127.0.0.1");
}

function epoxyOptions(link: LocalLink): ConstructorParameters<typeof EpoxyTransport>[0] {
  return {
    wisp: () => link.openTunnel(),
    // Intranet sites use self-signed or company certificates the browser does not trust.
    ...(intranetExit() ? { disable_certificate_validation: true } : {}),
  };
}

export async function serveBrowseTransport(link: LocalLink): Promise<void> {
  const conn = new BareMuxConnection(BARE_WORKER);
  const transport = new EpoxyTransport(epoxyOptions(link));
  await conn.setRemoteTransport(transport, "wayfold-optical");
}

let pageTransport: Promise<EpoxyTransport> | null = null;
let pageLink: LocalLink | null = null;

function transportFor(link: LocalLink): Promise<EpoxyTransport> {
  if (pageTransport && pageLink === link) return pageTransport;
  pageLink = link;
  const created = (async () => {
    const transport = new EpoxyTransport(epoxyOptions(link));
    await transport.init();
    return transport;
  })();
  pageTransport = created;
  return created;
}

function headerValue(headers: unknown, name: string): string {
  const wanted = name.toLowerCase();
  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i += 2) {
      const key = headers[i];
      const value = headers[i + 1];
      if (typeof key === "string" && key.toLowerCase() === wanted && typeof value === "string") return value;
    }
  }
  return "";
}

async function readBody(body: unknown, max: number): Promise<Uint8Array> {
  if (body instanceof ArrayBuffer) return new Uint8Array(body).slice(0, max);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice(0, max);
  if (!body || typeof (body as ReadableStream<Uint8Array>).getReader !== "function") return new Uint8Array();
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    size += step.value.byteLength;
  }
  reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(size, max));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, out.byteLength - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= out.byteLength) break;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

interface PageResponse {
  status: number;
  headers: unknown;
  body: unknown;
}

async function request(transport: EpoxyTransport, url: URL): Promise<PageResponse> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const res = (await transport.request(current, "GET", null, { accept: "text/html,image/*,*/*" }, undefined as unknown as AbortSignal)) as PageResponse;
    const location = headerValue(res.headers, "location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current);
      continue;
    }
    return res;
  }
  throw new Error("Troppi reindirizzamenti");
}

/** Pages opened from the portable file have no service worker, so this loads one page through the link. */
export async function loadThroughLink(link: LocalLink, url: string): Promise<string> {
  const transport = await transportFor(link);
  const pageUrl = new URL(url);
  const res = await request(transport, pageUrl);
  const type = headerValue(res.headers, "content-type");
  const bytes = await readBody(res.body, 1_500_000);
  if (res.status >= 400) throw new Error(`Il sito ha risposto ${res.status}`);
  if (type && !type.includes("html") && !type.startsWith("text/")) throw new Error(`Questo indirizzo non è una pagina (${type})`);
  let html = new TextDecoder().decode(bytes);
  html = await embedImages(transport, pageUrl, html);
  const guard =
    `<base href="${pageUrl.href}">` +
    `<script>(function(){function go(u){parent.postMessage({t:"wf-go",url:u},"*")}document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a");if(!a||!a.href)return;e.preventDefault();go(a.href)},true);document.addEventListener("submit",function(e){var f=e.target;if(!f||!f.action)return;e.preventDefault();go(f.action)},true)})();<\/script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (tag) => tag + guard) : guard + html;
}

async function embedImages(transport: EpoxyTransport, pageUrl: URL, html: string): Promise<string> {
  const sources = [...html.matchAll(/\ssrc=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((src): src is string => !!src && !src.startsWith("data:"))
    .slice(0, 8);
  let out = html;
  for (const src of sources) {
    let target: URL;
    try {
      target = new URL(src, pageUrl);
    } catch {
      continue;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") continue;
    try {
      const res = await request(transport, target);
      const mime = headerValue(res.headers, "content-type").split(";")[0] || "image/jpeg";
      if (!mime.startsWith("image/")) continue;
      const bytes = await readBody(res.body, 300_000);
      if (bytes.byteLength === 0 || bytes.byteLength >= 300_000) continue;
      out = out.split(src).join(`data:${mime};base64,${bytesToBase64(bytes)}`);
    } catch {
      /* the page still shows without this image */
    }
  }
  return out;
}

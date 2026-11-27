import { applyStatic, t } from "../shared/i18n.ts";
import { NET_CHANNEL, type NetBroadcast } from "../net/channel.ts";

interface UvConfig {
  prefix: string;
  encodeUrl(url: string): string;
  decodeUrl(encoded: string): string;
}

declare global {
  // eslint-disable-next-line no-var
  var __uv$config: UvConfig | undefined;
}

const SW_URL = "/browse/uv/sw.js";
const SEARCH = "https://lite.duckduckgo.com/lite/?q=";
/** The Network page broadcasts every 500 ms; past this it is closed or frozen. */
const STALE_MS = 2500;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const frame = $<HTMLIFrameElement>("bz-frame");
const input = $<HTMLInputElement>("bz-url");

let status: Extract<NetBroadcast, { t: "status" }> | null = null;
let statusAt = 0;
let swReady: Promise<void> | null = null;
let loadingAt = 0;
let pullbacks = 0;

function applyTheme(): void {
  try {
    const theme = localStorage.getItem("ot-theme");
    if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
  } catch {
    /* private mode */
  }
}

function showError(msg: string): void {
  const box = $("bz-error");
  box.textContent = msg;
  box.hidden = !msg;
}

function config(): UvConfig {
  const cfg = globalThis.__uv$config;
  if (!cfg) throw new Error("Ultraviolet non caricato");
  return cfg;
}

async function registerProxy(): Promise<void> {
  if (!("serviceWorker" in navigator)) throw new Error(t("browse.unsupported"));
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: config().prefix });
  if (reg.active) return;
  const worker = reg.installing ?? reg.waiting;
  if (!worker) return;
  await new Promise<void>((resolve) => {
    const check = () => {
      if (worker.state === "activated") resolve();
    };
    worker.addEventListener("statechange", check);
    check();
  });
}

function toUrl(raw: string): string {
  const s = raw.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(s) || /^localhost(:\d+)?(\/\S*)?$/i.test(s)) return `https://${s}`;
  return SEARCH + encodeURIComponent(s);
}

async function go(raw: string): Promise<void> {
  if (!raw.trim()) return;
  const url = toUrl(raw);
  input.value = url;
  try {
    swReady ??= registerProxy();
    await swReady;
  } catch (e) {
    swReady = null;
    showError(e instanceof Error ? e.message : String(e));
    return;
  }
  showError("");
  $("bz-empty").hidden = true;
  frame.hidden = false;
  loadingAt = Date.now();
  pullbacks = 0;
  $("bz-loading-title").textContent = t("browse.loading", { url });
  $("bz-loading").hidden = false;
  renderLoading();
  frame.src = config().prefix + config().encodeUrl(url);
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(bytes >= 10_240 ? 0 : 1);
}

function renderLoading(): void {
  const box = $("bz-loading");
  if (!box || box.hidden) return;
  const s = Date.now() - statusAt < STALE_MS ? status : null;
  const down = s?.inBytes ?? 0;
  const up = s?.outBytes ?? 0;
  const elapsed = Math.max(0, Math.round((Date.now() - loadingAt) / 1000));
  const time = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  $("bz-loading-meta").textContent =
    down + up > 0
      ? t("browse.loading.progress", { down: kb(down), up: kb(up), time })
      : t("browse.loading.wait", { time });
}

function watchFrame(): void {
  if (frame.hidden || !loadingAt) return;
  let kind: "blank" | "empty" | "content" | "foreign" = "blank";
  try {
    const loc = frame.contentWindow?.location;
    if (loc && loc.href !== "about:blank") {
      const text = (frame.contentDocument?.body?.innerText || "").replace(/\s+/g, " ").trim();
      kind = text.length >= 24 ? "content" : "empty";
      const cfg = config();
      if (loc.pathname.startsWith(cfg.prefix)) {
        const url = cfg.decodeUrl(loc.pathname.slice(cfg.prefix.length));
        if (url && document.activeElement !== input) input.value = url;
      }
      const title = frame.contentDocument?.title;
      if (title) document.title = `${title} · WayFold`;
    }
  } catch {
    kind = "foreign";
  }
  const loading = $("bz-loading");
  if (kind === "content") {
    loading.hidden = true;
    return;
  }
  loading.hidden = false;
  if (kind === "foreign" && pullbacks < 2) {
    pullbacks++;
    $("bz-loading-title").textContent = t("browse.loading.back");
    frame.src = config().prefix + config().encodeUrl(input.value);
    return;
  }
  if (kind === "empty") $("bz-loading-title").textContent = t("browse.loading.empty");
}

function renderStatus(): void {
  const s = Date.now() - statusAt < STALE_MS ? status : null;
  let text: string;
  let dot: string;
  if (!s) [text, dot] = [t("browse.status.none"), "err"];
  else if (s.role === "share") [text, dot] = [t("browse.status.share"), "err"];
  else if (!s.running) [text, dot] = [t("browse.status.off"), "err"];
  else if (s.state === "connected") [text, dot] = s.linkUp ? [t("browse.status.connected"), "ok"] : [t("browse.status.linkDown"), "err"];
  else [text, dot] = [t("browse.status.waiting"), "warn"];
  $("bz-state").textContent = text;
  $("bz-dot").className = `net-dot ${dot}`;
  $("bz-rate").textContent = s?.state === "connected" && s.linkUp ? `↓ ${s.inKBs.toFixed(1)} · ↑ ${s.outKBs.toFixed(1)} KiB/s` : "";
  renderLoading();
  watchFrame();
}

function listen(): void {
  if (!("BroadcastChannel" in window)) return;
  const channel = new BroadcastChannel(NET_CHANNEL);
  channel.onmessage = (e: MessageEvent<NetBroadcast>) => {
    if (e.data.t === "gone") {
      status = null;
      statusAt = 0;
    } else {
      status = e.data;
      statusAt = Date.now();
    }
    renderStatus();
  };
}

applyTheme();
applyStatic();
listen();
renderStatus();
window.setInterval(renderStatus, 1000);

$("bz-form").addEventListener("submit", (e) => {
  e.preventDefault();
  void go(input.value);
});
$("bz-back").addEventListener("click", () => frame.contentWindow?.history.back());
$("bz-forward").addEventListener("click", () => frame.contentWindow?.history.forward());
$("bz-reload").addEventListener("click", () => {
  if (!frame.hidden) frame.contentWindow?.location.reload();
});
frame.addEventListener("load", watchFrame);

const start = new URLSearchParams(location.search).get("url");
if (start) void go(start);
else input.focus();

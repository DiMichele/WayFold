import { onLangChange, t } from "../shared/i18n.ts";
import { endOptSession } from "../shared/opt-ui.ts";
import { Modem, type HelperStatus, type ModemErrorKind, type ModemSnapshot } from "../modem/modem.ts";
import { LocalLink, type Role } from "./link.ts";
import { NET_CHANNEL, type NetBroadcast } from "./channel.ts";
import { syncDesk } from "./live.ts";

const ROLE_KEY = "wf-net-role";
const GRID_KEY = "wf-net-grid";
const CAMERA_KEY = "wf-net-camera";
const DEVICE_NAME = "WayFold Web";
const BROWSE_URL = "/browse/";
/** 5 fps keeps each QR on screen long enough for a webcam pointed at a monitor. */
const LINK = { mtu: 1200, fps: 8, ecc: "L" as const };

type Action = "authorize" | "reject" | "disconnect" | "reconnect";

let role: Role = "share";
let modem: Modem | null = null;
let link: LocalLink | null = null;
let snapshot: ModemSnapshot | null = null;
let errorKind: ModemErrorKind | null = null;
let errorDetail = "";
let browseError = "";
let egressDown = false;
let wired = false;
let mounted = false;
let actionsKey = "";
let channel: BroadcastChannel | null = null;

function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function savedRole(): Role {
  return read(ROLE_KEY) === "join" ? "join" : "share";
}

function savedGrid(): number {
  const n = Number(read(GRID_KEY));
  return n === 1 || n === 4 ? n : 2;
}

/** Replaced in the portable file only. The public site never takes this branch. */
const PORTABLE_WISP = "wss://transfer.wayfold.xyz/wisp/?k=__WF_PORTABLE_WISP_KEY__";

function wispUrl(): string {
  if (location.protocol === "file:") return PORTABLE_WISP;
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/wisp/`;
}

function broadcast(msg: NetBroadcast): void {
  if (!("BroadcastChannel" in window)) return;
  channel ??= new BroadcastChannel(NET_CHANNEL);
  channel.postMessage(msg);
}

function publish(): void {
  const h = snapshot?.helper;
  broadcast({
    t: "status",
    running: !!modem?.isRunning,
    role,
    state: h?.state ?? "",
    linkUp: !!h?.linkUp,
    inBps: h?.inBps ?? 0,
    outBps: h?.outBps ?? 0,
    inBytes: h?.inBytes ?? 0,
    outBytes: h?.outBytes ?? 0,
  });
}

function ensureModem(): Modem {
  if (modem) return modem;
  const host = el("net-modem")!;
  const root = document.createElement("div");
  host.append(root);
  modem = new Modem(root, {
    key: "net",
    title: "Rete",
    product: true,
    defaults: { grid: savedGrid(), ...LINK },
    idleText: () => t(modem?.isRunning ? "net.idle.waiting" : "net.idle.off"),
    onUpdate: (next) => {
      snapshot = next;
      render();
      publish();
    },
    onError: (kind, detail) => {
      errorKind = kind;
      errorDetail = detail;
      render();
    },
  });
  modem.configure({ grid: savedGrid(), camera: read(CAMERA_KEY) ?? "", mode: "link", ...LINK });
  root.querySelector(".mdm-stage")?.insertAdjacentHTML("afterbegin", `<p class="net-caption" data-i18n="net.screenCaption">${t("net.screenCaption")}</p>`);
  root.querySelector(".mdm-side")?.insertAdjacentHTML("afterbegin", `<p class="net-caption" data-i18n="net.cameraCaption">${t("net.cameraCaption")}</p>`);
  return modem;
}

async function listCameras(): Promise<void> {
  const select = el<HTMLSelectElement>("net-camera");
  if (!select || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    const chosen = modem?.current.camera ?? read(CAMERA_KEY) ?? "";
    const options = [new Option(t("net.cameraDefault"), "")];
    cams.forEach((cam, i) => options.push(new Option(cam.label || `${t("net.camera")} ${i + 1}`, cam.deviceId)));
    select.replaceChildren(...options);
    select.value = cams.some((cam) => cam.deviceId === chosen) ? chosen : "";
  } catch {
    /* no devices API */
  }
}

function closeLink(): void {
  link?.close();
  link = null;
  modem?.useLink(null);
}

function setRole(next: Role): void {
  if (next === role) return;
  stop();
  role = next;
  write(ROLE_KEY, role);
  errorKind = null;
  render();
}

async function serveBrowsing(current: LocalLink): Promise<void> {
  browseError = "";
  try {
    const { serveBrowseTransport } = await import("./transport.ts");
    if (link !== current) return;
    await serveBrowseTransport(current);
  } catch (e) {
    browseError = e instanceof Error ? e.message : String(e);
    render();
  }
}

/** The exit is wherever this page was served from: on a closed network that must be the offline package. */
function probeEgress(current: LocalLink): void {
  egressDown = false;
  let ws: WebSocket;
  try {
    ws = new WebSocket(wispUrl());
  } catch {
    egressDown = true;
    render();
    return;
  }
  const done = (ok: boolean) => {
    ws.onopen = ws.onerror = null;
    ws.close();
    if (link !== current) return;
    egressDown = !ok;
    render();
  };
  ws.onopen = () => done(true);
  ws.onerror = () => done(false);
}

async function start(): Promise<void> {
  errorKind = null;
  const m = ensureModem();
  closeLink();
  link = new LocalLink(role, DEVICE_NAME, wispUrl());
  m.useLink(link);
  if (role === "join") void serveBrowsing(link);
  else probeEgress(link);
  await m.start();
  if (!m.isRunning) closeLink();
  await listCameras();
  render();
  publish();
}

function stop(): void {
  modem?.stop();
  closeLink();
  browseError = "";
  egressDown = false;
  render();
  publish();
}

function stateFor(h: HelperStatus | null): { state: string; hint: string; dot: string; code: string; actions: Action[] } {
  const running = !!modem?.isRunning;
  if (!running) return { state: t("net.state.off"), hint: t("net.hint.off"), dot: "", code: "", actions: [] };
  if (!h) return { state: t("net.idle.waiting"), hint: "", dot: "warn", code: "", actions: [] };
  if (h.state === "connected") {
    return h.linkUp
      ? { state: t("net.state.connected"), hint: t(role === "share" ? "net.hint.connectedShare" : "net.hint.connectedJoin"), dot: "ok", code: "", actions: ["disconnect"] }
      : { state: t("net.state.linkDown"), hint: t("net.hint.linkDown"), dot: "err", code: "", actions: ["disconnect"] };
  }
  if (role === "share") {
    if (h.awaiting) return { state: t("net.state.awaitingShare"), hint: t("net.hint.awaitingShare"), dot: "warn", code: h.code, actions: ["authorize", "reject"] };
    return { state: t("net.state.offering"), hint: t("net.hint.offering"), dot: "warn", code: "", actions: [] };
  }
  if (h.state === "searching") return { state: t("net.state.searching"), hint: t("net.hint.searching"), dot: "warn", code: "", actions: [] };
  if (h.state === "requesting") {
    return h.awaiting
      ? { state: t("net.state.awaitingJoin"), hint: t("net.hint.awaitingJoin"), dot: "warn", code: h.code, actions: [] }
      : { state: t("net.state.requesting"), hint: t("net.hint.requesting"), dot: "warn", code: h.code, actions: [] };
  }
  if (h.state === "rejected") return { state: t("net.state.rejected"), hint: t("net.hint.closed"), dot: "err", code: "", actions: ["reconnect"] };
  return { state: t("net.state.closed"), hint: t("net.hint.closed"), dot: "", code: "", actions: ["reconnect"] };
}

const ACTION_CLASS: Record<Action, string> = {
  authorize: "btn-primary",
  reject: "btn-secondary",
  disconnect: "btn-secondary",
  reconnect: "btn-primary",
};

function renderActions(actions: Action[]): void {
  const key = `${actions.join(",")}|${document.documentElement.lang}`;
  if (key === actionsKey) return;
  actionsKey = key;
  const box = el("net-actions");
  if (!box) return;
  box.replaceChildren(
    ...actions.map((action) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = ACTION_CLASS[action];
      btn.textContent = t(`net.action.${action}`);
      btn.dataset.netAction = action;
      return btn;
    }),
  );
  box.hidden = actions.length === 0;
}

function errorText(): string {
  if (browseError) return t("browse.failed", { msg: browseError });
  if (egressDown && role === "share") return t("net.error.egress");
  if (!errorKind || errorKind === "helper" || errorKind === "address") return "";
  if (errorKind === "camera") return t("net.error.camera", { msg: errorDetail });
  return t(`net.error.${errorKind}`);
}

function render(): void {
  if (!mounted) return;
  const running = !!modem?.isRunning;
  const h = running ? (snapshot?.helper ?? null) : null;

  document.querySelectorAll<HTMLButtonElement>("[data-net-role]").forEach((btn) => {
    const active = btn.dataset.netRole === role;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.body.classList.toggle("net-share", role === "share");
  document.body.classList.toggle("net-join", role === "join");

  const grid = modem?.current.grid ?? savedGrid();
  const stage = el("net-modem")!;
  stage.style.setProperty("--net-aspect", grid === 2 ? "2 / 1" : "1 / 1");
  stage.style.setProperty("--net-aspect-narrow", grid === 2 ? "1 / 2" : "1 / 1");
  document.querySelectorAll<HTMLButtonElement>("[data-net-grid]").forEach((btn) => {
    const on = Number(btn.dataset.netGrid) === grid;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });

  const view = stateFor(h);
  el("net-state")!.textContent = view.state;
  el("net-hint")!.textContent = view.hint;
  el("net-hint")!.hidden = !view.hint;
  el("net-dot")!.className = `net-dot ${view.dot}`;

  el("net-code")!.hidden = !view.code;
  el("net-code-value")!.textContent = view.code;
  renderActions(view.actions);

  el("net-browse")!.hidden = !(running && role === "join");

  const err = errorText();
  el("net-error")!.hidden = !err;
  el("net-error")!.textContent = err;

  el("net-start")!.hidden = running;
  el("net-stop")!.hidden = !running;
  el("net-fullscreen")!.hidden = !running;

  const fps = el<HTMLSelectElement>("net-fps");
  const currentFps = String(modem?.current.fps ?? LINK.fps);
  if (fps && fps.value !== currentFps && [...fps.options].some((option) => option.value === currentFps)) fps.value = currentFps;
  syncDesk(link, !!(running && h?.state === "connected" && h.linkUp));
}

function pageUrl(raw: string): string {
  const text = raw.trim();
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text) || /^localhost(:\d+)?(\/\S*)?$/i.test(text)) return `https://${text}`;
  return `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(text)}`;
}

/** The portable file cannot register the proxy service worker, so the window loads pages through the link directly. */
function openFileBrowse(features: string): void {
  const child = window.open("", "wf-browse", features);
  if (!child) return;
  const host = window as Window & { __wfLoad?: (url: string) => Promise<string> };
  host.__wfLoad = async (raw: string) => {
    if (!link || link.role !== "join") throw new Error(t("browse.status.waiting"));
    const { loadThroughLink } = await import("./transport.ts");
    return loadThroughLink(link, pageUrl(raw));
  };
  child.document.open();
  child.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>WayFold</title>
<style>body{margin:0;font:15px/1.4 sans-serif;display:flex;flex-direction:column;height:100vh}form{display:flex;gap:8px;padding:8px;background:#1c2430}input{flex:1;padding:8px 10px;border-radius:8px;border:0}button{padding:8px 14px;border:0;border-radius:8px;background:#3d9a6a;color:#fff}iframe{flex:1;width:100%;border:0}p{margin:8px;color:#a33}</style>
</head><body><form><input id="u" placeholder="https://"><button>Vai</button></form><p id="e" hidden></p><iframe id="f" sandbox="allow-scripts allow-forms allow-popups"></iframe>
<script>
var f=document.getElementById("f"),e=document.getElementById("e"),box=document.getElementById("u");
function go(url){e.hidden=true;e.textContent="";opener.__wfLoad(url).then(function(html){f.srcdoc=html}).catch(function(err){e.hidden=false;e.textContent=err&&err.message?err.message:String(err)})}
document.querySelector("form").onsubmit=function(ev){ev.preventDefault();go(box.value)};
window.addEventListener("message",function(ev){if(ev.data&&ev.data.t==="wf-go"&&ev.data.url){box.value=ev.data.url;go(ev.data.url)}});
</script></body></html>`);
  child.document.close();
}

function wireOnce(): void {
  if (wired) return;
  wired = true;
  document.querySelectorAll<HTMLButtonElement>("[data-net-role]").forEach((btn) => {
    btn.addEventListener("click", () => setRole(btn.dataset.netRole === "join" ? "join" : "share"));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-net-grid]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const grid = Number(btn.dataset.netGrid);
      write(GRID_KEY, String(grid));
      ensureModem().configure({ grid });
      render();
    });
  });
  el<HTMLSelectElement>("net-fps")?.addEventListener("change", (e) => {
    const fps = Number((e.target as HTMLSelectElement).value);
    if (!Number.isFinite(fps)) return;
    ensureModem().configure({ fps });
  });
  el<HTMLSelectElement>("net-camera")?.addEventListener("change", (e) => {
    const camera = (e.target as HTMLSelectElement).value;
    write(CAMERA_KEY, camera);
    ensureModem().configure({ camera });
  });
  el("net-start")?.addEventListener("click", () => void start());
  el("net-stop")?.addEventListener("click", stop);
  el("net-fullscreen")?.addEventListener("click", () => modem?.fullscreen());
  el("net-actions")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-net-action]");
    if (btn?.dataset.netAction) modem?.action(btn.dataset.netAction);
  });
  el("net-open-browse")?.addEventListener("click", () => {
    // A separate window: as a tab it would hide this page, and a hidden page stops painting QR codes.
    const w = Math.round(screen.availWidth * 0.8);
    const h = Math.round(screen.availHeight * 0.85);
    const features = `popup,width=${w},height=${h}`;
    if (location.protocol === "file:") {
      openFileBrowse(features);
      return;
    }
    window.open(BROWSE_URL, "wf-browse", features);
  });
  window.addEventListener("pagehide", () => broadcast({ t: "gone" }));
  onLangChange(() => {
    actionsKey = "";
    void listCameras();
    render();
  });
}

export function mountNet(): void {
  wireOnce();
  mounted = true;
  role = savedRole();
  ensureModem();
  void listCameras();
  render();
}

export function unmountNet(): void {
  stop();
  endOptSession();
  mounted = false;
  document.body.classList.remove("net-share", "net-join");
}

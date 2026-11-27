import { QR_MARGIN, frameBytesForGrid, rasterizeQr, symbolsFromWorker, type EccLevel } from "../shared/optical.ts";
import { TxPaintClock } from "../shared/tx-paint.ts";
import { getOptFlags } from "../shared/opt-flags.ts";
import { optTrace, timed, wallNow } from "../shared/opt-trace.ts";
import { ensureOptHud, removeOptHud, renderOptHud } from "../shared/opt-ui.ts";
import {
  applyQrFocusConstraints,
  tapPointInVideoFrame,
  type FocusPoint,
  type QrTrackCapabilities,
} from "../receive/camera.ts";
import { workerPlanFields } from "../receive/worker-plan.ts";
import { jobLocalRects, RoiSession } from "../receive/roi.ts";
import type { Quad } from "../receive/decode-core.ts";

/**
 * Optical modem for Wayfold Connect. Knows nothing about the protocol: it
 * shows the frames the local helper hands it and forwards every QR the webcam
 * decodes. "Test" mode generates numbered frames locally to measure what a
 * screen -> webcam pair can actually carry before involving the helper.
 */

export type ModemMode = "link" | "test";

export interface ModemSettings {
  ws: string;
  mode: ModemMode;
  camera: string;
  grid: number;
  mtu: number;
  fps: number;
  ecc: EccLevel;
}

export type ModemErrorKind = "helper" | "camera-denied" | "camera-busy" | "camera-missing" | "camera" | "encode" | "decoder" | "address";

export interface ModemSnapshot {
  running: boolean;
  /** WebSocket to the local helper is open. */
  helperUp: boolean;
  helper: HelperStatus | null;
  rates: Record<string, number>;
}

export interface ModemOptions {
  key: string;
  title: string;
  defaults: Partial<ModemSettings>;
  /** Replaces the webcam (dual-modem bench test). */
  videoSource?: () => MediaStream;
  /** Product screen: no lab toolbar, link mode only; the host renders status and errors. */
  product?: boolean;
  onUpdate?: (snapshot: ModemSnapshot) => void;
  onError?: (kind: ModemErrorKind | null, detail: string) => void;
  /** Replaces the lab's Italian placeholder on the idle canvas. */
  idleText?: () => string;
}

/** A WFL1 peer running in this page, in place of the helper's WebSocket. */
export interface ModemLink {
  pull(n: number, mtu: number): Uint8Array[];
  push(frame: Uint8Array): void;
  status(): HelperStatus;
  action(name: string): boolean;
}

export interface HelperStatus {
  role: "gateway" | "client";
  name: string;
  state: string;
  code: string;
  awaiting: boolean;
  linkUp: boolean;
  rttMs: number;
  inKBs: number;
  outKBs: number;
  inBytes: number;
  outBytes: number;
}

interface Encoded {
  size: number;
  mods: Uint8Array[];
}

const MTU_OPTIONS = [400, 600, 900, 1200, 1500, 1850, 2300];
const FPS_OPTIONS = [8, 10, 12, 15, 20, 24, 30];
const GRID_OPTIONS = [1, 2, 3, 4];
const DECODE_WORKERS = 3;
const RECENT_KEYS = 1024;
const TEST_MAGIC0 = 0x57; // "WT"
const TEST_MAGIC1 = 0x54;
const RECONNECT_MS = 2000;

const STATE_TEXT: Record<string, string> = {
  offering: "in attesa di un client",
  connected: "connesso",
  searching: "ricerca del gateway",
  requesting: "richiesta inviata",
  rejected: "richiesta rifiutata",
  closed: "disconnesso",
};

function defaultSettings(over: Partial<ModemSettings>): ModemSettings {
  return { ws: "ws://127.0.0.1:7701/modem-ws", mode: "link", camera: "", grid: 2, mtu: 1200, fps: 15, ecc: "L", ...over };
}

function layout(n: number, landscape: boolean): { cols: number; rows: number } {
  const g = n === 4 ? { cols: 2, rows: 2 } : { cols: Math.max(1, Math.min(3, n)), rows: 1 };
  return landscape ? g : { cols: g.rows, rows: g.cols };
}

function hexKey(b: Uint8Array): string {
  let s = String(b.length);
  for (let i = 0; i < Math.min(14, b.length); i++) s += (b[i]! < 16 ? "0" : "") + b[i]!.toString(16);
  return s;
}

const TURN_KEY = "wf-cam-turn";

function readTurn(): number {
  try {
    const n = Number(localStorage.getItem(TURN_KEY));
    return n === 90 || n === 180 || n === 270 ? n : 0;
  } catch {
    return 0;
  }
}

function writeTurn(angle: number): void {
  try {
    localStorage.setItem(TURN_KEY, String(angle));
  } catch {
    /* private mode */
  }
}

function option(value: string | number, label: string): HTMLOptionElement {
  const o = document.createElement("option");
  o.value = String(value);
  o.textContent = label;
  return o;
}

const TEMPLATE = `
  <div class="mdm-bar">
    <strong class="mdm-title" data-r="title"></strong>
    <span class="mdm-badge" data-r="badge">fermo</span>
    <label>Modalità <select data-r="mode"><option value="link">Link (helper)</option><option value="test">Test velocità</option></select></label>
    <label class="mdm-ws">Helper <input data-r="ws" spellcheck="false" list="mdm-ws-list"></label>
    <label>Webcam <select data-r="camera"><option value="">predefinita</option></select></label>
    <label>QR <select data-r="grid"></select></label>
    <label>Byte/QR <select data-r="mtu"></select></label>
    <label>fps <select data-r="fps"></select></label>
    <label>ECC <select data-r="ecc"><option>L</option><option>M</option><option>Q</option></select></label>
    <button type="button" class="mdm-primary" data-r="start">Avvia</button>
    <button type="button" data-r="stop" hidden>Ferma</button>
    <button type="button" data-r="fs">Schermo intero QR</button>
  </div>
  <div class="mdm-body">
    <div class="mdm-stage" data-r="stage">
      <canvas data-r="canvas"></canvas>
      <div class="mdm-strip" data-r="strip"></div>
    </div>
    <aside class="mdm-side">
      <div class="mdm-preview" data-r="preview">
        <video data-r="video" muted playsinline autoplay></video>
        <button type="button" class="mdm-turn" data-r="turn" hidden>Ruota</button>
      </div>
      <div class="mdm-peer" data-r="peer"></div>
      <dl class="mdm-stats" data-r="stats"></dl>
      <p class="mdm-err" data-r="err" hidden></p>
    </aside>
  </div>`;

export class Modem {
  readonly root: HTMLElement;
  private readonly opts: ModemOptions;
  private settings: ModemSettings;
  private readonly r: Record<string, HTMLElement> = {};
  private running = false;

  // transmit
  private raf = 0;
  private nextTick = 0;
  private paintClock: TxPaintClock | null = null;
  private qrWorker: Worker | null = null;
  private encodeId = 0;
  private encoding = false;
  private awaitingBatch = false;
  private ready: Encoded | null = null;
  private shown: Encoded | null = null;
  private version: number | undefined;
  private readonly staging: HTMLCanvasElement[] = [];
  private testRun = 0;
  private testSeq = 0;

  // receive
  private stream: MediaStream | null = null;
  /** 0, 90, 180 or 270. The preview and the QR reader use the same angle. */
  private turn = readTurn();
  private captureGen = 0;
  private readonly workers: Worker[] = [];
  private readonly busy: boolean[] = [];
  private readonly grab = document.createElement("canvas");
  private readonly recent = new Set<string>();
  private readonly recentOrder: string[] = [];

  // helper link
  private ws: WebSocket | null = null;
  private reconnectTimer = 0;
  private helper: HelperStatus | null = null;
  private link: ModemLink | null = null;
  private linkTimer = 0;

  // stats
  private statsTimer = 0;
  private c = { tx: 0, cam: 0, decodes: 0, symbols: 0, unique: 0, uniqueBytes: 0, dropped: 0, sent: 0 };
  private last = { ...this.c, t: 0 };
  private testWindow: number[] = [];
  private rates: Record<string, number> = {};
  private wake: WakeLockSentinel | null = null;

  constructor(root: HTMLElement, opts: ModemOptions) {
    this.root = root;
    this.opts = opts;
    this.settings = this.load();
    root.classList.add("mdm");
    if (opts.product) {
      root.classList.add("mdm--product");
      this.settings.mode = "link";
    }
    root.innerHTML = TEMPLATE;
    root.querySelectorAll<HTMLElement>("[data-r]").forEach((node) => (this.r[node.dataset.r!] = node));
    this.r.title!.textContent = opts.title;
    this.fillSelects();
    this.wire();
    this.renderSide();
    this.drawIdle("Premi Avvia");
  }

  get canvas(): HTMLCanvasElement {
    return this.r.canvas as HTMLCanvasElement;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get current(): Readonly<ModemSettings> {
    return this.settings;
  }

  /** Changes settings from the host screen; a running link restarts with them. */
  configure(next: Partial<ModemSettings>): void {
    const changed = (Object.keys(next) as (keyof ModemSettings)[]).some((k) => next[k] !== undefined && next[k] !== this.settings[k]);
    if (!changed) return;
    this.settings = { ...this.settings, ...next };
    if (this.opts.product) this.settings.mode = "link";
    this.save();
    this.fillSelects();
    this.renderSide();
    if (this.running) void this.restart();
  }

  /** Takes effect on the next start; null goes back to the helper WebSocket. */
  useLink(link: ModemLink | null): void {
    if (this.running) this.stop();
    this.link = link;
  }

  /** Same actions as the helper panel (authorize, reject, disconnect, reconnect). */
  action(name: string): boolean {
    if (this.link) return this.link.action(name);
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ t: "action", action: name }));
    return true;
  }

  fullscreen(): void {
    void this.r.stage!.requestFullscreen?.().catch(() => undefined);
  }

  // --- settings -----------------------------------------------------------

  private load(): ModemSettings {
    const base = defaultSettings(this.opts.defaults);
    const fromUrl = new URLSearchParams(location.search).get("ws");
    try {
      const saved = JSON.parse(localStorage.getItem(`wf-modem:${this.opts.key}`) ?? "{}") as Partial<ModemSettings>;
      return { ...base, ...saved, ...(fromUrl ? { ws: fromUrl } : {}) };
    } catch {
      return base;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(`wf-modem:${this.opts.key}`, JSON.stringify(this.settings));
    } catch {
      /* private mode */
    }
  }

  private fillSelects(): void {
    const sel = (k: string) => this.r[k] as HTMLSelectElement;
    sel("grid").replaceChildren(...GRID_OPTIONS.map((n) => option(n, String(n))));
    sel("mtu").replaceChildren(...MTU_OPTIONS.map((n) => option(n, String(n))));
    sel("fps").replaceChildren(...FPS_OPTIONS.map((n) => option(n, String(n))));
    sel("mode").value = this.settings.mode;
    sel("grid").value = String(this.settings.grid);
    sel("mtu").value = String(this.settings.mtu);
    sel("fps").value = String(this.settings.fps);
    sel("ecc").value = this.settings.ecc;
    (this.r.ws as HTMLInputElement).value = this.settings.ws;
    if (this.opts.videoSource) {
      sel("camera").replaceChildren(option("", "canvas dell'altro modem"));
      sel("camera").disabled = true;
    } else void this.listCameras();
  }

  private async listCameras(): Promise<void> {
    const sel = this.r.camera as HTMLSelectElement;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      sel.replaceChildren(
        option("", "predefinita"),
        ...devices.map((d, i) => option(d.deviceId, d.label || `Webcam ${i + 1}`)),
      );
      sel.value = devices.some((d) => d.deviceId === this.settings.camera) ? this.settings.camera : "";
    } catch {
      /* no devices API */
    }
  }

  private wire(): void {
    const onChange = () => {
      const s = this.settings;
      s.mode = (this.r.mode as HTMLSelectElement).value as ModemMode;
      s.ws = (this.r.ws as HTMLInputElement).value.trim();
      s.camera = (this.r.camera as HTMLSelectElement).value;
      s.grid = Number((this.r.grid as HTMLSelectElement).value);
      s.mtu = Number((this.r.mtu as HTMLSelectElement).value);
      s.fps = Number((this.r.fps as HTMLSelectElement).value);
      s.ecc = (this.r.ecc as HTMLSelectElement).value as EccLevel;
      this.save();
      this.renderSide();
      if (this.running) void this.restart();
    };
    for (const k of ["mode", "camera", "grid", "mtu", "fps", "ecc"]) this.r[k]!.addEventListener("change", onChange);
    this.r.ws!.addEventListener("change", onChange);
    this.r.start!.addEventListener("click", () => void this.start());
    this.r.stop!.addEventListener("click", () => this.stop());
    this.r.fs!.addEventListener("click", () => void this.r.stage!.requestFullscreen?.().catch(() => undefined));
    this.r.turn?.addEventListener("click", () => {
      this.turn = (this.turn + 90) % 360;
      writeTurn(this.turn);
      this.applyTurn(this.r.video as HTMLVideoElement);
    });
    this.r.preview?.addEventListener("pointerdown", (ev) => this.onPreviewPointer(ev as PointerEvent));
    new ResizeObserver(() => this.redraw()).observe(this.r.stage!);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.running) void this.acquireWake();
    });
  }

  private readonly roi = new RoiSession();
  private grabGen = 0;
  private readonly slotGrab: { gen: number; ox: number; oy: number }[] = [];
  private focusBusy = false;
  private focusQueued: FocusPoint | null = null;

  private onPreviewPointer(ev: PointerEvent): void {
    if (!this.running || !this.stream) return;
    const preview = this.r.preview as HTMLElement | undefined;
    const video = this.r.video as HTMLVideoElement | undefined;
    if (!preview || !video) return;
    const point = tapPointInVideoFrame(
      ev.clientX,
      ev.clientY,
      preview.getBoundingClientRect(),
      video.videoWidth,
      video.videoHeight,
      "cover",
    );
    let mark = preview.querySelector<HTMLElement>("[data-focus-reticle]");
    if (!mark) {
      mark = document.createElement("span");
      mark.dataset.focusReticle = "1";
      mark.className = "focus-reticle";
      preview.append(mark);
    }
    mark.style.left = `${point.x * 100}%`;
    mark.style.top = `${point.y * 100}%`;
    mark.classList.remove("is-flash");
    void mark.offsetWidth;
    mark.classList.add("is-flash");
    void this.applyFocus(point, "tap");
  }

  private async applyFocus(point: FocusPoint, kind: "startup" | "tap"): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;
    if (this.focusBusy) {
      this.focusQueued = point;
      return;
    }
    this.focusBusy = true;
    try {
      let caps: QrTrackCapabilities = {};
      try {
        caps = (track.getCapabilities?.() ?? {}) as QrTrackCapabilities;
      } catch {
        /* ignore */
      }
      const flags = getOptFlags();
      const result = await applyQrFocusConstraints(
        track,
        caps,
        point,
        kind === "tap" ? "single-shot" : "continuous",
        kind,
        flags.exposure,
      );
      optTrace.noteExposure({
        intent: flags.exposure,
        applied: result.exposureApplied,
        mode: result.settings.exposureMode ?? null,
        timeS: result.settings.exposureTime ?? null,
        compensation: result.settings.exposureCompensation ?? null,
        modes: caps.exposureMode ?? [],
      });
    } finally {
      this.focusBusy = false;
      const next = this.focusQueued;
      this.focusQueued = null;
      if (next && this.running) void this.applyFocus(next, "tap");
    }
  }

  // --- lifecycle ----------------------------------------------------------

  async start(): Promise<void> {
    if (this.running) return;
    this.error(null);
    this.running = true;
    this.version = undefined;
    this.ready = null;
    this.encoding = false;
    this.awaitingBatch = false;
    this.testRun = (Math.random() * 0xffffffff) >>> 0;
    this.testSeq = 0;
    this.testWindow = [];
    if (getOptFlags().perf) {
      optTrace.reset();
      optTrace.configuredFps = this.settings.fps;
    }
    this.roi.reset();
    this.grabGen = 0;
    this.renderControls();
    this.qrWorker = new Worker(new URL("./qr-worker.ts", import.meta.url), { type: "module" });
    this.qrWorker.onmessage = (e) => this.onEncoded(e.data);
    this.startDecoders();
    if (this.settings.mode === "link") this.connect();
    else this.drawIdle("Test velocità: generazione frame");
    this.last = { ...this.c, t: performance.now() };
    this.statsTimer = window.setInterval(() => this.tickStats(), 1000);
    this.nextTick = performance.now();
    this.paintClock = getOptFlags().perf ? new TxPaintClock(this.settings.fps || 30) : null;
    this.raf = requestAnimationFrame(this.frame);
    void this.acquireWake();
    this.renderSide();
    const ok = await this.attachCamera();
    if (this.running && getOptFlags().perf) {
      try {
        const settings = this.stream?.getVideoTracks()[0]?.getSettings?.() ?? {};
        optTrace.negotiatedFps = Number(settings.frameRate) || 0;
      } catch {
        optTrace.negotiatedFps = 0;
      }
      ensureOptHud(this.root);
    }
    if (this.running && !ok) this.stop();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.statsTimer);
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.linkTimer);
    this.captureGen++;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const preview = this.r.video as HTMLVideoElement;
    preview.srcObject = null;
    preview.style.transform = "";
    preview.style.width = "";
    preview.style.height = "";
    if (this.r.turn) this.r.turn.hidden = true;
    this.qrWorker?.terminate();
    this.qrWorker = null;
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.busy.length = 0;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.helper = null;
    void this.wake?.release().catch(() => undefined);
    this.wake = null;
    removeOptHud(this.root);
    this.renderControls();
    this.renderSide();
    this.drawIdle("Fermo");
  }

  private async restart(): Promise<void> {
    this.stop();
    await this.start();
  }

  private async acquireWake(): Promise<void> {
    try {
      if (!this.wake || this.wake.released) this.wake = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      /* not granted */
    }
  }

  // --- helper websocket ---------------------------------------------------

  private connect(): void {
    if (!this.running || this.settings.mode !== "link") return;
    const link = this.link;
    if (link) {
      const poll = () => {
        this.helper = link.status();
        this.renderSide();
      };
      poll();
      this.linkTimer = window.setInterval(poll, 500);
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.settings.ws);
    } catch (e) {
      this.error(`Indirizzo helper non valido: ${e instanceof Error ? e.message : e}`, "address");
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.error(null);
      this.awaitingBatch = false;
      ws.send(JSON.stringify({ t: "hello", mtu: this.settings.mtu, grid: this.settings.grid, fps: this.settings.fps }));
      this.renderSide();
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        try {
          const msg = JSON.parse(e.data);
          if (msg.t === "status") {
            this.helper = msg as HelperStatus;
            this.renderSide();
          }
        } catch {
          /* ignore */
        }
        return;
      }
      this.onBatch(new Uint8Array(e.data as ArrayBuffer));
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.helper = null;
      this.awaitingBatch = false;
      if (!this.running) return;
      this.error(`Helper non raggiungibile su ${this.settings.ws}: avvia "npm run gateway" o "npm run client" in apps/wayfold-connect. Nuovo tentativo…`, "helper");
      this.drawIdle("Helper non collegato");
      this.renderSide();
      this.reconnectTimer = window.setTimeout(() => this.connect(), RECONNECT_MS);
    };
  }

  private onBatch(buf: Uint8Array): void {
    this.awaitingBatch = false;
    const n = buf[0] ?? 0;
    const frames: Uint8Array[] = [];
    let off = 1;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < n && off + 2 <= buf.length; i++) {
      const len = dv.getUint16(off);
      frames.push(buf.slice(off + 2, off + 2 + len));
      off += 2 + len;
    }
    if (!frames.length) {
      this.ready = { size: 0, mods: [] };
      return;
    }
    this.encode(frames);
  }

  // --- transmit -----------------------------------------------------------

  private readonly frame = (t: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    this.paintClock?.noteFrame(t);
    if (t < this.nextTick) return;
    const step = 1000 / this.settings.fps;
    const behind = t - this.nextTick;
    const skipped = behind > 3 * step ? Math.floor(behind / step) : 0;
    this.nextTick = skipped > 0 ? t + step : this.nextTick + step;
    if (this.ready) {
      this.shown = this.ready;
      this.ready = null;
      this.draw(this.shown);
      if (this.shown.mods.length) this.c.tx++;
      this.paintClock?.noteSwap(t, skipped);
    } else {
      this.paintClock?.noteStarved();
    }
    if (this.paintClock) {
      optTrace.noteTx(this.paintClock.snapshot());
      renderOptHud(this.root);
    }
    this.requestNext();
  };

  private requestNext(): void {
    if (this.encoding || this.awaitingBatch || this.ready) return;
    if (this.settings.mode === "test") {
      this.encode(this.testFrames());
      return;
    }
    if (this.link) {
      const box = this.canvas.getBoundingClientRect();
      const mtu = Math.max(200, frameBytesForGrid(this.settings.mtu, this.settings.grid, box.width, box.height, window.devicePixelRatio || 1));
      const frames = this.link.pull(this.settings.grid, mtu);
      if (frames.length) this.encode(frames);
      else if (!this.shown && !this.encoding) this.drawIdle(this.opts.idleText?.() ?? "In attesa");
      return;
    }
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.awaitingBatch = true;
    this.ws.send(JSON.stringify({ t: "pull", n: this.settings.grid }));
  }

  private testFrames(): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (let i = 0; i < this.settings.grid; i++) {
      const f = new Uint8Array(this.settings.mtu);
      const dv = new DataView(f.buffer);
      f[0] = TEST_MAGIC0;
      f[1] = TEST_MAGIC1;
      dv.setUint32(2, this.testRun);
      dv.setUint32(6, this.testSeq++);
      let x = (this.testSeq * 2654435761) >>> 0 || 1;
      for (let j = 10; j < f.length; j++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        f[j] = x & 0xff;
      }
      out.push(f);
    }
    return out;
  }

  private encode(frames: Uint8Array[]): void {
    if (!this.qrWorker) return;
    this.encoding = true;
    this.qrWorker.postMessage({ id: ++this.encodeId, frames, ecc: this.settings.ecc, version: this.version });
  }

  private onEncoded(data: { id: number; size?: number; version?: number; mods?: Uint8Array[]; error?: string }): void {
    if (data.id !== this.encodeId) return;
    this.encoding = false;
    if (data.error || !data.mods || !data.size) {
      this.error(`Codifica QR non riuscita (${data.error ?? "?"}): riduci Byte/QR o usa ECC L`, "encode");
      return;
    }
    this.version = data.version;
    this.ready = { size: data.size, mods: data.mods };
  }

  private sizeCanvas(): { w: number; h: number } {
    const canvas = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h };
  }

  private redraw(): void {
    if (this.shown) this.draw(this.shown);
  }

  private draw(img: Encoded): void {
    const { w, h } = this.sizeCanvas();
    const ctx = this.canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    if (!img.mods.length) return;
    const total = img.size + 2 * QR_MARGIN;
    const { cols, rows } = layout(img.mods.length, w >= h);
    const scale = Math.max(1, Math.floor(Math.min(w / cols, h / rows) / total));
    const px = total * scale;
    const ox = Math.floor((w - cols * px) / 2);
    const oy = Math.floor((h - rows * px) / 2);
    ctx.imageSmoothingEnabled = false;
    img.mods.forEach((mods, i) => {
      let stage = this.staging[i];
      if (!stage) {
        stage = document.createElement("canvas");
        this.staging[i] = stage;
      }
      if (stage.width !== total) {
        stage.width = total;
        stage.height = total;
      }
      stage.getContext("2d")!.putImageData(rasterizeQr(img.size, mods, QR_MARGIN), 0, 0);
      ctx.drawImage(stage, ox + (i % cols) * px, oy + Math.floor(i / cols) * px, px, px);
    });
  }

  private drawIdle(text: string): void {
    this.shown = null;
    const { w, h } = this.sizeCanvas();
    const ctx = this.canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#8a9690";
    ctx.font = `${Math.round(Math.min(w, h) / 22)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(this.opts.idleText?.() ?? text, w / 2, h / 2);
  }

  // --- receive ------------------------------------------------------------

  private startDecoders(): void {
    for (let i = 0; i < DECODE_WORKERS; i++) {
      const worker = new Worker(new URL("../receive/worker.ts", import.meta.url), { type: "module" });
      const slot = i;
      worker.onmessage = (e: MessageEvent) => {
        const { id, error, postedAt, doneAt, startedAt, quads, passes, skipped } = e.data as {
          id: number;
          error?: string;
          postedAt?: number;
          doneAt?: number;
          startedAt?: number;
          quads?: (Quad | null)[];
          passes?: { pass: string; ms: number }[];
          skipped?: number;
        };
        if (error) {
          this.error(`Decoder QR non disponibile: ${error}`, "decoder");
          return;
        }
        if (id === -1) return;
        this.busy[slot] = false;
        optTrace.setWorkers(this.busy.filter(Boolean).length, this.workers.length);
        optTrace.noteWorkerTurn(postedAt, startedAt, doneAt);
        optTrace.notePasses(passes, skipped ?? 0);
        const grabMeta = this.slotGrab[slot];
        if (grabMeta) {
          const t0 = wallNow();
          this.roi.push(grabMeta.gen, quads, grabMeta.ox, grabMeta.oy);
          optTrace.mark("aggregate", t0, wallNow() - t0);
        }
        this.c.decodes++;
        for (const s of symbolsFromWorker(e.data)) this.onSymbol(s);
      };
      worker.onerror = () => {
        this.busy[slot] = false;
      };
      this.workers.push(worker);
      this.busy.push(false);
    }
    optTrace.setWorkers(0, this.workers.length);
  }

  private async attachCamera(): Promise<boolean> {
    const gen = ++this.captureGen;
    let stream: MediaStream;
    try {
      if (this.opts.videoSource) stream = this.opts.videoSource();
      else {
        const phone = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
        const video: MediaTrackConstraints = {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        };
        if (this.settings.camera) video.deviceId = { exact: this.settings.camera };
        else if (phone) video.facingMode = { ideal: "environment" };
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      }
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      const kind: ModemErrorKind = /NotAllowed/i.test(msg)
        ? "camera-denied"
        : /NotReadable|TrackStart/i.test(msg)
          ? "camera-busy"
          : /NotFound|DevicesNotFound|Overconstrained/i.test(msg)
            ? "camera-missing"
            : "camera";
      this.error(
        kind === "camera-denied"
          ? "Permesso webcam negato: consentilo dal lucchetto nella barra degli indirizzi."
          : kind === "camera-busy"
            ? "Webcam occupata da un'altra app o da un'altra scheda."
            : `Webcam non disponibile (${msg}).`,
        kind,
        msg,
      );
      return false;
    }
    if (!this.running || gen !== this.captureGen) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    this.stream = stream;
    const video = this.r.video as HTMLVideoElement;
    video.srcObject = stream;
    this.r.turn!.hidden = false;
    video.onloadedmetadata = () => this.applyTurn(video);
    this.applyTurn(video);
    void video.play().catch(() => undefined);
    void this.applyFocus({ x: 0.5, y: 0.5 }, "startup");
    if (!this.opts.videoSource) void this.listCameras();
    this.scheduleCapture(gen);
    return true;
  }

  private scheduleCapture(gen: number): void {
    const video = this.r.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (
        cb: (now: number, meta?: { presentedFrames?: number; mediaTime?: number }) => void,
      ) => number;
    };
    const next = (_now?: number, meta?: { presentedFrames?: number; mediaTime?: number }) => {
      if (!this.running || gen !== this.captureGen) return;
      optTrace.noteVideoMeta(meta);
      this.capture(video);
      this.scheduleCapture(gen);
    };
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(next);
    else requestAnimationFrame(() => next());
  }

  private applyTurn(video: HTMLVideoElement): void {
    const box = video.parentElement?.getBoundingClientRect();
    const quarter = this.turn % 180 !== 0;
    video.style.transform = this.turn ? `rotate(${this.turn}deg)` : "";
    if (!box || !quarter) {
      video.style.width = "100%";
      video.style.height = "100%";
      return;
    }
    video.style.width = `${box.height}px`;
    video.style.height = `${box.width}px`;
  }

  private capture(video: HTMLVideoElement): void {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    this.c.cam++;
    const free: number[] = [];
    for (let i = 0; i < this.busy.length; i++) if (!this.busy[i]) free.push(i);
    if (free.length === 0) {
      this.c.dropped++;
      return;
    }
    const quarter = this.turn % 180 !== 0;
    const dw = quarter ? vh : vw;
    const dh = quarter ? vw : vh;
    const flags = getOptFlags();
    const jobs = this.roi.jobs(dw, dh, free.length, flags.roi).slice(0, free.length);
    const gen = ++this.grabGen;
    this.roi.begin(gen, jobs.length, jobs.every((j) => j.full), dw, dh);
    let pixels = 0;
    for (const job of jobs) pixels += job.rect.w * job.rect.h;
    optTrace.noteGrab(jobs.length, pixels, jobs.some((j) => j.full));
    const rotated = this.turn !== 0;
    const ctx = this.grab.getContext("2d", { willReadFrequently: true })!;
    if (rotated) {
      if (this.grab.width !== dw || this.grab.height !== dh) {
        this.grab.width = dw;
        this.grab.height = dh;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (this.turn === 90) {
        ctx.translate(vh, 0);
        ctx.rotate(Math.PI / 2);
      } else if (this.turn === 180) {
        ctx.translate(vw, vh);
        ctx.rotate(Math.PI);
      } else if (this.turn === 270) {
        ctx.translate(0, vw);
        ctx.rotate(-Math.PI / 2);
      }
      ctx.drawImage(video, 0, 0);
    }
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i]!;
      const slot = free[i]!;
      const img = timed("extract", () => {
        if (rotated) return ctx.getImageData(job.rect.x, job.rect.y, job.rect.w, job.rect.h);
        if (this.grab.width !== job.rect.w || this.grab.height !== job.rect.h) {
          this.grab.width = job.rect.w;
          this.grab.height = job.rect.h;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(video, job.rect.x, job.rect.y, job.rect.w, job.rect.h, 0, 0, job.rect.w, job.rect.h);
        return ctx.getImageData(0, 0, job.rect.w, job.rect.h);
      }, job.full ? "full" : "crop");
      this.busy[slot] = true;
      this.slotGrab[slot] = { gen, ox: job.rect.x, oy: job.rect.y };
      const fps = optTrace.observedFps() || optTrace.negotiatedFps || this.settings.fps || 30;
      const rects = jobLocalRects(job);
      const plan = workerPlanFields(fps, job.full ? this.roi.state.expected : Math.max(1, job.boxes.length), rects);
      this.workers[slot]!.postMessage(
        { id: gen, buf: img.data.buffer, w: job.rect.w, h: job.rect.h, postedAt: wallNow(), ...plan },
        [img.data.buffer],
      );
    }
    optTrace.setWorkers(this.busy.filter(Boolean).length, this.workers.length);
    optTrace.noteProcessed();
  }

  private onSymbol(bytes: Uint8Array): void {
    this.c.symbols++;
    const key = hexKey(bytes);
    if (this.recent.has(key)) return;
    this.recent.add(key);
    this.recentOrder.push(key);
    if (this.recentOrder.length > RECENT_KEYS) this.recent.delete(this.recentOrder.shift()!);
    this.c.unique++;
    this.c.uniqueBytes += bytes.length;
    optTrace.noteUniqueSymbol(bytes.length);
    if (bytes[0] === TEST_MAGIC0 && bytes[1] === TEST_MAGIC1 && bytes.length >= 10) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.testWindow.push(dv.getUint32(6));
      return;
    }
    if (this.settings.mode !== "link") return;
    if (this.link) {
      this.link.push(bytes);
      this.c.sent++;
    } else if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(bytes);
      this.c.sent++;
    }
  }

  // --- stats & UI ---------------------------------------------------------

  private tickStats(): void {
    const now = performance.now();
    const dt = (now - this.last.t) / 1000;
    if (dt <= 0) return;
    const d = (k: keyof typeof this.c) => (this.c[k] - this.last[k]) / dt;
    this.rates = {
      tx: d("tx"),
      cam: d("cam"),
      decodes: d("decodes"),
      symbols: d("symbols"),
      unique: d("unique"),
      kbs: d("uniqueBytes") / 1024,
      dropped: d("dropped"),
    };
    if (this.testWindow.length) {
      const seqs = this.testWindow;
      const span = Math.max(...seqs) - Math.min(...seqs) + 1;
      this.rates.loss = span > 0 ? Math.max(0, 1 - new Set(seqs).size / span) : 0;
      this.testWindow = [];
    } else delete this.rates.loss;
    this.last = { ...this.c, t: now };
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          t: "stats",
          stats: { camFps: this.rates.cam, decodesPerSec: this.rates.decodes, uniquePerSec: this.rates.unique, rxKBs: this.rates.kbs, txFps: this.rates.tx },
        }),
      );
    }
    if (getOptFlags().perf) {
      const rtt = this.helper?.state === "connected" ? this.helper.rttMs : null;
      optTrace.setArqRtt(rtt);
      renderOptHud(this.root);
    }
    this.renderSide();
  }

  private renderControls(): void {
    this.r.start!.hidden = this.running;
    this.r.stop!.hidden = !this.running;
  }

  private renderSide(): void {
    const s = this.settings;
    const h = this.helper;
    const badge = this.r.badge!;
    let text = "fermo";
    let cls = "";
    if (this.running && s.mode === "test") {
      text = "test velocità";
      cls = "is-test";
    } else if (this.running && !h) {
      text = "helper non collegato";
      cls = "is-err";
    } else if (h) {
      text = `${h.role === "gateway" ? "GATEWAY" : "CLIENT"} · ${STATE_TEXT[h.state] ?? h.state}`;
      cls = h.state === "connected" ? (h.linkUp ? "is-ok" : "is-err") : "is-warn";
    }
    badge.textContent = text;
    badge.className = `mdm-badge ${cls}`;

    const strip = this.r.strip!;
    const capacity = (s.grid * s.fps * s.mtu / 1024).toFixed(0);
    strip.textContent = h
      ? `${this.opts.title} · ${h.name} · ${STATE_TEXT[h.state] ?? h.state}${h.code ? ` · codice ${h.code}` : ""}${h.state === "connected" ? ` · ${h.linkUp ? "link attivo" : "LINK INTERROTTO"} · RTT ${h.rttMs} ms` : ""}`
      : `${this.opts.title} · ${s.grid} QR × ${s.fps} fps × ${s.mtu} B (max ${capacity} KiB/s)`;

    const peer = this.r.peer!;
    if (h?.code && h.state !== "connected") {
      peer.innerHTML = `<span>Codice di verifica</span><b>${h.code}</b><small>${h.role === "gateway" ? (h.awaiting ? "Confrontalo con il client e autorizza dal pannello" : "") : h.awaiting ? "Comunicalo all'operatore del gateway" : "In attesa che il gateway legga questo schermo"}</small>`;
      peer.hidden = false;
    } else peer.hidden = true;

    const r = this.rates;
    const rows: [string, string][] = [
      ["Frame mostrati/s", this.running ? (r.tx ?? 0).toFixed(1) : "–"],
      ["Fotogrammi webcam/s", this.running ? (r.cam ?? 0).toFixed(1) : "–"],
      ["Decodifiche/s", this.running ? (r.decodes ?? 0).toFixed(1) : "–"],
      ["QR letti nuovi/s", this.running ? (r.unique ?? 0).toFixed(1) : "–"],
      ["KiB/s ricevuti (grezzi)", this.running ? (r.kbs ?? 0).toFixed(1) : "–"],
    ];
    if (r.loss !== undefined) rows.push(["Perdita (test)", `${(r.loss * 100).toFixed(0)}%`]);
    if (h?.state === "connected") {
      rows.push(["Dati giù / su KiB/s", `${h.inKBs.toFixed(1)} / ${h.outKBs.toFixed(1)}`]);
      rows.push(["RTT", `${h.rttMs} ms`]);
    }
    rows.push(["Capacità TX teorica", `${capacity} KiB/s`]);
    this.r.stats!.replaceChildren(
      ...rows.flatMap(([k, v]) => {
        const dt = document.createElement("dt");
        dt.textContent = k;
        const dd = document.createElement("dd");
        dd.textContent = v;
        return [dt, dd];
      }),
    );
    this.opts.onUpdate?.({
      running: this.running,
      helperUp: this.running && this.link ? true : this.ws?.readyState === WebSocket.OPEN,
      helper: this.helper,
      rates: this.rates,
    });
  }

  private error(msg: string | null, kind?: ModemErrorKind, detail?: string): void {
    const el = this.r.err!;
    el.hidden = !msg;
    el.textContent = msg ?? "";
    this.opts.onError?.(msg ? (kind ?? null) : null, detail ?? msg ?? "");
  }
}

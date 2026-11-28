import QRCode from "qrcode";
import { fileMime, packEnvelope, type PackedEnvelope } from "../shared/envelope.ts";
import { LTEncoder } from "../shared/fountain.ts";
import { MAX_BLOCKS, MAX_ORIGINAL_FILE_LEN, SOFT_ORIGINAL_LIMIT } from "../shared/limits.ts";
import {
  HEADER_LEN,
  createSessionId,
  fnv1a,
  packFrame,
  type FrameHeader,
} from "../shared/protocol.ts";
import { t, onLangChange } from "../shared/i18n.ts";
import {
  DEFAULT_TX_FPS,
  QR_MARGIN,
  frameBytesForGrid,
  colorFrameBytes,
  gridDims,
  gridHoldMs,
  normalizeGrid,
  rasterizeQr,
  type EccLevel,
} from "../shared/optical.ts";
import { encodePayloads } from "../color/engine.ts";
import { lockProfileSelect, profileChannels, unlockProfileSelect } from "../color/live.ts";
import type { OpticalProfileId } from "../color/profile.ts";
import { getOptFlags } from "../shared/opt-flags.ts";
import { optTrace } from "../shared/opt-trace.ts";
import { beginOptSession, endOptSession, ensureOptHud, removeOptHud, renderOptHud } from "../shared/opt-ui.ts";
import { isReadFailure, readBlobBytes } from "../shared/read-blob.ts";
import { TxPaintClock } from "../shared/tx-paint.ts";
import { zipFiles } from "../shared/zip.ts";

const LOOKAHEAD = 3;

let generation = 0;
let lastStatusParams: Record<string, string | number> | null = null;
let langWired = false;
const payloadCache = new WeakMap<File, Promise<PackedEnvelope>>();
const largeApproved = new WeakSet<File>();
let preparedFile: File | null = null;
let selectedCount = 0;

let paused = false;
let streamActive = false;
let navSuspended = false;
let pausedBeforeNav = false;
let dropWired = false;
let controlsWired = false;
let pagehideWired = false;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${Math.max(0, Math.round(n))} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}

function failureText(error: unknown): string {
  if (isReadFailure(error)) return t("send.readError");
  return error instanceof Error ? error.message : String(error);
}

function showSendError(message: string | null): void {
  const box = el("send-error");
  if (!box) return;
  if (!message) {
    box.hidden = true;
    box.textContent = "";
    return;
  }
  box.hidden = false;
  box.textContent = message;
}

function updateFileDisplay(file: File | undefined, count = 0): void {
  const fileNameEl = el("file-name");
  const fileSizeEl = el("file-size");
  const zone = el("drop-zone");
  if (fileNameEl) {
    if (!file) fileNameEl.textContent = t("send.fileEmpty");
    else if (count > 1) fileNameEl.textContent = t("send.fileMulti", { count, name: file.name });
    else fileNameEl.textContent = file.name;
    fileNameEl.removeAttribute("data-i18n");
  }
  if (fileSizeEl) {
    if (file && file.size > 0) {
      fileSizeEl.hidden = false;
      fileSizeEl.textContent = t("send.fileSize", { size: formatBytes(file.size) });
    } else {
      fileSizeEl.hidden = true;
      fileSizeEl.textContent = "";
    }
  }
  zone?.classList.toggle("has-file", !!file);
}

function setStreamingUi(active: boolean): void {
  const qrStage = el("qr-stage");
  const qrPlaceholder = el("qr-placeholder");
  if (qrStage) {
    qrStage.hidden = !active;
    qrStage.setAttribute("aria-hidden", active ? "false" : "true");
  }
  if (qrPlaceholder) qrPlaceholder.hidden = active;
}

function setWorkspaceXfer(active: boolean): void {
  document.querySelector("#view-send .workspace")?.classList.toggle("is-xfer", active);
}

function setXferChrome(visible: boolean): void {
  const panel = el("send-xfer");
  const controls = el("send-controls");
  const zone = el("drop-zone");
  if (panel) panel.hidden = !visible;
  if (controls) controls.hidden = !visible;
  if (zone) zone.hidden = visible;
  setWorkspaceXfer(visible);
}

function syncPauseButtons(): void {
  const pauseBtn = el<HTMLButtonElement>("send-pause");
  const resumeBtn = el<HTMLButtonElement>("send-resume");
  if (!pauseBtn || !resumeBtn) return;
  if (!streamActive) {
    pauseBtn.hidden = true;
    resumeBtn.hidden = true;
    return;
  }
  pauseBtn.hidden = paused;
  resumeBtn.hidden = !paused;
}

function updateSendXferUi(): void {
  const stateEl = el("send-state");
  const liveEl = el("send-live");
  if (stateEl) {
    if (!streamActive) stateEl.textContent = "";
    else stateEl.textContent = paused ? t("xfer.paused") : t("xfer.streaming");
  }
  if (liveEl) liveEl.hidden = !streamActive || paused;
  syncPauseButtons();
}

function setIdleStatus(): void {
  lastStatusParams = null;
  paused = false;
  streamActive = false;
  navSuspended = false;
  pausedBeforeNav = false;
  preparedFile = null;
  selectedCount = 0;
  setXferChrome(false);
  syncPauseButtons();
  showSendError(null);
  const specs = el("specs");
  const cfgPayload = el<HTMLInputElement>("cfg-payload");
  if (specs) {
    specs.hidden = true;
    specs.textContent = "";
  }
  const file = cfgPayload?.files?.[0];
  updateFileDisplay(file, cfgPayload?.files?.length ?? 0);
  setStreamingUi(!!file);
  updateSendXferUi();
}

function setStreamingStatus(params: Record<string, string | number>): void {
  // Keep params for i18n refresh only — never show gzip/fps technical line.
  lastStatusParams = params;
  const specs = el("specs");
  if (specs) {
    specs.hidden = true;
    specs.textContent = "";
  }
}

function setPreparingStatus(message: string): void {
  const stateEl = el("send-state");
  const panel = el("send-xfer");
  if (panel) panel.hidden = false;
  if (stateEl) stateEl.textContent = message;
  const specs = el("specs");
  if (specs) {
    specs.hidden = true;
    specs.textContent = "";
  }
}

async function loadPayload(file: File): Promise<PackedEnvelope> {
  const hit = payloadCache.get(file);
  if (hit) return hit;
  const pending = readBlobBytes(file).then((bytes) =>
    packEnvelope(bytes, file.name || "received-file", fileMime(file.name, file.type)),
  );
  payloadCache.set(file, pending);
  pending.catch(() => {
    if (payloadCache.get(file) === pending) payloadCache.delete(file);
  });
  return pending;
}

function setPaused(next: boolean): void {
  if (!streamActive || navSuspended) return;
  paused = next;
  updateSendXferUi();
}

/** Sospende l’invio senza distruggere la sessione (cambio tab Invia/Ricevi). */
export function suspendSend(): void {
  if (!streamActive || navSuspended) return;
  navSuspended = true;
  pausedBeforeNav = paused;
  paused = true;
  updateSendXferUi();
}

/** Ripristina l’invio esattamente come prima della sospensione. */
export function resumeSend(): void {
  if (!navSuspended) return;
  navSuspended = false;
  paused = pausedBeforeNav;
  updateSendXferUi();
}

export function isSendStreaming(): boolean {
  return streamActive;
}

function cancelStream(): void {
  generation++;
  navSuspended = false;
  pausedBeforeNav = false;
  unlockProfileSelect("cfg-color");
  endOptSession();
  removeOptHud(el("send-xfer"));
  const cfgPayload = el<HTMLInputElement>("cfg-payload");
  if (cfgPayload) cfgPayload.value = "";
  setIdleStatus();
}

async function startStream(): Promise<void> {
  const gen = ++generation;
  paused = false;
  streamActive = false;
  navSuspended = false;
  pausedBeforeNav = false;
  setXferChrome(false);

  const canvas = el<HTMLCanvasElement>("qr");
  const cfgPayload = el<HTMLInputElement>("cfg-payload");
  const cfgFps = el<HTMLSelectElement>("cfg-fps");
  const cfgBytes = el<HTMLSelectElement>("cfg-bytes");
  const cfgEcc = el<HTMLSelectElement>("cfg-ecc");
  const cfgSize = el<HTMLInputElement>("cfg-size");
  if (!canvas || !cfgPayload || !cfgFps || !cfgBytes || !cfgEcc || !cfgSize) return;

  const list = cfgPayload.files ? Array.from(cfgPayload.files) : [];
  if (!list.length) {
    setIdleStatus();
    return;
  }
  // Start the read before the first await. iOS drops the photo grant afterwards,
  // and Blob.arrayBuffer() then throws "The I/O read operation failed."
  const only = list.length === 1 ? list[0] : undefined;
  const skipRead = !!only && (only.size === 0 || only.size > MAX_ORIGINAL_FILE_LEN);
  if (!skipRead) {
    for (const file of list) void readBlobBytes(file);
  }
  showSendError(null);
  selectedCount = list.length;
  setPreparingStatus(list.length > 1 ? t("send.packing") : t("xfer.preparing"));
  let file: File;
  try {
    file = await zipFiles(list);
  } catch (error) {
    showSendError(failureText(error));
    setXferChrome(false);
    setStreamingUi(false);
    return;
  }
  if (gen !== generation) return;
  preparedFile = file;
  updateFileDisplay(file, selectedCount);
  setStreamingUi(true);
  if (file.size === 0 || file.size > MAX_ORIGINAL_FILE_LEN) {
    lastStatusParams = null;
    const msg = t("send.sizeError", { max: MAX_ORIGINAL_FILE_LEN / 1024 / 1024 });
    showSendError(msg);
    setXferChrome(false);
    setStreamingUi(false);
    return;
  }
  if (
    file.size > SOFT_ORIGINAL_LIMIT &&
    !largeApproved.has(file) &&
    !window.confirm(t("send.largeConfirm", { size: (file.size / 1024 / 1024).toFixed(1) }))
  ) {
    lastStatusParams = null;
    showSendError(t("send.largeCancelled"));
    setXferChrome(false);
    setStreamingUi(false);
    return;
  }
  if (file.size > SOFT_ORIGINAL_LIMIT) largeApproved.add(file);
  lastStatusParams = null;
  setPreparingStatus(t("xfer.preparing"));
  let packed: PackedEnvelope;
  try {
    packed = await loadPayload(file);
  } catch (error) {
    showSendError(failureText(error));
    setXferChrome(false);
    setStreamingUi(false);
    return;
  }
  if (gen !== generation) return;
  const payload = packed.bytes;
  const txFps = Number(cfgFps.value) || DEFAULT_TX_FPS;
  const ecc = cfgEcc.value as EccLevel;
  const displayPx = Number(cfgSize.value);
  const colorProfile: OpticalProfileId = lockProfileSelect("cfg-color");
  const colorChannels = profileChannels(colorProfile);
  const gridCodes = normalizeGrid(Number((document.getElementById("cfg-grid") as HTMLSelectElement | null)?.value));
  const viewport = Math.min(window.innerWidth, window.innerHeight);
  const fullSide = Math.max(320, viewport);
  const singleBudget = colorChannels > 1 ? fullSide : Math.min(displayPx, viewport * 0.9, 360);
  const fitW = gridCodes > 1 ? Math.min(displayPx, 0.96 * window.innerWidth) : singleBudget;
  const fitH = gridCodes > 1 ? Math.min(displayPx, 0.8 * window.innerHeight) : singleBudget;
  if (colorChannels > 1) {
    const stage = el("qr-stage");
    setStreamingUi(true);
    void stage?.requestFullscreen?.().catch(() => undefined);
  }

  const { cols: gridCols, rows: gridRows } = gridDims(gridCodes, fitW >= fitH);
  let frameBytes = frameBytesForGrid(
    Number(cfgBytes.value),
    gridCodes,
    fitW,
    fitH,
    window.devicePixelRatio || 1,
  );
  if (colorChannels > 1) {
    const cell = Math.min(fitW / gridCols, fitH / gridRows);
    frameBytes = colorFrameBytes(frameBytes, cell, ecc);
  }

  const sessionId = createSessionId();
  const blockLen = frameBytes - HEADER_LEN;
  const encoder = new LTEncoder(payload, blockLen, sessionId);
  if (encoder.k > MAX_BLOCKS) {
    unlockProfileSelect("cfg-color");
    lastStatusParams = null;
    const msg = t("send.blocksError", { k: encoder.k, max: MAX_BLOCKS });
    showSendError(msg);
    setXferChrome(false);
    setStreamingUi(false);
    return;
  }
  const header: FrameHeader = {
    sessionId,
    seq: 0,
    k: encoder.k,
    blockLen,
    totalLen: payload.length,
    payloadFnv: fnv1a(payload),
  };

  let version: number | undefined;
  let modules = 0;
  let cellSpan = 0;
  let scale = 1;
  let gutter = 0;
  const staging = document.createElement("canvas");
  const queue: ImageData[] = [];
  const cells: (ImageData | null)[] = new Array<ImageData | null>(gridCodes).fill(null);
  let nextSeq = 0;

  const cellOrigin = (index: number, cell: number) => ({
    x: (index % gridCols) * (cell + gutter),
    y: Math.floor(index / gridCols) * (cell + gutter),
  });

  const openStream = () => {
    if (streamActive) return;
    const saved = packed.originalLen - packed.wireFileLen;
    const compression =
      packed.compressed && saved > 0
        ? t("send.compression.gzip", { pct: ((saved / packed.originalLen) * 100).toFixed(1) })
        : t("send.compression.raw");
    setStreamingStatus({
      fps: txFps,
      fileMiB: (packed.originalLen / 1024 / 1024).toFixed(2),
      compression,
      payloadKiB: Math.ceil(payload.length / 1024),
      codes: gridCodes * colorChannels,
    });
    streamActive = true;
    setXferChrome(true);
    updateSendXferUi();
  };

  const sizeCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    const cell = cellSpan || modules + 2 * QR_MARGIN;
    gutter = gridCodes > 1 ? Math.max(4, Math.round(cell * 0.08)) : 0;
    const totalW = cell * gridCols + gutter * Math.max(0, gridCols - 1);
    const totalH = cell * gridRows + gutter * Math.max(0, gridRows - 1);
    canvas.classList.toggle("is-grid", gridCodes > 1);
    const full = document.fullscreenElement === el("qr-stage");
    const side = Math.max(320, Math.min(window.innerWidth, window.innerHeight));
    const limitW = full ? side : fitW;
    const limitH = full ? side : fitH;
    scale = Math.max(1, Math.floor(Math.min((limitW * dpr) / totalW, (limitH * dpr) / totalH)));
    staging.width = totalW;
    staging.height = totalH;
    canvas.width = totalW * scale;
    canvas.height = totalH * scale;
    canvas.style.width = `${(totalW * scale) / dpr}px`;
    canvas.style.height = `${(totalH * scale) / dpr}px`;
    const stagingCtx = staging.getContext("2d");
    if (!stagingCtx) return;
    stagingCtx.fillStyle = "#ffffff";
    stagingCtx.fillRect(0, 0, totalW, totalH);
    cells.forEach((img, i) => {
      if (!img) return;
      const { x, y } = cellOrigin(i, cell);
      stagingCtx.putImageData(img, x, y);
    });
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(staging, 0, 0, canvas.width, canvas.height);
  };

  const onFullscreen = () => {
    if (gen !== generation) {
      document.removeEventListener("fullscreenchange", onFullscreen);
      return;
    }
    if (modules) sizeCanvas();
  };
  document.addEventListener("fullscreenchange", onFullscreen);

  const noteGeometry = (qrVersion: number, qrSize: number, span: number) => {
    if (version !== undefined) return;
    version = qrVersion;
    modules = qrSize;
    cellSpan = span;
    sizeCanvas();
    openStream();
  };

  const makeFrame = (): ImageData => {
    if (colorChannels > 1) {
      const payloads: Uint8Array[] = [];
      for (let i = 0; i < colorChannels; i++) {
        payloads.push(packFrame({ ...header, seq: nextSeq }, encoder.encode(nextSeq)));
        nextSeq++;
      }
      const encoded = encodePayloads(payloads, ecc, colorProfile);
      noteGeometry(encoded.aligned.version, encoded.qrSize, encoded.modules);
      return new ImageData(new Uint8ClampedArray(encoded.data), encoded.width, encoded.height);
    }
    const bytes = packFrame({ ...header, seq: nextSeq }, encoder.encode(nextSeq));
    nextSeq++;
    const qr = QRCode.create([{ data: bytes, mode: "byte" } as unknown as QRCode.QRCodeSegment], {
      errorCorrectionLevel: ecc,
      version,
      maskPattern: 4,
    });
    if (version === undefined) {
      version = qr.version;
      modules = qr.modules.size;
      cellSpan = modules + 2 * QR_MARGIN;
      sizeCanvas();
      openStream();
    }
    return rasterizeQr(qr.modules.size, qr.modules.data, QR_MARGIN);
  };

  const lookahead = LOOKAHEAD * gridCodes;
  let generatorFailed = false;
  const pump = (max = lookahead) => {
    if (generatorFailed || gen !== generation) return;
    if (paused) {
      window.setTimeout(() => pump(), 160);
      return;
    }
    try {
      for (let n = 0; n < max && queue.length < lookahead; n++) queue.push(makeFrame());
    } catch (err) {
      generatorFailed = true;
      showSendError(err instanceof Error ? err.message : String(err));
    }
  };
  pump();

  const interval = gridHoldMs(txFps, gridCodes);
  let nextAt = performance.now();
  const paintClock = getOptFlags().perf ? new TxPaintClock(txFps) : null;
  const hudHost = el("send-xfer");
  if (paintClock) {
    beginOptSession(txFps);
    ensureOptHud(hudHost);
  }
  const publishPaint = () => {
    if (!paintClock) return;
    optTrace.noteTx(paintClock.snapshot());
    renderOptHud(hudHost);
  };
  const tick = (now: number) => {
    if (gen !== generation || generatorFailed) return;
    requestAnimationFrame(tick);
    paintClock?.noteFrame(now);
    if (paused || now < nextAt) return;
    if (modules === 0 || queue.length < gridCodes) {
      paintClock?.noteStarved();
      publishPaint();
      pump(gridCodes);
      nextAt = now + Math.min(interval, 16);
      return;
    }
    const cell = cellSpan || modules + 2 * QR_MARGIN;
    const stagingCtx = staging.getContext("2d");
    const ctx = canvas.getContext("2d");
    if (!stagingCtx || !ctx) {
      nextAt = now + interval;
      return;
    }
    for (let i = 0; i < gridCodes; i++) {
      const img = queue.shift();
      if (!img) break;
      cells[i] = img;
      const { x, y } = cellOrigin(i, cell);
      stagingCtx.putImageData(img, x, y);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(staging, 0, 0, canvas.width, canvas.height);
    pump(gridCodes);
    nextAt += interval;
    let skipped = 0;
    if (now - nextAt > interval) {
      skipped = Math.floor((now - nextAt) / interval);
      nextAt = now + interval;
    }
    paintClock?.noteSwap(now, skipped);
    publishPaint();
  };
  requestAnimationFrame(tick);
}

const onChange = () => void startStream();

function wireDropZone(): void {
  if (dropWired) return;
  dropWired = true;
  const zone = el("drop-zone");
  const input = el<HTMLInputElement>("cfg-payload");
  if (!zone || !input) return;

  const setDrag = (on: boolean) => zone.classList.toggle("is-dragover", on);

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    setDrag(true);
  });
  zone.addEventListener("dragleave", () => setDrag(false));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    setDrag(false);
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    const dt = new DataTransfer();
    for (const f of Array.from(files)) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function wireControls(): void {
  if (controlsWired) return;
  controlsWired = true;
  el<HTMLButtonElement>("send-pause")?.addEventListener("click", () => setPaused(true));
  el<HTMLButtonElement>("send-resume")?.addEventListener("click", () => setPaused(false));
  el<HTMLButtonElement>("send-stop")?.addEventListener("click", () => cancelStream());
  el<HTMLButtonElement>("send-fullscreen")?.addEventListener("click", () => {
    const stage = el("qr-stage");
    if (!stage) return;
    if (document.fullscreenElement === stage) void document.exitFullscreen?.();
    else void stage.requestFullscreen?.().catch(() => undefined);
  });
}

function syncLayoutButtons(): void {
  const value = (document.getElementById("cfg-grid") as HTMLSelectElement | null)?.value ?? "1";
  document.querySelectorAll<HTMLButtonElement>("[data-layout-grid]").forEach((btn) => {
    const on = btn.dataset.layoutGrid === value;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function wireLayout(): void {
  const select = document.getElementById("cfg-grid") as HTMLSelectElement | null;
  document.querySelectorAll<HTMLButtonElement>("[data-layout-grid]").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      if (!select) return;
      select.value = btn.dataset.layoutGrid ?? "1";
      syncLayoutButtons();
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
  syncLayoutButtons();
}

const SEND_FPS_KEY = "wf-send-fps";

function restoreSendFps(): void {
  const select = el<HTMLSelectElement>("cfg-fps");
  if (!select || select.dataset.fpsReady === "1") return;
  select.dataset.fpsReady = "1";
  try {
    const saved = localStorage.getItem(SEND_FPS_KEY);
    if (saved && [...select.options].some((option) => option.value === saved)) select.value = saved;
  } catch {
    /* ignore */
  }
  select.addEventListener("change", () => {
    try {
      localStorage.setItem(SEND_FPS_KEY, select.value);
    } catch {
      /* ignore */
    }
  });
}

export function mountSend(): void {
  restoreSendFps();
  const controls = ["cfg-payload", "cfg-fps", "cfg-bytes", "cfg-ecc", "cfg-size", "cfg-grid"];
  for (const id of controls) {
    document.getElementById(id)?.addEventListener("change", onChange);
  }
  wireDropZone();
  wireControls();
  wireLayout();
  if (!langWired) {
    langWired = true;
    onLangChange(() => {
      if (lastStatusParams) setStreamingStatus(lastStatusParams);
      else {
        const input = el<HTMLInputElement>("cfg-payload");
        updateFileDisplay(preparedFile ?? input?.files?.[0], selectedCount || input?.files?.length || 0);
      }
      updateSendXferUi();
    });
  }
  if (!pagehideWired) {
    pagehideWired = true;
    window.addEventListener("pagehide", () => {
      generation++;
      streamActive = false;
      navSuspended = false;
      paused = false;
    });
  }
  // Non resettare se c’è già una trasmissione (anche sospesa per navigazione).
  if (streamActive || navSuspended) {
    resumeSend();
    return;
  }
  setIdleStatus();
  void (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<unknown> } })
    .wakeLock?.request("screen")
    .catch(() => undefined);
}

export function unmountSend(): void {
  // Soft-unmount: conserva la sessione QR se attiva.
  if (streamActive) {
    suspendSend();
    return;
  }
  generation++;
  const controls = ["cfg-payload", "cfg-fps", "cfg-bytes", "cfg-ecc", "cfg-size", "cfg-grid"];
  for (const id of controls) {
    document.getElementById(id)?.removeEventListener("change", onChange);
  }
  lastStatusParams = null;
  streamActive = false;
  paused = false;
  navSuspended = false;
  endOptSession();
  removeOptHud(el("send-xfer"));
}

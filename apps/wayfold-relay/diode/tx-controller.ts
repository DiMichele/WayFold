import QRCode from "qrcode";
import { fileMime, packEnvelope } from "../shared/envelope.ts";
import { isReadFailure, readBlobBytes } from "../shared/read-blob.ts";
import { LTEncoder } from "../shared/fountain.ts";
import { t } from "../shared/i18n.ts";
import { MAX_BLOCKS } from "../shared/limits.ts";
import {
  DEFAULT_ECC,
  DEFAULT_FRAME_BYTES,
  DEFAULT_TX_FPS,
  QR_MARGIN,
  frameBytesForGrid,
  gridDims,
  normalizeGrid,
  rasterizeQr,
} from "../shared/optical.ts";
import { getOptFlags } from "../shared/opt-flags.ts";
import { optTrace } from "../shared/opt-trace.ts";
import { ensureOptHud, renderOptHud } from "../shared/opt-ui.ts";
import { HEADER_LEN, createSessionId, fnv1a, packFrame, type FrameHeader } from "../shared/protocol.ts";
import { TxPaintClock } from "../shared/tx-paint.ts";
import { airBudget, carrierYieldsToFile, dwellFrames, nextOnAir } from "./carousel.ts";
import {
  LIVE_FILENAME,
  LIVE_HOLD_MS,
  LIVE_MAX_CHARS,
  LIVE_MIME,
  encodeLiveRecord,
  type LiveKind,
} from "./live.ts";
import {
  POLICY_EVENT,
  ScreenWake,
  currentPolicy,
  el,
  formatBytes,
  logEvent,
  showBanner,
} from "./common.ts";
import { checkPolicy } from "./policy.ts";
import { addQueueItem, listQueue, removeQueueItem, type QueueItem } from "./store.ts";
import { VIDEO_FILENAME, VIDEO_HOLD_MS, VIDEO_MIME } from "./video-wire.ts";
import { refreshVideoTx, retargetVideoEncoder, stopVideoCapture, wireVideoTx } from "./video-tx.ts";

const ECC = DEFAULT_ECC;
const LOOKAHEAD = 3;
const FPS_KEY = "wf-diode-fps";
const GRID_KEY = "wf-diode-grid";
interface Prepared {
  encoder: LTEncoder;
  header: FrameHeader;
  nextSeq: number;
}

type ItemState = "preparing" | "ready" | "blocked" | "failed";

interface Frame {
  id: string;
  img: ImageData;
}

let items: QueueItem[] = [];
/** File interrupted by the live carrier; its turn resumes when the text yields. */
let resumeFileId: string | null = null;
/** One optical session. The beacon, the draft and the committed line share it. */
let epoch = 0;
let nextSeq = 0;
interface Air {
  id: string;
  kind: LiveKind;
  text: string;
  seq: number;
}
let air: Air | null = null;
let airSince = 0;
/** Completed airings of a file. Later laps stay up longer. */
const laps = new Map<string, number>();
const LAP_CAP = 4;
let want: { kind: LiveKind; text: string } = { kind: "beacon", text: "" };
let publishGen = 0;
let armingId: string | null = null;
let holdTimer = 0;
let draftTimer = 0;
const pendingMeta = new Map<string, { kind: LiveKind; text: string; seq: number; gen: number }>();
const prepared = new Map<string, Prepared>();
const states = new Map<string, ItemState>();
const failures = new Map<string, string>();

let mounted = false;
let wired = false;
let running = false;
let paused = false;
let generation = 0;
let currentId: string | null = null;
let currentIndex = -1;
let framesLeft = 0;
let turn = 0;
let framesSent = 0;
let onAirId: string | null = null;
let lookahead: Frame[] = [];
let qrVersion: number | undefined;
const wake = new ScreenWake();
let videoOn = false;
let videoBusy = false;
let videoHoldUntil = 0;
let videoTimer = 0;
let videoAired = 0;
let videoItemId: string | null = null;
let videoStill: { id: string; img: ImageData } | null = null;
let tearingDown = false;
let videoQueue: Uint8Array[] = [];

function fps(): number {
  const value = Number(el<HTMLSelectElement>("dx-fps")?.value);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TX_FPS;
}

function gridCount(): number {
  return normalizeGrid(Number(el<HTMLSelectElement>("dx-grid")?.value));
}

function stageBudget(grid = gridCount()): { width: number; height: number; dpr: number } {
  const dpr = window.devicePixelRatio || 1;
  if (grid <= 1) {
    const side = Math.min(window.innerWidth - 48, Math.max(280, Math.min(window.innerHeight * 0.46, 480)));
    return { width: side, height: side, dpr };
  }
  return {
    width: Math.max(160, Math.min(window.innerWidth - 32, 1000)),
    height: Math.max(160, Math.min(window.innerHeight * 0.7, 780)),
    dpr,
  };
}

/** Fountain block used for every code now on the diode screen. */
export function diodeBlockLen(): number {
  const box = stageBudget();
  return frameBytesForGrid(DEFAULT_FRAME_BYTES, gridCount(), box.width, box.height, box.dpr) - HEADER_LEN;
}

function itemState(item: QueueItem): ItemState {
  if (!checkPolicy(currentPolicy(), { filename: item.name, size: item.size }).ok) return "blocked";
  return states.get(item.id) ?? "preparing";
}

function isLive(id: string): boolean {
  return pendingMeta.has(id) || air?.id === id;
}

function isVideoId(id: string): boolean {
  if (id === videoItemId) return true;
  return items.find((item) => item.id === id)?.mime === VIDEO_MIME;
}

function fileItems(): QueueItem[] {
  return items.filter((item) => !isLive(item.id) && !isVideoId(item.id));
}

function eligibleIds(): string[] {
  return items
    .filter((item) => prepared.has(item.id) && (isLive(item.id) || item.mime === VIDEO_MIME || itemState(item) === "ready"))
    .map((item) => item.id);
}

function usedSessionIds(): Set<number> {
  return new Set([...prepared.values()].map((p) => p.header.sessionId));
}

async function prepare(item: QueueItem): Promise<void> {
  if (prepared.has(item.id) || states.get(item.id) === "failed") return;
  states.set(item.id, "preparing");
  renderQueue();
  try {
    const bytes = await readBlobBytes(item.data);
    const packed = await packEnvelope(bytes, item.name, item.mime);
    if (!items.some((i) => i.id === item.id)) return;
    const used = usedSessionIds();
    let sessionId = createSessionId();
    while (used.has(sessionId)) sessionId = createSessionId();
    const blockLen = diodeBlockLen();
    const encoder = new LTEncoder(packed.bytes, blockLen, sessionId);
    if (encoder.k > MAX_BLOCKS) throw new RangeError(t("send.blocksError", { k: encoder.k, max: MAX_BLOCKS }));
    prepared.set(item.id, {
      encoder,
      header: {
        sessionId,
        seq: 0,
        k: encoder.k,
        blockLen,
        totalLen: packed.bytes.length,
        payloadFnv: fnv1a(packed.bytes),
      },
      nextSeq: 0,
    });
    states.set(item.id, "ready");
    if (pendingMeta.has(item.id)) acceptCarrier(item.id);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    states.set(item.id, "failed");
    failures.set(item.id, msg);
    logEvent("error", "diode.log.txPrepareFailed", { name: item.name, msg });
    if (pendingMeta.has(item.id)) {
      showBanner("dx-error", msg);
      dropLive(item.id);
    }
  }
  renderQueue();
}

function arm(id: string, index: number, frames: number): void {
  const switched = currentId !== id;
  currentId = id;
  currentIndex = index;
  framesLeft = frames;
  if (switched && air?.id === id) airSince = performance.now();
}

function carrierReady(): boolean {
  return !!air && prepared.has(air.id) && states.get(air.id) === "ready";
}

function fileIds(): string[] {
  return eligibleIds().filter((id) => !isLive(id));
}

function carrierHolds(): boolean {
  if (!carrierReady() || !air) return false;
  return !carrierYieldsToFile(air.kind, air ? performance.now() - airSince : 0, LIVE_HOLD_MS, fileIds().length);
}

/** A ready file takes the QR as soon as the live text no longer needs it. The long carrier arm must not sit out the queue. */
function releaseLiveForFiles(): void {
  if (!running || paused || (currentId !== null && !isLive(currentId))) return;
  if (!carrierYieldsToFile(air?.kind ?? null, air ? performance.now() - airSince : LIVE_HOLD_MS, LIVE_HOLD_MS, fileIds().length)) return;
  framesLeft = 0;
  lookahead = lookahead.filter((frame) => !isLive(frame.id));
}

function armFile(id: string, index: number): void {
  const timing = airBudget(laps.get(id) ?? 0);
  arm(id, index, dwellFrames(prepared.get(id)!.encoder.k, fps(), timing));
}

function advance(): void {
  const leaving = currentId;
  if (leaving && !isLive(leaving) && !isVideoId(leaving) && !resumeFileId && items.some((item) => item.id === leaving)) {
    laps.set(leaving, Math.min(LAP_CAP, (laps.get(leaving) ?? 0) + 1));
  }
  if (videoOn) {
    if (videoItemId && prepared.has(videoItemId) && states.get(videoItemId) === "ready") {
      arm(videoItemId, -1, Math.max(8, Math.round((VIDEO_HOLD_MS / 1000) * fps())));
      return;
    }
    currentId = null;
    currentIndex = -1;
    framesLeft = 0;
    return;
  }
  if (carrierHolds() && air) {
    arm(air.id, -1, Math.max(8, Math.round(fps() / 2)));
    return;
  }
  const ids = fileIds();
  if (resumeFileId && ids.includes(resumeFileId)) {
    const id = resumeFileId;
    resumeFileId = null;
    armFile(id, ids.indexOf(id));
    return;
  }
  const fromFile = leaving && !isLive(leaving) ? leaving : null;
  const step = nextOnAir(ids, fromFile, fromFile ? currentIndex : -1);
  if (step) {
    if (step.wrapped || turn === 0) turn++;
    armFile(step.id, ids.indexOf(step.id));
    return;
  }
  if (carrierReady() && air) {
    arm(air.id, -1, Math.max(8, Math.round(fps())));
    return;
  }
  currentId = null;
  currentIndex = -1;
  framesLeft = 0;
}

function clearHold(): void {
  if (holdTimer) window.clearTimeout(holdTimer);
  holdTimer = 0;
}

function dropLive(id: string): void {
  pendingMeta.delete(id);
  if (air?.id === id) air = null;
  if (armingId === id) armingId = null;
  items = items.filter((item) => item.id !== id);
  prepared.delete(id);
  states.delete(id);
  failures.delete(id);
  lookahead = lookahead.filter((frame) => frame.id !== id);
  if (currentId === id) framesLeft = 0;
}

function acceptCarrier(id: string): void {
  if (videoOn) {
    dropLive(id);
    return;
  }
  const meta = pendingMeta.get(id);
  if (!meta || meta.gen !== publishGen) {
    dropLive(id);
    return;
  }
  const previousId = air?.id ?? null;
  const previousKind = air?.kind ?? null;
  const elapsed = air ? performance.now() - airSince : LIVE_HOLD_MS;
  const wait = previousKind === "draft" && meta.kind !== "commit" && elapsed < LIVE_HOLD_MS ? LIVE_HOLD_MS - elapsed : 0;
  const apply = () => {
    holdTimer = 0;
    if (meta.gen !== publishGen || !pendingMeta.has(id)) {
      dropLive(id);
      return;
    }
    if (currentId && currentId !== id && !isLive(currentId)) resumeFileId = currentId;
    air = { id, kind: meta.kind, text: meta.text, seq: meta.seq };
    airSince = performance.now();
    if (armingId === id) armingId = null;
    if (previousId && previousId !== id) dropLive(previousId);
    lookahead = lookahead.filter((frame) => frame.id === id);
    framesLeft = 0;
    renderStatus();
  };
  clearHold();
  if (wait > 0) holdTimer = window.setTimeout(apply, wait);
  else apply();
}

async function publish(next: { kind: LiveKind; text: string }): Promise<void> {
  if (videoOn) return;
  if (next.kind === want.kind && next.text === want.text && (air !== null || armingId !== null)) return;
  want = next;
  clearHold();
  const gen = ++publishGen;
  for (const id of [...pendingMeta.keys()]) {
    if (id !== air?.id) dropLive(id);
  }
  const seq = ++nextSeq;
  const id = randomId();
  armingId = id;
  pendingMeta.set(id, { kind: next.kind, text: next.text, seq, gen });
  const bytes = encodeLiveRecord({ kind: next.kind, epoch, seq, text: next.text });
  items.push({
    id,
    name: LIVE_FILENAME,
    mime: LIVE_MIME,
    size: bytes.byteLength,
    data: new Blob([bytes as BlobPart], { type: LIVE_MIME }),
    addedAt: uniqueAddedAt(),
  });
  const item = items[items.length - 1];
  if (running && item) await prepare(item);
}

function qrImage(bytes: Uint8Array): ImageData {
  const qr = QRCode.create([{ data: bytes, mode: "byte" } as unknown as QRCode.QRCodeSegment], {
    errorCorrectionLevel: ECC,
    version: qrVersion,
    maskPattern: 4,
  });
  if (qrVersion === undefined) qrVersion = qr.version;
  return rasterizeQr(qr.modules.size, qr.modules.data, QR_MARGIN);
}

function makeFrame(): Frame | null {
  releaseLiveForFiles();
  if (!currentId || framesLeft <= 0 || !eligibleIds().includes(currentId)) advance();
  if (!currentId) return null;
  const p = prepared.get(currentId)!;
  // A video packet is one fountain block. Repeating the same symbol keeps the QR
  // still for the camera; a new seq would redraw it every frame and none would freeze.
  if (isVideoId(currentId)) {
    if (videoStill?.id !== currentId) {
      videoStill = { id: currentId, img: qrImage(packFrame({ ...p.header, seq: 0 }, p.encoder.encode(0))) };
    }
    framesLeft--;
    return { id: currentId, img: videoStill.img };
  }
  const seq = p.nextSeq;
  p.nextSeq = (p.nextSeq + 1) >>> 0;
  framesLeft--;
  return { id: currentId, img: qrImage(packFrame({ ...p.header, seq }, p.encoder.encode(seq))) };
}

function setStage(onAir: boolean): void {
  const stage = el("dx-stage");
  const idle = el("dx-idle");
  if (stage) stage.hidden = !onAir;
  if (idle) idle.hidden = onAir;
}

function paint(
  canvas: HTMLCanvasElement,
  staging: HTMLCanvasElement,
  frames: Frame[],
): void {
  const grid = gridCount();
  const budget = stageBudget(grid);
  const { cols, rows } = gridDims(grid, budget.width >= budget.height);
  const cell = frames[0]!.img.width;
  const gutter = grid > 1 ? Math.max(4, Math.round(cell * 0.08)) : 0;
  const totalW = cell * cols + gutter * Math.max(0, cols - 1);
  const totalH = cell * rows + gutter * Math.max(0, rows - 1);
  const scale = Math.max(
    1,
    Math.floor(Math.min((budget.width * budget.dpr) / totalW, (budget.height * budget.dpr) / totalH)),
  );
  canvas.classList.toggle("is-grid", grid > 1);
  if (staging.width !== totalW || staging.height !== totalH) {
    staging.width = totalW;
    staging.height = totalH;
  }
  if (canvas.width !== totalW * scale || canvas.height !== totalH * scale) {
    canvas.width = totalW * scale;
    canvas.height = totalH * scale;
    canvas.style.width = `${(totalW * scale) / budget.dpr}px`;
    canvas.style.height = `${(totalH * scale) / budget.dpr}px`;
  }
  const stagingCtx = staging.getContext("2d");
  const ctx = canvas.getContext("2d");
  if (!stagingCtx || !ctx) return;
  stagingCtx.fillStyle = "#ffffff";
  stagingCtx.fillRect(0, 0, totalW, totalH);
  for (let i = 0; i < frames.length && i < cols * rows; i++) {
    const img = frames[i]!.img;
    stagingCtx.putImageData(img, (i % cols) * (cell + gutter), Math.floor(i / cols) * (cell + gutter));
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(staging, 0, 0, canvas.width, canvas.height);
}

function run(): void {
  const gen = ++generation;
  const canvas = el<HTMLCanvasElement>("dx-qr");
  if (!canvas) return;
  const staging = document.createElement("canvas");

  const fill = () => {
    if (gen !== generation || paused) return;
    try {
      while (lookahead.length < LOOKAHEAD * gridCount()) {
        if (lookahead.some((frame) => isVideoId(frame.id))) break;
        const frame = makeFrame();
        if (!frame) break;
        lookahead.push(frame);
        if (isVideoId(frame.id)) break;
      }
    } catch (error) {
      showBanner("dx-error", error instanceof Error ? error.message : String(error));
    }
  };
  const pump = () => {
    if (gen !== generation) return;
    fill();
    const need = lookahead.some((frame) => isVideoId(frame.id)) ? 1 : LOOKAHEAD * gridCount();
    window.setTimeout(pump, lookahead.length < need ? 0 : 32);
  };
  pump();

  let nextAt = performance.now();
  const paintClock = getOptFlags().perf ? new TxPaintClock(fps()) : null;
  const hudHost = el("dx-status");
  if (paintClock) ensureOptHud(hudHost);
  const publishPaint = () => {
    if (!paintClock) return;
    optTrace.noteTx(paintClock.snapshot());
    renderOptHud(hudHost);
  };
  const tick = (now: number) => {
    if (gen !== generation) return;
    requestAnimationFrame(tick);
    paintClock?.noteFrame(now);
    if (paused || now < nextAt) return;
    const interval = 1000 / fps();
    if (lookahead.length === 0) fill();
    const frame = lookahead.shift();
    if (!frame) {
      paintClock?.noteStarved();
      publishPaint();
      if (onAirId !== null) {
        onAirId = null;
        setStage(false);
        renderStatus();
        renderQueue();
      }
      nextAt = now + interval;
      return;
    }
    const batch = [frame];
    if (isVideoId(frame.id)) {
      while (batch.length < gridCount()) batch.push(frame);
    } else {
      while (batch.length < gridCount()) {
        const next = lookahead.shift();
        if (!next) break;
        if (isVideoId(next.id)) {
          lookahead.unshift(next);
          break;
        }
        batch.push(next);
      }
    }
    paint(canvas, staging, batch);
    fill();
    framesSent += isVideoId(frame.id) ? 1 : batch.length;
    if (onAirId !== frame.id) {
      onAirId = frame.id;
      setStage(true);
      renderQueue();
      renderStatus();
    }
    if (framesSent % 15 === 0) renderStatus();
    nextAt += interval;
    let skipped = 0;
    if (now - nextAt > 3 * interval) {
      skipped = Math.floor((now - nextAt) / interval);
      nextAt = now + interval;
    }
    paintClock?.noteSwap(now, skipped);
    publishPaint();
  };
  requestAnimationFrame(tick);
}

function start(): void {
  if (running) return;
  running = true;
  paused = false;
  turn = 0;
  framesSent = 0;
  currentId = null;
  currentIndex = -1;
  framesLeft = 0;
  lookahead = [];
  laps.clear();
  epoch = (crypto.getRandomValues(new Uint32Array(1))[0]! | 1) >>> 0;
  nextSeq = 0;
  clearHold();
  showBanner("dx-error", null);
  wake.acquire();
  for (const item of fileItems()) void prepare(item);
  const typed = el<HTMLInputElement>("dx-live-input")?.value.slice(0, LIVE_MAX_CHARS) ?? "";
  void publish(typed ? { kind: "draft", text: typed } : { kind: "beacon", text: "" });
  logEvent("info", "diode.log.txStarted", { count: fileItems().length, fps: fps() });
  run();
  renderControls();
  renderStatus();
}

function clearVideoTimer(): void {
  if (videoTimer) window.clearTimeout(videoTimer);
  videoTimer = 0;
}

function scheduleVideo(ms: number): void {
  clearVideoTimer();
  videoTimer = window.setTimeout(pumpVideo, ms);
}

function dropVideo(id: string): void {
  items = items.filter((item) => item.id !== id);
  prepared.delete(id);
  states.delete(id);
  failures.delete(id);
  lookahead = lookahead.filter((frame) => frame.id !== id);
  if (videoItemId === id) videoItemId = null;
  if (currentId === id) framesLeft = 0;
}

function pumpVideo(): void {
  clearVideoTimer();
  if (!videoOn || !running) return;
  if (paused || videoBusy) {
    scheduleVideo(paused ? 200 : 40);
    return;
  }
  const wait = videoHoldUntil - performance.now();
  if (wait > 0) {
    scheduleVideo(wait);
    return;
  }
  const next = videoQueue.shift();
  if (!next) return;
  videoHoldUntil = performance.now() + VIDEO_HOLD_MS;
  void publishVideo(next);
}

async function publishVideo(bytes: Uint8Array): Promise<void> {
  if (!videoOn || !running) return;
  videoBusy = true;
  const id = randomId();
  const item: QueueItem = {
    id,
    name: VIDEO_FILENAME,
    mime: VIDEO_MIME,
    size: bytes.byteLength,
    data: new Blob([bytes as BlobPart], { type: VIDEO_MIME }),
    addedAt: uniqueAddedAt(),
  };
  items.push(item);
  try {
    await prepare(item);
  } finally {
    videoBusy = false;
  }
  if (!videoOn || !running || !items.some((entry) => entry.id === id) || states.get(id) !== "ready") {
    dropVideo(id);
    videoHoldUntil = performance.now();
    pumpVideo();
    return;
  }
  const prev = videoItemId;
  videoItemId = id;
  videoAired++;
  videoHoldUntil = performance.now() + VIDEO_HOLD_MS;
  if (currentId && currentId !== id && !isLive(currentId) && !isVideoId(currentId)) resumeFileId = currentId;
  if (prev && prev !== id) dropVideo(prev);
  lookahead = lookahead.filter((frame) => frame.id === id);
  framesLeft = 0;
  renderStatus();
  scheduleVideo(VIDEO_HOLD_MS);
}

export function videoQueueDepth(): number {
  return videoQueue.length + (videoBusy ? 1 : 0);
}

export function videoPacketsOnAir(): number {
  return videoAired;
}

export function dropQueuedVideo(): number {
  const dropped = videoQueue.length;
  videoQueue = [];
  return dropped;
}

export function isTxPaused(): boolean {
  return paused;
}

export function pushVideoPacket(bytes: Uint8Array): void {
  if (!videoOn || !running) return;
  videoQueue.push(bytes);
  pumpVideo();
}

export function startVideoCarrier(): void {
  videoOn = true;
  videoQueue = [];
  videoBusy = false;
  videoAired = 0;
  videoHoldUntil = 0;
  videoStill = null;
  clearVideoTimer();
  if (!running) start();
  lookahead = [];
  framesLeft = 0;
  showBanner("dx-error", null);
  renderControls();
  renderStatus();
}

export function stopVideoCarrier(): void {
  const restore = videoOn && running && !tearingDown;
  videoOn = false;
  videoQueue = [];
  videoBusy = false;
  videoHoldUntil = 0;
  videoStill = null;
  clearVideoTimer();
  if (videoItemId) dropVideo(videoItemId);
  framesLeft = 0;
  lookahead = lookahead.filter((frame) => !isVideoId(frame.id));
  renderControls();
  renderStatus();
  if (!restore) return;
  const typed = el<HTMLInputElement>("dx-live-input")?.value.slice(0, LIVE_MAX_CHARS) ?? "";
  void publish(typed.trim() ? { kind: "draft", text: typed } : { kind: "beacon", text: "" });
}

export function stopTx(): void {
  tearingDown = true;
  stopVideoCapture();
  if (!running) {
    tearingDown = false;
    return;
  }
  clearHold();
  window.clearTimeout(draftTimer);
  draftTimer = 0;
  publishGen++;
  for (const id of [...pendingMeta.keys()]) dropLive(id);
  if (air) dropLive(air.id);
  want = { kind: "beacon", text: "" };
  armingId = null;
  resumeFileId = null;
  laps.clear();
  generation++;
  running = false;
  paused = false;
  onAirId = null;
  lookahead = [];
  wake.release();
  setStage(false);
  logEvent("info", "diode.log.txStopped", { frames: framesSent, turns: turn });
  renderControls();
  renderStatus();
  renderQueue();
  tearingDown = false;
}

export function isTxRunning(): boolean {
  return running;
}

function setPaused(next: boolean): void {
  if (!running) return;
  paused = next;
  if (!next) pumpVideo();
  renderControls();
  renderStatus();
}

function syncGridButtons(): void {
  const value = String(gridCount());
  document.querySelectorAll<HTMLButtonElement>("[data-diode-grid]").forEach((btn) => {
    const on = btn.dataset.diodeGrid === value;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

/** A new grid size is a new block size, so every session on air starts over. */
function retargetGrid(): void {
  qrVersion = undefined;
  videoStill = null;
  if (videoItemId) dropVideo(videoItemId);
  prepared.clear();
  lookahead = [];
  framesLeft = 0;
  currentId = null;
  for (const item of items) {
    if (states.get(item.id) !== "failed") states.delete(item.id);
  }
  dropQueuedVideo();
  retargetVideoEncoder();
  if (!running) return;
  for (const item of items) void prepare(item);
}

function uniqueAddedAt(): number {
  const last = items.reduce((max, item) => Math.max(max, item.addedAt), 0);
  return Math.max(Date.now(), last + 1);
}

/** `crypto.randomUUID` is missing when the portable HTML is opened from Files on iOS. */
function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function enqueue(data: Blob, name: string, mime: string): Promise<boolean> {
  const verdict = checkPolicy(currentPolicy(), { filename: name, size: data.size });
  if (!verdict.ok) {
    const key = verdict.reason === "size" ? "diode.tx.rejectSize" : "diode.tx.rejectType";
    const max = formatBytes(currentPolicy().maxBytes);
    showBanner("dx-error", t(key, { name, max }));
    logEvent("warn", verdict.reason === "size" ? "diode.log.txRejectSize" : "diode.log.txRejectType", {
      name,
      size: formatBytes(data.size),
      max,
    });
    return false;
  }
  const item: QueueItem = {
    id: randomId(),
    name,
    mime: mime || "application/octet-stream",
    size: data.size,
    data,
    addedAt: uniqueAddedAt(),
  };
  try {
    await addQueueItem(item);
  } catch (error) {
    showBanner("dx-error", t("diode.storeError", { msg: error instanceof Error ? error.message : String(error) }));
    return false;
  }
  items.push(item);
  logEvent("info", "diode.log.txQueued", { name, size: formatBytes(item.size) });
  if (running) void prepare(item);
  renderQueue();
  return true;
}

async function onFiles(files: File[], reads?: Promise<Uint8Array>[]): Promise<void> {
  showBanner("dx-error", null);
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    try {
      const bytes = await (reads?.[i] ?? readBlobBytes(file));
      const mime = fileMime(file.name, file.type);
      await enqueue(new Blob([bytes as BlobPart], { type: mime }), file.name || "file", mime);
    } catch (error) {
      const msg = isReadFailure(error) ? t("send.readError") : error instanceof Error ? error.message : String(error);
      showBanner("dx-error", msg);
    }
  }
}

async function removeItem(id: string): Promise<void> {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  const index = eligibleIds().indexOf(id);
  items = items.filter((i) => i.id !== id);
  prepared.delete(id);
  states.delete(id);
  failures.delete(id);
  laps.delete(id);
  lookahead = lookahead.filter((frame) => frame.id !== id);
  if (currentId === id) {
    currentIndex = index;
    framesLeft = 0;
  }
  await removeQueueItem(id).catch(() => undefined);
  logEvent("info", "diode.log.txRemoved", { name: item.name });
  renderQueue();
}

function stateLabel(item: QueueItem): string {
  if (item.id === onAirId && running) return t("diode.tx.onAir");
  const state = itemState(item);
  if (state === "blocked") return t("diode.tx.blocked");
  if (state === "failed") return t("diode.tx.failed");
  if (!running) return t("diode.tx.queued");
  return state === "ready" ? t("diode.tx.waiting") : t("diode.tx.preparing");
}

function onAirLabel(item: QueueItem): string {
  return item.name.length > 80 ? `${item.name.slice(0, 77)}…` : item.name;
}

function commitLine(): void {
  if (videoOn) {
    showBanner("dx-error", t("diode.video.busy"));
    return;
  }
  const input = el<HTMLInputElement>("dx-live-input");
  if (!input) return;
  const text = input.value.slice(0, LIVE_MAX_CHARS).trim();
  if (!text) return;
  showBanner("dx-error", null);
  input.value = "";
  const preview = text.length > 80 ? `${text.slice(0, 77)}…` : text;
  logEvent("info", "diode.log.txLive", { text: preview });
  if (!running) start();
  void publish({ kind: "commit", text });
}

function onDraftInput(): void {
  const input = el<HTMLInputElement>("dx-live-input");
  if (!input) return;
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    const value = input.value.slice(0, LIVE_MAX_CHARS);
    if (!value) {
      if (!running || want.kind === "commit") return;
      void publish({ kind: "beacon", text: "" });
      return;
    }
    if (!running) start();
    void publish({ kind: "draft", text: value });
  }, 40);
}

function renderQueue(): void {
  const list = el("dx-queue");
  const empty = el("dx-queue-empty");
  const meta = el("dx-queue-meta");
  const files = fileItems();
  if (!list) return;
  if (empty) empty.hidden = files.length > 0;
  if (meta) {
    const total = files.reduce((sum, item) => sum + item.size, 0);
    meta.textContent = files.length ? `${files.length} · ${formatBytes(total)}` : "";
  }
  list.replaceChildren(
    ...files.map((item) => {
      const li = document.createElement("li");
      li.className = "diode-item";
      if (item.id === onAirId && running) li.classList.add("is-on-air");
      const state = itemState(item);
      if (state === "blocked" || state === "failed") li.classList.add("is-blocked");

      const body = document.createElement("div");
      body.className = "diode-item-body";
      const name = document.createElement("span");
      name.className = "diode-item-name";
      name.textContent = item.name;
      const sub = document.createElement("span");
      sub.className = "diode-item-meta";
      sub.textContent = `${formatBytes(item.size)} · ${stateLabel(item)}`;
      if (state === "failed") sub.title = failures.get(item.id) ?? "";
      body.append(name, sub);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-ghost diode-item-btn";
      remove.textContent = t("diode.remove");
      remove.addEventListener("click", () => void removeItem(item.id));
      li.append(body, remove);
      return li;
    }),
  );
}

function renderStatus(): void {
  const status = el("dx-status");
  const state = el("dx-state");
  const live = el("dx-live");
  const idleText = el("dx-idle-text");
  const onAir = items.find((i) => i.id === onAirId);
  const showingCarrier = !!air && onAirId === air.id;
  if (status) status.hidden = !running;
  if (live) live.hidden = !running || paused || !onAir;
  if (state) {
    if (!running) state.textContent = "";
    else if (paused) state.textContent = t("xfer.paused");
    else if (videoOn && onAirId === videoItemId) state.textContent = t("diode.video.onAir");
    else if (showingCarrier) state.textContent = t("diode.tx.carrier");
    else if (onAir) state.textContent = t("diode.tx.onAirName", { name: onAirLabel(onAir) });
    else state.textContent = t("diode.tx.arming");
  }
  if (idleText) idleText.textContent = running ? t("diode.tx.arming") : t("diode.tx.stopped");
  const turnEl = el("dx-turn");
  const framesEl = el("dx-frames");
  if (turnEl) turnEl.textContent = String(Math.max(turn, 0));
  if (framesEl) framesEl.textContent = String(framesSent);
}

function renderControls(): void {
  const startBtn = el<HTMLButtonElement>("dx-start");
  const pauseBtn = el<HTMLButtonElement>("dx-pause");
  const resumeBtn = el<HTMLButtonElement>("dx-resume");
  const stopBtn = el<HTMLButtonElement>("dx-stop");
  if (startBtn) startBtn.hidden = running;
  if (pauseBtn) pauseBtn.hidden = !running || paused;
  if (resumeBtn) resumeBtn.hidden = !running || !paused;
  if (stopBtn) stopBtn.hidden = !running;
  const liveInput = el<HTMLInputElement>("dx-live-input");
  const liveSend = el<HTMLFormElement>("dx-live-form")?.querySelector("button");
  if (liveInput) liveInput.disabled = videoOn;
  if (liveSend instanceof HTMLButtonElement) liveSend.disabled = videoOn;
}

export function refreshTxText(): void {
  renderQueue();
  renderStatus();
  refreshVideoTx();
}

function onVisibility(): void {
  if (!document.hidden && running) wake.refresh();
}

function wireOnce(): void {
  if (wired) return;
  wired = true;
  wireVideoTx();
  const input = el<HTMLInputElement>("dx-files");
  input?.addEventListener("change", () => {
    const files = input.files ? Array.from(input.files) : [];
    const reads = files.map((file) => readBlobBytes(file));
    input.value = "";
    void onFiles(files, reads);
  });
  const zone = el("dx-drop");
  if (zone) {
    const setDrag = (on: boolean) => zone.classList.toggle("is-dragover", on);
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      setDrag(true);
    });
    zone.addEventListener("dragleave", () => setDrag(false));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      setDrag(false);
      const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
      if (!files.length) return;
      void onFiles(
        files,
        files.map((file) => readBlobBytes(file)),
      );
    });
  }
  el<HTMLFormElement>("dx-live-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    commitLine();
  });
  el<HTMLInputElement>("dx-live-input")?.addEventListener("input", onDraftInput);
  el("dx-start")?.addEventListener("click", start);
  el("dx-pause")?.addEventListener("click", () => setPaused(true));
  el("dx-resume")?.addEventListener("click", () => setPaused(false));
  el("dx-stop")?.addEventListener("click", stopTx);
  const fpsSelect = el<HTMLSelectElement>("dx-fps");
  if (fpsSelect) {
    try {
      const saved = localStorage.getItem(FPS_KEY);
      if (saved && [...fpsSelect.options].some((o) => o.value === saved)) fpsSelect.value = saved;
    } catch {
      /* ignore */
    }
    fpsSelect.addEventListener("change", () => {
      try {
        localStorage.setItem(FPS_KEY, fpsSelect.value);
      } catch {
        /* ignore */
      }
    });
  }
  const gridSelect = el<HTMLSelectElement>("dx-grid");
  if (gridSelect) {
    try {
      const saved = localStorage.getItem(GRID_KEY);
      if (saved === "2" || saved === "4") gridSelect.value = saved;
    } catch {
      /* ignore */
    }
    syncGridButtons();
    document.querySelectorAll<HTMLButtonElement>("[data-diode-grid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.diodeGrid ?? "1";
        if (gridSelect.value === next) return;
        gridSelect.value = next;
        syncGridButtons();
        try {
          localStorage.setItem(GRID_KEY, next);
        } catch {
          /* ignore */
        }
        retargetGrid();
      });
    });
  }
  window.addEventListener(POLICY_EVENT, () => {
    if (mounted) renderQueue();
  });
}

export async function mountTx(): Promise<void> {
  wireOnce();
  if (!mounted) {
    mounted = true;
    document.addEventListener("visibilitychange", onVisibility);
    try {
      items = await listQueue();
    } catch (error) {
      showBanner("dx-error", t("diode.storeError", { msg: error instanceof Error ? error.message : String(error) }));
    }
  }
  renderQueue();
  renderControls();
  renderStatus();
  setStage(running && onAirId !== null);
  if (!running) start();
  el<HTMLInputElement>("dx-live-input")?.focus();
}

export function unmountTx(): void {
  stopTx();
  mounted = false;
  prepared.clear();
  states.clear();
  failures.clear();
  document.removeEventListener("visibilitychange", onVisibility);
}

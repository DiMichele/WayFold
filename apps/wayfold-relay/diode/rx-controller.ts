import { envelopeDigest, parseEnvelope } from "../shared/envelope.ts";
import { LTDecoder } from "../shared/fountain.ts";
import { t } from "../shared/i18n.ts";
import {
  ENVELOPE_FIXED_LEN,
  MAX_FILENAME_BYTES,
  MAX_MIME_BYTES,
  SESSION_STALL_TIMEOUT_MS,
} from "../shared/limits.ts";
import { symbolsFromWorker } from "../shared/optical.ts";
import { getOptFlags } from "../shared/opt-flags.ts";
import { optTrace, timed, wallNow } from "../shared/opt-trace.ts";
import { ensureOptHud, removeOptHud, renderOptHud } from "../shared/opt-ui.ts";
import { fnv1a, parseFrame, type FrameHeader } from "../shared/protocol.ts";
import {
  applyQrFocusConstraints,
  tapPointInVideoFrame,
  type FocusPoint,
  type QrTrackCapabilities,
} from "../receive/camera.ts";
import { workerPlanFields } from "../receive/worker-plan.ts";
import { ScreenWake, currentPolicy, el, formatBytes, logEvent, showBanner } from "./common.ts";
import { decodeLiveRecord, isLiveMime, isNewerLive, type LiveRecord } from "./live.ts";
import { acceptVideoPacket, renderVideoStats, resetVideoPlayback } from "./video-rx.ts";
import { isVideoMime } from "./video-wire.ts";
import { checkPolicy } from "./policy.ts";

const CAPTURE_WIDTH = 1280;
const CAPTURE_FPS = 30;
const WORKER_COUNT = 2;
const MAX_OPEN_SESSIONS = 4;
const MAX_FINISHED_KEYS = 512;
const OVERHEAD_EST = 1.12;
const STATS_TICK_MS = 500;
/** Envelope bytes that can sit on top of the file: wire length minus this is a floor on the original size. */
const MAX_ENVELOPE_OVERHEAD = ENVELOPE_FIXED_LEN + MAX_FILENAME_BYTES + MAX_MIME_BYTES;

interface OpenSession {
  key: string;
  header: FrameHeader;
  decoder: LTDecoder;
  openedAt: number;
  touchedAt: number;
}

let wired = false;
let mounted = false;
let running = false;
let suspended = false;
let stream: MediaStream | null = null;
let captureGen = 0;
let frameId = 0;
let statsTimer: number | null = null;
const workers: Worker[] = [];
const busy: boolean[] = [];
const grab = document.createElement("canvas");
const open = new Map<string, OpenSession>();
const finished: string[] = [];
const finishedSet = new Set<string>();
let lastKey: string | null = null;
let counts = { received: 0, rejected: 0, duplicates: 0 };
let latest = "";
let liveCursor: Pick<LiveRecord, "epoch" | "seq"> | null = null;
let draftText = "";
const wake = new ScreenWake();

function sessionKey(h: FrameHeader): string {
  return [h.sessionId, h.k, h.blockLen, h.totalLen, h.payloadFnv].join(":");
}

function markFinished(key: string): void {
  if (finishedSet.has(key)) return;
  finishedSet.add(key);
  finished.push(key);
  while (finished.length > MAX_FINISHED_KEYS) finishedSet.delete(finished.shift()!);
}

function sessionPct(s: OpenSession): number {
  const frames = s.decoder.framesNew / (s.decoder.k * OVERHEAD_EST);
  const solved = s.decoder.solvedCount / s.decoder.k;
  return Math.min(99, Math.max(frames, solved) * 100);
}

function closeSession(s: OpenSession, reasonKey: string): void {
  open.delete(s.key);
  if (lastKey === s.key) lastKey = null;
  logEvent("warn", reasonKey, {
    session: s.header.sessionId,
    pct: Math.round(sessionPct(s)),
    size: formatBytes(s.header.totalLen),
  });
}

function onDecoded(bytes: Uint8Array): void {
  if (!running) return;
  const parsed = timed("parse", () => parseFrame(bytes));
  if (!parsed) return;
  const { header, block } = parsed;
  const key = sessionKey(header);
  if (finishedSet.has(key)) return;

  let session = open.get(key);
  if (!session) {
    const policy = currentPolicy();
    if (header.totalLen - MAX_ENVELOPE_OVERHEAD > policy.maxBytes) {
      markFinished(key);
      counts.rejected++;
      logEvent("warn", "diode.log.rxRejectSizeEarly", {
        session: header.sessionId,
        size: formatBytes(header.totalLen),
        max: formatBytes(policy.maxBytes),
      });
      renderStats();
      return;
    }
    if (open.size >= MAX_OPEN_SESSIONS) {
      const oldest = [...open.values()].sort((a, b) => a.touchedAt - b.touchedAt)[0];
      if (oldest) closeSession(oldest, "diode.log.rxEvicted");
    }
    const now = performance.now();
    session = {
      key,
      header: { ...header },
      decoder: new LTDecoder(header.k, header.blockLen, header.sessionId, header.totalLen),
      openedAt: now,
      touchedAt: now,
    };
    open.set(key, session);
  }

  const before = session.decoder.framesNew;
  const solvedBefore = session.decoder.solvedCount;
  timed("fountain", () => {
    session!.decoder.addFrame(header.seq, block);
  });
  if (session.decoder.framesNew > before) {
    session.touchedAt = performance.now();
    lastKey = key;
    optTrace.noteUniqueSymbol(block.length);
  }
  if (session.decoder.solvedCount > solvedBefore) {
    optTrace.noteFountainGrowth((session.decoder.solvedCount - solvedBefore) * session.decoder.blockLen);
  }

  if (session.decoder.isComplete) {
    const payload = session.decoder.assemble();
    open.delete(key);
    if (lastKey === key) lastKey = null;
    markFinished(key);
    if (payload) void complete(session, payload);
  }
}

function acceptLive(record: LiveRecord, seconds: string): void {
  if (!isNewerLive(liveCursor, record)) return;
  if (!(record.epoch === 0 && record.seq === 0)) liveCursor = { epoch: record.epoch, seq: record.seq };
  if (record.kind === "beacon") {
    draftText = "";
    renderLive();
    return;
  }
  if (record.kind === "draft") {
    draftText = record.text;
    renderLive();
    return;
  }
  draftText = "";
  latest = record.text;
  counts.received++;
  const preview = record.text.length > 80 ? `${record.text.slice(0, 77)}…` : record.text;
  logEvent("info", "diode.log.rxLive", { text: preview, sec: seconds });
  renderLive();
  renderStats();
}

async function complete(session: OpenSession, payload: Uint8Array): Promise<void> {
  const seconds = ((performance.now() - session.openedAt) / 1000).toFixed(1);
  if (fnv1a(payload) !== session.header.payloadFnv) {
    counts.rejected++;
    logEvent("error", "diode.log.rxIntegrityFnv", { session: session.header.sessionId });
    renderStats();
    return;
  }
  const parsed = await parseEnvelope(payload);
  const digest = envelopeDigest(payload);
  if (!parsed || !digest) {
    counts.rejected++;
    logEvent("error", "diode.log.rxIntegrityEnvelope", { session: session.header.sessionId });
    renderStats();
    return;
  }
  optTrace.noteFileComplete(parsed.file.length, Number(seconds) || 0.001);
  if (isLiveMime(parsed.mime)) {
    const record = decodeLiveRecord(parsed.file);
    if (!record || parsed.file.length > currentPolicy().maxBytes) {
      counts.rejected++;
      logEvent("warn", "diode.log.rxRejectSize", {
        name: parsed.filename,
        size: formatBytes(parsed.file.length),
        max: formatBytes(currentPolicy().maxBytes),
      });
      renderStats();
      return;
    }
    acceptLive(record, seconds);
    return;
  }
  if (isVideoMime(parsed.mime)) {
    acceptVideoPacket(parsed.file);
    return;
  }
  const policy = currentPolicy();
  const verdict = checkPolicy(policy, { filename: parsed.filename, size: parsed.file.length });
  if (!verdict.ok) {
    counts.rejected++;
    logEvent("warn", verdict.reason === "size" ? "diode.log.rxRejectSize" : "diode.log.rxRejectType", {
      name: parsed.filename,
      size: formatBytes(parsed.file.length),
      max: formatBytes(policy.maxBytes),
    });
    renderStats();
    return;
  }
  counts.received++;
  logEvent("info", "diode.log.rxReceived", { name: parsed.filename, size: formatBytes(parsed.file.length), sec: seconds });
  download(parsed.filename, new Blob([parsed.file as BlobPart], { type: parsed.mime }));
  renderStats();
}

function checkStalls(): void {
  const now = performance.now();
  for (const s of [...open.values()]) {
    if (now - s.touchedAt > SESSION_STALL_TIMEOUT_MS) closeSession(s, "diode.log.rxStall");
  }
}

function videoTrack(): MediaStreamTrack | null {
  return stream?.getVideoTracks()[0] ?? null;
}

let focusBusy = false;
let focusQueued: { point: FocusPoint; pref: "continuous" | "single-shot"; kind: "startup" | "tap" } | null =
  null;

async function focusAt(
  point: FocusPoint,
  pref: "continuous" | "single-shot",
  kind: "startup" | "tap" = "startup",
): Promise<void> {
  const track = videoTrack();
  if (!track) return;
  if (focusBusy) {
    focusQueued = { point, pref, kind };
    return;
  }
  focusBusy = true;
  try {
    let caps: QrTrackCapabilities = {};
    try {
      caps = (track.getCapabilities?.() ?? {}) as QrTrackCapabilities;
    } catch {
      /* ignore */
    }
    await applyQrFocusConstraints(track, caps, point, pref, kind);
  } finally {
    focusBusy = false;
    const next = focusQueued;
    focusQueued = null;
    if (next && running) void focusAt(next.point, next.pref, next.kind);
  }
}

function showFocusReticle(point: FocusPoint): void {
  const preview = el("dr-preview");
  if (!preview) return;
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
}

async function acquireCamera(): Promise<MediaStream> {
  const video: MediaTrackConstraints = {
    facingMode: { ideal: "environment" },
    width: { ideal: CAPTURE_WIDTH },
    height: { ideal: Math.round((CAPTURE_WIDTH * 3) / 4) },
    frameRate: { ideal: CAPTURE_FPS },
  };
  Object.assign(video, { focusMode: { ideal: "continuous" } });
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video });
  } catch (preferredErr) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
    } catch {
      throw preferredErr;
    }
  }
}

function releaseCamera(): void {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  const video = el<HTMLVideoElement>("dr-video");
  if (video) video.srcObject = null;
}

async function attachCamera(): Promise<boolean> {
  const video = el<HTMLVideoElement>("dr-video");
  if (!video) return false;
  const attempt = ++captureGen;
  try {
    const next = await acquireCamera();
    if (!running || attempt !== captureGen) {
      next.getTracks().forEach((track) => track.stop());
      return false;
    }
    stream = next;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const denied = /NotAllowedError|Permission denied|PermissionDismissed/i.test(msg);
    showBanner("dr-error", denied ? t("receive.deniedHelp") : t("receive.cameraError", { msg }));
    logEvent("error", "diode.log.rxCameraError", { msg });
    return false;
  }
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  void focusAt({ x: 0.5, y: 0.5 }, "continuous", "startup");
  scheduleFrame(captureGen);
  return true;
}

type VideoRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, meta?: { presentedFrames?: number; mediaTime?: number }) => void,
  ) => number;
};

function scheduleFrame(gen: number): void {
  if (!running || gen !== captureGen) return;
  const video = el<HTMLVideoElement>("dr-video") as VideoRVFC | null;
  if (!video) return;
  const next = (_now?: number, meta?: { presentedFrames?: number; mediaTime?: number }) => {
    if (!running || gen !== captureGen) return;
    optTrace.noteVideoMeta(meta);
    if (!suspended) captureFrame(video);
    scheduleFrame(gen);
  };
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(next);
  else requestAnimationFrame(() => next());
}

function captureFrame(video: HTMLVideoElement): void {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const slot = busy.indexOf(false);
  if (slot === -1) return;
  if (grab.width !== vw || grab.height !== vh) {
    grab.width = vw;
    grab.height = vh;
  }
  const postedAt = wallNow();
  const img = timed("extract", () => {
    const ctx = grab.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0);
    return ctx.getImageData(0, 0, vw, vh);
  });
  busy[slot] = true;
  optTrace.setWorkers(busy.filter(Boolean).length, workers.length);
  optTrace.noteProcessed();
  const plan = workerPlanFields(optTrace.observedFps() || optTrace.negotiatedFps || CAPTURE_FPS);
  workers[slot]!.postMessage(
    { id: frameId++, buf: img.data.buffer, w: vw, h: vh, postedAt, ...plan },
    [img.data.buffer],
  );
}

function startWorkers(): void {
  for (let i = 0; i < WORKER_COUNT; i++) {
    const worker = new Worker(new URL("../receive/worker.ts", import.meta.url), { type: "module" });
    const slot = i;
    worker.onmessage = (e: MessageEvent) => {
      const { id, error, postedAt, doneAt } = e.data as {
        id: number;
        error?: string;
        postedAt?: number;
        doneAt?: number;
      };
      if (error) {
        showBanner("dr-error", t("receive.workerError", { msg: error }));
        logEvent("error", "diode.log.rxWorkerError", { msg: error });
        return;
      }
      if (id === -1) return;
      busy[slot] = false;
      optTrace.setWorkers(busy.filter(Boolean).length, workers.length);
      if (getOptFlags().perf && typeof postedAt === "number" && typeof doneAt === "number") {
        optTrace.mark("wasm", postedAt, Math.max(0, doneAt - postedAt));
      }
      for (const symbol of symbolsFromWorker(e.data)) onDecoded(symbol);
    };
    worker.onerror = (event) => {
      busy[slot] = false;
      showBanner("dr-error", t("receive.workerError", { msg: event.message }));
      logEvent("error", "diode.log.rxWorkerError", { msg: event.message });
    };
    workers.push(worker);
    busy.push(false);
  }
  optTrace.setWorkers(0, workers.length);
}

function stopWorkers(): void {
  for (const worker of workers) worker.terminate();
  workers.length = 0;
  busy.length = 0;
}

async function start(): Promise<void> {
  if (running) return;
  showBanner("dr-error", null);
  if (!navigator.mediaDevices?.getUserMedia) {
    showBanner("dr-error", location.protocol === "file:" ? t("receive.fileCamera") : t("receive.secureError"));
    return;
  }
  running = true;
  suspended = false;
  resetVideoPlayback();
  counts = { received: 0, rejected: 0, duplicates: 0 };
  open.clear();
  lastKey = null;
  if (getOptFlags().perf) {
    optTrace.reset();
    optTrace.configuredFps = CAPTURE_FPS;
  }
  renderControls();
  startWorkers();
  const ok = await attachCamera();
  if (!running) return;
  if (!ok) {
    stopRx(false);
    return;
  }
  if (getOptFlags().perf) {
    try {
      const settings = stream?.getVideoTracks()[0]?.getSettings?.() ?? {};
      optTrace.negotiatedFps = Number(settings.frameRate) || 0;
    } catch {
      optTrace.negotiatedFps = 0;
    }
    ensureOptHud(el("dr-camera"));
  }
  wake.acquire();
  statsTimer = window.setInterval(() => {
    checkStalls();
    renderStats();
  }, STATS_TICK_MS);
  logEvent("info", "diode.log.rxStarted");
  renderControls();
  renderStats();
}

export function stopRx(log = true): void {
  if (!running) return;
  running = false;
  suspended = false;
  captureGen++;
  releaseCamera();
  stopWorkers();
  wake.release();
  if (statsTimer !== null) {
    window.clearInterval(statsTimer);
    statsTimer = null;
  }
  for (const s of [...open.values()]) closeSession(s, "diode.log.rxAbandoned");
  latest = "";
  draftText = "";
  resetVideoPlayback();
  removeOptHud(el("dr-camera"));
  if (log) logEvent("info", "diode.log.rxStopped", { received: counts.received, rejected: counts.rejected });
  renderControls();
  renderLive();
  renderStats();
}

export function isRxRunning(): boolean {
  return running;
}

async function resumeCamera(): Promise<void> {
  if (!running) return;
  showBanner("dr-error", null);
  const ok = await attachCamera();
  if (ok) {
    suspended = false;
    wake.refresh();
  }
  renderControls();
  renderStats();
}

function onVisibility(): void {
  if (!running) return;
  if (document.hidden) {
    suspended = true;
    captureGen++;
    releaseCamera();
    for (let i = 0; i < busy.length; i++) busy[i] = false;
    renderControls();
    return;
  }
  void resumeCamera();
}

function onPreviewPointer(ev: PointerEvent): void {
  if (!running || suspended) return;
  const preview = el("dr-preview");
  const video = el<HTMLVideoElement>("dr-video");
  if (!preview || !video) return;
  const point = tapPointInVideoFrame(
    ev.clientX,
    ev.clientY,
    preview.getBoundingClientRect(),
    video.videoWidth,
    video.videoHeight,
    "contain",
  );
  showFocusReticle(point);
  void focusAt(point, "single-shot", "tap");
}

function renderControls(): void {
  const startBtn = el<HTMLButtonElement>("dr-start");
  const stopBtn = el<HTMLButtonElement>("dr-stop");
  const resumeBtn = el<HTMLButtonElement>("dr-resume");
  const camera = el("dr-camera");
  const intro = el("dr-intro");
  if (startBtn) startBtn.hidden = running;
  if (stopBtn) stopBtn.hidden = !running;
  if (resumeBtn) resumeBtn.hidden = !running || !!stream;
  if (camera) camera.hidden = !running;
  if (intro) intro.hidden = running;
}

function renderLive(): void {
  const now = el("dr-now");
  if (now) {
    now.hidden = !latest;
    now.textContent = latest;
  }
  const draft = el("dr-draft");
  if (!draft) return;
  draft.replaceChildren();
  if (!draftText) {
    draft.hidden = true;
    return;
  }
  draft.hidden = false;
  const label = document.createElement("strong");
  label.textContent = t("diode.live.draft");
  const body = document.createElement("span");
  body.textContent = draftText;
  draft.append(label, body);
}

function renderStats(): void {
  const stateEl = el("dr-state");
  const pctEl = el("dr-pct");
  const bar = el("dr-bar");
  const progress = el("dr-progress");
  const current = lastKey ? open.get(lastKey) : undefined;
  const pct = current ? sessionPct(current) : 0;
  if (stateEl) {
    if (!running) stateEl.textContent = "";
    else if (!stream) stateEl.textContent = t("diode.rx.cameraPaused");
    else if (current) {
      stateEl.textContent = t("diode.rx.receiving", {
        session: current.header.sessionId,
        size: formatBytes(current.header.totalLen),
      });
    } else stateEl.textContent = t("diode.rx.listening");
  }
  if (pctEl) pctEl.textContent = current ? `${Math.round(pct)}%` : "";
  if (bar) bar.style.width = `${pct.toFixed(1)}%`;
  progress?.classList.toggle("is-searching", running && !current);
  progress?.classList.toggle("is-receiving", running && !!current);
  const set = (id: string, value: number) => {
    const node = el(id);
    if (node) node.textContent = String(value);
  };
  set("dr-received", counts.received);
  set("dr-rejected", counts.rejected);
  set("dr-dupes", counts.duplicates);
  set("dr-open", open.size);
  if (getOptFlags().perf) renderOptHud(el("dr-camera"));
}

function download(name: string, data: Blob): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function refreshRxText(): void {
  renderLive();
  renderStats();
  renderVideoStats();
}

function wireOnce(): void {
  if (wired) return;
  wired = true;
  el("dr-start")?.addEventListener("click", () => void start());
  el("dr-stop")?.addEventListener("click", () => stopRx());
  el("dr-resume")?.addEventListener("click", () => void resumeCamera());
  el("dr-preview")?.addEventListener("pointerdown", onPreviewPointer);
}

export async function mountRx(): Promise<void> {
  wireOnce();
  if (!mounted) {
    mounted = true;
    document.addEventListener("visibilitychange", onVisibility);
  }
  renderControls();
  renderLive();
  renderStats();
}

export function unmountRx(): void {
  stopRx();
  mounted = false;
  document.removeEventListener("visibilitychange", onVisibility);
}

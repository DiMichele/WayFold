import { t } from "../shared/i18n.ts";
import { el, logEvent, showBanner } from "./common.ts";
import {
  diodeBlockLen,
  dropQueuedVideo,
  isTxPaused,
  pushVideoPacket,
  startVideoCarrier,
  stopVideoCarrier,
  videoPacketsOnAir,
  videoQueueDepth,
} from "./tx-controller.ts";
import {
  VIDEO_BITRATE,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  encodeConfigPacket,
  maxVideoPayloadBytes,
  splitVideoChunk,
} from "./video-wire.ts";

const CODECS = ["avc1.42001e", "avc1.42E01E", "avc1.4D401E", "avc1.64001E"];
/**
 * Skip new deltas once this many packets are waiting. A keyframe may be a
 * config plus two QR pieces; anything deeper is already late for a 280 ms hold.
 */
const QUEUE_SKIP = 3;

let active = false;
let starting = false;
let stopping = false;
let ran = false;
let runGen = 0;
let facing: "user" | "environment" = "environment";
let stream: MediaStream | null = null;
let encoder: VideoEncoder | null = null;
let codec = "";
let description: Uint8Array | null = null;
let streamId = 1;
let seq = 0;
let frameIndex = 0;
let needKey = true;
let sent = 0;
let dropped = 0;
let timer = 0;
let startedAt = 0;
let encoderConfig: VideoEncoderConfig | null = null;
const VIDEO_FPS_KEY = "wf-diode-video-fps";
const scratch = document.createElement("canvas");
scratch.width = VIDEO_WIDTH;
scratch.height = VIDEO_HEIGHT;

function videoFps(): number {
  const value = Number(el<HTMLSelectElement>("dx-video-fps")?.value);
  return value >= 1 && value <= 30 ? value : VIDEO_FPS;
}

/** 16 kbps at 2 fps is the tuned point. Higher rates stay capped so a keyframe still fits a QR. */
function videoBitrate(): number {
  return Math.min(24_000, Math.round(VIDEO_BITRATE * (videoFps() / VIDEO_FPS)));
}

function videoGop(): number {
  return Math.max(2, videoFps() * 2);
}

function payloadMax(): number {
  return maxVideoPayloadBytes(diodeBlockLen());
}

/** The next keyframe is cut to the block size of the grid now on screen. */
export function retargetVideoEncoder(): void {
  if (!active) return;
  needKey = true;
}

function copyBytes(src: AllowSharedBufferSource): Uint8Array {
  if (src instanceof Uint8Array) return src.slice();
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength).slice();
  return new Uint8Array(src).slice();
}

function renderVideoControls(): void {
  const startBtn = el<HTMLButtonElement>("dx-video-start");
  const stopBtn = el<HTMLButtonElement>("dx-video-stop");
  const flipBtn = el<HTMLButtonElement>("dx-video-flip");
  if (startBtn) startBtn.hidden = active || starting;
  if (stopBtn) stopBtn.hidden = !active && !starting;
  if (flipBtn) flipBtn.hidden = !active;
  document.querySelector("[data-diode-pay='video']")?.classList.toggle("is-live", active);
}

function renderVideoStats(): void {
  const node = el("dx-video-stats");
  if (!node) return;
  if (!active && sent === 0 && dropped === 0) {
    node.textContent = t("diode.video.statsPlan", {
      w: VIDEO_WIDTH,
      h: VIDEO_HEIGHT,
      fps: videoFps(),
      kbps: Math.round(videoBitrate() / 1000),
    });
    return;
  }
  node.textContent = t("diode.video.statsTx", {
    codec: codec || "H.264",
    fps: videoFps(),
    kbps: Math.round(videoBitrate() / 1000),
    queue: videoQueueDepth(),
    sent: videoPacketsOnAir(),
    dropped,
  });
}

export function refreshVideoTx(): void {
  renderVideoControls();
  renderVideoStats();
}

function fail(message: string): void {
  showBanner("dx-error", message);
}

async function acquire(gen: number): Promise<MediaStream> {
  const video: MediaTrackConstraints = {
    facingMode: { ideal: facing },
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 15 },
  };
  const next = await navigator.mediaDevices.getUserMedia({ audio: false, video });
  if (gen !== runGen) {
    next.getTracks().forEach((track) => track.stop());
    throw new DOMException("cancelled", "AbortError");
  }
  return next;
}

function attachPreview(next: MediaStream): void {
  stream?.getTracks().forEach((track) => track.stop());
  stream = next;
  const preview = el<HTMLVideoElement>("dx-video-preview");
  if (!preview) return;
  preview.muted = true;
  preview.playsInline = true;
  preview.srcObject = next;
  preview.hidden = false;
  void preview.play().catch(() => undefined);
}

function onEncoderError(error: DOMException): void {
  if (!active || stopping) return;
  fail(error.message);
  stopVideoCapture();
}

function emit(bytes: Uint8Array): void {
  pushVideoPacket(bytes);
  sent++;
}

function onEncoded(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
  if (!active) return;
  const key = chunk.type === "key";
  if (meta?.decoderConfig?.description) {
    description = copyBytes(meta.decoderConfig.description);
    if (meta.decoderConfig.codec) codec = meta.decoderConfig.codec;
  }
  if (!key && (videoQueueDepth() >= QUEUE_SKIP || (encoder?.encodeQueueSize ?? 0) > 2)) {
    dropped++;
    needKey = true;
    renderVideoStats();
    return;
  }
  if (chunk.byteLength === 0) return;
  const budget = payloadMax();
  if (key) {
    if (!description || !codec) {
      fail(t("diode.video.noConfig"));
      queueMicrotask(() => stopVideoCapture());
      return;
    }
    if (videoQueueDepth() >= QUEUE_SKIP) dropped += dropQueuedVideo();
    const config = encodeConfigPacket({
      streamId,
      seq,
      codec,
      description,
      payloadMax: budget,
    });
    if (!config) {
      fail(t("diode.video.noConfig"));
      queueMicrotask(() => stopVideoCapture());
      return;
    }
    emit(config);
    seq = (seq + 1) >>> 0;
  }
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  let parts: Uint8Array[];
  try {
    parts = splitVideoChunk({
      streamId,
      seq,
      timestampMs: Math.max(0, Math.round(chunk.timestamp / 1000)),
      key,
      data,
      payloadMax: budget,
    });
  } catch {
    dropped++;
    needKey = true;
    renderVideoStats();
    return;
  }
  for (const part of parts) emit(part);
  seq = (seq + 1) >>> 0;
  renderVideoStats();
}

async function openEncoder(): Promise<void> {
  const attempts: Array<(name: string) => VideoEncoderConfig> = [
    (name) => ({
      codec: name,
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      bitrate: videoBitrate(),
      framerate: videoFps(),
      latencyMode: "realtime",
      bitrateMode: "constant",
      hardwareAcceleration: "prefer-software",
      avc: { format: "avc" },
    }),
    (name) => ({
      codec: name,
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      bitrate: videoBitrate(),
      framerate: videoFps(),
      latencyMode: "realtime",
      bitrateMode: "constant",
      hardwareAcceleration: "prefer-hardware",
      avc: { format: "avc" },
    }),
    (name) => ({
      codec: name,
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      bitrate: videoBitrate(),
      framerate: videoFps(),
      latencyMode: "realtime",
      avc: { format: "avc" },
    }),
  ];
  let last = "";
  for (const make of attempts) {
    for (const name of CODECS) {
      const config = make(name);
      let created: VideoEncoder | null = null;
      try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (!support.supported) continue;
        created = new VideoEncoder({ output: onEncoded, error: onEncoderError });
        created.configure(support.config ?? config);
        encoder = created;
        encoderConfig = support.config ?? config;
        codec = support.config?.codec || name;
        return;
      } catch (error) {
        try {
          created?.close();
        } catch {
          /* ignore */
        }
        last = error instanceof Error ? error.message : String(error);
      }
    }
  }
  throw new Error(last || t("diode.video.unsupported"));
}

function drawFrame(video: HTMLVideoElement): boolean {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return false;
  const ctx = scratch.getContext("2d");
  if (!ctx) return false;
  const scale = Math.max(VIDEO_WIDTH / vw, VIDEO_HEIGHT / vh);
  const sw = VIDEO_WIDTH / scale;
  const sh = VIDEO_HEIGHT / scale;
  ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  return true;
}

function tick(): void {
  timer = 0;
  if (!active) return;
  const video = el<HTMLVideoElement>("dx-video-preview");
  if (!isTxPaused() && video && encoder && encoder.state === "configured" && encoder.encodeQueueSize < 3) {
    if (videoQueueDepth() >= QUEUE_SKIP) {
      dropped++;
      needKey = true;
    } else if (drawFrame(video)) {
      const timestamp = Math.max(0, Math.round((performance.now() - startedAt) * 1000));
      const frame = new VideoFrame(scratch, {
        timestamp,
        duration: Math.round(1_000_000 / videoFps()),
      });
      const key = needKey || frameIndex % videoGop() === 0;
      needKey = false;
      frameIndex++;
      try {
        encoder.encode(frame, { keyFrame: key });
      } catch (error) {
        frame.close();
        fail(error instanceof Error ? error.message : String(error));
        stopVideoCapture();
        return;
      }
      frame.close();
    }
  }
  renderVideoStats();
  timer = window.setTimeout(tick, Math.round(1000 / videoFps()));
}

function applyLiveFps(): void {
  renderVideoStats();
  if (encoder && encoder.state === "configured" && encoderConfig) {
    const next = { ...encoderConfig, framerate: videoFps(), bitrate: videoBitrate() };
    try {
      encoder.configure(next);
      encoderConfig = next;
      needKey = true;
    } catch {
      /* keep the encoder on the previous rate */
    }
  }
  if (!active) return;
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(tick, Math.round(1000 / videoFps()));
}

export async function startVideo(): Promise<void> {
  if (active || starting) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    fail(location.protocol === "file:" ? t("receive.fileCamera") : t("receive.secureError"));
    return;
  }
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    fail(t("diode.video.unsupported"));
    return;
  }
  starting = true;
  const gen = ++runGen;
  renderVideoControls();
  showBanner("dx-error", null);
  try {
    const next = await acquire(gen);
    if (gen !== runGen) return;
    attachPreview(next);
    await openEncoder();
    if (gen !== runGen) {
      try {
        encoder?.close();
      } catch {
        /* ignore */
      }
      encoder = null;
      return;
    }
  } catch (error) {
    if (gen !== runGen) return;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    const preview = el<HTMLVideoElement>("dx-video-preview");
    if (preview) {
      preview.srcObject = null;
      preview.hidden = true;
    }
    const msg = error instanceof Error ? error.message : String(error);
    const denied = /NotAllowed|Permission/i.test(msg);
    fail(denied ? t("receive.deniedHelp") : msg || t("diode.video.unsupported"));
    starting = false;
    renderVideoControls();
    return;
  }
  active = true;
  starting = false;
  ran = true;
  streamId = crypto.getRandomValues(new Uint16Array(1))[0]! || 1;
  seq = 0;
  frameIndex = 0;
  needKey = true;
  sent = 0;
  dropped = 0;
  description = null;
  startedAt = performance.now();
  startVideoCarrier();
  logEvent("info", "diode.log.txVideo", { codec, kbps: Math.round(videoBitrate() / 1000) });
  renderVideoControls();
  renderVideoStats();
  tick();
}

export function stopVideoCapture(): void {
  if (stopping) return;
  stopping = true;
  runGen++;
  const shouldLog = ran;
  active = false;
  starting = false;
  if (timer) window.clearTimeout(timer);
  timer = 0;
  if (encoder && encoder.state !== "closed") {
    try {
      encoder.close();
    } catch {
      /* ignore */
    }
  }
  encoder = null;
  encoderConfig = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  const preview = el<HTMLVideoElement>("dx-video-preview");
  if (preview) {
    preview.srcObject = null;
    preview.hidden = true;
  }
  stopVideoCarrier();
  if (shouldLog) {
    logEvent("info", "diode.log.txVideoStop", { sent, dropped });
    ran = false;
  }
  renderVideoControls();
  renderVideoStats();
  stopping = false;
}

async function flipCamera(): Promise<void> {
  if (!active) return;
  const gen = runGen;
  facing = facing === "environment" ? "user" : "environment";
  try {
    const next = await acquire(gen);
    if (gen !== runGen || !active) {
      next.getTracks().forEach((track) => track.stop());
      return;
    }
    attachPreview(next);
    needKey = true;
  } catch (error) {
    if (gen !== runGen) return;
    const msg = error instanceof Error ? error.message : String(error);
    if (!/AbortError/i.test(msg)) fail(msg);
  }
}

function bindVideoFps(): void {
  const select = el<HTMLSelectElement>("dx-video-fps");
  if (!select || select.dataset.bound === "1") return;
  select.dataset.bound = "1";
  try {
    const saved = localStorage.getItem(VIDEO_FPS_KEY);
    if (saved && [...select.options].some((option) => option.value === saved)) select.value = saved;
  } catch {
    /* ignore */
  }
  select.addEventListener("change", () => {
    try {
      localStorage.setItem(VIDEO_FPS_KEY, select.value);
    } catch {
      /* ignore */
    }
    applyLiveFps();
  });
}

export function wireVideoTx(): void {
  bindVideoFps();
  el("dx-video-start")?.addEventListener("click", () => void startVideo());
  el("dx-video-stop")?.addEventListener("click", () => stopVideoCapture());
  el("dx-video-flip")?.addEventListener("click", () => void flipCamera());
  refreshVideoTx();
}

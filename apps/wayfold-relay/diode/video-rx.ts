import { t } from "../shared/i18n.ts";
import { el, logEvent } from "./common.ts";
import { VideoAssembler, decodeVideoPacket, type AssembledVideo } from "./video-wire.ts";

const assembler = new VideoAssembler();
let decoder: VideoDecoder | null = null;
let codec = "";
let description: Uint8Array | null = null;
let waitKey = true;
let packets = 0;
let gaps = 0;
let frames = 0;
let decoderError = "";
let logged = false;

function closeDecoder(): void {
  if (!decoder) return;
  try {
    if (decoder.state !== "closed") decoder.close();
  } catch {
    /* already gone */
  }
  decoder = null;
}

function draw(frame: VideoFrame): void {
  const canvas = el<HTMLCanvasElement>("dr-video-out");
  if (!canvas) return;
  const width = frame.displayWidth || VIDEO_WIDTH_FALLBACK;
  const height = frame.displayHeight || VIDEO_HEIGHT_FALLBACK;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(frame, 0, 0, canvas.width, canvas.height);
  const wait = el("dr-video-wait");
  if (wait) wait.hidden = true;
}

const VIDEO_WIDTH_FALLBACK = 176;
const VIDEO_HEIGHT_FALLBACK = 144;

function onOutput(frame: VideoFrame): void {
  frames++;
  waitKey = false;
  decoderError = "";
  if (!logged) {
    logged = true;
    logEvent("info", "diode.log.rxVideo", { w: frame.displayWidth, h: frame.displayHeight });
  }
  try {
    draw(frame);
  } finally {
    frame.close();
  }
  renderVideoStats();
}

function onDecoderError(error: DOMException): void {
  waitKey = true;
  decoderError = error.message;
  closeDecoder();
  renderVideoStats();
}

function ensureDecoder(): boolean {
  if (typeof VideoDecoder === "undefined" || !codec || !description) return false;
  if (decoder && decoder.state === "closed") decoder = null;
  if (!decoder) {
    decoder = new VideoDecoder({ output: onOutput, error: onDecoderError });
  }
  if (decoder.state === "configured") return true;
  try {
    decoder.configure({
      codec,
      description: description.slice(),
      optimizeForLatency: true,
      hardwareAcceleration: "no-preference",
    });
  } catch (error) {
    decoderError = error instanceof Error ? error.message : String(error);
    closeDecoder();
    renderVideoStats();
    return false;
  }
  return true;
}

function noteLoss(event: AssembledVideo): void {
  const missing = event.gap + (event.broken ? 1 : 0);
  if (missing <= 0) return;
  gaps += missing;
  waitKey = true;
  if (decoder && decoder.state === "configured") {
    try {
      decoder.reset();
    } catch {
      closeDecoder();
    }
  }
}

function play(event: Extract<AssembledVideo, { kind: "chunk" }>): void {
  if (event.fresh) {
    closeDecoder();
    codec = "";
    description = null;
    waitKey = true;
  }
  noteLoss(event);
  if ((waitKey && !event.key) || !ensureDecoder() || !decoder) {
    renderVideoStats();
    return;
  }
  try {
    decoder.decode(
      new EncodedVideoChunk({
        type: event.key ? "key" : "delta",
        timestamp: event.timestampMs * 1000,
        data: event.data,
      }),
    );
    if (event.key) waitKey = false;
  } catch (error) {
    waitKey = true;
    decoderError = error instanceof Error ? error.message : String(error);
  }
  renderVideoStats();
}

function sameConfig(nextCodec: string, nextDesc: Uint8Array): boolean {
  if (!decoder || decoder.state !== "configured" || codec !== nextCodec || !description) return false;
  if (description.length !== nextDesc.length) return false;
  for (let i = 0; i < description.length; i++) if (description[i] !== nextDesc[i]) return false;
  return true;
}

function configure(event: Extract<AssembledVideo, { kind: "config" }>): void {
  if (event.fresh) {
    closeDecoder();
    codec = "";
    description = null;
    waitKey = true;
  }
  noteLoss(event);
  if (!event.fresh && !event.gap && !event.broken && sameConfig(event.codec, event.description)) {
    renderVideoStats();
    return;
  }
  codec = event.codec;
  description = new Uint8Array(event.description);
  waitKey = true;
  closeDecoder();
  ensureDecoder();
  renderVideoStats();
}

export function acceptVideoPacket(bytes: Uint8Array): void {
  const packet = decodeVideoPacket(bytes);
  if (!packet) return;
  const event = assembler.push(packet);
  if (!event) return;
  packets++;
  if (event.kind === "config") configure(event);
  else play(event);
}

export function resetVideoPlayback(): void {
  closeDecoder();
  assembler.reset();
  codec = "";
  description = null;
  waitKey = true;
  packets = 0;
  gaps = 0;
  frames = 0;
  decoderError = "";
  logged = false;
  const wait = el("dr-video-wait");
  if (wait) wait.hidden = false;
  const canvas = el<HTMLCanvasElement>("dr-video-out");
  const ctx = canvas?.getContext("2d");
  if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderVideoStats();
}

export function renderVideoStats(): void {
  const node = el("dr-video-stats");
  if (!node) return;
  const state = frames > 0 && !waitKey
    ? t("diode.video.stateLive")
    : packets > 0
      ? t("diode.video.stateWait")
      : t("diode.video.stateIdle");
  const line = t("diode.video.statsRx", { state, packets, gaps, frames });
  node.textContent = decoderError ? `${line} · ${decoderError}` : line;
}

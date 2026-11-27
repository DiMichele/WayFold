import { t } from "../shared/i18n.ts";
import {
  VIDEO_BITRATE,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  VideoAssembler,
  decodeVideoPacket,
  encodeConfigPacket,
  splitVideoChunk,
} from "../diode/video-wire.ts";
import type { LocalLink } from "./link.ts";

const CHAT = 1;
const FILE = 2;
const VIDEO = 3;
const CHUNK = 12_000;
const MAX_FILE = 2 * 1024 * 1024;
const PAY_KEY = "wf-net-pay";
const FPS_KEY = "wf-net-video-fps";

type Pay = "chat" | "file" | "video";

let link: LocalLink | null = null;
let wired = false;
const outgoing: Uint8Array[] = [];
const files = new Map<string, { total: number; got: number; parts: Uint8Array[] }>();

let active = false;
let facing: "user" | "environment" = "environment";
let stream: MediaStream | null = null;
let encoder: VideoEncoder | null = null;
let codec = "";
let description: Uint8Array | null = null;
let seq = 0;
let frameIndex = 0;
let needKey = true;
let timer = 0;
let startedAt = 0;
const assembler = new VideoAssembler();
let decoder: VideoDecoder | null = null;
const scratch = document.createElement("canvas");
scratch.width = VIDEO_WIDTH;
scratch.height = VIDEO_HEIGHT;

function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function videoFps(): number {
  const value = Number(el<HTMLSelectElement>("net-video-fps")?.value);
  return value >= 1 && value <= 8 ? value : VIDEO_FPS;
}

function pack(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + payload.length);
  out[0] = type;
  out.set(payload, 1);
  return out;
}

function emit(bytes: Uint8Array): void {
  if (link?.sendDesk(bytes)) return;
  if (outgoing.length < 32) outgoing.push(bytes);
}

function flush(): void {
  while (outgoing.length && link?.sendDesk(outgoing[0]!)) outgoing.shift();
}

function setPay(next: Pay): void {
  try {
    localStorage.setItem(PAY_KEY, next);
  } catch {
    /* ignore */
  }
  document.querySelectorAll<HTMLButtonElement>("[data-net-pay]").forEach((btn) => {
    const on = btn.dataset.netPay === next;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll<HTMLElement>("[data-net-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.netPanel !== next;
  });
}

function addLine(text: string, mine: boolean): void {
  const list = el("net-chat");
  const empty = el("net-chat-empty");
  if (!list) return;
  if (empty) empty.hidden = true;
  const item = document.createElement("li");
  if (mine) item.classList.add("is-mine");
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  item.append(time, document.createTextNode(text));
  list.append(item);
  list.scrollTop = list.scrollHeight;
}

function saveFile(name: string, bytes: Uint8Array): void {
  const list = el("net-files-in");
  if (!list) return;
  const item = document.createElement("li");
  item.className = "diode-item";
  const body = document.createElement("span");
  body.className = "diode-item-name";
  body.textContent = name;
  const linkBtn = document.createElement("a");
  linkBtn.className = "btn-outline diode-item-btn";
  linkBtn.textContent = t("diode.rx.save");
  const blob = new Blob([bytes.slice()]);
  linkBtn.href = URL.createObjectURL(blob);
  linkBtn.download = name;
  item.append(body, linkBtn);
  list.append(item);
}

function onFile(payload: Uint8Array): void {
  if (payload.length < 10) return;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const total = view.getUint32(0, true);
  const offset = view.getUint32(4, true);
  const nameLen = view.getUint16(8, true);
  if (nameLen < 1 || payload.length < 10 + nameLen || total > MAX_FILE || offset > total) return;
  const name = new TextDecoder().decode(payload.subarray(10, 10 + nameLen));
  const chunk = payload.subarray(10 + nameLen);
  if (offset + chunk.length > total) return;
  let entry = files.get(name);
  if (!entry || offset === 0) {
    entry = { total, got: 0, parts: [] };
    files.set(name, entry);
  }
  entry.parts.push(chunk);
  entry.got += chunk.length;
  if (entry.got < entry.total) return;
  const all = new Uint8Array(entry.total);
  let at = 0;
  for (const part of entry.parts) {
    all.set(part, at);
    at += part.length;
  }
  files.delete(name);
  saveFile(name, all);
}

function onVideoPacket(bytes: Uint8Array): void {
  const packet = decodeVideoPacket(bytes);
  if (!packet) return;
  const piece = assembler.push(packet);
  if (!piece) return;
  if (piece.kind === "config") {
    codec = piece.codec;
    description = piece.description;
    openDecoder();
    return;
  }
  if (!decoder || decoder.state !== "configured") return;
  if (piece.broken) return;
  try {
    const chunk = new EncodedVideoChunk({
      type: piece.key ? "key" : "delta",
      timestamp: piece.timestampMs * 1000,
      data: piece.data,
    });
    decoder.decode(chunk);
  } catch {
    /* wait for the next keyframe */
  }
}

function openDecoder(): void {
  if (typeof VideoDecoder === "undefined" || !codec || !description) return;
  try {
    decoder?.close();
  } catch {
    /* ignore */
  }
  decoder = new VideoDecoder({
    output: (frame) => {
      const canvas = el<HTMLCanvasElement>("net-video-out");
      const wait = el("net-video-wait");
      if (wait) wait.hidden = true;
      if (canvas) {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        canvas.getContext("2d")?.drawImage(frame, 0, 0);
      }
      frame.close();
    },
    error: () => {
      try {
        decoder?.close();
      } catch {
        /* ignore */
      }
      decoder = null;
    },
  });
  decoder.configure({ codec, description: description.slice(), optimizeForLatency: true });
}

function onDesk(msg: Uint8Array): void {
  if (!msg.length) return;
  const type = msg[0]!;
  const payload = msg.subarray(1);
  if (type === CHAT) addLine(new TextDecoder().decode(payload), false);
  else if (type === FILE) onFile(payload);
  else if (type === VIDEO) onVideoPacket(payload);
}

async function sendFile(file: File): Promise<void> {
  if (!link || file.size < 1 || file.size > MAX_FILE) return;
  if (link.role === "join") await link.ensureDesk();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = new TextEncoder().encode(file.name.slice(0, 120) || "file");
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK));
    const body = new Uint8Array(10 + name.length + chunk.length);
    const view = new DataView(body.buffer);
    view.setUint32(0, bytes.length, true);
    view.setUint32(4, offset, true);
    view.setUint16(8, name.length, true);
    body.set(name, 10);
    body.set(chunk, 10 + name.length);
    const packet = pack(FILE, body);
    for (let attempt = 0; attempt < 30 && !link.sendDesk(packet); attempt++) {
      if (link.role === "join") await link.ensureDesk();
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
  }
}

function drawFrame(video: HTMLVideoElement): boolean {
  if (!video.videoWidth || !video.videoHeight) return false;
  const ctx = scratch.getContext("2d");
  if (!ctx) return false;
  const scale = Math.max(VIDEO_WIDTH / video.videoWidth, VIDEO_HEIGHT / video.videoHeight);
  const sw = VIDEO_WIDTH / scale;
  const sh = VIDEO_HEIGHT / scale;
  ctx.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  return true;
}

function onEncoded(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
  if (!active) return;
  if (meta?.decoderConfig?.description) description = new Uint8Array(meta.decoderConfig.description as ArrayBuffer);
  if (meta?.decoderConfig?.codec) codec = meta.decoderConfig.codec;
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  const key = chunk.type === "key";
  if (key && description && codec) {
    const config = encodeConfigPacket({ streamId: 1, seq, codec, description, payloadMax: CHUNK });
    if (config) emit(pack(VIDEO, config));
    seq = (seq + 1) >>> 0;
  }
  for (const part of splitVideoChunk({
    streamId: 1,
    seq,
    timestampMs: Math.max(0, Math.round(chunk.timestamp / 1000)),
    key,
    data,
    payloadMax: CHUNK,
  })) {
    emit(pack(VIDEO, part));
  }
  seq = (seq + 1) >>> 0;
}

async function startVideo(): Promise<void> {
  if (active || typeof VideoEncoder === "undefined") return;
  const preview = el<HTMLVideoElement>("net-video-preview");
  if (!preview) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 } },
    });
  } catch {
    return;
  }
  preview.srcObject = stream;
  preview.hidden = false;
  void preview.play().catch(() => undefined);
  encoder = new VideoEncoder({ output: onEncoded, error: () => stopVideo() });
  const config: VideoEncoderConfig = {
    codec: "avc1.42001e",
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    bitrate: VIDEO_BITRATE,
    framerate: videoFps(),
    latencyMode: "realtime",
    avc: { format: "avc" },
  };
  const support = await VideoEncoder.isConfigSupported(config).catch(() => null);
  if (!support?.supported) {
    stopVideo();
    return;
  }
  encoder.configure(support.config ?? config);
  active = true;
  needKey = true;
  frameIndex = 0;
  startedAt = performance.now();
  renderVideoButtons();
  const tick = () => {
    timer = 0;
    if (!active || !encoder || encoder.state !== "configured") return;
    if (drawFrame(preview)) {
      const frame = new VideoFrame(scratch, { timestamp: Math.round((performance.now() - startedAt) * 1000) });
      const key = needKey || frameIndex % Math.max(2, videoFps() * 2) === 0;
      needKey = false;
      frameIndex++;
      try {
        encoder.encode(frame, { keyFrame: key });
      } catch {
        frame.close();
        stopVideo();
        return;
      }
      frame.close();
    }
    timer = window.setTimeout(tick, Math.round(1000 / videoFps()));
  };
  tick();
}

function stopVideo(): void {
  active = false;
  if (timer) window.clearTimeout(timer);
  timer = 0;
  try {
    encoder?.close();
  } catch {
    /* ignore */
  }
  encoder = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  const preview = el<HTMLVideoElement>("net-video-preview");
  if (preview) {
    preview.srcObject = null;
    preview.hidden = true;
  }
  renderVideoButtons();
}

function renderVideoButtons(): void {
  const start = el("net-video-start");
  const stop = el("net-video-stop");
  const flip = el("net-video-flip");
  if (start) start.hidden = active;
  if (stop) stop.hidden = !active;
  if (flip) flip.hidden = !active;
}

function wire(): void {
  if (wired) return;
  wired = true;
  const saved = (() => {
    try {
      return localStorage.getItem(PAY_KEY);
    } catch {
      return null;
    }
  })();
  setPay(saved === "file" || saved === "video" ? saved : "chat");
  document.querySelectorAll<HTMLButtonElement>("[data-net-pay]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.netPay;
      if (next === "chat" || next === "file" || next === "video") setPay(next);
    });
  });
  const fps = el<HTMLSelectElement>("net-video-fps");
  if (fps) {
    try {
      const stored = localStorage.getItem(FPS_KEY);
      if (stored && [...fps.options].some((option) => option.value === stored)) fps.value = stored;
    } catch {
      /* ignore */
    }
    fps.addEventListener("change", () => {
      try {
        localStorage.setItem(FPS_KEY, fps.value);
      } catch {
        /* ignore */
      }
      needKey = true;
    });
  }
  el<HTMLFormElement>("net-live-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = el<HTMLInputElement>("net-live-input");
    const text = input?.value.trim() ?? "";
    if (!text) return;
    if (input) input.value = "";
    addLine(text, true);
    emit(pack(CHAT, new TextEncoder().encode(text)));
  });
  const filesInput = el<HTMLInputElement>("net-desk-files");
  filesInput?.addEventListener("change", () => {
    const list = filesInput.files ? Array.from(filesInput.files) : [];
    filesInput.value = "";
    for (const file of list) void sendFile(file);
  });
  el("net-video-start")?.addEventListener("click", () => void startVideo());
  el("net-video-stop")?.addEventListener("click", stopVideo);
  el("net-video-flip")?.addEventListener("click", () => {
    facing = facing === "environment" ? "user" : "environment";
    if (!active) return;
    stopVideo();
    void startVideo();
  });
}

/** Keeps the desk stream open while the optical link is up. */
export function syncDesk(next: LocalLink | null, up: boolean): void {
  wire();
  if (next !== link) {
    link?.setDeskReceiver(null);
    link = next;
    outgoing.length = 0;
    files.clear();
  }
  link?.setDeskReceiver(onDesk);
  if (link) link.onDeskReady = flush;
  if (up && link?.role === "join") void link.ensureDesk();
  if (!up) stopVideo();
  flush();
}

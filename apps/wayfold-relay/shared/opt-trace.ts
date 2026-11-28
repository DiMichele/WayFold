/**
 * Optical-path performance ring. Active only when the `perf` flag is on.
 * Wall-clock samples use performance.timeOrigin + performance.now() so a
 * worker and the main thread stay comparable.
 */

import { getOptFlags, type ExposureIntent } from "./opt-flags.ts";
import type { TxPaintStats } from "./tx-paint.ts";

export type OptPhase =
  | "capture"
  | "extract"
  | "queue"
  | "wasm"
  | "parse"
  | "fountain"
  | "txWait"
  | "rxWait"
  | "aggregate";

export interface OptSample {
  phase: OptPhase;
  /** Absolute ms: timeOrigin + now. */
  t0: number;
  /** Duration ms. */
  dt: number;
  detail?: string;
}

export interface OptFps {
  configured: number;
  negotiated: number;
  observed: number;
  processed: number;
}

/** Bytes/s at three horizons. `instantBps` is a sliding window. `sessionBps` is since reset. `finalBps` is frozen when a file completes. */
export interface BpsView {
  instantBps: number;
  sessionBps: number;
  finalBps: number;
}

export interface OptQuality {
  sharpness: number;
  brightness: number;
  contrast: number;
  saturated: number;
}

/** Modem / ARQ figures. Null means the helper did not report that counter. */
export interface NetTelemetry {
  /** Application bytes/s, derived from mux totals over about a second. */
  appRxBps: number | null;
  appTxBps: number | null;
  /** Cumulative application bytes. Measured. */
  appRxBytes: number | null;
  appTxBytes: number | null;
  /** grid × fps × mtu. Theoretical. */
  capacityBps: number;
  /** Painted frames per second. Measured. */
  shownPerSec: number;
  /** Smoothed RTT. The ARQ sender does not keep the last raw sample. */
  srttMs: number | null;
  retransmits: number | null;
  duplicates: number | null;
  /** Unacked ARQ segments. */
  outstanding: number | null;
  streams: number | null;
  /** Cumulative ARQ payload acknowledged. Measured, framing included. */
  bytesAcked: number | null;
}

export interface OptGoodput {
  /** Unique optical symbols (new seq) bytes/s. Instant window. */
  opticalBps: number;
  /** Fountain solved bytes/s (solvedCount * blockLen growth). Instant window. */
  fountainBps: number;
  /** Original file bytes/s of the last completed file. */
  fileBps: number;
  uniqueQrPerSec: number;
  /** Every decoded payload, duplicates included. */
  decodedPerSec: number;
  optical: BpsView;
  fountain: BpsView;
  file: BpsView;
}

export interface OptSnapshot {
  flags: ReturnType<typeof getOptFlags>;
  fps: OptFps;
  goodput: OptGoodput;
  /** Last known sharpness (Laplacian variance), or null. */
  sharpness: number | null;
  /** Chrome-only JS heap used, MiB. */
  heapMiB: number | null;
  busyWorkers: number;
  workerCount: number;
  samples: OptSample[];
  windows: Array<{ t: number; fountainBps: number; opticalBps: number; heapMiB: number | null }>;
  arqRttMs: number | null;
  txWaitMs: number | null;
  rxWaitMs: number | null;
  jitterMs: number | null;
  /** Decode passes actually run, and passes skipped because the budget was spent. */
  passes: Record<string, { n: number; ms: number }>;
  skippedPasses: number;
  /**
   * Exposure experiment. `accepted` is only the resolved constraint.
   * `detected` is getSettings. `timeS` is seconds.
   */
  exposure: {
    intent: ExposureIntent;
    requestedTimeS: number | null;
    hardware: boolean;
    accepted: boolean;
    detected: boolean;
    fallback: boolean;
    mode: string | null;
    timeS: number | null;
    compensation: number | null;
    modes: string[];
  } | null;
  /** Pixel copies actually handed to workers. `fullFrames` counts generations that read the whole frame. */
  grabs: {
    frames: number;
    jobs: number;
    pixels: number;
    fullFrames: number;
    last: { jobs: number; pixels: number; full: boolean } | null;
  };
  /** Transmitter paint clock. Null on a receive page. */
  tx: TxPaintStats | null;
  quality: OptQuality | null;
  /** Shortest finder span in camera pixels, and modules when the decoder reported a version. */
  symbolPx: number | null;
  symbolModules: number | null;
  ppm: number | null;
  /** Present on the optical network. Fountain fields stay at zero there. */
  net: NetTelemetry | null;
  /**
   * The transfer progress bar is an ETA estimate. It is not one of the goodput fields.
   */
  progressBar: "estimate";
  /** Last color capture. Null on Mono and before the first color frame. */
  color: ColorTelemetry | null;
}

export interface ColorTelemetry {
  profile: string;
  grid: number;
  /** Frames whose quadrilateral was found. */
  located: number;
  /** Frames separated on this capture. */
  processed: number;
  channels: number;
  candidates: number;
  scheduled: number;
  dropped: number;
  decoded: number;
  perJob: number[];
  workersFree: number;
  workers: number;
  saturated: boolean;
  /** Why symbols of this frame were left out. `pool` means the capture was not started. */
  limit: "none" | "budget" | "slots" | "pool";
  poolSkips: number;
  locateMs: number;
  calMs: number;
  splitMs: number;
  decodeMs: number | null;
  residual: number | null;
  condition: number | null;
  quality: "ok" | "mono-like" | "none";
}

const RING = 512;
const WINDOW_MS = 10_000;

export function wallNow(): number {
  return performance.timeOrigin + performance.now();
}

class OptTrace {
  private readonly ring: OptSample[] = [];
  private write = 0;
  private size = 0;

  configuredFps = 0;
  negotiatedFps = 0;
  private lastPresented = 0;
  private lastMediaTime = 0;
  private observedSamples = 0;
  private observedDt = 0;
  private processedAt: number[] = [];

  private uniqueAt: number[] = [];
  private opticalBytes = 0;
  private fountainBytes = 0;
  private opticalWindow: { t: number; bytes: number }[] = [];
  private fountainWindow: { t: number; bytes: number }[] = [];
  private uniqueWindow: number[] = [];
  private decodedAt: number[] = [];
  private sessionStarted = 0;
  private opticalFinalBps = 0;
  private fountainFinalBps = 0;
  private fileFinalBps = 0;
  private fileSessionBytes = 0;
  private lastCaptureGen = -1;

  sharpness: number | null = null;
  private quality: OptQuality | null = null;
  private symbolPx: number | null = null;
  private symbolModules: number | null = null;
  private net: NetTelemetry | null = null;
  busyWorkers = 0;
  workerCount = 0;
  arqRttMs: number | null = null;
  txWaitMs: number | null = null;
  rxWaitMs: number | null = null;
  private symbolGaps: number[] = [];
  private lastSymbolAt = 0;

  private passCounts = new Map<string, { n: number; ms: number }>();
  private skippedPasses = 0;
  private exposure: OptSnapshot["exposure"] = null;
  private grabFrames = 0;
  private grabJobs = 0;
  private grabPixels = 0;
  private grabFull = 0;
  private lastGrab: { jobs: number; pixels: number; full: boolean } | null = null;
  private tx: TxPaintStats | null = null;
  private color: ColorTelemetry | null = null;
  private symbolMs = 12;
  private readonly windows: OptSnapshot["windows"] = [];
  private windowStarted = 0;
  private windowOptical = 0;
  private windowFountain = 0;

  enabled(): boolean {
    return getOptFlags().perf;
  }

  reset(): void {
    this.write = 0;
    this.size = 0;
    this.ring.length = 0;
    this.observedSamples = 0;
    this.observedDt = 0;
    this.lastPresented = 0;
    this.lastMediaTime = 0;
    this.configuredFps = 0;
    this.negotiatedFps = 0;
    this.arqRttMs = null;
    this.processedAt.length = 0;
    this.uniqueAt.length = 0;
    this.opticalBytes = 0;
    this.fountainBytes = 0;
    this.opticalWindow.length = 0;
    this.fountainWindow.length = 0;
    this.uniqueWindow.length = 0;
    this.decodedAt.length = 0;
    this.sessionStarted = wallNow();
    this.opticalFinalBps = 0;
    this.fountainFinalBps = 0;
    this.fileFinalBps = 0;
    this.fileSessionBytes = 0;
    this.lastCaptureGen = -1;
    this.quality = null;
    this.symbolPx = null;
    this.symbolModules = null;
    this.net = null;
    this.symbolGaps.length = 0;
    this.lastSymbolAt = 0;
    this.windows.length = 0;
    this.windowStarted = wallNow();
    this.windowOptical = 0;
    this.windowFountain = 0;
    this.sharpness = null;
    this.txWaitMs = null;
    this.rxWaitMs = null;
    this.passCounts.clear();
    this.skippedPasses = 0;
    this.exposure = null;
    this.grabFrames = 0;
    this.grabJobs = 0;
    this.grabPixels = 0;
    this.grabFull = 0;
    this.lastGrab = null;
    this.tx = null;
    this.color = null;
    this.symbolMs = 12;
  }

  colorSymbolMs(): number {
    return this.symbolMs;
  }

  noteColor(next: Omit<ColorTelemetry, "decoded" | "poolSkips" | "decodeMs">): void {
    const prev = this.color;
    this.color = {
      ...next,
      decoded: prev?.decoded ?? 0,
      poolSkips: prev?.poolSkips ?? 0,
      decodeMs: prev?.decodeMs ?? null,
    };
  }

  noteColorDecoded(count: number, jobMs: number | null): void {
    if (!this.color || count <= 0) return;
    this.color.decoded += count;
    if (jobMs != null && jobMs >= 0) {
      this.color.decodeMs = jobMs;
      this.symbolMs = jobMs / count;
    }
  }

  noteColorPoolSkip(workers: number, profile: string): void {
    if (!this.color) {
      this.color = {
        profile,
        grid: 0,
        located: 0,
        processed: 0,
        channels: 0,
        candidates: 0,
        scheduled: 0,
        dropped: 0,
        decoded: 0,
        perJob: [],
        workersFree: 0,
        workers,
        saturated: true,
        limit: "pool",
        poolSkips: 1,
        locateMs: 0,
        calMs: 0,
        splitMs: 0,
        decodeMs: null,
        residual: null,
        condition: null,
        quality: "none",
      };
      return;
    }
    this.color.poolSkips += 1;
    this.color.workers = workers;
    this.color.workersFree = 0;
    this.color.saturated = true;
    this.color.limit = "pool";
  }

  noteTx(stats: TxPaintStats): void {
    if (!this.enabled()) return;
    this.tx = stats;
  }

  noteExposure(next: NonNullable<OptSnapshot["exposure"]>): void {
    this.exposure = next;
  }

  /** Split a worker turn into queue wait and decode. Without `startedAt`, the whole turn stays one wasm sample. */
  noteWorkerTurn(postedAt?: number, startedAt?: number, doneAt?: number): void {
    if (!this.enabled()) return;
    if (typeof postedAt === "number" && typeof startedAt === "number") {
      this.mark("queue", postedAt, Math.max(0, startedAt - postedAt));
    }
    if (typeof startedAt === "number" && typeof doneAt === "number") {
      this.mark("wasm", startedAt, Math.max(0, doneAt - startedAt));
    } else if (typeof postedAt === "number" && typeof doneAt === "number") {
      this.mark("wasm", postedAt, Math.max(0, doneAt - postedAt));
    }
  }

  noteGrab(jobs: number, pixels: number, full: boolean): void {
    if (!this.enabled()) return;
    this.grabFrames += 1;
    this.grabJobs += jobs;
    this.grabPixels += pixels;
    if (full) this.grabFull += 1;
    this.lastGrab = { jobs, pixels, full };
  }

  mark(phase: OptPhase, t0: number, dt: number, detail?: string): void {
    if (!this.enabled()) return;
    const sample: OptSample = { phase, t0, dt, detail };
    if (this.ring.length < RING) {
      this.ring.push(sample);
      this.size = this.ring.length;
      this.write = this.size % RING;
      return;
    }
    this.ring[this.write] = sample;
    this.write = (this.write + 1) % RING;
    this.size = RING;
  }

  /** Call from requestVideoFrameCallback metadata when available. */
  noteVideoMeta(meta: { presentedFrames?: number; mediaTime?: number } | undefined): void {
    if (!this.enabled() || !meta) return;
    const frames = meta.presentedFrames;
    const media = meta.mediaTime;
    if (typeof frames === "number" && typeof media === "number" && this.lastPresented > 0) {
      const df = frames - this.lastPresented;
      const dt = media - this.lastMediaTime;
      if (df > 0 && dt > 0) {
        this.observedSamples += df;
        this.observedDt += dt;
      }
    }
    if (typeof frames === "number") this.lastPresented = frames;
    if (typeof media === "number") this.lastMediaTime = media;
  }

  /** Counts decoder passes without adding them to the wasm ring (that ring is the whole worker turn). */
  notePasses(passes: { pass: string; ms: number }[] | undefined, skipped = 0): void {
    if (!this.enabled()) return;
    for (const p of passes ?? []) {
      const cur = this.passCounts.get(p.pass) ?? { n: 0, ms: 0 };
      cur.n += 1;
      cur.ms += p.ms;
      this.passCounts.set(p.pass, cur);
    }
    this.skippedPasses += skipped;
  }

  noteProcessed(): void {
    if (!this.enabled()) return;
    const now = wallNow();
    this.processedAt.push(now);
    this.trim(this.processedAt, now - 2000);
  }

  /**
   * One camera callback, even when that frame is split across several workers.
   * A second call with the same generation does not move processed FPS.
   */
  noteCapture(gen: number): void {
    if (!this.enabled()) return;
    if (gen === this.lastCaptureGen) return;
    this.lastCaptureGen = gen;
    this.noteProcessed();
  }

  noteDecoded(count = 1): void {
    if (!this.enabled() || count <= 0) return;
    const now = wallNow();
    for (let i = 0; i < count; i++) this.decodedAt.push(now);
    this.trim(this.decodedAt, now - 2000);
  }

  setQuality(value: OptQuality): void {
    if (!this.enabled()) return;
    this.quality = value;
    this.sharpness = value.sharpness;
  }

  noteSymbol(px: number, modules: number | null): void {
    if (!this.enabled()) return;
    this.symbolPx = px;
    this.symbolModules = modules;
  }

  noteNet(value: NetTelemetry): void {
    if (!this.enabled()) return;
    this.net = value;
  }

  noteUniqueSymbol(bytes: number): void {
    if (!this.enabled()) return;
    const now = wallNow();
    this.uniqueAt.push(now);
    this.uniqueWindow.push(now);
    this.opticalBytes += bytes;
    this.opticalWindow.push({ t: now, bytes });
    this.windowOptical += bytes;
    if (this.lastSymbolAt > 0) {
      this.symbolGaps.push(now - this.lastSymbolAt);
      if (this.symbolGaps.length > 64) this.symbolGaps.shift();
    }
    this.lastSymbolAt = now;
    this.trim(this.uniqueAt, now - 2000);
    this.trimWindow(this.opticalWindow, now - 2000);
    this.trim(this.uniqueWindow, now - 2000);
    this.flushWindow(now);
  }

  noteFountainGrowth(bytes: number): void {
    if (!this.enabled() || bytes <= 0) return;
    const now = wallNow();
    this.fountainBytes += bytes;
    this.fountainWindow.push({ t: now, bytes });
    this.windowFountain += bytes;
    this.trimWindow(this.fountainWindow, now - 2000);
    this.flushWindow(now);
  }

  noteFileComplete(originalBytes: number, elapsedSec: number): void {
    if (!this.enabled()) return;
    const elapsed = Math.max(0.001, elapsedSec);
    this.fileSessionBytes += originalBytes;
    this.fileFinalBps = originalBytes / elapsed;
    this.opticalFinalBps = this.freeze(this.opticalBytes, elapsed);
    this.fountainFinalBps = this.freeze(this.fountainBytes, elapsed);
  }

  private sessionSeconds(): number {
    if (this.sessionStarted <= 0) return 0;
    return Math.max(0, (wallNow() - this.sessionStarted) / 1000);
  }

  private sessionRate(bytes: number): number {
    const dt = this.sessionSeconds();
    if (dt < 0.25 || bytes <= 0) return 0;
    return bytes / dt;
  }

  private freeze(bytes: number, elapsedSec: number): number {
    const session = this.sessionRate(bytes);
    if (session > 0) return session;
    return bytes / Math.max(0.001, elapsedSec);
  }

  setSharpness(value: number): void {
    if (!this.enabled()) return;
    this.sharpness = value;
  }

  setWorkers(busy: number, total: number): void {
    this.busyWorkers = busy;
    this.workerCount = total;
  }

  setArqRtt(ms: number | null): void {
    this.arqRttMs = ms;
  }

  noteTxWait(ms: number): void {
    if (!this.enabled()) return;
    this.txWaitMs = ms;
    this.mark("txWait", wallNow() - ms, ms);
  }

  noteRxWait(ms: number): void {
    if (!this.enabled()) return;
    this.rxWaitMs = ms;
    this.mark("rxWait", wallNow() - ms, ms);
  }

  private flushWindow(now: number): void {
    if (this.windowStarted <= 0) this.windowStarted = now;
    if (now - this.windowStarted < WINDOW_MS) return;
    const dt = Math.max(0.001, (now - this.windowStarted) / 1000);
    this.windows.push({
      t: now,
      fountainBps: this.windowFountain / dt,
      opticalBps: this.windowOptical / dt,
      heapMiB: this.heapMiB(),
    });
    if (this.windows.length > 36) this.windows.shift();
    this.windowStarted = now;
    this.windowOptical = 0;
    this.windowFountain = 0;
  }

  private heapMiB(): number | null {
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    if (!mem) return null;
    return mem.usedJSHeapSize / (1024 * 1024);
  }

  private trim(arr: number[], min: number): void {
    while (arr.length && arr[0]! < min) arr.shift();
  }

  private trimWindow(arr: { t: number; bytes: number }[], min: number): void {
    while (arr.length && arr[0]!.t < min) arr.shift();
  }

  private rateFrom(arr: { t: number; bytes: number }[]): number {
    if (arr.length < 2) return 0;
    const a = arr[0]!;
    const b = arr[arr.length - 1]!;
    const dt = Math.max(0.15, (b.t - a.t) / 1000);
    let sum = 0;
    for (const s of arr) sum += s.bytes;
    return sum / dt;
  }

  private countRate(arr: number[]): number {
    if (arr.length < 2) return arr.length > 0 ? arr.length : 0;
    const dt = Math.max(0.15, (arr[arr.length - 1]! - arr[0]!) / 1000);
    return arr.length / dt;
  }

  observedFps(): number {
    if (this.observedDt <= 0) return 0;
    return this.observedSamples / this.observedDt;
  }

  processedFps(): number {
    return this.countRate(this.processedAt);
  }

  jitterMs(): number | null {
    if (this.symbolGaps.length < 2) return null;
    const mean = this.symbolGaps.reduce((a, b) => a + b, 0) / this.symbolGaps.length;
    let varSum = 0;
    for (const g of this.symbolGaps) varSum += (g - mean) ** 2;
    return Math.sqrt(varSum / this.symbolGaps.length);
  }

  snapshot(): OptSnapshot {
    const samples: OptSample[] = [];
    if (this.size < RING) {
      samples.push(...this.ring);
    } else {
      for (let i = 0; i < RING; i++) {
        const s = this.ring[(this.write + i) % RING];
        if (s) samples.push(s);
      }
    }
    return {
      flags: getOptFlags(),
      fps: {
        configured: this.configuredFps,
        negotiated: this.negotiatedFps,
        observed: this.observedFps(),
        processed: this.processedFps(),
      },
      goodput: this.goodput(),
      sharpness: this.sharpness,
      heapMiB: this.heapMiB(),
      busyWorkers: this.busyWorkers,
      workerCount: this.workerCount,
      samples,
      windows: this.windows.slice(),
      arqRttMs: this.arqRttMs,
      txWaitMs: this.txWaitMs,
      rxWaitMs: this.rxWaitMs,
      jitterMs: this.jitterMs(),
      passes: Object.fromEntries(this.passCounts),
      skippedPasses: this.skippedPasses,
      exposure: this.exposure,
      grabs: {
        frames: this.grabFrames,
        jobs: this.grabJobs,
        pixels: this.grabPixels,
        fullFrames: this.grabFull,
        last: this.lastGrab,
      },
      tx: this.tx,
      quality: this.quality,
      symbolPx: this.symbolPx,
      symbolModules: this.symbolModules,
      ppm: this.symbolPx != null && this.symbolModules ? this.symbolPx / this.symbolModules : null,
      net: this.net,
      progressBar: "estimate",
      color: this.color,
    };
  }

  private goodput(): OptGoodput {
    const opticalInstant = this.rateFrom(this.opticalWindow);
    const fountainInstant = this.rateFrom(this.fountainWindow);
    const fileFinal = this.fileFinalBps;
    return {
      opticalBps: opticalInstant,
      fountainBps: fountainInstant,
      fileBps: fileFinal,
      uniqueQrPerSec: this.countRate(this.uniqueWindow),
      decodedPerSec: this.countRate(this.decodedAt),
      optical: {
        instantBps: opticalInstant,
        sessionBps: this.sessionRate(this.opticalBytes),
        finalBps: this.opticalFinalBps,
      },
      fountain: {
        instantBps: fountainInstant,
        sessionBps: this.sessionRate(this.fountainBytes),
        finalBps: this.fountainFinalBps,
      },
      file: {
        instantBps: 0,
        sessionBps: this.sessionRate(this.fileSessionBytes),
        finalBps: fileFinal,
      },
    };
  }

  toJson(): string {
    return JSON.stringify(this.snapshot(), null, 2);
  }
}

export const optTrace = new OptTrace();

/** Timed block helper for main-thread phases. */
export function timed<T>(phase: OptPhase, fn: () => T, detail?: string): T {
  if (!optTrace.enabled()) return fn();
  const t0 = wallNow();
  try {
    return fn();
  } finally {
    optTrace.mark(phase, t0, wallNow() - t0, detail);
  }
}

export async function timedAsync<T>(phase: OptPhase, fn: () => Promise<T>, detail?: string): Promise<T> {
  if (!optTrace.enabled()) return fn();
  const t0 = wallNow();
  try {
    return await fn();
  } finally {
    optTrace.mark(phase, t0, wallNow() - t0, detail);
  }
}

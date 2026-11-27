/**
 * Optical-path performance ring. Active only when the `perf` flag is on.
 * Wall-clock samples use performance.timeOrigin + performance.now() so a
 * worker and the main thread stay comparable.
 */

import { getOptFlags } from "./opt-flags.ts";

export type OptPhase =
  | "capture"
  | "extract"
  | "queue"
  | "wasm"
  | "parse"
  | "fountain"
  | "txWait"
  | "rxWait";

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

export interface OptGoodput {
  /** Unique optical symbols (new seq) bytes/s. */
  opticalBps: number;
  /** Fountain solved bytes/s (solvedCount * blockLen growth). */
  fountainBps: number;
  /** Original file bytes/s once verified end-to-end. */
  fileBps: number;
  uniqueQrPerSec: number;
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
  private fileBytes = 0;
  private fileElapsedSec = 0;
  private opticalWindow: { t: number; bytes: number }[] = [];
  private fountainWindow: { t: number; bytes: number }[] = [];
  private uniqueWindow: number[] = [];

  sharpness: number | null = null;
  busyWorkers = 0;
  workerCount = 0;
  arqRttMs: number | null = null;
  txWaitMs: number | null = null;
  rxWaitMs: number | null = null;
  private symbolGaps: number[] = [];
  private lastSymbolAt = 0;

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
    this.processedAt.length = 0;
    this.uniqueAt.length = 0;
    this.opticalBytes = 0;
    this.fountainBytes = 0;
    this.fileBytes = 0;
    this.fileElapsedSec = 0;
    this.opticalWindow.length = 0;
    this.fountainWindow.length = 0;
    this.uniqueWindow.length = 0;
    this.symbolGaps.length = 0;
    this.lastSymbolAt = 0;
    this.windows.length = 0;
    this.windowStarted = wallNow();
    this.windowOptical = 0;
    this.windowFountain = 0;
    this.sharpness = null;
    this.txWaitMs = null;
    this.rxWaitMs = null;
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

  noteProcessed(): void {
    if (!this.enabled()) return;
    const now = wallNow();
    this.processedAt.push(now);
    this.trim(this.processedAt, now - 2000);
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
    this.fileBytes = originalBytes;
    this.fileElapsedSec = Math.max(0.001, elapsedSec);
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
      goodput: {
        opticalBps: this.rateFrom(this.opticalWindow),
        fountainBps: this.rateFrom(this.fountainWindow),
        fileBps: this.fileElapsedSec > 0 ? this.fileBytes / this.fileElapsedSec : 0,
        uniqueQrPerSec: this.countRate(this.uniqueWindow),
      },
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

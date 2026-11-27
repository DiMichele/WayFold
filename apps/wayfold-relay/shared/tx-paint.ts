/**
 * Records how long each QR actually stays on screen. It does not choose when
 * to paint. A gap that lands on the next refresh is quantization, not a stall.
 */

export interface TxPaintStats {
  configuredFps: number;
  intervalMs: number;
  /** Median requestAnimationFrame rate. This is not the physical panel refresh. */
  rafHz: number | null;
  /** Physical panel refresh is not measured from requestAnimationFrame. */
  panelHz: null;
  /** True when the configured rate divides the observed rAF rate into whole frames. */
  integerDivisor: boolean | null;
  swaps: number;
  onTime: number;
  /** Symbol stayed up longer than its quantized rAF slot. A 2-or-3-frame hold is not late. */
  late: number;
  /** Scheduler dropped one or more intervals to catch up. */
  skipped: number;
  /** A swap was due and the symbol queue was empty, so the previous QR stayed. */
  starved: number;
  /** Observed rAF periods beyond the long side of quantization. Not panel refreshes. */
  extraRefreshes: number | null;
  medianGapMs: number | null;
  p95GapMs: number | null;
  maxGapMs: number | null;
}

/** True when fps splits the observed rAF rate into an integer number of frames. */
export function dividesRefresh(rafHz: number, fps: number): boolean {
  if (!(rafHz > 20) || !(fps > 0)) return false;
  const frames = rafHz / fps;
  const nearest = Math.round(frames);
  return nearest >= 1 && Math.abs(frames - nearest) < 0.04;
}

/**
 * How many observed rAF periods a symbol may occupy.
 * An integer divisor is one length. Otherwise the hold alternates between floor and ceil,
 * and only a hold past ceil is an extra frame.
 */
export function holdFrameBounds(rafHz: number, fps: number): { min: number; max: number } {
  const frames = rafHz / fps;
  const nearest = Math.round(frames);
  if (nearest >= 1 && Math.abs(frames - nearest) < 0.04) return { min: nearest, max: nearest };
  const min = Math.max(1, Math.floor(frames));
  const max = Math.max(min, Math.ceil(frames));
  return { min, max };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? null;
}

function p95(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? null;
}

export class TxPaintClock {
  private readonly fps: number;
  private readonly frames: number[] = [];
  private readonly gaps: number[] = [];
  private lastSwap = -1;
  private swaps = 0;
  private onTime = 0;
  private late = 0;
  private skipped = 0;
  private starved = 0;
  private extraRefreshes = 0;

  constructor(fps: number) {
    this.fps = fps;
  }

  noteFrame(now: number): void {
    this.frames.push(now);
    if (this.frames.length > 180) this.frames.shift();
  }

  /** Observed rAF rate. Not the panel's hardware refresh. */
  observedRafHz(): number | null {
    if (this.frames.length < 8) return null;
    const dts: number[] = [];
    for (let i = 1; i < this.frames.length; i++) {
      const d = this.frames[i]! - this.frames[i - 1]!;
      if (d > 2 && d < 80) dts.push(d);
    }
    if (dts.length < 6) return null;
    const med = median(dts);
    return med && med > 0 ? 1000 / med : null;
  }

  /** The paint was due and nothing new was ready. Ignored before the first symbol. */
  noteStarved(): void {
    if (this.lastSwap >= 0) this.starved += 1;
  }

  /**
   * A new symbol was drawn at `now`. `skipped` is how many configured intervals
   * the existing scheduler dropped on this tick. Pass the same count the tick computes.
   */
  noteSwap(now: number, skipped = 0): void {
    this.skipped += Math.max(0, skipped);
    if (this.lastSwap >= 0) {
      const gap = now - this.lastSwap;
      this.gaps.push(gap);
      if (this.gaps.length > 240) this.gaps.shift();
      const interval = 1000 / Math.max(1, this.fps);
      const raf = this.observedRafHz();
      const slack = raf && raf > 0 ? 1000 / raf : 8;
      let onSlot = false;
      if (raf && raf > 0) {
        const held = Math.round((gap * raf) / 1000);
        const bounds = holdFrameBounds(raf, this.fps);
        onSlot = held >= bounds.min && held <= bounds.max;
        this.extraRefreshes += Math.max(0, held - bounds.max);
      }
      if (onSlot || gap <= interval + slack) this.onTime += 1;
      else this.late += 1;
    }
    this.lastSwap = now;
    this.swaps += 1;
  }

  snapshot(): TxPaintStats {
    const raf = this.observedRafHz();
    return {
      configuredFps: this.fps,
      intervalMs: 1000 / Math.max(1, this.fps),
      rafHz: raf == null ? null : +raf.toFixed(2),
      panelHz: null,
      integerDivisor: raf == null ? null : dividesRefresh(raf, this.fps),
      swaps: this.swaps,
      onTime: this.onTime,
      late: this.late,
      skipped: this.skipped,
      starved: this.starved,
      extraRefreshes: raf == null ? null : this.extraRefreshes,
      medianGapMs: median(this.gaps) == null ? null : +median(this.gaps)!.toFixed(2),
      p95GapMs: p95(this.gaps) == null ? null : +p95(this.gaps)!.toFixed(2),
      maxGapMs: this.gaps.length ? +Math.max(...this.gaps).toFixed(2) : null,
    };
  }
}

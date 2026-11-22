// Systematic fountain carousel for a one-way optical channel.
//
// Each cycle sends the K source blocks in order, then K repair frames (XOR of
// a deterministic mid-degree subset). A receiver that catches a whole sweep
// finishes in exactly K frames. Dropped frames cost time, never correctness:
// later repair frames, and the next cycle, fill the holes. No back-channel.
// Repair subsets use only integer arithmetic, so V8 and JavaScriptCore stay
// in lockstep. The header bytes are unchanged.

import { splitmix32 } from "./protocol.ts";

function frameSeed(sessionId: number, seq: number): number {
  let h = (Math.imul(sessionId + 1, 0x9e3779b1) ^ (seq + 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

/** Frames per carousel cycle: one systematic sweep, then k repair frames. */
export function cycleLength(k: number): number {
  return 2 * Math.max(1, k);
}

const REPAIR_DEGREE_MIN = 4;
const REPAIR_DEGREE_MAX = 24;

/** Mid-degree repair. After a sweep, degree-1 frames would only repeat blocks. */
function repairIndices(k: number, sessionId: number, seq: number): number[] {
  const rnd = splitmix32(frameSeed(sessionId, seq));
  const span = REPAIR_DEGREE_MAX - REPAIR_DEGREE_MIN + 1;
  const d = Math.min(k, REPAIR_DEGREE_MIN + (rnd() % span));
  const set = new Set<number>();
  while (set.size < d) set.add(rnd() % k);
  return [...set];
}

/**
 * Block subset for frame `seq`. The first half of each cycle is block
 * `seq % cycle` alone; the second half is a repair subset. Repair seeds use
 * the absolute seq, so the next cycle does not replay the same repairs.
 */
export function frameComposition(k: number, sessionId: number, seq: number): number[] {
  const pos = seq % cycleLength(k);
  return pos < k ? [pos] : repairIndices(k, sessionId, seq);
}

function xorInto(dst: Uint32Array, src: Uint32Array): void {
  for (let i = 0; i < dst.length; i++) dst[i] = (dst[i]! ^ src[i]!) >>> 0;
}

export class LTEncoder {
  readonly k: number;
  readonly blockLen: number;
  readonly sessionId: number;
  private readonly words: number;
  private readonly blocks: Uint32Array;

  constructor(
    payload: Uint8Array,
    blockLen: number,
    sessionId: number,
  ) {
    this.blockLen = blockLen;
    this.sessionId = sessionId;
    this.k = Math.max(1, Math.ceil(payload.length / blockLen));
    this.words = Math.ceil(blockLen / 4);
    this.blocks = new Uint32Array(this.k * this.words);
    const bytes = new Uint8Array(this.blocks.buffer);
    for (let b = 0; b < this.k; b++) {
      const src = payload.subarray(b * blockLen, Math.min((b + 1) * blockLen, payload.length));
      bytes.set(src, b * this.words * 4);
    }
  }

  encode(seq: number): Uint8Array {
    const idx = frameComposition(this.k, this.sessionId, seq);
    const out = new Uint32Array(this.words);
    for (const b of idx) {
      const off = b * this.words;
      for (let w = 0; w < this.words; w++) out[w] = (out[w]! ^ this.blocks[off + w]!) >>> 0;
    }
    return new Uint8Array(out.buffer, 0, this.blockLen);
  }
}

interface PendingFrame {
  idx: Set<number>;
  words: Uint32Array;
}

export class LTDecoder {
  readonly k: number;
  readonly blockLen: number;
  readonly sessionId: number;
  readonly totalLen: number;
  private readonly words: number;
  private readonly solved: (Uint32Array | null)[];
  private readonly byBlock = new Map<number, Set<PendingFrame>>();
  private readonly pending = new Set<PendingFrame>();
  private readonly maxPendingFrames: number;
  private readonly maxUniqueFrames: number;
  private readonly seen = new Set<number>();
  solvedCount = 0;
  framesNew = 0;
  framesDup = 0;

  constructor(
    k: number,
    blockLen: number,
    sessionId: number,
    totalLen: number,
  ) {
    this.k = k;
    this.blockLen = blockLen;
    this.sessionId = sessionId;
    this.totalLen = totalLen;
    this.words = Math.ceil(blockLen / 4);
    this.solved = new Array<Uint32Array | null>(k).fill(null);
    this.maxPendingFrames = Math.min(60_000, Math.max(64, Math.ceil(k * 1.5)));
    this.maxUniqueFrames = Math.min(200_000, Math.max(1024, k * 4));
  }

  get isComplete(): boolean {
    return this.solvedCount >= this.k;
  }

  get pendingFrameCount(): number {
    return this.pending.size;
  }

  addFrame(seq: number, block: Uint8Array): void {
    if (this.seen.has(seq)) {
      this.framesDup++;
      return;
    }
    if (this.seen.size >= this.maxUniqueFrames) return;
    this.seen.add(seq);
    this.framesNew++;
    if (this.isComplete) return;

    const idx = new Set(frameComposition(this.k, this.sessionId, seq));
    const words = new Uint32Array(this.words);
    new Uint8Array(words.buffer).set(block.subarray(0, this.blockLen));
    for (const b of [...idx]) {
      const s = this.solved[b];
      if (s) {
        xorInto(words, s);
        idx.delete(b);
      }
    }
    if (idx.size === 0) return; // fully redundant
    if (idx.size === 1) {
      this.resolve(idx.values().next().value!, words);
      return;
    }
    // Bound memory use when scanning arbitrary/adversarial QR streams.
    // Fountain frames are disposable; dropping one only costs transfer time.
    if (this.pending.size >= this.maxPendingFrames) return;
    const pf: PendingFrame = { idx, words };
    this.pending.add(pf);
    for (const b of idx) {
      let set = this.byBlock.get(b);
      if (!set) {
        set = new Set();
        this.byBlock.set(b, set);
      }
      set.add(pf);
    }
  }

  /** Peeling cascade: solve a block, reduce every frame waiting on it, repeat.
   * Systematic frames solve on arrival. Repair frames can still cascade. */
  private resolve(b0: number, w0: Uint32Array): void {
    const queue: [number, Uint32Array][] = [[b0, w0]];
    while (queue.length > 0) {
      const [b, w] = queue.pop()!;
      if (this.solved[b]) continue;
      this.solved[b] = w;
      this.solvedCount++;
      const waiting = this.byBlock.get(b);
      if (!waiting) continue;
      this.byBlock.delete(b);
      for (const pf of waiting) {
        xorInto(pf.words, w);
        pf.idx.delete(b);
        if (pf.idx.size === 1) {
          const r = pf.idx.values().next().value!;
          this.byBlock.get(r)?.delete(pf);
          this.pending.delete(pf);
          if (!this.solved[r]) queue.push([r, pf.words]);
        }
      }
    }
  }

  assemble(): Uint8Array | null {
    if (!this.isComplete) return null;
    const out = new Uint8Array(this.totalLen);
    for (let b = 0; b < this.k; b++) {
      const start = b * this.blockLen;
      const len = Math.min(this.blockLen, this.totalLen - start);
      if (len > 0) out.set(new Uint8Array(this.solved[b]!.buffer, 0, len), start);
    }
    return out;
  }
}

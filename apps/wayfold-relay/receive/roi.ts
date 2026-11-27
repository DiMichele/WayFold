/** Adaptive QR ROI tracker. Pure geometry — no camera / ZXing dependency. */

import type { Point, Quad, Rect } from "./decode-core.ts";

export interface RoiBox {
  rect: Rect;
  /** Margin as a fraction of the longer side of the raw quad AABB. */
  margin: number;
  misses: number;
}

export interface RoiState {
  boxes: RoiBox[];
  /** Confirmed simultaneous code count; 0 until a full-frame establishes it. */
  expected: number;
  framesSinceFull: number;
  lastFrameId: number;
}

const MARGIN_MIN = 0.08;
const MARGIN_MAX = 0.35;
const MARGIN_START = 0.18;
const PX_MIN = 16;
const PX_MAX = 96;
const PX_START = 32;
const FULL_EVERY = 15;
const MISS_RESET = 2;

export function createRoiState(): RoiState {
  return { boxes: [], expected: 0, framesSinceFull: 0, lastFrameId: -1 };
}

export function quadAabb(q: Quad): Rect {
  const xs = [q.topLeft.x, q.topRight.x, q.bottomRight.x, q.bottomLeft.x];
  const ys = [q.topLeft.y, q.topRight.y, q.bottomRight.y, q.bottomLeft.y];
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function expandRect(raw: Rect, margin: number, frameW: number, frameH: number): Rect {
  const side = Math.max(raw.w, raw.h);
  const pad = Math.min(PX_MAX, Math.max(PX_START * (margin / MARGIN_START), side * margin, PX_MIN));
  const x = Math.max(0, Math.floor(raw.x - pad));
  const y = Math.max(0, Math.floor(raw.y - pad));
  const x1 = Math.min(frameW, Math.ceil(raw.x + raw.w + pad));
  const y1 = Math.min(frameH, Math.ceil(raw.y + raw.h + pad));
  return { x, y, w: Math.max(1, x1 - x), h: Math.max(1, y1 - y) };
}

function center(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function adaptMargin(box: RoiBox, raw: Rect, expanded: Rect, frameW: number, frameH: number): number {
  const touches =
    expanded.x <= 1 ||
    expanded.y <= 1 ||
    expanded.x + expanded.w >= frameW - 1 ||
    expanded.y + expanded.h >= frameH - 1;
  const room = expanded.w > raw.w * 1.35 && expanded.h > raw.h * 1.35;
  let m = box.margin;
  if (touches) m = Math.min(MARGIN_MAX, m + 0.04);
  else if (room) m = Math.max(MARGIN_MIN, m - 0.02);
  return m;
}

/**
 * Apply worker hits. Ignores results older than the last applied frameId.
 * Returns whether the next capture should be full-frame.
 */
export function roiUpdate(
  state: RoiState,
  frameId: number,
  frameW: number,
  frameH: number,
  quads: (Quad | null)[],
  wasFullFrame: boolean,
): { fullNext: boolean; rects: Rect[] } {
  if (frameId < state.lastFrameId) {
    return { fullNext: state.boxes.length === 0, rects: state.boxes.map((b) => b.rect) };
  }
  state.lastFrameId = frameId;

  const raws = quads.filter((q): q is Quad => !!q).map(quadAabb);
  if (wasFullFrame) {
    state.framesSinceFull = 0;
    if (raws.length > 0) {
      const layoutChanged =
        state.expected > 0 &&
        (raws.length !== state.expected ||
          !raws.every((raw) => state.boxes.some((b) => overlaps(b.rect, raw))));
      if (layoutChanged) {
        state.boxes = [];
        state.expected = 0;
      }
      state.expected = raws.length;
      state.boxes = raws.map((raw, i) => {
        const prev = state.boxes[i];
        const margin = prev?.margin ?? MARGIN_START;
        const rect = expandRect(raw, margin, frameW, frameH);
        const nextMargin = adaptMargin(
          { rect, margin, misses: 0 },
          raw,
          rect,
          frameW,
          frameH,
        );
        return { rect: expandRect(raw, nextMargin, frameW, frameH), margin: nextMargin, misses: 0 };
      });
    }
  } else if (raws.length > 0) {
    // Match each hit to the nearest existing box and refresh it.
    for (const raw of raws) {
      const c = center(raw);
      let best = -1;
      let bestDist = Infinity;
      for (let i = 0; i < state.boxes.length; i++) {
        const b = state.boxes[i]!;
        const bc = center(b.rect);
        const d = (c.x - bc.x) ** 2 + (c.y - bc.y) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      if (best < 0) continue;
      const box = state.boxes[best]!;
      const margin = adaptMargin(box, raw, box.rect, frameW, frameH);
      state.boxes[best] = {
        rect: expandRect(raw, margin, frameW, frameH),
        margin,
        misses: 0,
      };
    }
    // Missed boxes
    for (const box of state.boxes) {
      if (!raws.some((raw) => overlaps(box.rect, raw))) box.misses++;
    }
    state.boxes = state.boxes.filter((b) => b.misses < MISS_RESET);
    state.framesSinceFull++;
  } else {
    for (const box of state.boxes) box.misses++;
    state.boxes = state.boxes.filter((b) => b.misses < MISS_RESET);
    state.framesSinceFull++;
    if (state.boxes.length === 0) state.expected = 0;
  }

  const needFull =
    state.boxes.length === 0 ||
    state.framesSinceFull >= FULL_EVERY ||
    state.expected === 0;
  return { fullNext: needFull, rects: state.boxes.map((b) => b.rect) };
}

export function offsetRects(rects: Rect[], ox: number, oy: number): Rect[] {
  return rects.map((r) => ({ x: r.x + ox, y: r.y + oy, w: r.w, h: r.h }));
}

export function unionRect(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: Math.max(1, x1 - x), h: Math.max(1, y1 - y) };
}

export function clampRect(rect: Rect, frameW: number, frameH: number): Rect {
  const x = Math.max(0, Math.min(frameW - 1, Math.floor(rect.x)));
  const y = Math.max(0, Math.min(frameH - 1, Math.floor(rect.y)));
  return {
    x,
    y,
    w: Math.max(1, Math.min(frameW - x, Math.floor(rect.w))),
    h: Math.max(1, Math.min(frameH - y, Math.floor(rect.h))),
  };
}

export interface GrabJob {
  rect: Rect;
  /** True when the job is the whole camera frame. */
  full: boolean;
  /** Layout boxes covered by this job, in camera coordinates. */
  boxes: Rect[];
}

/** Split boxes into contiguous row-major bands, one band per free worker. */
export function partitionRects(rects: Rect[], groups: number): Rect[][] {
  const n = Math.max(1, Math.min(groups, rects.length));
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const base = Math.floor(sorted.length / n);
  const extra = sorted.length % n;
  const out: Rect[][] = [];
  let i = 0;
  for (let g = 0; g < n; g++) {
    const count = base + (g < extra ? 1 : 0);
    out.push(sorted.slice(i, i + count));
    i += count;
  }
  return out;
}

/**
 * What to read from the camera. One crop per code when a worker is free for each.
 * Fewer workers than codes: one compact union per free worker, never an idle slot
 * and never the full frame, once a layout exists.
 */
export function planGrabs(
  roi: boolean,
  fullNext: boolean,
  boxes: Rect[],
  frameW: number,
  frameH: number,
  freeSlots: number,
): GrabJob[] {
  const fullRect = { x: 0, y: 0, w: frameW, h: frameH };
  if (!roi || boxes.length === 0 || freeSlots < 1) return [{ rect: fullRect, full: true, boxes: [] }];
  const clamped = boxes.map((b) => clampRect(b, frameW, frameH));
  if (fullNext) return [{ rect: fullRect, full: true, boxes: clamped }];
  if (freeSlots >= clamped.length) return clamped.map((rect) => ({ rect, full: false, boxes: [rect] }));
  return partitionRects(clamped, freeSlots).map((group) => ({
    rect: group.length === 1 ? group[0]! : clampRect(unionRect(group), frameW, frameH),
    full: false,
    boxes: group,
  }));
}

/** ROI rectangles in the buffer about to be sent. One tight crop needs none. */
export function jobLocalRects(job: GrabJob): Rect[] | null {
  if (job.boxes.length === 0) return null;
  if (job.boxes.length === 1 && !job.full) return null;
  if (job.full) return job.boxes;
  return job.boxes.map((r) => ({ x: r.x - job.rect.x, y: r.y - job.rect.y, w: r.w, h: r.h }));
}

/** Expanded boxes for a set of finder quads. Used by the synthetic bench. */
export function boxesFromQuads(quads: Quad[], frameW: number, frameH: number): Rect[] {
  return quads.map((q) => expandRect(quadAabb(q), MARGIN_START, frameW, frameH));
}

interface GrabBatch {
  left: number;
  quads: (Quad | null)[];
  full: boolean;
  w: number;
  h: number;
}

/** ROI state plus in-flight crops that share one camera-frame id. */
export class RoiSession {
  state: RoiState = createRoiState();
  fullNext = true;
  private readonly batches = new Map<number, GrabBatch>();

  reset(): void {
    this.state = createRoiState();
    this.fullNext = true;
    this.batches.clear();
  }

  jobs(frameW: number, frameH: number, freeSlots: number, roiOn: boolean): GrabJob[] {
    return planGrabs(
      roiOn,
      this.fullNext,
      this.state.boxes.map((b) => b.rect),
      frameW,
      frameH,
      freeSlots,
    );
  }

  begin(gen: number, count: number, full: boolean, w: number, h: number): void {
    this.batches.set(gen, { left: count, quads: [], full, w, h });
  }

  /** Shift crop-space quads into the camera frame. Applies the layout when the batch completes. */
  push(gen: number, quads: (Quad | null)[] | undefined, originX: number, originY: number): void {
    const batch = this.batches.get(gen);
    if (!batch) return;
    for (const q of quads ?? []) {
      batch.quads.push(
        q
          ? {
              topLeft: { x: q.topLeft.x + originX, y: q.topLeft.y + originY },
              topRight: { x: q.topRight.x + originX, y: q.topRight.y + originY },
              bottomRight: { x: q.bottomRight.x + originX, y: q.bottomRight.y + originY },
              bottomLeft: { x: q.bottomLeft.x + originX, y: q.bottomLeft.y + originY },
            }
          : null,
      );
    }
    batch.left--;
    if (batch.left > 0) return;
    this.batches.delete(gen);
    if (gen < this.state.lastFrameId) return;
    const next = roiUpdate(this.state, gen, batch.w, batch.h, batch.quads, batch.full);
    if (gen === this.state.lastFrameId) this.fullNext = next.fullNext;
  }
}

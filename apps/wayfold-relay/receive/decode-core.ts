// QR decode passes, independent of the worker so Node can run them.
// `legacyDecode` is the original cascade; `plannedDecode` adds the optional
// fast profile, selective ROI retries and a per-frame time budget.

import { centerTileRects, cropRgbaCenter, cropRgbaRect, gridSliceRects } from "./image-crop.ts";

export interface Point {
  x: number;
  y: number;
}

export interface Quad {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pixmap {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface ReadOpts {
  formats: ["QRCode"];
  maxNumberOfSymbols: number;
  tryHarder?: boolean;
  tryRotate?: boolean;
  tryInvert?: boolean;
  tryDownscale?: boolean;
}

export interface Hit {
  isValid: boolean;
  bytes: Uint8Array;
  position?: Quad;
}

/** zxing-wasm `readBarcodes`: a pixmap/ImageData is RGBA; bytes are an encoded image (PGM here). */
export type ReadFn = (input: Pixmap | ImageData | Uint8Array, opts: ReadOpts) => Promise<Hit[]>;

export const READ_OPTS: ReadOpts = {
  formats: ["QRCode"],
  maxNumberOfSymbols: 4,
  tryHarder: true,
  tryRotate: true,
};

/** Extra passes skip rotation and invert. The full frame already tried those. */
export const TILE_OPTS: ReadOpts = {
  formats: ["QRCode"],
  maxNumberOfSymbols: 4,
  tryHarder: true,
  tryRotate: false,
  tryInvert: false,
  tryDownscale: false,
};

export const FAST_OPTS: ReadOpts = {
  formats: ["QRCode"],
  maxNumberOfSymbols: 4,
  tryHarder: false,
  tryRotate: false,
  tryInvert: false,
  tryDownscale: false,
};

/** A cropped region can still be large, so it keeps downscaling. */
export const ROI_HARD_OPTS: ReadOpts = {
  formats: ["QRCode"],
  maxNumberOfSymbols: 4,
  tryHarder: true,
  tryRotate: false,
  tryInvert: false,
  tryDownscale: true,
};

// --- original cascade ------------------------------------------------------

function toImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  const copy = new Uint8ClampedArray(data.length);
  copy.set(data);
  return new ImageData(copy, width, height);
}

async function decodeQr(read: ReadFn, img: ImageData, opts: ReadOpts = READ_OPTS): Promise<Uint8Array[]> {
  const results = await read(img, opts);
  const out: Uint8Array[] = [];
  for (const hit of results) {
    if (hit.isValid && hit.bytes.length > 0) out.push(new Uint8Array(hit.bytes));
  }
  return out;
}

function remember(symbols: Uint8Array[], seen: Set<number>, bytes: Uint8Array): void {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(bytes.length / 24));
  for (let i = 0; i < bytes.length; i += step) hash = Math.imul(hash ^ bytes[i]!, 16777619);
  hash = Math.imul(hash ^ bytes.length, 16777619) >>> 0;
  if (seen.has(hash)) return;
  seen.add(hash);
  symbols.push(bytes);
}

/** One code per slice, when the full frame returns nothing. Stops at four symbols. */
async function decodeRects(
  read: ReadFn,
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  rects: Rect[],
  opts: ReadOpts,
): Promise<Uint8Array[]> {
  const symbols: Uint8Array[] = [];
  const seen = new Set<number>();
  for (const rect of rects) {
    if (rect.w < 48 || rect.h < 48) continue;
    const crop = cropRgbaRect(pixels, w, h, rect.x, rect.y, rect.w, rect.h);
    const hits = await decodeQr(read, toImageData(crop.data, crop.width, crop.height), opts);
    for (const hit of hits) remember(symbols, seen, hit);
    if (symbols.length >= 4) break;
  }
  return symbols;
}

export async function legacyDecode(read: ReadFn, pixels: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array[]> {
  let symbols = await decodeQr(read, toImageData(pixels, w, h));
  if (symbols.length === 0 && w >= 80 && h >= 80) {
    const wide = cropRgbaCenter(pixels, w, h, 0.8);
    symbols = await decodeQr(read, toImageData(wide.data, wide.width, wide.height));
  }
  if (symbols.length === 0 && w >= 96 && h >= 96) {
    symbols = await decodeRects(read, pixels, w, h, centerTileRects(w, h), TILE_OPTS);
  }
  if (symbols.length === 0 && w >= 80 && h >= 80) {
    const crop = cropRgbaCenter(pixels, w, h, 0.58);
    symbols = await decodeQr(read, toImageData(crop.data, crop.width, crop.height));
  }
  if (symbols.length === 0 && w >= 96 && h >= 96) {
    symbols = await decodeRects(read, pixels, w, h, gridSliceRects(w, h), TILE_OPTS);
  }
  return symbols;
}

// --- planned decode --------------------------------------------------------

export type PassKind = "fast" | "hard" | "roi-fast" | "roi-hard" | "crop";

export interface PassLog {
  pass: PassKind;
  ms: number;
  found: number;
  px: number;
}

/** Milliseconds per megapixel, per pass kind. Kept per worker across frames. */
export class PassCosts {
  private readonly ema = new Map<PassKind, number>();

  estimate(kind: PassKind, px: number): number {
    const perMpx = this.ema.get(kind);
    return perMpx === undefined ? 0 : (perMpx * px) / 1e6;
  }

  record(kind: PassKind, ms: number, px: number): void {
    if (px <= 0) return;
    const sample = (ms * 1e6) / px;
    const prev = this.ema.get(kind);
    this.ema.set(kind, prev === undefined ? sample : prev * 0.8 + sample * 0.2);
  }
}

export interface PlanInput {
  pixels: Uint8ClampedArray;
  w: number;
  h: number;
  /** Fast profile first, the hard pass only when it is needed. */
  fast: boolean;
  /** Pass pixel views to zxing instead of cloning them into a new ImageData. */
  mem: boolean;
  /** Convert once to 8-bit luminance and hand zxing a PGM image. */
  gray: boolean;
  /** Codes in the last confirmed layout; 0 when unknown. */
  expected: number;
  /** Code boxes of that layout, in this buffer's coordinates. */
  rects: Rect[] | null;
  /** Infinity means no budget. */
  budgetMs: number;
  startedAt: number;
  now: () => number;
  costs: PassCosts;
  /** Overrides FAST_OPTS, for benchmarks. */
  fastOpts?: ReadOpts;
}

export interface PlanOutput {
  symbols: Uint8Array[];
  quads: (Quad | null)[];
  passes: PassLog[];
  /** Passes not started because the budget would have run out. */
  skipped: number;
}

function fnv(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  return (Math.imul(h ^ bytes.length, 0x01000193) >>> 0);
}

/** Rec. 601 luma, the same weights zxing applies to RGBA. */
export function rgbaToLuma(src: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (src[p]! * 306 + src[p + 1]! * 601 + src[p + 2]! * 117 + 512) >> 10;
  }
  return out;
}

/** Binary PGM (P5): zxing-wasm decodes it as an 8-bit grayscale image. */
export function lumaToPgm(lum: Uint8Array, w: number, h: number, rect?: Rect): Uint8Array {
  const rx = rect ? Math.max(0, Math.floor(rect.x)) : 0;
  const ry = rect ? Math.max(0, Math.floor(rect.y)) : 0;
  const rw = rect ? Math.max(1, Math.min(w - rx, Math.floor(rect.w))) : w;
  const rh = rect ? Math.max(1, Math.min(h - ry, Math.floor(rect.h))) : h;
  const head = new TextEncoder().encode(`P5\n${rw} ${rh}\n255\n`);
  const out = new Uint8Array(head.length + rw * rh);
  out.set(head);
  if (!rect && rw === w) out.set(lum, head.length);
  else for (let y = 0; y < rh; y++) out.set(lum.subarray((ry + y) * w + rx, (ry + y) * w + rx + rw), head.length + y * rw);
  return out;
}

function clampRect(r: Rect, w: number, h: number): Rect {
  const x = Math.max(0, Math.min(w - 1, Math.floor(r.x)));
  const y = Math.max(0, Math.min(h - 1, Math.floor(r.y)));
  return { x, y, w: Math.max(1, Math.min(w - x, Math.floor(r.w))), h: Math.max(1, Math.min(h - y, Math.floor(r.h))) };
}

function centerOf(q: Quad): Point {
  return {
    x: (q.topLeft.x + q.topRight.x + q.bottomRight.x + q.bottomLeft.x) / 4,
    y: (q.topLeft.y + q.topRight.y + q.bottomRight.y + q.bottomLeft.y) / 4,
  };
}

function inside(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
}

function shiftQuad(q: Quad, dx: number, dy: number): Quad {
  const s = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  return { topLeft: s(q.topLeft), topRight: s(q.topRight), bottomRight: s(q.bottomRight), bottomLeft: s(q.bottomLeft) };
}

export async function plannedDecode(read: ReadFn, input: PlanInput): Promise<PlanOutput> {
  const { pixels, w, h, mem, gray, costs, now } = input;
  const out: PlanOutput = { symbols: [], quads: [], passes: [], skipped: 0 };
  const seen = new Set<number>();
  const lum = gray ? rgbaToLuma(pixels, w, h) : null;

  const image = (rect: Rect | null): Pixmap | Uint8Array => {
    if (lum) return lumaToPgm(lum, w, h, rect ?? undefined);
    if (!rect) return mem ? { data: pixels, width: w, height: h } : toImageData(pixels, w, h);
    const crop = cropRgbaRect(pixels, w, h, rect.x, rect.y, rect.w, rect.h);
    return mem ? crop : toImageData(crop.data, crop.width, crop.height);
  };

  /** A started WASM call cannot be stopped, so the budget is checked before each pass. */
  const run = async (kind: PassKind, rect: Rect | null, opts: ReadOpts): Promise<number> => {
    const r = rect ? clampRect(rect, w, h) : null;
    const px = r ? r.w * r.h : w * h;
    if (Number.isFinite(input.budgetMs)) {
      const left = input.budgetMs - (now() - input.startedAt);
      if (left <= 0 || costs.estimate(kind, px) > left) {
        out.skipped++;
        return 0;
      }
    }
    const t0 = now();
    const hits = await read(image(r), opts);
    const ms = now() - t0;
    costs.record(kind, ms, px);
    let found = 0;
    for (const hit of hits) {
      if (!hit.isValid || hit.bytes.length === 0) continue;
      const key = fnv(hit.bytes);
      if (seen.has(key)) continue;
      seen.add(key);
      out.symbols.push(new Uint8Array(hit.bytes));
      out.quads.push(hit.position ? (r ? shiftQuad(hit.position, r.x, r.y) : hit.position) : null);
      found++;
    }
    out.passes.push({ pass: kind, ms, found, px });
    return found;
  };

  const fastOpts = input.fastOpts ?? FAST_OPTS;
  const complete = () => input.expected > 0 && out.symbols.length >= input.expected;

  const retryMissing = async (): Promise<void> => {
    if (!input.rects) {
      if (input.fast) await run("hard", null, READ_OPTS);
      return;
    }
    for (const rect of input.rects) {
      if (complete()) return;
      const hit = out.quads.some((q) => q && inside(centerOf(q), rect));
      if (hit || rect.w < 48 || rect.h < 48) continue;
      const found = await run("roi-fast", rect, input.fast ? fastOpts : TILE_OPTS);
      if (found === 0) await run("roi-hard", rect, ROI_HARD_OPTS);
    }
  };

  await run(input.fast ? "fast" : "hard", null, input.fast ? fastOpts : READ_OPTS);
  if (complete()) return out;
  if (out.symbols.length > 0) {
    // Without a known layout one code is all we can ask for.
    if (input.expected > 0) await retryMissing();
    return out;
  }
  if (input.fast) {
    await run("hard", null, READ_OPTS);
    if (out.symbols.length > 0) {
      if (input.expected > 0 && !complete()) await retryMissing();
      return out;
    }
  }

  // Nothing yet: the original crop cascade, each step under the budget.
  if (w >= 80 && h >= 80) {
    const cw = Math.floor(w * 0.8);
    const ch = Math.floor(h * 0.8);
    if ((await run("crop", { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), w: cw, h: ch }, READ_OPTS)) > 0) return out;
  }
  if (w >= 96 && h >= 96) {
    for (const rect of centerTileRects(w, h)) {
      if (rect.w < 48 || rect.h < 48) continue;
      await run("crop", rect, TILE_OPTS);
      if (out.symbols.length >= 4) break;
    }
    if (out.symbols.length > 0) return out;
  }
  if (w >= 80 && h >= 80) {
    const cw = Math.max(16, Math.floor(w * 0.58));
    const ch = Math.max(16, Math.floor(h * 0.58));
    if ((await run("crop", { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), w: cw, h: ch }, READ_OPTS)) > 0) return out;
  }
  if (w >= 96 && h >= 96) {
    for (const rect of gridSliceRects(w, h)) {
      if (rect.w < 48 || rect.h < 48) continue;
      await run("crop", rect, TILE_OPTS);
      if (out.symbols.length >= 4) break;
    }
  }
  return out;
}

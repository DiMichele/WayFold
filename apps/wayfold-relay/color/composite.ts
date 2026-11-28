import { QR_MARGIN } from "../shared/optical.ts";
import { classifySample, fitAffine, type AffineFit, type FitSample } from "./fit.ts";
import { nearestState, saturation, stateColor, type Palette, type Rgb } from "./palette.ts";
import type { SampleMode, SeparateMethod } from "./profile.ts";
import { convexHull, quadCorners, refineQuad, type Pt } from "./quad.ts";

/** Modules of frame outside the QR cell, on every side. Quiet zone stays inside the cell. */
export const FRAME = 4;

export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface PaintResult extends Raster {
  modules: number;
  qrSize: number;
  versionHint: number;
  /** Milliseconds spent building the raster. */
  paintMs: number;
}

export interface SplitTimings {
  calMs: number;
  splitMs: number;
  sample: SampleMode;
  method: SeparateMethod;
  residual: number;
  condition: number | null;
  /** Time spent building the binary channel images handed to the decoder. */
  renderMs: number;
  /** Bytes of the bit planes plus the rendered channel images. */
  allocBytes: number;
  /** Fraction of QR modules whose bit differs from the source. Empty when the source is unknown. */
  ber: number[];
  monoLike: boolean;
  /** One recovered matrix per channel, dark = 1. */
  bits: Uint8Array[];
}

const NOTCH = 6;

export function compositeSpan(qrSize: number): number {
  return qrSize + 2 * QR_MARGIN + 2 * FRAME;
}

export function paintMatrices(matrices: Uint8Array[], palette: Palette, ppm = 1): PaintResult {
  const t0 = now();
  const qrSize = Math.round(Math.sqrt(matrices[0]?.length ?? 0));
  if (!qrSize || matrices.some((m) => m.length !== qrSize * qrSize)) {
    throw new Error("matrices are not square or not aligned");
  }
  const span = compositeSpan(qrSize);
  const width = span * ppm;
  const height = span * ppm;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let my = 0; my < span; my++) {
    for (let mx = 0; mx < span; mx++) {
      const color = moduleColor(mx, my, span, qrSize, matrices, palette);
      fillModule(data, width, mx, my, ppm, color);
    }
  }
  return { data, width, height, modules: span, qrSize, versionHint: qrVersion(qrSize), paintMs: now() - t0 };
}

export function paintGrid(
  cells: Uint8Array[][],
  palette: Palette,
  ppm: number,
  cols: number,
  gutter = 2,
): PaintResult {
  const t0 = now();
  const painted = cells.map((matrices) => paintMatrices(matrices, palette, ppm));
  const cell = painted[0]?.modules ?? 1;
  const rows = Math.ceil(cells.length / cols);
  const width = (cell * cols + gutter * Math.max(0, cols - 1)) * ppm;
  const height = (cell * rows + gutter * Math.max(0, rows - 1)) * ppm;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  painted.forEach((cellImg, i) => {
    const cx = (i % cols) * (cell + gutter) * ppm;
    const cy = Math.floor(i / cols) * (cell + gutter) * ppm;
    blit(data, width, cellImg.data, cellImg.width, cellImg.height, cx, cy);
  });
  return {
    data,
    width,
    height,
    modules: cell,
    qrSize: painted[0]?.qrSize ?? 0,
    versionHint: painted[0]?.versionHint ?? 0,
    paintMs: now() - t0,
  };
}

function qrVersion(size: number): number {
  return size >= 21 && (size - 17) % 4 === 0 ? (size - 17) / 4 : 0;
}

function moduleColor(
  mx: number,
  my: number,
  span: number,
  qrSize: number,
  matrices: Uint8Array[],
  palette: Palette,
): Rgb {
  if (my === 0 && mx === NOTCH) return { r: 255, g: 255, b: 255 };
  if (mx === 0 || my === 0 || mx === span - 1 || my === span - 1) return { r: 0, g: 0, b: 0 };
  const swatch = swatchIndex(mx, my, span, palette.states.length);
  if (swatch >= 0) return palette.states[swatch]!;
  const q0 = FRAME;
  const q1 = span - FRAME;
  if (mx < q0 || my < q0 || mx >= q1 || my >= q1) return { r: 255, g: 255, b: 255 };
  const lx = mx - q0 - QR_MARGIN;
  const ly = my - q0 - QR_MARGIN;
  if (lx < 0 || ly < 0 || lx >= qrSize || ly >= qrSize) return { r: 255, g: 255, b: 255 };
  let bits = 0;
  const i = ly * qrSize + lx;
  for (let c = 0; c < matrices.length; c++) if (matrices[c]![i]) bits |= 1 << c;
  return stateColor(palette, bits);
}

function swatchIndex(mx: number, my: number, span: number, states: number): number {
  if (my === 1 && mx >= 2 && mx < 2 + states) return mx - 2;
  if (my === span - 2 && mx >= 2 && mx < 2 + states) return mx - 2;
  return -1;
}

function fillModule(data: Uint8ClampedArray, width: number, mx: number, my: number, ppm: number, color: Rgb): void {
  const x0 = mx * ppm;
  const y0 = my * ppm;
  for (let y = 0; y < ppm; y++) {
    let p = ((y0 + y) * width + x0) * 4;
    for (let x = 0; x < ppm; x++) {
      data[p] = color.r;
      data[p + 1] = color.g;
      data[p + 2] = color.b;
      data[p + 3] = 255;
      p += 4;
    }
  }
}

function blit(
  dst: Uint8ClampedArray,
  dstW: number,
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  ox: number,
  oy: number,
): void {
  for (let y = 0; y < srcH; y++) {
    const from = (y * srcW) * 4;
    const to = ((oy + y) * dstW + ox) * 4;
    dst.set(src.subarray(from, from + srcW * 4), to);
  }
}

export interface LocatedComposite {
  /** Maps module coordinates to pixels. */
  homography: number[];
  span: number;
  qrSize: number;
  ppm: number;
  /** Pixel bounds of this composite, for the next crop. */
  bounds: { x: number; y: number; w: number; h: number };
  monoLike: boolean;
}

/** One homography per composite. A grid yields one entry per cell that still has its border. */
export function locateComposites(raster: Raster): { found: LocatedComposite[]; monoLike: boolean } {
  const boxes = componentBoxes(raster);
  if (!boxes.length) {
    return { found: [], monoLike: lowSaturation(raster) };
  }
  const found: LocatedComposite[] = [];
  for (const box of boxes) {
    const one = locateBox(raster, box);
    if (one) found.push(one);
  }
  const outer = found.filter((item, index) => !found.some((other, otherIndex) => {
    if (otherIndex === index) return false;
    const pad = 3;
    const inside =
      item.bounds.x >= other.bounds.x - pad &&
      item.bounds.y >= other.bounds.y - pad &&
      item.bounds.x + item.bounds.w <= other.bounds.x + other.bounds.w + pad &&
      item.bounds.y + item.bounds.h <= other.bounds.y + other.bounds.h + pad;
    return inside && other.bounds.w * other.bounds.h > item.bounds.w * item.bounds.h * 1.2;
  }));
  outer.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  return { found: outer, monoLike: outer.length === 0 && lowSaturation(raster) };
}

function locateBox(raster: Raster, box: Box): LocatedComposite | null {
  const edge = darkBoundary(raster, box);
  if (edge.length < 16) return null;
  const hull = convexHull(edge);
  const rough = quadCorners(hull);
  if (!rough) return null;
  const refined = refineQuad(hull, rough);
  const corners = refined && Math.abs(meanSide(refined) - meanSide(rough)) < meanSide(rough) * 0.04 ? refined : rough;
  if (!quadSane(corners)) return null;
  const ppm = borderThickness(raster, corners);
  if (!(ppm >= 1)) return null;
  const fitted = bestFrame(raster, corners, ppm);
  if (!fitted) return null;
  const span = fitted.span;
  const qrSize = span - 2 * QR_MARGIN - 2 * FRAME;
  const ordered = fitted.corners;
  const ideal = [
    { x: 0, y: 0 },
    { x: span, y: 0 },
    { x: span, y: span },
    { x: 0, y: span },
  ];
  const homography = homographyFrom(ideal, ordered);
  if (!homography) return null;
  const bounds = aabbOf(ordered);
  return { homography, span, qrSize, ppm, bounds, monoLike: false };
}

export function splitComposite(
  raster: Raster,
  located: LocatedComposite,
  palette: Palette,
  method: SeparateMethod,
  sample: SampleMode,
  source?: Uint8Array[],
): SplitTimings {
  const tCal = now();
  const samples = readSwatches(raster, located, palette);
  const fit = fitAffine(samples);
  const calMs = now() - tCal;
  const tSplit = now();
  const qrSize = located.qrSize;
  const channels = palette.channels;
  const bits = Array.from({ length: channels }, () => new Uint8Array(qrSize * qrSize));
  const q0 = FRAME + QR_MARGIN;
  for (let y = 0; y < qrSize; y++) {
    for (let x = 0; x < qrSize; x++) {
      const sampleRgb = sample === "pixel"
        ? voteModule(raster, located, q0 + x, q0 + y, palette, fit, method)
        : readModule(raster, located, q0 + x, q0 + y);
      const state = sample === "pixel"
        ? sampleRgb.state
        : classifySample(palette, sampleRgb.color, fit, method);
      for (let c = 0; c < channels; c++) bits[c]![(y * qrSize + x)] = (state >> c) & 1;
    }
  }
  const splitMs = now() - tSplit;
  const ber = source ? bits.map((row, c) => bitError(row, source[c])) : bits.map(() => 0);
  return {
    calMs,
    splitMs,
    sample,
    method,
    residual: fit?.residual ?? swatchResidual(palette, samples),
    condition: fit?.condition ?? null,
    renderMs: 0,
    allocBytes: channels * qrSize * qrSize,
    ber,
    monoLike: false,
    bits,
  };
}

function swatchResidual(palette: Palette, samples: FitSample[]): number {
  if (!samples.length) return 255;
  let err = 0;
  for (const s of samples) {
    const ideal = palette.states[nearestState(palette, s.observed)]!;
    err += Math.abs(ideal.r - s.observed.r) + Math.abs(ideal.g - s.observed.g) + Math.abs(ideal.b - s.observed.b);
  }
  return err / (samples.length * 3);
}

function readSwatches(raster: Raster, located: LocatedComposite, palette: Palette): FitSample[] {
  const out: FitSample[] = [];
  for (let i = 0; i < palette.states.length; i++) {
    const observed = readModule(raster, located, 2 + i, 1).color;
    out.push({ ideal: palette.states[i]!, observed });
  }
  return out;
}

function voteModule(
  raster: Raster,
  located: LocatedComposite,
  mx: number,
  my: number,
  palette: Palette,
  fit: AffineFit | null,
  method: SeparateMethod,
): { color: Rgb; state: number } {
  const votes = new Array<number>(palette.states.length).fill(0);
  let acc = { r: 0, g: 0, b: 0 };
  let n = 0;
  for (const ox of [-0.25, 0, 0.25]) {
    for (const oy of [-0.25, 0, 0.25]) {
      const color = readPoint(raster, located, mx + 0.5 + ox, my + 0.5 + oy);
      acc = { r: acc.r + color.r, g: acc.g + color.g, b: acc.b + color.b };
      votes[classifySample(palette, color, fit, method)]!++;
      n++;
    }
  }
  let state = 0;
  for (let i = 1; i < votes.length; i++) if (votes[i]! > votes[state]!) state = i;
  return { color: { r: acc.r / n, g: acc.g / n, b: acc.b / n }, state };
}

function readModule(raster: Raster, located: LocatedComposite, mx: number, my: number): { color: Rgb; state: number } {
  return { color: readPoint(raster, located, mx + 0.5, my + 0.5), state: 0 };
}

function readPoint(raster: Raster, located: LocatedComposite, mx: number, my: number): Rgb {
  const p = project(located.homography, mx, my);
  return sample(raster, p.x, p.y);
}

function bitError(got: Uint8Array, src: Uint8Array | undefined): number {
  if (!src || src.length !== got.length || !got.length) return src ? 1 : 0;
  let bad = 0;
  for (let i = 0; i < got.length; i++) if (got[i] !== src[i]) bad++;
  return bad / got.length;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function componentBoxes(raster: Raster): Box[] {
  const { data, width, height } = raster;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 400));
  const sw = Math.ceil(width / step);
  const sh = Math.ceil(height / step);
  const mask = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const px = Math.min(width - 1, x * step);
      const py = Math.min(height - 1, y * step);
      const i = (py * width + px) * 4;
      if (isInk(data[i]!, data[i + 1]!, data[i + 2]!)) mask[y * sw + x] = 1;
    }
  }
  const seen = new Uint8Array(mask.length);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let minX = sw;
    let minY = sh;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      const x = cur % sw;
      const y = (cur / sw) | 0;
      area++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      const nbs = [cur - 1, cur + 1, cur - sw, cur + sw];
      for (const nb of nbs) {
        if (nb < 0 || nb >= mask.length || seen[nb] || !mask[nb]) continue;
        if (nb === cur - 1 && x === 0) continue;
        if (nb === cur + 1 && x === sw - 1) continue;
        seen[nb] = 1;
        stack.push(nb);
      }
    }
    const bw = (maxX - minX + 1) * step;
    const bh = (maxY - minY + 1) * step;
    if (area > 20 && bw > 16 && bh > 16 && Math.abs(bw - bh) < Math.max(bw, bh) * 0.55) {
      boxes.push({ x: minX * step, y: minY * step, w: bw, h: bh });
    }
  }
  return boxes;
}

const DARK_LUMA = 160;

function lumaAt(raster: Raster, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return 255;
  const i = (Math.floor(y) * raster.width + Math.floor(x)) * 4;
  return (raster.data[i]! + raster.data[i + 1]! + raster.data[i + 2]!) / 3;
}

function darkBoundary(raster: Raster, box: Box): Pt[] {
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(raster.width - 1, box.x + box.w - 1);
  const y1 = Math.min(raster.height - 1, box.y + box.h - 1);
  const step = Math.min(box.w, box.h) > 700 ? 2 : 1;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const pts: Pt[] = [];
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      if (lumaAt(raster, x, y) >= DARK_LUMA) continue;
      const inside =
        lumaAt(raster, x - step, y) < DARK_LUMA &&
        lumaAt(raster, x + step, y) < DARK_LUMA &&
        lumaAt(raster, x, y - step) < DARK_LUMA &&
        lumaAt(raster, x, y + step) < DARK_LUMA;
      if (inside) continue;
      pts.push({
        x: x + (x + 0.5 >= cx ? 1 : 0),
        y: y + (y + 0.5 >= cy ? 1 : 0),
      });
    }
  }
  return pts;
}

function quadSane(corners: Pt[]): boolean {
  const lens = [0, 1, 2, 3].map((i) => Math.hypot(corners[(i + 1) % 4]!.x - corners[i]!.x, corners[(i + 1) % 4]!.y - corners[i]!.y));
  const max = Math.max(...lens);
  const min = Math.min(...lens);
  return min > 12 && min >= max * 0.45;
}

function meanSide(corners: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    sum += Math.hypot(corners[(i + 1) % 4]!.x - corners[i]!.x, corners[(i + 1) % 4]!.y - corners[i]!.y);
  }
  return sum / 4;
}

function bestFrame(raster: Raster, corners: Pt[], ppm: number): { span: number; corners: Pt[] } | null {
  const side = meanSide(corners);
  const guess = side / Math.max(ppm, 1);
  const tight: number[] = [];
  const wide: number[] = [];
  const maxSpan = 21 + 4 * 39 + 2 * QR_MARGIN + 2 * FRAME;
  for (let span = 37; span <= maxSpan; span += 4) {
    const implied = side / span;
    if (Math.abs(span - guess) <= Math.max(6, guess * 0.12)) tight.push(span);
    else if (implied >= Math.max(1, ppm * 0.4) && implied <= ppm * 2.6) wide.push(span);
  }
  wide.sort((a, b) => Math.abs(a - guess) - Math.abs(b - guess));
  return pickSpan(raster, corners, ppm, guess, tight) ?? (side >= 100 ? pickSpan(raster, corners, ppm, guess, wide.slice(0, 6)) : null);
}

function pickSpan(
  raster: Raster,
  corners: Pt[],
  ppm: number,
  guess: number,
  spans: number[],
): { span: number; corners: Pt[] } | null {
  let best: { score: number; err: number; span: number; corners: Pt[] } | null = null;
  for (const span of spans) {
    const forward = scoreFrame(raster, corners, span, ppm);
    const backward = scoreFrame(raster, [corners[0]!, corners[3]!, corners[2]!, corners[1]!], span, ppm);
    const item = forward.score >= backward.score ? forward : backward;
    const notchOk = item.notch > item.ring + 40 && item.notch > 160 && item.ring < 80;
    const insideOk = item.inner > item.ring + 30 || notchOk;
    if (!(notchOk && insideOk && item.ringFrac >= 0.55)) continue;
    const quality = item.ringFrac * 100 + (item.notch - item.ring) / 25;
    const err = Math.abs(span - guess);
    if (!best || quality > best.score + 0.5 || (quality >= best.score - 0.5 && err < best.err)) {
      best = { score: quality, err, span, corners: item.corners };
    }
  }
  return best;
}

function borderThickness(raster: Raster, corners: Pt[]): number {
  const center = centroid(corners);
  const runs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    for (const t of [0.4, 0.55, 0.72]) {
      const mid = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const dx = mid.x - center.x;
      const dy = mid.y - center.y;
      const reach = Math.hypot(dx, dy) + 6;
      const ux = dx / (reach - 6 || 1);
      const uy = dy / (reach - 6 || 1);
      let outer = -1;
      for (let s = 0; s < reach; s++) {
        if (lumaAt(raster, center.x + ux * s, center.y + uy * s) < DARK_LUMA) outer = s;
      }
      if (outer < 0) continue;
      let run = 0;
      for (let s = outer; s >= 0 && run < reach; s--) {
        if (lumaAt(raster, center.x + ux * s, center.y + uy * s) >= DARK_LUMA) break;
        run++;
      }
      if (run > 0 && run < reach / 8) runs.push(run);
    }
  }
  if (!runs.length) return 0;
  runs.sort((p, q) => p - q);
  return runs[Math.floor(runs.length / 2)]!;
}

function centroid(corners: Pt[]): Pt {
  return {
    x: corners.reduce((s, p) => s + p.x, 0) / corners.length,
    y: corners.reduce((s, p) => s + p.y, 0) / corners.length,
  };
}

function scoreFrame(raster: Raster, corners: Pt[], span: number, ppm: number): { score: number; notch: number; ring: number; inner: number; ringFrac: number; corners: Pt[] } {
  let bestI = 0;
  let bestNotch = -1;
  const center = centroid(corners);
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const luma = sideLuma(raster, a, b, 6.5 / span, ppm * 0.45, center);
    if (luma > bestNotch) {
      bestNotch = luma;
      bestI = i;
    }
  }
  const ordered = [0, 1, 2, 3].map((k) => corners[(bestI + k) % 4]!);
  const ideal = [
    { x: 0, y: 0 },
    { x: span, y: 0 },
    { x: span, y: span },
    { x: 0, y: span },
  ];
  const homography = homographyFrom(ideal, ordered);
  if (!homography) return { score: -1, notch: 0, ring: 255, inner: 0, ringFrac: 0, corners: ordered };
  const notch = lumaAt(raster, ...point(project(homography, 6.5, 0.5)));
  const ring = lumaAt(raster, ...point(project(homography, span / 2, 0.5)));
  const inner = lumaAt(raster, ...point(project(homography, span / 2, 1.5)));
  let dark = 0;
  let samples = 0;
  for (let m = 1.5; m < span - 1; m += Math.max(1, span / 10)) {
    if (Math.abs(m - 6.5) < 1.4) continue;
    samples++;
    if (lumaAt(raster, ...point(project(homography, m, 0.5))) < 100) dark++;
  }
  const ringFrac = samples ? dark / samples : 0;
  return { score: notch + inner - ring + ringFrac * 100, notch, ring, inner, ringFrac, corners: ordered };
}

function point(p: { x: number; y: number }): [number, number] {
  return [p.x, p.y];
}

function sideLuma(raster: Raster, a: Pt, b: Pt, along: number, inset: number, center: Pt): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let nx = -(b.y - a.y) / len;
  let ny = (b.x - a.x) / len;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (nx * (center.x - mid.x) + ny * (center.y - mid.y) < 0) {
    nx = -nx;
    ny = -ny;
  }
  const x = a.x + (b.x - a.x) * along + nx * inset;
  const y = a.y + (b.y - a.y) * along + ny * inset;
  return lumaAt(raster, x, y);
}

function aabbOf(corners: Pt[]): { x: number; y: number; w: number; h: number } {
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.floor(Math.min(...xs));
  const y = Math.floor(Math.min(...ys));
  const x1 = Math.ceil(Math.max(...xs));
  const y1 = Math.ceil(Math.max(...ys));
  return { x, y, w: Math.max(1, x1 - x), h: Math.max(1, y1 - y) };
}

function lowSaturation(raster: Raster): boolean {
  let sat = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(Math.min(raster.width, raster.height) / 32));
  for (let y = 0; y < raster.height; y += step) {
    for (let x = 0; x < raster.width; x += step) {
      const i = (y * raster.width + x) * 4;
      sat += saturation({ r: raster.data[i]!, g: raster.data[i + 1]!, b: raster.data[i + 2]! });
      n++;
    }
  }
  return n > 0 && sat / n < 18;
}

function isInk(r: number, g: number, b: number): boolean {
  const luma = (r + g + b) / 3;
  return luma < 210 || saturation({ r, g, b }) > 28;
}

function sample(raster: Raster, x: number, y: number): Rgb {
  const x0 = Math.max(0, Math.min(raster.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(raster.height - 1, Math.floor(y)));
  const i = (y0 * raster.width + x0) * 4;
  return { r: raster.data[i]!, g: raster.data[i + 1]!, b: raster.data[i + 2]! };
}

export function homographyFrom(src: { x: number; y: number }[], dst: { x: number; y: number }[]): number[] | null {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const s = src[i]!;
    const d = dst[i]!;
    a.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y]);
    b.push(d.x);
    a.push([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y]);
    b.push(d.y);
  }
  const h = solve8(a, b);
  return h ? [...h, 1] : null;
}

export function project(h: number[], x: number, y: number): { x: number; y: number } {
  const w = h[6]! * x + h[7]! * y + h[8]!;
  return { x: (h[0]! * x + h[1]! * y + h[2]!) / w, y: (h[3]! * x + h[4]! * y + h[5]!) / w };
}

function solve8(aIn: number[][], bIn: number[]): number[] | null {
  const a = aIn.map((row) => row.slice());
  const b = bIn.slice();
  const n = 8;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[pivot]![c]!)) pivot = r;
    const row = a[c]!;
    a[c] = a[pivot]!;
    a[pivot] = row;
    const bv = b[c]!;
    b[c] = b[pivot]!;
    b[pivot] = bv;
    const div = a[c]![c]!;
    if (Math.abs(div) < 1e-8) return null;
    for (let k = c; k < n; k++) a[c]![k] = a[c]![k]! / div;
    b[c] = b[c]! / div;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r]![c]!;
      for (let k = c; k < n; k++) a[r]![k] = a[r]![k]! - f * a[c]![k]!;
      b[r] = b[r]! - f * b[c]!;
    }
  }
  return b;
}

export function renderChannel(bits: Uint8Array, qrSize: number, ppm = 4): Raster {
  const span = qrSize + 2 * QR_MARGIN;
  const width = span * ppm;
  const height = span * ppm;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  for (let y = 0; y < qrSize; y++) {
    for (let x = 0; x < qrSize; x++) {
      if (!bits[y * qrSize + x]) continue;
      fillModule(data, width, x + QR_MARGIN, y + QR_MARGIN, ppm, { r: 0, g: 0, b: 0 });
    }
  }
  return { data, width, height };
}

/** Linear mix used by the synthetic bench. `mix` is row-major 3×3 applied to RGB, then offset. */
export function distortColors(raster: Raster, mix: number[], offset: Rgb, channelGain: Rgb): Raster {
  const data = new Uint8ClampedArray(raster.data);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]! * channelGain.r;
    const g = data[i + 1]! * channelGain.g;
    const b = data[i + 2]! * channelGain.b;
    data[i] = clamp(mix[0]! * r + mix[1]! * g + mix[2]! * b + offset.r);
    data[i + 1] = clamp(mix[3]! * r + mix[4]! * g + mix[5]! * b + offset.g);
    data[i + 2] = clamp(mix[6]! * r + mix[7]! * g + mix[8]! * b + offset.b);
  }
  return { data, width: raster.width, height: raster.height };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

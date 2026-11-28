import { QR_MARGIN } from "../shared/optical.ts";
import { classifySample, fitAffine, type AffineFit, type FitSample } from "./fit.ts";
import { nearestState, saturation, stateColor, type Palette, type Rgb } from "./palette.ts";
import type { SampleMode, SeparateMethod } from "./profile.ts";

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
  found.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  return { found, monoLike: found.length === 0 && lowSaturation(raster) };
}

function locateBox(raster: Raster, box: Box): LocatedComposite | null {
  const ppm = borderPpm(raster, box);
  if (!(ppm >= 1)) return null;
  if (!innerRimLight(raster, box, ppm)) return null;
  const span = Math.round(box.w / ppm);
  const qrSize = span - 2 * QR_MARGIN - 2 * FRAME;
  if (qrSize < 21 || (qrSize - 17) % 4 !== 0 || Math.abs(box.w - span * ppm) > ppm) return null;
  const notch = notchSide(raster, box, ppm);
  const corners = orientedCorners(box, ppm, notch);
  const ideal = [
    { x: 0.5, y: 0.5 },
    { x: span - 0.5, y: 0.5 },
    { x: span - 0.5, y: span - 0.5 },
    { x: 0.5, y: span - 0.5 },
  ];
  const homography = homographyFrom(ideal, corners);
  if (!homography) return null;
  return { homography, span, qrSize, ppm, bounds: { x: box.x, y: box.y, w: box.w, h: box.h }, monoLike: false };
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
    if (area > 20 && bw > 16 && bh > 16 && Math.abs(bw - bh) < Math.max(bw, bh) * 0.35) {
      boxes.push({ x: minX * step, y: minY * step, w: bw, h: bh });
    }
  }
  return boxes;
}

/** The module inside the black ring is white, so a QR blob is not a second composite. */
function innerRimLight(raster: Raster, box: Box, ppm: number): boolean {
  const points = [
    { x: box.x + ppm * 1.5, y: box.y + box.h / 2 },
    { x: box.x + box.w - ppm * 1.5, y: box.y + box.h / 2 },
    { x: box.x + box.w / 2, y: box.y + ppm * 1.5 },
    { x: box.x + box.w / 2, y: box.y + box.h - ppm * 1.5 },
  ];
  return points.every((point) => {
    const color = sample(raster, point.x, point.y);
    return (color.r + color.g + color.b) / 3 > 170;
  });
}

function borderPpm(raster: Raster, box: Box): number {
  const y = Math.min(raster.height - 1, box.y + Math.floor(box.h / 2));
  let run = 0;
  for (let x = box.x; x < box.x + box.w && x < raster.width; x++) {
    const i = (y * raster.width + x) * 4;
    if (raster.data[i]! > 40) break;
    run++;
  }
  return run;
}

function notchSide(raster: Raster, box: Box, ppm: number): number {
  const sides = [
    { x: box.x + NOTCH * ppm + ppm / 2, y: box.y + ppm / 2 },
    { x: box.x + box.w - ppm / 2, y: box.y + NOTCH * ppm + ppm / 2 },
    { x: box.x + box.w - NOTCH * ppm - ppm / 2, y: box.y + box.h - ppm / 2 },
    { x: box.x + ppm / 2, y: box.y + box.h - NOTCH * ppm - ppm / 2 },
  ];
  let best = 0;
  let bestL = -1;
  for (let i = 0; i < sides.length; i++) {
    const s = sample(raster, sides[i]!.x, sides[i]!.y);
    const luma = s.r + s.g + s.b;
    if (luma > bestL) {
      bestL = luma;
      best = i;
    }
  }
  return best;
}

function orientedCorners(box: Box, ppm: number, notch: number): { x: number; y: number }[] {
  const tl = { x: box.x + ppm / 2, y: box.y + ppm / 2 };
  const tr = { x: box.x + box.w - ppm / 2, y: box.y + ppm / 2 };
  const br = { x: box.x + box.w - ppm / 2, y: box.y + box.h - ppm / 2 };
  const bl = { x: box.x + ppm / 2, y: box.y + box.h - ppm / 2 };
  const ring = [tl, tr, br, bl];
  return [0, 1, 2, 3].map((i) => ring[(i + notch) % 4]!);
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

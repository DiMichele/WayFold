/** Shared optical knobs. Transfer and Diode both read these so the two modes stay in step. */

import { MAX_BLOCKS } from "./limits.ts";
import { HEADER_LEN } from "./protocol.ts";

export const QR_MARGIN = 4;

/** 24 fps leaves two refresh cycles on a 60 Hz panel. 60 fps tears on those screens. */
export const DEFAULT_TX_FPS = 24;

/** Payload bytes per QR, including the 20-byte frame header. ECC L keeps the modules large. */
export const DEFAULT_FRAME_BYTES = 1850;

/**
 * CSS pixels per module. A single code at 360px is about this dense and the
 * camera already reads it, so a grid may use the same module size.
 */
export const GRID_MODULE_PX = 2.4;

/** Byte-mode ECC L capacity for QR versions 1–40. Index 0 is unused. */
const GRID_BYTE_CAPACITY = [
  0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858,
  929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732, 1840, 1952, 2068, 2188, 2303, 2431,
  2563, 2699, 2809, 2953,
];

export const DEFAULT_ECC = "L" as const;

/**
 * CSS pixels per module for a color code. Below this, a phone camera mixes
 * neighboring red and blue modules and ECC L cannot repair the QR.
 */
export const COLOR_MODULE_CSS = 6;

/** Matches the black ring painted around a color composite. */
const COLOR_FRAME = 4;

const BYTE_CAPACITY_M = [
  0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666,
  711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989,
  2099, 2213, 2331,
];
const BYTE_CAPACITY_Q = [
  0, 11, 20, 32, 46, 60, 74, 86, 108, 130, 151, 177, 203, 241, 258, 292, 322, 364, 394, 442, 482,
  509, 565, 611, 661, 715, 751, 805, 868, 908, 982, 1030, 1112, 1168, 1228, 1283, 1351, 1423, 1499,
  1579, 1663,
];
const BYTE_CAPACITY_H = [
  0, 7, 14, 24, 34, 44, 58, 64, 84, 98, 119, 137, 155, 177, 194, 220, 250, 280, 310, 338, 382, 403,
  439, 461, 511, 535, 593, 625, 658, 698, 742, 790, 842, 898, 958, 983, 1051, 1093, 1139, 1219, 1273,
];

export type EccLevel = "L" | "M" | "Q" | "H";

/** 1, 2 or 4. Anything else falls back to a single code. */
export function normalizeGrid(count: number): number {
  if (count === 2 || count === 4) return count;
  return 1;
}

/** Two codes sit side by side when the screen is wide, and stack when it is tall. */
export function gridDims(count: number, wide = false): { cols: number; rows: number } {
  const n = normalizeGrid(count);
  if (n === 2) return wide ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
  if (n === 4) return { cols: 2, rows: 2 };
  return { cols: 1, rows: 1 };
}

/**
 * How long the whole grid stays still, in milliseconds.
 * The grid is painted in one step, so it can change at the same rate as one code.
 */
export function gridHoldMs(fps: number, grid: number): number {
  const safeFps = Math.min(60, Math.max(1, Number.isFinite(fps) ? fps : DEFAULT_TX_FPS));
  normalizeGrid(grid);
  return 1000 / safeFps;
}

/**
 * One code keeps the requested size. A grid uses the largest payload that
 * still leaves GRID_MODULE_PX on screen after the integer scale.
 */
export function frameBytesForGrid(
  requested: number,
  grid: number,
  cssWidth = 360,
  cssHeight = cssWidth,
  dpr = 1,
): number {
  const asked = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_FRAME_BYTES;
  if (normalizeGrid(grid) <= 1) return asked;
  const width = Math.max(160, Number.isFinite(cssWidth) ? cssWidth : 360);
  const height = Math.max(160, Number.isFinite(cssHeight) ? cssHeight : width);
  const pixels = Math.max(1, Number.isFinite(dpr) ? dpr : 1);
  const { cols, rows } = gridDims(grid, width >= height);
  let bytes = 32;
  for (let version = 2; version < GRID_BYTE_CAPACITY.length; version++) {
    const capacity = GRID_BYTE_CAPACITY[version] ?? bytes;
    const payload = Math.min(asked, capacity);
    if (payload < 32) continue;
    let used = 2;
    for (let candidate = 2; candidate < GRID_BYTE_CAPACITY.length; candidate++) {
      if ((GRID_BYTE_CAPACITY[candidate] ?? 0) >= payload) {
        used = candidate;
        break;
      }
    }
    const matrix = 17 + 4 * used + 2 * QR_MARGIN;
    const gutter = Math.max(4, Math.round(matrix * 0.08));
    const totalW = matrix * cols + gutter * Math.max(0, cols - 1);
    const totalH = matrix * rows + gutter * Math.max(0, rows - 1);
    const scale = Math.floor(Math.min((width * pixels) / totalW, (height * pixels) / totalH));
    if (scale >= 1 && scale / pixels >= GRID_MODULE_PX) bytes = payload;
  }
  return bytes;
}

/**
 * Bytes that still leave a color module large enough for a phone camera.
 * The requested size is kept when the code is already coarse enough.
 */
export function colorFrameBytes(requested: number, cellCss: number, ecc: EccLevel = "L"): number {
  const css = Math.max(160, Number.isFinite(cellCss) ? cellCss : 360);
  const maxSpan = Math.max(37, Math.floor(css / COLOR_MODULE_CSS));
  const maxQr = maxSpan - 2 * QR_MARGIN - 2 * COLOR_FRAME;
  const maxVersion = Math.max(4, Math.min(40, Math.floor((maxQr - 17) / 4)));
  const table = ecc === "H" ? BYTE_CAPACITY_H : ecc === "Q" ? BYTE_CAPACITY_Q : ecc === "M" ? BYTE_CAPACITY_M : GRID_BYTE_CAPACITY;
  const cap = table[maxVersion] ?? 78;
  const asked = Number.isFinite(requested) && requested > 0 ? requested : cap;
  return Math.max(21, Math.min(asked, cap));
}

/**
 * A readable color grid can shrink a frame until a normal file needs more
 * fountain blocks than the receiver accepts. Raise the frame just enough to fit.
 */
export function frameBytesToFit(payloadLen: number, proposed: number, ecc: EccLevel = "L"): number {
  const len = Math.max(1, Math.floor(payloadLen));
  const minFrame = HEADER_LEN + Math.ceil(len / MAX_BLOCKS);
  const table = ecc === "H" ? BYTE_CAPACITY_H : ecc === "Q" ? BYTE_CAPACITY_Q : ecc === "M" ? BYTE_CAPACITY_M : GRID_BYTE_CAPACITY;
  const maxFrame = table[40] ?? minFrame;
  const asked = Number.isFinite(proposed) && proposed > 0 ? proposed : minFrame;
  return Math.max(21, Math.min(maxFrame, Math.max(asked, minFrame)));
}

/** One QR matrix, quiet zone included, black modules on white. */
export function rasterizeQr(size: number, dark: ArrayLike<number>, margin = QR_MARGIN): ImageData {
  const total = size + 2 * margin;
  const img = new ImageData(total, total);
  const px = new Uint32Array(img.data.buffer);
  px.fill(0xffffffff);
  for (let y = 0; y < size; y++) {
    const row = (y + margin) * total + margin;
    const src = y * size;
    for (let x = 0; x < size; x++) {
      if (dark[src + x]) px[row + x] = 0xff000000;
    }
  }
  return img;
}

/** Every QR a decode worker found. `bytes` stays for callers that only read the first. */
export function symbolsFromWorker(data: {
  bytes?: Uint8Array | null;
  symbols?: ArrayLike<Uint8Array> | null;
}): Uint8Array[] {
  const many = data.symbols;
  if (many && many.length) {
    const out: Uint8Array[] = [];
    for (let i = 0; i < many.length; i++) {
      const item = many[i];
      if (item && item.length) out.push(item);
    }
    if (out.length) return out;
  }
  return data.bytes && data.bytes.length ? [data.bytes] : [];
}

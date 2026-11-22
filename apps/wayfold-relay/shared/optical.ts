/** Shared optical knobs. Transfer and Diode both read these so the two modes stay in step. */

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

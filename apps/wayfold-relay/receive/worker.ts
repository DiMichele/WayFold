// QR decode worker: zxing-cpp compiled to WASM. (Safari has never shipped
// BarcodeDetector — WebKit bug 281848 — so WASM is the only portable way.)
// One frame in flight per worker; the main thread drops frames when all
// workers are busy. Frames are disposable — the fountain doesn't care.

import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { centerTileRects, cropRgbaCenter, cropRgbaRect, gridSliceRects } from "./image-crop.ts";

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith(".wasm") ? wasmUrl : prefix + path,
  },
});

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

const READ_OPTS = {
  formats: ["QRCode"] as ["QRCode"],
  maxNumberOfSymbols: 4,
  tryHarder: true,
  tryRotate: true,
};

/** Extra passes skip rotation and invert. The full frame already tried those. */
const TILE_OPTS = {
  formats: ["QRCode"] as ["QRCode"],
  maxNumberOfSymbols: 4,
  tryHarder: true,
  tryRotate: false,
  tryInvert: false,
  tryDownscale: false,
};

function toImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  const copy = new Uint8ClampedArray(data.length);
  copy.set(data);
  return new ImageData(copy, width, height);
}

async function decodeQr(img: ImageData, opts: typeof READ_OPTS = READ_OPTS): Promise<Uint8Array[]> {
  const results = await readBarcodes(img, opts);
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
  hash = (Math.imul(hash ^ bytes.length, 16777619) >>> 0);
  if (seen.has(hash)) return;
  seen.add(hash);
  symbols.push(bytes);
}

/** One code per slice, when the full frame returns nothing. Stops at four symbols. */
async function decodeRects(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  rects: Array<{ x: number; y: number; w: number; h: number }>,
  opts: typeof READ_OPTS,
): Promise<Uint8Array[]> {
  const symbols: Uint8Array[] = [];
  const seen = new Set<number>();
  for (const rect of rects) {
    if (rect.w < 48 || rect.h < 48) continue;
    const crop = cropRgbaRect(pixels, w, h, rect.x, rect.y, rect.w, rect.h);
    const hits = await decodeQr(toImageData(crop.data, crop.width, crop.height), opts);
    for (const hit of hits) remember(symbols, seen, hit);
    if (symbols.length >= 4) break;
  }
  return symbols;
}

function wallNow(): number {
  return performance.timeOrigin + performance.now();
}

ctx.onmessage = async (e: MessageEvent) => {
  const { id, buf, w, h, postedAt } = e.data as {
    id: number;
    buf: ArrayBuffer;
    w: number;
    h: number;
    postedAt?: number;
  };
  const queueAt = typeof postedAt === "number" ? postedAt : wallNow();
  try {
    const pixels = new Uint8ClampedArray(buf);
    let symbols = await decodeQr(toImageData(pixels, w, h));
    if (symbols.length === 0 && w >= 80 && h >= 80) {
      const wide = cropRgbaCenter(pixels, w, h, 0.8);
      symbols = await decodeQr(toImageData(wide.data, wide.width, wide.height));
    }
    if (symbols.length === 0 && w >= 96 && h >= 96) {
      symbols = await decodeRects(pixels, w, h, centerTileRects(w, h), TILE_OPTS);
    }
    if (symbols.length === 0 && w >= 80 && h >= 80) {
      const crop = cropRgbaCenter(pixels, w, h, 0.58);
      symbols = await decodeQr(toImageData(crop.data, crop.width, crop.height));
    }
    if (symbols.length === 0 && w >= 96 && h >= 96) {
      symbols = await decodeRects(pixels, w, h, gridSliceRects(w, h), TILE_OPTS);
    }
    ctx.postMessage({ id, bytes: symbols[0] ?? null, symbols, postedAt: queueAt, doneAt: wallNow() });
  } catch {
    ctx.postMessage({ id, bytes: null, postedAt: queueAt, doneAt: wallNow() });
  }
};

// warm the WASM so the first real frame doesn't pay instantiation
void readBarcodes(new ImageData(8, 8), { formats: ["QRCode"] })
  .then(() => ctx.postMessage({ id: -1, bytes: null }))
  .catch((error: unknown) =>
    ctx.postMessage({
      id: -1,
      bytes: null,
      error: error instanceof Error ? error.message : String(error),
    }),
  );

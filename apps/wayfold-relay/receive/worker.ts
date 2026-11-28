// QR decode worker: zxing-cpp compiled to WASM. (Safari has never shipped
// BarcodeDetector — WebKit bug 281848 — so WASM is the only portable way.)
// One frame in flight per worker; the main thread drops frames when all
// workers are busy. Frames are disposable — the fountain doesn't care.

import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import {
  PassCosts,
  legacyDecode,
  plannedDecode,
  readSymbols,
  COLOR_READ_OPTS,
  type Hit,
  type PlanOutput,
  type Quad,
  type ReadFn,
  type Rect,
} from "./decode-core.ts";

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

const costs = new PassCosts();

const read: ReadFn = async (input, opts) => {
  const results = await readBarcodes(
    input as ImageData | Uint8Array,
    opts as Parameters<typeof readBarcodes>[1],
  );
  const out: Hit[] = [];
  for (const hit of results) {
    if (!hit.isValid || !hit.bytes?.length) continue;
    out.push({
      isValid: true,
      bytes: new Uint8Array(hit.bytes),
      position: hit.position as Quad | undefined,
      version: (hit as { version?: string | number }).version,
    });
  }
  return out;
};

function wallNow(): number {
  return performance.timeOrigin + performance.now();
}

type WorkerReq = {
  id: number;
  buf: ArrayBuffer;
  w: number;
  h: number;
  postedAt?: number;
  fast?: boolean;
  mem?: boolean;
  gray?: boolean;
  track?: boolean;
  expected?: number;
  rects?: Rect[] | null;
  budgetMs?: number;
  extras?: { buf: ArrayBuffer; w: number; h: number }[];
  color?: boolean;
};

ctx.onmessage = async (e: MessageEvent) => {
  const req = e.data as WorkerReq;
  const { id, buf, w, h } = req;
  const queueAt = typeof req.postedAt === "number" ? req.postedAt : wallNow();
  const startedAt = wallNow();
  try {
    const pixels = new Uint8ClampedArray(buf);
    const usePlan = !!(
      req.fast ||
      req.mem ||
      req.gray ||
      req.track ||
      (req.rects && req.rects.length) ||
      Number.isFinite(req.budgetMs)
    );
    let symbols: Uint8Array[];
    let quads: (Quad | null)[] = [];
    let modules: number[] = [];
    let passes: PlanOutput["passes"] = [];
    let skipped = 0;

    if (usePlan) {
      const out = await plannedDecode(read, {
        pixels,
        w,
        h,
        fast: !!req.fast,
        mem: !!req.mem,
        gray: !!req.gray,
        expected: req.expected ?? 0,
        rects: req.rects ?? null,
        budgetMs: Number.isFinite(req.budgetMs) ? (req.budgetMs as number) : Infinity,
        startedAt: wallNow(),
        now: wallNow,
        costs,
      });
      symbols = out.symbols;
      quads = out.quads;
      modules = out.modules;
      passes = out.passes;
      skipped = out.skipped;
    } else if (req.color) {
      symbols = await readSymbols(read, pixels, w, h, COLOR_READ_OPTS);
    } else {
      symbols = await legacyDecode(read, pixels, w, h);
    }
    for (const extra of req.extras ?? []) {
      const view = new Uint8ClampedArray(extra.buf);
      const more = req.color
        ? await readSymbols(read, view, extra.w, extra.h, COLOR_READ_OPTS)
        : await legacyDecode(read, view, extra.w, extra.h);
      symbols.push(...more);
    }

    ctx.postMessage({
      id,
      bytes: symbols[0] ?? null,
      symbols,
      quads,
      modules,
      passes,
      skipped,
      postedAt: queueAt,
      startedAt,
      doneAt: wallNow(),
    });
  } catch {
    ctx.postMessage({ id, bytes: null, postedAt: queueAt, startedAt, doneAt: wallNow() });
  }
};

void readBarcodes(new ImageData(8, 8), { formats: ["QRCode"] })
  .then(() => ctx.postMessage({ id: -1, bytes: null }))
  .catch((error: unknown) =>
    ctx.postMessage({
      id: -1,
      bytes: null,
      error: error instanceof Error ? error.message : String(error),
    }),
  );

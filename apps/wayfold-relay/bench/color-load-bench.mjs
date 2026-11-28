// Synthetic payload and scheduling bench. Not a camera or monitor measurement.
//   node --experimental-strip-types --no-warnings bench/color-load-bench.mjs
import "../tests/imagedata-polyfill.mjs";
import os from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { encodeGrid, encodePayloads, recoverRaster } from "../color/engine.ts";
import { alignMatrices } from "../color/matrices.ts";
import { observeColorArq } from "../color/arq-observe.ts";
import { scheduleSymbols } from "../color/schedule.ts";
import { gridDims, rasterizeQr } from "../shared/optical.ts";

const PAYLOADS = [48, 400, 800, 1200, 1850, 2331];
const ECCS = ["L", "M", "Q", "H"];
const PROFILES = ["mono", "color2", "rgb3"];
const PPM = 2;
const RESULTS = new URL("./results/", import.meta.url);
mkdirSync(RESULTS, { recursive: true });

function bytes(n, seed) {
  const out = new Uint8Array(n);
  let x = seed || 1;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x & 255;
  }
  return out;
}

function fits(n, ecc) {
  try {
    alignMatrices([bytes(n, 1)], ecc);
    return true;
  } catch {
    return false;
  }
}

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function scaleTo(raster, tw, th) {
  if (raster.width === tw && raster.height === th) return raster;
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(raster.height - 1, Math.floor((y * raster.height) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(raster.width - 1, Math.floor((x * raster.width) / tw));
      const s = (sy * raster.width + sx) * 4;
      const d = (y * tw + x) * 4;
      out[d] = raster.data[s];
      out[d + 1] = raster.data[s + 1];
      out[d + 2] = raster.data[s + 2];
      out[d + 3] = 255;
    }
  }
  return { data: out, width: tw, height: th };
}

function degrade(raster, kind) {
  const w = raster.width;
  const h = raster.height;
  const src = raster.data;
  const data = new Uint8ClampedArray(w * h * 4);
  const at = (x, y) => {
    const xx = Math.max(0, Math.min(w - 1, x));
    const yy = Math.max(0, Math.min(h - 1, y));
    return (yy * w + xx) * 4;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r;
      let g;
      let b;
      if (kind === "blur") {
        r = g = b = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const i = at(x + dx, y + dy);
            r += src[i];
            g += src[i + 1];
            b += src[i + 2];
          }
        }
        r /= 9;
        g /= 9;
        b /= 9;
      } else if (kind === "perspective") {
        const shift = Math.round((y / h - 0.5) * w * 0.04);
        const i = at(x + shift, y);
        r = src[i];
        g = src[i + 1];
        b = src[i + 2];
      } else if (kind === "rolling") {
        const i = at(x + Math.round(y * 0.02), y);
        r = src[i];
        g = src[i + 1];
        b = src[i + 2];
      } else {
        const i = (y * w + x) * 4;
        r = src[i];
        g = src[i + 1];
        b = src[i + 2];
      }
      if (kind === "crosstalk") {
        const rr = r;
        const gg = g;
        const bb = b;
        r = rr * 0.82 + gg * gg * 0.0008 + bb * 0.08 + 6;
        g = gg * 0.84 + rr * bb * 0.0006 + 4;
        b = bb * 0.8 + rr * 0.12 + gg * 0.05 + 5;
      } else if (kind === "gamma") {
        r = 255 * (r / 255) ** 1.7;
        g = 255 * (g / 255) ** 1.7;
        b = 255 * (b / 255) ** 1.7;
      } else if (kind === "saturation") {
        const m = Math.max(r, g, b);
        r = r * 0.35 + m * 0.65;
        g = g * 0.35 + m * 0.65;
        b = b * 0.35 + m * 0.65;
      } else if (kind === "clip") {
        r = r < 28 ? 0 : r > 220 ? 255 : r;
        g = g < 28 ? 0 : g > 220 ? 255 : g;
        b = b < 28 ? 0 : b > 220 ? 255 : b;
      } else if (kind === "yuv420") {
        const x0 = x & ~1;
        const y0 = y & ~1;
        let rs = 0;
        let gs = 0;
        let bs = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const i = at(x0 + dx, y0 + dy);
            rs += src[i];
            gs += src[i + 1];
            bs += src[i + 2];
          }
        }
        const yL = 0.299 * r + 0.587 * g + 0.114 * b;
        const u = (-0.169 * rs - 0.331 * gs + 0.5 * bs) / 4;
        const v = (0.5 * rs - 0.419 * gs - 0.081 * bs) / 4;
        r = yL + 1.4 * v;
        g = yL - 0.34 * u - 0.71 * v;
        b = yL + 1.77 * u;
      } else if (kind === "noise") {
        const n = ((x * 17 + y * 31) % 21) - 10;
        r += n;
        g += n * 0.6;
        b -= n * 0.4;
      }
      const d = (y * w + x) * 4;
      data[d] = clamp(r);
      data[d + 1] = clamp(g);
      data[d + 2] = clamp(b);
      data[d + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function blit(dst, dw, src, sw, sh, ox, oy) {
  for (let y = 0; y < sh; y++) {
    dst.set(src.subarray(y * sw * 4, (y * sw + sw) * 4), ((oy + y) * dw + ox) * 4);
  }
}

function monoGrid(list, ecc, cols) {
  const version = Math.max(...list.map((p) => alignMatrices([p], ecc).version));
  const locked = list.map((p) => alignMatrices([p], ecc, version));
  const cell = locked[0].size + 8;
  const rows = Math.ceil(list.length / cols);
  const gutter = 2;
  const width = cell * cols + gutter * Math.max(0, cols - 1);
  const height = cell * rows + gutter * Math.max(0, rows - 1);
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  const matrices = [];
  locked.forEach((item, i) => {
    const img = rasterizeQr(item.size, item.matrices[0], 4);
    matrices.push(item.matrices[0]);
    blit(data, width, img.data, img.width, img.height, (i % cols) * (cell + gutter), Math.floor(i / cols) * (cell + gutter));
  });
  return { data, width, height, cell, qrSize: locked[0].size, matrices, gutter, cols, rows };
}

function monoBer(raster, grid) {
  const bers = [];
  const pitch = grid.cell + grid.gutter;
  for (let i = 0; i < grid.matrices.length; i++) {
    const ox = (i % grid.cols) * pitch;
    const oy = Math.floor(i / grid.cols) * pitch;
    let bad = 0;
    const modules = grid.cell;
    for (let my = 0; my < modules; my++) {
      for (let mx = 0; mx < modules; mx++) {
        const x = Math.min(raster.width - 1, Math.floor(((ox + mx + 0.5) * raster.width) / grid.width));
        const y = Math.min(raster.height - 1, Math.floor(((oy + my + 0.5) * raster.height) / grid.height));
        const p = (y * raster.width + x) * 4;
        const dark = raster.data[p] < 128 ? 1 : 0;
        let expect = 0;
        if (mx >= 4 && my >= 4 && mx < 4 + grid.qrSize && my < 4 + grid.qrSize) {
          expect = grid.matrices[i][(my - 4) * grid.qrSize + (mx - 4)] ? 1 : 0;
        }
        if (dark !== expect) bad++;
      }
    }
    bers.push(bad / (modules * modules));
  }
  return bers;
}

function colorPayloads(profile, n, cells, seed) {
  const channels = profile === "rgb3" ? 3 : 2;
  const out = [];
  let k = seed;
  for (let c = 0; c < cells; c++) {
    const row = [];
    for (let ch = 0; ch < channels; ch++) row.push(bytes(n, k++));
    out.push(row);
  }
  return out;
}

const rows = [];
const skipped = [];
let symbolMs = 12;
let zxing = null;
try {
  zxing = await import("zxing-wasm/reader");
} catch {
  zxing = null;
}

for (const n of PAYLOADS) {
  for (const ecc of ECCS) {
    if (!fits(n, ecc)) {
      skipped.push({ bytes: n, ecc, reason: "not a valid QR payload/ECC pair" });
      continue;
    }
    const grids = n >= 1200 ? [1] : [1, 2, 4];
    for (const grid of grids) {
      const { cols } = gridDims(grid, true);
      const colorCells = colorPayloads("rgb3", n, grid, 10 + n);
      const reference = encodeGrid(colorCells, ecc, "rgb3", true, undefined, PPM);
      const targetW = reference.raster.width;
      const targetH = reference.raster.height;
      for (const profile of PROFILES) {
        const t0 = performance.now();
        let surface;
        let mono = null;
        let encoded = null;
        if (profile === "mono") {
          const list = Array.from({ length: grid }, (_, i) => bytes(n, 40 + i + n));
          mono = monoGrid(list, ecc, cols);
          surface = scaleTo(mono, targetW, targetH);
        } else {
          const cells = colorPayloads(profile, n, grid, 10 + n);
          encoded = encodeGrid(cells, ecc, profile, true, undefined, PPM);
          surface = scaleTo(encoded.raster, targetW, targetH);
        }
        const paintMs = performance.now() - t0;
        const heapBefore = process.memoryUsage().heapUsed;
        const kind = "clean";
        const image = surface;
        let ber = null;
        let success = null;
        let locateMs = null;
        let calMs = null;
        let splitMs = null;
        let residual = null;
        let condition = null;
        let found = null;
        if (profile === "mono") {
          ber = monoBer(image, mono);
          success = ber.map((v) => (v === 0 ? 1 : 0));
          found = grid;
        } else {
          const sources = encoded.aligned.map((item) => item.matrices);
          const recovered = recoverRaster(image, profile, "hybrid", "module", undefined, sources);
          found = recovered.found.length;
          locateMs = recovered.locateMs;
          if (recovered.found.length) {
            ber = recovered.found.flatMap((cell) => cell.split.ber);
            success = ber.map((v) => (v === 0 ? 1 : 0));
            calMs = recovered.found.reduce((s, cell) => s + cell.split.calMs, 0);
            splitMs = recovered.found.reduce((s, cell) => s + cell.split.splitMs, 0);
            residual = Math.max(...recovered.found.map((cell) => cell.split.residual));
            condition = Math.max(...recovered.found.map((cell) => cell.split.condition ?? 0));
          } else {
            ber = [];
            success = Array.from({ length: grid * (profile === "rgb3" ? 3 : 2) }, () => 0);
          }
          if (n === 48 && grid === 1 && profile === "rgb3" && splitMs != null) {
            symbolMs = (locateMs + calMs + splitMs) / 3;
          }
        }
        const heapAfter = process.memoryUsage().heapUsed;
        const channels = profile === "mono" ? 1 : profile === "color2" ? 2 : 3;
        const ok = success && success.length ? success.reduce((s, v) => s + v, 0) / success.length : 0;
        const qrModules = profile === "mono" ? mono.qrSize : encoded.aligned[0].size;
        const cellModules = profile === "mono" ? mono.cell : reference.raster.modules;
        rows.push({
          bytes: n,
          ecc,
          grid,
          profile,
          degrade: kind,
          surface: targetW * targetH,
          ppm: +((profile === "mono" ? targetW / (mono.cell * cols + 2 * Math.max(0, cols - 1)) : targetW / (cellModules * cols + PPM * 2 * Math.max(0, cols - 1)))).toFixed(3),
          qrModules,
          paintMs: +paintMs.toFixed(2),
          locateMs: locateMs == null ? null : +locateMs.toFixed(2),
          calMs: calMs == null ? null : +calMs.toFixed(2),
          splitMs: splitMs == null ? null : +splitMs.toFixed(2),
          found,
          ber,
          success,
          residual,
          condition,
          integrity: ok === 1 ? "modules" : "mismatch",
          heapDelta: heapAfter - heapBefore,
          modelGoodputBps: Math.round(channels * n * ok * grid * 10),
          note: "synthetic, assumed 10 composites per second, not a camera",
        });
        console.log(`${profile} ${n}B ${ecc} grid ${grid}: found ${found} success ${ok.toFixed(2)}`);
      }
    }
  }
}

const DEGRADE = ["crosstalk", "gamma", "saturation", "clip", "yuv420", "blur", "noise", "perspective", "rolling"];
for (const n of [400, 1850]) {
  const ecc = fits(n, "M") ? "M" : "L";
  for (const profile of PROFILES) {
    for (const kind of DEGRADE) {
      const t0 = performance.now();
      let ber = null;
      let success = null;
      let found = 0;
      let locateMs = null;
      let calMs = null;
      let splitMs = null;
      if (profile === "mono") {
        const mono = monoGrid([bytes(n, 7)], ecc, 1);
        const color = encodeGrid(colorPayloads("rgb3", n, 1, 3), ecc, "rgb3", true, undefined, PPM);
        const image = degrade(scaleTo(mono, color.raster.width, color.raster.height), kind);
        ber = monoBer(image, mono);
        success = ber.map((v) => (v === 0 ? 1 : 0));
        found = 1;
      } else {
        const encoded = encodeGrid(colorPayloads(profile, n, 1, 3), ecc, profile, true, undefined, PPM);
        const image = degrade(encoded.raster, kind);
        const recovered = recoverRaster(image, profile, "hybrid", "module", undefined, encoded.aligned.map((item) => item.matrices));
        found = recovered.found.length;
        locateMs = recovered.locateMs;
        if (found) {
          ber = recovered.found.flatMap((cell) => cell.split.ber);
          success = ber.map((v) => (v === 0 ? 1 : 0));
          calMs = recovered.found.reduce((s, cell) => s + cell.split.calMs, 0);
          splitMs = recovered.found.reduce((s, cell) => s + cell.split.splitMs, 0);
        } else {
          const channels = profile === "rgb3" ? 3 : 2;
          success = Array.from({ length: channels }, () => 0);
          ber = [];
        }
      }
      const ok = success.reduce((s, v) => s + v, 0) / success.length;
      rows.push({
        bytes: n,
        ecc,
        grid: 1,
        profile,
        degrade: kind,
        paintMs: +(performance.now() - t0).toFixed(2),
        locateMs: locateMs == null ? null : +locateMs.toFixed(2),
        calMs: calMs == null ? null : +calMs.toFixed(2),
        splitMs: splitMs == null ? null : +splitMs.toFixed(2),
        found,
        ber,
        success,
        integrity: ok === 1 ? "modules" : found ? "mismatch" : "not-located",
        modelGoodputBps: Math.round((profile === "mono" ? 1 : profile === "color2" ? 2 : 3) * n * ok * 10),
        note: "synthetic degradation, not a camera",
      });
      console.log(`degrade ${kind} ${profile} ${n}B: found ${found} success ${ok.toFixed(2)}`);
    }
  }
}

let zxingRows = [];
let zxingWarm = true;
if (zxing) {
  for (const profile of ["color2", "rgb3"]) {
    for (const n of [48, 400]) {
      const encoded = encodePayloads(colorPayloads(profile, n, 1, 9)[0], "L", profile, undefined, 4);
      const recovered = recoverRaster(encoded, profile, "hybrid", "module");
      const want = colorPayloads(profile, n, 1, 9)[0].map((item) => Buffer.from(item).toString("hex"));
      const got = [];
      let decodeMs = 0;
      for (const channel of recovered.found[0]?.channels ?? []) {
        const t0 = performance.now();
        const hits = await zxing.readBarcodes(new ImageData(channel.data, channel.width, channel.height), {
          formats: ["QRCode"],
          tryHarder: true,
        });
        decodeMs += performance.now() - t0;
        for (const hit of hits) if (hit.isValid && hit.bytes?.length) got.push(Buffer.from(hit.bytes).toString("hex"));
      }
      const warm = zxingWarm;
      zxingWarm = false;
      zxingRows.push({
        profile,
        bytes: n,
        decodeMs: +decodeMs.toFixed(2),
        channels: got.length,
        intact: want.every((item) => got.includes(item)),
        warmup: warm,
      });
      if (profile === "rgb3" && n === 48 && got.length) symbolMs = decodeMs / got.length;
      console.log(`zxing ${profile} ${n}B intact ${want.every((item) => got.includes(item))} ${decodeMs.toFixed(1)} ms`);
    }
  }
}

function rgbItems() {
  const items = [];
  for (let composite = 0; composite < 4; composite++) {
    for (let channel = 0; channel < 3; channel++) items.push({ composite, channel, payload: 0 });
  }
  return items;
}

const schedule = [];
const symbolCosts = [
  { label: "zxing-48-rgb3", symbolMs },
  ...zxingRows
    .filter((row) => row.channels > 0 && !row.warmup)
    .map((row) => ({ label: `zxing-${row.bytes}-${row.profile}`, symbolMs: row.decodeMs / row.channels })),
];
for (const cost of symbolCosts) {
  for (const workers of [2, 4]) {
    for (const mode of ["channel", "composite", "cell", "adaptive", "budget"]) {
      const plan = scheduleSymbols(rgbItems(), workers, mode, 0, { symbolMs: cost.symbolMs, budgetMs: 1000 / 30 });
      schedule.push({
        label: cost.label,
        workers,
        mode,
        candidates: plan.candidates,
        scheduled: plan.scheduled,
        dropped: plan.dropped,
        perJob: plan.perJob,
        slowest: plan.slowest,
        wallMs: +(plan.slowest * cost.symbolMs).toFixed(2),
        symbolMs: +cost.symbolMs.toFixed(2),
        budgetMs: +(1000 / 30).toFixed(2),
        keepsQueue: false,
      });
    }
  }
}

const arq = [
  observeColorArq({ channels: 3, count: 36, steps: 24, rttMs: 400, stepMs: 40, mtu: 1200, payloadBytes: 1200 }),
  observeColorArq({
    channels: 3,
    count: 18,
    steps: 30,
    rttMs: 400,
    stepMs: 40,
    mtu: 1200,
    payloadBytes: 1200,
    drop: (step, channel) => step < 8 && channel === 1,
  }),
].map((row) => ({
  ...row,
  withinCapacity: row.appGoodputBps <= row.capacityBps * 1.25,
  note: "ARQ window model. opticalBer and workerLimit are null here on purpose.",
}));

const report = {
  measuredAt: new Date().toISOString(),
  host: `${os.cpus()[0]?.model ?? "unknown"} / node ${process.version}`,
  kind: "synthetic",
  camera: false,
  rows,
  skipped,
  zxing: zxingRows,
  schedule,
  arq,
  heapMiB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
};

writeFileSync(new URL("./results/color-load.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(`wrote ${rows.length} rows, schedule symbol ${symbolMs.toFixed(2)} ms`);

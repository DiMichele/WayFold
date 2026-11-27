// Optical acquisition experiments. Synthetic frames, not a camera.
// Integer module scale, fractional resampling, motion smear, mixed frames,
// and the concurrent ROI grab (full frame vs one union vs two bands vs four crops).
//
//   node --experimental-strip-types --no-warnings bench/optics.mjs
import "../tests/imagedata-polyfill.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { readBarcodes } from "zxing-wasm/reader";
import { legacyDecode } from "../receive/decode-core.ts";
import { planGrabs } from "../receive/roi.ts";
import { mixFrames, renderModules, senderFrame, smearHorizontal } from "./synth.mjs";

const RESULTS = new URL("./results/", import.meta.url);
mkdirSync(RESULTS, { recursive: true });
const read = (img, opts) => readBarcodes(img, opts);
const now = () => performance.now();
const hex = (b) => Buffer.from(b).toString("hex");

function score(found, frame) {
  const want = new Set(frame.bytes.map(hex));
  let ok = 0;
  for (const s of found) if (want.has(hex(s))) ok++;
  return ok / frame.bytes.length;
}

async function timed(fn) {
  const t0 = now();
  const r = await fn();
  return { r, ms: now() - t0 };
}

const warm = senderFrame(800, "L", 1, 1);
const warmImg = renderModules(warm.scr, { ppm: 3 });
if (warmImg) await legacyDecode(read, warmImg.data, warmImg.width, warmImg.height);

const rows = [];
async function once(label, frame, img) {
  const { r, ms } = await timed(() => legacyDecode(read, img.data, img.width, img.height));
  const success = +score(r, frame).toFixed(3);
  rows.push({ ...label, success, ms: +ms.toFixed(1) });
  console.log(`${label.kind} ${label.payload}B ${label.grid}x ppm ${label.ppm ?? "-"}: ${(success * 100).toFixed(0)}% ${ms.toFixed(0)}ms`);
}

const PAYLOADS = [800, 1200, 1850, 2331];
const GRIDS = [1, 2, 4];
const PPMS = [2, 3, 4, 5];

for (const payload of PAYLOADS) {
  for (const grid of GRIDS) {
    const frame = senderFrame(payload, "L", grid, 5);
    if (!frame) continue;
    for (const ppm of PPMS) {
      const img = renderModules(frame.scr, { ppm, sample: "nearest" });
      if (!img) {
        rows.push({ kind: "integer", payload, grid, ppm, success: null, ms: null, fit: false });
        continue;
      }
      await once({ kind: "integer", payload, grid, ppm, fit: true }, frame, img);
    }
  }
}

for (const grid of [1, 4]) {
  const frame = senderFrame(1850, "L", grid, 6);
  for (const sample of ["nearest", "linear"]) {
    const img = renderModules(frame.scr, { ppm: 2.5, sample });
    if (!img) continue;
    await once({ kind: `scale-${sample}`, payload: 1850, grid, ppm: 2.5 }, frame, img);
  }
  for (const radius of [2, 6]) {
    const sharp = renderModules(frame.scr, { ppm: 4, sample: "nearest" });
    if (!sharp) continue;
    await once({ kind: `smear-${radius}px`, payload: 1850, grid, ppm: 4 }, frame, smearHorizontal(sharp, radius));
  }
}

const a = senderFrame(1850, "L", 1, 7);
const b = senderFrame(1850, "L", 1, 8);
const ia = renderModules(a.scr, { ppm: 4 });
const ib = renderModules(b.scr, { ppm: 4 });
if (ia && ib) {
  await once({ kind: "mixed-blend", payload: 1850, grid: 1, ppm: 4 }, a, mixFrames(ia, ib, "blend", 0.5));
  await once({ kind: "mixed-rolling", payload: 1850, grid: 1, ppm: 4 }, a, mixFrames(ia, ib, "rolling", 0.5));
}

const quad = senderFrame(1850, "L", 4, 9);
const quadImg = quad ? renderModules(quad.scr, { ppm: 3 }) : null;
let pipeline = null;
if (quad && quadImg) {
  const boxes = quad.scr.cells.map((c) => {
    const ppm = 3;
    const ox = Math.floor((quadImg.width - quadImg.screenW) / 2);
    const oy = Math.floor((quadImg.height - quadImg.screenH) / 2);
    const pad = 8;
    return {
      x: ox + c.x * ppm - pad,
      y: oy + c.y * ppm - pad,
      w: c.size * ppm + pad * 2,
      h: c.size * ppm + pad * 2,
    };
  });
  const crop = (rect) => {
    const t0 = now();
    const data = new Uint8ClampedArray(rect.w * rect.h * 4);
    for (let y = 0; y < rect.h; y++) {
      const src = ((rect.y + y) * quadImg.width + rect.x) * 4;
      data.set(quadImg.data.subarray(src, src + rect.w * 4), y * rect.w * 4);
    }
    return { data, ms: now() - t0, w: rect.w, h: rect.h };
  };
  const decodeJobs = async (jobs) => {
    const extracts = jobs.map((j) => crop(j.rect));
    const decodes = [];
    for (let i = 0; i < jobs.length; i++) {
      const img = extracts[i];
      const { r, ms } = await timed(() => legacyDecode(read, img.data, img.w, img.h));
      decodes.push({ ms, symbols: r.length });
    }
    const pixels = jobs.reduce((n, j) => n + j.rect.w * j.rect.h, 0);
    return {
      jobs: jobs.length,
      pixels,
      extractMs: +Math.max(...extracts.map((e) => e.ms)).toFixed(2),
      decodeSumMs: +decodes.reduce((n, d) => n + d.ms, 0).toFixed(1),
      slowestDecodeMs: +Math.max(...decodes.map((d) => d.ms)).toFixed(1),
      symbols: decodes.reduce((n, d) => n + d.symbols, 0),
    };
  };
  const full = await decodeJobs(planGrabs(false, false, boxes, quadImg.width, quadImg.height, 4));
  const one = await decodeJobs(planGrabs(true, false, boxes, quadImg.width, quadImg.height, 1));
  const two = await decodeJobs(planGrabs(true, false, boxes, quadImg.width, quadImg.height, 2));
  const four = await decodeJobs(planGrabs(true, false, boxes, quadImg.width, quadImg.height, 4));
  pipeline = {
    note: "Synthetic. slowestDecodeMs is the wall time if each job has its own worker. extractMs is the copy, not a camera getImageData.",
    full, oneWorker: one, twoWorkers: two, fourWorkers: four,
  };
  console.log(`pipeline full ${full.pixels}px decode ${full.slowestDecodeMs}ms · 2 worker ${two.pixels}px slowest ${two.slowestDecodeMs}ms · 4 worker ${four.pixels}px slowest ${four.slowestDecodeMs}ms`);
}

writeFileSync(new URL("optics.json", RESULTS), JSON.stringify({
  units: { "B/s": "bytes/s", "kB/s": "bytes/s / 1000" },
  note: "Synthetic sensor. Not a camera measurement. Defaults are unchanged.",
  rows, pipeline,
}, null, 1));

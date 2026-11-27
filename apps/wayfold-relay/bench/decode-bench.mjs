// Synthetic decode benchmark, run in Node with the same zxing-wasm build the
// app ships. Stages are progressive: screen (clean codes, every decode config),
// model (FPS, camera rate and workers folded in), stress (degraded optics on the
// selected configs) and variants (decoder strategies on the same frames).
//
//   node --experimental-strip-types --no-warnings bench/decode-bench.mjs screen
//   ... stress | variants | budget
import "../tests/imagedata-polyfill.mjs";
import os from "node:os";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { readBarcodes } from "zxing-wasm/reader";
import { FAST_OPTS, PassCosts, legacyDecode, plannedDecode } from "../receive/decode-core.ts";
import { boxesFromQuads } from "../receive/roi.ts";
import { LTDecoder, LTEncoder } from "../shared/fountain.ts";
import { DEGRADATIONS, mixFrames, renderCamera, senderFrame } from "./synth.mjs";

const RESULTS = new URL("./results/", import.meta.url);
mkdirSync(RESULTS, { recursive: true });
const save = (name, data) => writeFileSync(new URL(name, RESULTS), JSON.stringify(data, null, 1));
const load = (name) => JSON.parse(readFileSync(new URL(name, RESULTS), "utf8"));
const read = (img, opts) => readBarcodes(img, opts);
const now = () => performance.now();
const hex = (b) => Buffer.from(b).toString("hex");
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};
const p95 = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : NaN;
};
const machine = { cpu: os.cpus()[0]?.model, cores: os.cpus().length, node: process.version, platform: process.platform };

const HEADER = 20;
const PAYLOADS = [800, 1200, 1850, 2331, 2900];
const ECCS = ["L", "M", "Q"];
const CAMS = [960, 1280, 1920, 2560];
const GRIDS = [1, 2, 3, 4];
const TX_FPS = [8, 15, 20, 24, 30, 40, 60];
const CAM_FPS = [30, 60];
const WORKERS = [1, 2, 3, 4];

function score(found, frame) {
  const want = new Set(frame.bytes.map(hex));
  let ok = 0;
  let wrong = 0;
  for (const s of found) {
    if (want.has(hex(s))) ok++;
    else wrong++;
  }
  return { ok, wrong };
}

async function timed(fn) {
  const t0 = now();
  const r = await fn();
  return { r, ms: now() - t0 };
}

// --- fountain cost of a given symbol loss ---------------------------------

const ltCache = new Map();
/** Symbols sent per source block until the carousel completes, at this loss rate. */
function ltRatio(loss) {
  const key = Math.round(loss * 20) / 20;
  if (ltCache.has(key)) return ltCache.get(key);
  const k = 150;
  const blockLen = 64;
  let total = 0;
  const runs = 4;
  for (let run = 0; run < runs; run++) {
    const payload = new Uint8Array(k * blockLen);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + run) & 255;
    const enc = new LTEncoder(payload, blockLen, 100 + run);
    const dec = new LTDecoder(enc.k, blockLen, 100 + run, payload.length);
    let x = (run + 1) * 2654435761;
    let sent = 0;
    for (let seq = 0; !dec.isComplete && seq < k * 200; seq++) {
      sent++;
      x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + seq) >>> 0;
      if (x / 4294967296 < key) continue;
      dec.addFrame(seq, enc.encode(seq));
    }
    total += dec.isComplete ? sent / k : Infinity;
  }
  const ratio = total / runs;
  ltCache.set(key, ratio);
  return ratio;
}

// --- stage 1: screening ----------------------------------------------------

async function screen() {
  const rows = [];
  let excluded = 0;
  for (const payload of PAYLOADS) {
    for (const ecc of ECCS) {
      for (const grid of GRIDS) {
        const frames = [];
        for (const seed of [1, 2]) {
          const f = senderFrame(payload, ecc, grid, seed);
          if (!f) break;
          frames.push(f);
        }
        if (frames.length < 2) {
          excluded += CAMS.length;
          continue;
        }
        for (const camW of CAMS) {
          const ms = [];
          let ok = 0;
          let wrong = 0;
          for (const [i, f] of frames.entries()) {
            const cam = renderCamera(f.scr, { camW, seed: i + 1 });
            const { r, ms: t } = await timed(() => legacyDecode(read, cam.data, cam.width, cam.height));
            const s = score(r, f);
            ok += s.ok;
            wrong += s.wrong;
            ms.push(t);
          }
          const camH = Math.round((camW * 3) / 4);
          const pxPerModule = (0.7 * camH) / frames[0].scr.h;
          const row = {
            payload, ecc, grid, camW, version: frames[0].version,
            pxPerModule: +pxPerModule.toFixed(2),
            success: ok / (grid * frames.length), wrong,
            ms: +median(ms).toFixed(1), msMax: +Math.max(...ms).toFixed(1),
          };
          rows.push(row);
          process.stdout.write(`${payload}B ${ecc} ${grid}x ${camW}: ${(row.success * 100).toFixed(0)}% ${row.ms}ms\n`);
        }
      }
    }
  }
  save("screen.json", { machine, excluded, rows });
  model(rows);
}

// --- stage 2: model --------------------------------------------------------

function modelRow(row, txFps, camFps, workers) {
  const decodesPerSec = Math.min(camFps, (workers * 1000) / row.ms);
  const captureFrac = Math.min(1, decodesPerSec / txFps);
  const delivery = captureFrac * row.success;
  const blockLen = row.payload - HEADER;
  const optical = (txFps * row.grid * delivery * blockLen) / 1024;
  const ratio = delivery > 0 ? ltRatio(1 - delivery) : Infinity;
  const fountain = Number.isFinite(ratio) ? (txFps * row.grid * blockLen) / ratio / 1024 : 0;
  return { ...row, txFps, camFps, workers, decodesPerSec: +decodesPerSec.toFixed(1), delivery: +delivery.toFixed(3), opticalKBs: +optical.toFixed(1), fountainKBs: +fountain.toFixed(1) };
}

function model(rows = load("screen.json").rows) {
  const all = [];
  for (const row of rows) {
    if (row.success === 0) continue;
    for (const txFps of TX_FPS) for (const camFps of CAM_FPS) for (const workers of WORKERS) all.push(modelRow(row, txFps, camFps, workers));
  }
  all.sort((a, b) => b.fountainKBs - a.fountainKBs);
  const total = PAYLOADS.length * ECCS.length * CAMS.length * GRIDS.length * TX_FPS.length * CAM_FPS.length * WORKERS.length;
  // A config only stays if its decode was clean: wrong bytes are a reject, not a loss.
  const viable = all.filter((r) => r.wrong === 0 && r.success >= 0.95);
  const seen = new Set();
  const selected = [];
  for (const r of viable) {
    const key = `${r.payload}-${r.ecc}-${r.grid}-${r.camW}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(r);
    if (selected.length >= 8) break;
  }
  const defaults = all.filter((r) => r.payload === 1850 && r.ecc === "L" && r.grid === 1 && r.camW === 1280 && r.txFps === 24 && r.camFps === 30 && r.workers === 2);
  save("model.json", { machine, cartesian: total, modelled: all.length, top: all.slice(0, 40), selected, defaults });
  console.log(`model: ${total} combinazioni nel prodotto, ${all.length} valutate, ${selected.length} selezionate`);
  for (const r of selected) console.log(`  ${r.payload}B ${r.ecc} ${r.grid}x cam${r.camW} tx${r.txFps} cam${r.camFps}fps w${r.workers}: ${r.fountainKBs} kB/s (decode ${r.ms} ms)`);
  for (const r of defaults) console.log(`  default: ${r.fountainKBs} kB/s`);
}

// --- stage 3: stress -------------------------------------------------------

function stressCases() {
  const { selected } = load("model.json");
  const configs = selected.map((r) => ({ payload: r.payload, ecc: r.ecc, grid: r.grid, camW: r.camW }));
  configs.push({ payload: 1850, ecc: "L", grid: 1, camW: 1280, base: true });
  const seen = new Set();
  return configs.filter((c) => {
    const k = `${c.payload}-${c.ecc}-${c.grid}-${c.camW}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function degradedFrames(f, f2, camW, seeds = [1, 2]) {
  const out = [];
  for (const [name, d] of Object.entries(DEGRADATIONS)) {
    for (const seed of seeds) out.push({ name, cam: renderCamera(f.scr, { camW, seed, ...d }), frame: f });
  }
  const a = renderCamera(f.scr, { camW, seed: 3 });
  const b = renderCamera(f2.scr, { camW, seed: 4 });
  out.push({ name: "mixed-blend", cam: mixFrames(a, b, "blend", 0.35), frame: f });
  out.push({ name: "mixed-rolling", cam: mixFrames(a, b, "rolling", 0.5), frame: f });
  return out;
}

async function stress() {
  const rows = [];
  for (const c of stressCases()) {
    const f = senderFrame(c.payload, c.ecc, c.grid, 11);
    const f2 = senderFrame(c.payload, c.ecc, c.grid, 12);
    const byName = new Map();
    for (const { name, cam, frame } of degradedFrames(f, f2, c.camW)) {
      const { r, ms } = await timed(() => legacyDecode(read, cam.data, cam.width, cam.height));
      const s = score(r, frame);
      const acc = byName.get(name) ?? { ok: 0, want: 0, wrong: 0, ms: [] };
      acc.ok += s.ok;
      acc.wrong += s.wrong;
      acc.want += frame.bytes.length;
      acc.ms.push(ms);
      byName.set(name, acc);
    }
    for (const [name, a] of byName) {
      rows.push({ ...c, degradation: name, success: +(a.ok / a.want).toFixed(3), wrong: a.wrong, ms: +median(a.ms).toFixed(1) });
    }
    const mean = [...byName.values()].reduce((s, a) => s + a.ok / a.want, 0) / byName.size;
    console.log(`${c.payload}B ${c.ecc} ${c.grid}x cam${c.camW}${c.base ? " (default)" : ""}: successo medio ${(mean * 100).toFixed(0)}%`);
  }
  save("stress.json", { machine, rows });
}

// --- stage 4: decoder variants --------------------------------------------

const VARIANT_CONFIGS = [
  { payload: 1850, ecc: "L", grid: 1, camW: 1280 },
  { payload: 1200, ecc: "L", grid: 2, camW: 1280 },
  { payload: 800, ecc: "L", grid: 3, camW: 1280 },
  { payload: 800, ecc: "L", grid: 4, camW: 1280 },
];
const VARIANT_DEGRADATIONS = ["clean", "blur1", "perspective", "motion", "noise", "dark", "glare", "far"];

const FAST_HARDER = { ...FAST_OPTS, tryHarder: true };

function variants(frame, cam) {
  const rects = boxesFromQuads(cam.quads, cam.width, cam.height);
  const base = { pixels: cam.data, w: cam.width, h: cam.height, fast: false, mem: false, gray: false, expected: 0, rects: null, budgetMs: Infinity, startedAt: 0, now, costs: new PassCosts() };
  const grid = frame.bytes.length;
  return {
    legacy: () => legacyDecode(read, cam.data, cam.width, cam.height),
    planned: () => plannedDecode(read, { ...base }),
    mem: () => plannedDecode(read, { ...base, mem: true }),
    gray: () => plannedDecode(read, { ...base, gray: true }),
    fast: () => plannedDecode(read, { ...base, fast: true, mem: true }),
    fastHarder: () => plannedDecode(read, { ...base, fast: true, mem: true, fastOpts: FAST_HARDER }),
    fastLayout: () => plannedDecode(read, { ...base, fast: true, mem: true, expected: grid, rects }),
    fastHarderLayout: () => plannedDecode(read, { ...base, fast: true, mem: true, expected: grid, rects, fastOpts: FAST_HARDER }),
    roiUnion: async () => {
      // Early crop: only the union of the boxes leaves the camera frame.
      const u = union(rects);
      const crop = cropOf(cam, u);
      const local = rects.map((r) => ({ x: r.x - u.x, y: r.y - u.y, w: r.w, h: r.h }));
      return plannedDecode(read, { ...base, pixels: crop.data, w: crop.width, h: crop.height, fast: true, mem: true, expected: grid, rects: local });
    },
    roiSeparate: async () => {
      // One decode per box, as if each went to its own worker.
      const all = { symbols: [], passes: [], perBoxMs: [] };
      for (const r of rects) {
        const crop = cropOf(cam, r);
        const t0 = now();
        const o = await plannedDecode(read, { ...base, pixels: crop.data, w: crop.width, h: crop.height, fast: true, mem: true, expected: 1, rects: null });
        all.perBoxMs.push(now() - t0);
        all.symbols.push(...o.symbols);
        all.passes.push(...o.passes);
      }
      return all;
    },
  };
}

function union(rects) {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

function cropOf(cam, r) {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const src = ((r.y + y) * cam.width + r.x) * 4;
    out.set(cam.data.subarray(src, src + r.w * 4), y * r.w * 4);
  }
  return { data: out, width: r.w, height: r.h };
}

async function variantsStage() {
  const rows = [];
  for (const c of VARIANT_CONFIGS) {
    const frames = [11, 12, 13].map((seed) => senderFrame(c.payload, c.ecc, c.grid, seed));
    for (const dname of VARIANT_DEGRADATIONS) {
      const acc = new Map();
      for (const [i, f] of frames.entries()) {
        const cam = renderCamera(f.scr, { camW: c.camW, seed: i + 1, ...DEGRADATIONS[dname] });
        for (const [name, fn] of Object.entries(variants(f, cam))) {
          await fn(); // warm the code path on this frame size
          const { r, ms } = await timed(fn);
          const symbols = Array.isArray(r) ? r : r.symbols;
          const s = score(symbols, f);
          const a = acc.get(name) ?? { ok: 0, want: 0, wrong: 0, ms: [], passes: 0, boxMax: [] };
          a.ok += s.ok;
          a.wrong += s.wrong;
          a.want += f.bytes.length;
          a.ms.push(ms);
          a.passes += Array.isArray(r) ? 0 : r.passes.length;
          if (r.perBoxMs) a.boxMax.push(Math.max(...r.perBoxMs));
          acc.set(name, a);
        }
      }
      for (const [name, a] of acc) {
        rows.push({
          ...c, degradation: dname, variant: name,
          success: +(a.ok / a.want).toFixed(3), wrong: a.wrong,
          ms: +median(a.ms).toFixed(1), msP95: +p95(a.ms).toFixed(1),
          passes: +(a.passes / frames.length).toFixed(1),
          ...(a.boxMax.length ? { slowestBoxMs: +median(a.boxMax).toFixed(1) } : {}),
        });
      }
      const line = [...acc.entries()].map(([n, a]) => `${n} ${((a.ok / a.want) * 100).toFixed(0)}%/${median(a.ms).toFixed(0)}ms`).join("  ");
      console.log(`${c.grid}x ${c.payload}B ${dname}: ${line}`);
    }
  }
  save("variants.json", { machine, rows });
}

// --- stage 5: budget ---------------------------------------------------------

/** Budgets in camera periods; one worker sees a frame stream and learns pass costs. */
async function budgetStage() {
  const period = 1000 / 30;
  const rows = [];
  for (const c of VARIANT_CONFIGS.slice(1)) {
    const cams = [];
    for (const seed of [21, 22, 23, 24]) {
      const f = senderFrame(c.payload, c.ecc, c.grid, seed);
      for (const d of ["clean", "blur1", "motion", "dark", "perspective"]) {
        cams.push({ f, cam: renderCamera(f.scr, { camW: c.camW, seed, ...DEGRADATIONS[d] }) });
      }
    }
    for (const mult of [0.5, 1, 1.5, 2, Infinity]) {
      const costs = new PassCosts();
      let ok = 0;
      let want = 0;
      let wrong = 0;
      let skipped = 0;
      const ms = [];
      for (const [i, { f, cam }] of cams.entries()) {
        const rects = boxesFromQuads(cam.quads, cam.width, cam.height);
        const t0 = now();
        const o = await plannedDecode(read, {
          pixels: cam.data, w: cam.width, h: cam.height, fast: true, mem: true, gray: false,
          expected: c.grid, rects, budgetMs: mult * period, startedAt: t0, now, costs,
        });
        if (i < 2) continue; // costs are still being learned
        ms.push(now() - t0);
        const s = score(o.symbols, f);
        ok += s.ok;
        wrong += s.wrong;
        want += f.bytes.length;
        skipped += o.skipped;
      }
      const meanMs = ms.reduce((a, b) => a + b, 0) / ms.length;
      const perDecode = ok / ms.length;
      // One worker's symbol rate; workers multiply it until the camera rate caps it.
      const symbolsPerSec = (w) => Math.min(30 / 1, (w * 1000) / meanMs) * perDecode;
      rows.push({
        ...c, budget: Number.isFinite(mult) ? mult : "none",
        success: +(ok / want).toFixed(3), wrong, skippedPasses: skipped,
        meanMs: +meanMs.toFixed(1), p95Ms: +p95(ms).toFixed(1),
        symbolsPerDecode: +perDecode.toFixed(2),
        symbolsPerSec1w: +symbolsPerSec(1).toFixed(1), symbolsPerSec2w: +symbolsPerSec(2).toFixed(1), symbolsPerSec4w: +symbolsPerSec(4).toFixed(1),
      });
      console.log(`${c.grid}x budget ${mult}: ${((ok / want) * 100).toFixed(0)}% ${meanMs.toFixed(0)}ms medi, ${skipped} passi saltati, 1w ${symbolsPerSec(1).toFixed(1)} QR/s`);
    }
  }
  save("budget.json", { machine, period, rows });
}

const stage = process.argv[2] ?? "screen";
if (stage === "screen") await screen();
else if (stage === "model") model();
else if (stage === "stress") {
  if (!existsSync(new URL("model.json", RESULTS))) await screen();
  await stress();
} else if (stage === "variants") await variantsStage();
else if (stage === "budget") await budgetStage();

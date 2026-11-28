// Separate mem and gray on synthetic frames. Times include the decoder.
// convertMs is the luminance + PGM cost measured on its own, not added twice.
//
//   node --experimental-strip-types --no-warnings bench/mem-gray.mjs
import "../tests/imagedata-polyfill.mjs";
import os from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { readBarcodes } from "zxing-wasm/reader";
import { PassCosts, lumaToPgm, plannedDecode, rgbaToLuma } from "../receive/decode-core.ts";
import { renderCamera, senderFrame } from "./synth.mjs";

const RESULTS = new URL("./results/", import.meta.url);
mkdirSync(RESULTS, { recursive: true });
const read = (img, opts) => readBarcodes(img, opts);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? 0;
};

const flags = [
  { name: "rgba-clone", mem: false, gray: false },
  { name: "mem", mem: true, gray: false },
  { name: "gray", mem: false, gray: true },
  { name: "mem+gray", mem: true, gray: true },
];
const configs = [
  { payload: 1850, ecc: "L", grid: 1, camW: 1280 },
  { payload: 800, ecc: "L", grid: 4, camW: 1280 },
];

function convertMs(cam) {
  const t0 = performance.now();
  const lum = rgbaToLuma(cam.data, cam.width, cam.height);
  lumaToPgm(lum, cam.width, cam.height);
  return performance.now() - t0;
}

async function decodeOnce(cam, flag) {
  const t0 = performance.now();
  const out = await plannedDecode(read, {
    pixels: cam.data,
    w: cam.width,
    h: cam.height,
    fast: false,
    mem: flag.mem,
    gray: flag.gray,
    expected: 0,
    rects: null,
    budgetMs: Infinity,
    startedAt: t0,
    now: () => performance.now(),
    costs: new PassCosts(),
  });
  return { ms: performance.now() - t0, symbols: out.symbols.length };
}

const warm = senderFrame(800, "L", 1, 1);
const warmCam = renderCamera(warm.scr, { camW: 640 });
await decodeOnce(warmCam, flags[0]);

const rows = [];
for (const config of configs) {
  const frame = senderFrame(config.payload, config.ecc, config.grid, 4);
  const cam = renderCamera(frame.scr, { camW: config.camW });
  const convert = [];
  for (let i = 0; i < 5; i++) convert.push(convertMs(cam));
  for (const flag of flags) {
    await decodeOnce(cam, flag);
    const samples = [];
    let symbols = 0;
    for (let i = 0; i < 5; i++) {
      const row = await decodeOnce(cam, flag);
      samples.push(row.ms);
      symbols = row.symbols;
    }
    const record = {
      ...config,
      variant: flag.name,
      symbols,
      want: frame.bytes.length,
      decodeMs: +median(samples).toFixed(1),
      convertMs: flag.gray ? +median(convert).toFixed(1) : 0,
    };
    rows.push(record);
    console.log(
      `${config.grid}x ${config.payload}B ${flag.name}: decode ${record.decodeMs} ms, convert ${record.convertMs} ms, symbols ${symbols}/${frame.bytes.length}`,
    );
  }
}

writeFileSync(
  new URL("mem-gray.json", RESULTS),
  JSON.stringify(
    {
      machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, node: process.version, platform: process.platform },
      note: "Synthetic camera frames. decodeMs is the full plannedDecode call. convertMs is rgbaToLuma + lumaToPgm measured beside it, and is already inside decodeMs when gray is on. Not a camera measurement.",
      rows,
    },
    null,
    1,
  ),
);

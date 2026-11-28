// Measured main-thread split cost and real worker decode. Not a camera measurement.
//   node --experimental-strip-types --no-warnings bench/color-profile.mjs
import "../tests/imagedata-polyfill.mjs";
import { Worker } from "node:worker_threads";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { encodePayloads, recoverRaster } from "../color/engine.ts";
import { alignMatrices } from "../color/matrices.ts";
import { observeColorArq } from "../color/arq-observe.ts";
import { readBarcodes } from "zxing-wasm/reader";

const outDir = new URL("./results/", import.meta.url);
mkdirSync(outDir, { recursive: true });

function bytes(n, seed) {
  const out = new Uint8Array(n);
  let x = seed;
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

function payloads(profile, n, seed) {
  const count = profile === "rgb3" ? 3 : 2;
  return Array.from({ length: count }, (_, i) => bytes(n, seed + i));
}

class DecodePool {
  constructor(size) {
    this.idle = [];
    this.queue = [];
    this.nextId = 1;
    this.pending = new Map();
    this.workers = Array.from({ length: size }, () => new Worker(new URL("./zxing-worker.mjs", import.meta.url)));
    this.workers.forEach((worker, index) => {
      worker.on("message", (msg) => {
        const done = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        this.idle.push(index);
        done?.(msg.hex);
        this.#pump();
      });
      this.idle.push(index);
    });
  }

  decode(raster) {
    const copy = raster.data.buffer.slice(raster.data.byteOffset, raster.data.byteOffset + raster.data.byteLength);
    return new Promise((resolve) => {
      this.queue.push({ buf: copy, w: raster.width, h: raster.height, resolve });
      this.#pump();
    });
  }

  #pump() {
    while (this.idle.length && this.queue.length) {
      const index = this.idle.pop();
      const job = this.queue.shift();
      const id = this.nextId++;
      this.pending.set(id, job.resolve);
      this.workers[index].postMessage({ id, buf: job.buf, w: job.w, h: job.h }, [job.buf]);
    }
  }

  async close() {
    await Promise.all(this.workers.map((worker) => worker.terminate()));
  }
}

async function sequential(channels) {
  const t0 = performance.now();
  const hex = [];
  for (const channel of channels) {
    const hits = await readBarcodes(new ImageData(channel.data, channel.width, channel.height), {
      formats: ["QRCode"],
      tryHarder: true,
    });
    for (const hit of hits) if (hit.isValid && hit.bytes?.length) hex.push(Buffer.from(hit.bytes).toString("hex"));
  }
  return { ms: performance.now() - t0, hex };
}

async function parallel(pool, channels) {
  const t0 = performance.now();
  const lists = await Promise.all(channels.map((channel) => pool.decode(channel)));
  return { ms: performance.now() - t0, hex: lists.flat() };
}

const rows = [];
const sizes = [48, 400, 800, 1200, 1850, 2331];
for (const n of sizes) {
  const ecc = fits(n, "M") ? "M" : "L";
  const raw = payloads("rgb3", n, 20 + n);
  const encoded = encodePayloads(raw, ecc, "rgb3", "rgb", 4);
  const recovered = recoverRaster(encoded, "rgb3", "hybrid", "module", "rgb", [encoded.aligned.matrices]);
  const split = recovered.found[0]?.split;
  rows.push({
    bytes: n,
    ecc,
    located: recovered.geometry.length,
    processed: recovered.found.length,
    locateMs: +recovered.locateMs.toFixed(2),
    calMs: +(split?.calMs ?? 0).toFixed(2),
    splitMs: +(split?.splitMs ?? 0).toFixed(2),
    renderMs: +(split?.renderMs ?? 0).toFixed(2),
    allocBytes: split?.allocBytes ?? 0,
    ber: split?.ber ?? [],
    mainThreadMs: +(recovered.locateMs + (split?.calMs ?? 0) + (split?.splitMs ?? 0) + (split?.renderMs ?? 0)).toFixed(2),
  });
  console.log(`${n}B locate ${recovered.locateMs.toFixed(1)} split ${split?.splitMs.toFixed(1)} render ${split?.renderMs.toFixed(1)} alloc ${split?.allocBytes}`);
}

const pool2 = new DecodePool(2);
const pool4 = new DecodePool(4);
const warm = encodePayloads(payloads("rgb3", 16, 1), "L", "rgb3", "rgb", 4);
const warmSplit = recoverRaster(warm, "rgb3");
await sequential(warmSplit.found[0].channels);
await parallel(pool2, warmSplit.found[0].channels);
await parallel(pool4, warmSplit.found[0].channels);

const zxing = [];
for (const n of sizes) {
  const ecc = fits(n, "M") ? "M" : "L";
  const raw = payloads("rgb3", n, 20 + n);
  const want = new Set(raw.map((item) => Buffer.from(item).toString("hex")));
  const encoded = encodePayloads(raw, ecc, "rgb3", "rgb", 4);
  const recovered = recoverRaster(encoded, "rgb3", "hybrid", "module");
  const channels = recovered.found[0]?.channels ?? [];
  const alone = await sequential(channels);
  const two = await parallel(pool2, channels);
  const four = await parallel(pool4, channels);
  const intact = (hex) => want.size === new Set(hex).size && [...want].every((item) => hex.includes(item));
  const opticalBytes = intact(four.hex) ? n * channels.length : 0;
  zxing.push({
    bytes: n,
    ecc,
    channels: channels.length,
    ber: recovered.found[0]?.split.ber ?? [],
    zxingIntact: intact(four.hex),
    sequentialMs: +alone.ms.toFixed(1),
    workers2Ms: +two.ms.toFixed(1),
    workers4Ms: +four.ms.toFixed(1),
    nominalWindowBps: (12 * 1200) / 0.15,
    opticalGoodputBps: four.ms > 0 ? Math.round((opticalBytes * 1000) / four.ms) : 0,
    fountainGoodputBps: null,
    note: "opticalGoodputBps is decoded payload bytes over the measured worker wall time. It is not fountain or application goodput, and it is not channels x payload x fps.",
  });
  console.log(`zxing ${n}B intact ${intact(four.hex)} seq ${alone.ms.toFixed(0)} ms  2w ${two.ms.toFixed(0)}  4w ${four.ms.toFixed(0)}`);
}
await pool2.close();
await pool4.close();

const arq = observeColorArq({
  channels: 3,
  count: 36,
  steps: 30,
  paintMs: 66,
  forwardMs: 80,
  ackGenMs: 30,
  returnMs: 200,
  ackPaintMs: 66,
  mtu: 1200,
  payloadBytes: 1200,
});

const report = {
  measuredAt: new Date().toISOString(),
  host: `${os.cpus()[0]?.model ?? "unknown"} / node ${process.version}`,
  kind: "synthetic",
  camera: false,
  mainThread: rows,
  workers: zxing,
  arq: {
    ...arq,
    note: "Model with separate forward, ACK generation and return. prematureRepeats are hold-timer repeats, not losses. Protocol unchanged.",
  },
};
writeFileSync(new URL("./results/color-profile.json", import.meta.url), JSON.stringify(report, null, 2));
console.log("wrote color-profile.json");

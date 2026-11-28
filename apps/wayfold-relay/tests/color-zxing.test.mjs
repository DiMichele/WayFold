import "../tests/imagedata-polyfill.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readBarcodes } from "zxing-wasm/reader";
import { encodePayloads, recoverRaster } from "../color/engine.ts";

function bytes(n, seed) {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x & 255;
  }
  return out;
}

async function decode(raster) {
  const hits = await readBarcodes(new ImageData(raster.data, raster.width, raster.height), {
    formats: ["QRCode"],
    tryHarder: true,
  });
  return hits.filter((hit) => hit.isValid && hit.bytes?.length).map((hit) => new Uint8Array(hit.bytes));
}

test("ZXing reads each color channel as its own payload", async () => {
  const payloads = [bytes(40, 3), bytes(40, 8), bytes(40, 13)];
  const encoded = encodePayloads(payloads, "L", "rgb3", "rgb", 4);
  const recovered = recoverRaster(encoded, "rgb3", "hybrid", "module");
  assert.equal(recovered.found[0].channels.length, 3);
  const got = [];
  for (const channel of recovered.found[0].channels) got.push(...(await decode(channel)));
  const want = new Set(payloads.map((item) => Buffer.from(item).toString("hex")));
  for (const item of got) assert.ok(want.has(Buffer.from(item).toString("hex")));
  assert.equal(new Set(got.map((item) => Buffer.from(item).toString("hex"))).size, 3);
});

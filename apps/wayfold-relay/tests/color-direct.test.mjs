import "./imagedata-polyfill.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readBarcodes } from "zxing-wasm/reader";
import { directChannelImages } from "../color/direct.ts";
import { encodePayloads } from "../color/engine.ts";
import { colorFrameBytes } from "../shared/optical.ts";

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
  return hits.filter((hit) => hit.isValid && hit.bytes?.length).map((hit) => Buffer.from(hit.bytes).toString("hex"));
}

function keystone(src) {
  const w = src.width;
  const h = src.height;
  const dw = w + 8;
  const dh = h + 8;
  const data = new Uint8ClampedArray(dw * dh * 4);
  data.fill(255);
  const top = 0.84;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const v = (y - 4) / (h - 1);
      const u0 = (x - 4) / (w - 1);
      if (v < 0 || v > 1) continue;
      const scale = top + (1 - top) * v;
      const u = (u0 - (1 - scale) / 2) / scale;
      if (u < 0 || u > 1) continue;
      const sx = Math.round(u * (w - 1));
      const sy = Math.round(v * (h - 1));
      const s = (sy * w + sx) * 4;
      const d = (y * dw + x) * 4;
      data[d] = src.data[s];
      data[d + 1] = src.data[s + 1];
      data[d + 2] = src.data[s + 2];
      data[d + 3] = 255;
    }
  }
  return { data, width: dw, height: dh };
}

function dim(src) {
  const data = new Uint8ClampedArray(src.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round(data[i] * 0.72);
    data[i + 1] = Math.round(data[i + 1] * 0.78);
    data[i + 2] = Math.round(data[i + 2] * 0.7);
  }
  return { data, width: src.width, height: src.height };
}

async function roundtrip(profile, payloads, raster) {
  const planes = directChannelImages(raster, profile);
  assert.equal(planes.length, payloads.length);
  const got = new Set();
  for (const plane of planes) for (const hex of await decode(plane)) got.add(hex);
  for (const payload of payloads) assert.ok(got.has(Buffer.from(payload).toString("hex")), profile);
}

test("a camera-style split lets ZXing read Color 2 and RGB 3 without the frame locator", async () => {
  const color2 = [bytes(48, 4), bytes(48, 9)];
  const rgb3 = [bytes(40, 3), bytes(40, 8), bytes(40, 13)];
  const painted2 = encodePayloads(color2, "M", "color2", "rb", 4);
  const painted3 = encodePayloads(rgb3, "L", "rgb3", "rgb", 4);
  await roundtrip("color2", color2, painted2);
  await roundtrip("rgb3", rgb3, painted3);
  await roundtrip("color2", color2, dim(painted2));
  await roundtrip("rgb3", rgb3, keystone(painted3));
  await roundtrip("color2", color2, cameraTint(painted2));
});

test("RGB 3 still separates after a screen is photographed", async () => {
  const rgb3 = [bytes(36, 3), bytes(36, 8), bytes(36, 13)];
  const painted = encodePayloads(rgb3, "M", "rgb3", "rgb", 4);
  const data = new Uint8ClampedArray(painted.data);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    data[i] = Math.min(255, 22 + r * 0.7 + g * 0.05);
    data[i + 1] = Math.min(255, 20 + g * 0.58 + r * 0.04);
    data[i + 2] = Math.min(255, 18 + b * 0.5 + g * 0.05);
  }
  await roundtrip("rgb3", rgb3, { data, width: painted.width, height: painted.height });
});

test("a phone-sized color code still reads after camera blur", async () => {
  const n = colorFrameBytes(1850, 360, "M");
  assert.ok(n < 400, String(n));
  const payloads = [bytes(n, 4), bytes(n, 9)];
  const painted = cameraTint(encodePayloads(payloads, "M", "color2"));
  const cam = 420;
  const data = new Uint8ClampedArray(cam * cam * 4);
  const scale = (painted.width - 1) / cam;
  for (let y = 0; y < cam; y++) {
    for (let x = 0; x < cam; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const sx = Math.max(0, Math.min(painted.width - 1, Math.round((x + dx + 0.5) * scale)));
          const sy = Math.max(0, Math.min(painted.height - 1, Math.round((y + dy + 0.5) * scale)));
          const p = (sy * painted.width + sx) * 4;
          r += painted.data[p];
          g += painted.data[p + 1];
          b += painted.data[p + 2];
          count++;
        }
      }
      const d = (y * cam + x) * 4;
      data[d] = r / count;
      data[d + 1] = g / count;
      data[d + 2] = b / count;
      data[d + 3] = 255;
    }
  }
  await roundtrip("color2", payloads, { data, width: cam, height: cam });
});

function cameraTint(src) {
  const data = new Uint8ClampedArray(src.data);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 40) {
      data[i] = 42;
      data[i + 1] = 36;
      data[i + 2] = 34;
    } else if (max - min < 25) {
      data[i] = 251;
      data[i + 1] = 218;
      data[i + 2] = 182;
    } else if (r > b + 40 && r > g + 40) {
      data[i] = 176;
      data[i + 1] = 68;
      data[i + 2] = 70;
    } else if (b > r + 40 && b > g + 20) {
      data[i] = 72;
      data[i + 1] = 64;
      data[i + 2] = 148;
    }
  }
  return { data, width: src.width, height: src.height };
}

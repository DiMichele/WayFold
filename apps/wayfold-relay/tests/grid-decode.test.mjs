import "./imagedata-polyfill.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import { readBarcodes } from "zxing-wasm/reader";
import { cropRgbaRect, gridSliceRects } from "../receive/image-crop.ts";
import { QR_MARGIN, rasterizeQr } from "../shared/optical.ts";

function scaleNearest(src, factor) {
  const width = Math.max(1, Math.round(src.width * factor));
  const height = Math.max(1, Math.round(src.height * factor));
  const out = new ImageData(width, height);
  const from = src.data;
  const to = out.data;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / width));
      const s = (sy * src.width + sx) * 4;
      const d = (y * width + x) * 4;
      to[d] = from[s];
      to[d + 1] = from[s + 1];
      to[d + 2] = from[s + 2];
      to[d + 3] = from[s + 3];
    }
  }
  return out;
}

function compose(cells, cols, rows, gutter) {
  const cell = cells[0].width;
  const totalW = cell * cols + gutter * Math.max(0, cols - 1);
  const totalH = cell * rows + gutter * Math.max(0, rows - 1);
  const img = new ImageData(totalW, totalH);
  new Uint32Array(img.data.buffer).fill(0xffffffff);
  cells.forEach((src, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ox = col * (cell + gutter);
    const oy = row * (cell + gutter);
    for (let y = 0; y < cell; y++) {
      img.data.set(src.data.subarray(y * cell * 4, (y + 1) * cell * 4), ((oy + y) * totalW + ox) * 4);
    }
  });
  return img;
}

function qrOf(text) {
  const bytes = new TextEncoder().encode(text);
  const qr = QRCode.create([{ data: bytes, mode: "byte" }], { errorCorrectionLevel: "L" });
  return rasterizeQr(qr.modules.size, qr.modules.data, QR_MARGIN);
}

async function textsIn(img) {
  const hits = await readBarcodes(img, { formats: ["QRCode"], maxNumberOfSymbols: 4, tryHarder: true });
  return hits.filter((hit) => hit.isValid).map((hit) => hit.text);
}

async function textsFromSlices(img) {
  const found = new Set();
  for (const rect of gridSliceRects(img.width, img.height)) {
    const crop = cropRgbaRect(img.data, img.width, img.height, rect.x, rect.y, rect.w, rect.h);
    const view = new ImageData(crop.data, crop.width, crop.height);
    for (const text of await textsIn(view)) found.add(text);
  }
  return [...found];
}

test("a still 2-up and 4-up grid both decode", async () => {
  const two = scaleNearest(compose([qrOf("alpha-one"), qrOf("alpha-two")], 1, 2, 8), 3);
  const four = scaleNearest(
    compose([qrOf("beta-1"), qrOf("beta-2"), qrOf("beta-3"), qrOf("beta-4")], 2, 2, 8),
    3,
  );
  const twoFull = [...new Set(await textsIn(two))].sort();
  const fourFull = [...new Set(await textsIn(four))].sort();
  assert.deepEqual(twoFull, ["alpha-one", "alpha-two"]);
  assert.deepEqual(fourFull, ["beta-1", "beta-2", "beta-3", "beta-4"]);
  assert.deepEqual([...(await textsFromSlices(two))].sort(), ["alpha-one", "alpha-two"]);
  assert.deepEqual([...(await textsFromSlices(four))].sort(), ["beta-1", "beta-2", "beta-3", "beta-4"]);
});

function binaryQr(len, seed) {
  const data = new Uint8Array(len);
  for (let i = 0; i < len; i++) data[i] = (i * 13 + seed) & 255;
  const code = QRCode.create([{ data, mode: "byte" }], { errorCorrectionLevel: "L" });
  return { data, img: rasterizeQr(code.modules.size, code.modules.data, QR_MARGIN) };
}

function fit(src, maxW, maxH) {
  return scaleNearest(src, Math.min(maxW / src.width, maxH / src.height));
}

function placeCentered(src, camW, camH) {
  const img = new ImageData(camW, camH);
  img.data.fill(30);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  const ox = Math.floor((camW - src.width) / 2);
  const oy = Math.floor((camH - src.height) / 2);
  for (let y = 0; y < src.height; y++) {
    img.data.set(src.data.subarray(y * src.width * 4, (y + 1) * src.width * 4), ((oy + y) * camW + ox) * 4);
  }
  return img;
}

test("four coarse codes still decode when they fill under half the camera frame", async () => {
  const codes = [1, 2, 3, 4].map((seed) => binaryQr(1000, seed));
  const gutter = Math.max(8, Math.round(codes[0].img.width * 0.06));
  const grid = compose(codes.map((code) => code.img), 2, 2, gutter);
  const framed = placeCentered(fit(grid, Math.floor(1280 * 0.45), Math.floor(720 * 0.45)), 1280, 720);
  const hits = await readBarcodes(framed, {
    formats: ["QRCode"],
    maxNumberOfSymbols: 4,
    tryHarder: true,
    tryRotate: false,
    tryDownscale: true,
  });
  const got = new Set(hits.filter((hit) => hit.isValid && hit.bytes?.length).map((hit) => Buffer.from(hit.bytes).toString("hex")));
  const matched = codes.filter((code) => got.has(Buffer.from(code.data).toString("hex"))).length;
  assert.equal(matched, 4);
});

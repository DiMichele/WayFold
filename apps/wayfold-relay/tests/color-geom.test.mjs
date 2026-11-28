import "./imagedata-polyfill.mjs";
import assert from "node:assert/strict";
import test from "node:test";
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

function sampleBilinear(src, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const dx = x - x0;
  const dy = y - y0;
  const out = [0, 0, 0, 255];
  for (let oy = 0; oy < 2; oy++) {
    for (let ox = 0; ox < 2; ox++) {
      const xx = Math.max(0, Math.min(src.width - 1, x0 + ox));
      const yy = Math.max(0, Math.min(src.height - 1, y0 + oy));
      const w = (ox ? dx : 1 - dx) * (oy ? dy : 1 - dy);
      const i = (yy * src.width + xx) * 4;
      for (let c = 0; c < 3; c++) out[c] += src.data[i + c] * w;
    }
  }
  return out;
}

function resample(src, dw, dh, srcAt) {
  const data = new Uint8ClampedArray(dw * dh * 4);
  data.fill(255);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const p = srcAt(x + 0.5, y + 0.5);
      if (!p || p.x < 0 || p.y < 0 || p.x >= src.width || p.y >= src.height) continue;
      const px = sampleBilinear(src, p.x, p.y);
      const i = (y * dw + x) * 4;
      data[i] = px[0];
      data[i + 1] = px[1];
      data[i + 2] = px[2];
      data[i + 3] = 255;
    }
  }
  return { data, width: dw, height: dh };
}

function rotate(src, degrees) {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const w = src.width;
  const h = src.height;
  const dw = Math.ceil(w * Math.abs(c) + h * Math.abs(s)) + 8;
  const dh = Math.ceil(w * Math.abs(s) + h * Math.abs(c)) + 8;
  return resample(src, dw, dh, (x, y) => {
    const dx = x - dw / 2;
    const dy = y - dh / 2;
    return { x: c * dx + s * dy + w / 2, y: -s * dx + c * dy + h / 2 };
  });
}

function keystone(src, topScale) {
  const w = src.width;
  const h = src.height;
  const dw = w + 8;
  const dh = h + 8;
  const data = new Uint8ClampedArray(dw * dh * 4);
  data.fill(255);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const p = keystoneSrc(x + 0.5, y + 0.5, w, h, topScale);
      if (!p) continue;
      const sx = Math.round(p.x);
      const sy = Math.round(p.y);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
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

function keystoneSrc(x, y, w, h, topScale) {
    const v = (y - 4) / (h - 1);
    const u0 = (x - 4) / (w - 1);
    if (v < -0.02 || v > 1.02) return null;
    const scale = topScale + (1 - topScale) * Math.max(0, Math.min(1, v));
    const u = (u0 - (1 - scale) / 2) / scale;
    if (u < -0.02 || u > 1.02) return null;
    return { x: u * (w - 1), y: Math.max(0, Math.min(h - 1, v * (h - 1))) };
}

function shade(src) {
  const data = new Uint8ClampedArray(src.data);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const g = 0.58 + 0.42 * (x / src.width);
      const i = (y * src.width + x) * 4;
      data[i] = Math.round(data[i] * g);
      data[i + 1] = Math.round(data[i + 1] * g);
      data[i + 2] = Math.round(data[i + 2] * g);
    }
  }
  return { data, width: src.width, height: src.height };
}

function blur(src) {
  const data = new Uint8ClampedArray(src.width * src.height * 4);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.max(0, Math.min(src.width - 1, x + dx));
          const yy = Math.max(0, Math.min(src.height - 1, y + dy));
          const i = (yy * src.width + xx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
        }
      }
      const o = (y * src.width + x) * 4;
      data[o] = r / 9;
      data[o + 1] = g / 9;
      data[o + 2] = b / 9;
      data[o + 3] = 255;
    }
  }
  return { data, width: src.width, height: src.height };
}

function expectRecover(raster, encoded, label) {
  const recovered = recoverRaster(raster, "color2", "hybrid", "module", "rb", [encoded.aligned.matrices]);
  assert.equal(recovered.geometry.length, 1, label);
  assert.ok(recovered.found[0].split.ber.every((v) => v < 0.02), `${label} ${recovered.found[0].split.ber}`);
}

test("free rotation and uneven light keep the module grid", () => {
  const encoded = encodePayloads([bytes(48, 4), bytes(48, 9)], "M", "color2", "rb", 4);
  expectRecover(encoded, encoded, "clean");
  expectRecover(rotate(encoded, 18), encoded, "rotate 18");
  expectRecover(rotate(encoded, -27), encoded, "rotate -27");
  expectRecover(shade(encoded), encoded, "light");
});

test("a keystone is found from its sides, and a mild blur keeps the frame", () => {
  const encoded = encodePayloads([bytes(48, 4), bytes(48, 9)], "M", "color2", "rb", 4);
  const skewed = recoverRaster(keystone(encoded, 0.84), "color2", "hybrid", "module", "rb", [encoded.aligned.matrices]);
  assert.equal(skewed.geometry.length, 1);
  assert.equal(skewed.found.length, 1);
  const blurred = recoverRaster(blur(encoded), "color2", "hybrid", "module", "rb", [encoded.aligned.matrices]);
  assert.equal(blurred.geometry.length, 1);
  const worst = Math.max(...(blurred.found[0]?.split.ber ?? [1]));
  assert.ok(worst < 0.08, `blur ber ${worst}`);
});

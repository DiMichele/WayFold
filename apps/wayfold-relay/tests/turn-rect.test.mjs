import "./imagedata-polyfill.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { encodePayloads, recoverRaster } from "../color/engine.ts";
import { rotateRaster, sourceRectForTurn } from "../receive/frame-grab.ts";
import { rasterizeQr } from "../shared/optical.ts";
import { alignMatrices } from "../color/matrices.ts";

const TURNS = [90, 180, 270];
const INVERSE = { 90: 270, 180: 180, 270: 90 };

function pixel(data, w, x, y) {
  return data[(y * w + x) * 4];
}

function cropOf(src, sw, rect) {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const s = ((rect.y + y) * sw + (rect.x + x)) * 4;
      out.set(src.subarray(s, s + 4), (y * rect.w + x) * 4);
    }
  }
  return out;
}

test("an upright ROI is the same crop of the full turn, for 90, 180 and 270", () => {
  const vw = 9;
  const vh = 6;
  const src = new Uint8ClampedArray(vw * vh * 4);
  for (let y = 0; y < vh; y++) {
    for (let x = 0; x < vw; x++) {
      const i = (y * vw + x) * 4;
      src[i] = x * 20 + y;
      src[i + 3] = 255;
    }
  }
  for (const turn of TURNS) {
    const full = rotateRaster(src, vw, vh, turn);
    const rect = { x: 1, y: 1, w: 3, h: 2 };
    const mapped = sourceRectForTurn(rect, turn, vw, vh);
    assert.ok(mapped.x >= 0 && mapped.y >= 0);
    assert.ok(mapped.x + mapped.w <= vw && mapped.y + mapped.h <= vh);
    const upright = rotateRaster(cropOf(src, vw, mapped), mapped.w, mapped.h, turn);
    assert.equal(upright.width, rect.w);
    assert.equal(upright.height, rect.h);
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        assert.equal(pixel(upright.data, upright.width, x, y), pixel(full.data, full.width, rect.x + x, rect.y + y));
      }
    }
  }
});

test("Color 2, RGB 3 and Mono survive a full turn back to upright", () => {
  const payloads = {
    color2: [Uint8Array.of(1, 2, 3, 4), Uint8Array.of(5, 6, 7, 8)],
    rgb3: [Uint8Array.of(1, 2), Uint8Array.of(3, 4), Uint8Array.of(5, 6)],
  };
  for (const profile of ["color2", "rgb3"]) {
    const encoded = encodePayloads(payloads[profile], "L", profile, undefined, 3);
    for (const turn of TURNS) {
      const sensor = rotateRaster(encoded.data, encoded.width, encoded.height, INVERSE[turn]);
      const back = rotateRaster(sensor.data, sensor.width, sensor.height, turn);
      assert.equal(back.width, encoded.width);
      assert.equal(back.height, encoded.height);
      const recovered = recoverRaster(back, profile, "hybrid", "module", undefined, [encoded.aligned.matrices]);
      assert.equal(recovered.found.length, 1, `${profile} ${turn}`);
      assert.ok(recovered.found[0].split.ber.every((v) => v === 0), `${profile} ${turn}`);
    }
  }
  const mono = alignMatrices([Uint8Array.of(9, 8, 7)], "L");
  const img = rasterizeQr(mono.size, mono.matrices[0], 4);
  for (const turn of TURNS) {
    const sensor = rotateRaster(img.data, img.width, img.height, INVERSE[turn]);
    const back = rotateRaster(sensor.data, sensor.width, sensor.height, turn);
    assert.equal(Buffer.from(back.data).equals(Buffer.from(img.data)), true);
  }
});

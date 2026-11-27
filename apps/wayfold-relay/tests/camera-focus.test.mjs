import assert from "node:assert/strict";
import test from "node:test";
import {
  clamp01,
  pickCloseFocusDistance,
  pickQrZoom,
  chooseFocusMode,
  qrFocusAdvanced,
  qrFocusConstraintFallbacks,
  tapPointFromEvent,
  tapPointInVideoFrame,
  applyFirstSupportedConstraint,
  exposureAdvanced,
  hasFocusControl,
  shortestExposure,
  SHORT_EXPOSURE_S,
} from "../receive/camera.ts";
import { centerTileRects, cropRgbaCenter, cropRgbaRect, gridSliceRects } from "../receive/image-crop.ts";
import { laplacianVariance, sharpnessOfRgba } from "../receive/sharpness.ts";

test("clamp01 bounds and non-finite values", () => {
  assert.equal(clamp01(0.3), 0.3);
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(Number.NaN), 0.5);
});

test("close focus prefers ~28 cm when the range is in meters", () => {
  assert.equal(pickCloseFocusDistance({ min: 0.1, max: 10 }), 0.28);
});

test("close focus interpolates normalized 0–1 ranges toward near", () => {
  const d = pickCloseFocusDistance({ min: 0, max: 1 });
  assert.ok(d > 0.1 && d < 0.4);
});

test("zoom avoids ultra-wide and targets mild tele", () => {
  assert.equal(pickQrZoom({ min: 0.5, max: 8 }), 1.35);
  assert.equal(pickQrZoom({ min: 1, max: 8 }), 1.35);
  assert.equal(pickQrZoom({ min: 1, max: 1.05 }), null);
});

test("focus mode prefers continuous, then single-shot", () => {
  assert.equal(chooseFocusMode(["manual", "continuous"], "auto"), "continuous");
  assert.equal(chooseFocusMode(["single-shot"], "auto"), "single-shot");
  assert.equal(chooseFocusMode(["single-shot", "continuous"], "single-shot"), "single-shot");
  assert.equal(chooseFocusMode(["manual"], "auto"), undefined);
});

test("startup continuous omits fixed focusDistance", () => {
  const chain = qrFocusConstraintFallbacks(
    {
      focusMode: ["continuous", "single-shot"],
      focusDistance: { min: 0.1, max: 8 },
      zoom: { min: 1, max: 5 },
      pointsOfInterest: true,
    },
    { x: 0.4, y: 0.6 },
    "continuous",
    "startup",
  );
  assert.ok(chain.length >= 1);
  const first = chain[0].advanced[0];
  assert.equal(first.focusMode, "continuous");
  assert.equal(first.zoom, 1.35);
  assert.equal(first.focusDistance, undefined);
  assert.deepEqual(first.pointsOfInterest, [{ x: 0.4, y: 0.6 }]);
});

test("tap single-shot omits distance and zoom", () => {
  const advanced = qrFocusAdvanced(
    {
      focusMode: ["continuous", "single-shot"],
      focusDistance: { min: 0.1, max: 8 },
      zoom: { min: 1, max: 5 },
      pointsOfInterest: true,
    },
    { x: 0.2, y: 0.8 },
    "single-shot",
    "tap",
  );
  assert.equal(advanced.focusMode, "single-shot");
  assert.equal(advanced.zoom, undefined);
  assert.equal(advanced.focusDistance, undefined);
  assert.deepEqual(advanced.pointsOfInterest, [{ x: 0.2, y: 0.8 }]);
});

test("manual-only lenses still get a close distance", () => {
  const advanced = qrFocusAdvanced(
    { focusMode: ["manual"], focusDistance: { min: 0.1, max: 8 } },
    { x: 0.5, y: 0.5 },
    "auto",
    "startup",
  );
  assert.equal(advanced.focusMode, "manual");
  assert.equal(advanced.focusDistance, 0.28);
});

test("short exposure stays inside the device range and caps at 8 ms", () => {
  assert.equal(shortestExposure({ min: 0.02, max: 0.1 }), 0.02);
  assert.equal(shortestExposure({ min: 0.001, max: 0.05 }), SHORT_EXPOSURE_S);
});

test("continuous exposure does not set a shutter time", () => {
  const adv = exposureAdvanced(
    { exposureMode: ["continuous", "manual"], exposureTime: { min: 0.001, max: 0.05 } },
    "continuous",
  );
  assert.deepEqual(adv, { exposureMode: "continuous" });
  assert.equal(exposureAdvanced({ exposureMode: ["continuous"] }, "off"), null);
});

test("short exposure asks for manual time when that mode exists", () => {
  const adv = exposureAdvanced({ exposureMode: ["manual"], exposureTime: { min: 0.001, max: 0.05 } }, "short");
  assert.equal(adv.exposureMode, "manual");
  assert.ok(adv.exposureTime <= SHORT_EXPOSURE_S);
});

test("no capabilities yields an empty constraint chain", () => {
  assert.deepEqual(qrFocusAdvanced({}), null);
  assert.deepEqual(qrFocusConstraintFallbacks({}), []);
  assert.equal(hasFocusControl({}), false);
  assert.equal(hasFocusControl({ focusMode: ["continuous"] }), true);
});

test("tap point is normalized to the preview rectangle", () => {
  const pt = tapPointFromEvent(30, 70, { left: 10, top: 10, width: 100, height: 200 });
  assert.equal(pt.x, 0.2);
  assert.equal(pt.y, 0.3);
});

test("tap point accounts for contain letterboxing", () => {
  // Preview 200x100, video 100x100 → square centered with 50px side bars.
  const pt = tapPointInVideoFrame(100, 50, { left: 0, top: 0, width: 200, height: 100 }, 100, 100, "contain");
  assert.ok(Math.abs(pt.x - 0.5) < 0.02);
  assert.ok(Math.abs(pt.y - 0.5) < 0.02);
});

test("applyFirstSupportedConstraint uses the first non-throwing set", async () => {
  const tried = [];
  const track = {
    async applyConstraints(c) {
      tried.push(c);
      if (tried.length < 2) throw new Error("overconstrained");
    },
  };
  const ok = await applyFirstSupportedConstraint(track, [
    { advanced: [{ zoom: 9 }] },
    { advanced: [{ focusMode: "continuous" }] },
  ]);
  assert.equal(ok, true);
  assert.equal(tried.length, 2);
});

test("laplacian variance is higher on a sharp edge than a blur", () => {
  const w = 32;
  const h = 32;
  const sharp = new Uint8ClampedArray(w * h * 4);
  const soft = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = x < w / 2 ? 0 : 255;
      sharp[i] = sharp[i + 1] = sharp[i + 2] = v;
      sharp[i + 3] = 255;
      const softV = Math.round((x / (w - 1)) * 255);
      soft[i] = soft[i + 1] = soft[i + 2] = softV;
      soft[i + 3] = 255;
    }
  }
  const a = sharpnessOfRgba(sharp, w, h);
  const b = sharpnessOfRgba(soft, w, h);
  assert.ok(a > b * 2, `expected sharp ${a} >> soft ${b}`);
  assert.ok(laplacianVariance(new Uint8Array([0]), 1, 1) === 0);
});

test("center crop keeps the middle pixels", () => {
  const width = 40;
  const height = 40;
  const data = new Uint8ClampedArray(width * height * 4);
  data[(20 * width + 20) * 4] = 255;
  const cropped = cropRgbaCenter(data, width, height, 0.5);
  assert.equal(cropped.width, 20);
  assert.equal(cropped.height, 20);
  const cx = Math.floor((width - cropped.width) / 2);
  const cy = Math.floor((height - cropped.height) / 2);
  const dx = 20 - cx;
  const dy = 20 - cy;
  assert.equal(cropped.data[(dy * cropped.width + dx) * 4], 255);
});

test("a grid slice keeps the requested rectangle", () => {
  const width = 40;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  data[(4 * width + 30) * 4] = 180;
  const cropped = cropRgbaRect(data, width, height, 20, 0, 20, 10);
  assert.equal(cropped.width, 20);
  assert.equal(cropped.height, 10);
  assert.equal(cropped.data[(4 * 20 + 10) * 4], 180);
  const slices = gridSliceRects(100, 80);
  assert.equal(slices.length, 8);
  assert.equal(slices[0]?.h, 40);
  assert.equal(slices[4]?.w, 50);
  const tiles = centerTileRects(1000, 800);
  assert.equal(tiles.length, 4);
  const midX = 500;
  const midY = 400;
  const covering = tiles.filter((tile) => tile.x <= midX && tile.y <= midY && tile.x + tile.w >= midX && tile.y + tile.h >= midY);
  assert.ok(covering.length >= 1);
  for (const tile of tiles) {
    assert.ok(tile.x >= Math.floor((1000 - Math.floor(1000 * 0.72)) / 2));
    assert.ok(tile.x + tile.w <= 1000);
    assert.ok(tile.y + tile.h <= 800);
  }
});

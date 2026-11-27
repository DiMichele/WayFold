import assert from "node:assert/strict";
import test from "node:test";
import { linkHeadroom, pixelsPerModule } from "../receive/link-calibration.ts";
import { formatKiBps, toKBps, toKiBps } from "../shared/throughput.ts";

test("kB/s divides by 1000 and KiB/s divides by 1024", () => {
  const bytesPerSec = 4 * 1830 * 24;
  assert.equal(+(toKBps(bytesPerSec).toFixed(1)), 175.7);
  assert.equal(+(toKiBps(bytesPerSec).toFixed(1)), 171.6);
  assert.equal(formatKiBps(bytesPerSec), "171.6 KiB/s");
});

test("module span over the known module count is the calibration input", () => {
  const quad = {
    topLeft: { x: 10, y: 20 },
    topRight: { x: 160, y: 20 },
    bottomRight: { x: 160, y: 170 },
    bottomLeft: { x: 10, y: 170 },
  };
  assert.equal(pixelsPerModule(quad, 50), 3);
  assert.equal(linkHeadroom(3), "ok");
  assert.equal(linkHeadroom(2), "low");
  assert.equal(linkHeadroom(6), "wide");
});

import assert from "node:assert/strict";
import test from "node:test";
import { linkHeadroom, pixelsPerModule } from "../receive/link-calibration.ts";
import { formatBitrate, formatKBps, toKBps } from "../shared/throughput.ts";

test("screen rates use kB/s, and the optical network uses bits", () => {
  const bytesPerSec = 4 * 1830 * 24;
  assert.equal(+(toKBps(bytesPerSec).toFixed(1)), 175.7);
  assert.equal(formatKBps(bytesPerSec), "175.7 kB/s");
  assert.equal(formatKBps(400), "400 B/s");
  assert.equal(formatBitrate(10_000), "80.0 kbit/s");
  assert.equal(formatBitrate(bytesPerSec), "1.41 Mbit/s");
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

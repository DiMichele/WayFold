import assert from "node:assert/strict";
import test from "node:test";
import { isPrecompressedType, packEnvelope, parseEnvelope } from "../shared/envelope.ts";
import { LTDecoder, LTEncoder, frameComposition } from "../shared/fountain.ts";
import { frameBytesForGrid, colorFrameBytes, gridDims, gridHoldMs, normalizeGrid, symbolsFromWorker } from "../shared/optical.ts";

test("a clean sweep finishes in exactly k systematic frames", () => {
  const payload = new Uint8Array(5000);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 17 + 3) & 0xff;
  const encoder = new LTEncoder(payload, 200, 7);
  const decoder = new LTDecoder(encoder.k, 200, 7, payload.length);
  for (let seq = 0; seq < encoder.k; seq++) {
    assert.deepEqual(frameComposition(encoder.k, 7, seq), [seq]);
    decoder.addFrame(seq, encoder.encode(seq));
  }
  assert.equal(decoder.isComplete, true);
  assert.deepEqual(decoder.assemble(), payload);
});

test("dropped frames still rebuild the payload from later repairs", () => {
  const payload = new Uint8Array(2400);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 13) & 0xff;
  const encoder = new LTEncoder(payload, 180, 11);
  const decoder = new LTDecoder(encoder.k, 180, 11, payload.length);
  const limit = encoder.k * 6;
  for (let seq = 0; seq < limit && !decoder.isComplete; seq++) {
    if (seq % 3 === 0) continue;
    decoder.addFrame(seq, encoder.encode(seq));
  }
  assert.equal(decoder.isComplete, true);
  assert.deepEqual(decoder.assemble(), payload);
});

test("grid choices stay on the layouts the receiver can scan", () => {
  assert.deepEqual(gridDims(1), { cols: 1, rows: 1 });
  assert.deepEqual(gridDims(2), { cols: 1, rows: 2 });
  assert.deepEqual(gridDims(2, true), { cols: 2, rows: 1 });
  assert.deepEqual(gridDims(4), { cols: 2, rows: 2 });
  assert.equal(normalizeGrid(6), 1);
  assert.deepEqual(gridDims(9), { cols: 1, rows: 1 });
  assert.equal(gridHoldMs(24, 1), 1000 / 24);
  assert.equal(gridHoldMs(24, 2), 1000 / 24);
  assert.equal(gridHoldMs(60, 4), 1000 / 60);
  assert.equal(gridHoldMs(10, 4), 100);
  assert.equal(frameBytesForGrid(1850, 1, 360), 1850);
  assert.equal(frameBytesForGrid(1850, 4, 360), 192);
  assert.equal(frameBytesForGrid(1850, 4, 900), 1628);
  assert.equal(frameBytesForGrid(1850, 4, 1000, 720), 1003);
  assert.equal(frameBytesForGrid(1850, 2, 1000, 640), 1850);
  assert.equal(frameBytesForGrid(100, 4, 900), 100);
  assert.equal(frameBytesForGrid(1850, 4, 100), 32);
  assert.equal(colorFrameBytes(1850, 360, "M"), 251);
  assert.equal(colorFrameBytes(1850, 1000, "M"), 1850);
  assert.equal(colorFrameBytes(100, 360, "M"), 100);
  const four = frameBytesForGrid(1850, 4, 1000, 720);
  assert.ok((4 * four) / gridHoldMs(24, 4) > 1850 / gridHoldMs(24, 1));
});

test("worker messages expose every symbol, and fall back to the first", () => {
  const a = new Uint8Array([1]);
  const b = new Uint8Array([2, 3]);
  assert.deepEqual(symbolsFromWorker({ bytes: a, symbols: [a, b] }), [a, b]);
  assert.deepEqual(symbolsFromWorker({ bytes: a, symbols: [] }), [a]);
  assert.deepEqual(symbolsFromWorker({ bytes: null }), []);
});

test("already-compressed media skips gzip even when the bytes are repetitive", async () => {
  assert.equal(isPrecompressedType("image/jpeg"), true);
  assert.equal(isPrecompressedType("image/bmp"), false);
  assert.equal(isPrecompressedType("video/mp4"), true);
  const repetitive = new Uint8Array(4000).fill(0x61);
  const packed = await packEnvelope(repetitive, "photo.jpg", "image/jpeg");
  assert.equal(packed.compressed, false);
  assert.equal(packed.wireFileLen, repetitive.length);
  assert.deepEqual((await parseEnvelope(packed.bytes))?.file, repetitive);
});

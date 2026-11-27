import assert from "node:assert/strict";
import test from "node:test";
import { dividesRefresh, holdFrameBounds, TxPaintClock } from "../shared/tx-paint.ts";

test("24 fps divides 120 Hz and 144 Hz, not 60 Hz", () => {
  assert.equal(dividesRefresh(60, 24), false);
  assert.equal(dividesRefresh(60, 20), true);
  assert.equal(dividesRefresh(60, 30), true);
  assert.equal(dividesRefresh(120, 24), true);
  assert.equal(dividesRefresh(144, 24), true);
});

test("2-frame and 3-frame holds at 24 fps are quantization, not a stall", () => {
  assert.deepEqual(holdFrameBounds(60, 24), { min: 2, max: 3 });
  assert.deepEqual(holdFrameBounds(59.94, 24), { min: 2, max: 3 });
  const clock = new TxPaintClock(24);
  for (let i = 0; i <= 20; i++) clock.noteFrame(i * (1000 / 60));
  clock.noteSwap(0, 0);
  clock.noteSwap(1000 / 30, 0);
  clock.noteSwap(1000 / 30 + 50, 0);
  const snap = clock.snapshot();
  assert.equal(snap.late, 0);
  assert.equal(snap.onTime, 2);
  assert.equal(snap.extraRefreshes, 0);
  assert.equal(snap.integerDivisor, false);
  assert.equal(snap.panelHz, null);
  assert.ok(Math.abs((snap.rafHz ?? 0) - 60) < 0.05);
});

test("a 50 ms gap stays on slot when the observed rAF rate is 59.94 Hz", () => {
  const clock = new TxPaintClock(24);
  for (let i = 0; i <= 20; i++) clock.noteFrame(i * (1000 / 59.94));
  clock.noteSwap(0, 0);
  clock.noteSwap(50, 0);
  const snap = clock.snapshot();
  assert.equal(snap.late, 0);
  assert.equal(snap.onTime, 1);
  assert.equal(snap.extraRefreshes, 0);
  assert.equal(snap.panelHz, null);
  assert.ok(Math.abs((snap.rafHz ?? 0) - 59.94) < 0.05);
});

test("a gap past one refresh counts as late, and skipped intervals add up", () => {
  const clock = new TxPaintClock(24);
  for (let i = 0; i <= 12; i++) clock.noteFrame(i * (1000 / 60));
  clock.noteSwap(0, 0);
  clock.noteSwap(80, 1);
  clock.noteStarved();
  const snap = clock.snapshot();
  assert.equal(snap.late, 1);
  assert.equal(snap.skipped, 1);
  assert.equal(snap.starved, 1);
  assert.ok((snap.extraRefreshes ?? 0) >= 1);
});

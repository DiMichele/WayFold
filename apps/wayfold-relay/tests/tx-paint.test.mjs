import assert from "node:assert/strict";
import test from "node:test";
import { dividesRefresh, TxPaintClock } from "../shared/tx-paint.ts";

test("24 fps divides 120 Hz and 144 Hz, not 60 Hz", () => {
  assert.equal(dividesRefresh(60, 24), false);
  assert.equal(dividesRefresh(60, 20), true);
  assert.equal(dividesRefresh(60, 30), true);
  assert.equal(dividesRefresh(120, 24), true);
  assert.equal(dividesRefresh(144, 24), true);
});

test("a 50 ms gap at 24 fps on a 60 Hz panel is quantization, not a stall", () => {
  const clock = new TxPaintClock(24);
  for (let i = 0; i <= 12; i++) clock.noteFrame(i * (1000 / 60));
  clock.noteSwap(0, 0);
  clock.noteSwap(50, 0);
  const snap = clock.snapshot();
  assert.equal(snap.late, 0);
  assert.equal(snap.onTime, 1);
  assert.equal(snap.integerDivisor, false);
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

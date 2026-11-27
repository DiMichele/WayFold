import assert from "node:assert/strict";
import test from "node:test";
import { createRoiState, expandRect, quadAabb, roiUpdate } from "../receive/roi.ts";

function quad(x, y, s = 40) {
  return {
    topLeft: { x, y },
    topRight: { x: x + s, y },
    bottomRight: { x: x + s, y: y + s },
    bottomLeft: { x, y: y + s },
  };
}

test("expandRect clamps to the frame and respects margin floor", () => {
  const r = expandRect({ x: 10, y: 10, w: 20, h: 20 }, 0.18, 200, 200);
  assert.ok(r.x >= 0 && r.y >= 0);
  assert.ok(r.x + r.w <= 200 && r.y + r.h <= 200);
  assert.ok(r.w > 20 && r.h > 20);
});

test("full-frame hit establishes expected layout", () => {
  const state = createRoiState();
  const next = roiUpdate(state, 1, 400, 400, [quad(40, 40), quad(220, 40)], true);
  assert.equal(state.expected, 2);
  assert.equal(state.boxes.length, 2);
  assert.equal(next.fullNext, false);
});

test("stale frameId does not move boxes", () => {
  const state = createRoiState();
  roiUpdate(state, 5, 400, 400, [quad(40, 40)], true);
  const before = state.boxes[0].rect.x;
  roiUpdate(state, 3, 400, 400, [quad(200, 200)], true);
  assert.equal(state.boxes[0].rect.x, before);
});

test("misses clear a box and force full frame", () => {
  const state = createRoiState();
  roiUpdate(state, 1, 400, 400, [quad(40, 40)], true);
  roiUpdate(state, 2, 400, 400, [], false);
  const next = roiUpdate(state, 3, 400, 400, [], false);
  assert.equal(state.boxes.length, 0);
  assert.equal(next.fullNext, true);
});

test("quadAabb is axis aligned", () => {
  const r = quadAabb(quad(10, 20, 30));
  assert.deepEqual(r, { x: 10, y: 20, w: 30, h: 30 });
});

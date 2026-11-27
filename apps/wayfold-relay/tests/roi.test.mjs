import assert from "node:assert/strict";
import test from "node:test";
import { createRoiState, expandRect, planGrabs, quadAabb, roiUpdate, RoiSession } from "../receive/roi.ts";

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

test("planGrabs sends one crop per code when enough workers are free", () => {
  const jobs = planGrabs(true, false, [
    { x: 10, y: 10, w: 80, h: 80 },
    { x: 200, y: 10, w: 80, h: 80 },
    { x: 10, y: 200, w: 80, h: 80 },
    { x: 200, y: 200, w: 80, h: 80 },
  ], 400, 400, 4);
  assert.equal(jobs.length, 4);
  assert.ok(jobs.every((j) => !j.full));
  const pixels = jobs.reduce((n, j) => n + j.rect.w * j.rect.h, 0);
  assert.ok(pixels < 400 * 400);
});

test("planGrabs uses one union when a single worker is free", () => {
  const jobs = planGrabs(true, false, [
    { x: 10, y: 20, w: 40, h: 40 },
    { x: 80, y: 20, w: 40, h: 40 },
  ], 400, 300, 1);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].full, false);
  assert.ok(jobs[0].rect.w < 400);
  assert.ok(jobs[0].rect.x <= 10);
  assert.ok(jobs[0].rect.x + jobs[0].rect.w >= 120);
});

test("a batch of crops applies once, in camera coordinates", () => {
  const session = new RoiSession();
  session.begin(1, 1, true, 400, 400);
  session.push(1, [quad(40, 40, 20), quad(200, 40, 20)], 0, 0);
  assert.equal(session.state.expected, 2);
  session.begin(2, 2, false, 400, 400);
  session.push(2, [quad(0, 0, 20)], 40, 40);
  assert.equal(session.state.expected, 2);
  session.push(2, [quad(0, 0, 20)], 200, 40);
  assert.equal(session.fullNext, false);
  assert.equal(session.state.boxes.length, 2);
});

test("quadAabb is axis aligned", () => {
  const r = quadAabb(quad(10, 20, 30));
  assert.deepEqual(r, { x: 10, y: 20, w: 30, h: 30 });
});

import assert from "node:assert/strict";
import test from "node:test";
import { setOptFlagsForTest } from "../shared/opt-flags.ts";
import { workerPlanFields } from "../receive/worker-plan.ts";

test("all flags off keeps the legacy worker message", () => {
  setOptFlagsForTest(null);
  setOptFlagsForTest({});
  assert.deepEqual(workerPlanFields(30, 2, [{ x: 0, y: 0, w: 10, h: 10 }]), {});
  setOptFlagsForTest(null);
});

test("roi alone asks for quads without fast, mem, or gray", () => {
  setOptFlagsForTest({ roi: true });
  const first = workerPlanFields(30, 0, null);
  assert.equal(first.track, true);
  assert.equal(first.fast, undefined);
  assert.equal(first.mem, undefined);
  assert.equal(first.gray, undefined);
  assert.equal(first.budgetMs, undefined);
  const crop = workerPlanFields(30, 1, null);
  assert.equal(crop.track, true);
  assert.equal(crop.expected, 1);
  const layout = workerPlanFields(30, 2, [
    { x: 0, y: 0, w: 40, h: 40 },
    { x: 80, y: 0, w: 40, h: 40 },
  ]);
  assert.equal(layout.expected, 2);
  assert.equal(layout.rects.length, 2);
  setOptFlagsForTest(null);
});

test("mem, gray, and mem+gray stay separate", () => {
  setOptFlagsForTest({ mem: true });
  const mem = workerPlanFields(30);
  assert.equal(mem.mem, true);
  assert.equal(mem.gray, undefined);
  setOptFlagsForTest({ gray: true });
  const gray = workerPlanFields(30);
  assert.equal(gray.mem, undefined);
  assert.equal(gray.gray, true);
  setOptFlagsForTest({ mem: true, gray: true });
  const both = workerPlanFields(30);
  assert.equal(both.mem, true);
  assert.equal(both.gray, true);
  setOptFlagsForTest(null);
});

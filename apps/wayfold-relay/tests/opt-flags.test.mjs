import assert from "node:assert/strict";
import test from "node:test";
import { parseOptList, setOptFlagsForTest, getOptFlags } from "../shared/opt-flags.ts";

test("opt flags default all off", () => {
  const f = parseOptList(null);
  assert.equal(f.perf, false);
  assert.equal(f.roi, false);
  assert.equal(f.latest, false);
  assert.equal(f.budget, 1);
  assert.equal(f.schedule, "drop");
});

test("query tokens enable flags and budget", () => {
  const f = parseOptList("perf,fast,budget:1.5,sched:pool");
  assert.equal(f.perf, true);
  assert.equal(f.fast, true);
  assert.equal(f.budget, 1.5);
  assert.equal(f.latest, true);
  assert.equal(f.schedule, "pool");
});

test("exp defaults off and exp:short is opt-in", () => {
  assert.equal(parseOptList(null).exposure, "off");
  assert.equal(parseOptList("exp").exposure, "continuous");
  assert.equal(parseOptList("perf,exp:short").exposure, "short");
  assert.equal(parseOptList("exp:short").perf, false);
});

test("latest alone selects grab-on-free schedule", () => {
  const f = parseOptList("latest,budget:2");
  assert.equal(f.latest, true);
  assert.equal(f.schedule, "latest");
  assert.equal(f.budget, 2);
});

test("setOptFlagsForTest overrides the cache", () => {
  setOptFlagsForTest({ perf: true, budget: 0.5 });
  assert.equal(getOptFlags().perf, true);
  assert.equal(getOptFlags().budget, 0.5);
  setOptFlagsForTest(null);
});

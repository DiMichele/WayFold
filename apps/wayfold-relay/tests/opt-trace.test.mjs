import assert from "node:assert/strict";
import test from "node:test";
import { setOptFlagsForTest } from "../shared/opt-flags.ts";
import { optTrace, timed, wallNow } from "../shared/opt-trace.ts";

test("optTrace is silent when perf is off", () => {
  setOptFlagsForTest({ perf: false });
  optTrace.reset();
  optTrace.noteUniqueSymbol(100);
  optTrace.noteFountainGrowth(200);
  assert.equal(optTrace.snapshot().goodput.opticalBps, 0);
  assert.equal(optTrace.snapshot().samples.length, 0);
  setOptFlagsForTest(null);
});

test("optTrace records unique optical and fountain growth separately", () => {
  setOptFlagsForTest({ perf: true });
  optTrace.reset();
  const t0 = wallNow();
  optTrace.noteUniqueSymbol(1000);
  optTrace.noteUniqueSymbol(1000);
  optTrace.noteFountainGrowth(500);
  optTrace.noteFileComplete(4096, 2);
  const snap = optTrace.snapshot();
  assert.ok(snap.goodput.fileBps > 0);
  assert.equal(snap.goodput.fileBps, 2048);
  assert.ok(snap.samples.length === 0 || snap.samples.every((s) => s.t0 >= t0 - 1000));
  timed("parse", () => 1);
  assert.ok(optTrace.snapshot().samples.some((s) => s.phase === "parse"));
  setOptFlagsForTest(null);
});

test("decode passes are counted apart from the wasm sample", () => {
  setOptFlagsForTest({ perf: true });
  optTrace.reset();
  optTrace.mark("wasm", wallNow(), 40);
  optTrace.notePasses([{ pass: "hard", ms: 30 }, { pass: "crop", ms: 8 }], 1);
  const snap = optTrace.snapshot();
  assert.equal(snap.samples.filter((s) => s.phase === "wasm").length, 1);
  assert.equal(snap.passes.hard.n, 1);
  assert.equal(snap.passes.crop.ms, 8);
  assert.equal(snap.skippedPasses, 1);
  setOptFlagsForTest(null);
});

test("observed FPS comes from video metadata deltas", () => {
  setOptFlagsForTest({ perf: true });
  optTrace.reset();
  optTrace.noteVideoMeta({ presentedFrames: 10, mediaTime: 1 });
  optTrace.noteVideoMeta({ presentedFrames: 40, mediaTime: 2 });
  assert.ok(Math.abs(optTrace.observedFps() - 30) < 0.01);
  setOptFlagsForTest(null);
});

test("one capture split across workers counts as one processed frame", () => {
  setOptFlagsForTest({ perf: true });
  optTrace.reset();
  optTrace.noteCapture(7);
  optTrace.noteCapture(7);
  optTrace.noteCapture(7);
  assert.equal(optTrace.processedFps(), 1);
  optTrace.noteCapture(8);
  assert.ok(optTrace.processedFps() > 1);
  setOptFlagsForTest(null);
});

test("file goodput is final, and reset clears the session", () => {
  setOptFlagsForTest({ perf: true });
  optTrace.reset();
  optTrace.noteUniqueSymbol(1000);
  optTrace.noteFileComplete(4096, 2);
  const snap = optTrace.snapshot();
  assert.equal(snap.goodput.file.finalBps, 2048);
  assert.equal(snap.goodput.file.instantBps, 0);
  assert.equal(snap.progressBar, "estimate");
  assert.ok(snap.goodput.optical.finalBps > 0);
  optTrace.reset();
  const cleared = optTrace.snapshot();
  assert.equal(cleared.goodput.fileBps, 0);
  assert.equal(cleared.goodput.optical.finalBps, 0);
  assert.equal(cleared.net, null);
  assert.equal(cleared.fps.negotiated, 0);
  setOptFlagsForTest(null);
});

test("ARQ RTT is stored separately from optical waits", () => {
  setOptFlagsForTest({ perf: true });
  optTrace.reset();
  optTrace.setArqRtt(42);
  optTrace.noteTxWait(5);
  optTrace.noteRxWait(7);
  const snap = optTrace.snapshot();
  assert.equal(snap.arqRttMs, 42);
  assert.equal(snap.txWaitMs, 5);
  assert.equal(snap.rxWaitMs, 7);
  setOptFlagsForTest(null);
});

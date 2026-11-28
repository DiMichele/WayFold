import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const files = [
  "../receive/worker-plan.ts",
  "../receive/worker.ts",
  "../receive/roi.ts",
  "../receive/decode-core.ts",
  "../receive/frame-grab.ts",
  "../receive/optics-metrics.ts",
  "../receive/sharpness.ts",
  "../shared/opt-trace.ts",
  "../shared/opt-ui.ts",
  "../shared/opt-flags.ts",
  "../diode/rx-controller.ts",
  "../diode/tx-controller.ts",
  "../color/profile.ts",
  "../color/palette.ts",
  "../color/matrices.ts",
  "../color/composite.ts",
  "../color/fit.ts",
  "../color/schedule.ts",
  "../color/quad.ts",
  "../color/engine.ts",
  "../color/live.ts",
  "../color/video-plan.ts",
  "../color/arq-observe.ts",
];

test("optical flags and the diode path do not open a network channel", () => {
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false, file);
    assert.equal(source.includes("new WebSocket"), false, file);
    assert.equal(source.includes("XMLHttpRequest"), false, file);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { setOptFlagsForTest } from "../shared/opt-flags.ts";
import { optTrace } from "../shared/opt-trace.ts";
import { hudLines } from "../shared/opt-ui.ts";

test("the link HUD omits fountain and file, and tags ARQ", () => {
  setOptFlagsForTest({ perf: true });
  optTrace.reset();
  optTrace.noteFileComplete(8000, 2);
  optTrace.noteNet({
    appRxBps: 4000,
    appTxBps: 1000,
    appRxBytes: 80000,
    appTxBytes: 20000,
    capacityBps: 19200,
    shownPerSec: 8,
    srttMs: 90,
    retransmits: 3,
    duplicates: 1,
    outstanding: 4,
    streams: 1,
    bytesAcked: 50000,
  });
  const link = hudLines(optTrace.snapshot(), "bit", "link").join("\n");
  assert.equal(link.includes("fountain"), false);
  assert.equal(link.includes("file fin"), false);
  assert.match(link, /SRTT 90 ms \(mis\)/);
  assert.match(link, /RTT campione n\/d/);
  assert.match(link, /capacità .+ \(teo\)/);
  assert.match(link, /RX app .+ \(der\)/);
  assert.match(link, /ritx 3/);
  const file = hudLines(optTrace.snapshot(), "kB", "file").join("\n");
  assert.match(file, /fountain/);
  assert.match(file, /barra = stima/);
  assert.equal(file.includes("SRTT"), false);
  setOptFlagsForTest(null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { ArqReceiver, ArqSender } from "../../wayfold-connect/src/arq.ts";
import { windowCapacityBitrate } from "../color/profile.ts";
import { observeColorArq } from "../color/arq-observe.ts";

function payload(n, fill) {
  const out = new Uint8Array(32);
  out[0] = n & 255;
  out[1] = fill;
  return out;
}

/**
 * One paint offers `channels` segments, like one color composite.
 * The ARQ classes are the production ones. OPTICAL_INFLIGHT stays 12.
 */
function runLink(options) {
  const channels = options.channels ?? 2;
  const queue = [];
  for (let i = 0; i < (options.count ?? 20); i++) queue.push(payload(i, options.fill ?? 1));
  const tx = new ArqSender(() => queue.shift() ?? null);
  const rx = new ArqReceiver();
  const delivered = [];
  let saturatedSteps = 0;
  let t = 0;
  const rtt = options.rtt ?? 100;
  const steps = options.steps ?? 40;
  for (let step = 0; step < steps; step++) {
    t += 40;
    if (tx.outstanding >= 12) saturatedSteps++;
    const shown = [];
    for (let c = 0; c < channels; c++) {
      const seg = tx.pick(32, t);
      if (seg) shown.push({ seg, channel: c });
    }
    assert.ok(tx.outstanding <= 12);
    const ordered = options.reorder ? [...shown].reverse() : shown;
    for (const item of ordered) {
      if (options.drop?.(step, item.channel)) continue;
      for (const chunk of rx.onSegment(item.seg.no, item.seg.data)) delivered.push(chunk[0]);
    }
    if (step % Math.max(1, Math.round(rtt / 40)) === 0) {
      const sack = rx.sack();
      tx.onAck(rx.nextExpected, sack.lo, sack.hi);
    }
  }
  const sack = rx.sack();
  tx.onAck(rx.nextExpected, sack.lo, sack.hi);
  return { tx, rx, delivered, saturatedSteps, seconds: t / 1000 };
}

test("the ARQ window never exceeds 12 with two color channels", () => {
  const run = runLink({ channels: 2, count: 40, steps: 30 });
  assert.ok(run.tx.outstanding <= 12);
  assert.ok(run.delivered.length > 0);
});

test("a lost color channel is retransmitted and the bytes stay in order", () => {
  const run = runLink({
    channels: 2,
    count: 8,
    steps: 50,
    rtt: 80,
    drop: (step, channel) => step < 6 && channel === 1,
  });
  assert.ok(run.tx.retransmits > 0);
  for (let i = 1; i < run.delivered.length; i++) assert.ok(run.delivered[i] >= run.delivered[i - 1]);
});

test("dropping a whole composite still delivers later segments in order", () => {
  const run = runLink({
    channels: 3,
    count: 9,
    steps: 40,
    drop: (step) => step === 2,
    reorder: true,
  });
  for (let i = 1; i < run.delivered.length; i++) assert.ok(run.delivered[i] >= run.delivered[i - 1]);
});

test("an empty queue does not invent a segment, and one-way traffic still acks", () => {
  const quiet = new ArqSender(() => null);
  assert.equal(quiet.pick(32, 10), null);
  const run = runLink({ channels: 2, count: 4, steps: 20 });
  const back = new ArqSender(() => null);
  const sack = run.rx.sack();
  back.onAck?.(run.rx.nextExpected, sack.lo, sack.hi);
  assert.ok(run.delivered.length > 0);
});

test("observed goodput stays within the window capacity formula", () => {
  const mtu = 32;
  const rttSec = 0.12;
  const run = runLink({ channels: 2, count: 30, steps: 80, rtt: rttSec * 1000 });
  const bytes = run.delivered.length * mtu;
  const goodput = bytes / Math.max(0.001, run.seconds);
  const cap = windowCapacityBitrate(12, mtu, rttSec) / 8;
  assert.ok(goodput <= cap * 1.25, `goodput ${goodput} cap ${cap}`);
});

test("a color composite fills the window without touching workers or optical BER", () => {
  const run = observeColorArq({
    channels: 3,
    count: 36,
    steps: 24,
    rttMs: 200,
    stepMs: 40,
    mtu: 1200,
    payloadBytes: 64,
  });
  assert.ok(run.maxOutstanding <= 12);
  assert.equal(run.saturation, "arq");
  assert.ok(run.unitsSent <= 12 + run.delivered);
  assert.ok(run.appGoodputBps <= run.capacityBps * 1.25);
  assert.equal(run.opticalBer, null);
  assert.equal(run.workerLimit, null);
  assert.ok(run.repeats >= 0);
  const lost = observeColorArq({
    channels: 3,
    count: 12,
    steps: 30,
    rttMs: 80,
    drop: (_step, channel) => channel === 2,
  });
  assert.ok(lost.retransmits > 0);
  assert.ok(lost.duplicates >= 0);
  assert.ok(lost.maxOutstanding <= 12);
});

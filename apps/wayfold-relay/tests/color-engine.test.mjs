import assert from "node:assert/strict";
import test from "node:test";
import { alignMatrices } from "../color/matrices.ts";
import { distortColors, paintGrid, paintMatrices } from "../color/composite.ts";
import { encodePayloads, recoverRaster, scheduleRecovered } from "../color/engine.ts";
import { bindProfile, compareProfiles, parseProfile, windowCapacityBitrate } from "../color/profile.ts";
import { colorSearchRect, noteLocatedGeometry } from "../color/live.ts";
import { scheduleSymbols } from "../color/schedule.ts";
import { videoBatchKind } from "../color/video-plan.ts";
import { optTrace } from "../shared/opt-trace.ts";
import { hudLines } from "../shared/opt-ui.ts";

function bytes(n, seed) {
  const out = new Uint8Array(n);
  let x = seed || 1;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x & 255;
  }
  return out;
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

test("aligned payloads share version, ECC and module count", () => {
  const aligned = alignMatrices([bytes(40, 1), bytes(40, 2), bytes(80, 3)], "M");
  assert.equal(aligned.matrices.length, 3);
  assert.equal(aligned.ecc, "M");
  assert.ok(aligned.matrices.every((m) => m.length === aligned.size * aligned.size));
});

test("empty payloads are refused", () => {
  assert.throws(() => alignMatrices([new Uint8Array()], "L"));
});

test("clean Color 2 and RGB 3 recover modules with no bit errors", () => {
  for (const profile of ["color2", "rgb3"]) {
    const n = profile === "rgb3" ? 3 : 2;
    const payloads = Array.from({ length: n }, (_, i) => bytes(48, i + 4));
    const encoded = encodePayloads(payloads, "L", profile, undefined, 4);
    const recovered = recoverRaster(encoded, profile, "hybrid", "module", undefined, [encoded.aligned.matrices]);
    assert.equal(recovered.monoLike, false);
    assert.equal(recovered.found.length, 1);
    const split = recovered.found[0].split;
    assert.ok(split.ber.every((v) => v === 0), `${profile} ber ${split.ber}`);
    assert.ok(split.condition != null && Number.isFinite(split.condition));
    assert.ok(split.residual < 1, `residual ${split.residual}`);
    assert.equal(recovered.found[0].channels.length, n);
  }
});

test("affine fit absorbs a linear mix that raw colors do not describe", () => {
  const payloads = [bytes(36, 8), bytes(36, 9)];
  const encoded = encodePayloads(payloads, "L", "color2", "rb", 4);
  const mixed = distortColors(
    encoded,
    [0.7, 0, 0.25, 0, 1, 0, 0.2, 0, 0.75],
    { r: 6, g: 0, b: 4 },
    { r: 1, g: 1, b: 1 },
  );
  const affine = recoverRaster(mixed, "color2", "affine", "module", "rb", [encoded.aligned.matrices]);
  const classify = recoverRaster(mixed, "color2", "classify", "module", "rb", [encoded.aligned.matrices]);
  const hybrid = recoverRaster(mixed, "color2", "hybrid", "pixel", "rb", [encoded.aligned.matrices]);
  for (const run of [affine, classify, hybrid]) {
    assert.equal(run.found.length, 1);
    assert.ok(Number.isFinite(run.found[0].split.residual));
  }
  assert.ok(affine.found[0].split.condition != null && affine.found[0].split.condition < 1e6);
  assert.ok(mean(affine.found[0].split.ber) <= mean(classify.found[0].split.ber) + 0.02);
});

test("whitening red modules hurts red more than blue", () => {
  const payloads = [bytes(36, 2), bytes(36, 5)];
  const encoded = encodePayloads(payloads, "Q", "color2", "rb", 4);
  const data = new Uint8ClampedArray(encoded.data);
  const ppm = 4;
  for (let y = 2 * ppm; y < encoded.height - 2 * ppm; y++) {
    for (let x = 0; x < encoded.width; x++) {
      const i = (y * encoded.width + x) * 4;
      if (data[i] > data[i + 2] + 80 && data[i] > data[i + 1] + 80) {
        data[i] = data[i + 1] = data[i + 2] = 255;
      }
    }
  }
  const recovered = recoverRaster(
    { data, width: encoded.width, height: encoded.height },
    "color2",
    "classify",
    "module",
    "rb",
    [encoded.aligned.matrices],
  );
  const ber = recovered.found[0].split.ber;
  assert.ok(ber[0] > ber[1], `red ${ber[0]} blue ${ber[1]}`);
  assert.ok(ber[1] < 0.02);
});

test("a tight frame budget splits one composite and rotates the next frame", async () => {
  const palette = (await import("../color/palette.ts")).PALETTE_RB;
  const cells = [];
  for (let i = 0; i < 4; i++) cells.push(alignMatrices([bytes(40, 50 + i), bytes(40, 60 + i)], "L").matrices);
  const grid = paintGrid(cells, palette, 2, 2);
  const first = recoverRaster(grid, "color2", "hybrid", "module", "rb", cells, { budgetMs: 0, phase: 0 });
  const later = recoverRaster(grid, "color2", "hybrid", "module", "rb", cells, { budgetMs: 0, phase: 1 });
  assert.equal(first.geometry.length, 4);
  assert.equal(first.found.length, 1);
  assert.equal(first.unsplit, 3);
  const xs = first.geometry.map((cell) => cell.bounds.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 20);
  assert.equal(later.found.length, 1);
  assert.notEqual(first.found[0].index, later.found[0].index);
  assert.ok(first.found[0].split.ber.every((v) => v === 0));
});

test("a dense grid does not invent composites from the QR interior", async () => {
  const palette = (await import("../color/palette.ts")).PALETTE_RB;
  const cells = [];
  for (let i = 0; i < 4; i++) {
    cells.push(alignMatrices([bytes(48, 20 + i), bytes(48, 30 + i)], "H").matrices);
  }
  const grid = paintGrid(cells, palette, 2, 2);
  const recovered = recoverRaster(grid, "color2", "hybrid", "module", "rb", cells);
  assert.equal(recovered.found.length, 4);
  assert.ok(recovered.found.every((cell) => cell.split.ber.every((v) => v === 0)));
});

test("a 2 by 2 grid locates four composites", async () => {
  const cells = [0, 1, 2, 3].map((seed) => {
    const encoded = encodePayloads([bytes(24, seed + 1), bytes(24, seed + 9)], "L", "color2", "rb", 3);
    return encoded.aligned.matrices;
  });
  const grid = paintGrid(cells, (await import("../color/palette.ts")).PALETTE_RB, 3, 2, 2);
  const recovered = recoverRaster(grid, "color2", "hybrid", "module", "rb", cells);
  assert.equal(recovered.found.length, 4);
  assert.ok(recovered.found.every((cell) => cell.split.ber.every((v) => v === 0)));
});

test("scheduler covers every channel and does not keep a stale queue", () => {
  const items = [];
  for (let composite = 0; composite < 4; composite++) {
    for (let channel = 0; channel < 3; channel++) items.push({ composite, channel, payload: composite * 3 + channel });
  }
  assert.equal(items.length, 12);
  const adaptive = scheduleSymbols(items, 3, "adaptive");
  assert.equal(adaptive.dropped, 0);
  assert.equal(adaptive.batches.length, 3);
  const seen = new Set(adaptive.batches.flat().map((item) => item.channel));
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
  const limited = scheduleSymbols(items, 3, "channel");
  assert.equal(limited.dropped, 9);
  assert.equal(limited.batches.length, 3);
  const next = scheduleSymbols(items, 3, "channel", limited.nextPhase);
  assert.notDeepEqual(
    limited.batches.map((batch) => batch[0].channel),
    next.batches.map((batch) => batch[0].channel),
  );
});

test("profile binding stays local and the window limit is a formula", () => {
  assert.equal(parseProfile("nope"), "mono");
  assert.equal(bindProfile("rgb3"), "rgb3");
  assert.equal(windowCapacityBitrate(12, 1200, 0.2), (12 * 1200 * 8) / 0.2);
  const ranked = compareProfiles([
    { profile: { id: "rgb3", channels: 3, paletteId: "rgb" }, success: [1, 0.2, 1], residual: 1, condition: 4, calMs: 1, splitMs: 1, decodeMs: 1 },
    { profile: { id: "color2", channels: 2, paletteId: "rb" }, success: [1, 1], residual: 1, condition: 4, calMs: 1, splitMs: 1, decodeMs: 1 },
  ]);
  assert.equal(ranked[0].profile.id, "color2");
});

test("a gray frame is reported as mono-like and yields no payloads", () => {
  const data = new Uint8ClampedArray(80 * 80 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 140;
    data[i + 3] = 255;
  }
  const recovered = recoverRaster({ data, width: 80, height: 80 }, "color2");
  assert.equal(recovered.found.length, 0);
  assert.equal(recovered.monoLike, true);
});

test("scheduleRecovered drops blank channels", () => {
  const payloads = [bytes(30, 3), bytes(30, 4)];
  const encoded = encodePayloads(payloads, "L", "color2", "rb", 3);
  const recovered = recoverRaster(encoded, "color2", "hybrid", "module");
  const plan = scheduleRecovered(recovered.found, 2, "adaptive");
  assert.equal(plan.dropped, 0);
  assert.equal(plan.batches.flat().length, 2);
});

function rgb12() {
  const items = [];
  for (let composite = 0; composite < 4; composite++) {
    for (let channel = 0; channel < 3; channel++) items.push({ composite, channel, payload: composite * 3 + channel });
  }
  return items;
}

test("RGB 3 x 4 does not stop at the free worker count when the budget allows it", () => {
  const items = rgb12();
  const channel = scheduleSymbols(items, 2, "channel");
  assert.equal(channel.candidates, 12);
  assert.equal(channel.scheduled, 2);
  assert.equal(channel.dropped, 10);
  assert.deepEqual(channel.perJob, [1, 1]);

  const oneComposite = scheduleSymbols(items, 2, "cell");
  assert.equal(oneComposite.scheduled, 6);
  assert.deepEqual(oneComposite.perJob, [3, 3]);
  assert.equal(oneComposite.dropped, 6);

  const packed = scheduleSymbols(items, 2, "adaptive");
  assert.equal(packed.scheduled, 12);
  assert.equal(packed.dropped, 0);
  assert.deepEqual(packed.perJob, [6, 6]);

  const budget = scheduleSymbols(items, 2, "budget", 0, { symbolMs: 8, budgetMs: 33 });
  assert.equal(budget.scheduled, 8);
  assert.equal(budget.dropped, 4);
  assert.ok(budget.slowest * 8 <= 33);
  const seen = new Set(budget.batches.flat().map((item) => item.channel));
  assert.deepEqual([...seen].sort(), [0, 1, 2]);

  const wide = scheduleSymbols(items, 4, "budget", 0, { symbolMs: 8, budgetMs: 33 });
  assert.equal(wide.scheduled, 12);
  assert.equal(wide.dropped, 0);
  assert.equal(wide.slowest, 3);

  const again = scheduleSymbols(items, 2, "budget", budget.nextPhase, { symbolMs: 8, budgetMs: 33 });
  assert.equal(again.candidates, 12);
  assert.notDeepEqual(
    budget.batches[0].map((item) => item.channel),
    again.batches[0].map((item) => item.channel),
  );
});

test("mono video repeats one symbol and color video uses distinct seqs", () => {
  assert.equal(videoBatchKind(1), "repeat-still");
  assert.equal(videoBatchKind(2), "distinct-seqs");
  assert.equal(videoBatchKind(3), "distinct-seqs");
});

test("the perf HUD and JSON expose the color schedule", () => {
  optTrace.reset();
  optTrace.noteColor({
    profile: "rgb3",
    grid: 4,
    located: 4,
    processed: 2,
    channels: 3,
    candidates: 12,
    scheduled: 8,
    dropped: 4,
    perJob: [4, 4],
    workersFree: 2,
    workers: 2,
    saturated: true,
    limit: "budget",
    locateMs: 1.2,
    calMs: 0.4,
    splitMs: 3.5,
    residual: 0.2,
    condition: 12,
    quality: "ok",
  });
  optTrace.noteColorDecoded(4, 20);
  const snap = optTrace.snapshot();
  assert.equal(snap.color.scheduled, 8);
  assert.equal(snap.color.decoded, 4);
  assert.equal(snap.color.decodeMs, 20);
  const text = hudLines(snap).join("\n");
  assert.match(text, /rgb3/);
  assert.match(text, /geometria 4/);
  assert.match(text, /elaborati 2/);
  assert.match(text, /sched 8/);
  assert.match(text, /scartati 4/);
  assert.match(text, /saturazione budget/);
  assert.match(JSON.stringify(snap), /"scheduled":8/);
  optTrace.reset();
  assert.equal(optTrace.snapshot().color, null);
});

test("a budget crop keeps every located cell and a full frame is searched again", () => {
  const full = { x: 0, y: 0, w: 400, h: 400 };
  const cells = [
    { x: 10, y: 10, w: 80, h: 80 },
    { x: 200, y: 10, w: 80, h: 80 },
    { x: 10, y: 200, w: 80, h: 80 },
    { x: 200, y: 200, w: 80, h: 80 },
  ];
  const splitOnly = cells[0];
  const tight = colorSearchRect(full, splitOnly, 0, 1, false);
  assert.equal(tight.fullFrame, false);
  assert.ok(cells[3].x > tight.rect.x + tight.rect.w);
  const seen = noteLocatedGeometry(0, 4);
  assert.equal(seen.updateCrop, true);
  assert.equal(seen.seen, 4);
  const lost = noteLocatedGeometry(seen.seen, 1);
  assert.equal(lost.updateCrop, false);
  assert.equal(lost.forceFull, true);
  assert.equal(lost.seen, 4);
  const again = colorSearchRect(full, cells[0], 0, 3, lost.forceFull);
  assert.equal(again.fullFrame, true);
  assert.equal(again.rect.w, 400);
  const periodic = colorSearchRect(full, cells[0], 0, 12, false);
  assert.equal(periodic.fullFrame, true);
});

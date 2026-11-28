import assert from "node:assert/strict";
import test from "node:test";
import { PassCosts, SymbolSet, plannedDecode, qrModules } from "../receive/decode-core.ts";

test("fast with unknown layout stops after partial symbols", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const out = await plannedDecode(async (_input, opts) => {
    if (opts.tryHarder) return [];
    return [{ isValid: true, bytes }];
  }, {
    pixels: new Uint8ClampedArray(4),
    w: 1,
    h: 1,
    fast: true,
    mem: true,
    gray: false,
    expected: 0,
    rects: null,
    budgetMs: Infinity,
    startedAt: 0,
    now: () => 0,
    costs: new PassCosts(),
  });
  assert.equal(out.symbols.length, 1);
  assert.equal(out.passes.length, 1);
  assert.equal(out.passes[0].pass, "fast");
});

test("fast with expected layout retries only missing ROI", async () => {
  const a = new Uint8Array([10]);
  const b = new Uint8Array([20]);
  const calls = [];
  const read = async (input, opts) => {
    calls.push({ w: input.width ?? 0, hard: !!opts.tryHarder });
    if (calls.length === 1) {
      return [
        {
          isValid: true,
          bytes: a,
          position: {
            topLeft: { x: 5, y: 5 },
            topRight: { x: 15, y: 5 },
            bottomRight: { x: 15, y: 15 },
            bottomLeft: { x: 5, y: 15 },
          },
        },
      ];
    }
    // Second+ calls are ROI retries for the empty half.
    return [{ isValid: true, bytes: b }];
  };
  const out = await plannedDecode(read, {
    pixels: new Uint8ClampedArray(200 * 100 * 4),
    w: 200,
    h: 100,
    fast: true,
    mem: true,
    gray: false,
    expected: 2,
    rects: [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 100, y: 0, w: 100, h: 100 },
    ],
    budgetMs: Infinity,
    startedAt: 0,
    now: () => 0,
    costs: new PassCosts(),
  });
  assert.equal(out.symbols.length, 2);
  assert.ok(calls.length >= 2);
  assert.ok(out.passes.some((p) => p.pass.startsWith("roi-")));
});

test("a shared hash does not drop a different payload", () => {
  const seen = new SymbolSet(() => 1);
  const a = seen.add(new Uint8Array([1, 2, 3]));
  const b = seen.add(new Uint8Array([9, 9]));
  const again = seen.add(new Uint8Array([1, 2, 3]));
  assert.ok(a);
  assert.ok(b);
  assert.equal(again, null);
  assert.equal(qrModules(32), 145);
  assert.equal(qrModules("nope"), 0);
});

test("planned decode keeps distinct symbols and drops an exact repeat", async () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([4, 5, 6]);
  let calls = 0;
  const out = await plannedDecode(async () => {
    calls++;
    if (calls > 1) return [];
    return [
      { isValid: true, bytes: a, version: 32 },
      { isValid: true, bytes: a },
      { isValid: true, bytes: b },
    ];
  }, {
    pixels: new Uint8ClampedArray(16),
    w: 2,
    h: 2,
    fast: false,
    mem: true,
    gray: false,
    expected: 0,
    rects: null,
    budgetMs: Infinity,
    startedAt: 0,
    now: () => 0,
    costs: new PassCosts(),
  });
  assert.equal(out.symbols.length, 2);
  assert.equal(out.quads.length, 2);
  assert.equal(out.modules[0], 145);
  assert.equal(out.modules[1], 0);
});

test("budget skips a pass that would not fit", async () => {
  const costs = new PassCosts();
  // ~1000 ms estimate for a 100×100 hard/crop pass.
  costs.record("hard", 100, 1000);
  costs.record("crop", 100, 1000);
  const out = await plannedDecode(async () => [], {
    pixels: new Uint8ClampedArray(100 * 100 * 4),
    w: 100,
    h: 100,
    fast: true,
    mem: true,
    gray: false,
    expected: 0,
    rects: null,
    budgetMs: 5,
    startedAt: 0,
    now: () => 0,
    costs,
  });
  assert.equal(out.passes.some((p) => p.pass === "hard"), false);
  assert.ok(out.skipped >= 1);
});

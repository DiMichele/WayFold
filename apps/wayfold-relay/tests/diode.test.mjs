import assert from "node:assert/strict";
import test from "node:test";
import { airBudget, carrierYieldsToFile, dwellFrames, nextOnAir } from "../diode/carousel.ts";
import { decodeLiveRecord, decodeLiveText, encodeLiveRecord, isLiveMime, isNewerLive, LIVE_HOLD_MS } from "../diode/live.ts";
import { planInboxInsert, toHex } from "../diode/inbox.ts";
import {
  DEFAULT_POLICY,
  POLICY_PRESETS,
  checkPolicy,
  fileExtension,
  matchPreset,
  normalizePolicy,
  parseExtensionList,
  presetPolicy,
} from "../diode/policy.ts";
import { envelopeDigest, packEnvelope, parseEnvelope } from "../shared/envelope.ts";
import { LTDecoder, LTEncoder } from "../shared/fountain.ts";
import { MAX_ORIGINAL_FILE_LEN, MIB } from "../shared/limits.ts";
import { fnv1a, packFrame, parseFrame } from "../shared/protocol.ts";

test("policy normalizes untrusted input into safe bounds", () => {
  assert.deepEqual(normalizePolicy(undefined), DEFAULT_POLICY);
  const wild = normalizePolicy({
    maxBytes: 10 * MAX_ORIGINAL_FILE_LEN,
    allowedExtensions: [".PDF", "*.txt", "bad/ext", "", "csv"],
    repeatFactor: 0,
    minDwellMs: Number.NaN,
  });
  assert.equal(wild.maxBytes, MAX_ORIGINAL_FILE_LEN);
  assert.deepEqual(wild.allowedExtensions, ["pdf", "txt", "csv"]);
  assert.equal(wild.repeatFactor, 1.05);
  assert.equal(wild.minDwellMs, DEFAULT_POLICY.minDwellMs);
  assert.deepEqual(parseExtensionList("json, .CSV;  txt txt"), ["json", "csv", "txt"]);
});

test("presets still map to a single stored policy", () => {
  assert.equal(matchPreset(DEFAULT_POLICY), "standard");
  assert.equal(matchPreset(presetPolicy("documents")), "documents");
  assert.equal(matchPreset(presetPolicy("large")), "large");
  assert.equal(matchPreset(presetPolicy("steady")), "steady");
  assert.equal(matchPreset({ ...DEFAULT_POLICY, maxBytes: 3 * MIB }), null);
  const docs = presetPolicy("documents");
  assert.equal(checkPolicy(docs, { filename: "nota.pdf", size: 20 }).ok, true);
  assert.equal(checkPolicy(docs, { filename: "app.exe", size: 20 }).ok, false);
  assert.equal(POLICY_PRESETS.length, 4);
});

test("policy rejects by size and by extension", () => {
  const policy = normalizePolicy({ maxBytes: 2 * MIB, allowedExtensions: ["txt", "json"] });
  assert.deepEqual(checkPolicy(policy, { filename: "a.txt", size: 10 }), { ok: true });
  assert.deepEqual(checkPolicy(policy, { filename: "A.JSON", size: 10 }), { ok: true });
  assert.deepEqual(checkPolicy(policy, { filename: "a.txt", size: 3 * MIB }), { ok: false, reason: "size" });
  assert.deepEqual(checkPolicy(policy, { filename: "a.exe", size: 10 }), { ok: false, reason: "type" });
  assert.deepEqual(checkPolicy(policy, { filename: "README", size: 10 }), { ok: false, reason: "type" });
  const open = normalizePolicy({});
  assert.deepEqual(checkPolicy(open, { filename: "README", size: 10 }), { ok: true });
  assert.equal(fileExtension(".hidden"), "");
  assert.equal(fileExtension("dir/archive.tar.GZ"), "gz");
});

test("a file takes the air unless someone is typing, and later laps stay up longer", () => {
  assert.equal(carrierYieldsToFile("beacon", 0, 280, 1), true);
  assert.equal(carrierYieldsToFile("draft", 10_000, 280, 1), false);
  assert.equal(carrierYieldsToFile("commit", 100, 280, 1), false);
  assert.equal(carrierYieldsToFile("commit", 280, 280, 1), true);
  assert.equal(carrierYieldsToFile("commit", 5_000, 280, 0), false);
  const first = airBudget(0);
  const later = airBudget(3);
  assert.ok(later.repeatFactor > first.repeatFactor);
  assert.ok(later.minDwellMs > first.minDwellMs);
  assert.ok(dwellFrames(1, 24, first) < dwellFrames(1, 24, later));
  assert.deepEqual(airBudget(99), airBudget(4));
});

test("carousel dwell covers both the minimum time and the symbol budget", () => {
  const policy = { repeatFactor: 1.25, minDwellMs: 8000 };
  assert.equal(dwellFrames(1, 15, policy), 120);
  assert.equal(dwellFrames(1000, 15, policy), 1250);
  assert.equal(dwellFrames(0, 0, policy), 8);
});

test("carousel walks the queue in order and wraps", () => {
  const ids = ["a", "b", "c"];
  assert.equal(nextOnAir([], null), null);
  assert.deepEqual(nextOnAir(ids, null), { id: "a", wrapped: false });
  assert.deepEqual(nextOnAir(ids, "a"), { id: "b", wrapped: false });
  assert.deepEqual(nextOnAir(ids, "c"), { id: "a", wrapped: true });
  // "b" was removed while on air from index 1: the item now in that slot goes next.
  assert.deepEqual(nextOnAir(["a", "c"], "b", 1), { id: "c", wrapped: false });
  assert.deepEqual(nextOnAir(["a"], "b", 1), { id: "a", wrapped: true });
});

test("inbox dedups by SHA-256 and evicts the oldest to fit", () => {
  const existing = [
    { sha: "old", size: 40, receivedAt: 1 },
    { sha: "mid", size: 40, receivedAt: 2 },
    { sha: "new", size: 10, receivedAt: 3 },
  ];
  assert.deepEqual(planInboxInsert(existing, { sha: "mid", size: 40, receivedAt: 9 }), { duplicate: true });
  assert.deepEqual(planInboxInsert(existing, { sha: "x", size: 5, receivedAt: 9 }, 3, 1000), {
    duplicate: false,
    evict: ["old"],
  });
  assert.deepEqual(planInboxInsert(existing, { sha: "x", size: 60, receivedAt: 9 }, 10, 100), {
    duplicate: false,
    evict: ["old", "mid"],
  });
  assert.deepEqual(planInboxInsert([], { sha: "x", size: 1, receivedAt: 1 }), { duplicate: false, evict: [] });
});

async function onAir(text, name, sessionId, blockLen) {
  const original = new TextEncoder().encode(text);
  const envelope = await packEnvelope(original, name, "text/plain");
  const encoder = new LTEncoder(envelope.bytes, blockLen, sessionId);
  const header = {
    sessionId,
    seq: 0,
    k: encoder.k,
    blockLen,
    totalLen: envelope.bytes.length,
    payloadFnv: fnv1a(envelope.bytes),
  };
  return { original, envelope, encoder, header, nextSeq: 0 };
}

test("two carousel objects decode in sequence, with drops, across turns", async () => {
  const blockLen = 300;
  const a = await onAir("telemetry sample A\n".repeat(400), "a.txt", 101, blockLen);
  const b = await onAir("dashboard update B\n".repeat(250), "b.txt", 202, blockLen);
  const policy = { repeatFactor: 1.25, minDwellMs: 0 };
  const queue = [a, b];

  const decoders = new Map();
  const completed = new Map();
  let current = null;
  let drop = 0;

  // Two full turns, dropping roughly half the frames: the first turn alone is not enough.
  for (let turn = 0; turn < 4 && completed.size < 2; turn++) {
    for (const item of queue) {
      current = nextOnAir(queue.map((q) => String(q.header.sessionId)), current)?.id ?? null;
      assert.equal(current, String(item.header.sessionId));
      const frames = dwellFrames(item.encoder.k, 15, policy);
      for (let i = 0; i < frames; i++) {
        const seq = item.nextSeq++;
        const wire = packFrame({ ...item.header, seq }, item.encoder.encode(seq));
        if (drop++ % 2 === 0) continue;
        const parsed = parseFrame(wire);
        assert.ok(parsed);
        const key = parsed.header.sessionId;
        if (completed.has(key)) continue;
        let decoder = decoders.get(key);
        if (!decoder) {
          decoder = new LTDecoder(parsed.header.k, parsed.header.blockLen, key, parsed.header.totalLen);
          decoders.set(key, decoder);
        }
        decoder.addFrame(parsed.header.seq, parsed.block);
        if (decoder.isComplete) {
          const payload = decoder.assemble();
          assert.equal(fnv1a(payload), parsed.header.payloadFnv);
          completed.set(key, payload);
          decoders.delete(key);
        }
      }
    }
  }

  assert.equal(completed.size, 2);
  for (const item of queue) {
    const payload = completed.get(item.header.sessionId);
    const parsed = await parseEnvelope(payload);
    assert.deepEqual(parsed?.file, item.original);
    const digest = envelopeDigest(payload);
    assert.equal(digest?.length, 32);
  }
  assert.notEqual(
    toHex(envelopeDigest(completed.get(101))),
    toHex(envelopeDigest(completed.get(202))),
  );
});

test("a live carrier keeps the latest text and never needs a one-second cutoff", () => {
  const draft = { kind: "draft", epoch: 7, seq: 3, text: "ciao" };
  assert.deepEqual(decodeLiveRecord(encodeLiveRecord(draft)), draft);
  const beacon = decodeLiveRecord(encodeLiveRecord({ kind: "beacon", epoch: 4, seq: 1, text: "" }));
  assert.equal(beacon?.kind, "beacon");
  assert.equal(beacon?.text, "");
  assert.deepEqual(decodeLiveRecord(new TextEncoder().encode("  ciao\u0000 ")), {
    kind: "commit",
    epoch: 0,
    seq: 0,
    text: "ciao",
  });
  assert.equal(decodeLiveRecord(new Uint8Array()), null);
  assert.equal(decodeLiveText(new TextEncoder().encode("  ciao ")), "ciao");
  assert.equal(isLiveMime("text/x-wayfold-live; charset=utf-8"), true);
  assert.equal(isLiveMime("text/plain"), false);
  assert.equal(isNewerLive(null, draft), true);
  assert.equal(isNewerLive({ epoch: 7, seq: 3 }, draft), false);
  assert.equal(isNewerLive({ epoch: 7, seq: 3 }, { ...draft, seq: 4 }), true);
  assert.equal(isNewerLive({ epoch: 7, seq: 9 }, { ...draft, epoch: 8, seq: 1 }), true);
  assert.ok(LIVE_HOLD_MS >= 200 && LIVE_HOLD_MS < dwellFrames(1, 24, DEFAULT_POLICY) * (1000 / 24));
});

test("envelope digest matches the SHA-256 of the original file", async () => {
  const original = new TextEncoder().encode("same content");
  const one = await packEnvelope(original, "one.txt", "text/plain");
  const two = await packEnvelope(original, "renamed.txt", "text/plain");
  const expected = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", original)));
  assert.equal(toHex(envelopeDigest(one.bytes)), expected);
  assert.equal(toHex(envelopeDigest(two.bytes)), expected);
  assert.equal(envelopeDigest(new Uint8Array(10)), null);
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { packEnvelope } from "../shared/envelope.ts";
import { LTEncoder } from "../shared/fountain.ts";
import { HEADER_LEN } from "../shared/protocol.ts";
import { DEFAULT_FRAME_BYTES } from "../shared/optical.ts";
import {
  FLAG_KEY,
  VIDEO_FILENAME,
  VIDEO_MIME,
  VideoAssembler,
  decodeVideoPacket,
  encodeConfigPacket,
  encodeVideoPacket,
  maxVideoPacketBytes,
  maxVideoPayloadBytes,
  splitVideoChunk,
} from "../diode/video-wire.ts";

const BLOCK = DEFAULT_FRAME_BYTES - HEADER_LEN;

describe("video wire", () => {
  it("fits a full packet in one fountain block", async () => {
    const payload = new Uint8Array(maxVideoPayloadBytes(BLOCK));
    payload[0] = 7;
    payload[payload.length - 1] = 9;
    const packet = encodeVideoPacket({
      flags: FLAG_KEY,
      streamId: 4,
      seq: 3,
      timestampMs: 1200,
      frag: 0,
      fragCount: 1,
      payload,
    });
    assert.equal(packet.length, maxVideoPacketBytes(BLOCK));
    const packed = await packEnvelope(packet, VIDEO_FILENAME, VIDEO_MIME);
    assert.ok(packed.bytes.length <= BLOCK);
    const encoder = new LTEncoder(packed.bytes, BLOCK, 7);
    assert.equal(encoder.k, 1);
    const decoded = decodeVideoPacket(packet);
    assert.equal(decoded?.flags, FLAG_KEY);
    assert.equal(decoded?.seq, 3);
    assert.equal(decoded?.timestampMs, 1200);
    assert.equal(decoded?.payload.length, payload.length);
    assert.equal(decoded?.payload[0], 7);
    assert.equal(decoded?.payload[payload.length - 1], 9);
  });

  it("reassembles a chunk split across packets and reports a skipped sequence", () => {
    const data = new Uint8Array(4000);
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
    const budget = maxVideoPayloadBytes(BLOCK);
    const first = splitVideoChunk({
      streamId: 9,
      seq: 0,
      timestampMs: 40,
      key: true,
      data,
      payloadMax: budget,
    });
    assert.ok(first.length > 1);
    const second = splitVideoChunk({
      streamId: 9,
      seq: 2,
      timestampMs: 80,
      key: false,
      data: data.subarray(0, 20),
      payloadMax: budget,
    });
    const asm = new VideoAssembler();
    let got: Uint8Array | null = null;
    let gap = 0;
    for (const packet of first) {
      const event = asm.push(decodeVideoPacket(packet)!);
      if (event?.kind === "chunk") got = event.data;
    }
    assert.ok(got);
    assert.equal(got!.length, data.length);
    assert.deepEqual(got, data);
    const next = asm.push(decodeVideoPacket(second[0]!)!);
    assert.equal(next?.kind, "chunk");
    if (next?.kind === "chunk") {
      gap = next.gap;
      assert.equal(next.key, false);
      assert.equal(next.broken, false);
    }
    assert.equal(gap, 1);
  });

  it("marks a chunk broken when a fragment never arrives", () => {
    const asm = new VideoAssembler();
    const partial = encodeVideoPacket({
      flags: 0,
      streamId: 1,
      seq: 0,
      timestampMs: 0,
      frag: 0,
      fragCount: 2,
      payload: new Uint8Array([1, 2, 3]),
    });
    assert.equal(asm.push(decodeVideoPacket(partial)!), null);
    const rest = encodeVideoPacket({
      flags: FLAG_KEY,
      streamId: 1,
      seq: 1,
      timestampMs: 10,
      frag: 0,
      fragCount: 1,
      payload: new Uint8Array([9]),
    });
    const event = asm.push(decodeVideoPacket(rest)!);
    assert.equal(event?.kind, "chunk");
    if (event?.kind === "chunk") {
      assert.equal(event.broken, true);
      assert.equal(event.gap, 0);
      assert.equal(event.key, true);
      assert.deepEqual(event.data, new Uint8Array([9]));
    }
  });

  it("round-trips the decoder configuration", () => {
    const description = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const packet = encodeConfigPacket({
      streamId: 2,
      seq: 4,
      codec: "avc1.42001e",
      description,
      payloadMax: maxVideoPayloadBytes(BLOCK),
    });
    assert.ok(packet);
    const asm = new VideoAssembler();
    const event = asm.push(decodeVideoPacket(packet!)!);
    assert.equal(event?.kind, "config");
    if (event?.kind === "config") {
      assert.equal(event.codec, "avc1.42001e");
      assert.deepEqual(event.description, description);
      assert.equal(event.fresh, true);
    }
  });
});

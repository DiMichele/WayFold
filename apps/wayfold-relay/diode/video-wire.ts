import { ENVELOPE_FIXED_LEN } from "../shared/limits.ts";
import { DEFAULT_FRAME_BYTES } from "../shared/optical.ts";
import { HEADER_LEN } from "../shared/protocol.ts";

/** One H.264 access unit, or the decoder config, rides the same envelope as a chat line. */
export const VIDEO_MIME = "video/x-wf-avc";
export const VIDEO_FILENAME = "v";

/**
 * How long one packet stays on the QR. Same floor as a chat draft: long enough
 * for a camera exposure to freeze a single code, short enough to keep a stream moving.
 */
export const VIDEO_HOLD_MS = 280;

/** QCIF, macroblock-aligned. Small enough that a P-frame fits in one QR. */
export const VIDEO_WIDTH = 176;
export const VIDEO_HEIGHT = 144;
/**
 * Two frames a second leaves room for a keyframe that spills into a second QR.
 * Three frames at 32 kbps filled the queue on a real camera and dropped packets.
 */
export const VIDEO_FPS = 2;
export const VIDEO_BITRATE = 16_000;
/** Keyframe interval in encoded frames. At 2 fps a loss waits about two seconds. */
export const VIDEO_GOP = 4;

const MAGIC = [0x57, 0x46, 0x56, 0x31]; // WFV1
const VERSION = 1;

/** magic, version, flags, stream, seq, timestamp, frag, fragCount. */
export const VIDEO_PACKET_HEADER = 18;

export const FLAG_KEY = 0x01;
export const FLAG_CONFIG = 0x02;

export function isVideoMime(mime: string): boolean {
  return mime.split(";")[0]!.trim().toLowerCase() === VIDEO_MIME;
}

export function videoEnvelopeOverhead(): number {
  return ENVELOPE_FIXED_LEN + VIDEO_FILENAME.length + VIDEO_MIME.length;
}

/** Biggest packet that still fits in one fountain block, so one camera read completes it. */
export function maxVideoPacketBytes(blockLen = DEFAULT_FRAME_BYTES - HEADER_LEN): number {
  return Math.max(0, blockLen - videoEnvelopeOverhead());
}

export function maxVideoPayloadBytes(blockLen = DEFAULT_FRAME_BYTES - HEADER_LEN): number {
  return Math.max(0, maxVideoPacketBytes(blockLen) - VIDEO_PACKET_HEADER);
}

export interface VideoPacket {
  flags: number;
  streamId: number;
  seq: number;
  timestampMs: number;
  frag: number;
  fragCount: number;
  payload: Uint8Array;
}

export function encodeVideoPacket(packet: VideoPacket): Uint8Array {
  const out = new Uint8Array(VIDEO_PACKET_HEADER + packet.payload.length);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  out[5] = packet.flags & 0xff;
  const view = new DataView(out.buffer);
  view.setUint16(6, packet.streamId & 0xffff, true);
  view.setUint32(8, packet.seq >>> 0, true);
  view.setUint32(12, packet.timestampMs >>> 0, true);
  out[16] = packet.frag & 0xff;
  out[17] = packet.fragCount & 0xff;
  out.set(packet.payload, VIDEO_PACKET_HEADER);
  return out;
}

export function decodeVideoPacket(bytes: Uint8Array): VideoPacket | null {
  if (bytes.length < VIDEO_PACKET_HEADER) return null;
  if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== MAGIC[2] || bytes[3] !== MAGIC[3]) return null;
  if (bytes[4] !== VERSION) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frag = bytes[16]!;
  const fragCount = bytes[17]!;
  if (fragCount === 0 || frag >= fragCount) return null;
  return {
    flags: bytes[5]!,
    streamId: view.getUint16(6, true),
    seq: view.getUint32(8, true),
    timestampMs: view.getUint32(12, true),
    frag,
    fragCount,
    payload: bytes.subarray(VIDEO_PACKET_HEADER),
  };
}

export function splitVideoChunk(options: {
  streamId: number;
  seq: number;
  timestampMs: number;
  key: boolean;
  data: Uint8Array;
  payloadMax: number;
}): Uint8Array[] {
  if (options.payloadMax < 1) throw new RangeError("video payload budget");
  const count = Math.max(1, Math.ceil(options.data.length / options.payloadMax));
  if (count > 255) throw new RangeError("video chunk exceeds 255 packets");
  const flags = options.key ? FLAG_KEY : 0;
  const packets: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const payload = options.data.subarray(
      i * options.payloadMax,
      Math.min(options.data.length, (i + 1) * options.payloadMax),
    );
    packets.push(
      encodeVideoPacket({
        flags,
        streamId: options.streamId,
        seq: options.seq,
        timestampMs: options.timestampMs >>> 0,
        frag: i,
        fragCount: count,
        payload,
      }),
    );
  }
  return packets;
}

export function encodeConfigPacket(options: {
  streamId: number;
  seq: number;
  codec: string;
  description: Uint8Array;
  payloadMax: number;
}): Uint8Array | null {
  const codecBytes = new TextEncoder().encode(options.codec);
  if (codecBytes.length === 0 || codecBytes.length > 64) return null;
  const payload = new Uint8Array(1 + codecBytes.length + options.description.length);
  payload[0] = codecBytes.length;
  payload.set(codecBytes, 1);
  payload.set(options.description, 1 + codecBytes.length);
  if (payload.length > options.payloadMax) return null;
  return encodeVideoPacket({
    flags: FLAG_CONFIG,
    streamId: options.streamId,
    seq: options.seq,
    timestampMs: 0,
    frag: 0,
    fragCount: 1,
    payload,
  });
}

export function decodeConfigPayload(payload: Uint8Array): { codec: string; description: Uint8Array } | null {
  if (payload.length < 2) return null;
  const len = payload[0]!;
  if (len === 0 || len > 64 || 1 + len > payload.length) return null;
  let codec: string;
  try {
    codec = new TextDecoder("utf-8", { fatal: true }).decode(payload.subarray(1, 1 + len));
  } catch {
    return null;
  }
  const description = payload.subarray(1 + len);
  if (description.length === 0) return null;
  return { codec, description };
}

export type AssembledVideo =
  | {
      kind: "config";
      streamId: number;
      seq: number;
      gap: number;
      broken: boolean;
      fresh: boolean;
      codec: string;
      description: Uint8Array;
    }
  | {
      kind: "chunk";
      streamId: number;
      seq: number;
      gap: number;
      broken: boolean;
      fresh: boolean;
      key: boolean;
      timestampMs: number;
      data: Uint8Array;
    };

interface PartialChunk {
  seq: number;
  timestampMs: number;
  key: boolean;
  count: number;
  parts: (Uint8Array | undefined)[];
  got: number;
  gap: number;
  fresh: boolean;
  broken: boolean;
}

/**
 * Puts fragments of one access unit back together.
 * `gap` is how many sequence numbers were skipped.
 * `broken` means the previous access unit never arrived whole.
 * `fresh` is the first packet of a new stream id.
 */
export class VideoAssembler {
  private streamId: number | null = null;
  private expected = 0;
  private haveExpected = false;
  private brokenPending = false;
  private partial: PartialChunk | null = null;

  reset(): void {
    this.streamId = null;
    this.expected = 0;
    this.haveExpected = false;
    this.brokenPending = false;
    this.partial = null;
  }

  push(packet: VideoPacket): AssembledVideo | null {
    let fresh = false;
    if (this.streamId !== packet.streamId) {
      this.streamId = packet.streamId;
      this.expected = 0;
      this.haveExpected = false;
      this.brokenPending = false;
      this.partial = null;
      fresh = true;
    }

    if ((packet.flags & FLAG_CONFIG) !== 0) {
      if (this.partial && this.partial.got < this.partial.count) this.brokenPending = true;
      this.partial = null;
      const parsed = decodeConfigPayload(packet.payload);
      if (!parsed) return null;
      const gap = this.observe(packet.seq);
      if (gap < 0) return null;
      const broken = this.brokenPending;
      this.brokenPending = false;
      return {
        kind: "config",
        streamId: packet.streamId,
        seq: packet.seq,
        gap,
        broken,
        fresh,
        codec: parsed.codec,
        description: parsed.description,
      };
    }

    if (this.partial && this.partial.seq !== packet.seq) {
      if (this.partial.got < this.partial.count) this.brokenPending = true;
      this.partial = null;
    }

    if (!this.partial) {
      const gap = this.observe(packet.seq);
      if (gap < 0) return null;
      const broken = this.brokenPending;
      this.brokenPending = false;
      this.partial = {
        seq: packet.seq,
        timestampMs: packet.timestampMs,
        key: (packet.flags & FLAG_KEY) !== 0,
        count: packet.fragCount,
        parts: Array.from({ length: packet.fragCount }),
        got: 0,
        gap,
        fresh,
        broken,
      };
    }

    const part = this.partial;
    if (packet.fragCount !== part.count || packet.frag >= part.count) return null;
    if (part.parts[packet.frag]) return null;
    if ((packet.flags & FLAG_KEY) !== 0) part.key = true;
    part.parts[packet.frag] = packet.payload;
    part.got++;
    if (part.got < part.count) return null;

    let size = 0;
    for (const piece of part.parts) size += piece?.length ?? 0;
    const data = new Uint8Array(size);
    let offset = 0;
    for (const piece of part.parts) {
      if (!piece) return null;
      data.set(piece, offset);
      offset += piece.length;
    }
    const done = part;
    this.partial = null;
    return {
      kind: "chunk",
      streamId: packet.streamId,
      seq: done.seq,
      gap: done.gap,
      broken: done.broken,
      fresh: done.fresh,
      key: done.key,
      timestampMs: done.timestampMs,
      data,
    };
  }

  /** Negative when `seq` was already consumed. */
  private observe(seq: number): number {
    const value = seq >>> 0;
    if (!this.haveExpected) {
      this.haveExpected = true;
      this.expected = (value + 1) >>> 0;
      return 0;
    }
    if (value < this.expected) return -1;
    const gap = (value - this.expected) >>> 0;
    this.expected = (value + 1) >>> 0;
    return gap;
  }
}

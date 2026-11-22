/**
 * WFL1 optical frame. Every QR carries exactly one of these, zero-padded to the
 * modem's MTU so the QR version (and therefore the module size) never changes.
 *
 *   0  magic "W1"
 *   2  kind    u8   OFFER | REQUEST | SEALED
 *   3  dir     u8   DOWN (gateway -> client) | UP (client -> gateway)
 *   4  linkId  u32  random per gateway session
 *   8  seq     u32  per-direction frame counter (AES-GCM nonce)
 *  12  bodyLen u16
 *  14  body
 */

export const MAGIC0 = 0x57;
export const MAGIC1 = 0x31;
export const HEADER_LEN = 14;

export const KIND_OFFER = 1;
export const KIND_REQUEST = 2;
export const KIND_SEALED = 3;

export const DIR_DOWN = 0;
export const DIR_UP = 1;

export const GCM_TAG_LEN = 16;
/** nextExpected u32 + sack u64 + echoSeq u32 + segNo u32 + segLen u16 */
export const SEALED_OVERHEAD = 22;
export const MIN_MTU = 200;
export const MAX_MTU = 2900;

export interface WireHeader {
  kind: number;
  dir: number;
  linkId: number;
  seq: number;
}

export interface WireFrame {
  header: WireHeader;
  /** The 14 header bytes, used as AES-GCM additional data. */
  aad: Uint8Array;
  body: Uint8Array;
}

export function packWire(h: WireHeader, body: Uint8Array, mtu: number): Uint8Array {
  const total = Math.max(mtu, HEADER_LEN + body.length);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out[0] = MAGIC0;
  out[1] = MAGIC1;
  out[2] = h.kind;
  out[3] = h.dir;
  dv.setUint32(4, h.linkId >>> 0);
  dv.setUint32(8, h.seq >>> 0);
  dv.setUint16(12, body.length);
  out.set(body, HEADER_LEN);
  return out;
}

export function headerBytes(h: WireHeader, bodyLen: number): Uint8Array {
  const out = new Uint8Array(HEADER_LEN);
  const dv = new DataView(out.buffer);
  out[0] = MAGIC0;
  out[1] = MAGIC1;
  out[2] = h.kind;
  out[3] = h.dir;
  dv.setUint32(4, h.linkId >>> 0);
  dv.setUint32(8, h.seq >>> 0);
  dv.setUint16(12, bodyLen);
  return out;
}

export function parseWire(bytes: Uint8Array): WireFrame | null {
  if (bytes.length < HEADER_LEN || bytes[0] !== MAGIC0 || bytes[1] !== MAGIC1) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = bytes[2]!;
  const dir = bytes[3]!;
  if (kind < KIND_OFFER || kind > KIND_SEALED || dir > DIR_UP) return null;
  const bodyLen = dv.getUint16(12);
  if (HEADER_LEN + bodyLen > bytes.length) return null;
  return {
    header: { kind, dir, linkId: dv.getUint32(4), seq: dv.getUint32(8) },
    aad: bytes.subarray(0, HEADER_LEN),
    body: bytes.subarray(HEADER_LEN, HEADER_LEN + bodyLen),
  };
}

/** Largest ARQ segment payload that fits in a sealed frame of this MTU. */
export function maxSegmentData(mtu: number): number {
  return mtu - HEADER_LEN - GCM_TAG_LEN - SEALED_OVERHEAD;
}

export function clampMtu(mtu: number): number {
  if (!Number.isFinite(mtu)) return 1000;
  return Math.max(MIN_MTU, Math.min(MAX_MTU, Math.round(mtu)));
}

// --- pairing bodies (plaintext) ---

export const OFFER_IDLE = 0;
export const OFFER_PENDING = 1;
export const OFFER_REJECTED = 2;

export interface OfferBody {
  gatewayPub: Uint8Array;
  status: number;
  /** First 8 bytes of SHA-256(client pub) the status refers to, zeros when idle. */
  clientHash: Uint8Array;
  name: string;
}

export interface RequestBody {
  clientPub: Uint8Array;
  name: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });

function nameBytes(name: string): Uint8Array {
  const raw = enc.encode(name);
  return raw.length > 64 ? raw.subarray(0, 64) : raw;
}

export function packOffer(b: OfferBody): Uint8Array {
  const name = nameBytes(b.name);
  const out = new Uint8Array(32 + 1 + 8 + 1 + name.length);
  out.set(b.gatewayPub, 0);
  out[32] = b.status;
  out.set(b.clientHash.subarray(0, 8), 33);
  out[41] = name.length;
  out.set(name, 42);
  return out;
}

export function parseOffer(body: Uint8Array): OfferBody | null {
  if (body.length < 42) return null;
  const nameLen = body[41]!;
  if (body.length < 42 + nameLen) return null;
  return {
    gatewayPub: body.slice(0, 32),
    status: body[32]!,
    clientHash: body.slice(33, 41),
    name: dec.decode(body.subarray(42, 42 + nameLen)),
  };
}

export function packRequest(b: RequestBody): Uint8Array {
  const name = nameBytes(b.name);
  const out = new Uint8Array(32 + 1 + name.length);
  out.set(b.clientPub, 0);
  out[32] = name.length;
  out.set(name, 33);
  return out;
}

export function parseRequest(body: Uint8Array): RequestBody | null {
  if (body.length < 33) return null;
  const nameLen = body[32]!;
  if (body.length < 33 + nameLen) return null;
  return { clientPub: body.slice(0, 32), name: dec.decode(body.subarray(33, 33 + nameLen)) };
}

// --- sealed plaintext ---

export interface SealedPlain {
  nextExpected: number;
  sackLo: number;
  sackHi: number;
  /** Highest frame seq seen from the peer, 0xffffffff before the first one: gives the RTT. */
  echoSeq: number;
  /** -1 when the frame carries only acks */
  segNo: number;
  segData: Uint8Array;
}

export const NO_ECHO = 0xffffffff;

export function packSealedPlain(p: SealedPlain): Uint8Array {
  const out = new Uint8Array(SEALED_OVERHEAD + p.segData.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, p.nextExpected >>> 0);
  dv.setUint32(4, p.sackLo >>> 0);
  dv.setUint32(8, p.sackHi >>> 0);
  dv.setUint32(12, p.echoSeq >>> 0);
  dv.setUint32(16, p.segNo < 0 ? 0 : p.segNo >>> 0);
  dv.setUint16(20, p.segNo < 0 ? 0xffff : p.segData.length);
  out.set(p.segData, SEALED_OVERHEAD);
  return out;
}

export function parseSealedPlain(bytes: Uint8Array): SealedPlain | null {
  if (bytes.length < SEALED_OVERHEAD) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const segLen = dv.getUint16(20);
  const base = {
    nextExpected: dv.getUint32(0),
    sackLo: dv.getUint32(4),
    sackHi: dv.getUint32(8),
    echoSeq: dv.getUint32(12),
  };
  if (segLen === 0xffff) return { ...base, segNo: -1, segData: new Uint8Array(0) };
  if (SEALED_OVERHEAD + segLen > bytes.length) return null;
  return {
    ...base,
    segNo: dv.getUint32(16),
    segData: bytes.subarray(SEALED_OVERHEAD, SEALED_OVERHEAD + segLen),
  };
}

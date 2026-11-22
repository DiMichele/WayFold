import {
  ENVELOPE_FIXED_LEN,
  MAX_FILENAME_BYTES,
  MAX_MIME_BYTES,
  MAX_ORIGINAL_FILE_LEN,
  MAX_WIRE_PAYLOAD_LEN,
} from "./limits.ts";
import { sha256Bytes } from "./sha256.ts";

const MAGIC = new Uint8Array([0x44, 0x43, 0x4d, 0x4e]); // DCMN
const ENVELOPE_VERSION = 1;
export const FLAG_GZIP = 0x01;
const KNOWN_FLAGS = FLAG_GZIP;
const SHA256_LEN = 32;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

/** Media types gzip cannot shrink. Trying anyway costs a full extra copy of the file. */
const PRECOMPRESSED_TYPES = new Set([
  "application/gzip",
  "application/java-archive",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "application/x-brotli",
  "application/x-bzip",
  "application/x-bzip2",
  "application/x-gzip",
  "application/x-lzma",
  "application/x-rar-compressed",
  "application/x-xz",
  "application/x-zip-compressed",
  "application/zip",
  "application/zstd",
]);

const COMPRESSIBLE_IMAGES = /^image\/(bmp|x-ms-bmp|svg\+xml|tiff|x-icon|vnd\.microsoft\.icon)$/;
const COMPRESSIBLE_AUDIO = /^audio\/(wav|x-wav|wave|vnd\.wave|aiff|x-aiff|basic|l16)$/;

export function isPrecompressedType(type: string): boolean {
  const media = type.split(";")[0]!.trim().toLowerCase();
  if (media.startsWith("video/")) return true;
  if (media.startsWith("image/")) return !COMPRESSIBLE_IMAGES.test(media);
  if (media.startsWith("audio/")) return !COMPRESSIBLE_AUDIO.test(media);
  if (media.startsWith("application/vnd.openxmlformats-officedocument.")) return true;
  if (media.startsWith("application/vnd.oasis.opendocument.")) return true;
  if (media.endsWith("+zip")) return true;
  return PRECOMPRESSED_TYPES.has(media);
}

/** Gzip is worth attempting only when the file is large enough and not already compressed. */
export function shouldTryGzip(mime: string, length: number): boolean {
  return length >= 768 && !isPrecompressedType(mime);
}

export const PREVIEW_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export interface PackedEnvelope {
  bytes: Uint8Array;
  compressed: boolean;
  originalLen: number;
  wireFileLen: number;
}

export interface ParsedEnvelope {
  filename: string;
  mime: string;
  file: Uint8Array;
  compressed: boolean;
}

export function sanitizeFilename(value: string): string | null {
  const basename = value.split(/[\\/]/).pop() ?? "";
  const clean = basename.replace(/[\0-\x1f\x7f]/g, "").trim();
  if (!clean || clean === "." || clean === "..") return null;
  const encoded = textEncoder.encode(clean);
  return encoded.length <= MAX_FILENAME_BYTES ? clean : null;
}

function normalizeMime(value: string): string | null {
  if (/[\0-\x1f\x7f]/.test(value)) return null;
  const clean = value.trim().toLowerCase() || "application/octet-stream";
  return textEncoder.encode(clean).length <= MAX_MIME_BYTES ? clean : null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i]! ^ b[i]!;
  return different === 0;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  zip: "application/zip",
  txt: "text/plain",
  json: "application/json",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

/** iOS photo picks often have an empty `file.type`. Guessing keeps JPEG out of gzip. */
export function fileMime(name: string, type: string): string {
  const declared = type.trim();
  if (declared) return declared;
  const ext = name.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      // Copy: subtle.digest detaches its input on some engines.
      return new Uint8Array(await subtle.digest("SHA-256", Uint8Array.from(bytes)));
    } catch {
      // file:// on iOS has no working Web Crypto.
    }
  }
  return sha256Bytes(bytes);
}

async function collectStreamLimited(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel("output limit exceeded");
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function gzipIfSmaller(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const compressed = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const candidate = await collectStreamLimited(compressed, bytes.length);
    return candidate && candidate.length < bytes.length ? candidate : null;
  } catch {
    return null;
  }
}

async function gunzipLimited(
  bytes: Uint8Array,
  expectedLength: number,
): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  const output = new Uint8Array(expectedLength);
  let offset = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const decompressed = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    reader = decompressed.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > expectedLength || offset + value.length > MAX_ORIGINAL_FILE_LEN) {
        await reader.cancel("decompressed output exceeds declared length");
        return null;
      }
      output.set(value, offset);
      offset += value.length;
    }
  } catch {
    return null;
  } finally {
    reader?.releaseLock();
  }
  return offset === expectedLength ? output : null;
}

export async function packEnvelope(
  original: Uint8Array,
  rawFilename: string,
  rawMime: string,
): Promise<PackedEnvelope> {
  if (original.length === 0 || original.length > MAX_ORIGINAL_FILE_LEN) {
    throw new RangeError("file size is outside the supported range");
  }
  const filename = sanitizeFilename(rawFilename);
  const mime = normalizeMime(rawMime);
  if (!filename || !mime) throw new TypeError("invalid file metadata");

  const nameBytes = textEncoder.encode(filename);
  const mimeBytes = textEncoder.encode(mime);
  const compressed = shouldTryGzip(mime, original.length) ? await gzipIfSmaller(original) : null;
  const wireFile = compressed ?? original;
  const flags = compressed ? FLAG_GZIP : 0;
  const totalLen = ENVELOPE_FIXED_LEN + nameBytes.length + mimeBytes.length + wireFile.length;
  if (!Number.isSafeInteger(totalLen) || totalLen > MAX_WIRE_PAYLOAD_LEN) {
    throw new RangeError("wrapped payload is too large");
  }

  const out = new Uint8Array(totalLen);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  view.setUint8(4, ENVELOPE_VERSION);
  view.setUint8(5, flags);
  view.setUint16(6, nameBytes.length, true);
  view.setUint16(8, mimeBytes.length, true);
  view.setUint32(10, wireFile.length, true);
  view.setUint32(14, original.length, true);
  out.set(await sha256(original), 18);
  let offset = ENVELOPE_FIXED_LEN;
  out.set(nameBytes, offset);
  offset += nameBytes.length;
  out.set(mimeBytes, offset);
  offset += mimeBytes.length;
  out.set(wireFile, offset);

  return {
    bytes: out,
    compressed: Boolean(compressed),
    originalLen: original.length,
    wireFileLen: wireFile.length,
  };
}

/** SHA-256 of the original file as declared in the header; only trust it after parseEnvelope succeeds. */
export function envelopeDigest(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < ENVELOPE_FIXED_LEN) return null;
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) return null;
  }
  return bytes.slice(18, 18 + SHA256_LEN);
}

export async function parseEnvelope(bytes: Uint8Array): Promise<ParsedEnvelope | null> {
  try {
    if (bytes.length < ENVELOPE_FIXED_LEN || bytes.length > MAX_WIRE_PAYLOAD_LEN) return null;
    for (let i = 0; i < MAGIC.length; i++) {
      if (bytes[i] !== MAGIC[i]) return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint8(4) !== ENVELOPE_VERSION) return null;
    const flags = view.getUint8(5);
    if ((flags & ~KNOWN_FLAGS) !== 0) return null;
    const nameLen = view.getUint16(6, true);
    const mimeLen = view.getUint16(8, true);
    const fileLen = view.getUint32(10, true);
    const originalLen = view.getUint32(14, true);
    if (nameLen === 0 || nameLen > MAX_FILENAME_BYTES || mimeLen > MAX_MIME_BYTES) return null;
    if (fileLen === 0 || originalLen === 0 || originalLen > MAX_ORIGINAL_FILE_LEN) return null;

    const needed = ENVELOPE_FIXED_LEN + nameLen + mimeLen + fileLen;
    if (!Number.isSafeInteger(needed) || needed !== bytes.length) return null;

    const isGzip = (flags & FLAG_GZIP) !== 0;
    if (!isGzip && fileLen !== originalLen) return null;
    if (isGzip && fileLen >= originalLen) return null;

    const expectedHash = bytes.subarray(18, 18 + SHA256_LEN);
    let offset = ENVELOPE_FIXED_LEN;
    const filename = sanitizeFilename(textDecoder.decode(bytes.subarray(offset, offset + nameLen)));
    offset += nameLen;
    const mime = normalizeMime(textDecoder.decode(bytes.subarray(offset, offset + mimeLen)));
    offset += mimeLen;
    if (!filename || !mime) return null;

    const wireFile = bytes.subarray(offset, offset + fileLen);
    const file = isGzip ? await gunzipLimited(wireFile, originalLen) : Uint8Array.from(wireFile);
    if (!file || file.length !== originalLen) return null;
    if (!bytesEqual(await sha256(file), expectedHash)) return null;
    return { filename, mime, file, compressed: isGzip };
  } catch {
    return null;
  }
}

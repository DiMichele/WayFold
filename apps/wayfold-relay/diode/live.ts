/** Envelope mime for a chat line. RX renders it in the live view and never stores a file. */
export const LIVE_MIME = "text/x-wayfold-live";

export const LIVE_FILENAME = "messaggio.txt";

export const LIVE_MAX_CHARS = 400;

/**
 * Minimum time the current text stays on the QR before a newer draft replaces it.
 * Long enough for a camera to catch several frames, short enough to follow typing.
 * The QR itself does not go dark when this elapses: the same payload keeps repeating
 * until the text changes or the session stops.
 */
export const LIVE_HOLD_MS = 280;

const MAGIC = [0x57, 0x46, 0x4c, 0x31]; // WFL1
const VERSION = 1;
const HEADER_LEN = 14;

export type LiveKind = "beacon" | "draft" | "commit";

export interface LiveRecord {
  kind: LiveKind;
  /** Stable for one transmit session. Zero marks a legacy raw-text line. */
  epoch: number;
  /** Monotonic within an epoch. Zero, with epoch zero, marks a legacy line. */
  seq: number;
  text: string;
}

const KIND_BYTE: Record<LiveKind, number> = { beacon: 1, draft: 2, commit: 3 };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: false });

export function isLiveMime(mime: string): boolean {
  return mime.split(";")[0]!.trim().toLowerCase() === LIVE_MIME;
}

function clip(text: string): string {
  return [...text.replace(/\u0000/g, "")].slice(0, LIVE_MAX_CHARS).join("");
}

export function decodeLiveText(bytes: Uint8Array): string | null {
  const text = clip(textDecoder.decode(bytes)).trim();
  return text ? text : null;
}

export function encodeLiveRecord(record: LiveRecord): Uint8Array {
  const text = textEncoder.encode(clip(record.text));
  const out = new Uint8Array(HEADER_LEN + text.length);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  out[5] = KIND_BYTE[record.kind];
  const view = new DataView(out.buffer);
  view.setUint32(6, record.epoch >>> 0);
  view.setUint32(10, record.seq >>> 0);
  out.set(text, HEADER_LEN);
  return out;
}

function kindFromByte(value: number): LiveKind | null {
  if (value === 1) return "beacon";
  if (value === 2) return "draft";
  if (value === 3) return "commit";
  return null;
}

/** Structured carrier record, or a legacy raw-text line treated as one committed message. */
export function decodeLiveRecord(bytes: Uint8Array): LiveRecord | null {
  if (
    bytes.length >= HEADER_LEN &&
    bytes[0] === MAGIC[0] &&
    bytes[1] === MAGIC[1] &&
    bytes[2] === MAGIC[2] &&
    bytes[3] === MAGIC[3] &&
    bytes[4] === VERSION
  ) {
    const kind = kindFromByte(bytes[5]!);
    if (!kind) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = clip(textDecoder.decode(bytes.subarray(HEADER_LEN)));
    if (kind !== "beacon" && !text.trim()) return null;
    return { kind, epoch: view.getUint32(6), seq: view.getUint32(10), text };
  }
  const text = decodeLiveText(bytes);
  if (!text) return null;
  return { kind: "commit", epoch: 0, seq: 0, text };
}

/** True when `next` is a new carrier state the receiver has not applied yet. */
export function isNewerLive(previous: Pick<LiveRecord, "epoch" | "seq"> | null, next: LiveRecord): boolean {
  if (next.epoch === 0 && next.seq === 0) return true;
  if (!previous || next.epoch !== previous.epoch) return true;
  return next.seq > previous.seq;
}

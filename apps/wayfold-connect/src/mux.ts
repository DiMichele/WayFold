/**
 * Stream multiplexer carried on the ARQ byte stream.
 *
 * Record: type u8 | streamId u32 | len u16 | payload. Records may span
 * several ARQ segments. Control records jump the queue; stream data is
 * served round-robin so one big download cannot starve an HTML request.
 */

export const REC_OPEN = 1;
export const REC_OPEN_OK = 2;
export const REC_OPEN_FAIL = 3;
export const REC_DATA = 4;
export const REC_END = 5;
export const REC_RESET = 6;
export const REC_CLOSE_LINK = 7;

export const FAIL_POLICY = 1;
export const FAIL_DNS = 2;
export const FAIL_CONNECT = 3;
export const FAIL_LIMIT = 4;
export const FAIL_TIMEOUT = 5;

export const CLOSE_USER = 1;
export const CLOSE_IDLE = 2;
export const CLOSE_MAX_SESSION = 3;
export const CLOSE_SHUTDOWN = 4;

const REC_HEADER = 7;
const MAX_DATA_RECORD = 4096;
/** Pause the source socket above this many queued bytes for one stream. */
export const HIGH_WATER = 192 * 1024;
const LOW_WATER = 48 * 1024;

export interface MuxEvents {
  open?(id: number, host: string, port: number): void;
  openOk?(id: number): void;
  openFail?(id: number, reason: number): void;
  data?(id: number, bytes: Uint8Array): void;
  end?(id: number): void;
  reset?(id: number): void;
  closeLink?(reason: number): void;
  drain?(id: number): void;
}

interface Item {
  type: number;
  data: Uint8Array;
}

interface OutStream {
  items: Item[];
  bytes: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const EMPTY = new Uint8Array(0);

function record(type: number, id: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(REC_HEADER + payload.length);
  const dv = new DataView(out.buffer);
  out[0] = type;
  dv.setUint32(1, id >>> 0);
  dv.setUint16(5, payload.length);
  out.set(payload, REC_HEADER);
  return out;
}

export class Mux {
  events: MuxEvents = {};
  private readonly control: Uint8Array[] = [];
  private readonly streams = new Map<number, OutStream>();
  private rr: number[] = [];
  private partial: Uint8Array | null = null;
  private inbuf: Uint8Array = EMPTY;
  /** User payload bytes, for stats and idle detection. */
  dataOut = 0;
  dataIn = 0;

  open(id: number, host: string, port: number): void {
    const h = enc.encode(host);
    const p = new Uint8Array(2 + h.length);
    new DataView(p.buffer).setUint16(0, port);
    p.set(h, 2);
    this.control.push(record(REC_OPEN, id, p));
  }

  openOk(id: number): void {
    this.control.push(record(REC_OPEN_OK, id, EMPTY));
  }

  openFail(id: number, reason: number): void {
    this.control.push(record(REC_OPEN_FAIL, id, Uint8Array.of(reason)));
  }

  reset(id: number): void {
    this.dropStream(id);
    this.control.push(record(REC_RESET, id, EMPTY));
  }

  closeLink(reason: number): void {
    this.control.push(record(REC_CLOSE_LINK, 0, Uint8Array.of(reason)));
  }

  send(id: number, data: Uint8Array): void {
    const s = this.outStream(id);
    for (let off = 0; off < data.length; off += MAX_DATA_RECORD) {
      const chunk = data.slice(off, off + MAX_DATA_RECORD);
      s.items.push({ type: REC_DATA, data: chunk });
      s.bytes += chunk.length;
    }
  }

  end(id: number): void {
    this.outStream(id).items.push({ type: REC_END, data: EMPTY });
  }

  pending(id: number): number {
    return this.streams.get(id)?.bytes ?? 0;
  }

  hasOutput(): boolean {
    return this.partial !== null || this.control.length > 0 || this.rr.length > 0;
  }

  dropStream(id: number): void {
    if (!this.streams.delete(id)) return;
    this.rr = this.rr.filter((x) => x !== id);
  }

  private outStream(id: number): OutStream {
    let s = this.streams.get(id);
    if (!s) {
      s = { items: [], bytes: 0 };
      this.streams.set(id, s);
    }
    if (!this.rr.includes(id)) this.rr.push(id);
    return s;
  }

  /** Next bytes for one ARQ segment, or null when there is nothing to send. */
  pull(max: number): Uint8Array | null {
    const parts: Uint8Array[] = [];
    let room = max;
    const take = (rec: Uint8Array) => {
      if (rec.length <= room) {
        parts.push(rec);
        room -= rec.length;
      } else {
        parts.push(rec.subarray(0, room));
        this.partial = rec.subarray(room);
        room = 0;
      }
    };
    if (this.partial) {
      const p = this.partial;
      this.partial = null;
      take(p);
    }
    while (room > 0 && this.control.length) take(this.control.shift()!);
    while (room > 0 && this.rr.length) {
      const id = this.rr.shift()!;
      const s = this.streams.get(id);
      if (!s || !s.items.length) continue;
      const item = s.items.shift()!;
      s.bytes -= item.data.length;
      if (item.type === REC_DATA) this.dataOut += item.data.length;
      take(record(item.type, id, item.data));
      if (item.type === REC_END) {
        this.streams.delete(id);
        continue;
      }
      if (s.items.length) this.rr.push(id);
      if (s.bytes <= LOW_WATER) this.events.drain?.(id);
    }
    if (!parts.length) return null;
    if (parts.length === 1) return parts[0]!.slice();
    const out = new Uint8Array(max - room);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  /** In-order bytes from the ARQ receiver. */
  feed(bytes: Uint8Array): void {
    let buf: Uint8Array;
    if (this.inbuf.length) {
      buf = new Uint8Array(this.inbuf.length + bytes.length);
      buf.set(this.inbuf);
      buf.set(bytes, this.inbuf.length);
    } else buf = bytes;
    let off = 0;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    while (buf.length - off >= REC_HEADER) {
      const len = dv.getUint16(off + 5);
      if (buf.length - off < REC_HEADER + len) break;
      const type = buf[off]!;
      const id = dv.getUint32(off + 1);
      const payload = buf.slice(off + REC_HEADER, off + REC_HEADER + len);
      off += REC_HEADER + len;
      this.dispatch(type, id, payload);
    }
    this.inbuf = off < buf.length ? buf.slice(off) : EMPTY;
  }

  private dispatch(type: number, id: number, p: Uint8Array): void {
    const ev = this.events;
    switch (type) {
      case REC_OPEN: {
        if (p.length < 3) return;
        const port = new DataView(p.buffer, p.byteOffset, p.byteLength).getUint16(0);
        ev.open?.(id, dec.decode(p.subarray(2)), port);
        return;
      }
      case REC_OPEN_OK:
        ev.openOk?.(id);
        return;
      case REC_OPEN_FAIL:
        ev.openFail?.(id, p[0] ?? 0);
        return;
      case REC_DATA:
        this.dataIn += p.length;
        ev.data?.(id, p);
        return;
      case REC_END:
        ev.end?.(id);
        return;
      case REC_RESET:
        this.dropStream(id);
        ev.reset?.(id);
        return;
      case REC_CLOSE_LINK:
        ev.closeLink?.(p[0] ?? 0);
        return;
    }
  }
}

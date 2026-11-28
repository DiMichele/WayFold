import { CLOSE_SHUTDOWN, FAIL_CONNECT, FAIL_LIMIT, FAIL_POLICY, HIGH_WATER, type Mux, type MuxEvents } from "../../wayfold-connect/src/mux.ts";
import { ClientPeer, GatewayPeer, type Peer, type StreamHost } from "../../wayfold-connect/src/peer.ts";
import type { HelperStatus, ModemLink } from "../modem/modem.ts";

/**
 * The WFL1 link running inside the page, no helper needed.
 *
 * The browsing PC carries Wisp (TCP over WebSocket messages) on mux streams;
 * the sharing PC hands each stream to the Wisp server through a real
 * WebSocket. TLS ends in the browsing PC (epoxy), so neither the sharing PC
 * nor the server sees page contents.
 */

export const WISP_TARGET = "wisp";
export const DESK_TARGET = "desk";
const MAX_TUNNELS = 4;
/** Wisp has no flow control towards the client: past this the sharing PC drops the stream. */
const MAX_BUFFERED = 32 * 1024 * 1024;

export type Role = "share" | "join";

/** Mux carries bytes; Wisp needs message boundaries back. */
function frameMessage(msg: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + msg.length);
  new DataView(out.buffer).setUint32(0, msg.length);
  out.set(msg, 4);
  return out;
}

class Deframer {
  private buf = new Uint8Array(0);

  push(bytes: Uint8Array): Uint8Array[] {
    let buf = bytes;
    if (this.buf.length) {
      buf = new Uint8Array(this.buf.length + bytes.length);
      buf.set(this.buf);
      buf.set(bytes, this.buf.length);
    }
    const out: Uint8Array[] = [];
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let off = 0;
    while (buf.length - off >= 4) {
      const len = dv.getUint32(off);
      if (buf.length - off - 4 < len) break;
      out.push(buf.slice(off + 4, off + 4 + len));
      off += 4 + len;
    }
    this.buf = buf.slice(off);
    return out;
  }
}

// --- browsing PC -------------------------------------------------------------

interface Tunnel {
  deframer: Deframer;
  read: ReadableStreamDefaultController<ArrayBuffer> | null;
  opened: (ok: boolean) => void;
  drained: (() => void) | null;
  done: boolean;
}

export interface WispStreams {
  read: ReadableStream<ArrayBuffer>;
  write: WritableStream<Uint8Array>;
}

class TunnelHost implements StreamHost {
  private mux: Mux | null = null;
  private readonly tunnels = new Map<number, Tunnel>();
  private nextId = 1;

  readonly events: MuxEvents = {
    openOk: (id) => this.tunnels.get(id)?.opened(true),
    openFail: (id) => this.fail(id),
    data: (id, bytes) => {
      const t = this.tunnels.get(id);
      if (!t?.read) return;
      for (const msg of t.deframer.push(bytes)) t.read.enqueue(msg.buffer as ArrayBuffer);
    },
    end: (id) => this.finish(id),
    reset: (id) => this.fail(id),
    drain: (id) => {
      const t = this.tunnels.get(id);
      const wake = t?.drained;
      if (t && wake) {
        t.drained = null;
        wake();
      }
    },
  };

  sessionStart(mux: Mux): void {
    this.mux = mux;
  }

  sessionEnd(): void {
    this.mux = null;
    for (const id of [...this.tunnels.keys()]) this.fail(id);
  }

  linkLost(): void {
    const mux = this.mux;
    for (const id of [...this.tunnels.keys()]) {
      this.fail(id);
      mux?.reset(id);
    }
  }

  openCount(): number {
    return this.tunnels.size;
  }

  get ready(): boolean {
    return this.mux !== null;
  }

  open(host = WISP_TARGET): Promise<WispStreams> {
    const mux = this.mux;
    if (!mux) return Promise.reject(new Error("link not connected"));
    const id = this.nextId;
    this.nextId = (this.nextId + 2) >>> 0 || 1;
    return new Promise((resolve, reject) => {
      const t: Tunnel = { deframer: new Deframer(), read: null, opened: () => undefined, drained: null, done: false };
      const read = new ReadableStream<ArrayBuffer>({
        start: (c) => {
          t.read = c;
        },
        cancel: () => this.close(id, true),
      });
      const write = new WritableStream<Uint8Array>({
        write: async (chunk) => {
          if (t.done || this.mux !== mux) throw new Error("tunnel closed");
          mux.send(id, frameMessage(chunk));
          if (mux.pending(id) > HIGH_WATER) await new Promise<void>((wake) => (t.drained = wake));
        },
        close: () => this.close(id, false),
        abort: () => this.close(id, true),
      });
      t.opened = (ok) => {
        t.opened = () => undefined;
        if (ok) resolve({ read, write });
        else reject(new Error("tunnel refused"));
      };
      this.tunnels.set(id, t);
      mux.open(id, host, 0);
    });
  }

  private close(id: number, hard: boolean): void {
    const t = this.tunnels.get(id);
    if (!t || t.done) return;
    t.done = true;
    this.tunnels.delete(id);
    if (hard) this.mux?.reset(id);
    else this.mux?.end(id);
  }

  private finish(id: number): void {
    const t = this.tunnels.get(id);
    if (!t) return;
    t.done = true;
    this.tunnels.delete(id);
    t.opened(false);
    try {
      t.read?.close();
    } catch {
      /* already closed */
    }
    t.drained?.();
  }

  private fail(id: number): void {
    const t = this.tunnels.get(id);
    if (!t) return;
    t.done = true;
    this.tunnels.delete(id);
    t.opened(false);
    try {
      t.read?.error(new Error("tunnel reset"));
    } catch {
      /* already closed */
    }
    t.drained?.();
  }
}

// --- sharing PC --------------------------------------------------------------

interface Egress {
  ws: WebSocket;
  deframer: Deframer;
  opened: boolean;
  closed: boolean;
}

class WispEgress implements StreamHost {
  private mux: Mux | null = null;
  private readonly conns = new Map<number, Egress>();
  private readonly url: string;
  private deskId: number | null = null;
  private deskFrame = new Deframer();
  deskIn: ((msg: Uint8Array) => void) | null = null;
  onDesk: (() => void) | null = null;
  opened = 0;

  constructor(url: string) {
    this.url = url;
  }

  readonly events: MuxEvents = {
    open: (id, host) => this.onOpen(id, host),
    data: (id, bytes) => {
      if (id === this.deskId) {
        for (const msg of this.deskFrame.push(bytes)) this.deskIn?.(msg);
        return;
      }
      const c = this.conns.get(id);
      if (!c || c.closed || c.ws.readyState !== WebSocket.OPEN) return;
      for (const msg of c.deframer.push(bytes)) c.ws.send(msg);
    },
    end: (id) => {
      if (id === this.deskId) this.deskId = null;
      this.drop(id);
    },
    reset: (id) => {
      if (id === this.deskId) this.deskId = null;
      this.drop(id);
    },
  };

  sessionStart(mux: Mux): void {
    this.mux = mux;
  }

  sessionEnd(): void {
    this.mux = null;
    this.deskId = null;
    for (const id of [...this.conns.keys()]) this.drop(id);
  }

  get hasDesk(): boolean {
    return this.deskId !== null;
  }

  sendDesk(msg: Uint8Array): boolean {
    const mux = this.mux;
    if (!mux || this.deskId === null) return false;
    mux.send(this.deskId, frameMessage(msg));
    return true;
  }

  linkLost(): void {
    const mux = this.mux;
    for (const id of [...this.conns.keys()]) {
      this.drop(id);
      mux?.reset(id);
    }
  }

  openCount(): number {
    return this.conns.size;
  }

  private drop(id: number): void {
    const c = this.conns.get(id);
    if (!c) return;
    c.closed = true;
    this.conns.delete(id);
    c.ws.close();
  }

  private onOpen(id: number, host: string): void {
    const mux = this.mux;
    if (!mux || this.conns.has(id)) return;
    if (host === DESK_TARGET) {
      if (this.deskId !== null) return mux.openFail(id, FAIL_LIMIT);
      this.deskId = id;
      this.deskFrame = new Deframer();
      mux.openOk(id);
      this.onDesk?.();
      return;
    }
    if (host !== WISP_TARGET) return mux.openFail(id, FAIL_POLICY);
    if (this.conns.size >= MAX_TUNNELS) return mux.openFail(id, FAIL_LIMIT);
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      return mux.openFail(id, FAIL_CONNECT);
    }
    ws.binaryType = "arraybuffer";
    const c: Egress = { ws, deframer: new Deframer(), opened: false, closed: false };
    this.conns.set(id, c);
    ws.onopen = () => {
      if (c.closed || this.mux !== mux) return ws.close();
      c.opened = true;
      this.opened++;
      mux.openOk(id);
    };
    ws.onmessage = (e) => {
      if (c.closed || this.mux !== mux || !(e.data instanceof ArrayBuffer)) return;
      mux.send(id, frameMessage(new Uint8Array(e.data)));
      if (mux.pending(id) > MAX_BUFFERED) {
        this.drop(id);
        mux.reset(id);
      }
    };
    ws.onclose = () => {
      if (c.closed) return;
      c.closed = true;
      this.conns.delete(id);
      if (this.mux !== mux) return;
      if (c.opened) mux.end(id);
      else mux.openFail(id, FAIL_CONNECT);
    };
  }
}

// --- the link ------------------------------------------------------------------

class Rates {
  private last = { t: performance.now(), dataIn: 0, dataOut: 0 };
  inBps = 0;
  outBps = 0;

  update(dataIn: number, dataOut: number): void {
    const now = performance.now();
    const dt = (now - this.last.t) / 1000;
    if (dt < 0.9) return;
    this.inBps = Math.max(0, dataIn - this.last.dataIn) / dt;
    this.outBps = Math.max(0, dataOut - this.last.dataOut) / dt;
    this.last = { t: now, dataIn, dataOut };
  }
}

export class LocalLink implements ModemLink {
  readonly role: Role;
  private readonly peer: Peer;
  private readonly tunnels: TunnelHost | null = null;
  private readonly egress: WispEgress | null = null;
  private readonly rates = new Rates();
  private readonly timer: number;
  private readonly listeners = new Set<() => void>();
  private deskIn: ((msg: Uint8Array) => void) | null = null;
  private deskWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private deskOpening = false;
  onDeskReady: (() => void) | null = null;

  constructor(role: Role, name: string, wispUrl: string) {
    this.role = role;
    if (role === "share") {
      this.egress = new WispEgress(wispUrl);
      this.egress.deskIn = (msg) => this.deskIn?.(msg);
      this.egress.onDesk = () => this.onDeskReady?.();
      this.peer = new GatewayPeer({ name, host: this.egress });
    } else {
      this.tunnels = new TunnelHost();
      this.peer = new ClientPeer({ name, host: this.tunnels });
    }
    this.peer.on("change", () => this.listeners.forEach((fn) => fn()));
    this.timer = window.setInterval(() => this.peer.tick(), 500);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  pull(n: number, mtu: number): Uint8Array[] {
    const frames: Uint8Array[] = [];
    for (let i = 0; i < n; i++) {
      const f = this.peer.nextFrame(mtu);
      if (f) frames.push(f);
    }
    return frames;
  }

  push(frame: Uint8Array): void {
    this.peer.onFrame(frame);
  }

  get connected(): boolean {
    return this.peer.state === "connected";
  }

  /** Messages, files and video share one stream. The browsing PC opens it. */
  setDeskReceiver(fn: ((msg: Uint8Array) => void) | null): void {
    this.deskIn = fn;
  }

  get deskOpen(): boolean {
    return this.deskWriter !== null || !!this.egress?.hasDesk;
  }

  sendDesk(msg: Uint8Array): boolean {
    if (this.egress?.sendDesk(msg)) return true;
    if (!this.deskWriter) return false;
    void this.deskWriter.write(msg).catch(() => undefined);
    return true;
  }

  async ensureDesk(): Promise<void> {
    if (this.role !== "join" || !this.tunnels || this.deskWriter || this.deskOpening || !this.connected) return;
    this.deskOpening = true;
    try {
      const streams = await this.tunnels.open(DESK_TARGET);
      if (!this.connected) {
        await streams.write.abort().catch(() => undefined);
        return;
      }
      this.deskWriter = streams.write.getWriter();
      this.onDeskReady?.();
      void this.readDesk(streams.read);
    } catch {
      this.deskWriter = null;
    } finally {
      this.deskOpening = false;
    }
  }

  private async readDesk(read: ReadableStream<ArrayBuffer>): Promise<void> {
    const reader = read.getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        this.deskIn?.(new Uint8Array(next.value));
      }
    } catch {
      /* stream reset */
    } finally {
      this.deskWriter = null;
    }
  }

  /** Browsing PC only: one Wisp connection over the optical link. */
  openTunnel(): Promise<WispStreams> {
    if (!this.tunnels) return Promise.reject(new Error("not the browsing side"));
    return this.tunnels.open();
  }

  status(): HelperStatus {
    const p = this.peer;
    const s = p.session;
    this.rates.update(s?.mux.dataIn ?? 0, s?.mux.dataOut ?? 0);
    const gw = p instanceof GatewayPeer ? p : null;
    const cl = p instanceof ClientPeer ? p : null;
    return {
      role: p.role,
      name: p.name,
      state: p.state,
      code: cl ? (cl.state === "requesting" || cl.state === "connected" ? cl.code : "") : (gw?.pending?.sas ?? gw?.client?.sas ?? ""),
      awaiting: cl ? cl.awaitingApproval : !!gw?.pending,
      linkUp: p.linkUp(),
      rttMs: s ? Math.round(s.sender.srtt) : 0,
      inBps: this.rates.inBps,
      outBps: this.rates.outBps,
      inBytes: s?.mux.dataIn ?? 0,
      outBytes: s?.mux.dataOut ?? 0,
      srttMs: s ? Math.round(s.sender.srtt) : 0,
      retransmits: s?.sender.retransmits ?? 0,
      duplicates: s?.receiver.duplicates ?? 0,
      arqOutstanding: s?.sender.outstanding ?? 0,
      streams: this.tunnels?.openCount() ?? this.egress?.openCount() ?? 0,
      bytesAcked: s?.sender.bytesAcked ?? 0,
    };
  }

  action(name: string): boolean {
    const p = this.peer;
    if (name === "disconnect") return p.disconnect(), true;
    if (p instanceof GatewayPeer) {
      if (name === "authorize") return p.authorize();
      if (name === "reject") return p.reject();
    } else if (name === "reconnect") {
      p.reconnect();
      return true;
    }
    return false;
  }

  close(): void {
    void this.deskWriter?.abort().catch(() => undefined);
    this.deskWriter = null;
    this.peer.disconnect(CLOSE_SHUTDOWN);
    window.clearInterval(this.timer);
    this.listeners.clear();
  }
}

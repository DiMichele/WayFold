import { createServer, isIPv6, type Server, type Socket } from "node:net";
import {
  FAIL_CONNECT,
  FAIL_DNS,
  FAIL_LIMIT,
  FAIL_POLICY,
  FAIL_TIMEOUT,
  HIGH_WATER,
  type Mux,
  type MuxEvents,
} from "./mux.ts";
import type { StreamHost } from "./peer.ts";
import type { Logger } from "./egress.ts";

const OPEN_TIMEOUT_MS = 45_000;
const MAX_HEAD_BYTES = 16 * 1024;

const FAIL_TEXT: Record<number, string> = {
  [FAIL_POLICY]: "bloccata dalla policy del gateway",
  [FAIL_DNS]: "nome non risolto dal gateway",
  [FAIL_CONNECT]: "il server di destinazione non risponde",
  [FAIL_LIMIT]: "troppe connessioni aperte sul gateway",
  [FAIL_TIMEOUT]: "timeout",
};

/** SOCKS5 reply codes (RFC 1928). */
const SOCKS_REPLY: Record<number, number> = {
  [FAIL_POLICY]: 0x02,
  [FAIL_DNS]: 0x04,
  [FAIL_CONNECT]: 0x05,
  [FAIL_LIMIT]: 0x01,
  [FAIL_TIMEOUT]: 0x06,
};

interface Conn {
  socket: Socket;
  target: string;
  opened: boolean;
  sentEnd: boolean;
  closed: boolean;
  up: number;
  down: number;
  since: number;
  settle: ((ok: boolean, reason: number) => void) | null;
}

type ProxyRequest = { host: string; port: number; rest: Buffer; reply: (ok: boolean, reason: number) => void };

/** Client side: local SOCKS5 and HTTP proxies whose connections ride the optical link. */
export class ClientProxy implements StreamHost {
  private mux: Mux | null = null;
  private readonly conns = new Map<number, Conn>();
  private nextId = 1;
  private readonly log: Logger;
  private readonly servers: Server[] = [];
  opened = 0;
  failed = 0;

  constructor(log: Logger) {
    this.log = log;
  }

  readonly events: MuxEvents = {
    openOk: (id) => this.conns.get(id)?.settle?.(true, 0),
    openFail: (id, reason) => this.conns.get(id)?.settle?.(false, reason),
    data: (id, bytes) => {
      const c = this.conns.get(id);
      if (!c || c.closed) return;
      c.down += bytes.length;
      c.socket.write(bytes);
    },
    end: (id) => this.conns.get(id)?.socket.end(),
    reset: (id) => this.drop(id),
    drain: (id) => {
      const s = this.conns.get(id)?.socket;
      if (s?.isPaused() && this.conns.get(id)?.opened) s.resume();
    },
  };

  sessionStart(mux: Mux): void {
    this.mux = mux;
  }

  sessionEnd(): void {
    this.mux = null;
    for (const id of [...this.conns.keys()]) this.drop(id);
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

  list() {
    const now = Date.now();
    return [...this.conns.entries()].map(([id, c]) => ({ id, target: c.target, opened: c.opened, up: c.up, down: c.down, ageMs: now - c.since }));
  }

  private drop(id: number): void {
    const c = this.conns.get(id);
    if (!c) return;
    c.closed = true;
    this.conns.delete(id);
    c.settle?.(false, FAIL_CONNECT);
    c.socket.destroy();
  }

  listenSocks(port: number, host = "127.0.0.1"): Promise<void> {
    return this.listen(port, host, (s) => this.socks(s));
  }

  listenHttp(port: number, host = "127.0.0.1"): Promise<void> {
    return this.listen(port, host, (s) => this.http(s));
  }

  close(): void {
    for (const s of this.servers) s.close();
    this.sessionEnd();
  }

  private listen(port: number, host: string, onConn: (s: Socket) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer({ noDelay: true }, (s) => {
        s.on("error", () => undefined);
        onConn(s);
      });
      server.once("error", reject);
      server.listen(port, host, () => {
        this.servers.push(server);
        resolve();
      });
    });
  }

  /** Open a stream for an already-parsed request and splice the socket onto it. */
  private openStream(socket: Socket, req: ProxyRequest): void {
    const mux = this.mux;
    const target = `${req.host}:${req.port}`;
    if (!mux) {
      req.reply(false, -1);
      socket.destroy();
      return;
    }
    const id = this.nextId++;
    socket.pause();
    const conn: Conn = {
      socket,
      target,
      opened: false,
      sentEnd: false,
      closed: false,
      up: 0,
      down: 0,
      since: Date.now(),
      settle: null,
    };
    this.conns.set(id, conn);
    const timer = setTimeout(() => conn.settle?.(false, FAIL_TIMEOUT), OPEN_TIMEOUT_MS);
    conn.settle = (ok, reason) => {
      conn.settle = null;
      clearTimeout(timer);
      if (conn.closed || this.mux !== mux) return;
      if (!ok) {
        this.failed++;
        this.log("warn", `${target}: ${FAIL_TEXT[reason] ?? `errore ${reason}`}`);
        req.reply(false, reason);
        conn.closed = true;
        this.conns.delete(id);
        socket.end();
        return;
      }
      conn.opened = true;
      this.opened++;
      req.reply(true, 0);
      if (req.rest.length) {
        conn.up += req.rest.length;
        mux.send(id, req.rest);
      }
      socket.resume();
    };

    socket.on("data", (chunk: Buffer) => {
      if (conn.closed || !conn.opened || this.mux !== mux) return;
      conn.up += chunk.length;
      mux.send(id, chunk);
      if (mux.pending(id) > HIGH_WATER) socket.pause();
    });
    socket.on("end", () => {
      if (conn.closed || !conn.opened || this.mux !== mux) return;
      conn.sentEnd = true;
      mux.end(id);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (conn.closed) return;
      conn.closed = true;
      this.conns.delete(id);
      if (this.mux === mux && !conn.sentEnd) mux.reset(id);
    });
    mux.open(id, req.host, req.port);
  }

  // --- SOCKS5 (RFC 1928), no auth, CONNECT only ---

  private socks(socket: Socket): void {
    let buf = Buffer.alloc(0);
    let stage = 0;
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > MAX_HEAD_BYTES) return void socket.destroy();
      if (stage === 0) {
        if (buf.length < 2) return;
        if (buf[0] !== 5) return void socket.destroy();
        const n = buf[1]!;
        if (buf.length < 2 + n) return;
        const methods = buf.subarray(2, 2 + n);
        buf = buf.subarray(2 + n);
        if (!methods.includes(0)) {
          socket.end(Buffer.from([5, 0xff]));
          return;
        }
        socket.write(Buffer.from([5, 0]));
        stage = 1;
      }
      if (stage === 1) {
        if (buf.length < 5) return;
        const cmd = buf[1]!;
        const atyp = buf[3]!;
        let host: string;
        let off: number;
        if (atyp === 1) {
          if (buf.length < 10) return;
          host = [...buf.subarray(4, 8)].join(".");
          off = 8;
        } else if (atyp === 3) {
          const len = buf[4]!;
          if (buf.length < 5 + len + 2) return;
          host = buf.subarray(5, 5 + len).toString("utf8");
          off = 5 + len;
        } else if (atyp === 4) {
          if (buf.length < 22) return;
          const parts: string[] = [];
          for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(4 + i).toString(16));
          host = parts.join(":");
          off = 20;
        } else {
          socket.end(socksReply(0x08));
          return;
        }
        const port = buf.readUInt16BE(off);
        const rest = buf.subarray(off + 2);
        socket.off("data", onData);
        if (cmd !== 1) {
          socket.end(socksReply(0x07));
          return;
        }
        this.openStream(socket, {
          host,
          port,
          rest: Buffer.from(rest),
          reply: (ok, reason) => {
            if (socket.destroyed) return;
            socket.write(socksReply(ok ? 0 : reason === -1 ? 0x03 : (SOCKS_REPLY[reason] ?? 0x01)));
          },
        });
      }
    };
    socket.on("data", onData);
  }

  // --- HTTP proxy: CONNECT tunnels plus plain absolute-form requests ---

  private http(socket: Socket): void {
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) {
        if (buf.length > MAX_HEAD_BYTES) socket.destroy();
        return;
      }
      socket.off("data", onData);
      const head = buf.subarray(0, end).toString("latin1");
      const rest = buf.subarray(end + 4);
      const lines = head.split("\r\n");
      const [method, uri, version] = (lines[0] ?? "").split(" ");
      if (!method || !uri) return void socket.destroy();
      const fail = (ok: boolean, reason: number) => {
        if (ok || socket.destroyed) return;
        const text = reason === -1 ? "Wayfold Connect: link non attivo" : `Wayfold Connect: ${FAIL_TEXT[reason] ?? "errore"}`;
        socket.write(`HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${text}\n`);
      };
      if (method.toUpperCase() === "CONNECT") {
        const target = splitHostPort(uri, 443);
        if (!target) return void socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        this.openStream(socket, {
          ...target,
          rest: Buffer.from(rest),
          reply: (ok, reason) => {
            if (ok) socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            else fail(ok, reason);
          },
        });
        return;
      }
      let url: URL;
      try {
        url = new URL(uri);
      } catch {
        return void socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      }
      if (url.protocol !== "http:") return void socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      const headers = lines
        .slice(1)
        .filter((l) => !/^(proxy-connection|connection|keep-alive):/i.test(l));
      const rewritten = [`${method} ${url.pathname}${url.search} ${version ?? "HTTP/1.1"}`, ...headers, "Connection: close", "", ""].join("\r\n");
      this.openStream(socket, {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port ? Number(url.port) : 80,
        rest: Buffer.concat([Buffer.from(rewritten, "latin1"), rest]),
        reply: fail,
      });
    };
    socket.on("data", onData);
  }
}

function socksReply(code: number): Buffer {
  return Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]);
}

function splitHostPort(s: string, defPort: number): { host: string; port: number } | null {
  const m = s.match(/^\[([^\]]+)\](?::(\d+))?$/) ?? s.match(/^([^:]+)(?::(\d+))?$/);
  if (!m) return isIPv6(s) ? { host: s, port: defPort } : null;
  const port = m[2] ? Number(m[2]) : defPort;
  if (!(port > 0 && port < 65536)) return null;
  return { host: m[1]!, port };
}

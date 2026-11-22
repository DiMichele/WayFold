import { lookup } from "node:dns/promises";
import { connect, isIP, type Socket } from "node:net";
import { FAIL_CONNECT, FAIL_DNS, FAIL_LIMIT, FAIL_POLICY, FAIL_TIMEOUT, HIGH_WATER, type Mux, type MuxEvents } from "./mux.ts";
import type { StreamHost } from "./peer.ts";
import { checkHost, isPrivateAddress, normalizeHost, type GatewayPolicy } from "./policy.ts";

const CONNECT_TIMEOUT_MS = 15_000;

interface Conn {
  socket: Socket | null;
  target: string;
  opened: boolean;
  sentEnd: boolean;
  closed: boolean;
  bytesUp: number;
  bytesDown: number;
  since: number;
}

export type Logger = (level: "info" | "warn" | "error", msg: string) => void;

/** Gateway side: turns OPEN records into real TCP connections, within policy. */
export class Egress implements StreamHost {
  policy: GatewayPolicy;
  private readonly log: Logger;
  private mux: Mux | null = null;
  private readonly conns = new Map<number, Conn>();
  opened = 0;
  refused = 0;

  constructor(policy: GatewayPolicy, log: Logger) {
    this.policy = policy;
    this.log = log;
  }

  readonly events: MuxEvents = {
    open: (id, host, port) => void this.onOpen(id, host, port),
    data: (id, bytes) => {
      const c = this.conns.get(id);
      if (!c?.socket || c.closed) return;
      c.bytesUp += bytes.length;
      c.socket.write(bytes);
    },
    end: (id) => this.conns.get(id)?.socket?.end(),
    reset: (id) => this.drop(id),
    drain: (id) => {
      const s = this.conns.get(id)?.socket;
      if (s?.isPaused()) s.resume();
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
    return [...this.conns.entries()].map(([id, c]) => ({
      id,
      target: c.target,
      opened: c.opened,
      up: c.bytesUp,
      down: c.bytesDown,
      ageMs: now - c.since,
    }));
  }

  private drop(id: number): void {
    const c = this.conns.get(id);
    if (!c) return;
    c.closed = true;
    this.conns.delete(id);
    c.socket?.destroy();
  }

  private refuse(mux: Mux, id: number, code: number, target: string, why: string): void {
    this.refused++;
    mux.openFail(id, code);
    this.log("warn", `Connessione a ${target} rifiutata: ${why}`);
  }

  private async onOpen(id: number, rawHost: string, port: number): Promise<void> {
    const mux = this.mux;
    if (!mux || this.conns.has(id)) return;
    const host = normalizeHost(rawHost);
    const target = `${host}:${port}`;
    if (this.conns.size >= this.policy.maxStreams) return this.refuse(mux, id, FAIL_LIMIT, target, "troppe connessioni aperte");
    const verdict = checkHost(this.policy, host, port);
    if (!verdict.ok) return this.refuse(mux, id, FAIL_POLICY, target, verdict.reason);

    const conn: Conn = { socket: null, target, opened: false, sentEnd: false, closed: false, bytesUp: 0, bytesDown: 0, since: Date.now() };
    this.conns.set(id, conn);

    let addresses: string[];
    try {
      addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      this.conns.delete(id);
      if (this.mux === mux && !conn.closed) this.refuse(mux, id, FAIL_DNS, target, "nome non risolto");
      return;
    }
    if (this.mux !== mux || conn.closed) return;
    if (this.policy.blockPrivate) addresses = addresses.filter((a) => !isPrivateAddress(a));
    const address = addresses.find((a) => isIP(a) === 4) ?? addresses[0];
    if (!address) {
      this.conns.delete(id);
      return this.refuse(mux, id, FAIL_POLICY, target, "si risolve solo in indirizzi privati");
    }

    const socket = connect({ host: address, port });
    conn.socket = socket;
    socket.setNoDelay(true);
    const timer = setTimeout(() => {
      if (conn.opened) return;
      conn.closed = true;
      this.conns.delete(id);
      socket.destroy();
      if (this.mux === mux) this.refuse(mux, id, FAIL_TIMEOUT, target, "timeout di connessione");
    }, CONNECT_TIMEOUT_MS);

    socket.once("connect", () => {
      clearTimeout(timer);
      if (conn.closed || this.mux !== mux) return void socket.destroy();
      conn.opened = true;
      this.opened++;
      mux.openOk(id);
    });
    socket.on("data", (chunk: Buffer) => {
      if (conn.closed || this.mux !== mux) return;
      conn.bytesDown += chunk.length;
      mux.send(id, chunk);
      if (mux.pending(id) > HIGH_WATER) socket.pause();
    });
    socket.on("end", () => {
      if (conn.closed || this.mux !== mux) return;
      conn.sentEnd = true;
      mux.end(id);
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      clearTimeout(timer);
      if (conn.closed) return;
      conn.closed = true;
      this.conns.delete(id);
      if (this.mux !== mux) return;
      if (!conn.opened) this.refuse(mux, id, FAIL_CONNECT, target, "connessione non riuscita");
      else if (!conn.sentEnd) mux.reset(id);
    });
  }
}

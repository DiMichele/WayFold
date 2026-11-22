import { deriveKeys, fingerprint, hash8, hex, newKeyPair, randomU32, sas, type KeyPair } from "./crypto.ts";
import { CLOSE_IDLE, CLOSE_MAX_SESSION, CLOSE_USER, type Mux, type MuxEvents } from "./mux.ts";
import { Session } from "./session.ts";
import {
  DIR_DOWN,
  DIR_UP,
  KIND_OFFER,
  KIND_REQUEST,
  KIND_SEALED,
  OFFER_IDLE,
  OFFER_PENDING,
  OFFER_REJECTED,
  packOffer,
  packRequest,
  packWire,
  parseOffer,
  parseRequest,
  parseWire,
} from "./wire.ts";

/** What sits on top of a session: gateway egress or client proxy. */
export interface StreamHost {
  events: MuxEvents;
  sessionStart(mux: Mux): void;
  sessionEnd(): void;
  /** No frames for a while: drop the sockets, keep the session. */
  linkLost(): void;
  openCount(): number;
}

export interface Timers {
  /** Link considered "up" if a valid frame arrived within this window. */
  upMs: number;
  lostMs: number;
  goneMs: number;
  closingMs: number;
  idleMs: number;
  maxSessionMs: number;
}

export const DEFAULT_TIMERS: Timers = {
  upMs: 2500,
  lostMs: 30_000,
  goneMs: 5 * 60_000,
  closingMs: 3000,
  idleMs: 15 * 60_000,
  maxSessionMs: 2 * 60 * 60_000,
};

export interface LogEntry {
  at: number;
  level: "info" | "warn" | "error";
  msg: string;
}

const CLOSE_TEXT: Record<number, string> = {
  [CLOSE_USER]: "disconnessione manuale",
  [CLOSE_IDLE]: "inattività",
  [CLOSE_MAX_SESSION]: "durata massima della sessione",
};

export interface PeerOptions {
  name: string;
  host: StreamHost;
  timers?: Partial<Timers>;
  now?: () => number;
}

type PeerEvent = "log" | "change";

/** Runs in Node and in the browser, so no node:events. */
class Emitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly handlers = new Map<PeerEvent, Set<(arg: any) => void>>();

  on(event: "log", fn: (entry: LogEntry) => void): this;
  on(event: "change", fn: () => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: PeerEvent, fn: (arg: any) => void): this {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: PeerEvent, fn: (arg: any) => void): this {
    this.handlers.get(event)?.delete(fn);
    return this;
  }

  protected emit(event: PeerEvent, arg?: unknown): void {
    for (const fn of this.handlers.get(event) ?? []) fn(arg);
  }
}

abstract class PeerBase extends Emitter {
  readonly name: string;
  protected readonly host: StreamHost;
  protected readonly timers: Timers;
  protected readonly now: () => number;
  session: Session | null = null;
  protected closingSince = 0;
  protected lastDataAt = 0;
  private lastDataTotal = 0;
  private lostNotified = false;
  framesIn = 0;
  framesForeign = 0;
  readonly log: LogEntry[] = [];

  constructor(opts: PeerOptions) {
    super();
    this.name = opts.name;
    this.host = opts.host;
    this.timers = { ...DEFAULT_TIMERS, ...opts.timers };
    this.now = opts.now ?? (() => performance.now());
  }

  note(level: LogEntry["level"], msg: string): void {
    const entry = { at: Date.now(), level, msg };
    this.log.push(entry);
    if (this.log.length > 300) this.log.shift();
    this.emit("log", entry);
  }

  protected startSession(session: Session): void {
    this.session = session;
    this.closingSince = 0;
    this.lastDataAt = this.now();
    this.lastDataTotal = 0;
    this.lostNotified = false;
    session.mux.events = {
      ...this.host.events,
      closeLink: (reason) => {
        this.note("warn", `Il peer ha chiuso il collegamento (${CLOSE_TEXT[reason] ?? `codice ${reason}`})`);
        this.endSession();
      },
    };
    this.host.sessionStart(session.mux);
  }

  protected endSession(): void {
    if (!this.session) return;
    this.session = null;
    this.closingSince = 0;
    this.host.sessionEnd();
    this.afterSessionEnd();
    this.emit("change");
  }

  protected abstract afterSessionEnd(): void;

  /** Ask the peer to close, flush for a moment, then tear down. */
  disconnect(reason = CLOSE_USER): void {
    const s = this.session;
    if (!s || this.closingSince) return;
    s.mux.closeLink(reason);
    this.closingSince = this.now();
    this.note("info", `Disconnessione in corso (${CLOSE_TEXT[reason] ?? reason})`);
    this.emit("change");
  }

  /** Housekeeping; call regularly (the frame pump does). */
  tick(): void {
    const s = this.session;
    if (!s) return;
    const now = this.now();
    if (this.closingSince) {
      if (s.idle || now - this.closingSince > this.timers.closingMs) this.endSession();
      return;
    }
    const total = s.mux.dataIn + s.mux.dataOut;
    if (total !== this.lastDataTotal) {
      this.lastDataTotal = total;
      this.lastDataAt = now;
    }
    const silent = now - s.lastRxAt;
    if (silent > this.timers.goneMs) {
      this.note("error", "Nessun segnale dal peer da troppo tempo: sessione chiusa");
      this.endSession();
      return;
    }
    if (silent > this.timers.lostMs) {
      if (!this.lostNotified) {
        this.lostNotified = true;
        this.note("warn", "Link ottico interrotto: connessioni aperte chiuse, sessione mantenuta");
        this.host.linkLost();
        this.emit("change");
      }
    } else if (this.lostNotified && silent < this.timers.upMs) {
      this.lostNotified = false;
      this.note("info", "Link ottico ripristinato");
      this.emit("change");
    }
    if (now - s.startedAt > this.timers.maxSessionMs) {
      this.disconnect(CLOSE_MAX_SESSION);
      return;
    }
    if (this.host.openCount() === 0 && now - this.lastDataAt > this.timers.idleMs) this.disconnect(CLOSE_IDLE);
  }

  linkUp(): boolean {
    return !!this.session && this.now() - this.session.lastRxAt < this.timers.upMs;
  }

  protected sessionStatus() {
    const s = this.session;
    if (!s) return null;
    const now = this.now();
    return {
      linkUp: this.linkUp(),
      closing: this.closingSince > 0,
      silentMs: Math.round(now - s.lastRxAt),
      ageMs: Math.round(now - s.startedAt),
      rttMs: Math.round(s.sender.srtt),
      rtoMs: Math.round(s.sender.rto),
      framesTx: s.framesTx,
      framesRx: s.framesRx,
      badFrames: s.badFrames,
      retransmits: s.sender.retransmits,
      outstanding: s.sender.outstanding,
      dataOut: s.mux.dataOut,
      dataIn: s.mux.dataIn,
      bytesAcked: s.sender.bytesAcked,
      streams: this.host.openCount(),
    };
  }

  abstract nextFrame(mtu: number): Uint8Array | null;
  abstract onFrame(bytes: Uint8Array): void;
}

// ---------------------------------------------------------------------------

interface PendingClient {
  pub: Uint8Array;
  hash: string;
  name: string;
  fingerprint: string;
  sas: string;
  seenAt: number;
}

export type GatewayState = "offering" | "connected";

export class GatewayPeer extends PeerBase {
  readonly role = "gateway" as const;
  private keys: KeyPair = newKeyPair();
  linkId = randomU32();
  private seq = 0;
  pending: PendingClient | null = null;
  private readonly rejected = new Set<string>();
  client: PendingClient | null = null;

  get state(): GatewayState {
    return this.session ? "connected" : "offering";
  }

  nextFrame(mtu: number): Uint8Array {
    this.tick();
    if (this.session) return this.session.build(mtu, this.now());
    const status = this.pending ? OFFER_PENDING : this.lastRejected ? OFFER_REJECTED : OFFER_IDLE;
    const ref = this.pending?.pub ?? this.lastRejected;
    const body = packOffer({
      gatewayPub: this.keys.pub,
      status,
      clientHash: ref ? hash8(ref) : new Uint8Array(8),
      name: this.name,
    });
    return packWire({ kind: KIND_OFFER, dir: DIR_DOWN, linkId: this.linkId, seq: this.seq++ }, body, mtu);
  }

  private lastRejected: Uint8Array | null = null;

  onFrame(bytes: Uint8Array): void {
    const f = parseWire(bytes);
    if (!f || f.header.dir !== DIR_UP || f.header.linkId !== this.linkId) {
      this.framesForeign++;
      return;
    }
    this.framesIn++;
    if (f.header.kind === KIND_SEALED) {
      this.session?.accept(f, this.now());
      return;
    }
    if (f.header.kind !== KIND_REQUEST || this.session) return;
    const req = parseRequest(f.body);
    if (!req) return;
    const h = hex(hash8(req.clientPub));
    if (this.rejected.has(h)) return;
    if (this.pending?.hash === h) {
      this.pending.seenAt = this.now();
      return;
    }
    this.pending = {
      pub: req.clientPub,
      hash: h,
      name: req.name || "client",
      fingerprint: fingerprint(req.clientPub),
      sas: sas(this.keys.pub, req.clientPub, this.linkId),
      seenAt: this.now(),
    };
    this.note("info", `Richiesta di connessione da "${this.pending.name}" (${this.pending.fingerprint}), codice ${this.pending.sas}`);
    this.emit("change");
  }

  authorize(): boolean {
    const p = this.pending;
    if (!p || this.session) return false;
    const keys = deriveKeys(this.keys, p.pub, this.keys.pub, p.pub, this.linkId);
    this.client = p;
    this.pending = null;
    this.lastRejected = null;
    this.startSession(
      new Session({ linkId: this.linkId, txDir: DIR_DOWN, rxDir: DIR_UP, txKey: keys.down, rxKey: keys.up, now: this.now() }),
    );
    this.note("info", `Client "${p.name}" autorizzato`);
    this.emit("change");
    return true;
  }

  reject(): boolean {
    const p = this.pending;
    if (!p) return false;
    this.rejected.add(p.hash);
    this.lastRejected = p.pub;
    this.pending = null;
    this.note("warn", `Richiesta di "${p.name}" rifiutata`);
    this.emit("change");
    return true;
  }

  protected afterSessionEnd(): void {
    this.note("info", `Sessione con "${this.client?.name ?? "client"}" terminata`);
    this.client = null;
    this.keys = newKeyPair();
    this.linkId = randomU32();
    this.seq = 0;
  }

  status() {
    return {
      role: this.role,
      name: this.name,
      state: this.state,
      linkId: this.linkId.toString(16),
      gatewayFingerprint: fingerprint(this.keys.pub),
      pending: this.pending && {
        name: this.pending.name,
        fingerprint: this.pending.fingerprint,
        sas: this.pending.sas,
        seenAgoMs: Math.round(this.now() - this.pending.seenAt),
      },
      client: this.client && { name: this.client.name, fingerprint: this.client.fingerprint, sas: this.client.sas },
      framesIn: this.framesIn,
      framesForeign: this.framesForeign,
      session: this.sessionStatus(),
    };
  }
}

// ---------------------------------------------------------------------------

export type ClientState = "searching" | "requesting" | "rejected" | "connected" | "closed";

interface SeenGateway {
  pub: Uint8Array;
  linkId: number;
  name: string;
}

export class ClientPeer extends PeerBase {
  readonly role = "client" as const;
  private keys: KeyPair = newKeyPair();
  private gateway: SeenGateway | null = null;
  private lastOffer: SeenGateway | null = null;
  private candidate: Session | null = null;
  private seq = 0;
  private mode: "auto" | "rejected" | "closed" = "auto";
  private rejectedLinkId = -1;
  awaitingApproval = false;
  code = "";

  get state(): ClientState {
    if (this.session) return "connected";
    if (this.mode === "closed") return "closed";
    if (this.mode === "rejected") return "rejected";
    return this.gateway ? "requesting" : "searching";
  }

  nextFrame(mtu: number): Uint8Array | null {
    this.tick();
    if (this.session) return this.session.build(mtu, this.now());
    if (this.mode !== "auto" || !this.gateway) return null;
    const body = packRequest({ clientPub: this.keys.pub, name: this.name });
    return packWire({ kind: KIND_REQUEST, dir: DIR_UP, linkId: this.gateway.linkId, seq: this.seq++ }, body, mtu);
  }

  onFrame(bytes: Uint8Array): void {
    const f = parseWire(bytes);
    if (!f || f.header.dir !== DIR_DOWN) {
      this.framesForeign++;
      return;
    }
    this.framesIn++;
    const now = this.now();
    if (f.header.kind === KIND_SEALED) {
      if (this.session) {
        this.session.accept(f, now);
        return;
      }
      if (this.candidate && this.candidate.accept(f, now)) {
        const s = this.candidate;
        this.candidate = null;
        this.awaitingApproval = false;
        this.startSession(s);
        this.note("info", `Autorizzato dal gateway "${this.gateway?.name ?? ""}": connesso`);
        this.emit("change");
      }
      return;
    }
    if (f.header.kind !== KIND_OFFER) return;
    const offer = parseOffer(f.body);
    if (!offer) return;
    const seen = { pub: offer.gatewayPub, linkId: f.header.linkId, name: offer.name || "gateway" };
    this.lastOffer = seen;
    if (this.session) {
      if (f.header.linkId !== this.session.linkId) {
        this.note("warn", "Il gateway ha avviato una nuova sessione: collegamento precedente chiuso");
        this.endSession();
      }
      return;
    }
    if (this.mode === "closed") return;
    if (this.mode === "rejected") {
      if (f.header.linkId === this.rejectedLinkId) return;
      this.mode = "auto";
    }
    if (!this.gateway || this.gateway.linkId !== seen.linkId) this.target(seen);
    const ours = hex(offer.clientHash) === hex(hash8(this.keys.pub));
    if (ours && offer.status === OFFER_REJECTED) {
      this.mode = "rejected";
      this.rejectedLinkId = seen.linkId;
      this.candidate = null;
      this.awaitingApproval = false;
      this.note("error", "Il gateway ha rifiutato la richiesta");
      this.emit("change");
      return;
    }
    const waiting = ours && offer.status === OFFER_PENDING;
    if (waiting !== this.awaitingApproval) {
      this.awaitingApproval = waiting;
      if (waiting) this.note("info", `Richiesta ricevuta dal gateway: confronta il codice ${this.code}`);
      this.emit("change");
    }
  }

  private target(gw: SeenGateway): void {
    this.gateway = gw;
    this.keys = newKeyPair();
    this.seq = 0;
    const keys = deriveKeys(this.keys, gw.pub, gw.pub, this.keys.pub, gw.linkId);
    this.code = sas(gw.pub, this.keys.pub, gw.linkId);
    this.candidate = new Session({ linkId: gw.linkId, txDir: DIR_UP, rxDir: DIR_DOWN, txKey: keys.up, rxKey: keys.down, now: this.now() });
    this.awaitingApproval = false;
    this.note("info", `Gateway "${gw.name}" rilevato (${fingerprint(gw.pub)}): richiesta di connessione inviata`);
    this.emit("change");
  }

  /** Leave closed/rejected and ask again. */
  reconnect(): void {
    if (this.session) return;
    this.mode = "auto";
    this.gateway = null;
    this.candidate = null;
    if (this.lastOffer && this.lastOffer.linkId !== this.rejectedLinkId) this.target(this.lastOffer);
    this.emit("change");
  }

  protected afterSessionEnd(): void {
    this.note("info", "Sessione terminata");
    this.gateway = null;
    this.candidate = null;
    this.awaitingApproval = false;
    this.mode = "closed";
  }

  status() {
    return {
      role: this.role,
      name: this.name,
      state: this.state,
      code: this.state === "requesting" || this.state === "connected" ? this.code : "",
      awaitingApproval: this.awaitingApproval,
      gateway: this.gateway && { name: this.gateway.name, fingerprint: fingerprint(this.gateway.pub) },
      framesIn: this.framesIn,
      framesForeign: this.framesForeign,
      session: this.sessionStatus(),
    };
  }
}

export type Peer = GatewayPeer | ClientPeer;

import { ArqReceiver, ArqSender } from "./arq.ts";
import { open, seal } from "./crypto.ts";
import { Mux } from "./mux.ts";
import {
  GCM_TAG_LEN,
  KIND_SEALED,
  NO_ECHO,
  headerBytes,
  maxSegmentData,
  packSealedPlain,
  packWire,
  parseSealedPlain,
  type WireFrame,
} from "./wire.ts";

const EMPTY = new Uint8Array(0);
const SENT_AT_KEEP = 4096;

export interface SessionInit {
  linkId: number;
  txDir: number;
  rxDir: number;
  txKey: Uint8Array;
  rxKey: Uint8Array;
  now: number;
}

/** One authorized, encrypted link: framing + ARQ + mux. Transport-agnostic and clock-injected. */
export class Session {
  readonly mux = new Mux();
  readonly sender: ArqSender;
  readonly receiver = new ArqReceiver();
  readonly linkId: number;
  readonly startedAt: number;
  private readonly init: SessionInit;
  private seq = 0;
  private readonly sentAt = new Map<number, number>();
  private peerSeqMax = NO_ECHO;
  private lastEchoUsed = -1;
  lastRxAt: number;
  framesRx = 0;
  framesTx = 0;
  badFrames = 0;

  constructor(init: SessionInit) {
    this.init = init;
    this.linkId = init.linkId;
    this.startedAt = init.now;
    this.lastRxAt = init.now;
    this.sender = new ArqSender((max) => this.mux.pull(max));
  }

  build(mtu: number, now: number): Uint8Array {
    const seg = this.sender.pick(maxSegmentData(mtu), now);
    const sack = this.receiver.sack();
    const plain = packSealedPlain({
      nextExpected: this.receiver.nextExpected,
      sackLo: sack.lo,
      sackHi: sack.hi,
      echoSeq: this.peerSeqMax,
      segNo: seg ? seg.no : -1,
      segData: seg ? seg.data : EMPTY,
    });
    const seq = this.seq++;
    const h = { kind: KIND_SEALED, dir: this.init.txDir, linkId: this.linkId, seq };
    const body = seal(this.init.txKey, this.init.txDir, seq, headerBytes(h, plain.length + GCM_TAG_LEN), plain);
    this.sentAt.set(seq, now);
    this.sentAt.delete(seq - SENT_AT_KEEP);
    this.framesTx++;
    return packWire(h, body, mtu);
  }

  /** False when the frame is not ours or fails authentication. */
  accept(frame: WireFrame, now: number): boolean {
    const h = frame.header;
    if (h.kind !== KIND_SEALED || h.dir !== this.init.rxDir || h.linkId !== this.linkId) return false;
    const plain = open(this.init.rxKey, this.init.rxDir, h.seq, frame.aad, frame.body);
    const p = plain ? parseSealedPlain(plain) : null;
    if (!p) {
      this.badFrames++;
      return false;
    }
    this.lastRxAt = now;
    this.framesRx++;
    if (this.peerSeqMax === NO_ECHO || h.seq > this.peerSeqMax) this.peerSeqMax = h.seq;
    if (p.echoSeq !== NO_ECHO && p.echoSeq > this.lastEchoUsed) {
      this.lastEchoUsed = p.echoSeq;
      const t = this.sentAt.get(p.echoSeq);
      if (t !== undefined) this.sender.onRttSample(now - t);
    }
    this.sender.onAck(p.nextExpected, p.sackLo, p.sackHi);
    if (p.segNo >= 0) {
      for (const chunk of this.receiver.onSegment(p.segNo, p.segData)) this.mux.feed(chunk);
    }
    return true;
  }

  /** Nothing queued and everything acknowledged. */
  get idle(): boolean {
    return this.sender.outstanding === 0 && !this.mux.hasOutput();
  }
}

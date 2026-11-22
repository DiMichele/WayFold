/**
 * Selective-repeat ARQ over the optical frames.
 *
 * Every frame in each direction carries a cumulative ack plus a 64-bit SACK
 * bitmap, so acks flow at the display rate for free. Losses are detected
 * RACK-style (a later-sent segment was acked) or by RTO. A segment that has
 * been on screen long enough is shown again before a new one is introduced:
 * a webcam cannot read a code that changes on every frame.
 */

export const ARQ_WINDOW = 512;
const RACK_SLACK_MS = 40;
const MIN_RTO_MS = 300;
const MAX_RTO_MS = 5000;
const INITIAL_RTO_MS = 1500;
const REPEAT_MIN_MS = 250;
/**
 * A webcam reads a QR that stays still. Sending a new segment on every frame
 * fills the window with codes the camera never sees, and the page stalls.
 * Past this many unacked segments the next frames repeat the oldest one.
 */
const OPTICAL_INFLIGHT = 12;

interface Inflight {
  data: Uint8Array;
  lastSent: number;
  sends: number;
  lost: boolean;
}

export interface Segment {
  no: number;
  data: Uint8Array;
}

export class ArqSender {
  private next = 0;
  private readonly inflight = new Map<number, Inflight>();
  private readonly pull: (max: number) => Uint8Array | null;
  rto = INITIAL_RTO_MS;
  srtt = 0;
  private rttvar = 0;
  retransmits = 0;
  bytesAcked = 0;
  bytesSent = 0;

  constructor(pull: (max: number) => Uint8Array | null) {
    this.pull = pull;
  }

  get outstanding(): number {
    return this.inflight.size;
  }

  /** Called with link RTT samples measured by the session (frame-seq echo). */
  onRttSample(ms: number): void {
    if (!(ms > 0)) return;
    if (this.srtt === 0) {
      this.srtt = ms;
      this.rttvar = ms / 2;
    } else {
      this.rttvar = 0.75 * this.rttvar + 0.25 * Math.abs(this.srtt - ms);
      this.srtt = 0.875 * this.srtt + 0.125 * ms;
    }
    this.rto = Math.min(MAX_RTO_MS, Math.max(MIN_RTO_MS, this.srtt + 4 * this.rttvar));
  }

  pick(maxData: number, now: number): Segment | null {
    let lost = -1;
    for (const [no, f] of this.inflight) {
      if (!f.lost && now - f.lastSent > this.rto) f.lost = true;
      if (f.lost && (lost < 0 || no < lost)) lost = no;
    }
    if (lost >= 0) return this.resend(lost, now);

    let oldest = -1;
    let oldestAt = Infinity;
    for (const [no, f] of this.inflight) {
      if (f.lastSent < oldestAt) {
        oldestAt = f.lastSent;
        oldest = no;
      }
    }
    if (oldest >= 0 && now - oldestAt >= REPEAT_MIN_MS) return this.resend(oldest, now);

    if (this.inflight.size < OPTICAL_INFLIGHT && this.inflight.size < ARQ_WINDOW) {
      const data = this.pull(maxData);
      if (data && data.length) {
        const no = this.next++;
        this.inflight.set(no, { data, lastSent: now, sends: 1, lost: false });
        this.bytesSent += data.length;
        return { no, data };
      }
    }
    return null;
  }

  private resend(no: number, now: number): Segment {
    const f = this.inflight.get(no)!;
    f.lost = false;
    f.lastSent = now;
    f.sends++;
    this.retransmits++;
    return { no, data: f.data };
  }

  onAck(nextExpected: number, sackLo: number, sackHi: number): void {
    let newestAckedSend = -1;
    let highestAcked = -1;
    for (const [no, f] of this.inflight) {
      let acked = no < nextExpected;
      if (!acked) {
        const i = no - nextExpected - 1;
        if (i >= 0 && i < 32) acked = ((sackLo >>> i) & 1) === 1;
        else if (i >= 32 && i < 64) acked = ((sackHi >>> (i - 32)) & 1) === 1;
      }
      if (!acked) continue;
      this.inflight.delete(no);
      this.bytesAcked += f.data.length;
      if (f.lastSent > newestAckedSend) newestAckedSend = f.lastSent;
      if (no > highestAcked) highestAcked = no;
    }
    if (newestAckedSend < 0) return;
    for (const [no, f] of this.inflight) {
      if (!f.lost && no < highestAcked && f.lastSent < newestAckedSend - RACK_SLACK_MS) f.lost = true;
    }
  }
}

export class ArqReceiver {
  nextExpected = 0;
  private readonly buf = new Map<number, Uint8Array>();
  duplicates = 0;

  /** Returns the segments that became deliverable in order. */
  onSegment(no: number, data: Uint8Array): Uint8Array[] {
    if (no < this.nextExpected || no >= this.nextExpected + 2 * ARQ_WINDOW || this.buf.has(no)) {
      this.duplicates++;
      return [];
    }
    this.buf.set(no, data.slice());
    const out: Uint8Array[] = [];
    for (;;) {
      const next = this.buf.get(this.nextExpected);
      if (!next) break;
      this.buf.delete(this.nextExpected);
      this.nextExpected++;
      out.push(next);
    }
    return out;
  }

  sack(): { lo: number; hi: number } {
    let lo = 0;
    let hi = 0;
    if (this.buf.size === 0) return { lo, hi };
    for (let i = 0; i < 64; i++) {
      if (!this.buf.has(this.nextExpected + 1 + i)) continue;
      if (i < 32) lo |= 1 << i;
      else hi |= 1 << (i - 32);
    }
    return { lo: lo >>> 0, hi: hi >>> 0 };
  }
}

/** Measurement helper. Does not change ArqSender, the window, or the wire format. */

import { ArqReceiver, ArqSender } from "../../wayfold-connect/src/arq.ts";
import { windowCapacityBitrate } from "./profile.ts";

const WINDOW = 12;

export interface ArqObservation {
  channels: number;
  /** New units pick() accepted from the queue. */
  unitsSent: number;
  /** Times pick() returned a segment already in flight. */
  repeats: number;
  duplicates: number;
  retransmits: number;
  /** Resends while the segment was not dropped and its ACK could not have returned yet. */
  prematureRepeats: number;
  /** Resends of a segment the receiver never got. */
  lossRepeats: number;
  /** Picks that sent nothing because the window was full and the repeat timer had not elapsed. */
  idlePicks: number;
  delivered: number;
  deliveredBytes: number;
  seconds: number;
  /** Delivered payload bytes per second. A model, not a camera. */
  appGoodputBps: number;
  /** 12 * mtu * 8 / rtt, converted to bytes per second. */
  capacityBps: number;
  maxOutstanding: number;
  meanOutstanding: number;
  saturatedSteps: number;
  /** ARQ window full. Independent of worker count and of optical BER. */
  saturation: "arq" | "none";
  opticalBer: null;
  workerLimit: null;
  forwardMs: number;
  returnMs: number;
  ackGenMs: number;
  paintMs: number;
  ackPaintMs: number;
}

export function observeColorArq(options: {
  channels: number;
  count?: number;
  steps?: number;
  rttMs?: number;
  stepMs?: number;
  forwardMs?: number;
  returnMs?: number;
  ackGenMs?: number;
  paintMs?: number;
  ackPaintMs?: number;
  mtu?: number;
  payloadBytes?: number;
  drop?: (step: number, channel: number) => boolean;
}): ArqObservation {
  const channels = options.channels;
  const mtu = options.mtu ?? 32;
  const payloadBytes = options.payloadBytes ?? mtu;
  const stepMs = options.stepMs ?? options.paintMs ?? 40;
  const rttMs = options.rttMs ?? 120;
  const forwardMs = options.forwardMs ?? rttMs * 0.4;
  const ackGenMs = options.ackGenMs ?? rttMs * 0.1;
  const returnMs = options.returnMs ?? Math.max(0, rttMs - forwardMs - ackGenMs);
  const paintMs = options.paintMs ?? stepMs;
  const ackPaintMs = options.ackPaintMs ?? paintMs;
  const steps = options.steps ?? 40;
  const queue: Uint8Array[] = [];
  for (let i = 0; i < (options.count ?? 24); i++) {
    const row = new Uint8Array(payloadBytes);
    row[0] = i & 255;
    queue.push(row);
  }
  const tx = new ArqSender(() => queue.shift() ?? null);
  const rx = new ArqReceiver();
  let unitsSent = 0;
  let repeats = 0;
  let prematureRepeats = 0;
  let lossRepeats = 0;
  let idlePicks = 0;
  let delivered = 0;
  let deliveredBytes = 0;
  let outstandingSum = 0;
  let maxOutstanding = 0;
  let saturatedSteps = 0;
  let t = 0;
  const flight = new Map<number, { dropped: boolean; ackAt: number }>();
  const arriving: { at: number; no: number; data: Uint8Array }[] = [];
  const nextPaint = (time: number, period: number) => (period <= 0 ? time : Math.ceil((time + 1e-6) / period) * period);
  const deliver = (now: number) => {
    arriving.sort((a, b) => a.at - b.at);
    while (arriving.length && arriving[0]!.at <= now) {
      const item = arriving.shift()!;
      for (const chunk of rx.onSegment(item.no, item.data)) {
        delivered++;
        deliveredBytes += chunk.length;
      }
    }
  };
  const ackIfDue = (now: number) => {
    for (const item of flight.values()) {
      if (item.ackAt > now) continue;
      const sack = rx.sack();
      tx.onAck(rx.nextExpected, sack.lo, sack.hi);
      return;
    }
  };
  for (let step = 0; step < steps; step++) {
    t += paintMs;
    deliver(t);
    ackIfDue(t);
    outstandingSum += tx.outstanding;
    if (tx.outstanding > maxOutstanding) maxOutstanding = tx.outstanding;
    if (tx.outstanding >= WINDOW) saturatedSteps++;
    for (let c = 0; c < channels; c++) {
      const before = tx.retransmits;
      const seg = tx.pick(mtu, t);
      if (!seg) {
        idlePicks++;
        continue;
      }
      if (tx.retransmits > before) {
        repeats++;
        const known = flight.get(seg.no);
        if (known?.dropped) lossRepeats++;
        else if (known && t < known.ackAt) prematureRepeats++;
      } else {
        unitsSent++;
        const dropped = options.drop?.(step, c) ?? false;
        const arrives = t + forwardMs;
        const ackAt = dropped ? Number.POSITIVE_INFINITY : nextPaint(arrives + ackGenMs, ackPaintMs) + returnMs;
        flight.set(seg.no, { dropped, ackAt });
        if (!dropped) arriving.push({ at: arrives, no: seg.no, data: seg.data });
      }
    }
  }
  deliver(t);
  ackIfDue(t);
  const seconds = t / 1000;
  return {
    channels,
    unitsSent,
    repeats,
    duplicates: rx.duplicates,
    retransmits: tx.retransmits,
    prematureRepeats,
    lossRepeats,
    idlePicks,
    delivered,
    deliveredBytes,
    seconds,
    appGoodputBps: seconds > 0 ? deliveredBytes / seconds : 0,
    capacityBps: windowCapacityBitrate(WINDOW, mtu, (forwardMs + ackGenMs + returnMs) / 1000) / 8,
    maxOutstanding,
    meanOutstanding: steps > 0 ? outstandingSum / steps : 0,
    saturatedSteps,
    saturation: saturatedSteps > 0 ? "arq" : "none",
    opticalBer: null,
    workerLimit: null,
    forwardMs,
    returnMs,
    ackGenMs,
    paintMs,
    ackPaintMs,
  };
}

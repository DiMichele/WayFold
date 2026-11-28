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
}

export function observeColorArq(options: {
  channels: number;
  count?: number;
  steps?: number;
  rttMs?: number;
  stepMs?: number;
  mtu?: number;
  payloadBytes?: number;
  drop?: (step: number, channel: number) => boolean;
}): ArqObservation {
  const channels = options.channels;
  const mtu = options.mtu ?? 32;
  const payloadBytes = options.payloadBytes ?? mtu;
  const stepMs = options.stepMs ?? 40;
  const rttMs = options.rttMs ?? 120;
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
  let delivered = 0;
  let deliveredBytes = 0;
  let outstandingSum = 0;
  let maxOutstanding = 0;
  let saturatedSteps = 0;
  let t = 0;
  const arriving: { at: number; no: number; data: Uint8Array }[] = [];
  const deliver = (now: number) => {
    while (arriving.length && arriving[0]!.at <= now) {
      const item = arriving.shift()!;
      for (const chunk of rx.onSegment(item.no, item.data)) {
        delivered++;
        deliveredBytes += chunk.length;
      }
    }
  };
  for (let step = 0; step < steps; step++) {
    t += stepMs;
    deliver(t);
    outstandingSum += tx.outstanding;
    if (tx.outstanding > maxOutstanding) maxOutstanding = tx.outstanding;
    if (tx.outstanding >= WINDOW) saturatedSteps++;
    for (let c = 0; c < channels; c++) {
      const before = tx.retransmits;
      const seg = tx.pick(mtu, t);
      if (!seg) continue;
      if (tx.retransmits > before) repeats++;
      else unitsSent++;
      if (options.drop?.(step, c)) continue;
      arriving.push({ at: t + rttMs, no: seg.no, data: seg.data });
      arriving.sort((a, b) => a.at - b.at);
    }
    if (step % Math.max(1, Math.round(rttMs / stepMs)) === 0) {
      const sack = rx.sack();
      tx.onAck(rx.nextExpected, sack.lo, sack.hi);
    }
  }
  const sack = rx.sack();
  tx.onAck(rx.nextExpected, sack.lo, sack.hi);
  const seconds = t / 1000;
  return {
    channels,
    unitsSent,
    repeats,
    duplicates: rx.duplicates,
    retransmits: tx.retransmits,
    delivered,
    deliveredBytes,
    seconds,
    appGoodputBps: seconds > 0 ? deliveredBytes / seconds : 0,
    capacityBps: windowCapacityBitrate(WINDOW, mtu, rttMs / 1000) / 8,
    maxOutstanding,
    meanOutstanding: steps > 0 ? outstandingSum / steps : 0,
    saturatedSteps,
    saturation: saturatedSteps > 0 ? "arq" : "none",
    opticalBer: null,
    workerLimit: null,
  };
}

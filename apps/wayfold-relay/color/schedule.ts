/** How to hand channel images to a bounded worker pool without keeping stale frames. */

import type { ScheduleMode } from "./profile.ts";

export type { ScheduleMode };

export interface ScheduledSymbol<T> {
  composite: number;
  channel: number;
  payload: T;
}

export interface SchedulePlan<T> {
  mode: ScheduleMode;
  /** One list per worker that is free now. Empty workers are omitted. */
  batches: ScheduledSymbol<T>[][];
  /** Symbols that did not fit this capture. The caller drops them with the frame. */
  dropped: number;
  /** Next round-robin phase, so a later frame starts on another channel. */
  nextPhase: number;
}

/**
 * Order symbols so a short worker list still sees every color before it repeats one.
 * Adaptive packs every symbol of this frame into the free workers.
 * Channel and composite post at most one symbol per free worker and drop the rest.
 */
export function scheduleSymbols<T>(
  items: ScheduledSymbol<T>[],
  freeSlots: number,
  mode: ScheduleMode,
  phase = 0,
): SchedulePlan<T> {
  const slots = Math.max(0, Math.floor(freeSlots));
  if (!items.length || slots < 1) {
    return { mode, batches: [], dropped: items.length, nextPhase: phase };
  }
  const ordered = orderSymbols(items, mode, phase);
  if (mode === "adaptive") {
    const batches: ScheduledSymbol<T>[][] = Array.from({ length: Math.min(slots, ordered.length) }, () => []);
    ordered.forEach((item, i) => batches[i % batches.length]!.push(item));
    const used = Math.max(...ordered.map((item) => item.channel), 0);
    return { mode, batches, dropped: 0, nextPhase: (phase + used + 1) % Math.max(1, channelCount(items)) };
  }
  const take = ordered.slice(0, slots);
  return {
    mode,
    batches: take.map((item) => [item]),
    dropped: ordered.length - take.length,
    nextPhase: (phase + 1) % Math.max(1, channelCount(items)),
  };
}

function channelCount<T>(items: ScheduledSymbol<T>[]): number {
  return items.reduce((n, item) => Math.max(n, item.channel + 1), 1);
}

function orderSymbols<T>(items: ScheduledSymbol<T>[], mode: ScheduleMode, phase: number): ScheduledSymbol<T>[] {
  if (mode === "composite") {
    return [...items].sort((a, b) => a.composite - b.composite || a.channel - b.channel);
  }
  const channels = channelCount(items);
  const start = ((phase % channels) + channels) % channels;
  return [...items].sort((a, b) => {
    const ac = (a.channel - start + channels) % channels;
    const bc = (b.channel - start + channels) % channels;
    return ac - bc || a.composite - b.composite;
  });
}

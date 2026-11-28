/** How to hand channel images to a bounded worker pool without keeping stale frames. */

import type { ScheduleMode } from "./profile.ts";

export type { ScheduleMode };

export interface ScheduledSymbol<T> {
  composite: number;
  channel: number;
  payload: T;
}

export interface ScheduleBudget {
  /** Expected decode time of one channel image. */
  symbolMs: number;
  /** Wall time the slowest worker may spend on this capture. */
  budgetMs: number;
}

export interface SchedulePlan<T> {
  mode: ScheduleMode;
  /** One list per worker that is free now. Empty workers are omitted. */
  batches: ScheduledSymbol<T>[][];
  /** Symbols offered by this capture. */
  candidates: number;
  /** Symbols placed on a worker. */
  scheduled: number;
  /** Symbols that did not fit this capture. The caller drops them with the frame. */
  dropped: number;
  /** Symbols inside each worker job. */
  perJob: number[];
  /** Wall time of the slowest job, in symbol units. */
  slowest: number;
  /** Next round-robin phase, so a later frame starts on another channel. */
  nextPhase: number;
}

/**
 * Order symbols so a short worker list still sees every color before it repeats one.
 * Nothing is kept for a later frame.
 * `channel` and `composite` post one symbol per free worker and drop the rest.
 * `cell` posts every channel of one composite on one worker.
 * `adaptive` packs this frame onto the free workers with no time cap.
 * `budget` does the same until the slowest job would pass the frame budget.
 */
export function scheduleSymbols<T>(
  items: ScheduledSymbol<T>[],
  freeSlots: number,
  mode: ScheduleMode,
  phase = 0,
  budget?: ScheduleBudget,
): SchedulePlan<T> {
  const slots = Math.max(0, Math.floor(freeSlots));
  const empty = (dropped: number): SchedulePlan<T> => ({
    mode,
    batches: [],
    candidates: items.length,
    scheduled: 0,
    dropped,
    perJob: [],
    slowest: 0,
    nextPhase: phase,
  });
  if (!items.length || slots < 1) return empty(items.length);
  const ordered = orderSymbols(items, mode, phase);
  if (mode === "cell") return finish(packCells(ordered, slots), mode, items.length, phase);
  if (mode === "adaptive") {
    const batches: ScheduledSymbol<T>[][] = Array.from({ length: Math.min(slots, ordered.length) }, () => []);
    ordered.forEach((item, i) => batches[i % batches.length]!.push(item));
    return finish(batches, mode, items.length, phase);
  }
  if (mode === "budget") {
    const symbolMs = Math.max(0.1, budget?.symbolMs ?? 12);
    const budgetMs = Math.max(symbolMs, budget?.budgetMs ?? 34);
    const room = Math.max(1, Math.floor(budgetMs / symbolMs));
    const batches: ScheduledSymbol<T>[][] = Array.from({ length: Math.min(slots, ordered.length) }, () => []);
    let placed = 0;
    for (const item of ordered) {
      let dest = 0;
      for (let i = 1; i < batches.length; i++) if (batches[i]!.length < batches[dest]!.length) dest = i;
      if (batches[dest]!.length >= room) break;
      batches[dest]!.push(item);
      placed++;
    }
    return finish(batches.filter((batch) => batch.length), mode, items.length, phase, placed);
  }
  const take = ordered.slice(0, slots);
  return finish(take.map((item) => [item]), mode, items.length, phase);
}

function finish<T>(
  batches: ScheduledSymbol<T>[][],
  mode: ScheduleMode,
  candidates: number,
  phase: number,
  scheduled = batches.reduce((n, batch) => n + batch.length, 0),
): SchedulePlan<T> {
  const perJob = batches.map((batch) => batch.length);
  return {
    mode,
    batches,
    candidates,
    scheduled,
    dropped: candidates - scheduled,
    perJob,
    slowest: perJob.reduce((n, v) => Math.max(n, v), 0),
    nextPhase: phase + 1,
  };
}

function packCells<T>(ordered: ScheduledSymbol<T>[], slots: number): ScheduledSymbol<T>[][] {
  const groups = new Map<number, ScheduledSymbol<T>[]>();
  for (const item of ordered) {
    const group = groups.get(item.composite) ?? [];
    group.push(item);
    groups.set(item.composite, group);
  }
  return [...groups.values()].slice(0, slots);
}

function channelCount<T>(items: ScheduledSymbol<T>[]): number {
  return items.reduce((n, item) => Math.max(n, item.channel + 1), 1);
}

function orderSymbols<T>(items: ScheduledSymbol<T>[], mode: ScheduleMode, phase: number): ScheduledSymbol<T>[] {
  if (mode === "composite") {
    return [...items].sort((a, b) => a.composite - b.composite || a.channel - b.channel);
  }
  const channels = channelCount(items);
  const compIds = [...new Set(items.map((item) => item.composite))].sort((a, b) => a - b);
  const nComp = Math.max(1, compIds.length);
  const startCh = ((phase % channels) + channels) % channels;
  const startComp = ((Math.floor(phase / channels) % nComp) + nComp) % nComp;
  const compIndex = new Map(compIds.map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    const ac = ((compIndex.get(a.composite) ?? 0) - startComp + nComp) % nComp;
    const bc = ((compIndex.get(b.composite) ?? 0) - startComp + nComp) % nComp;
    const ah = (a.channel - startCh + channels) % channels;
    const bh = (b.channel - startCh + channels) % channels;
    return ac - bc || ah - bh;
  });
}

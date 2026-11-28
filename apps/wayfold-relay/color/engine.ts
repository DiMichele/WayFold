import { alignMatrices, type AlignedMatrices } from "./matrices.ts";
import { paletteById, type Palette } from "./palette.ts";
import { opticalProfile, type OpticalProfileId, type SampleMode, type SeparateMethod } from "./profile.ts";
import {
  locateComposites,
  paintGrid,
  paintMatrices,
  renderChannel,
  splitComposite,
  type PaintResult,
  type Raster,
  type SplitTimings,
} from "./composite.ts";
import { scheduleSymbols, type ScheduleBudget, type SchedulePlan, type ScheduledSymbol } from "./schedule.ts";
import type { ScheduleMode } from "./profile.ts";
import type { EccLevel } from "../shared/optical.ts";
import { gridDims } from "../shared/optical.ts";

export interface EncodedComposite extends PaintResult {
  aligned: AlignedMatrices;
  profile: OpticalProfileId;
}

export interface RecoveredComposite {
  index: number;
  split: SplitTimings;
  /** Binary QR images, one per channel that actually had dark modules. */
  channels: Raster[];
  bounds: { x: number; y: number; w: number; h: number };
}

export interface LocatedGeometry {
  index: number;
  bounds: { x: number; y: number; w: number; h: number };
}

/** Mono does not enter this function. Callers keep the existing black-and-white path. */
export function encodePayloads(
  payloads: Uint8Array[],
  ecc: EccLevel,
  profile: OpticalProfileId,
  paletteId?: string,
  ppm = 1,
): EncodedComposite {
  const spec = opticalProfile(profile, paletteId);
  if (spec.channels === 1) throw new Error("mono does not use the color encoder");
  if (payloads.length !== spec.channels) throw new Error("payload count does not match the profile");
  const aligned = alignMatrices(payloads, ecc);
  const palette = paletteById(spec.paletteId);
  const paint = paintMatrices(aligned.matrices, palette, ppm);
  return { ...paint, aligned, profile };
}

export function encodeGrid(
  cells: Uint8Array[][],
  ecc: EccLevel,
  profile: OpticalProfileId,
  wide: boolean,
  paletteId?: string,
  ppm = 1,
): { raster: PaintResult; aligned: AlignedMatrices[] } {
  const spec = opticalProfile(profile, paletteId);
  const probed = cells.map((payloads) => {
    if (payloads.length !== spec.channels) throw new Error("payload count does not match the profile");
    return alignMatrices(payloads, ecc);
  });
  const version = Math.max(...probed.map((item) => item.version));
  const locked = cells.map((payloads) => alignMatrices(payloads, ecc, version));
  // Re-lock by encoding again only when versions differ. alignMatrices already picks the max per cell.
  const palette = paletteById(spec.paletteId);
  const { cols } = gridDims(cells.length, wide);
  const raster = paintGrid(locked.map((item) => item.matrices), palette, ppm, cols);
  return { raster, aligned: locked };
}

export function recoverRaster(
  raster: Raster,
  profile: OpticalProfileId,
  method: SeparateMethod = "hybrid",
  sample: SampleMode = "module",
  paletteId?: string,
  source?: Uint8Array[][],
  splitBudget?: { budgetMs: number; phase: number },
): {
  found: RecoveredComposite[];
  geometry: LocatedGeometry[];
  monoLike: boolean;
  locateMs: number;
  unsplit: number;
} {
  const spec = opticalProfile(profile, paletteId);
  if (spec.channels === 1) return { found: [], geometry: [], monoLike: false, locateMs: 0, unsplit: 0 };
  const palette = paletteById(spec.paletteId);
  const tLocate = performance.now();
  const located = locateComposites(raster);
  const locateMs = performance.now() - tLocate;
  const order = located.found.map((item, index) => ({ item, index }));
  if (splitBudget && order.length > 1) {
    const start = ((splitBudget.phase % order.length) + order.length) % order.length;
    order.push(...order.splice(0, start));
  }
  const geometry: LocatedGeometry[] = located.found.map((item, index) => ({ index, bounds: item.bounds }));
  const found: RecoveredComposite[] = [];
  let spent = locateMs;
  for (let n = 0; n < order.length; n++) {
    if (splitBudget && n > 0 && spent >= splitBudget.budgetMs) break;
    const started = performance.now();
    const { item, index } = order[n]!;
    const split = splitComposite(raster, item, palette, method, sample, source?.[index]);
    const channels: Raster[] = [];
    for (const bits of split.bits) {
      if (!bits.some((v) => v)) continue;
      const tRender = performance.now();
      const image = renderChannel(bits, item.qrSize);
      split.renderMs += performance.now() - tRender;
      split.allocBytes += image.width * image.height * 4;
      channels.push(image);
    }
    found.push({ index, split, channels, bounds: item.bounds });
    spent += performance.now() - started;
  }
  return { found, geometry, monoLike: located.monoLike, locateMs, unsplit: geometry.length - found.length };
}

export function scheduleRecovered(
  found: RecoveredComposite[],
  freeSlots: number,
  mode: ScheduleMode,
  phase = 0,
  budget?: ScheduleBudget,
): SchedulePlan<Raster> {
  const items: ScheduledSymbol<Raster>[] = [];
  for (const cell of found) {
    cell.channels.forEach((image, channel) => {
      items.push({ composite: cell.index, channel, payload: image });
    });
  }
  return scheduleSymbols(items, freeSlots, mode, phase, budget);
}

export function paletteFor(profile: OpticalProfileId, paletteId?: string): Palette {
  return paletteById(opticalProfile(profile, paletteId).paletteId);
}

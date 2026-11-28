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
import { scheduleSymbols, type SchedulePlan, type ScheduledSymbol } from "./schedule.ts";
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
): { found: RecoveredComposite[]; monoLike: boolean } {
  const spec = opticalProfile(profile, paletteId);
  if (spec.channels === 1) return { found: [], monoLike: false };
  const palette = paletteById(spec.paletteId);
  const located = locateComposites(raster);
  const found = located.found.map((item, index) => {
    const split = splitComposite(raster, item, palette, method, sample, source?.[index]);
    const channels = split.bits
      .map((bits) => (bits.some((v) => v) ? renderChannel(bits, item.qrSize) : null))
      .filter((img): img is Raster => !!img);
    return { index, split, channels, bounds: item.bounds };
  });
  return { found, monoLike: located.monoLike };
}

export function scheduleRecovered(
  found: RecoveredComposite[],
  freeSlots: number,
  mode: ScheduleMode,
  phase = 0,
): SchedulePlan<Raster> {
  const items: ScheduledSymbol<Raster>[] = [];
  for (const cell of found) {
    cell.channels.forEach((image, channel) => {
      items.push({ composite: cell.index, channel, payload: image });
    });
  }
  return scheduleSymbols(items, freeSlots, mode, phase);
}

export function paletteFor(profile: OpticalProfileId, paletteId?: string): Palette {
  return paletteById(opticalProfile(profile, paletteId).paletteId);
}

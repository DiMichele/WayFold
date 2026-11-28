/** Session lock for the shared color profile. Mono stays the unlocked default. */

import { bindProfile, opticalProfile, parseProfile, type OpticalProfileId } from "./profile.ts";
import { directChannelImages } from "./direct.ts";
import type { RecoveredComposite } from "./engine.ts";
import type { Raster } from "./composite.ts";
import type { ScheduleMode } from "./profile.ts";
import type { SchedulePlan } from "./schedule.ts";
import { optTrace } from "../shared/opt-trace.ts";

const locked = new Map<string, OpticalProfileId>();

export function readProfileSelect(selectId: string): OpticalProfileId {
  const select = document.getElementById(selectId) as HTMLSelectElement | null;
  return parseProfile(select?.value);
}

/** Freeze the select for the session and remember the value the receivers will use. */
export function lockProfileSelect(selectId: string): OpticalProfileId {
  const profile = bindProfile(readProfileSelect(selectId));
  locked.set(selectId, profile);
  const select = document.getElementById(selectId) as HTMLSelectElement | null;
  if (select) {
    select.value = profile;
    select.disabled = true;
  }
  const status = document.getElementById(`${selectId}-status`);
  if (status) status.textContent = profile;
  return profile;
}

export function unlockProfileSelect(selectId: string): void {
  locked.delete(selectId);
  const select = document.getElementById(selectId) as HTMLSelectElement | null;
  if (select) select.disabled = false;
}

export function lockedProfile(selectId: string): OpticalProfileId {
  return locked.get(selectId) ?? "mono";
}

export function profileChannels(id: OpticalProfileId): number {
  return opticalProfile(id).channels;
}

export function setColorHint(hintId: string, text: string | null): void {
  const el = document.getElementById(hintId);
  if (!el) return;
  el.hidden = !text;
  el.textContent = text ?? "";
}

export interface ColorCapture {
  found: RecoveredComposite[];
  /** Every composite whose frame was found, including those not separated this frame. */
  geometry: { index: number; bounds: { x: number; y: number; w: number; h: number } }[];
  plan: SchedulePlan<Raster>;
  monoLike: boolean;
  /** Crop for the next frame. Union of the located geometry, not of the separated cells. */
  bounds: { x: number; y: number; w: number; h: number } | null;
  /**
   * Black-and-white images a normal QR decoder can read from a camera photo.
   * One per channel. This is what the live path hands to the workers.
   */
  readable: Raster[];
}

export interface ColorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Full-frame search interval. A tight crop must not be the only look at the grid. */
export const COLOR_FULL_EVERY = 12;

export function colorSearchRect(
  full: ColorRect,
  crop: ColorRect | null,
  misses: number,
  captureIndex: number,
  forceFull = false,
): { rect: ColorRect; fullFrame: boolean } {
  if (forceFull || !crop || misses >= 2 || captureIndex % COLOR_FULL_EVERY === 0) {
    return { rect: full, fullFrame: true };
  }
  return { rect: crop, fullFrame: false };
}

/**
 * A drop in the number of located frames keeps the previous crop and asks for
 * a full frame next time, so a cell skipped by the budget is not cropped away.
 */
export function noteLocatedGeometry(
  seen: number,
  located: number,
): { seen: number; forceFull: boolean; updateCrop: boolean } {
  if (located >= seen && located > 0) return { seen: located, forceFull: false, updateCrop: true };
  if (seen > 0 && located < seen) return { seen, forceFull: true, updateCrop: false };
  return { seen, forceFull: false, updateCrop: located > 0 };
}

/**
 * Color path only. Callers must not invoke this for Mono.
 * The images in `readable` are ordinary black-and-white QR pictures, one per
 * channel, so the existing decoder can read a photo of the screen.
 */
export function captureColor(
  raster: Raster,
  profile: OpticalProfileId,
  freeSlots: number,
  mode: ScheduleMode = "budget",
  phase = 0,
  workers = freeSlots,
): ColorCapture {
  const channelCount = opticalProfile(profile).channels;
  const readable = directChannelImages(raster, profile);
  const plan: SchedulePlan<Raster> = {
    mode,
    batches: [],
    candidates: readable.length,
    scheduled: readable.length,
    dropped: 0,
    perJob: readable.length ? [readable.length] : [],
    slowest: readable.length,
    nextPhase: phase,
  };
  optTrace.noteColor({
    profile,
    grid: 0,
    located: 0,
    processed: readable.length,
    channels: channelCount,
    candidates: readable.length,
    scheduled: readable.length,
    dropped: 0,
    perJob: plan.perJob,
    workersFree: freeSlots,
    workers,
    saturated: freeSlots < 1,
    limit: freeSlots < 1 ? "pool" : "none",
    locateMs: 0,
    calMs: 0,
    splitMs: 0,
    residual: null,
    condition: null,
    quality: readable.length ? "ok" : "none",
  });
  return { found: [], geometry: [], plan, monoLike: false, bounds: null, readable };
}

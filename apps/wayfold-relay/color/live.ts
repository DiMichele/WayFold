/** Session lock for the shared color profile. Mono stays the unlocked default. */

import { bindProfile, opticalProfile, parseProfile, type OpticalProfileId } from "./profile.ts";
import { recoverRaster, scheduleRecovered, type RecoveredComposite } from "./engine.ts";
import type { Raster } from "./composite.ts";
import type { ScheduleMode } from "./profile.ts";
import type { SchedulePlan } from "./schedule.ts";

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
  plan: SchedulePlan<Raster>;
  monoLike: boolean;
  /** Crop for the next frame, in the same coordinates as the raster that was searched. */
  bounds: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Color path only. Callers must not invoke this for Mono.
 * Returns no plan when the frame has no composite, and never invents a payload.
 */
export function captureColor(
  raster: Raster,
  profile: OpticalProfileId,
  freeSlots: number,
  mode: ScheduleMode = "adaptive",
  phase = 0,
): ColorCapture {
  const recovered = recoverRaster(raster, profile, "hybrid", "module");
  const plan = scheduleRecovered(recovered.found, freeSlots, mode, phase);
  const bounds = recovered.found.length
    ? unionBounds(recovered.found.map((cell) => cell.bounds))
    : null;
  return { found: recovered.found, plan, monoLike: recovered.monoLike, bounds };
}

function unionBounds(boxes: { x: number; y: number; w: number; h: number }[]) {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const pad = 4;
  return { x: Math.max(0, x - pad), y: Math.max(0, y - pad), w: x1 - x + pad * 2, h: y1 - y + pad * 2 };
}

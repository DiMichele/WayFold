/**
 * Diagnostic samples for the three optical receivers.
 * They never change focus, exposure, fps, or payload.
 */

import { quadSpan } from "./link-calibration.ts";
import type { Quad, Rect } from "./decode-core.ts";
import { opticalQualityOfRgba } from "./sharpness.ts";
import { getOptFlags } from "../shared/opt-flags.ts";
import { optTrace } from "../shared/opt-trace.ts";

const SAMPLE_MS = 500;
let lastSample = 0;

export function resetOpticsClock(): void {
  lastSample = 0;
}

/** Center of a crop, or the first known box when the buffer is still the full frame. At most every 500 ms. */
export function noteOpticsFrame(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  region?: Rect,
): void {
  if (!getOptFlags().perf || !(width > 0) || !(height > 0)) return;
  const now = performance.now();
  if (now - lastSample < SAMPLE_MS) return;
  lastSample = now;
  optTrace.setQuality(opticalQualityOfRgba(rgba, width, height, region));
}

/** Shortest finder span, and pixels per module when a version came back with that quad. */
export function noteDecodedGeometry(quads: (Quad | null)[] | undefined, modules?: number[]): void {
  if (!getOptFlags().perf || !quads?.length) return;
  let bestPx = Infinity;
  let bestMod = 0;
  for (let i = 0; i < quads.length; i++) {
    const q = quads[i];
    if (!q) continue;
    const span = quadSpan(q);
    const px = Math.min(span.w, span.h);
    if (!(px > 0) || px >= bestPx) continue;
    bestPx = px;
    bestMod = modules?.[i] ?? 0;
  }
  if (bestPx < Infinity) optTrace.noteSymbol(bestPx, bestMod > 0 ? bestMod : null);
}

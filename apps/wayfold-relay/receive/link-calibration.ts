/**
 * Future Optical Link Calibration. Pure advice from a measured quad.
 * Nothing in the live pipeline calls this, and it does not change fps, payload, or ECC.
 * The 3 px/module figure is a hypothesis to check against real HUD JSON, not a tuned threshold.
 */

import type { Quad } from "./decode-core.ts";

export const PPM_HYPOTHESIS = 3;

export function quadSpan(quad: Quad): { w: number; h: number } {
  const xs = [quad.topLeft.x, quad.topRight.x, quad.bottomRight.x, quad.bottomLeft.x];
  const ys = [quad.topLeft.y, quad.topRight.y, quad.bottomRight.y, quad.bottomLeft.y];
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Camera pixels across the shorter side of one module. */
export function pixelsPerModule(quad: Quad, modules: number): number {
  if (!(modules > 0)) return 0;
  const span = quadSpan(quad);
  return Math.min(span.w, span.h) / modules;
}

export type LinkHeadroom = "low" | "ok" | "wide";

export function linkHeadroom(pixelsPerModule: number): LinkHeadroom {
  if (!(pixelsPerModule >= PPM_HYPOTHESIS)) return "low";
  if (pixelsPerModule < PPM_HYPOTHESIS * 1.6) return "ok";
  return "wide";
}

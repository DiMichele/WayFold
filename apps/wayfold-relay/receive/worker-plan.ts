/** Build the optional decode-plan fields for a worker message. */

import { getOptFlags } from "../shared/opt-flags.ts";
import type { Rect } from "./decode-core.ts";

export interface WorkerPlanFields {
  fast?: boolean;
  mem?: boolean;
  gray?: boolean;
  expected?: number;
  rects?: Rect[] | null;
  budgetMs?: number;
}

/**
 * @param observedFps camera FPS used for the budget period (observed or negotiated)
 * @param expected layout size when known; 0 when unknown
 * @param rects ROI boxes in the buffer about to be sent
 */
export function workerPlanFields(
  observedFps: number,
  expected = 0,
  rects: Rect[] | null = null,
): WorkerPlanFields {
  const flags = getOptFlags();
  if (!flags.fast && !flags.mem && !flags.roi) return {};
  const period = observedFps > 1 ? 1000 / observedFps : 1000 / 30;
  const out: WorkerPlanFields = {};
  if (flags.fast) out.fast = true;
  if (flags.mem) {
    out.mem = true;
    out.gray = true;
  }
  if (flags.roi && rects && rects.length) {
    out.rects = rects;
    out.expected = expected > 0 ? expected : rects.length;
  } else if (flags.fast && expected > 0) {
    out.expected = expected;
  }
  if (flags.fast) {
    out.budgetMs = period * flags.budget;
  }
  return out;
}

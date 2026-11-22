import type { DiodePolicy } from "./policy.ts";

/** First pass is short. Each extra lap adds redundancy, up to a cap, because there is no return channel. */
export function airBudget(lap: number): Pick<DiodePolicy, "repeatFactor" | "minDwellMs"> {
  const step = Math.max(0, Math.min(4, Math.floor(Number.isFinite(lap) ? lap : 0)));
  return {
    repeatFactor: Math.min(2.4, 1.15 + step * 0.3),
    minDwellMs: Math.min(12_000, 2_000 + step * 2_000),
  };
}

/**
 * The live QR yields as soon as a file is ready, except while the user is typing
 * and for a brief hold after a committed line so the camera can catch it.
 */
export function carrierYieldsToFile(
  kind: "beacon" | "draft" | "commit" | null,
  heldMs: number,
  holdMs: number,
  fileCount: number,
): boolean {
  if (fileCount <= 0) return false;
  if (kind === "draft") return false;
  if (kind === "commit") return heldMs >= holdMs;
  return true;
}

/**
 * Frames one object stays on air per carousel turn. There is no back-channel,
 * so TX cannot know when RX is done: it repeats enough fountain symbols for a
 * clean capture (k × repeatFactor) and never less than the minimum dwell.
 */
export function dwellFrames(k: number, fps: number, policy: Pick<DiodePolicy, "repeatFactor" | "minDwellMs">): number {
  const safeK = Math.max(1, Math.floor(k));
  const safeFps = Math.max(1, fps);
  const byTime = Math.ceil((policy.minDwellMs / 1000) * safeFps);
  const bySymbols = Math.ceil(safeK * policy.repeatFactor);
  return Math.max(1, byTime, bySymbols);
}

export interface CarouselStep {
  id: string;
  /** True when the carousel went past the end of the queue and started over. */
  wrapped: boolean;
}

/**
 * Next object to put on air. `ids` is the current queue order; `currentId`
 * may no longer be in it (removed while on air), in which case the item that
 * took its slot goes next.
 */
export function nextOnAir(ids: readonly string[], currentId: string | null, currentIndex = -1): CarouselStep | null {
  if (ids.length === 0) return null;
  if (currentId === null) return { id: ids[0]!, wrapped: false };
  const at = ids.indexOf(currentId);
  const next = at >= 0 ? at + 1 : Math.max(0, currentIndex);
  if (next >= ids.length) return { id: ids[0]!, wrapped: true };
  return { id: ids[next]!, wrapped: false };
}

/** Optical profiles. The engine sees bytes only. Transport stays outside. */

export type OpticalProfileId = "mono" | "color2" | "rgb3";

export type SeparateMethod = "affine" | "classify" | "hybrid";

export type SampleMode = "module" | "pixel";

export type ScheduleMode = "channel" | "composite" | "cell" | "adaptive" | "budget";

export interface OpticalProfile {
  id: OpticalProfileId;
  /** Independent payloads painted in one composite. */
  channels: 1 | 2 | 3;
  /** Palette id. Mono has none. */
  paletteId: string;
}

export interface ProfileObservation {
  profile: OpticalProfile;
  /** Success 0..1 per channel. */
  success: number[];
  /** Mean |observed - predicted| on the calibration swatches, 0..255. */
  residual: number;
  /** Condition number of the affine fit. Null for classify-only. */
  condition: number | null;
  calMs: number;
  splitMs: number;
  decodeMs: number;
}

const PROFILES: Record<OpticalProfileId, OpticalProfile> = {
  mono: { id: "mono", channels: 1, paletteId: "mono" },
  color2: { id: "color2", channels: 2, paletteId: "rb" },
  rgb3: { id: "rgb3", channels: 3, paletteId: "rgb" },
};

export function opticalProfile(id: OpticalProfileId, paletteId?: string): OpticalProfile {
  const base = PROFILES[id] ?? PROFILES.mono;
  if (!paletteId || id === "mono") return base;
  return { ...base, paletteId };
}

export function parseProfile(raw: string | null | undefined): OpticalProfileId {
  if (raw === "color2" || raw === "rgb3") return raw;
  return "mono";
}

/**
 * Future Optical Auto-Tuning will call this. Today it returns the local choice
 * and does not write anything on the wire.
 */
export function bindProfile(local: OpticalProfileId): OpticalProfileId {
  return parseProfile(local);
}

/** Rank measured rows. Does not change a live session. */
export function compareProfiles(rows: ProfileObservation[]): ProfileObservation[] {
  return [...rows].sort((a, b) => {
    const as = Math.min(...a.success, 1);
    const bs = Math.min(...b.success, 1);
    if (bs !== as) return bs - as;
    return a.decodeMs + a.splitMs + a.calMs - (b.decodeMs + b.splitMs + b.calMs);
  });
}

/** bits/s ceiling of a windowed ARQ link. Theoretical, not a measurement. */
export function windowCapacityBitrate(windowSegments: number, mtuBytes: number, rttSec: number): number {
  if (!(windowSegments > 0) || !(mtuBytes > 0) || !(rttSec > 0)) return 0;
  return (windowSegments * mtuBytes * 8) / rttSec;
}

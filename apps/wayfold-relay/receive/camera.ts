/** ImageCapture extras used by Chrome/Android (not in every lib.dom version). */
export type QrTrackCapabilities = {
  focusMode?: string[];
  focusDistance?: { min: number; max: number; step?: number };
  zoom?: { min: number; max: number; step?: number };
  pointsOfInterest?: boolean;
  exposureMode?: string[];
  exposureCompensation?: { min: number; max: number; step?: number };
  /**
   * W3C MediaStream Image Capture: min, max and step are in units of 100 µs.
   * 1 unit = 0.0001 s. 4 ms is 40, 8 ms is 80, 16 ms is 160.
   */
  exposureTime?: { min: number; max: number; step?: number };
};

export type FocusPoint = { x: number; y: number };

export type FocusModePref = "continuous" | "single-shot" | "auto";

/** Startup keeps continuous AF. Tap fires a single-shot on the point. */
export type FocusApplyKind = "startup" | "tap";

/** Opt-in exposure experiment. These shutters are hypotheses for the validation matrix, not defaults. */
export const SHORT_EXPOSURE_S = 1 / 125;

/** W3C exposureTime unit. Multiply seconds by this to get the browser value. */
export const EXPOSURE_API_PER_SECOND = 10_000;

export type ExposureIntent = "off" | "continuous" | "short" | 4 | 8 | 16;

export function exposureCapSeconds(intent: ExposureIntent): number | null {
  if (intent === "short") return SHORT_EXPOSURE_S;
  if (intent === 4 || intent === 8 || intent === 16) return intent / 1000;
  return null;
}

/** Seconds → W3C exposureTime (100 µs units). */
export function exposureSecondsToApi(seconds: number): number {
  return seconds * EXPOSURE_API_PER_SECOND;
}

/** W3C exposureTime → seconds. Null when the camera did not report a number. */
export function exposureApiToSeconds(units: number | null | undefined): number | null {
  if (typeof units !== "number" || !Number.isFinite(units)) return null;
  return units / EXPOSURE_API_PER_SECOND;
}

/**
 * Shortest value inside `range` that does not exceed `cap`.
 * `range` and `cap` are the same unit. Callers that talk to the browser pass 100 µs units.
 */
export function shortestExposure(
  range: { min: number; max: number },
  cap = exposureSecondsToApi(SHORT_EXPOSURE_S),
): number | null {
  const min = range.min;
  const max = range.max;
  if (!(max > min) || !(cap > 0)) return null;
  if (min >= cap) return min;
  return Math.min(cap, max);
}

/** True when the capability list can express the intent, before any fallback. */
export function exposureHardware(caps: QrTrackCapabilities, intent: ExposureIntent): boolean {
  if (intent === "off") return false;
  const modes = caps.exposureMode ?? [];
  if (intent === "continuous") return modes.includes("continuous");
  const range = caps.exposureTime;
  if (!range || !(range.max > range.min)) return false;
  return modes.length === 0 || modes.includes("manual");
}

/** Constraint fields for the exposure experiment. Null when the device cannot express the intent. */
export function exposureAdvanced(
  caps: QrTrackCapabilities,
  intent: ExposureIntent,
): Record<string, unknown> | null {
  if (intent === "off") return null;
  const modes = caps.exposureMode ?? [];
  if (intent === "continuous") {
    return modes.includes("continuous") ? { exposureMode: "continuous" } : null;
  }
  const cap = exposureCapSeconds(intent);
  if (cap != null && caps.exposureTime && (modes.length === 0 || modes.includes("manual"))) {
    const time = shortestExposure(caps.exposureTime, exposureSecondsToApi(cap));
    if (time == null) return null;
    const out: Record<string, unknown> = { exposureTime: time };
    if (modes.includes("manual")) out.exposureMode = "manual";
    return out;
  }
  return modes.includes("continuous") ? { exposureMode: "continuous" } : null;
}

export type ExposureTelemetry = {
  intent: ExposureIntent;
  /** Seconds asked for. Null for off and for continuous. */
  requestedTimeS: number | null;
  /** Capabilities can express the intent. False when only a fallback mode exists. */
  hardware: boolean;
  /** applyConstraints resolved for a constraint that included exposure. Not proof it stuck. */
  accepted: boolean;
  /** getSettings matches the request. A resolved promise alone does not set this. */
  detected: boolean;
  /** A different shutter was sent, the constraint was rejected, or getSettings disagrees. */
  fallback: boolean;
  mode: string | null;
  /** Seconds, converted from getSettings().exposureTime. */
  timeS: number | null;
  compensation: number | null;
  modes: string[];
};

function exposureTimesClose(actualS: number, requestedS: number): boolean {
  const oneUnit = 1 / EXPOSURE_API_PER_SECOND;
  const tol = Math.max(oneUnit, Math.abs(requestedS) * 0.05);
  return Math.abs(actualS - requestedS) <= tol;
}

function sentMatchesRequest(
  intent: ExposureIntent,
  sent: Record<string, unknown> | null,
  requestedTimeS: number | null,
): boolean {
  if (!sent) return false;
  if (intent === "continuous") return sent.exposureMode === "continuous" && sent.exposureTime == null;
  if (requestedTimeS == null) return false;
  const sentS = exposureApiToSeconds(typeof sent.exposureTime === "number" ? sent.exposureTime : null);
  const modeOk = sent.exposureMode == null || sent.exposureMode === "manual";
  return modeOk && sentS != null && exposureTimesClose(sentS, requestedTimeS);
}

/**
 * Split a camera attempt into request, hardware, accepted constraint, and the
 * shutter getSettings actually reports. `settings.exposureTime` is still in
 * 100 µs units; `timeS` is seconds.
 */
export function describeExposure(input: {
  intent: ExposureIntent;
  caps: QrTrackCapabilities;
  sent: Record<string, unknown> | null;
  accepted: boolean;
  settings: { exposureMode?: string; exposureTime?: number; exposureCompensation?: number };
}): ExposureTelemetry {
  const requestedTimeS = exposureCapSeconds(input.intent);
  const hardware = exposureHardware(input.caps, input.intent);
  const mode = typeof input.settings.exposureMode === "string" ? input.settings.exposureMode : null;
  const timeS = exposureApiToSeconds(input.settings.exposureTime);
  const compensation =
    typeof input.settings.exposureCompensation === "number" ? input.settings.exposureCompensation : null;
  let detected = false;
  if (input.intent === "continuous") detected = mode === "continuous";
  else if (requestedTimeS != null && timeS != null) detected = exposureTimesClose(timeS, requestedTimeS);
  const sentOk = sentMatchesRequest(input.intent, input.sent, requestedTimeS);
  const attempted = input.intent !== "off";
  const fallback =
    attempted &&
    ((input.sent != null && !sentOk) || (input.accepted && !detected) || (sentOk && !input.accepted));
  return {
    intent: input.intent,
    requestedTimeS,
    hardware,
    accepted: input.accepted,
    detected,
    fallback,
    mode,
    timeS,
    compensation,
    modes: input.caps.exposureMode ?? [],
  };
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/** Distance for a QR on a nearby screen (typically 20–40 cm). Last-resort for manual-only lenses. */
export function pickCloseFocusDistance(range: { min: number; max: number }): number {
  const min = range.min;
  const max = range.max;
  if (!(max > min)) return min;
  const targetMeters = 0.28;
  if (targetMeters >= min && targetMeters <= max) return targetMeters;
  return min + (max - min) * 0.22;
}

/**
 * Prefer a mild tele zoom. Cheap phones often default to ultra-wide (zoom < 1),
 * which keeps the QR tiny and the lens focused toward infinity.
 */
export function pickQrZoom(range: { min: number; max: number }): number | null {
  const min = range.min;
  const max = range.max;
  if (!(max > min)) return null;
  const want = 1.35;
  const z = Math.min(max, Math.max(min, want));
  if (min < 0.95) return z;
  if (z < min + 0.12) return null;
  return z;
}

export function chooseFocusMode(modes: string[] | undefined, pref: FocusModePref): string | undefined {
  const list = modes ?? [];
  if (pref === "continuous" && list.includes("continuous")) return "continuous";
  if (pref === "single-shot" && list.includes("single-shot")) return "single-shot";
  if (list.includes("continuous")) return "continuous";
  if (list.includes("single-shot")) return "single-shot";
  return undefined;
}

export function hasFocusControl(caps: QrTrackCapabilities): boolean {
  const modes = caps.focusMode ?? [];
  if (modes.includes("continuous") || modes.includes("single-shot") || modes.includes("manual")) return true;
  return !!caps.pointsOfInterest || !!caps.focusDistance;
}

function onlyManual(caps: QrTrackCapabilities): boolean {
  const modes = caps.focusMode ?? [];
  return modes.length > 0 && modes.every((m) => m === "manual");
}

export function qrFocusAdvanced(
  caps: QrTrackCapabilities,
  point: FocusPoint = { x: 0.5, y: 0.5 },
  pref: FocusModePref = "auto",
  kind: FocusApplyKind = "startup",
): Record<string, unknown> | null {
  const advanced: Record<string, unknown> = {};
  const focusMode = chooseFocusMode(caps.focusMode, pref);
  if (focusMode) advanced.focusMode = focusMode;
  else if (onlyManual(caps)) advanced.focusMode = "manual";

  if (caps.pointsOfInterest) {
    advanced.pointsOfInterest = [{ x: clamp01(point.x), y: clamp01(point.y) }];
  }

  // Fixed distance only when the driver exposes nothing but manual focus.
  if (onlyManual(caps) && caps.focusDistance) {
    advanced.focusDistance = pickCloseFocusDistance(caps.focusDistance);
  }

  if (kind === "startup" && caps.zoom) {
    const zoom = pickQrZoom(caps.zoom);
    if (zoom != null) advanced.zoom = zoom;
  }

  return Object.keys(advanced).length ? advanced : null;
}

/** Progressive constraint sets: full request first, then drop keys that often Overconstrain. */
export function qrFocusConstraintFallbacks(
  caps: QrTrackCapabilities,
  point: FocusPoint = { x: 0.5, y: 0.5 },
  pref: FocusModePref = "auto",
  kind: FocusApplyKind = "startup",
): MediaTrackConstraints[] {
  const full = qrFocusAdvanced(caps, point, pref, kind);
  if (!full) return [];

  const variants: Record<string, unknown>[] = [full];
  if ("zoom" in full) {
    const { zoom: _z, ...rest } = full;
    if (Object.keys(rest).length) variants.push(rest);
  }
  if ("focusDistance" in full) {
    const stripped = { ...full };
    delete stripped.focusDistance;
    delete stripped.zoom;
    if (Object.keys(stripped).length) variants.push(stripped);
  }
  if (typeof full.focusMode === "string") {
    variants.push({ focusMode: full.focusMode });
  }

  const seen = new Set<string>();
  const out: MediaTrackConstraints[] = [];
  for (const item of variants) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ advanced: [item] } as MediaTrackConstraints);
  }
  return out;
}

export function tapPointFromEvent(
  clientX: number,
  clientY: number,
  rect: { left: number; width: number; top: number; height: number },
): FocusPoint {
  const x = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const y = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  return { x: clamp01(x), y: clamp01(y) };
}

/**
 * Map a tap on a letterboxed/cover preview to normalized camera-frame coordinates.
 * `objectFit` "cover" crops; "contain" letterboxes. Rotation is degrees clockwise
 * already applied to the grab canvas (modem turn).
 */
export function tapPointInVideoFrame(
  clientX: number,
  clientY: number,
  preview: { left: number; width: number; top: number; height: number },
  videoWidth: number,
  videoHeight: number,
  objectFit: "cover" | "contain" = "contain",
): FocusPoint {
  const nx = preview.width > 0 ? (clientX - preview.left) / preview.width : 0.5;
  const ny = preview.height > 0 ? (clientY - preview.top) / preview.height : 0.5;
  if (!(videoWidth > 0) || !(videoHeight > 0) || !(preview.width > 0) || !(preview.height > 0)) {
    return { x: clamp01(nx), y: clamp01(ny) };
  }
  const scale =
    objectFit === "cover"
      ? Math.max(preview.width / videoWidth, preview.height / videoHeight)
      : Math.min(preview.width / videoWidth, preview.height / videoHeight);
  const dispW = videoWidth * scale;
  const dispH = videoHeight * scale;
  const ox = (preview.width - dispW) / 2;
  const oy = (preview.height - dispH) / 2;
  const px = nx * preview.width - ox;
  const py = ny * preview.height - oy;
  return { x: clamp01(px / dispW), y: clamp01(py / dispH) };
}

export async function applyFirstSupportedConstraint(
  track: { applyConstraints(constraints: MediaTrackConstraints): Promise<void> },
  chain: MediaTrackConstraints[],
): Promise<boolean> {
  for (const constraints of chain) {
    try {
      await track.applyConstraints(constraints);
      return true;
    } catch {
      /* device rejected this combination — try a simpler one */
    }
  }
  return false;
}

export type FocusApplyResult = {
  applied: boolean;
  supported: boolean;
  /** Constraint submitted for the exposure experiment, or null when nothing was sent. Values are W3C units. */
  exposureSent: Record<string, unknown> | null;
  /** The resolved constraint included exposure fields. getSettings is still required to confirm it. */
  exposureAccepted: boolean;
  settings: {
    focusMode?: string;
    focusDistance?: number;
    exposureMode?: string;
    /** Raw getSettings().exposureTime, in units of 100 µs. */
    exposureTime?: number;
    exposureCompensation?: number;
  };
};

/** Apply focus constraints and read back getSettings when possible. */
function withExposure(constraints: MediaTrackConstraints, exposure: Record<string, unknown>): MediaTrackConstraints {
  const advanced = (constraints as { advanced?: Record<string, unknown>[] }).advanced;
  const first = advanced?.[0] ?? {};
  return { advanced: [{ ...first, ...exposure }] } as MediaTrackConstraints;
}

export async function applyQrFocusConstraints(
  track: MediaStreamTrack,
  caps: QrTrackCapabilities,
  point: FocusPoint,
  pref: FocusModePref,
  kind: FocusApplyKind,
  exposure: ExposureIntent = "off",
): Promise<FocusApplyResult> {
  const supported = hasFocusControl(caps);
  const focusChain = qrFocusConstraintFallbacks(caps, point, pref, kind);
  const exp = exposureAdvanced(caps, exposure);
  const chain: MediaTrackConstraints[] = [];
  if (exp) {
    if (focusChain[0]) chain.push(withExposure(focusChain[0], exp));
    chain.push({ advanced: [exp] } as MediaTrackConstraints);
  }
  chain.push(...focusChain);
  let applied = false;
  let exposureAccepted = false;
  for (const constraints of chain) {
    try {
      await track.applyConstraints(constraints);
      applied = true;
      const adv = (constraints as { advanced?: Record<string, unknown>[] }).advanced?.[0];
      exposureAccepted = !!exp && !!adv && ("exposureMode" in adv || "exposureTime" in adv);
      break;
    } catch {
      /* device rejected this combination — try a simpler one */
    }
  }
  let settings: FocusApplyResult["settings"] = {};
  try {
    const s = track.getSettings?.() as FocusApplyResult["settings"];
    settings = {
      focusMode: typeof s?.focusMode === "string" ? s.focusMode : undefined,
      focusDistance: typeof s?.focusDistance === "number" ? s.focusDistance : undefined,
      exposureMode: typeof s?.exposureMode === "string" ? s.exposureMode : undefined,
      exposureTime: typeof s?.exposureTime === "number" ? s.exposureTime : undefined,
      exposureCompensation: typeof s?.exposureCompensation === "number" ? s.exposureCompensation : undefined,
    };
  } catch {
    /* ignore */
  }
  return { applied, supported, exposureSent: exp, exposureAccepted, settings };
}

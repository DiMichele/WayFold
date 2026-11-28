/** Laplacian variance on a small ROI — diagnostic only, never steers the lens. */

export function rgbaRegionToGray(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  rw: number,
  rh: number,
): { gray: Uint8Array; width: number; height: number } {
  const sx = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const sy = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const tw = Math.max(1, Math.min(width - sx, Math.floor(rw)));
  const th = Math.max(1, Math.min(height - sy, Math.floor(rh)));
  const gray = new Uint8Array(tw * th);
  for (let row = 0; row < th; row++) {
    const srcRow = ((sy + row) * width + sx) * 4;
    const dstRow = row * tw;
    for (let col = 0; col < tw; col++) {
      const i = srcRow + col * 4;
      gray[dstRow + col] = (rgba[i]! * 77 + rgba[i + 1]! * 150 + rgba[i + 2]! * 29) >> 8;
    }
  }
  return { gray, width: tw, height: th };
}

/** Sampled Laplacian variance. Higher = sharper. */
export function laplacianVariance(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const c = gray[y * width + x]!;
      const lap =
        -4 * c +
        gray[y * width + (x - 1)]! +
        gray[y * width + (x + 1)]! +
        gray[(y - 1) * width + x]! +
        gray[(y + 1) * width + x]!;
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export interface OpticalQuality {
  /** Laplacian variance. Higher means a sharper sample. */
  sharpness: number;
  /** Mean luma, 0–255. */
  brightness: number;
  /** Standard deviation of luma. */
  contrast: number;
  /** Share of samples at the black or white rail. */
  saturated: number;
}

/** One gray conversion feeds sharpness and the luma stats. The box is capped so a full frame stays cheap. */
export function opticalQualityOfRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  region?: { x: number; y: number; w: number; h: number },
): OpticalQuality {
  const focus = capBox(width, height, region);
  const { gray, width: gw, height: gh } = rgbaRegionToGray(rgba, width, height, focus.x, focus.y, focus.w, focus.h);
  const sharpness = laplacianVariance(gray, gw, gh);
  const step = gw * gh > 8000 ? Math.max(1, Math.ceil(Math.sqrt((gw * gh) / 8000))) : 1;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  let sat = 0;
  for (let i = 0; i < gray.length; i += step) {
    const v = gray[i]!;
    sum += v;
    sumSq += v * v;
    if (v <= 4 || v >= 251) sat++;
    n++;
  }
  const mean = n ? sum / n : 0;
  const variance = n ? Math.max(0, sumSq / n - mean * mean) : 0;
  return { sharpness, brightness: mean, contrast: Math.sqrt(variance), saturated: n ? sat / n : 0 };
}

function capBox(
  width: number,
  height: number,
  region?: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const side = 160;
  const base = region ?? {
    x: Math.max(0, Math.floor((width - Math.min(width, side)) / 2)),
    y: Math.max(0, Math.floor((height - Math.min(height, side)) / 2)),
    w: Math.min(width, side),
    h: Math.min(height, side),
  };
  if (base.w <= side && base.h <= side) return base;
  const rw = Math.min(base.w, side);
  const rh = Math.min(base.h, side);
  return {
    x: base.x + Math.floor((base.w - rw) / 2),
    y: base.y + Math.floor((base.h - rh) / 2),
    w: rw,
    h: rh,
  };
}

/** Convenience: variance of the center (or given) region of an RGBA frame. */
export function sharpnessOfRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  region?: { x: number; y: number; w: number; h: number },
): number {
  const box = region ?? {
    x: Math.floor(width * 0.3),
    y: Math.floor(height * 0.3),
    w: Math.floor(width * 0.4),
    h: Math.floor(height * 0.4),
  };
  const { gray, width: gw, height: gh } = rgbaRegionToGray(rgba, width, height, box.x, box.y, box.w, box.h);
  return laplacianVariance(gray, gw, gh);
}

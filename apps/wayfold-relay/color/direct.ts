/** Turn a camera picture of a color composite into one black-and-white QR image per channel. */

import type { Raster } from "./composite.ts";
import { opticalProfile, type OpticalProfileId } from "./profile.ts";

/**
 * Dark bit = that primary's ink is present.
 * Neutral pixels (the screen's black and white) set every channel together,
 * so a phone can read the code without first finding the thin color frame.
 */
export function frameLooksColored(raster: Raster): boolean {
  const { data, width, height } = raster;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 24));
  let sat = 0;
  let n = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      sat += Math.max(r, g, b) - Math.min(r, g, b);
      n++;
    }
  }
  return n > 0 && sat / n > 18;
}

export function directChannelImages(raster: Raster, profile: OpticalProfileId, paletteId?: string): Raster[] {
  const spec = opticalProfile(profile, paletteId);
  if (spec.channels < 2) return [];
  const { data, width, height } = raster;
  const planes = Array.from({ length: spec.channels }, () => new Uint8ClampedArray(width * height * 4));
  for (let p = 0; p < data.length; p += 4) {
    const bits = inkBits(data[p]!, data[p + 1]!, data[p + 2]!, spec.channels, spec.paletteId);
    const pixel = p;
    for (let c = 0; c < spec.channels; c++) {
      const plane = planes[c]!;
      const dark = (bits >> c) & 1;
      const v = dark ? 0 : 255;
      plane[pixel] = v;
      plane[pixel + 1] = v;
      plane[pixel + 2] = v;
      plane[pixel + 3] = 255;
    }
  }
  return planes.map((plane) => ({ data: plane, width, height }));
}

function inkBits(r: number, g: number, b: number, channels: number, paletteId: string): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max - min;
  const all = (1 << channels) - 1;
  // A phone photographing a monitor turns white warm and black soft.
  if (max <= 96) return all;
  if ((sat <= 48 && min >= 105) || (max >= 160 && min >= max * 0.55 && sat <= 115)) return 0;
  if (channels === 2 && paletteId !== "rgb") return pairBits(r, g, b, paletteId);
  let bits = 0;
  if (r >= 70 && r >= max - 60) bits |= 1;
  if (g >= 70 && g >= max - 60) bits |= 2;
  if (b >= 70 && b >= max - 60) bits |= 4;
  return bits;
}

function pairBits(r: number, g: number, b: number, paletteId: string): number {
  const first = paletteId === "gb" ? g : r;
  const second = paletteId === "rg" ? g : b;
  let bits = 0;
  if (first >= 70 && first >= Math.max(r, g, b) - 60) bits |= 1;
  if (second >= 70 && second >= Math.max(r, g, b) - 60) bits |= 2;
  return bits;
}

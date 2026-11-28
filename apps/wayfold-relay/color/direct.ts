/** Turn a camera picture of a color composite into one black-and-white QR image per channel. */

import type { Raster } from "./composite.ts";
import { opticalProfile, type OpticalProfileId } from "./profile.ts";

/**
 * Dark bit = that primary's ink is present.
 * Neutral pixels (the screen's black and white) set every channel together,
 * so a phone can read the code without first finding the thin color frame.
 */
export function directChannelImages(raster: Raster, profile: OpticalProfileId, paletteId?: string): Raster[] {
  const spec = opticalProfile(profile, paletteId);
  if (spec.channels < 2) return [];
  const source = cropToColor(raster);
  const { width, height } = source;
  const planes = Array.from({ length: spec.channels }, () => new Uint8ClampedArray(width * height * 4));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = ((source.y + y) * raster.width + (source.x + x)) * 4;
      const bits = inkBits(raster.data[from]!, raster.data[from + 1]!, raster.data[from + 2]!, spec.channels, spec.paletteId);
      const pixel = (y * width + x) * 4;
      for (let c = 0; c < spec.channels; c++) {
        const plane = planes[c]!;
        const v = (bits >> c) & 1 ? 0 : 255;
        plane[pixel] = v;
        plane[pixel + 1] = v;
        plane[pixel + 2] = v;
        plane[pixel + 3] = 255;
      }
    }
  }
  return planes.map((plane) => fitForDecode({ data: plane, width, height }));
}

/** ZXing gets slow on a full camera frame, and a blind downscale erases a dense code. */
function fitForDecode(plane: { data: Uint8ClampedArray; width: number; height: number }) {
  const side = Math.max(plane.width, plane.height);
  if (side <= 760) return plane;
  const scale = 760 / side;
  const width = Math.max(1, Math.round(plane.width * scale));
  const height = Math.max(1, Math.round(plane.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(plane.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(plane.width - 1, Math.floor(x / scale));
      const s = (sy * plane.width + sx) * 4;
      const d = (y * width + x) * 4;
      data[d] = plane.data[s]!;
      data[d + 1] = plane.data[s + 1]!;
      data[d + 2] = plane.data[s + 2]!;
      data[d + 3] = 255;
    }
  }
  return { data, width, height };
}

/** The colorful code, plus a margin, when the camera frame is mostly the page around it. */
function cropToColor(raster: Raster): { x: number; y: number; width: number; height: number } {
  const { data, width, height } = raster;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 80));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let n = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 48 && Math.max(r, g, b) > 90) {
        n++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const full = { x: 0, y: 0, width, height };
  if (n < 12 || maxX < 0) return full;
  const boxW = maxX - minX + step;
  const boxH = maxY - minY + step;
  if (boxW * boxH > width * height * 0.72) return full;
  const padX = Math.max(step * 2, Math.round(boxW * 0.22));
  const padY = Math.max(step * 2, Math.round(boxH * 0.22));
  const x = Math.max(0, minX - padX);
  const y = Math.max(0, minY - padY);
  const right = Math.min(width, maxX + padX + step);
  const bottom = Math.min(height, maxY + padY + step);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function inkBits(r: number, g: number, b: number, channels: number, paletteId: string): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max - min;
  const all = (1 << channels) - 1;
  // Warm monitor white still has all three channels high.
  if (min >= 148 && sat <= 88) return 0;
  if (sat <= 40 && min >= 112) return 0;
  // Soft black, but a dim primary keeps one channel clearly above the others.
  if (max <= 46 || (sat <= 26 && max <= 100)) return all;
  if (channels === 2 && paletteId !== "rgb") return pairBits(r, g, b, paletteId);
  const gate = Math.max(58, max * 0.42);
  let bits = 0;
  if (r >= gate && r >= max - 72) bits |= 1;
  if (g >= gate && g >= max - 72) bits |= 2;
  if (b >= gate && b >= max - 72) bits |= 4;
  if (!bits && max <= 100) return all;
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

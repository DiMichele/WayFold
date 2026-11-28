/** Shared crop of a camera frame. The source rectangle is drawn, then only that rectangle is read back. */

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Resize `canvas` to the crop and return its pixels.
 * Callers that rotate the whole frame first should read the sub-rectangle themselves:
 * this helper always samples `source` in its own coordinates.
 */
export function readVideoRegion(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  rect: FrameRect,
): ImageData {
  const w = Math.max(1, Math.floor(rect.w));
  const h = Math.max(1, Math.floor(rect.h));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

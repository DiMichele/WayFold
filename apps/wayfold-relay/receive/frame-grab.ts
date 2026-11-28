/** Shared crop of a camera frame. The source rectangle is drawn, then only that rectangle is read back. */

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type QuarterTurn = 0 | 90 | 180 | 270;

/**
 * Axis-aligned video rectangle that lands on `rect` after the modem's canvas turn.
 * 90° and 270° swap the sides. The rectangle stays in source pixels.
 */
export function sourceRectForTurn(rect: FrameRect, turn: QuarterTurn, vw: number, vh: number): FrameRect {
  const { x, y, w, h } = rect;
  if (turn === 90) return { x: y, y: vh - (x + w), w: h, h: w };
  if (turn === 180) return { x: vw - (x + w), y: vh - (y + h), w, h };
  if (turn === 270) return { x: vw - (y + h), y: x, w: h, h: w };
  return { x, y, w, h };
}

/** Integer rotate matching the modem CTM: 90° maps (sx, sy) to (vh-1-sy, sx). */
export function rotateRaster(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  turn: QuarterTurn,
): { data: Uint8ClampedArray; width: number; height: number } {
  if (turn === 0) return { data: src, width: w, height: h };
  const dw = turn === 180 ? w : h;
  const dh = turn === 180 ? h : w;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let dx = x;
      let dy = y;
      if (turn === 90) {
        dx = h - 1 - y;
        dy = x;
      } else if (turn === 180) {
        dx = w - 1 - x;
        dy = h - 1 - y;
      } else {
        dx = y;
        dy = w - 1 - x;
      }
      const s = (y * w + x) * 4;
      const d = (dy * dw + dx) * 4;
      out[d] = src[s]!;
      out[d + 1] = src[s + 1]!;
      out[d + 2] = src[s + 2]!;
      out[d + 3] = src[s + 3]!;
    }
  }
  return { data: out, width: dw, height: dh };
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

/**
 * Read an upright crop. The turn is the same canvas transform the mono path uses.
 * The canvas is only as large as the crop, so a known ROI is not copied as a full frame.
 */
export function readUprightRegion(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  turn: QuarterTurn,
  vw: number,
  vh: number,
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
  ctx.imageSmoothingEnabled = false;
  if (turn === 0) {
    ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }
  ctx.translate(-rect.x, -rect.y);
  if (turn === 90) {
    ctx.translate(vh, 0);
    ctx.rotate(Math.PI / 2);
  } else if (turn === 180) {
    ctx.translate(vw, vh);
    ctx.rotate(Math.PI);
  } else if (turn === 270) {
    ctx.translate(0, vw);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

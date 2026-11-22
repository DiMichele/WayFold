/** Center crop of an RGBA buffer. Used to enlarge the QR when the lens is slightly soft. */
export function cropRgbaCenter(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  ratio = 0.58,
): { data: Uint8ClampedArray; width: number; height: number } {
  const r = Math.min(0.95, Math.max(0.3, ratio));
  const cw = Math.max(16, Math.floor(width * r));
  const ch = Math.max(16, Math.floor(height * r));
  const sx = Math.floor((width - cw) / 2);
  const sy = Math.floor((height - ch) / 2);
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcOff = ((sy + y) * width + sx) * 4;
    out.set(data.subarray(srcOff, srcOff + cw * 4), y * cw * 4);
  }
  return { data: out, width: cw, height: ch };
}

/** Axis-aligned crop. Used to read one cell of a 2-up or 4-up grid. */
export function cropRgbaRect(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  cw: number,
  ch: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const sx = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const sy = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const tw = Math.max(1, Math.min(width - sx, Math.floor(cw)));
  const th = Math.max(1, Math.min(height - sy, Math.floor(ch)));
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let row = 0; row < th; row++) {
    const srcOff = ((sy + row) * width + sx) * 4;
    out.set(data.subarray(srcOff, srcOff + tw * 4), row * tw * 4);
  }
  return { data: out, width: tw, height: th };
}

/**
 * Four overlapping tiles of the middle 72% of the frame.
 * A screen sitting in the center is cut in half by a full-frame quadrant.
 */
export function centerTileRects(
  width: number,
  height: number,
): Array<{ x: number; y: number; w: number; h: number }> {
  const cw = Math.max(16, Math.floor(width * 0.72));
  const ch = Math.max(16, Math.floor(height * 0.72));
  const ox = Math.floor((width - cw) / 2);
  const oy = Math.floor((height - ch) / 2);
  const tw = Math.max(16, Math.floor(cw * 0.62));
  const th = Math.max(16, Math.floor(ch * 0.62));
  return [
    { x: ox, y: oy, w: tw, h: th },
    { x: ox + cw - tw, y: oy, w: tw, h: th },
    { x: ox, y: oy + ch - th, w: tw, h: th },
    { x: ox + cw - tw, y: oy + ch - th, w: tw, h: th },
  ];
}

/** Halves, then quadrants. A camera frame of several QR codes often fails as one image. */
export function gridSliceRects(
  width: number,
  height: number,
): Array<{ x: number; y: number; w: number; h: number }> {
  const hw = Math.floor(width / 2);
  const hh = Math.floor(height / 2);
  const rw = width - hw;
  const rh = height - hh;
  return [
    { x: 0, y: 0, w: width, h: hh },
    { x: 0, y: hh, w: width, h: rh },
    { x: 0, y: 0, w: hw, h: height },
    { x: hw, y: 0, w: rw, h: height },
    { x: 0, y: 0, w: hw, h: hh },
    { x: hw, y: 0, w: rw, h: hh },
    { x: 0, y: hh, w: hw, h: rh },
    { x: hw, y: hh, w: rw, h: rh },
  ];
}

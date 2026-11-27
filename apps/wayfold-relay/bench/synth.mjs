// Synthetic camera frames for the optical benchmarks. A sender screen (the same
// QR raster the app paints) is projected into a camera frame through a
// homography, then degraded. This is a model of the optics, not a camera.
import QRCode from "qrcode";

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function randomBytes(n, seed) {
  const r = rng(seed);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(r() * 256);
  return out;
}

/** Byte-mode QR, mask 4 like the sender. Returns null when the payload does not fit. */
export function qrFor(bytes, ecc, version) {
  try {
    const qr = QRCode.create([{ data: bytes, mode: "byte" }], { errorCorrectionLevel: ecc, version, maskPattern: 4 });
    return { size: qr.modules.size, dark: qr.modules.data, version: qr.version };
  } catch {
    return null;
  }
}

export function layoutFor(n, wide = true) {
  if (n === 4) return { cols: 2, rows: 2 };
  if (n === 3) return wide ? { cols: 3, rows: 1 } : { cols: 1, rows: 3 };
  if (n === 2) return wide ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
  return { cols: 1, rows: 1 };
}

/** The sender screen in module units: quiet zone, and an 8% gutter between codes. */
export function screen(codes, cols, rows, margin = 4) {
  const cell = codes[0].size + 2 * margin;
  const gutter = codes.length > 1 ? Math.max(4, Math.round(cell * 0.08)) : 0;
  const w = cell * cols + gutter * (cols - 1);
  const h = cell * rows + gutter * (rows - 1);
  const lum = new Uint8Array(w * h).fill(255);
  const cells = [];
  codes.forEach((c, i) => {
    const ox = (i % cols) * (cell + gutter);
    const oy = Math.floor(i / cols) * (cell + gutter);
    cells.push({ x: ox + margin, y: oy + margin, size: c.size });
    for (let y = 0; y < c.size; y++) {
      const row = (oy + margin + y) * w + ox + margin;
      for (let x = 0; x < c.size; x++) if (c.dark[y * c.size + x]) lum[row + x] = 0;
    }
  });
  return { w, h, lum, cells };
}

function solve8(a, b) {
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k < n; k++) a[r][k] -= f * a[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k];
    x[r] = s / a[r][r];
  }
  return x;
}

/** 3x3 homography mapping the four `src` points onto `dst`. */
export function homography(src, dst) {
  const a = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve8(a, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function project(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

function boxBlurH(src, dst, w, h, r) {
  const span = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc / span;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
}

function boxBlurV(src, dst, w, h, r) {
  const span = 2 * r + 1;
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += src[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc / span;
      acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
    }
  }
}

/**
 * Projects the screen into a camera frame and degrades it.
 * fill: screen height over frame height. tilt: keystone (0 = flat). rot: degrees.
 * blur: box radius in px (3 passes, close to a Gaussian). motion: horizontal smear in px.
 * glare: 0..1 hot spot. gain/offset: exposure. noise: std of sensor noise in levels.
 */
export function renderCamera(scr, o = {}) {
  const W = o.camW ?? 1280;
  const H = o.camH ?? Math.round((W * 3) / 4);
  const fill = o.fill ?? 0.7;
  const tilt = o.tilt ?? 0;
  const rot = ((o.rot ?? 0) * Math.PI) / 180;
  const [dx, dy] = o.shift ?? [0, 0];
  let hh = (fill * H) / 2;
  let hw = (hh * scr.w) / scr.h;
  if (hw > 0.95 * (W / 2)) {
    hw = 0.95 * (W / 2);
    hh = (hw * scr.h) / scr.w;
  }
  const cx = W / 2 + dx;
  const cy = H / 2 + dy;
  const corners = [
    [-hw * (1 - tilt), -hh * (1 - tilt * 0.3)],
    [hw * (1 - tilt), -hh * (1 - tilt * 0.3)],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  const rect = [
    [0, 0],
    [scr.w, 0],
    [scr.w, scr.h],
    [0, scr.h],
  ];
  const toScreen = homography(corners, rect);
  const toCamera = homography(rect, corners);
  const white = o.white ?? 232;
  const black = o.black ?? 28;
  const bg = o.bg ?? 40;
  let L = new Float32Array(W * H);
  const sub = [0.25, 0.75];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (const sy of sub) {
        for (const sx of sub) {
          const [u, v] = project(toScreen, x + sx, y + sy);
          if (u >= 0 && v >= 0 && u < scr.w && v < scr.h) {
            acc += scr.lum[Math.floor(v) * scr.w + Math.floor(u)] ? white : black;
          } else acc += bg;
        }
      }
      L[y * W + x] = acc / 4;
    }
  }
  let tmp = new Float32Array(W * H);
  const motion = Math.round(o.motion ?? 0);
  if (motion > 0) {
    boxBlurH(L, tmp, W, H, Math.max(1, Math.round(motion / 2)));
    [L, tmp] = [tmp, L];
  }
  const blur = Math.round(o.blur ?? 0);
  for (let pass = 0; blur > 0 && pass < 3; pass++) {
    boxBlurH(L, tmp, W, H, blur);
    boxBlurV(tmp, L, W, H, blur);
  }
  const glare = o.glare ?? 0;
  const gain = o.gain ?? 1;
  const offset = o.offset ?? 0;
  const noise = o.noise ?? 0;
  const r = rng(o.seed ?? 7);
  const gx = W * 0.62;
  const gy = H * 0.38;
  const gs = 2 * (W * 0.16) ** 2;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = L[i] * gain + offset;
      if (glare > 0) v += glare * 255 * Math.exp(-((x - gx) ** 2 + (y - gy) ** 2) / gs);
      if (noise > 0) v += noise * (r() + r() + r() - 1.5) * 2;
      const p = i * 4;
      out[p] = v * 1.02;
      out[p + 1] = v;
      out[p + 2] = v * 0.97;
      out[p + 3] = 255;
    }
  }
  const quads = scr.cells.map((c) => {
    const at = (x, y) => {
      const [u, v] = project(toCamera, x, y);
      return { x: u, y: v };
    };
    return {
      topLeft: at(c.x, c.y),
      topRight: at(c.x + c.size, c.y),
      bottomRight: at(c.x + c.size, c.y + c.size),
      bottomLeft: at(c.x, c.y + c.size),
    };
  });
  return { data: out, width: W, height: H, quads };
}

/** Two exposures in one frame: a blend (slow sensor) or a rolling-shutter split. */
export function mixFrames(a, b, mode = "blend", t = 0.5) {
  const out = new Uint8ClampedArray(a.data.length);
  if (mode === "rolling") {
    const split = Math.floor(a.height * t) * a.width * 4;
    out.set(a.data.subarray(0, split));
    out.set(b.data.subarray(split), split);
  } else {
    for (let i = 0; i < out.length; i++) out[i] = a.data[i] * (1 - t) + b.data[i] * t;
  }
  return { data: out, width: a.width, height: a.height, quads: a.quads };
}

/** Full set of codes for one sender frame, the way the sender fills a grid. */
export function senderFrame(payload, ecc, grid, seed) {
  const bytes = [];
  const codes = [];
  for (let i = 0; i < grid; i++) {
    const b = randomBytes(payload, seed * 31 + i);
    const q = qrFor(b, ecc);
    if (!q) return null;
    bytes.push(b);
    codes.push(q);
  }
  const { cols, rows } = layoutFor(grid, true);
  return { bytes, codes, scr: screen(codes, cols, rows), version: codes[0].version };
}

/**
 * Paint the sender raster into a camera frame at `ppm` camera pixels per module.
 * `nearest` copies whole modules. `linear` samples fractional positions, which is
 * what a non-integer scale does to module edges.
 */
export function renderModules(scr, o = {}) {
  const W = o.camW ?? 1280;
  const H = o.camH ?? Math.round((W * 3) / 4);
  const ppm = o.ppm ?? 3;
  const sw = Math.round(scr.w * ppm);
  const sh = Math.round(scr.h * ppm);
  if (sw > W || sh > H || !(ppm > 0)) return null;
  const ox = Math.floor((W - sw) / 2);
  const oy = Math.floor((H - sh) / 2);
  const out = new Uint8ClampedArray(W * H * 4);
  out.fill(40);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  const white = 232;
  const black = 28;
  const nearest = (o.sample ?? "nearest") === "nearest";
  const at = (u, v) => {
    if (u < 0 || v < 0 || u >= scr.w || v >= scr.h) return null;
    if (nearest) return scr.lum[Math.floor(v) * scr.w + Math.floor(u)] ? white : black;
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const x1 = Math.min(scr.w - 1, x0 + 1);
    const y1 = Math.min(scr.h - 1, y0 + 1);
    const tx = u - x0;
    const ty = v - y0;
    const p00 = scr.lum[y0 * scr.w + x0] ? white : black;
    const p10 = scr.lum[y0 * scr.w + x1] ? white : black;
    const p01 = scr.lum[y1 * scr.w + x0] ? white : black;
    const p11 = scr.lum[y1 * scr.w + x1] ? white : black;
    return p00 * (1 - tx) * (1 - ty) + p10 * tx * (1 - ty) + p01 * (1 - tx) * ty + p11 * tx * ty;
  };
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const v = at((x + 0.5) / ppm, (y + 0.5) / ppm);
      if (v == null) continue;
      const p = ((oy + y) * W + (ox + x)) * 4;
      out[p] = v;
      out[p + 1] = v;
      out[p + 2] = v;
      out[p + 3] = 255;
    }
  }
  return { data: out, width: W, height: H, screenW: sw, screenH: sh };
}

export function smearHorizontal(frame, radius) {
  const r = Math.max(1, Math.round(radius));
  const { width: W, height: H, data } = frame;
  const out = new Uint8ClampedArray(data);
  const span = r * 2 + 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(W - 1, Math.max(0, x + k));
        acc += data[(y * W + xx) * 4];
      }
      const v = acc / span;
      const p = (y * W + x) * 4;
      out[p] = v;
      out[p + 1] = v;
      out[p + 2] = v;
    }
  }
  return { data: out, width: W, height: H };
}

export const DEGRADATIONS = {
  clean: {},
  blur1: { blur: 1 },
  blur2: { blur: 2 },
  perspective: { tilt: 0.18, rot: 4 },
  motion: { motion: 6, shift: [5, -3] },
  glare: { glare: 0.55 },
  noise: { noise: 10 },
  dark: { gain: 0.55, offset: -6, noise: 6 },
  bright: { gain: 1.25, offset: 18 },
  far: { fill: 0.45 },
};

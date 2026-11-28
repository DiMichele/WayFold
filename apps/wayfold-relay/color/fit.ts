import { nearestState, type Palette, type Rgb } from "./palette.ts";
import type { SeparateMethod } from "./profile.ts";

export interface AffineFit {
  /** Maps ideal RGB to observed RGB. Row-major 3×3. */
  matrix: number[];
  offset: Rgb;
  /** Infinity-norm condition of the normal matrix. */
  condition: number;
  /** Mean absolute error on the swatches, in levels. */
  residual: number;
}

export interface FitSample {
  ideal: Rgb;
  observed: Rgb;
}

/** Infinity-norm condition estimate of a square matrix via an explicit inverse. */
export function conditionNumber(matrix: number[], n: number): number {
  const inv = invert(matrix, n);
  if (!inv) return Infinity;
  return infNorm(matrix, n) * infNorm(inv, n);
}

function infNorm(matrix: number[], n: number): number {
  let max = 0;
  for (let r = 0; r < n; r++) {
    let s = 0;
    for (let c = 0; c < n; c++) s += Math.abs(matrix[r * n + c]!);
    if (s > max) max = s;
  }
  return max;
}

function invert(matrix: number[], n: number): number[] | null {
  const m: number[][] = [];
  for (let r = 0; r < n; r++) {
    const row = new Array<number>(n * 2).fill(0);
    for (let c = 0; c < n; c++) row[c] = matrix[r * n + c]!;
    row[n + r] = 1;
    m.push(row);
  }
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[pivot]![c]!)) pivot = r;
    const swap = m[c]!;
    m[c] = m[pivot]!;
    m[pivot] = swap;
    const div = m[c]![c]!;
    if (Math.abs(div) < 1e-10) return null;
    for (let k = 0; k < n * 2; k++) m[c]![k] = m[c]![k]! / div;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]!;
      for (let k = 0; k < n * 2; k++) m[r]![k] = m[r]![k]! - f * m[c]![k]!;
    }
  }
  const out: number[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out.push(m[r]![n + c]!);
  return out;
}

function solve4(ata: number[], atb: number[]): number[] | null {
  const inv = invert(ata, 4);
  if (!inv) return null;
  const out = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let c = 0; c < 4; c++) s += inv[r * 4 + c]! * atb[c]!;
    out[r] = s;
  }
  return out;
}

/** Least-squares obs = M * ideal + offset, from the known swatches. */
export function fitAffine(samples: FitSample[]): AffineFit | null {
  if (samples.length < 4) return null;
  const cols = [
    samples.map((s) => s.observed.r),
    samples.map((s) => s.observed.g),
    samples.map((s) => s.observed.b),
  ];
  const design = samples.map((s) => [s.ideal.r, s.ideal.g, s.ideal.b, 1]);
  const ata = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (const row of design) s += row[r]! * row[c]!;
      ata[r * 4 + c] = s;
    }
  }
  const coefs: number[][] = [];
  for (const y of cols) {
    const atb = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let i = 0; i < design.length; i++) s += design[i]![r]! * y[i]!;
      atb[r] = s;
    }
    const beta = solve4(ata, atb);
    if (!beta) return null;
    coefs.push(beta);
  }
  const matrix = [
    coefs[0]![0]!, coefs[0]![1]!, coefs[0]![2]!,
    coefs[1]![0]!, coefs[1]![1]!, coefs[1]![2]!,
    coefs[2]![0]!, coefs[2]![1]!, coefs[2]![2]!,
  ];
  const offset = { r: coefs[0]![3]!, g: coefs[1]![3]!, b: coefs[2]![3]! };
  let err = 0;
  let n = 0;
  for (const s of samples) {
    const pred = applyForward(matrix, offset, s.ideal);
    err += Math.abs(pred.r - s.observed.r) + Math.abs(pred.g - s.observed.g) + Math.abs(pred.b - s.observed.b);
    n += 3;
  }
  return { matrix, offset, condition: conditionNumber(ata, 4), residual: n ? err / n : 0 };
}

function applyForward(matrix: number[], offset: Rgb, ideal: Rgb): Rgb {
  return {
    r: matrix[0]! * ideal.r + matrix[1]! * ideal.g + matrix[2]! * ideal.b + offset.r,
    g: matrix[3]! * ideal.r + matrix[4]! * ideal.g + matrix[5]! * ideal.b + offset.g,
    b: matrix[6]! * ideal.r + matrix[7]! * ideal.g + matrix[8]! * ideal.b + offset.b,
  };
}

/** Invert the fitted map so a camera sample becomes a palette-space color. */
export function correctSample(fit: AffineFit, observed: Rgb): Rgb | null {
  const inv = invert(fit.matrix, 3);
  if (!inv) return null;
  const x = observed.r - fit.offset.r;
  const y = observed.g - fit.offset.g;
  const z = observed.b - fit.offset.b;
  return {
    r: inv[0]! * x + inv[1]! * y + inv[2]! * z,
    g: inv[3]! * x + inv[4]! * y + inv[5]! * z,
    b: inv[6]! * x + inv[7]! * y + inv[8]! * z,
  };
}

export function classifySample(
  palette: Palette,
  observed: Rgb,
  fit: AffineFit | null,
  method: SeparateMethod,
): number {
  if (method === "classify" || !fit) return nearestState(palette, observed);
  const corrected = correctSample(fit, observed) ?? observed;
  if (method === "affine") {
    // Snap each corrected channel to 0 or 255, then match.
    const snapped = {
      r: corrected.r > 127 ? 255 : 0,
      g: corrected.g > 127 ? 255 : 0,
      b: corrected.b > 127 ? 255 : 0,
    };
    return nearestState(palette, snapped);
  }
  return nearestState(palette, corrected);
}

export function channelBits(state: number, channels: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < channels; i++) out.push((state >> i) & 1);
  return out;
}

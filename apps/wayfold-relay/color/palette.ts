/** Known module colors. Index bits: bit 0 is channel 0, dark = 1. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Palette {
  id: string;
  channels: 2 | 3;
  /** One entry per state. Color 2 has 4, RGB 3 has 8. */
  states: Rgb[];
}

function rgb(r: number, g: number, b: number): Rgb {
  return { r, g, b };
}

/** Red and blue. Index bit 0 = red dark, bit 1 = blue dark. */
export const PALETTE_RB: Palette = {
  id: "rb",
  channels: 2,
  states: [rgb(255, 255, 255), rgb(220, 0, 0), rgb(0, 0, 220), rgb(0, 0, 0)],
};

/** Red and green. */
export const PALETTE_RG: Palette = {
  id: "rg",
  channels: 2,
  states: [rgb(255, 255, 255), rgb(220, 0, 0), rgb(0, 180, 0), rgb(0, 0, 0)],
};

/** Green and blue. */
export const PALETTE_GB: Palette = {
  id: "gb",
  channels: 2,
  states: [rgb(255, 255, 255), rgb(0, 180, 0), rgb(0, 0, 220), rgb(0, 0, 0)],
};

/**
 * All eight states. Bit 0 = red, bit 1 = green, bit 2 = blue, dark = 1.
 * The index is the bit field, so calibration covers every combination.
 */
export const PALETTE_RGB: Palette = {
  id: "rgb",
  channels: 3,
  states: [
    rgb(255, 255, 255),
    rgb(220, 0, 0),
    rgb(0, 180, 0),
    rgb(220, 180, 0),
    rgb(0, 0, 220),
    rgb(220, 0, 220),
    rgb(0, 180, 220),
    rgb(0, 0, 0),
  ],
};

const ALL: Palette[] = [PALETTE_RB, PALETTE_RG, PALETTE_GB, PALETTE_RGB];

export function paletteById(id: string): Palette {
  return ALL.find((p) => p.id === id) ?? PALETTE_RB;
}

export function color2Palettes(): Palette[] {
  return [PALETTE_RB, PALETTE_RG, PALETTE_GB];
}

export function stateColor(palette: Palette, bits: number): Rgb {
  const n = palette.states.length;
  const i = ((bits % n) + n) % n;
  return palette.states[i]!;
}

export function nearestState(palette: Palette, sample: Rgb): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.states.length; i++) {
    const s = palette.states[i]!;
    const d = (s.r - sample.r) ** 2 + (s.g - sample.g) ** 2 + (s.b - sample.b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function saturation(sample: Rgb): number {
  const max = Math.max(sample.r, sample.g, sample.b);
  const min = Math.min(sample.r, sample.g, sample.b);
  return max - min;
}

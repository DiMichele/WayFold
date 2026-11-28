// Synthetic comparison of Mono, Color 2 and RGB 3. Not a camera measurement.
//   node --experimental-strip-types --no-warnings bench/color-bench.mjs
import "../tests/imagedata-polyfill.mjs";
import os from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { distortColors, paintMatrices } from "../color/composite.ts";
import { encodePayloads, recoverRaster } from "../color/engine.ts";
import { color2Palettes } from "../color/palette.ts";
import { windowCapacityBitrate } from "../color/profile.ts";
import { alignMatrices } from "../color/matrices.ts";
import { rasterizeQr } from "../shared/optical.ts";

const RESULTS = new URL("./results/", import.meta.url);
mkdirSync(RESULTS, { recursive: true });

function bytes(n, seed) {
  const out = new Uint8Array(n);
  let x = seed || 1;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x & 255;
  }
  return out;
}

function monoRaster(payload, ecc) {
  const aligned = alignMatrices([payload], ecc);
  const t0 = performance.now();
  const img = rasterizeQr(aligned.size, aligned.matrices[0], 4);
  return {
    data: img.data,
    width: img.width,
    height: img.height,
    paintMs: performance.now() - t0,
    modules: img.width,
    qrSize: aligned.size,
  };
}

const payloads = {
  color2: [bytes(48, 2), bytes(48, 3)],
  rgb3: [bytes(48, 4), bytes(48, 5), bytes(48, 6)],
  mono: [bytes(48, 1)],
};

const rows = [];
const mono = monoRaster(payloads.mono[0], "L");
rows.push({
  mode: "transfer",
  profile: "mono",
  method: "none",
  sample: "none",
  palette: "mono",
  pixels: mono.width * mono.height,
  paintMs: +mono.paintMs.toFixed(2),
  frameOverhead: 0,
  ber: [0],
  success: [1],
  note: "Mono raster only. No calibration and no channel split.",
});

for (const profile of ["color2", "rgb3"]) {
  for (const method of ["affine", "classify", "hybrid"]) {
    for (const sample of method === "hybrid" ? ["module", "pixel"] : ["module"]) {
      const encoded = encodePayloads(payloads[profile], "L", profile, undefined, 4);
      const recovered = recoverRaster(encoded, profile, method, sample, undefined, [encoded.aligned.matrices]);
      const split = recovered.found[0]?.split;
      const cell = encoded.qrSize + 8;
      const overhead = 1 - (cell * cell) / (encoded.modules * encoded.modules);
      rows.push({
        mode: "transfer",
        profile,
        method,
        sample,
        palette: profile === "rgb3" ? "rgb" : "rb",
        pixels: encoded.width * encoded.height,
        paintMs: +encoded.paintMs.toFixed(2),
        calMs: split ? +split.calMs.toFixed(2) : null,
        splitMs: split ? +split.splitMs.toFixed(2) : null,
        frameOverhead: +overhead.toFixed(3),
        ber: split?.ber ?? [],
        success: (split?.ber ?? []).map((v) => (v === 0 ? 1 : 0)),
        residual: split?.residual ?? null,
        condition: split?.condition ?? null,
      });
      console.log(`${profile} ${method} ${sample}: ber ${(split?.ber ?? []).map((v) => v.toFixed(3)).join(",")}`);
    }
  }
}

const paletteRows = [];
for (const palette of color2Palettes()) {
  const encoded = encodePayloads(payloads.color2, "M", "color2", palette.id, 4);
  const mixed = distortColors(
    encoded,
    [0.8, 0.1, 0.05, 0.05, 0.85, 0.08, 0.08, 0.12, 0.8],
    { r: 5, g: 3, b: 4 },
    { r: 1, g: 1, b: 1 },
  );
  const recovered = recoverRaster(mixed, "color2", "hybrid", "module", palette.id, [encoded.aligned.matrices]);
  const ber = recovered.found[0]?.split.ber ?? [1, 1];
  paletteRows.push({ palette: palette.id, ber, worst: Math.max(...ber) });
  console.log(`palette ${palette.id}: worst ber ${Math.max(...ber).toFixed(3)}`);
}
paletteRows.sort((a, b) => a.worst - b.worst);

const asymmetric = [];
for (const profile of ["color2", "rgb3"]) {
  const encoded = encodePayloads(payloads[profile], "Q", profile, undefined, 4);
  const data = new Uint8ClampedArray(encoded.data);
  for (let y = 8; y < encoded.height - 8; y++) {
    for (let x = 0; x < encoded.width; x++) {
      const i = (y * encoded.width + x) * 4;
      if (data[i] > data[i + 2] + 60 && data[i] > data[i + 1] + 60) data[i] = data[i + 1] = data[i + 2] = 255;
    }
  }
  const recovered = recoverRaster(
    { data, width: encoded.width, height: encoded.height },
    profile,
    "classify",
    "module",
    undefined,
    [encoded.aligned.matrices],
  );
  asymmetric.push({ profile, ber: recovered.found[0]?.split.ber ?? [] });
}

const capBitrate = windowCapacityBitrate(12, 1200, 0.15);
writeFileSync(
  new URL("color.json", RESULTS),
  JSON.stringify(
    {
      machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, node: process.version },
      note: "Synthetic rasters. Not a monitor or camera measurement. Transfer and Diode share the same fountain frame, so the pixel rows apply to both. Network capacity is the ARQ window formula, not a link measurement.",
      units: { ber: "module bits wrong before ECC", overhead: "fraction of the composite that is frame rather than QR cell" },
      samePayloadBytes: 48,
      rows,
      paletteOnLinearMix: paletteRows,
      asymmetricRedWhitened: asymmetric,
      network: {
        opticalInflight: 12,
        theoreticalBitrate: capBitrate,
        theoreticalLabel: "12 * 1200 * 8 / 0.15 s",
        grids: [1, 2, 4],
      },
      diode: {
        unidirectional: true,
        contents: ["file", "chat", "video"],
        videoRepeatsSameSymbol: true,
      },
    },
    null,
    1,
  ),
);
console.log(`palette winner (synthetic mix): ${paletteRows[0]?.palette}`);

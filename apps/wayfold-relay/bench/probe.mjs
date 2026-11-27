// Checks what the zxing-wasm binding accepts before any benchmark relies on it:
// RGBA views without ImageData, PGM luminance, and result positions.
import "../tests/imagedata-polyfill.mjs";
import { readBarcodes } from "zxing-wasm/reader";
import { ZXING_WASM_VERSION } from "zxing-wasm/reader";
import { lumaToPgm, rgbaToLuma } from "../receive/decode-core.ts";
import { renderCamera, senderFrame } from "./synth.mjs";

const hex = (b) => Buffer.from(b).toString("hex");
const frame = senderFrame(1850, "L", 1, 3);
const cam = renderCamera(frame.scr, { camW: 1280 });
const opts = { formats: ["QRCode"], maxNumberOfSymbols: 4, tryHarder: true };

const viaImageData = await readBarcodes(new ImageData(new Uint8ClampedArray(cam.data), cam.width, cam.height), opts);
const viaView = await readBarcodes({ data: cam.data, width: cam.width, height: cam.height }, opts);
const lum = rgbaToLuma(cam.data, cam.width, cam.height);
const viaPgm = await readBarcodes(lumaToPgm(lum, cam.width, cam.height), opts);
const crop = { x: 200, y: 100, w: 880, h: 760 };
const viaPgmCrop = await readBarcodes(lumaToPgm(lum, cam.width, cam.height, crop), opts);

const want = hex(frame.bytes[0]);
const ok = (hits) => hits.some((h) => h.isValid && hex(h.bytes) === want);
console.log(JSON.stringify({
  zxingWasm: ZXING_WASM_VERSION,
  imageData: ok(viaImageData),
  plainView: ok(viaView),
  pgm: ok(viaPgm),
  pgmCrop: ok(viaPgmCrop),
  position: viaView[0]?.position ?? null,
  expectedQuad: cam.quads[0],
}, null, 1));

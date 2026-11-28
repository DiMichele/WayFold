import { parentPort } from "node:worker_threads";
import "../tests/imagedata-polyfill.mjs";
import { readBarcodes } from "zxing-wasm/reader";

parentPort.on("message", async (msg) => {
  if (!msg.buf) {
    parentPort.postMessage({ id: msg.id, hex: [] });
    return;
  }
  const data = new Uint8ClampedArray(msg.buf);
  const hits = await readBarcodes(new ImageData(data, msg.w, msg.h), {
    formats: ["QRCode"],
    tryHarder: true,
  });
  const hex = [];
  for (const hit of hits) {
    if (hit.isValid && hit.bytes?.length) hex.push(Buffer.from(hit.bytes).toString("hex"));
  }
  parentPort.postMessage({ id: msg.id, hex });
});

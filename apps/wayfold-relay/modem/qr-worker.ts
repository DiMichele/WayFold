// QR encode worker for the Connect modem: up to 4 codes per display tick at
// 24+ fps is too much CPU for the main thread, which also grabs camera frames.

import QRCode from "qrcode";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

interface EncodeRequest {
  id: number;
  frames: Uint8Array[];
  ecc: "L" | "M" | "Q" | "H";
  /** Pin the version so every frame keeps the same module size. */
  version?: number;
}

ctx.onmessage = (e: MessageEvent) => {
  const req = e.data as EncodeRequest;
  try {
    let version = req.version;
    let size = 0;
    const mods: Uint8Array[] = [];
    for (const data of req.frames) {
      const qr = QRCode.create([{ data, mode: "byte" } as unknown as QRCode.QRCodeSegment], {
        errorCorrectionLevel: req.ecc,
        version,
        maskPattern: 4,
      });
      version ??= qr.version;
      size = qr.modules.size;
      mods.push(Uint8Array.from(qr.modules.data as ArrayLike<number>));
    }
    ctx.postMessage({ id: req.id, size, version, mods }, mods.map((m) => m.buffer));
  } catch (error) {
    ctx.postMessage({ id: req.id, error: error instanceof Error ? error.message : String(error) });
  }
};

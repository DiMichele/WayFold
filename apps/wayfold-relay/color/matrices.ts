import QRCode from "qrcode";
import type { EccLevel } from "../shared/optical.ts";

export interface AlignedMatrices {
  version: number;
  size: number;
  ecc: EccLevel;
  /** Dark = 1, row-major, identical geometry. */
  matrices: Uint8Array[];
}

export class ColorAlignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColorAlignError";
  }
}

function createOne(data: Uint8Array, ecc: EccLevel, version?: number) {
  return QRCode.create([{ data, mode: "byte" } as unknown as QRCode.QRCodeSegment], {
    errorCorrectionLevel: ecc,
    version,
    maskPattern: 4,
  });
}

/**
 * Every payload is a byte-mode QR of the same version, ECC, mask and module count.
 * The version is the one required by the largest payload, then locked for the rest.
 */
export function alignMatrices(payloads: Uint8Array[], ecc: EccLevel, forceVersion = 0): AlignedMatrices {
  if (payloads.length < 1) throw new ColorAlignError("no payloads");
  let version = forceVersion;
  if (!version) {
    for (const payload of payloads) {
      if (!payload?.length) throw new ColorAlignError("empty payload");
      const qr = createOne(payload, ecc);
      if (qr.version > version) version = qr.version;
    }
  }
  for (const payload of payloads) if (!payload?.length) throw new ColorAlignError("empty payload");
  const matrices: Uint8Array[] = [];
  let size = 0;
  for (const payload of payloads) {
    const qr = createOne(payload, ecc, version);
    if (qr.version !== version) throw new ColorAlignError("version drifted");
    const next = Uint8Array.from(qr.modules.data as ArrayLike<number>, (v) => (v ? 1 : 0));
    if (!size) size = qr.modules.size;
    if (qr.modules.size !== size || next.length !== size * size) throw new ColorAlignError("size mismatch");
    matrices.push(next);
  }
  return { version, size, ecc, matrices };
}

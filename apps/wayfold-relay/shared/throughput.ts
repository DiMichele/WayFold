/** Decimal kilobytes per second. 1 kB/s = 1000 bytes/s. */
export function toKBps(bytesPerSec: number): number {
  return bytesPerSec / 1000;
}

/** Binary kibibytes per second. 1 KiB/s = 1024 bytes/s. Not used on screen. */
export function toKiBps(bytesPerSec: number): number {
  return bytesPerSec / 1024;
}

/**
 * Transfer and Optical Diode. The argument is bytes/s.
 * Under 1 kB/s the label stays B/s so a slow link does not read as 0.0.
 */
export function formatKBps(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0) return "–";
  if (bytesPerSec < 1000) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1_000_000) return `${(bytesPerSec / 1000).toFixed(1)} kB/s`;
  return `${(bytesPerSec / 1_000_000).toFixed(2)} MB/s`;
}

/**
 * Optical Network. The argument is bytes/s. The label switches to Mbit/s at 1 Mbit/s.
 */
export function formatBitrate(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0) return "–";
  const bits = bytesPerSec * 8;
  if (bits < 1000) return `${Math.round(bits)} bit/s`;
  if (bits < 1_000_000) return `${(bits / 1000).toFixed(1)} kbit/s`;
  return `${(bits / 1_000_000).toFixed(2)} Mbit/s`;
}

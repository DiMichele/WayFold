/** Decimal kilobytes per second. 1 kB/s = 1000 bytes/s. */
export function toKBps(bytesPerSec: number): number {
  return bytesPerSec / 1000;
}

/** Binary kibibytes per second. 1 KiB/s = 1024 bytes/s. */
export function toKiBps(bytesPerSec: number): number {
  return bytesPerSec / 1024;
}

/** HUD and transfer rates. The value is bytes/s; the label is KiB/s. */
export function formatKiBps(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "–";
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KiB/s`;
  return `${(bytesPerSec / 1024 / 1024).toFixed(2)} MiB/s`;
}

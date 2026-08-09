"""Generate minimal WayFold PWA PNG icons (no external deps)."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent


def _png(size: int, rgb: tuple[int, int, int] = (103, 92, 242)) -> bytes:
    """Solid rounded-ish square with letter W approximation via filled rects."""
    r, g, b = rgb
    rows = []
    for y in range(size):
        row = bytearray([0])  # filter none
        for x in range(size):
            # padding margin
            m = size // 10
            inside = m <= x < size - m and m <= y < size - m
            # simple "W" bars
            t = size // 8
            w_mark = False
            if inside:
                # vertical strokes at ~20%, 50%, 80%
                for cx in (0.22, 0.50, 0.78):
                    if abs(x - int(size * cx)) <= t // 2 and y >= int(size * 0.28) and y <= int(size * 0.72):
                        w_mark = True
                # V connectors
                if int(size * 0.28) <= y <= int(size * 0.72):
                    mid = size // 2
                    left = int(size * 0.22)
                    right = int(size * 0.78)
                    # left diagonal down to mid-bottom
                    prog = (y - int(size * 0.28)) / max(1, int(size * 0.44))
                    x1 = int(left + (mid - left) * prog)
                    x2 = int(right - (right - mid) * prog)
                    if abs(x - x1) <= t // 2 or abs(x - x2) <= t // 2:
                        w_mark = True
            if w_mark:
                row.extend((255, 255, 255, 255))
            elif inside:
                row.extend((r, g, b, 255))
            else:
                # transparent outside for maskable-ish feel — use purple bg
                row.extend((r, g, b, 255))
        rows.append(bytes(row))
    raw = b"".join(rows)
    compressed = zlib.compress(raw, 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        path = OUT / f"icon-{size}.png"
        path.write_bytes(_png(size))
        print("wrote", path)


if __name__ == "__main__":
    main()

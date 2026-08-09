"""Serve WayFold Compliance PWA static assets."""

from __future__ import annotations

from pathlib import Path

PWA_DIR = Path(__file__).resolve().parent / "static" / "pwa"

_TYPES = {
    ".webmanifest": "application/manifest+json",
    ".json": "application/json",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


def serve_pwa_asset(path: str) -> tuple[bytes, str, str] | None:
    """Return (body, content_type, cache_control) or None if missing/unsafe."""
    if path == "/sw.js":
        file_path = PWA_DIR / "sw.js"
    elif path.startswith("/static/pwa/"):
        name = path[len("/static/pwa/") :]
        if not name or ".." in name or "/" in name or "\\" in name:
            return None
        file_path = PWA_DIR / name
    else:
        return None
    if not file_path.is_file() or not file_path.resolve().is_relative_to(PWA_DIR.resolve()):
        return None
    ctype = _TYPES.get(file_path.suffix.lower(), "application/octet-stream")
    cache = "no-cache" if file_path.name == "sw.js" else "public, max-age=86400"
    return file_path.read_bytes(), ctype, cache

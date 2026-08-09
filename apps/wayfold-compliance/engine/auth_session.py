"""Minimal consultant session auth for WayFold Compliance engine.

Signed cookie sessions. Query-param auth is opt-in (dev/tests only).
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass
from html import escape
from http.cookies import SimpleCookie
from typing import Any
from urllib.parse import quote

COOKIE_NAME = "wf_session"
SESSION_TTL_SEC = 60 * 60 * 12  # 12h


@dataclass(frozen=True)
class Session:
    username: str
    is_superuser: bool
    expires_at: int


def open_access_enabled() -> bool:
    return os.environ.get("WAYFOLD_OPEN_ACCESS", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def qs_auth_allowed() -> bool:
    """Allow ?superuser=1 / actor_tenants in query string (local/tests)."""
    raw = os.environ.get("WAYFOLD_ALLOW_QS_AUTH")
    if raw is not None and str(raw).strip():
        return str(raw).strip().lower() in {"1", "true", "yes", "on"}
    # Default: only when open access or demo seed (local). Production disables both.
    from engine.runtime_paths import seed_demo_enabled

    return open_access_enabled() or seed_demo_enabled()


def auth_configured() -> bool:
    user = os.environ.get("WAYFOLD_AUTH_USER", "").strip()
    password = os.environ.get("WAYFOLD_AUTH_PASSWORD", "").strip()
    return bool(user and password)


def _session_secret() -> bytes:
    raw = os.environ.get("WAYFOLD_SESSION_SECRET", "").strip()
    if not raw:
        # Deterministic fallback only for local/tests — production must set secret.
        raw = "wayfold-dev-session-secret-not-for-production"
    return raw.encode("utf-8")


def issue_session(username: str, *, is_superuser: bool = True) -> str:
    exp = int(time.time()) + SESSION_TTL_SEC
    payload = f"{username}|{1 if is_superuser else 0}|{exp}"
    sig = hmac.new(_session_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def parse_session_token(token: str | None) -> Session | None:
    if not token or "." not in token:
        return None
    payload, sig = token.rsplit(".", 1)
    expected = hmac.new(_session_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return None
    parts = payload.split("|")
    if len(parts) != 3:
        return None
    username, super_flag, exp_s = parts
    try:
        exp = int(exp_s)
    except ValueError:
        return None
    if exp < int(time.time()):
        return None
    if not username:
        return None
    return Session(username=username, is_superuser=super_flag == "1", expires_at=exp)


def session_from_cookie_header(cookie_header: str | None) -> Session | None:
    if not cookie_header:
        return None
    jar = SimpleCookie()
    try:
        jar.load(cookie_header)
    except Exception:  # noqa: BLE001
        return None
    morsel = jar.get(COOKIE_NAME)
    if morsel is None:
        return None
    return parse_session_token(morsel.value)


def verify_credentials(username: str, password: str) -> bool:
    expected_user = os.environ.get("WAYFOLD_AUTH_USER", "").strip()
    expected_pass = os.environ.get("WAYFOLD_AUTH_PASSWORD", "").strip()
    if not expected_user or not expected_pass:
        return False
    return secrets.compare_digest(username, expected_user) and secrets.compare_digest(
        password, expected_pass
    )


def session_cookie_header(token: str, *, secure: bool = True) -> str:
    parts = [
        f"{COOKIE_NAME}={token}",
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        f"Max-Age={SESSION_TTL_SEC}",
    ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def clear_session_cookie_header(*, secure: bool = True) -> str:
    parts = [
        f"{COOKIE_NAME}=",
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=0",
    ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def login_page_html(
    *,
    lang: str = "it",
    error: str = "",
    next_path: str = "/portfolio",
) -> str:
    err = (
        f'<p class="login-error" role="alert">{escape(error)}</p>'
        if error
        else ""
    )
    title = "Accedi" if lang != "en" else "Sign in"
    subtitle = (
        "WayFold Compliance — accesso consulente"
        if lang != "en"
        else "WayFold Compliance — consultant access"
    )
    user_label = "Username" if lang == "en" else "Utente"
    pass_label = "Password"
    submit = "Accedi" if lang != "en" else "Sign in"
    return f"""<!doctype html>
<html lang="{escape(lang)}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>{escape(title)} — WayFold Compliance</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{{--wf-bg:#f5f7fb;--wf-surface:#fff;--wf-ink:#151b2b;--wf-muted:#6f7a8e;--wf-border:#e2e7ef;--wf-primary:#675cf2;--wf-danger:#b42318;--wf-danger-soft:#fff0ef}}
*{{box-sizing:border-box}}
body{{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,system-ui,sans-serif;background:var(--wf-bg);color:var(--wf-ink)}}
.card{{width:min(400px,92vw);background:var(--wf-surface);border:1px solid var(--wf-border);border-radius:14px;padding:28px 24px;box-shadow:0 6px 20px rgba(21,27,43,.045)}}
.mark{{width:40px;height:40px;border-radius:11px;background:linear-gradient(145deg,#7a71ff,#5a4ff0);margin-bottom:14px}}
h1{{margin:0;font-size:22px;letter-spacing:-.02em}}
.sub{{color:var(--wf-muted);font-size:13px;margin:6px 0 18px}}
label{{display:block;font-size:11px;font-weight:700;color:var(--wf-muted);text-transform:uppercase;letter-spacing:.06em;margin:0 0 6px}}
input{{width:100%;height:40px;border:1px solid var(--wf-border);border-radius:9px;padding:0 12px;margin-bottom:12px;font:inherit}}
input:focus{{outline:0;border-color:#beb8ff;box-shadow:0 0 0 3px rgba(103,92,242,.08)}}
button{{width:100%;height:40px;border:0;border-radius:9px;background:var(--wf-primary);color:#fff;font-weight:700;cursor:pointer}}
button:hover{{filter:brightness(.96)}}
.login-error{{background:var(--wf-danger-soft);color:var(--wf-danger);padding:10px 12px;border-radius:8px;font-size:13px;margin:0 0 12px}}
</style>
</head><body>
<form class="card" method="post" action="/login" autocomplete="on">
  <div class="mark" aria-hidden="true"></div>
  <h1>WayFold Compliance</h1>
  <p class="sub">{escape(subtitle)}</p>
  {err}
  <input type="hidden" name="next" value="{escape(next_path)}">
  <label for="username">{escape(user_label)}</label>
  <input id="username" name="username" type="text" required autocomplete="username" autocapitalize="none" spellcheck="false">
  <label for="password">{escape(pass_label)}</label>
  <input id="password" name="password" type="password" required autocomplete="current-password">
  <button type="submit">{escape(submit)}</button>
</form>
</body></html>"""


def wants_html(accept: str | None, path: str) -> bool:
    if path.startswith("/api/"):
        return False
    if not accept:
        return True
    a = accept.lower()
    # Prefer HTML login redirect unless the client clearly wants JSON only.
    if "application/json" in a and "text/html" not in a:
        return False
    return True

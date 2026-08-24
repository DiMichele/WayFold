"""Quick live HTML audit of WayFold Compliance pages."""
from __future__ import annotations

import http.cookiejar
import re
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://compliance.wayfold.xyz"
PAGES = [
    "/portfolio",
    "/clients",
    "/tasks",
    "/controls",
    "/frameworks",
    "/frameworks/detail?framework_id=iso-27001-legacy",
    "/frameworks/detail?framework_id=reg-cloud-legacy&tab=questions",
    "/mappings",
    "/changes",
    "/audit",
    "/settings",
    "/profile",
    "/kb/import",
    "/clients/new",
    "/frameworks/new",
    "/frameworks/versions/new",
    "/controls/new",
    "/mappings/new",
    "/checklist",
    "/gaps",
    "/evidence",
    "/report",
    "/programs/new",
]


def main() -> None:
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    opener.open(urllib.request.Request(BASE + "/login", headers={"User-Agent": "wf-audit"}), timeout=30)
    csrf = next((c.value for c in cj if c.name == "wf_csrf"), "")
    data = urllib.parse.urlencode(
        {"username": "admin", "password": "admin", "next": "/portfolio", "csrf_token": csrf}
    ).encode()
    req = urllib.request.Request(
        BASE + "/login",
        data=data,
        headers={"User-Agent": "wf-audit", "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        resp = opener.open(req, timeout=30)
        print("login", resp.geturl(), resp.status)
    except urllib.error.HTTPError as e:
        print("login", e.code, e.headers.get("Location"))

    for path in PAGES:
        try:
            r = opener.open(
                urllib.request.Request(
                    BASE + path,
                    headers={"User-Agent": "wf-audit", "Accept": "text/html"},
                ),
                timeout=45,
            )
            body = r.read().decode("utf-8", "replace")
            title_m = re.search(r"<title>(.*?)</title>", body, re.I | re.S)
            title = re.sub(r"\s+", " ", title_m.group(1)).strip() if title_m else "?"
            issues: list[str] = []
            if r.status >= 400:
                issues.append(f"status={r.status}")
            for sig in ("Traceback", "Internal Server Error", "TypeError", "KeyError", "AttributeError"):
                if sig in body:
                    issues.append(sig)
            if body.lstrip().startswith("{") or body.lstrip().startswith("["):
                issues.append("json_body")
            if "seed/staging" in body or "bridge GRC" in body:
                issues.append("stale_copy")
            if ">None<" in body or "None</" in body:
                issues.append("none_literal")
            if "login?next=" in r.geturl() and path != "/login":
                issues.append("auth_redirect")
            # aesthetic / structure smells
            if "page-head" not in body and "empty-state" not in body and "Accedi" not in title:
                issues.append("missing_page_head")
            if body.count('class="panel"') > 8:
                issues.append(f"many_panels={body.count('class=\"panel\"')}")
            if "breadcrumb" in body and body.count("WayFold") > 12:
                issues.append("title_noise")
            # truncated / broken tags
            if "</html>" not in body.lower():
                issues.append("incomplete_html")
            print(
                f"{path}\t{r.status}\t{title[:55]}\t"
                f"panels={body.count('class=\"panel\"')}\t"
                f"{','.join(issues) if issues else 'ok'}\tlen={len(body)}"
            )
        except Exception as exc:  # noqa: BLE001
            print(f"{path}\tFAIL\t{type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()

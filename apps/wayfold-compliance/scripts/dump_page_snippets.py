"""Dump main content snippets from live pages."""
from __future__ import annotations

import http.cookiejar
import re
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://compliance.wayfold.xyz"
OUT = Path(__file__).resolve().parents[1] / "docs" / "review" / "tmp-page-snippets"


def main() -> None:
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    op.open(BASE + "/login")
    csrf = next((c.value for c in cj if c.name == "wf_csrf"), "")
    op.open(
        urllib.request.Request(
            BASE + "/login",
            data=urllib.parse.urlencode(
                {
                    "username": "admin",
                    "password": "admin",
                    "next": "/portfolio",
                    "csrf_token": csrf,
                }
            ).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    )
    OUT.mkdir(parents=True, exist_ok=True)
    pages = [
        ("tasks", "/tasks"),
        ("checklist", "/checklist"),
        ("gaps", "/gaps"),
        ("evidence", "/evidence"),
        ("report", "/report"),
        ("portfolio", "/portfolio"),
        ("kbimport", "/kb/import"),
        ("settings", "/settings"),
        ("clients", "/clients"),
        ("mappings", "/mappings"),
        ("controls", "/controls"),
        ("changes", "/changes"),
        ("audit", "/audit"),
        ("profile", "/profile"),
        ("programs_new", "/programs/new"),
    ]
    for name, path in pages:
        body = op.open(BASE + path).read().decode("utf-8", "replace")
        m = re.search(r'<main class="content">(.*?)</main>', body, re.S)
        content = m.group(1) if m else body
        content = re.sub(r"<script.*?</script>", "", content, flags=re.S)
        (OUT / f"{name}.html").write_text(content[:20000], encoding="utf-8")
        text = re.sub(r"<[^>]+>", " ", content)
        text = re.sub(r"\s+", " ", text).strip()
        print("====", name, "====")
        print(text[:700])
        print()


if __name__ == "__main__":
    main()

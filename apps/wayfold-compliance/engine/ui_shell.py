"""Shared WayFold visual shell for Compliance engine HTML.

Aligned to wayfold-bills / wayfold.xyz design tokens:
charcoal · sage · terracotta · sand · Jost / Inter / DM Mono.
"""
from __future__ import annotations

from html import escape
from typing import Iterable

# Tokens mirrored from apps/wayfold-bills/apps/web/src/app/globals.css
WAYFOLD_CSS = """
:root{
  --bg:#f7f6f3;--bg2:#efebe4;--srf:#ffffff;--srf2:#f3f1ec;
  --ink:#1a242b;--ink2:#3a4750;--mut:#8a9690;--mut2:#b5b0a6;
  --line:rgba(26,36,43,.08);--line2:rgba(26,36,43,.14);
  --acc:#d97b5c;--acc-h:#c66a4d;--acc-soft:rgba(217,123,92,.12);
  --sage:#98a9a2;--sage-soft:rgba(152,169,162,.22);
  --sand:#d9c5a0;--sand-soft:rgba(217,197,160,.32);
  --danger:#c45a4a;--danger-soft:rgba(196,90,74,.1);
  --ok:#5a9a72;--ok-soft:rgba(90,154,114,.14);
  --warn:#c4923a;--warn-soft:rgba(196,146,58,.14);
  --btn-charcoal:#1a242b;--btn-charcoal-txt:#f7f6f3;
  --sh-s:0 1px 2px rgba(26,36,43,.05),0 4px 14px rgba(26,36,43,.06);
  --sh-m:0 2px 6px rgba(26,36,43,.06),0 14px 40px rgba(26,36,43,.1);
  --r-s:12px;--r-m:18px;--r-l:26px;--content-max:1280px;
  --display:"Jost","Inter",system-ui,sans-serif;
  --sans:"Inter",system-ui,sans-serif;
  --mono:"DM Mono",ui-monospace,monospace;
}
*{box-sizing:border-box}
body{
  margin:0;min-height:100vh;color:var(--ink);
  font-family:var(--sans);background:
    radial-gradient(1200px 500px at 10% -10%,var(--sand-soft),transparent 55%),
    radial-gradient(900px 420px at 90% 0%,var(--sage-soft),transparent 50%),
    linear-gradient(180deg,var(--bg),var(--bg2));
}
.brand-bar{
  display:flex;align-items:center;justify-content:space-between;gap:1rem;
  padding:.85rem 1.35rem;border-bottom:1px solid var(--line);
  background:rgba(247,246,243,.82);backdrop-filter:saturate(1.2) blur(12px);
  position:sticky;top:0;z-index:3;
}
.brand{
  font-family:var(--display);font-weight:600;letter-spacing:.02em;
  font-size:1.15rem;color:var(--ink);text-decoration:none;
}
.brand span{color:var(--acc);font-weight:500}
.nav{
  display:flex;flex-wrap:wrap;gap:.35rem .55rem;padding:.55rem 1.35rem .85rem;
  border-bottom:1px solid var(--line);background:rgba(255,255,255,.55);
}
.nav a{
  color:var(--ink2);text-decoration:none;font-size:.82rem;
  padding:.35rem .65rem;border-radius:999px;border:1px solid transparent;
}
.nav a:hover{background:var(--acc-soft);border-color:rgba(217,123,92,.25);color:var(--ink)}
main{padding:1.25rem 1.35rem 2.75rem;max-width:var(--content-max);margin:0 auto}
h1{font-family:var(--display);font-size:1.55rem;font-weight:600;margin:.15rem 0 .4rem;letter-spacing:-.01em}
h2{font-family:var(--display);font-size:1.1rem;font-weight:600;margin:1.4rem 0 .45rem}
.meta,.hint{color:var(--mut);font-size:.9rem;margin:0 0 .9rem;max-width:62ch}
.panel,.card,table{
  background:var(--srf);border:1px solid var(--line);border-radius:var(--r-m);
  box-shadow:var(--sh-s);
}
table{border-collapse:separate;border-spacing:0;width:100%;font-size:.86rem;overflow:hidden}
th,td{border-bottom:1px solid var(--line);padding:.5rem .65rem;vertical-align:top}
th{
  background:var(--srf2);text-align:left;font-family:var(--mono);font-size:.72rem;
  letter-spacing:.04em;text-transform:uppercase;color:var(--mut);font-weight:500;
  position:sticky;top:4.6rem;z-index:1;
}
tr:last-child td{border-bottom:0}
tr:nth-child(even) td{background:rgba(243,241,236,.45)}
a{color:var(--acc-h)}
a:hover{color:var(--acc)}
.filters{display:flex;flex-wrap:wrap;gap:.55rem;margin:0 0 1rem;align-items:end}
.filters label{display:flex;flex-direction:column;font-size:.72rem;color:var(--mut);gap:.2rem;font-family:var(--mono);letter-spacing:.03em;text-transform:uppercase}
.filters input,.filters select,button,.btn{
  font:inherit;padding:.4rem .65rem;min-width:7rem;border-radius:var(--r-s);
  border:1px solid var(--line2);background:var(--srf);color:var(--ink);
}
button,.btn{
  cursor:pointer;background:var(--btn-charcoal);color:var(--btn-charcoal-txt);
  border-color:var(--btn-charcoal);min-width:auto;
}
button:hover,.btn:hover{background:var(--ink2)}
.badge{
  display:inline-block;padding:.12rem .45rem;border-radius:999px;font-size:.72rem;
  background:var(--sage-soft);color:var(--ink2);border:1px solid var(--line);
  font-family:var(--mono);
}
.badge.ok{background:var(--ok-soft)}
.badge.warn{background:var(--warn-soft)}
.badge.danger,.overdue{background:var(--danger-soft);color:var(--danger);font-weight:600}
code,pre{font-family:var(--mono);font-size:.8rem}
code{background:var(--srf2);padding:.1rem .35rem;border-radius:6px;border:1px solid var(--line)}
pre.diff{background:var(--ink);color:#e8efe9;padding:.9rem;border-radius:var(--r-s);overflow:auto;max-height:22rem;font-size:.75rem}
ul.compact{margin:.2rem 0 .8rem 1.1rem;padding:0}
.warn{color:var(--warn)}
section{margin:1.5rem 0}
"""

DEFAULT_NAV = (
    ("Portfolio", "/portfolio"),
    ("Client", "/client"),
    ("Gaps", "/gaps"),
    ("Owners", "/owners"),
    ("Deadlines", "/deadlines"),
    ("Evidence", "/evidence"),
    ("Auto Evidence", "/auto-evidence"),
    ("Connectors", "/connectors"),
    ("Tasks", "/tasks"),
    ("Report", "/report"),
    ("Checklist", "/checklist"),
    ("Sources", "/sources"),
    ("Reg Changes", "/changes"),
    ("AI", "/ai/suggestions"),
)


def render_shell(
    title: str,
    nav_qs: str,
    body: str,
    *,
    nav_items: Iterable[tuple[str, str]] | None = None,
    brand_subtitle: str = "Compliance",
) -> str:
    items = list(nav_items) if nav_items is not None else list(DEFAULT_NAV)
    q = f"?{nav_qs}" if nav_qs else ""
    links = "".join(
        f'<a href="{escape(path)}{q}">{escape(label)}</a>' for label, path in items
    )
    page_title = title if "WayFold" in title else f"{title} — WayFold Compliance"
    return f"""<!doctype html>
<html lang="it"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="application-name" content="WayFold Compliance">
<title>{escape(page_title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600&family=Jost:wght@500;600;700&display=swap" rel="stylesheet">
<style>{WAYFOLD_CSS}</style>
</head><body>
<header class="brand-bar">
  <a class="brand" href="/{q}">WayFold <span>{escape(brand_subtitle)}</span></a>
</header>
<nav class="nav">{links}</nav>
<main>
{body}
</main>
</body></html>"""

"""Shared WayFold visual shell for Compliance engine HTML.

Aligned to wayfold-bills / wayfold.xyz:
charcoal · sage · terracotta · sand · Jost / Inter / DM Mono · light/dark · IT/EN.
"""

from __future__ import annotations

from html import escape
from typing import Iterable
from urllib.parse import parse_qsl, urlencode

from engine.i18n import (
    DEFAULT_LANG,
    DEFAULT_NAV_KEYS,
    LANG_FLAGS,
    normalize_lang,
    nav_labels,
    t,
    with_lang,
)

WAYFOLD_CSS = """
:root,[data-theme="light"]{
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
  --r-s:12px;--r-m:18px;--r-l:26px;--content-max:1240px;
  --display:"Jost","Inter",system-ui,sans-serif;
  --sans:"Inter",system-ui,sans-serif;
  --mono:"DM Mono",ui-monospace,monospace;
  --spr:cubic-bezier(.34,1.45,.5,1);
  --header-bg:rgba(247,246,243,.86);
  --nav-bg:rgba(255,255,255,.62);
  color-scheme:light;
}
[data-theme="dark"]{
  --bg:#141a1f;--bg2:#1a242b;--srf:#1f2830;--srf2:#253038;
  --ink:#f0ede8;--ink2:#c5cbc8;--mut:#8a9690;--mut2:#5c6662;
  --line:rgba(240,237,232,.09);--line2:rgba(240,237,232,.15);
  --acc:#e08b70;--acc-h:#eb9d85;--acc-soft:rgba(224,139,112,.14);
  --sage:#a8b8b1;--sage-soft:rgba(168,184,177,.16);
  --sand:#c9b48e;--sand-soft:rgba(201,180,142,.18);
  --danger:#e07a68;--danger-soft:rgba(224,122,104,.14);
  --ok:#7dc98f;--ok-soft:rgba(125,201,143,.14);
  --warn:#d4a85a;--warn-soft:rgba(212,168,90,.14);
  --btn-charcoal:#f0ede8;--btn-charcoal-txt:#1a242b;
  --sh-s:0 1px 2px rgba(0,0,0,.3),0 4px 14px rgba(0,0,0,.25);
  --sh-m:0 2px 6px rgba(0,0,0,.35),0 14px 40px rgba(0,0,0,.4);
  --header-bg:rgba(20,26,31,.88);
  --nav-bg:rgba(31,40,48,.72);
  color-scheme:dark;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme]){
    --bg:#141a1f;--bg2:#1a242b;--srf:#1f2830;--srf2:#253038;
    --ink:#f0ede8;--ink2:#c5cbc8;--mut:#8a9690;--mut2:#5c6662;
    --line:rgba(240,237,232,.09);--line2:rgba(240,237,232,.15);
    --acc:#e08b70;--acc-h:#eb9d85;--acc-soft:rgba(224,139,112,.14);
    --sage:#a8b8b1;--sage-soft:rgba(168,184,177,.16);
    --sand:#c9b48e;--sand-soft:rgba(201,180,142,.18);
    --danger:#e07a68;--danger-soft:rgba(224,122,104,.14);
    --ok:#7dc98f;--ok-soft:rgba(125,201,143,.14);
    --warn:#d4a85a;--warn-soft:rgba(212,168,90,.14);
    --btn-charcoal:#f0ede8;--btn-charcoal-txt:#1a242b;
    --sh-s:0 1px 2px rgba(0,0,0,.3),0 4px 14px rgba(0,0,0,.25);
    --sh-m:0 2px 6px rgba(0,0,0,.35),0 14px 40px rgba(0,0,0,.4);
    --header-bg:rgba(20,26,31,.88);
    --nav-bg:rgba(31,40,48,.72);
    color-scheme:dark;
  }
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0;min-height:100dvh;color:var(--ink);
  font-family:var(--sans);font-size:15px;line-height:1.5;font-weight:450;
  -webkit-font-smoothing:antialiased;
  background:
    radial-gradient(1100px 480px at 8% -12%,var(--sand-soft),transparent 55%),
    radial-gradient(900px 420px at 92% 0%,var(--sage-soft),transparent 52%),
    linear-gradient(180deg,var(--bg),var(--bg2));
}
::selection{background:var(--acc);color:#fff}
.brand-bar{
  display:flex;align-items:center;justify-content:space-between;gap:1rem;
  padding:.9rem clamp(1rem,3vw,1.75rem);
  border-bottom:1px solid var(--line);
  background:var(--header-bg);backdrop-filter:saturate(1.25) blur(14px);
  -webkit-backdrop-filter:saturate(1.25) blur(14px);
  position:sticky;top:0;z-index:20;
}
.brand{
  font-family:var(--display);font-weight:600;letter-spacing:.02em;
  font-size:1.2rem;color:var(--ink);text-decoration:none;
}
.brand span{color:var(--acc);font-weight:500}
.toolbar{display:flex;align-items:center;gap:.45rem}
.wf-tb-btn{
  width:36px;height:36px;border-radius:11px;flex-shrink:0;
  background:color-mix(in srgb,var(--srf) 82%,transparent);
  border:1px solid color-mix(in srgb,var(--line) 70%,transparent);
  color:var(--mut);display:inline-flex;align-items:center;justify-content:center;
  box-shadow:0 2px 10px rgba(26,36,43,.05);cursor:pointer;padding:0;min-width:0;
  font:inherit;transition:color .18s,background .18s,border-color .18s,transform .18s var(--spr);
}
.wf-tb-btn:hover{
  color:var(--ink);background:var(--srf);border-color:var(--line2);
  transform:translateY(-1px);box-shadow:var(--sh-m);
}
.wf-tb-btn.lang{
  width:auto;min-width:36px;padding:0 .7rem;
  font-family:var(--mono);font-size:10.5px;font-weight:600;letter-spacing:.06em;
}
.wf-tb-btn svg{width:16px;height:16px}
.wf-tb-btn .icon-moon{display:none}
[data-theme="dark"] .wf-tb-btn .icon-sun{display:none}
[data-theme="dark"] .wf-tb-btn .icon-moon{display:block}
.nav{
  display:flex;flex-wrap:wrap;gap:.4rem;padding:.7rem clamp(1rem,3vw,1.75rem) .95rem;
  border-bottom:1px solid var(--line);background:var(--nav-bg);
}
.nav a{
  color:var(--ink2);text-decoration:none;font-size:.8rem;font-weight:500;
  padding:.38rem .72rem;border-radius:999px;border:1px solid transparent;
  transition:background .15s,border-color .15s,color .15s;
}
.nav a:hover{background:var(--acc-soft);border-color:color-mix(in srgb,var(--acc) 28%,transparent);color:var(--ink)}
main{padding:1.5rem clamp(1rem,3vw,1.75rem) 3rem;max-width:var(--content-max);margin:0 auto}
.page-head{margin:0 0 1.15rem}
h1{font-family:var(--display);font-size:clamp(1.45rem,2.4vw,1.75rem);font-weight:600;margin:0 0 .35rem;letter-spacing:-.015em}
h2{font-family:var(--display);font-size:1.08rem;font-weight:600;margin:1.55rem 0 .55rem}
.meta,.hint{color:var(--mut);font-size:.9rem;margin:0 0 1rem;max-width:68ch}
.panel,.card,.table-wrap{
  background:var(--srf);border:1px solid var(--line);border-radius:var(--r-m);
  box-shadow:var(--sh-s);
}
.table-wrap{overflow:auto;-webkit-overflow-scrolling:touch;margin:0 0 1.25rem}
table{border-collapse:separate;border-spacing:0;width:100%;min-width:720px;font-size:.84rem}
th,td{border-bottom:1px solid var(--line);padding:.7rem .85rem;vertical-align:top;text-align:left}
th{
  background:var(--srf2);font-family:var(--mono);font-size:.68rem;
  letter-spacing:.05em;text-transform:uppercase;color:var(--mut);font-weight:500;
  white-space:nowrap;position:sticky;top:0;z-index:1;
}
td{color:var(--ink2)}
tr:last-child td{border-bottom:0}
tbody tr:hover td{background:color-mix(in srgb,var(--acc-soft) 55%,transparent)}
a{color:var(--acc-h);text-decoration:none}
a:hover{color:var(--acc);text-decoration:underline}
.filters{
  display:flex;flex-wrap:wrap;gap:.65rem;margin:0 0 1.1rem;align-items:end;
  padding:1rem;background:var(--srf);border:1px solid var(--line);border-radius:var(--r-m);
  box-shadow:var(--sh-s);
}
.filters label{
  display:flex;flex-direction:column;font-size:.68rem;color:var(--mut);gap:.28rem;
  font-family:var(--mono);letter-spacing:.04em;text-transform:uppercase;
}
.filters input,.filters select,button,.btn{
  font:inherit;padding:.45rem .7rem;min-width:7.5rem;border-radius:var(--r-s);
  border:1px solid var(--line2);background:var(--srf);color:var(--ink);
}
button,.btn{
  cursor:pointer;background:var(--btn-charcoal);color:var(--btn-charcoal-txt);
  border-color:var(--btn-charcoal);min-width:auto;font-weight:500;
}
button:hover,.btn:hover{filter:brightness(1.05)}
.badge{
  display:inline-block;padding:.14rem .5rem;border-radius:999px;font-size:.7rem;
  background:var(--sage-soft);color:var(--ink2);border:1px solid var(--line);
  font-family:var(--mono);letter-spacing:.02em;
}
.badge.ok{background:var(--ok-soft)}
.badge.warn{background:var(--warn-soft)}
.badge.danger,.overdue{background:var(--danger-soft);color:var(--danger);font-weight:600}
code,pre{font-family:var(--mono);font-size:.8rem}
code{background:var(--srf2);padding:.12rem .38rem;border-radius:6px;border:1px solid var(--line)}
pre.diff{background:var(--ink);color:#e8efe9;padding:1rem;border-radius:var(--r-s);overflow:auto;max-height:22rem;font-size:.75rem}
ul.compact{margin:.25rem 0 .9rem 1.15rem;padding:0}
.warn{color:var(--warn)}
section{margin:1.5rem 0}
@media (max-width:720px){
  .nav{gap:.3rem}
  .nav a{font-size:.74rem;padding:.32rem .58rem}
  table{min-width:640px}
}
"""

SHELL_JS = """
(function(){
  try{
    var stored=localStorage.getItem('wf-theme');
    var theme=stored||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
    document.documentElement.setAttribute('data-theme',theme);
  }catch(e){}
})();
function wfToggleTheme(){
  var cur=document.documentElement.getAttribute('data-theme')||'light';
  var next=cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  try{localStorage.setItem('wf-theme',next);}catch(e){}
}
function wfToggleLang(next){
  var u=new URL(window.location.href);
  u.searchParams.set('lang',next);
  window.location.href=u.toString();
}
"""

# Back-compat alias used by older imports/tests
DEFAULT_NAV = tuple((k.split(".", 1)[-1].title().replace("_", " "), p) for k, p in DEFAULT_NAV_KEYS)


def render_shell(
    title: str,
    nav_qs: str,
    body: str,
    *,
    nav_items: Iterable[tuple[str, str]] | None = None,
    nav_keys: Iterable[tuple[str, str]] | None = None,
    brand_subtitle: str = "Compliance",
    lang: str | None = None,
) -> str:
    lang = normalize_lang(lang or _lang_from_nav_qs(nav_qs))
    nav_qs = with_lang(nav_qs, lang)
    q = f"?{nav_qs}" if nav_qs else ""
    if nav_keys is not None:
        items = nav_labels(lang, tuple(nav_keys))
    elif nav_items is not None:
        items = list(nav_items)
    else:
        items = nav_labels(lang)
    links = "".join(
        f'<a href="{escape(path)}{q}">{escape(label)}</a>' for label, path in items
    )
    page_title = title if "WayFold" in title else f"{title} — WayFold Compliance"
    other_lang = "en" if lang == "it" else "it"
    lang_flag = LANG_FLAGS.get(other_lang, other_lang.upper())
    theme_label = escape(t(lang, "theme.toggle"))
    lang_label = escape(t(lang, "lang.label"))
    return f"""<!doctype html>
<html lang="{escape(lang)}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="application-name" content="WayFold Compliance">
<title>{escape(page_title)}</title>
<script>{SHELL_JS}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600&family=Jost:wght@500;600;700&display=swap" rel="stylesheet">
<style>{WAYFOLD_CSS}</style>
</head><body>
<header class="brand-bar">
  <a class="brand" href="/{q}">WayFold <span>{escape(brand_subtitle)}</span></a>
  <div class="toolbar">
    <button type="button" class="wf-tb-btn lang" onclick="wfToggleLang('{other_lang}')" aria-label="{lang_label}" title="{lang_label}">{lang_flag}</button>
    <button type="button" class="wf-tb-btn" onclick="wfToggleTheme()" aria-label="{theme_label}" title="{theme_label}">
      <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    </button>
  </div>
</header>
<nav class="nav">{links}</nav>
<main>
{body}
</main>
</body></html>"""


def _lang_from_nav_qs(nav_qs: str) -> str:
    data = dict(parse_qsl(nav_qs or "", keep_blank_values=False))
    return normalize_lang(data.get("lang", DEFAULT_LANG))


def table_wrap(inner_table_html: str) -> str:
    return f'<div class="table-wrap">{inner_table_html}</div>'


def ensure_lang_in_qs(nav_qs: str, lang: str | None = None) -> str:
    lang = normalize_lang(lang or _lang_from_nav_qs(nav_qs))
    data = dict(parse_qsl(nav_qs, keep_blank_values=False))
    data["lang"] = lang
    return urlencode(data)

from __future__ import annotations

from html import escape

from .domain import AISuggestion, TenantAISettings


def _shell(title: str, nav_qs: str, body: str) -> str:
    return f"""<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>{escape(title)}</title>
<style>
body{{font-family:Segoe UI,sans-serif;margin:1.5rem;background:#f6f7f9;color:#1a1a1a}}
nav a{{margin-right:1rem}}
table{{border-collapse:collapse;width:100%;background:#fff}}
th,td{{border:1px solid #d0d5dd;padding:.4rem .5rem;font-size:.9rem;vertical-align:top}}
th{{background:#eef2f6;text-align:left}}
.badge{{display:inline-block;background:#eef2f6;padding:.1rem .4rem;font-size:.8rem}}
.warn{{color:#8a4b00}}
</style></head><body>
<nav>
  <a href="/portfolio?{nav_qs}">Portfolio</a>
  <a href="/sources?{nav_qs}">Sources</a>
  <a href="/changes?{nav_qs}">Reg Changes</a>
  <a href="/ai/suggestions?{nav_qs}">AI Suggestions</a>
</nav>
<h1>{escape(title)}</h1>
{body}
</body></html>"""


def suggestions_page(items: list[AISuggestion], nav_qs: str) -> str:
    rows = []
    for s in items:
        rows.append(
            "<tr>"
            f"<td><code>{escape(s.id)}</code></td>"
            f"<td>{escape(s.kind.value)}</td>"
            f"<td>{escape(s.tenant_id)}</td>"
            f"<td><span class='badge'>{escape(s.review_status.value)}</span></td>"
            f"<td>{s.confidence:.2f}</td>"
            f"<td>{escape(s.summary)}</td>"
            f"<td>"
            f"<a href='/api/ai/review?{nav_qs}&suggestion_id={escape(s.id)}&status=APPROVED'>Approve</a> · "
            f"<a href='/api/ai/review?{nav_qs}&suggestion_id={escape(s.id)}&status=REJECTED'>Reject</a>"
            f"</td>"
            "</tr>"
        )
    body = f"""
<p class="warn">AI suggests only — human review required. Approving a suggestion does not mark the client compliant or mutate CISO baselines.</p>
<table><thead><tr>
<th>ID</th><th>Kind</th><th>Tenant</th><th>Status</th><th>Conf.</th><th>Summary</th><th>Review</th>
</tr></thead><tbody>{''.join(rows) or '<tr><td colspan=7>No suggestions</td></tr>'}</tbody></table>
"""
    return _shell("AI Suggestions", nav_qs, body)


def settings_page(settings: TenantAISettings, nav_qs: str) -> str:
    state = "ENABLED" if settings.ai_processing_enabled else "DISABLED (default)"
    body = f"""
<p>Tenant <code>{escape(settings.tenant_id)}</code> — AI processing: <strong>{escape(state)}</strong></p>
<p>
  <a href="/api/ai/settings?{nav_qs}&tenant_id={escape(settings.tenant_id)}&enabled=1">Enable</a> ·
  <a href="/api/ai/settings?{nav_qs}&tenant_id={escape(settings.tenant_id)}&enabled=0">Disable</a>
</p>
<p class="warn">Default is disabled. Enabling only allows suggestion generation; it never auto-approves mappings or impact.</p>
"""
    return _shell("Tenant AI Settings", nav_qs, body)

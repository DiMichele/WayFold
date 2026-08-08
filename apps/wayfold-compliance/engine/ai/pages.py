from __future__ import annotations

from html import escape

from engine.ui_shell import render_shell

from .domain import AISuggestion, TenantAISettings

_NAV = (
    ("Portfolio", "/portfolio"),
    ("Sources", "/sources"),
    ("Reg Changes", "/changes"),
    ("AI Suggestions", "/ai/suggestions"),
    ("AI Settings", "/ai/settings"),
)


def _shell(title: str, nav_qs: str, body: str) -> str:
    # Title is rendered in body for AI pages historically; keep h1 in body content.
    return render_shell(title, nav_qs, body, nav_items=_NAV)


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
<h1>AI Suggestions</h1>
<p class="warn">AI suggests only — human review required. Approving a suggestion does not mark the client compliant or mutate CISO baselines.</p>
<table><thead><tr>
<th>ID</th><th>Kind</th><th>Tenant</th><th>Status</th><th>Conf.</th><th>Summary</th><th>Review</th>
</tr></thead><tbody>{''.join(rows) or '<tr><td colspan=7>No suggestions</td></tr>'}</tbody></table>
"""
    return _shell("AI Suggestions — WayFold Compliance", nav_qs, body)


def settings_page(settings: TenantAISettings, nav_qs: str) -> str:
    state = "ENABLED" if settings.ai_processing_enabled else "DISABLED (default)"
    body = f"""
<h1>Tenant AI Settings</h1>
<p>Tenant <code>{escape(settings.tenant_id)}</code> — AI processing: <strong>{escape(state)}</strong></p>
<p>
  <a class="btn" href="/api/ai/settings?{nav_qs}&tenant_id={escape(settings.tenant_id)}&enabled=1">Enable</a>
  <a class="btn" href="/api/ai/settings?{nav_qs}&tenant_id={escape(settings.tenant_id)}&enabled=0">Disable</a>
</p>
<p class="warn">Default is disabled. Enabling only allows suggestion generation; it never auto-approves mappings or impact.</p>
"""
    return _shell("Tenant AI Settings — WayFold Compliance", nav_qs, body)

"""Dense HTML for Regulatory Intelligence inbox (Phase 4)."""

from __future__ import annotations

from html import escape

from engine.ui_shell import render_shell

_NAV = (
    ("Portfolio", "/portfolio"),
    ("Sources", "/sources"),
    ("Reg Changes", "/changes"),
    ("FW Suggestions", "/suggestions"),
    ("AI", "/ai/suggestions"),
)


def _shell(title: str, nav_qs: str, body: str) -> str:
    return render_shell(title, nav_qs, body, nav_items=_NAV)


def sources_page(sources, nav_qs: str) -> str:
    rows = "".join(
        "<tr>"
        f"<td><code>{escape(s.id)}</code></td>"
        f"<td>{escape(s.title)}</td>"
        f"<td>{escape(s.type.value)}</td>"
        f"<td>{escape(s.url)}</td>"
        f"<td>{'yes' if s.monitoring_enabled else 'no'}</td>"
        f"<td>{escape(s.last_successful_fetch or '—')}</td>"
        f"<td><code>{escape((s.last_content_hash or '')[:12] or '—')}</code></td>"
        f"<td><a href='/api/regulatory/check?{nav_qs}&source_id={escape(s.id)}'>check</a></td>"
        "</tr>"
        for s in sources
    )
    body = f"""
<h1>Regulatory Sources</h1>
<p class="meta">Configurabili · fetch adapters HTML/JSON/FILE · nessuna mutazione automatica del core</p>
<table><thead><tr>
<th>ID</th><th>Title</th><th>Type</th><th>URL</th><th>Monitor</th>
<th>Last OK fetch</th><th>Hash</th><th>Action</th>
</tr></thead><tbody>{rows or '<tr><td colspan="8">Nessuna source</td></tr>'}</tbody></table>
"""
    return _shell("Sources — WayFold", nav_qs, body)


def changes_page(changes, nav_qs: str) -> str:
    rows = "".join(
        "<tr>"
        f"<td><a href='/change?{nav_qs}&change_id={escape(c.id)}'><code>{escape(c.id)}</code></a></td>"
        f"<td>{escape(c.source_id)}</td>"
        f"<td><span class='badge'>{escape(c.status.value)}</span></td>"
        f"<td><span class='badge'>{escape(c.relevance)}</span></td>"
        f"<td>{escape(c.detected_at)}</td>"
        f"<td>{escape(c.summary)}</td>"
        "</tr>"
        for c in changes
    )
    body = f"""
<h1>Regulatory Changes</h1>
<p class="meta">Inbox deterministica · AI analysis = Phase 5</p>
<table><thead><tr>
<th>Change</th><th>Source</th><th>Status</th><th>Relevance</th><th>Detected</th><th>Summary</th>
</tr></thead><tbody>{rows or '<tr><td colspan="6">Nessun change</td></tr>'}</tbody></table>
"""
    return _shell("Changes — WayFold", nav_qs, body)


def change_detail_page(change, impact, nav_qs: str) -> str:
    impact_rows = "".join(
        "<tr>"
        f"<td>{escape(r.tenant_name)}</td>"
        f"<td>{escape(r.program_name)}</td>"
        f"<td>{escape(r.framework_name)} <code>{escape(r.framework_version)}</code></td>"
        f"<td>{escape(', '.join(r.requirement_ids) or '—')}</td>"
        f"<td>{escape(', '.join(r.control_refs) or '—')}</td>"
        "</tr>"
        for r in (impact.rows if impact else [])
    )
    body = f"""
<h1>Change <code>{escape(change.id)}</code></h1>
<p class="meta">Source {escape(change.source_id)} · {escape(change.status.value)} · {escape(change.relevance)}</p>
<p class="meta">{escape(change.summary)}</p>
<p class="meta">
  <a href="/api/regulatory/review?{nav_qs}&change_id={escape(change.id)}&status=ACCEPTED">Accept</a> ·
  <a href="/api/regulatory/review?{nav_qs}&change_id={escape(change.id)}&status=IGNORED">Ignore</a> ·
  <a href="/api/regulatory/impact?{nav_qs}&change_id={escape(change.id)}">Impact JSON</a>
</p>
<h2>Client impact (indication only — no auto migration)</h2>
<p class="meta">Requirements: {impact.requirements if impact else 0} · Controls: {impact.controls if impact else 0}
 · Clients: {impact.clients if impact else 0} · Programs: {impact.programs if impact else 0}</p>
<table><thead><tr>
<th>Client</th><th>Program</th><th>Framework</th><th>Requirements</th><th>Controls</th>
</tr></thead><tbody>{impact_rows or '<tr><td colspan="5">Nessun impatto mappato</td></tr>'}</tbody></table>
<h2>Diff (normalized)</h2>
<pre class="diff">{escape(change.raw_diff or '(empty)')}</pre>
"""
    return _shell(f"Change — {change.id}", nav_qs, body)


def suggestions_page(suggestions, nav_qs: str) -> str:
    rows = "".join(
        "<tr>"
        f"<td><code>{escape(s.id)}</code></td>"
        f"<td>{escape(s.change_id)}</td>"
        f"<td>{escape(s.suggested_action)}</td>"
        f"<td><span class='badge'>{escape(s.status.value)}</span></td>"
        f"<td>{escape(', '.join(s.framework_ids))}</td>"
        f"<td>{escape(', '.join(s.framework_versions))}</td>"
        f"<td>{escape(s.rationale)}</td>"
        "</tr>"
        for s in suggestions
    )
    body = f"""
<h1>Framework update suggestions</h1>
<p class="meta">CLONE_DRAFT / review mappings — mai publish automatico sulle baseline pubblicate</p>
<table><thead><tr>
<th>ID</th><th>Change</th><th>Action</th><th>Status</th><th>Frameworks</th><th>Versions</th><th>Rationale</th>
</tr></thead><tbody>{rows or '<tr><td colspan="7">Nessun suggestion</td></tr>'}</tbody></table>
"""
    return _shell("FW Suggestions — WayFold", nav_qs, body)

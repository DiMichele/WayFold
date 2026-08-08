from __future__ import annotations

from html import escape

from engine.ui_shell import render_shell

from .domain import AutomatedEvidenceRecord, ConnectorConfig

_NAV = (
    ("Portfolio", "/portfolio"),
    ("Evidence", "/evidence"),
    ("Auto Evidence", "/auto-evidence"),
    ("Connectors", "/connectors"),
)


def _shell(title: str, nav_qs: str, body: str) -> str:
    return render_shell(title, nav_qs, body, nav_items=_NAV)


def connectors_page(items: list[ConnectorConfig], nav_qs: str) -> str:
    rows = []
    for c in items:
        rows.append(
            "<tr>"
            f"<td><code>{escape(c.id)}</code></td>"
            f"<td>{escape(c.name)}</td>"
            f"<td>{escape(c.tenant_id)}</td>"
            f"<td><span class='badge'>{escape(c.kind.value)}</span></td>"
            f"<td>{escape(c.provider)}</td>"
            f"<td>{escape(c.last_ingest_status or '-')}</td>"
            f"<td>{escape(c.last_checked_at or '-')}</td>"
            f"<td><a href='/api/auto-evidence/ingest?{nav_qs}&connector_id={escape(c.id)}'>Ingest</a></td>"
            "</tr>"
        )
    body = f"""
<h1>Scanner Connectors</h1>
<p class="warn">Prowler/fixture connectors produce SUPPORTING technical evidence. PASS ≠ compliant. Human review required.</p>
<table><thead><tr>
<th>ID</th><th>Name</th><th>Tenant</th><th>Kind</th><th>Provider</th><th>Last status</th><th>Last checked</th><th>Action</th>
</tr></thead><tbody>{''.join(rows) or '<tr><td colspan=8>No connectors</td></tr>'}</tbody></table>
"""
    return _shell("Scanner Connectors", nav_qs, body)


def evidence_page(items: list[AutomatedEvidenceRecord], nav_qs: str) -> str:
    rows = []
    for r in items:
        review = ""
        if r.review_status.value == "PENDING_REVIEW":
            review = (
                f"<a href='/api/auto-evidence/review?{nav_qs}&evidence_id={escape(r.id)}&status=APPROVED'>Approve</a> · "
                f"<a href='/api/auto-evidence/review?{nav_qs}&evidence_id={escape(r.id)}&status=REJECTED'>Reject</a>"
            )
        rows.append(
            "<tr>"
            f"<td><code>{escape(r.id)}</code></td>"
            f"<td>{escape(r.canonical_control_ref)}</td>"
            f"<td>{escape(r.check_id)}</td>"
            f"<td><span class='badge'>{escape(r.finding_status.value)}</span></td>"
            f"<td><span class='badge'>{escape(r.review_status.value)}</span></td>"
            f"<td>{escape(r.resource_uid)}</td>"
            f"<td>{escape(r.title)}</td>"
            f"<td>{review}</td>"
            "</tr>"
        )
    body = f"""
<h1>Automated Evidence</h1>
<p class="warn">Automated evidence is EXTERNAL_REFERENCE with provenance. Approving attaches the technical signal — it does not set AppliedControl IMPLEMENTED or framework readiness to compliant.</p>
<table><thead><tr>
<th>ID</th><th>Control</th><th>Check</th><th>Finding</th><th>Review</th><th>Resource</th><th>Title</th><th>Actions</th>
</tr></thead><tbody>{''.join(rows) or '<tr><td colspan=8>No automated evidence</td></tr>'}</tbody></table>
"""
    return _shell("Automated Evidence", nav_qs, body)

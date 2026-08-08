from __future__ import annotations

from html import escape

from .domain import AutomatedEvidenceRecord, ConnectorConfig


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
  <a href="/evidence?{nav_qs}">Evidence (manual)</a>
  <a href="/auto-evidence?{nav_qs}">Auto Evidence</a>
  <a href="/connectors?{nav_qs}">Connectors</a>
</nav>
<h1>{escape(title)}</h1>
{body}
</body></html>"""


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
<p class="warn">Automated evidence is EXTERNAL_REFERENCE with provenance. Approving attaches the technical signal — it does not set AppliedControl IMPLEMENTED or framework readiness to compliant.</p>
<table><thead><tr>
<th>ID</th><th>Control</th><th>Check</th><th>Finding</th><th>Review</th><th>Resource</th><th>Title</th><th>Actions</th>
</tr></thead><tbody>{''.join(rows) or '<tr><td colspan=8>No automated evidence</td></tr>'}</tbody></table>
"""
    return _shell("Automated Evidence", nav_qs, body)

from __future__ import annotations

import csv
import io
from datetime import date

from .checklist import build_unified_checklist
from .consultant_views import deadline_view, task_view
from .dates import today
from .domain import ImplementationStatus, ProgramSnapshot
from .gap_assessment import build_gap_rows
from .impact import rank_control_impact
from .readiness import framework_readiness


def build_report_context(
    program: ProgramSnapshot, *, as_of: date | None = None
) -> dict:
    as_of = as_of or today()
    checklist = build_unified_checklist(program)
    readiness = framework_readiness(program, checklist)
    impact = rank_control_impact(program, checklist)
    gaps = build_gap_rows(program, checklist)
    deadlines = deadline_view(program, checklist, as_of=as_of)
    tasks = task_view(program, checklist, as_of=as_of)

    critical = [
        g
        for g in gaps
        if g.mapped
        and g.status == ImplementationStatus.NOT_IMPLEMENTED.value
        and (g.priority or "").upper() == "HIGH"
    ]
    high = [
        g
        for g in gaps
        if g.mapped
        and g.status != ImplementationStatus.IMPLEMENTED.value
        and (g.priority or "").upper() == "HIGH"
    ]
    in_progress = [
        c for c in checklist.controls if c.status == ImplementationStatus.IN_PROGRESS
    ]
    overdue = [t for t in tasks if t.overdue] + [
        d for d in deadlines if d.overdue and d.open_task_count == 0
    ]

    return {
        "client": program.tenant_name,
        "tenant_id": program.tenant_id,
        "program": program.program_name,
        "program_id": program.program_id,
        "assessment_date": as_of.isoformat(),
        "scope": f"{checklist.raw_requirement_count} requirements / "
        f"{checklist.unified_control_count} unified controls",
        "checklist": checklist,
        "readiness": readiness,
        "impact": impact,
        "critical_gaps": critical,
        "high_priority_gaps": high,
        "in_progress": in_progress,
        "overdue_tasks": overdue,
        "upcoming_deadlines": [d for d in deadlines if not d.overdue],
        "unmapped": checklist.unmapped,
        "gaps": gaps,
    }


def report_html(program: ProgramSnapshot, *, as_of: date | None = None) -> str:
    ctx = build_report_context(program, as_of=as_of)
    ready_rows = "".join(
        "<tr>"
        f"<td>{r.framework_name}</td><td>{r.framework_version}</td>"
        f"<td>{(r.implementation_readiness or 0):.0%}</td>"
        f"<td>{r.fully_covered}</td><td>{r.partially_covered}</td>"
        f"<td>{r.not_covered}</td><td>{r.unmapped}</td><td>{r.not_applicable}</td>"
        "</tr>"
        for r in ctx["readiness"]
    )
    crit = "".join(
        f"<li>{g.framework_name} {g.requirement_code} → "
        f"{g.canonical_control_ref or '—'} ({g.status}): {g.gap}</li>"
        for g in ctx["critical_gaps"][:25]
    ) or "<li>None</li>"
    high = "".join(
        f"<li>{g.framework_name} {g.requirement_code} → "
        f"{g.canonical_control_ref or '—'} ({g.status})</li>"
        for g in ctx["high_priority_gaps"][:25]
    ) or "<li>None</li>"
    progress = "".join(
        f"<li>{c.canonical_control_ref}: {c.name} "
        f"(owner={c.owner or '—'}, due={c.due_date or '—'})</li>"
        for c in ctx["in_progress"]
    ) or "<li>None</li>"
    overdue = "".join(
        f"<li>{getattr(t, 'control_ref', None) or getattr(t, 'name', t)} "
        f"due={getattr(t, 'due_date', None)} owner={getattr(t, 'owner', None)}</li>"
        for t in ctx["overdue_tasks"][:25]
    ) or "<li>None</li>"
    upcoming = "".join(
        f"<li>{d.due_date} {d.control_ref}: {d.name} (owner={d.owner or '—'})</li>"
        for d in ctx["upcoming_deadlines"][:25]
    ) or "<li>None</li>"
    unmapped = "".join(
        f"<li>{u.framework_name} {u.code}: {u.title}</li>" for u in ctx["unmapped"]
    ) or "<li>None</li>"

    return f"""<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<title>Report — {ctx['client']} / {ctx['program']}</title>
<style>
body{{font-family:Segoe UI,sans-serif;margin:1.5rem;color:#111;background:#fff}}
h1{{font-size:1.35rem;margin:0 0 .25rem}}
h2{{font-size:1.05rem;margin:1.4rem 0 .5rem;border-bottom:1px solid #ccc;padding-bottom:.2rem}}
.meta{{color:#444;margin-bottom:1rem}}
table{{border-collapse:collapse;width:100%;font-size:.9rem}}
th,td{{border:1px solid #ccc;padding:.35rem .5rem;text-align:left}}
th{{background:#f0f0f0}}
ul{{margin:.25rem 0 .75rem 1.2rem}}
@media print{{body{{margin:.8rem}} a{{color:inherit;text-decoration:none}}}}
</style></head><body>
<h1>WayFold Compliance Report</h1>
<p class="meta">
<strong>{ctx['client']}</strong> · {ctx['program']}<br>
Assessment date: {ctx['assessment_date']} · Scope: {ctx['scope']}
</p>
<h2>Executive overview</h2>
<ul>
<li>Unified controls: {ctx['checklist'].unified_control_count}</li>
<li>Unmapped requirements: {len(ctx['unmapped'])}</li>
<li>Critical gaps (HIGH / NOT_IMPLEMENTED): {len(ctx['critical_gaps'])}</li>
<li>Controls in progress: {len(ctx['in_progress'])}</li>
<li>Overdue signals: {len(ctx['overdue_tasks'])}</li>
</ul>
<h2>Framework readiness</h2>
<table><thead><tr>
<th>Framework</th><th>Version</th><th>Readiness</th>
<th>FULLY</th><th>PARTIAL</th><th>NOT</th><th>UNMAPPED</th><th>N/A</th>
</tr></thead><tbody>{ready_rows}</tbody></table>
<h2>Critical gaps</h2><ul>{crit}</ul>
<h2>High-priority gaps</h2><ul>{high}</ul>
<h2>Controls in progress</h2><ul>{progress}</ul>
<h2>Overdue</h2><ul>{overdue}</ul>
<h2>Upcoming deadlines</h2><ul>{upcoming}</ul>
<h2>Unmapped requirements</h2><ul>{unmapped}</ul>
</body></html>"""


def report_csv(program: ProgramSnapshot, *, as_of: date | None = None) -> str:
    ctx = build_report_context(program, as_of=as_of)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "client",
            "program",
            "assessment_date",
            "framework",
            "framework_version",
            "requirement",
            "title",
            "control",
            "mapping",
            "status",
            "owner",
            "deadline",
            "priority",
            "evidence_count",
            "gap",
        ]
    )
    for g in ctx["gaps"]:
        w.writerow(
            [
                ctx["client"],
                ctx["program"],
                ctx["assessment_date"],
                g.framework_name,
                g.framework_version,
                g.requirement_code,
                g.requirement_title,
                g.canonical_control_ref or "",
                g.mapping,
                g.status,
                g.owner or "",
                g.deadline or "",
                g.priority or "",
                g.evidence_count,
                g.gap,
            ]
        )
    return buf.getvalue()

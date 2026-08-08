"""Dense consultant HTML pages (Phase 3) — WayFold ecosystem visual language."""

from __future__ import annotations

from html import escape
from urllib.parse import parse_qsl, urlencode

from engine.ui_shell import render_shell


def _with_program(nav_qs: str, program_id: str) -> str:
    data = dict(parse_qsl(nav_qs, keep_blank_values=False))
    data["program_id"] = program_id
    return urlencode(data)


def _with_control(nav_qs: str, control_ref: str) -> str:
    data = dict(parse_qsl(nav_qs, keep_blank_values=False))
    data["control_ref"] = control_ref
    return urlencode(data)


def _shell(title: str, nav_qs: str, body: str) -> str:
    return render_shell(title, nav_qs, body)


def portfolio_page(rows, nav_qs: str) -> str:
    body_rows = []
    for r in rows:
        ready = (
            f"{r.implementation_readiness:.0%}"
            if r.implementation_readiness is not None
            else "n/a"
        )
        client_qs = _with_program(nav_qs, r.program_id)
        body_rows.append(
            "<tr>"
            f"<td><a href='/client?{client_qs}'>{escape(r.tenant_name)}</a></td>"
            f"<td>{escape(r.program_name)}</td>"
            f"<td>{escape(', '.join(r.frameworks))}</td>"
            f"<td>{ready}</td>"
            f"<td>{r.critical_gaps}</td>"
            f"<td>{r.high_priority_open}</td>"
            f"<td>{r.overdue_tasks}</td>"
            f"<td>{escape(r.next_deadline or '—')}</td>"
            f"<td>{escape(r.last_activity or '—')}</td>"
            f"<td>{r.unmapped}</td>"
            "</tr>"
        )
    body = f"""
<h1>Portfolio</h1>
<p class="meta">Vista globale consulente · {len(rows)} programmi autorizzati</p>
<table><thead><tr>
<th>Cliente</th><th>Programma</th><th>Framework</th><th>Readiness</th>
<th>Gap critici</th><th>HIGH aperti</th><th>Overdue</th>
<th>Next deadline</th><th>Last activity</th><th>Unmapped</th>
</tr></thead><tbody>{''.join(body_rows) or '<tr><td colspan="10">Nessun programma accessibile</td></tr>'}</tbody></table>
"""
    return _shell("Portfolio — WayFold Compliance", nav_qs, body)


def client_page(dash, nav_qs: str) -> str:
    fw = "".join(
        f"<li>{escape(f['framework_name'])} "
        f"<code>{escape(f['framework_version'])}</code></li>"
        for f in dash.frameworks
    )
    ready = "".join(
        "<tr>"
        f"<td>{escape(r['framework_name'])}</td>"
        f"<td>{escape(r['framework_version'])}</td>"
        f"<td>{(r['implementation_readiness'] or 0):.0%}</td>"
        f"<td>{r['fully_covered']}/{r['partially_covered']}/{r['not_covered']}/"
        f"{r['unmapped']}/{r['not_applicable']}</td>"
        "</tr>"
        for r in dash.readiness
    )
    status = " · ".join(f"{k}={v}" for k, v in dash.status_counts.items() if v)
    workload = "".join(
        f"<li>{escape(o)}: {n} open controls</li>"
        for o, n in dash.workload_by_owner.items()
    ) or "<li>None</li>"
    deadlines = "".join(
        f"<li>{escape(d['due_date'] or '')} "
        f"{escape(d['control_ref'] or '')}: {escape(d['name'])} "
        f"(owner={escape(d['owner'] or '—')})</li>"
        for d in dash.deadlines_next_30_days
    ) or "<li>None</li>"
    impact = "".join(
        f"<li><code>{escape(i['canonical_control_ref'] or '')}</code> "
        f"{escape(i['summary'])}</li>"
        for i in dash.top_impact
    )
    body = f"""
<h1>{escape(dash.tenant_name)}</h1>
<p class="meta">{escape(dash.program_name)} · raw {dash.raw_requirements}
 · unified {dash.unified_controls} · unmapped {dash.unmapped_count}</p>
<h2>Framework / versioni</h2><ul class="compact">{fw}</ul>
<h2>Stati implementazione</h2><p class="meta">{escape(status)}</p>
<p class="meta">Missing evidence: {dash.missing_evidence} · Open tasks: {dash.open_tasks}
 · Overdue tasks: {dash.overdue_tasks}</p>
<h2>Readiness per framework</h2>
<table><thead><tr><th>Framework</th><th>Version</th><th>Readiness</th>
<th>FULLY/PARTIAL/NOT/UNMAPPED/N/A</th></tr></thead>
<tbody>{ready}</tbody></table>
<h2>Workload per owner</h2><ul class="compact">{workload}</ul>
<h2>Deadline prossimi 30 giorni</h2><ul class="compact">{deadlines}</ul>
<h2>Top control impact</h2><ul class="compact">{impact}</ul>
"""
    return _shell(f"Client — {dash.tenant_name}", nav_qs, body)


def gaps_page(rows, nav_qs: str, filter_values: dict) -> str:
    opts_status = ["", "IMPLEMENTED", "IN_PROGRESS", "NOT_IMPLEMENTED", "UNMAPPED", "NOT_APPLICABLE"]
    status_opts = "".join(
        f"<option value='{s}' {'selected' if filter_values.get('status')==s else ''}>{s or '—'}</option>"
        for s in opts_status
    )
    mapped_val = filter_values.get("mapped", "")
    body_rows = []
    for r in rows:
        if r.canonical_control_ref:
            ctrl_qs = _with_control(nav_qs, r.canonical_control_ref)
            ctrl_cell = (
                f"<a href='/control?{ctrl_qs}'><code>{escape(r.canonical_control_ref)}</code></a>"
                f"<br>{escape(r.control_name or '')}"
            )
        else:
            ctrl_cell = "—<br>"
        body_rows.append(
            "<tr>"
            f"<td>{escape(r.framework_name)}<br><code>{escape(r.framework_version)}</code></td>"
            f"<td><strong>{escape(r.requirement_code)}</strong><br>{escape(r.requirement_title)}</td>"
            f"<td>{ctrl_cell}</td>"
            f"<td><span class='badge'>{escape(r.mapping)}</span></td>"
            f"<td>{escape(r.status)}</td>"
            f"<td>{escape(r.owner or '—')}</td>"
            f"<td>{escape(r.deadline or '—')}</td>"
            f"<td>{r.evidence_count}</td>"
            f"<td>{r.open_task_count}</td>"
            f"<td>{escape(r.gap)}</td>"
            f"<td>{escape(r.notes)}</td>"
            "</tr>"
        )
    body = f"""
<h1>Gap Assessment</h1>
<p class="meta">{len(rows)} righe · filtri server-side · click controllo → coverage/delta/evidence/task</p>
<form class="filters" method="get" action="/gaps">
  <input type="hidden" name="superuser" value="{escape(filter_values.get('superuser',''))}">
  <input type="hidden" name="actor_tenants" value="{escape(filter_values.get('actor_tenants',''))}">
  <input type="hidden" name="program_id" value="{escape(filter_values.get('program_id',''))}">
  <label>Framework<input name="framework" value="{escape(filter_values.get('framework',''))}"></label>
  <label>Status<select name="status">{status_opts}</select></label>
  <label>Owner<input name="owner" value="{escape(filter_values.get('owner',''))}"></label>
  <label>Priority<input name="priority" value="{escape(filter_values.get('priority',''))}"></label>
  <label>Deadline from<input type="date" name="deadline_after" value="{escape(filter_values.get('deadline_after',''))}"></label>
  <label>Deadline to<input type="date" name="deadline_before" value="{escape(filter_values.get('deadline_before',''))}"></label>
  <label>Mapped
    <select name="mapped">
      <option value="" {'selected' if mapped_val=='' else ''}>—</option>
      <option value="1" {'selected' if mapped_val=='1' else ''}>mapped</option>
      <option value="0" {'selected' if mapped_val=='0' else ''}>unmapped</option>
    </select>
  </label>
  <label>Missing evidence
    <select name="missing_evidence">
      <option value="" {'selected' if not filter_values.get('missing_evidence') else ''}>—</option>
      <option value="1" {'selected' if filter_values.get('missing_evidence')=='1' else ''}>yes</option>
    </select>
  </label>
  <label>Search<input name="search" value="{escape(filter_values.get('search',''))}"></label>
  <button type="submit">Filtra</button>
</form>
<table><thead><tr>
<th>Framework</th><th>Requirement</th><th>Control</th><th>Mapping</th>
<th>Status</th><th>Owner</th><th>Deadline</th><th>Evidence</th><th>Tasks</th><th>Gap</th><th>Notes</th>
</tr></thead><tbody>{''.join(body_rows) or '<tr><td colspan="11">Nessun risultato</td></tr>'}</tbody></table>
"""
    return _shell("Gap Assessment — WayFold", nav_qs, body)


def control_page(detail, nav_qs: str) -> str:
    cov_rows = "".join(
        "<tr>"
        f"<td>{escape(c.framework_name)}<br><code>{escape(c.framework_version)}</code></td>"
        f"<td><strong>{escape(c.requirement_code)}</strong><br>{escape(c.requirement_title)}</td>"
        f"<td><span class='badge'>{escape(c.relation)}</span></td>"
        f"<td>{escape(c.uncovered_delta or '—')}</td>"
        f"<td>{escape(c.rationale or '—')}</td>"
        "</tr>"
        for c in detail.framework_coverage
    )
    body = f"""
<h1>Control <code>{escape(detail.control_ref)}</code></h1>
<p class="meta">{escape(detail.name)} · status {escape(detail.status)}
 · owner {escape(detail.owner or '—')} · deadline {escape(detail.due_date or '—')}
 · priority {escape(detail.priority or '—')}</p>
<p class="meta">Evidence: {detail.evidence_count} · Open tasks: {detail.open_task_count}
 · Gap notes: {escape(detail.gap_notes or '—')}</p>
<p class="hint"><a href="/gaps?{nav_qs}">← Gap Assessment</a>
 · <a href="/evidence?{nav_qs}">Evidence view</a>
 · <a href="/tasks?{nav_qs}">Task view</a></p>
<h2>Framework coverage</h2>
<table><thead><tr>
<th>Framework</th><th>Requirement</th><th>Mapping</th><th>Delta</th><th>Rationale</th>
</tr></thead><tbody>{cov_rows or '<tr><td colspan="5">Nessuna coverage</td></tr>'}</tbody></table>
"""
    return _shell(f"Control — {detail.control_ref}", nav_qs, body)


def owners_page(by_owner: dict, nav_qs: str) -> str:
    sections = []
    for owner, items in by_owner.items():
        row_parts = []
        for i in items:
            if i.control_ref:
                ctrl = (
                    f"<a href='/control?{_with_control(nav_qs, i.control_ref)}'>"
                    f"<code>{escape(i.control_ref)}</code></a>"
                )
            else:
                ctrl = "—"
            row_parts.append(
                "<tr>"
                f"<td>{ctrl}</td>"
                f"<td>{escape(i.name)}</td>"
                f"<td>{escape(i.status)}</td>"
                f"<td>{escape(i.priority or '—')}</td>"
                f"<td>{escape(i.due_date or '—')}</td>"
                f"<td>{i.open_task_count}</td>"
                f"<td>{escape(', '.join(i.frameworks))}</td>"
                "</tr>"
            )
        rows = "".join(row_parts)
        sections.append(
            f"<h2>{escape(owner)} <span class='badge'>{len(items)}</span></h2>"
            f"<table><thead><tr><th>Control</th><th>Name</th><th>Status</th>"
            f"<th>Priority</th><th>Deadline</th><th>Tasks</th><th>Frameworks</th>"
            f"</tr></thead><tbody>{rows}</tbody></table>"
        )
    body = f"<h1>Owner view</h1><p class='meta'>Chi deve fare cosa</p>{''.join(sections) or '<p>Nessun item aperto</p>'}"
    return _shell("Owners — WayFold", nav_qs, body)


def deadlines_page(items, nav_qs: str) -> str:
    rows = "".join(
        "<tr>"
        f"<td class='{'overdue' if i.overdue else ''}'>{escape(i.due_date)}</td>"
        f"<td>{escape(i.owner or '—')}</td>"
        f"<td>{escape(i.control_ref or '')}</td>"
        f"<td>{escape(i.name)}</td>"
        f"<td>{escape(i.status)}</td>"
        f"<td>{escape(i.priority or '—')}</td>"
        f"<td>{'OVERDUE' if i.overdue else 'upcoming'}</td>"
        "</tr>"
        for i in items
    )
    body = f"""
<h1>Deadline view</h1>
<p class="meta">Overdue + prossimi 60 giorni</p>
<table><thead><tr>
<th>Deadline</th><th>Owner</th><th>Control</th><th>Name</th><th>Status</th><th>Priority</th><th>Flag</th>
</tr></thead><tbody>{rows or '<tr><td colspan="7">Nessuna deadline</td></tr>'}</tbody></table>
"""
    return _shell("Deadlines — WayFold", nav_qs, body)


def evidence_page(items, nav_qs: str) -> str:
    rows = "".join(
        "<tr>"
        f"<td>{escape(i.control_ref or '')}</td>"
        f"<td>{escape(i.name)}</td>"
        f"<td>{escape(i.status)}</td>"
        f"<td>{escape(i.owner or '—')}</td>"
        f"<td>{i.evidence_count}</td>"
        f"<td>{'MISSING' if i.missing else 'ok'}</td>"
        f"<td>{escape(', '.join(i.frameworks))}</td>"
        "</tr>"
        for i in items
    )
    body = f"""
<h1>Evidence view</h1>
<p class="meta">Evidence counts da implementazioni (reuse core AppliedControl/Evidence)</p>
<table><thead><tr>
<th>Control</th><th>Name</th><th>Status</th><th>Owner</th><th>Evidence</th><th>Flag</th><th>Frameworks</th>
</tr></thead><tbody>{rows}</tbody></table>
"""
    return _shell("Evidence — WayFold", nav_qs, body)


def tasks_page(items, nav_qs: str) -> str:
    rows = "".join(
        "<tr>"
        f"<td>{escape(i.control_ref or '')}</td>"
        f"<td>{escape(i.name)}</td>"
        f"<td>{escape(i.owner or '—')}</td>"
        f"<td class='{'overdue' if i.overdue else ''}'>{escape(i.due_date or '—')}</td>"
        f"<td>{escape(i.priority or '—')}</td>"
        f"<td>{i.open_task_count}</td>"
        f"<td>{'OVERDUE' if i.overdue else 'open'}</td>"
        "</tr>"
        for i in items
    )
    body = f"""
<h1>Task view</h1>
<p class="meta">Task aperti collegati alle implementazioni (reuse core TaskTemplate/TaskNode counts)</p>
<table><thead><tr>
<th>Control</th><th>Name</th><th>Owner</th><th>Deadline</th><th>Priority</th><th>Open</th><th>Flag</th>
</tr></thead><tbody>{rows or '<tr><td colspan="7">Nessun task aperto</td></tr>'}</tbody></table>
"""
    return _shell("Tasks — WayFold", nav_qs, body)

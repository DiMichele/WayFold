"""Dense consultant HTML pages — WayFold ecosystem visual language + i18n."""

from __future__ import annotations

from html import escape
from urllib.parse import parse_qsl, urlencode

from engine.i18n import DEFAULT_LANG, lang_from_qs, normalize_lang, t, with_lang
from engine.ui_shell import render_shell, table_wrap


def _with_program(nav_qs: str, program_id: str) -> str:
    data = dict(parse_qsl(nav_qs, keep_blank_values=False))
    data["program_id"] = program_id
    return urlencode(data)


def _with_control(nav_qs: str, control_ref: str) -> str:
    data = dict(parse_qsl(nav_qs, keep_blank_values=False))
    data["control_ref"] = control_ref
    return urlencode(data)


def _lang(nav_qs: str, lang: str | None = None) -> str:
    if lang:
        return normalize_lang(lang)
    return normalize_lang(dict(parse_qsl(nav_qs)).get("lang", DEFAULT_LANG))


def _shell(title: str, nav_qs: str, body: str, *, lang: str) -> str:
    return render_shell(title, with_lang(nav_qs, lang), body, lang=lang)


def portfolio_page(rows, nav_qs: str, lang: str | None = None) -> str:
    lang = _lang(nav_qs, lang)
    nav_qs = with_lang(nav_qs, lang)
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
    table = f"""<table><thead><tr>
<th>{escape(t(lang,'col.client'))}</th><th>{escape(t(lang,'col.program'))}</th>
<th>{escape(t(lang,'col.framework'))}</th><th>{escape(t(lang,'col.readiness'))}</th>
<th>{escape(t(lang,'col.critical_gaps'))}</th><th>{escape(t(lang,'col.high_open'))}</th>
<th>{escape(t(lang,'col.overdue'))}</th><th>{escape(t(lang,'col.next_deadline'))}</th>
<th>{escape(t(lang,'col.last_activity'))}</th><th>{escape(t(lang,'col.unmapped'))}</th>
</tr></thead><tbody>{''.join(body_rows) or f'<tr><td colspan="10">{escape(t(lang,"portfolio.empty"))}</td></tr>'}</tbody></table>"""
    body = f"""
<div class="page-head">
<h1>{escape(t(lang,'portfolio.title'))}</h1>
<p class="meta">{escape(t(lang,'portfolio.meta', n=len(rows)))}</p>
</div>
{table_wrap(table)}
"""
    return _shell(f"{t(lang,'portfolio.title')} — WayFold Compliance", nav_qs, body, lang=lang)


def client_page(dash, nav_qs: str, lang: str | None = None) -> str:
    lang = _lang(nav_qs, lang)
    nav_qs = with_lang(nav_qs, lang)
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
        f"<li>{escape(o)}: {n} {escape(t(lang,'client.open_controls'))}</li>"
        for o, n in dash.workload_by_owner.items()
    ) or f"<li>{escape(t(lang,'client.none'))}</li>"
    deadlines = "".join(
        f"<li>{escape(d['due_date'] or '')} "
        f"{escape(d['control_ref'] or '')}: {escape(d['name'])} "
        f"({escape(t(lang,'col.owner'))}={escape(d['owner'] or '—')})</li>"
        for d in dash.deadlines_next_30_days
    ) or f"<li>{escape(t(lang,'client.none'))}</li>"
    impact = "".join(
        f"<li><code>{escape(i['canonical_control_ref'] or '')}</code> "
        f"{escape(i['summary'])}</li>"
        for i in dash.top_impact
    )
    ready_table = f"""<table><thead><tr>
<th>{escape(t(lang,'col.framework'))}</th><th>{escape(t(lang,'col.version'))}</th>
<th>{escape(t(lang,'col.readiness'))}</th>
<th>FULLY/PARTIAL/NOT/UNMAPPED/N/A</th></tr></thead>
<tbody>{ready}</tbody></table>"""
    body = f"""
<div class="page-head">
<h1>{escape(dash.tenant_name)}</h1>
<p class="meta">{escape(dash.program_name)} · {dash.raw_requirements} {escape(t(lang,'client.raw'))}
 · {dash.unified_controls} {escape(t(lang,'client.unified'))} · {dash.unmapped_count} {escape(t(lang,'client.unmapped'))}</p>
</div>
<h2>{escape(t(lang,'client.frameworks'))}</h2><ul class="compact">{fw}</ul>
<h2>{escape(t(lang,'client.impl_status'))}</h2><p class="meta">{escape(status)}</p>
<p class="meta">{escape(t(lang,'client.missing_evidence'))}: {dash.missing_evidence} · {escape(t(lang,'client.open_tasks'))}: {dash.open_tasks}
 · {escape(t(lang,'client.overdue_tasks'))}: {dash.overdue_tasks}</p>
<h2>{escape(t(lang,'client.readiness'))}</h2>
{table_wrap(ready_table)}
<h2>{escape(t(lang,'client.workload'))}</h2><ul class="compact">{workload}</ul>
<h2>{escape(t(lang,'client.deadlines_30'))}</h2><ul class="compact">{deadlines}</ul>
<h2>{escape(t(lang,'client.top_impact'))}</h2><ul class="compact">{impact}</ul>
"""
    return _shell(f"{dash.tenant_name} — WayFold Compliance", nav_qs, body, lang=lang)


def gaps_page(rows, nav_qs: str, filter_values: dict, lang: str | None = None) -> str:
    lang = normalize_lang(str(filter_values.get("lang") or lang or _lang(nav_qs)))
    nav_qs = with_lang(nav_qs, lang)
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
    table = f"""<table><thead><tr>
<th>{escape(t(lang,'col.framework'))}</th><th>{escape(t(lang,'col.requirement'))}</th>
<th>{escape(t(lang,'col.control'))}</th><th>{escape(t(lang,'col.mapping'))}</th>
<th>{escape(t(lang,'col.status'))}</th><th>{escape(t(lang,'col.owner'))}</th>
<th>{escape(t(lang,'col.deadline'))}</th><th>{escape(t(lang,'col.evidence'))}</th>
<th>{escape(t(lang,'col.tasks'))}</th><th>{escape(t(lang,'col.gap'))}</th>
<th>{escape(t(lang,'col.notes'))}</th>
</tr></thead><tbody>{''.join(body_rows) or f'<tr><td colspan="11">{escape(t(lang,"gaps.empty"))}</td></tr>'}</tbody></table>"""
    body = f"""
<div class="page-head">
<h1>{escape(t(lang,'gaps.title'))}</h1>
<p class="meta">{escape(t(lang,'gaps.meta', n=len(rows)))}</p>
</div>
<form class="filters" method="get" action="/gaps">
  <input type="hidden" name="lang" value="{escape(lang)}">
  <input type="hidden" name="superuser" value="{escape(filter_values.get('superuser',''))}">
  <input type="hidden" name="actor_tenants" value="{escape(filter_values.get('actor_tenants',''))}">
  <input type="hidden" name="program_id" value="{escape(filter_values.get('program_id',''))}">
  <label>{escape(t(lang,'col.framework'))}<input name="framework" value="{escape(filter_values.get('framework',''))}"></label>
  <label>{escape(t(lang,'col.status'))}<select name="status">{status_opts}</select></label>
  <label>{escape(t(lang,'col.owner'))}<input name="owner" value="{escape(filter_values.get('owner',''))}"></label>
  <label>{escape(t(lang,'col.priority'))}<input name="priority" value="{escape(filter_values.get('priority',''))}"></label>
  <label>{escape(t(lang,'gaps.deadline_from'))}<input type="date" name="deadline_after" value="{escape(filter_values.get('deadline_after',''))}"></label>
  <label>{escape(t(lang,'gaps.deadline_to'))}<input type="date" name="deadline_before" value="{escape(filter_values.get('deadline_before',''))}"></label>
  <label>{escape(t(lang,'gaps.mapped'))}
    <select name="mapped">
      <option value="" {'selected' if mapped_val=='' else ''}>—</option>
      <option value="1" {'selected' if mapped_val=='1' else ''}>{escape(t(lang,'gaps.mapped'))}</option>
      <option value="0" {'selected' if mapped_val=='0' else ''}>{escape(t(lang,'gaps.unmapped'))}</option>
    </select>
  </label>
  <label>{escape(t(lang,'gaps.missing_ev'))}
    <select name="missing_evidence">
      <option value="" {'selected' if not filter_values.get('missing_evidence') else ''}>—</option>
      <option value="1" {'selected' if filter_values.get('missing_evidence')=='1' else ''}>{escape(t(lang,'gaps.yes'))}</option>
    </select>
  </label>
  <label>{escape(t(lang,'gaps.search'))}<input name="search" value="{escape(filter_values.get('search',''))}"></label>
  <button type="submit">{escape(t(lang,'gaps.filter'))}</button>
</form>
{table_wrap(table)}
"""
    return _shell(f"{t(lang,'gaps.title')} — WayFold Compliance", nav_qs, body, lang=lang)


def control_page(detail, nav_qs: str, lang: str | None = None) -> str:
    lang = _lang(nav_qs, lang)
    nav_qs = with_lang(nav_qs, lang)
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
    table = f"""<table><thead><tr>
<th>{escape(t(lang,'col.framework'))}</th><th>{escape(t(lang,'col.requirement'))}</th>
<th>{escape(t(lang,'col.mapping'))}</th><th>{escape(t(lang,'col.delta'))}</th>
<th>{escape(t(lang,'col.rationale'))}</th>
</tr></thead><tbody>{cov_rows or f'<tr><td colspan="5">{escape(t(lang,"control.no_coverage"))}</td></tr>'}</tbody></table>"""
    body = f"""
<div class="page-head">
<h1>{escape(t(lang,'control.title'))} <code>{escape(detail.control_ref)}</code></h1>
<p class="meta">{escape(detail.name)} · {escape(t(lang,'col.status'))} {escape(detail.status)}
 · {escape(t(lang,'col.owner'))} {escape(detail.owner or '—')} · {escape(t(lang,'col.deadline'))} {escape(detail.due_date or '—')}
 · {escape(t(lang,'col.priority'))} {escape(detail.priority or '—')}</p>
<p class="meta">{escape(t(lang,'col.evidence'))}: {detail.evidence_count} · {escape(t(lang,'col.tasks'))}: {detail.open_task_count}
 · {escape(t(lang,'col.notes'))}: {escape(detail.gap_notes or '—')}</p>
</div>
<p class="hint"><a href="/gaps?{nav_qs}">{escape(t(lang,'control.back_gaps'))}</a>
 · <a href="/evidence?{nav_qs}">{escape(t(lang,'control.evidence_view'))}</a>
 · <a href="/tasks?{nav_qs}">{escape(t(lang,'control.task_view'))}</a></p>
<h2>{escape(t(lang,'control.coverage'))}</h2>
{table_wrap(table)}
"""
    return _shell(f"{t(lang,'control.title')} — {detail.control_ref}", nav_qs, body, lang=lang)


def owners_page(by_owner: dict, nav_qs: str, lang: str | None = None) -> str:
    lang = _lang(nav_qs, lang)
    nav_qs = with_lang(nav_qs, lang)
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
        table = (
            f"<table><thead><tr><th>{escape(t(lang,'col.control'))}</th>"
            f"<th>{escape(t(lang,'col.name'))}</th><th>{escape(t(lang,'col.status'))}</th>"
            f"<th>{escape(t(lang,'col.priority'))}</th><th>{escape(t(lang,'col.deadline'))}</th>"
            f"<th>{escape(t(lang,'col.tasks'))}</th><th>{escape(t(lang,'col.framework'))}</th>"
            f"</tr></thead><tbody>{rows}</tbody></table>"
        )
        sections.append(
            f"<h2>{escape(owner)} <span class='badge'>{len(items)}</span></h2>"
            f"{table_wrap(table)}"
        )
    body = (
        f"<div class='page-head'><h1>{escape(t(lang,'owners.title'))}</h1>"
        f"<p class='meta'>{escape(t(lang,'owners.meta'))}</p></div>"
        f"{''.join(sections) or f'<p>{escape(t(lang,'owners.empty'))}</p>'}"
    )
    return _shell(f"{t(lang,'owners.title')} — WayFold Compliance", nav_qs, body, lang=lang)


def deadlines_page(items, nav_qs: str, lang: str | None = None) -> str:
    lang = _lang(nav_qs, lang)
    nav_qs = with_lang(nav_qs, lang)
    rows = "".join(
        "<tr>"
        f"<td class='{'overdue' if i.overdue else ''}'>{escape(i.due_date)}</td>"
        f"<td>{escape(i.owner or '—')}</td>"
        f"<td>{escape(i.control_ref or '')}</td>"
        f"<td>{escape(i.name)}</td>"
        f"<td>{escape(i.status)}</td>"
        f"<td>{escape(i.priority or '—')}</td>"
        f"<td>{escape(t(lang,'deadlines.overdue') if i.overdue else t(lang,'deadlines.upcoming'))}</td>"
        "</tr>"
        for i in items
    )
    table = f"""<table><thead><tr>
<th>{escape(t(lang,'col.deadline'))}</th><th>{escape(t(lang,'col.owner'))}</th>
<th>{escape(t(lang,'col.control'))}</th><th>{escape(t(lang,'col.name'))}</th>
<th>{escape(t(lang,'col.status'))}</th><th>{escape(t(lang,'col.priority'))}</th>
<th>{escape(t(lang,'col.flag'))}</th>
</tr></thead><tbody>{rows or f'<tr><td colspan="7">{escape(t(lang,"deadlines.empty"))}</td></tr>'}</tbody></table>"""
    body = f"""
<div class="page-head">
<h1>{escape(t(lang,'deadlines.title'))}</h1>
<p class="meta">{escape(t(lang,'deadlines.meta'))}</p>
</div>
{table_wrap(table)}
"""
    return _shell(f"{t(lang,'deadlines.title')} — WayFold Compliance", nav_qs, body, lang=lang)


def evidence_page(items, nav_qs: str, lang: str | None = None) -> str:
    lang = _lang(nav_qs, lang)
    nav_qs = with_lang(nav_qs, lang)
    rows = "".join(
        "<tr>"
        f"<td>{escape(i.control_ref or '')}</td>"
        f"<td>{escape(i.name)}</td>"
        f"<td>{escape(i.status)}</td>"
        f"<td>{escape(i.owner or '—')}</td>"
        f"<td>{i.evidence_count}</td>"
        f"<td>{escape(t(lang,'evidence.missing') if i.missing else t(lang,'evidence.ok'))}</td>"
        f"<td>{escape(', '.join(i.frameworks))}</td>"
        "</tr>"
        for i in items
    )
    table = f"""<table><thead><tr>
<th>{escape(t(lang,'col.control'))}</th><th>{escape(t(lang,'col.name'))}</th>
<th>{escape(t(lang,'col.status'))}</th><th>{escape(t(lang,'col.owner'))}</th>
<th>{escape(t(lang,'col.evidence'))}</th><th>{escape(t(lang,'col.flag'))}</th>
<th>{escape(t(lang,'col.framework'))}</th>
</tr></thead><tbody>{rows}</tbody></table>"""
    body = f"""
<div class="page-head">
<h1>{escape(t(lang,'evidence.title'))}</h1>
<p class="meta">{escape(t(lang,'evidence.meta'))}</p>
</div>
{table_wrap(table)}
"""
    return _shell(f"{t(lang,'evidence.title')} — WayFold Compliance", nav_qs, body, lang=lang)


def tasks_page(items, nav_qs: str, lang: str | None = None) -> str:
    lang = _lang(nav_qs, lang)
    nav_qs = with_lang(nav_qs, lang)
    rows = "".join(
        "<tr>"
        f"<td>{escape(i.control_ref or '')}</td>"
        f"<td>{escape(i.name)}</td>"
        f"<td>{escape(i.owner or '—')}</td>"
        f"<td class='{'overdue' if i.overdue else ''}'>{escape(i.due_date or '—')}</td>"
        f"<td>{escape(i.priority or '—')}</td>"
        f"<td>{i.open_task_count}</td>"
        f"<td>{escape(t(lang,'deadlines.overdue') if i.overdue else t(lang,'tasks.open'))}</td>"
        "</tr>"
        for i in items
    )
    table = f"""<table><thead><tr>
<th>{escape(t(lang,'col.control'))}</th><th>{escape(t(lang,'col.name'))}</th>
<th>{escape(t(lang,'col.owner'))}</th><th>{escape(t(lang,'col.deadline'))}</th>
<th>{escape(t(lang,'col.priority'))}</th><th>{escape(t(lang,'col.open'))}</th>
<th>{escape(t(lang,'col.flag'))}</th>
</tr></thead><tbody>{rows or f'<tr><td colspan="7">{escape(t(lang,"tasks.empty"))}</td></tr>'}</tbody></table>"""
    body = f"""
<div class="page-head">
<h1>{escape(t(lang,'tasks.title'))}</h1>
<p class="meta">{escape(t(lang,'tasks.meta'))}</p>
</div>
{table_wrap(table)}
"""
    return _shell(f"{t(lang,'tasks.title')} — WayFold Compliance", nav_qs, body, lang=lang)


# silence unused import warning helpers used by callers
__all__ = [
    "portfolio_page",
    "client_page",
    "gaps_page",
    "control_page",
    "owners_page",
    "deadlines_page",
    "evidence_page",
    "tasks_page",
    "lang_from_qs",
]

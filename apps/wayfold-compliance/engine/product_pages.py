"""Product completion pages: Frameworks KB, Mappings, Audit, Clients, Settings."""

from __future__ import annotations

from html import escape
from typing import Any
from urllib.parse import parse_qsl, urlencode

from engine.dates import format_display_datetime
from engine.gap_assessment import GAP_TAXONOMY_IT
from engine.i18n import DEFAULT_LANG, normalize_lang, t, with_lang
from engine.ui_components import empty_state, mapping_badge, page_header, status_badge
from engine.ui_labels import framework_status_label, review_label
from engine.ui_shell import render_shell, table_wrap


def _lang(nav_qs: str) -> str:
    return normalize_lang(dict(parse_qsl(nav_qs)).get("lang", DEFAULT_LANG))


def frameworks_page(
    versions: list[Any],
    usage: dict[str, int],
    nav_qs: str,
    *,
    meta_by_id: dict[str, Any] | None = None,
    coverage_by_fw: dict[str, str] | None = None,
) -> str:
    lang = _lang(nav_qs)
    nav_qs = with_lang(nav_qs, lang)
    meta_by_id = meta_by_id or {}
    coverage_by_fw = coverage_by_fw or {}
    actions = (
        f"<a class='btn primary' href='/frameworks/new?{nav_qs}'>+ Nuovo framework</a>"
        f"<a class='btn' href='/kb/import?{nav_qs}'>Importa</a>"
    )
    if not versions:
        body = page_header(
            eyebrow=t(lang, "nav.section.knowledge"),
            title=t(lang, "fwkb.title"),
            subtitle=t(lang, "fwkb.meta"),
            actions_html=actions,
        ) + empty_state(
            title=t(lang, "fwkb.empty_title"),
            body=t(lang, "fwkb.empty_body"),
        )
        return render_shell(
            f"{t(lang, 'fwkb.title')} — WayFold Compliance",
            nav_qs,
            body,
            lang=lang,
            active_path="/frameworks",
            breadcrumb=t(lang, "fwkb.title"),
        )

    groups: dict[str, list[Any]] = {}
    for v in versions:
        groups.setdefault(v.framework_id, []).append(v)

    rows = []
    for fw_id, vers in sorted(groups.items(), key=lambda x: x[1][0].framework_name):
        current = next((x for x in vers if x.status == "PUBLISHED"), vers[0])
        meta = meta_by_id.get(fw_id)
        fw_type = getattr(meta, "type", None) or "Framework"
        publisher = getattr(meta, "publisher", None) or current.publisher or "—"
        req_count = len(current.requirements)
        q_count = len(getattr(current, "assessment_questions", None) or [])
        clients = usage.get(fw_id, 0)
        href = f"/frameworks/detail?framework_id={escape(fw_id)}&{nav_qs}"
        src = getattr(current, "source_status", "") or "SOURCE_UNVERIFIED"
        cov = coverage_by_fw.get(fw_id, "—")
        mapped = unmapped = "—"
        if isinstance(cov, str) and "/" in cov:
            # "mapped/total" style from context, else leave
            pass
        # coverage_by_fw may be "12/40" or richer; also accept dict via meta
        rows.append(
            "<tr>"
            f"<td><a href='{href}'><strong>{escape(current.framework_name)}</strong></a></td>"
            f"<td>{escape(fw_type)}</td>"
            f"<td>{escape(publisher)}</td>"
            f"<td><code>{escape(current.version)}</code></td>"
            f"<td>{escape(framework_status_label(lang, current.status))}</td>"
            f"<td>{escape(_source_status_label(lang, src))}</td>"
            f"<td>{req_count}</td>"
            f"<td>{q_count}</td>"
            f"<td>{escape(str(cov))}</td>"
            f"<td>{clients}</td>"
            f"<td><details class='row-menu'><summary>⋯</summary>"
            f"<a href='{href}'>Apri</a>"
            f"<a href='/api/kb/export?version_id={escape(current.id)}&{nav_qs}'>Esporta</a>"
            f"</details></td>"
            "</tr>"
        )
    table = f"""<table class="data-table"><thead><tr>
<th>Nome</th><th>Tipo</th><th>Publisher</th><th>Versione</th><th>Stato</th>
<th>{escape(t(lang, 'fwkb.source_status'))}</th><th>Requisiti</th><th>{escape(t(lang, 'fwkb.questions'))}</th>
<th>Copertura</th><th>Utilizzato da</th><th>Azioni</th>
</tr></thead><tbody>{''.join(rows)}</tbody></table>"""
    body = (
        page_header(
            eyebrow=t(lang, "nav.section.knowledge"),
            title=t(lang, "fwkb.title"),
            subtitle=t(lang, "fwkb.meta"),
            actions_html=actions,
        )
        + f'<div class="panel">{table_wrap(table)}</div>'
    )
    return render_shell(
        f"{t(lang, 'fwkb.title')} — WayFold Compliance",
        nav_qs,
        body,
        lang=lang,
        active_path="/frameworks",
        breadcrumb=t(lang, "fwkb.title"),
    )


def _source_status_label(lang: str, status: str) -> str:
    key = {
        "SOURCE_UNVERIFIED": "Fonte da verificare",
        "LEGACY_IMPORTED": "Fonte legacy",
        "SOURCE_PARTIAL": "Fonte parziale",
        "OFFICIAL": "Fonte ufficiale",
        "NO_SOURCE_DATA": "Nessun dato",
    }.get((status or "").upper(), status or "—")
    return key


def framework_detail_page(
    versions: list[Any],
    *,
    selected_id: str | None,
    nav_qs: str,
    usage_clients: list[str] | None = None,
    tab: str = "overview",
    meta: Any | None = None,
    mappings: list[Any] | None = None,
    coverage: dict[str, Any] | None = None,
    page: int = 1,
    page_size: int = 50,
    q: str = "",
    type_filter: str = "",
    section_filter: str = "",
    mapping_filter: str = "",
    leaf_only: bool = False,
    unmapped_only: bool = False,
) -> str:
    lang = _lang(nav_qs)
    nav_qs = with_lang(nav_qs, lang)
    if not versions:
        return frameworks_page([], {}, nav_qs)
    selected = next((v for v in versions if v.id == selected_id), versions[0])
    tab = tab or "overview"
    page = max(1, int(page or 1))
    page_size = page_size if page_size in (25, 50, 100) else 50
    base = f"/frameworks/detail?framework_id={escape(selected.framework_id)}&version_id={escape(selected.id)}&{nav_qs}"
    tabs = [
        ("overview", "Panoramica"),
        ("versions", "Versioni"),
        ("requirements", "Requisiti"),
        ("questions", "Domande di assessment"),
        ("mappings", "Mappature"),
        ("sources", "Fonti"),
        ("usage", "Utilizzo"),
    ]
    tabs_html = (
        '<div class="tabs">'
        + "".join(
            f"<a class='{'active' if tab == key else ''}' href='{base}&tab={key}'>{escape(label)}</a>"
            for key, label in tabs
        )
        + "</div>"
    )
    is_draft = selected.status == "DRAFT"
    cov = coverage or {}
    mapped_n = int(cov.get("mapped") or 0)
    unmapped_n = int(cov.get("unmapped") or 0)
    src_label = _source_status_label(lang, getattr(selected, "source_status", "") or "SOURCE_UNVERIFIED")
    actions = (
        f"<a class='btn' href='/frameworks/versions/new?framework_id={escape(selected.framework_id)}&{nav_qs}'>Nuova versione</a>"
        f"<details class='row-menu btn-like'><summary>Esporta ▾</summary>"
        f"<a href='/api/kb/export?version_id={escape(selected.id)}'>JSON framework</a></details>"
    )
    if is_draft:
        actions = (
            f"<a class='btn' href='/frameworks/requirements/new?version_id={escape(selected.id)}&{nav_qs}'>+ Nuovo requisito</a>"
            + actions
            + f"<a class='btn primary' href='/frameworks/publish?version_id={escape(selected.id)}&{nav_qs}'>Pubblica</a>"
        )

    summary = f"""
<div class="summary-row">
  <span><label>Versione</label> <code>{escape(selected.version)}</code></span>
  <span><label>Stato</label> {escape(framework_status_label(lang, selected.status))}</span>
  <span><label>Requisiti</label> {len(selected.requirements)}</span>
  <span><label>Mappati</label> {mapped_n}</span>
  <span><label>Non mappati</label> {unmapped_n}</span>
  <span><label>Source</label> {escape(src_label)}</span>
</div>
"""

    ver_rows = "".join(
        "<tr>"
        f"<td><a href='/frameworks/detail?framework_id={escape(selected.framework_id)}"
        f"&version_id={escape(v.id)}&tab=versions&{nav_qs}'><code>{escape(v.version)}</code></a></td>"
        f"<td>{escape(framework_status_label(lang, v.status))}</td>"
        f"<td>{len(v.requirements)}</td>"
        f"<td>{escape(format_display_datetime(v.published_at or v.created_at, lang=lang))}</td>"
        "</tr>"
        for v in versions
    )

    mapped_codes = {
        getattr(m, "requirement_code", "")
        for m in (mappings or [])
        if getattr(m, "review_status", "") == "APPROVED"
        or str(getattr(getattr(m, "review_status", None), "value", getattr(m, "review_status", "")))
        == "APPROVED"
    }
    reqs = list(selected.requirements)
    qn = (q or "").strip().lower()
    if qn:
        reqs = [
            r
            for r in reqs
            if qn in (r.code or "").lower()
            or qn in (r.title or "").lower()
            or qn in (r.description or "").lower()
        ]
    if type_filter:
        reqs = [r for r in reqs if (getattr(r, "req_type", "") or "").upper() == type_filter.upper()]
    if section_filter:
        reqs = [r for r in reqs if (r.section or "") == section_filter]
    if leaf_only:
        reqs = [r for r in reqs if getattr(r, "is_leaf", True)]
    if unmapped_only or mapping_filter.upper() == "UNMAPPED":
        reqs = [r for r in reqs if r.code not in mapped_codes]
    elif mapping_filter.upper() == "MAPPED":
        reqs = [r for r in reqs if r.code in mapped_codes]

    total = len(reqs)
    pages = max(1, (total + page_size - 1) // page_size)
    page = min(page, pages)
    start = (page - 1) * page_size
    page_reqs = sorted(reqs, key=lambda x: (x.order, x.code))[start : start + page_size]
    id_to_code = {r.id: r.code for r in selected.requirements}

    req_rows = []
    for r in page_reqs:
        parent = getattr(r, "parent_id", None)
        parent_code = id_to_code.get(parent, "") if parent else ""
        map_state = "Mappato" if r.code in mapped_codes else "Non mappato"
        detail_href = f"/frameworks/requirement?version_id={escape(selected.id)}&req_id={escape(r.id)}&{nav_qs}"
        req_rows.append(
            "<tr>"
            f"<td><a href='{detail_href}'><code>{escape(r.code)}</code></a></td>"
            f"<td><a href='{detail_href}'>{escape(r.title)}</a></td>"
            f"<td>{escape(getattr(r, 'req_type', '') or '—')}</td>"
            f"<td>{escape(r.section or '—')}</td>"
            f"<td>{escape(parent_code or '—')}</td>"
            f"<td>{escape(map_state)}</td>"
            f"<td>{escape(_source_status_label(lang, getattr(r, 'source_status', '') or ''))}</td>"
            f"<td><details class='row-menu'><summary>⋯</summary>"
            f"<a href='{detail_href}'>Dettaglio</a></details></td>"
            "</tr>"
        )

    filter_form = f"""
<form class="filters compact" method="get" action="/frameworks/detail">
  <input type="hidden" name="framework_id" value="{escape(selected.framework_id)}">
  <input type="hidden" name="version_id" value="{escape(selected.id)}">
  <input type="hidden" name="tab" value="requirements">
  <input type="search" name="q" value="{escape(q)}" placeholder="Cerca codice, titolo, descrizione">
  <input name="type" value="{escape(type_filter)}" placeholder="Tipo">
  <input name="section" value="{escape(section_filter)}" placeholder="Sezione">
  <select name="mapping"><option value="">Mapping</option>
    <option value="MAPPED" {'selected' if mapping_filter.upper()=='MAPPED' else ''}>Mappati</option>
    <option value="UNMAPPED" {'selected' if mapping_filter.upper()=='UNMAPPED' else ''}>Non mappati</option>
  </select>
  <label><input type="checkbox" name="leaf_only" value="1" {'checked' if leaf_only else ''}> Solo leaf</label>
  <label><input type="checkbox" name="unmapped_only" value="1" {'checked' if unmapped_only else ''}> Solo non mappati</label>
  <select name="page_size">
    {''.join(f"<option value='{n}' {'selected' if page_size==n else ''}>{n}</option>" for n in (25,50,100))}
  </select>
  <button class="btn sm" type="submit">Filtra</button>
</form>
"""
    pager = f"""
<div class="pager meta">
  {total} requisiti · pagina {page}/{pages}
  {" · <a href='" + base + f"&tab=requirements&page={page-1}&page_size={page_size}&q={escape(q)}'>← Prec</a>" if page > 1 else ""}
  {" · <a href='" + base + f"&tab=requirements&page={page+1}&page_size={page_size}&q={escape(q)}'>Succ →</a>" if page < pages else ""}
</div>
"""

    questions = list(getattr(selected, "assessment_questions", None) or [])
    q_total = len(questions)
    q_pages = max(1, (q_total + page_size - 1) // page_size)
    q_page = min(page, q_pages) if tab == "questions" else page
    q_start = (q_page - 1) * page_size
    page_questions = questions[q_start : q_start + page_size]
    q_rows = []
    for aq in page_questions:
        sm = getattr(aq, "service_model", {}) or {}
        ql = getattr(aq, "qualification_levels", {}) or {}
        badges = " ".join(
            f"<span class='badge'>{k}</span>" for k, v in sm.items() if v
        ) or "—"
        levels = " ".join(
            f"<span class='badge'>{k}</span>" for k, v in ql.items() if v
        ) or "—"
        q_rows.append(
            "<tr>"
            f"<td><code>{escape(getattr(aq, 'source_code', '') or '')}</code></td>"
            f"<td>{escape(getattr(aq, 'question', '') or '')}</td>"
            f"<td><code>{escape(getattr(aq, 'requirement_id', '') or '')}</code></td>"
            f"<td>{badges}</td><td>{levels}</td>"
            f"<td>{escape(getattr(aq, 'answer_options', '') or '—')}</td>"
            "</tr>"
        )
    q_pager = f"""
<div class="pager meta">
  {q_total} domande · pagina {q_page}/{q_pages}
  {" · <a href='" + base + f"&tab=questions&page={q_page-1}&page_size={page_size}'>← Prec</a>" if q_page > 1 else ""}
  {" · <a href='" + base + f"&tab=questions&page={q_page+1}&page_size={page_size}'>Succ →</a>" if q_page < q_pages else ""}
</div>
"""

    clients = "".join(f"<li>{escape(c)}</li>" for c in (usage_clients or [])) or (
        f"<li>{escape(t(lang, 'client.none'))}</li>"
    )
    map_rows = "".join(
        "<tr>"
        f"<td><code>{escape(m.requirement_code)}</code></td>"
        f"<td><code>{escape(m.canonical_control_ref)}</code></td>"
        f"<td>{mapping_badge(lang, m.relation.value if hasattr(m.relation, 'value') else m.relation)}</td>"
        f"<td>{escape(m.uncovered_delta or '—')}</td>"
        f"<td>{escape(review_label(lang, m.review_status))}</td>"
        "</tr>"
        for m in (mappings or [])
        if m.framework_version == selected.version
    )
    overview = f"""
<div class="panel" style="padding:16px">
  <div class="detail-grid">
    <div class="field"><label>Publisher</label><div class="field-value">{escape(selected.publisher or '—')}</div></div>
    <div class="field"><label>Tipo</label><div class="field-value">{escape(getattr(meta, 'type', 'Framework') if meta else 'Framework')}</div></div>
    <div class="field"><label>Source</label><div class="field-value">{escape(src_label)}</div></div>
    <div class="field"><label>Domande</label><div class="field-value">{len(questions)}</div></div>
  </div>
  <p class="meta" style="margin-top:12px">{escape(getattr(meta, 'description', '') or '')}</p>
</div>
"""
    panels = {
        "overview": overview.replace('<div class="panel" style="padding:16px">', "<div>", 1),
        "versions": table_wrap(
            f"<table class='data-table'><thead><tr><th>Versione</th><th>Stato</th><th>Requirement</th><th>Data</th></tr></thead><tbody>{ver_rows}</tbody></table>"
        ),
        "requirements": filter_form
        + pager
        + table_wrap(
            f"<table class='data-table'><thead><tr>"
            f"<th>Codice</th><th>Titolo</th><th>Tipo</th><th>Sezione</th><th>Parent</th>"
            f"<th>Mapping</th><th>Source status</th><th>Azioni</th>"
            f"</tr></thead><tbody>{''.join(req_rows) or '<tr><td colspan=8>Nessun requisito</td></tr>'}</tbody></table>"
        ),
        "questions": q_pager
        + table_wrap(
            f"<table class='data-table'><thead><tr>"
            f"<th>Codice sorgente</th><th>Domanda</th><th>Requirement</th>"
            f"<th>Service model</th><th>Qualification</th><th>Opzioni</th>"
            f"</tr></thead><tbody>{''.join(q_rows) or '<tr><td colspan=6>Nessuna domanda</td></tr>'}</tbody></table>"
        ),
        "mappings": (
            f"<p><a class='btn sm primary' href='/mappings/new?framework_id={escape(selected.framework_id)}"
            f"&version_id={escape(selected.id)}&{nav_qs}'>{escape(t(lang,'map.new'))}</a></p>"
            + table_wrap(
                f"<table class='data-table'><thead><tr><th>Requisito</th><th>Controllo</th>"
                f"<th>Relazione</th><th>Delta</th><th>Stato</th></tr></thead>"
                f"<tbody>{map_rows or '<tr><td colspan=5>—</td></tr>'}</tbody></table>"
            )
        ),
        "sources": (
            f"<p class='meta'>Provenienza: Matrice MultiCompliance · "
            f"URL ufficiale: {escape(getattr(meta, 'official_url', '') or selected.source_url or '—')}</p>"
            f"<p><a class='btn sm' href='/changes?{nav_qs}'>Apri Intelligence normativa</a></p>"
        ),
        "usage": f"<ul class='compact'>{clients}</ul>",
    }
    body = (
        page_header(
            eyebrow=t(lang, "fwkb.title"),
            title=selected.framework_name,
            subtitle="",
            actions_html=actions,
        )
        + summary
        + tabs_html
        + f"<div class='panel' style='padding:16px'>{panels.get(tab, overview)}</div>"
    )
    return render_shell(
        f"{selected.framework_name} — WayFold Compliance",
        nav_qs,
        body,
        lang=lang,
        active_path="/frameworks",
        breadcrumb=selected.framework_name,
    )


def mappings_page(
    mappings: list[Any],
    unmapped: list[Any],
    nav_qs: str,
    *,
    filters: dict[str, str] | None = None,
) -> str:
    lang = _lang(nav_qs)
    nav_qs = with_lang(nav_qs, lang)
    filters = filters or {}
    tab = (filters.get("tab") or "approved").lower()
    if tab not in {"approved", "review", "unmapped"}:
        tab = "approved"
    page = max(1, int(filters.get("page") or 1))
    page_size = int(filters.get("page_size") or 50)
    if page_size not in (25, 50, 100):
        page_size = 50

    approved = []
    review = []
    for m in mappings:
        rev = m.review_status.value if hasattr(m.review_status, "value") else m.review_status
        rev_u = str(rev or "").upper()
        if rev_u == "APPROVED":
            approved.append(m)
        else:
            review.append(m)

    def _map_rows(items: list[Any]) -> list[str]:
        out = []
        for m in items:
            rel = m.relation.value if hasattr(m.relation, "value") else m.relation
            rev = m.review_status.value if hasattr(m.review_status, "value") else m.review_status
            out.append(
                "<tr>"
                f"<td><code>{escape(m.requirement_code)}</code></td>"
                f"<td>{escape(m.framework_name)} <code>{escape(m.framework_version)}</code></td>"
                f"<td><code>{escape(m.canonical_control_ref)}</code></td>"
                f"<td>{mapping_badge(lang, rel)}</td>"
                f"<td>{escape(m.uncovered_delta or '—')}</td>"
                f"<td>{escape(review_label(lang, rev))}</td>"
                f"<td><details class='row-menu'><summary>⋯</summary>"
                f"<a href='/mappings/new?requirement_id={escape(m.requirement_id)}&{nav_qs}'>Modifica</a>"
                f"</details></td>"
                "</tr>"
            )
        return out

    if tab == "approved":
        dataset = approved
    elif tab == "review":
        dataset = review
    else:
        dataset = list(unmapped)

    total = len(dataset)
    pages = max(1, (total + page_size - 1) // page_size)
    page = min(page, pages)
    start = (page - 1) * page_size
    slice_rows = dataset[start : start + page_size]

    if tab == "unmapped":
        rows_html = "".join(
            "<tr>"
            f"<td><code>{escape(u.code)}</code></td>"
            f"<td>{escape(u.framework_name)} <code>{escape(u.framework_version)}</code></td>"
            f"<td>{escape(u.title)}</td>"
            f"<td><details class='row-menu'><summary>⋯</summary>"
            f"<a href='/mappings/new?requirement_id={escape(u.id)}&{nav_qs}'>{escape(t(lang, 'map.associate'))}</a>"
            f"<a href='/controls/new?from_requirement={escape(u.id)}&title={escape(u.title)}&{nav_qs}'>{escape(t(lang, 'map.create_control'))}</a>"
            f"</details></td>"
            "</tr>"
            for u in slice_rows
        )
        table = f"""<table class="data-table"><thead><tr>
<th>{escape(t(lang,'col.requirement'))}</th><th>{escape(t(lang,'col.framework'))}</th>
<th>{escape(t(lang,'col.title'))}</th><th>Azioni</th></tr></thead>
<tbody>{rows_html or f"<tr><td colspan='4'>{escape(t(lang,'map.unmapped_empty'))}</td></tr>"}</tbody></table>"""
    else:
        rows_html = "".join(_map_rows(slice_rows))
        table = f"""<table class="data-table"><thead><tr>
<th>{escape(t(lang,'col.requirement'))}</th>
<th>{escape(t(lang,'col.framework'))}</th>
<th>{escape(t(lang,'col.control'))}</th>
<th>{escape(t(lang,'col.mapping'))}</th>
<th>{escape(t(lang,'col.delta'))}</th>
<th>{escape(t(lang,'col.status'))}</th>
<th>Azioni</th>
</tr></thead><tbody>{rows_html or f"<tr><td colspan='7'>{escape(t(lang,'map.empty'))}</td></tr>"}</tbody></table>"""

    base_q = f"/mappings?lang={escape(lang)}"
    if filters.get("program_id"):
        base_q += f"&program_id={escape(filters['program_id'])}"
    tabs = (
        f"<div class='tabs'>"
        f"<a class='{'active' if tab=='approved' else ''}' href='{base_q}&tab=approved'>Approvate ({len(approved)})</a>"
        f"<a class='{'active' if tab=='review' else ''}' href='{base_q}&tab=review'>Da revisionare ({len(review)})</a>"
        f"<a class='{'active' if tab=='unmapped' else ''}' href='{base_q}&tab=unmapped'>Non mappati ({len(unmapped)})</a>"
        f"</div>"
    )
    pager = f"""
<div class="pager meta">
  {total} elementi · pagina {page}/{pages}
  {" · <a href='" + base_q + f"&tab={tab}&page={page-1}&page_size={page_size}'>← Prec</a>" if page > 1 else ""}
  {" · <a href='" + base_q + f"&tab={tab}&page={page+1}&page_size={page_size}'>Succ →</a>" if page < pages else ""}
</div>
"""
    body = (
        page_header(
            eyebrow=t(lang, "nav.section.knowledge"),
            title=t(lang, "map.title"),
            subtitle="Solo le mappature Approvate contribuiscono alla readiness.",
            actions_html=f"<a class='btn primary' href='/mappings/new?{nav_qs}'>{escape(t(lang, 'map.new'))}</a>",
        )
        + tabs
        + pager
        + f'<div class="panel">{table_wrap(table)}</div>'
    )
    return render_shell(
        f"{t(lang, 'map.title')} — WayFold Compliance",
        nav_qs,
        body,
        lang=lang,
        active_path="/mappings",
        breadcrumb=t(lang, "map.title"),
    )


def audit_page(events: list[Any], nav_qs: str, *, filters: dict[str, str] | None = None) -> str:
    lang = _lang(nav_qs)
    nav_qs = with_lang(nav_qs, lang)
    filters = filters or {}
    rows = []
    for ev in events:
        detail = (ev.detail or "").strip()
        # Avoid dumping raw JSON blobs in the main table
        if detail.startswith("{") or detail.startswith("["):
            detail = "Dettaglio tecnico disponibile in export"
        elif ev.old_value or ev.new_value:
            detail = detail or "Modifica registrata"
        rows.append(
            "<tr>"
            f"<td>{escape(format_display_datetime(ev.timestamp, lang=lang))}</td>"
            f"<td>{escape(ev.actor_user_id)}</td>"
            f"<td><code>{escape(ev.action)}</code></td>"
            f"<td>{escape(ev.entity_type)} <code>{escape(ev.entity_id)}</code></td>"
            f"<td>{escape(ev.tenant_id or '—')}</td>"
            f"<td class='client-meta'>{escape(detail) if detail else '—'}</td>"
            "</tr>"
        )
    form = f"""
<form class="filter-bar" method="get" action="/audit">
  <input type="hidden" name="lang" value="{escape(lang)}">
  <label>Cliente <input name="tenant_id" value="{escape(filters.get('tenant_id',''))}"></label>
  <label>Utente <input name="actor" value="{escape(filters.get('actor',''))}"></label>
  <label>Azione <input name="action" value="{escape(filters.get('action',''))}"></label>
  <label>Da <input name="date_from" type="date" value="{escape(filters.get('date_from',''))}"></label>
  <label>A <input name="date_to" type="date" value="{escape(filters.get('date_to',''))}"></label>
  <button class="btn primary sm" type="submit">{escape(t(lang, 'gaps.filter'))}</button>
</form>
"""
    table = f"""<table class="data-table"><thead><tr>
<th>Data</th><th>Utente</th><th>Azione</th><th>Entità</th><th>Client</th><th>Dettaglio</th>
</tr></thead><tbody>{''.join(rows) or f"<tr><td colspan='6'>{escape(t(lang,'audit.empty'))}</td></tr>"}</tbody></table>"""
    body = (
        page_header(
            eyebrow=t(lang, "nav.section.admin"),
            title=t(lang, "audit.title"),
            subtitle=t(lang, "audit.meta"),
        )
        + form
        + f'<div class="panel">{table_wrap(table)}</div>'
    )
    return render_shell(
        f"{t(lang, 'audit.title')} — WayFold Compliance",
        nav_qs,
        body,
        lang=lang,
        active_path="/audit",
        breadcrumb=t(lang, "audit.title"),
    )


def clients_page(
    rows: list[Any],
    assignments: dict[str, list[str]],
    nav_qs: str,
    *,
    q: str = "",
    status: str = "",
    framework: str = "",
) -> str:
    lang = _lang(nav_qs)
    nav_qs = with_lang(nav_qs, lang)
    tenant_consultants: dict[str, list[str]] = {}
    for user, tenants in assignments.items():
        for tid in tenants:
            tenant_consultants.setdefault(tid, []).append(user)

    filtered = list(rows)
    if q:
        needle = q.lower()
        filtered = [
            r
            for r in filtered
            if needle in r.tenant_name.lower() or needle in r.program_name.lower()
        ]
    if status:
        filtered = [
            r
            for r in filtered
            if (getattr(r, "program_status", "ACTIVE") or "ACTIVE").upper() == status.upper()
        ]
    if framework:
        filtered = [r for r in filtered if any(framework.lower() in f.lower() for f in r.frameworks)]

    body_rows = []
    for r in filtered:
        consultants = ", ".join(tenant_consultants.get(r.tenant_id, [])) or "—"
        qs = urlencode(
            {
                **dict(parse_qsl(nav_qs)),
                "program_id": r.program_id,
                "tenant_name": r.tenant_name,
                "program_name": r.program_name,
            }
        )
        href = f"/client?{qs}"
        st = getattr(r, "program_status", "ACTIVE") or "ACTIVE"
        st_label = t(lang, "status.active") if st == "ACTIVE" else st
        body_rows.append(
            "<tr>"
            f"<td><a href='{href}'><strong>{escape(r.tenant_name)}</strong></a></td>"
            f"<td>{escape(r.program_name)}</td>"
            f"<td>{escape(', '.join(r.frameworks))}</td>"
            f"<td>{escape(consultants)}</td>"
            f"<td>{escape(st_label)}</td>"
            f"<td><a class='btn sm primary' href='{href}'>{escape(t(lang,'action.open'))}</a></td>"
            "</tr>"
        )
    filter_bar = f"""
<form class="filters" method="get" action="/clients">
  <input type="hidden" name="lang" value="{escape(lang)}">
  <label>Ricerca <input name="q" value="{escape(q)}" placeholder="Cliente o programma"></label>
  <label>Stato
    <select name="status">
      <option value="">—</option>
      <option value="ACTIVE" {"selected" if status=="ACTIVE" else ""}>Attivo</option>
      <option value="DRAFT" {"selected" if status=="DRAFT" else ""}>Bozza</option>
    </select>
  </label>
  <label>Framework <input name="framework" value="{escape(framework)}"></label>
  <button class="btn primary sm" type="submit">Filtra</button>
</form>
"""
    if not rows:
        body = (
            page_header(
                eyebrow=t(lang, "nav.section.workspace"),
                title=t(lang, "clients.title"),
                subtitle="",
                actions_html=(
                    f"<a class='btn primary' href='/clients/new?{nav_qs}'>{escape(t(lang, 'clients.new'))}</a>"
                ),
            )
            + empty_state(
                title=t(lang, "clients.empty_title"),
                body=t(lang, "clients.empty_body"),
                icon_name="building",
                action_html=(
                    f"<a class='btn primary' href='/clients/new?{nav_qs}'>{escape(t(lang, 'clients.new'))}</a>"
                    f"<a class='btn' href='/frameworks?{nav_qs}'>{escape(t(lang, 'empty.open_frameworks'))}</a>"
                ),
            )
        )
    elif not filtered:
        body = (
            page_header(
                eyebrow=t(lang, "nav.section.workspace"),
                title=t(lang, "clients.title"),
                subtitle=t(lang, "clients.meta"),
                actions_html=(
                    f"<a class='btn primary' href='/clients/new?{nav_qs}'>{escape(t(lang, 'clients.new'))}</a>"
                    f"<a class='btn' href='/programs/new?{nav_qs}'>{escape(t(lang, 'program.new'))}</a>"
                ),
            )
            + filter_bar
            + empty_state(
                title="Nessun risultato",
                body="Nessun cliente corrisponde ai filtri selezionati.",
                icon_name="search",
                action_html=f"<a class='btn' href='/clients?{nav_qs}'>Azzera filtri</a>",
            )
        )
    else:
        table = f"""<table class="data-table"><thead><tr>
<th>{escape(t(lang,'col.client'))}</th>
<th>{escape(t(lang,'col.program'))}</th>
<th>{escape(t(lang,'col.framework'))}</th>
<th>{escape(t(lang,'clients.consultant'))}</th>
<th>{escape(t(lang,'col.status'))}</th>
<th></th>
</tr></thead><tbody>{''.join(body_rows)}</tbody></table>"""
        body = (
            page_header(
                eyebrow=t(lang, "nav.section.workspace"),
                title=t(lang, "clients.title"),
                subtitle=t(lang, "clients.meta"),
                actions_html=(
                    f"<a class='btn primary' href='/clients/new?{nav_qs}'>{escape(t(lang, 'clients.new'))}</a>"
                    f"<a class='btn' href='/programs/new?{nav_qs}'>{escape(t(lang, 'program.new'))}</a>"
                ),
            )
            + filter_bar
            + f'<div class="panel">{table_wrap(table)}</div>'
        )
    return render_shell(
        f"{t(lang, 'clients.title')} — WayFold Compliance",
        nav_qs,
        body,
        lang=lang,
        active_path="/clients",
        breadcrumb=t(lang, "clients.title"),
    )


def settings_page(
    *,
    nav_qs: str,
    ai_settings: Any | None = None,
    users: list[Any] | None = None,
    assignments: dict[str, list[str]] | None = None,
    mfa_status: dict[str, Any] | None = None,
) -> str:
    lang = _lang(nav_qs)
    nav_qs = with_lang(nav_qs, lang)
    ai_block = ""
    if ai_settings is not None:
        enabled = bool(getattr(ai_settings, "ai_processing_enabled", False))
        ai_block = f"""
<section class="panel" style="margin-bottom:14px">
  <h2>{escape(t(lang, 'settings.ai'))}</h2>
  <p><strong>{escape(t(lang, 'settings.ai_status'))}:</strong>
  {"Abilitata" if enabled else "Disabilitata"}</p>
  <p class="client-meta">{escape(t(lang, 'settings.ai_note'))}</p>
  <p><a class="btn sm" href="/ai/settings?tenant_id={escape(getattr(ai_settings,'tenant_id',''))}&{nav_qs}">
  {escape(t(lang, 'action.open'))}</a></p>
</section>
"""
    user_rows = "".join(
        "<tr>"
        f"<td>{escape(u.username)}</td>"
        f"<td>{escape(t(lang, f'role.{u.role}') if t(lang, f'role.{u.role}') != f'role.{u.role}' else u.role)}</td>"
        f"<td>{escape(', '.join(u.tenant_ids) or '—')}</td>"
        f"<td>{'Sì' if u.mfa_enabled else 'No'}</td>"
        "</tr>"
        for u in (users or [])
    )
    assign_rows = "".join(
        f"<tr><td>{escape(u)}</td><td>{escape(', '.join(tids) or '—')}</td></tr>"
        for u, tids in sorted((assignments or {}).items())
    )
    mfa = mfa_status or {}
    body = f"""
{page_header(
    eyebrow=t(lang, 'nav.section.admin'),
    title=t(lang, 'settings.title'),
    subtitle=t(lang, 'settings.meta'),
)}
<div class="panel" style="margin-bottom:14px">
  <div class="panel-head"><div class="panel-title">{escape(t(lang, 'settings.general'))}</div></div>
  <div class="panel-body"><p class="meta">{escape(t(lang, 'settings.session_note'))}</p></div>
</div>
<div class="panel" style="margin-bottom:14px">
  <div class="panel-head"><div class="panel-title">{escape(t(lang, 'settings.users'))}</div></div>
  {table_wrap(f"<table class='data-table'><thead><tr><th>Utente</th><th>Ruolo</th><th>Tenant</th><th>MFA</th></tr></thead><tbody>{user_rows or '<tr><td colspan=4>—</td></tr>'}</tbody></table>")}
</div>
<div class="panel" style="margin-bottom:14px">
  <div class="panel-head"><div class="panel-title">{escape(t(lang, 'settings.assignments'))}</div></div>
  {table_wrap(f"<table class='data-table'><thead><tr><th>Consulente</th><th>Clienti</th></tr></thead><tbody>{assign_rows or '<tr><td colspan=2>—</td></tr>'}</tbody></table>")}
</div>
<div class="panel" style="margin-bottom:14px">
  <div class="panel-head"><div class="panel-title">{escape(t(lang, 'settings.evidence'))}</div></div>
  <div class="panel-body"><p class="meta">{escape(t(lang, 'settings.evidence_note'))}</p></div>
</div>
{ai_block}
<div class="panel">
  <div class="panel-head"><div class="panel-title">{escape(t(lang, 'settings.security'))}</div></div>
  <div class="panel-body">
    <p class="meta">{escape(t(lang, 'settings.security_note'))}</p>
    <p class="meta">MFA directory utenti: {"disponibile" if mfa.get("supported") else "configurabile dal profilo"}</p>
  </div>
</div>
"""
    return render_shell(
        f"{t(lang, 'settings.title')} — WayFold Compliance",
        nav_qs,
        body,
        lang=lang,
        active_path="/settings",
        breadcrumb=t(lang, "settings.title"),
    )


def gap_taxonomy_label(code: str) -> str:
    return GAP_TAXONOMY_IT.get(code, code)

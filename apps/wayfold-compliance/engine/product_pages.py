"""Product completion pages: Frameworks KB, Mappings, Audit, Clients, Settings."""

from __future__ import annotations

from html import escape
from typing import Any
from urllib.parse import parse_qsl, urlencode

from engine.gap_assessment import GAP_TAXONOMY_IT
from engine.i18n import DEFAULT_LANG, normalize_lang, t, with_lang
from engine.ui_components import empty_state, mapping_badge, page_header, status_badge
from engine.ui_shell import render_shell, table_wrap


def _lang(nav_qs: str) -> str:
    return normalize_lang(dict(parse_qsl(nav_qs)).get("lang", DEFAULT_LANG))


def frameworks_page(versions: list[Any], usage: dict[str, int], nav_qs: str) -> str:
    lang = _lang(nav_qs)
    nav_qs = with_lang(nav_qs, lang)
    if not versions:
        body = page_header(
            eyebrow=t(lang, "nav.section.knowledge"),
            title=t(lang, "fwkb.title"),
            subtitle=t(lang, "fwkb.meta"),
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

    # Group by framework
    groups: dict[str, list[Any]] = {}
    for v in versions:
        groups.setdefault(v.framework_id, []).append(v)

    rows = []
    for fw_id, vers in sorted(groups.items(), key=lambda x: x[1][0].framework_name):
        current = next((x for x in vers if x.status == "PUBLISHED"), vers[0])
        req_count = len(current.requirements)
        clients = usage.get(fw_id, 0)
        href = f"/frameworks/detail?framework_id={escape(fw_id)}&{nav_qs}"
        rows.append(
            "<tr>"
            f"<td><a href='{href}'><strong>{escape(current.framework_name)}</strong></a>"
            f"<div class='client-meta'>{escape(current.publisher)}</div></td>"
            f"<td><code>{escape(current.version)}</code></td>"
            f"<td>{escape(current.status)}</td>"
            f"<td>{req_count}</td>"
            f"<td>{clients}</td>"
            f"<td><a class='btn sm' href='{href}'>{escape(t(lang, 'action.open'))}</a></td>"
            "</tr>"
        )
    table = f"""<table class="data-table"><thead><tr>
<th>{escape(t(lang, 'col.framework'))}</th>
<th>{escape(t(lang, 'col.version'))}</th>
<th>{escape(t(lang, 'col.status'))}</th>
<th>{escape(t(lang, 'col.requirements'))}</th>
<th>{escape(t(lang, 'fwkb.clients_using'))}</th>
<th></th>
</tr></thead><tbody>{''.join(rows)}</tbody></table>"""
    body = (
        page_header(
            eyebrow=t(lang, "nav.section.knowledge"),
            title=t(lang, "fwkb.title"),
            subtitle=t(lang, "fwkb.meta"),
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


def framework_detail_page(
    versions: list[Any],
    *,
    selected_id: str | None,
    nav_qs: str,
    usage_clients: list[str] | None = None,
) -> str:
    lang = _lang(nav_qs)
    nav_qs = with_lang(nav_qs, lang)
    if not versions:
        return frameworks_page([], {}, nav_qs)
    selected = next((v for v in versions if v.id == selected_id), versions[0])
    ver_rows = "".join(
        "<tr>"
        f"<td><a href='/frameworks/detail?framework_id={escape(selected.framework_id)}"
        f"&version_id={escape(v.id)}&{nav_qs}'><code>{escape(v.version)}</code></a></td>"
        f"<td>{escape(v.status)}</td>"
        f"<td>{len(v.requirements)}</td>"
        f"<td>{escape(v.published_at or v.created_at or '—')}</td>"
        "</tr>"
        for v in versions
    )
    # Hierarchy by indent from parent path
    req_rows = []
    for r in sorted(selected.requirements, key=lambda x: (x.order, x.code)):
        depth = r.code.count(".")
        pad = "&nbsp;" * (depth * 4)
        req_rows.append(
            "<tr>"
            f"<td>{pad}<code>{escape(r.code)}</code></td>"
            f"<td>{escape(r.title)}</td>"
            f"<td>{escape(r.section or '—')}</td>"
            f"<td>{escape(selected.publisher)}</td>"
            f"<td>{escape(r.source_url or selected.source_url or '—')}</td>"
            "</tr>"
        )
    clients = "".join(f"<li>{escape(c)}</li>" for c in (usage_clients or [])) or (
        f"<li>{escape(t(lang, 'client.none'))}</li>"
    )
    body = f"""
{page_header(
    eyebrow=t(lang, 'fwkb.title'),
    title=selected.framework_name,
    subtitle=f"{selected.publisher} · {t(lang, 'col.version')} {selected.version} · {selected.status}",
)}
<div class="panel tabs-local">
  <h2>{escape(t(lang, 'fwkb.versions'))}</h2>
  {table_wrap(f"<table class='data-table'><thead><tr><th>{escape(t(lang,'col.version'))}</th><th>{escape(t(lang,'col.status'))}</th><th>{escape(t(lang,'col.requirements'))}</th><th>{escape(t(lang,'col.detected'))}</th></tr></thead><tbody>{ver_rows}</tbody></table>")}
</div>
<div class="panel" style="margin-top:14px">
  <h2>{escape(t(lang, 'fwkb.requirements'))}</h2>
  {table_wrap(f"<table class='data-table'><thead><tr><th>{escape(t(lang,'col.requirement'))}</th><th>{escape(t(lang,'col.title'))}</th><th>Section</th><th>Publisher</th><th>Source</th></tr></thead><tbody>{''.join(req_rows) or '<tr><td colspan=5>—</td></tr>'}</tbody></table>")}
</div>
<div class="panel" style="margin-top:14px">
  <h2>{escape(t(lang, 'fwkb.usage'))}</h2>
  <ul class="compact">{clients}</ul>
</div>
"""
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
    rows = []
    for m in mappings:
        rel = m.relation.value if hasattr(m.relation, "value") else m.relation
        rev = m.review_status.value if hasattr(m.review_status, "value") else m.review_status
        tip = f'title="{escape(rel)}"'
        rows.append(
            "<tr>"
            f"<td><code>{escape(m.requirement_code)}</code></td>"
            f"<td>{escape(m.framework_name)} <code>{escape(m.framework_version)}</code></td>"
            f"<td><code>{escape(m.canonical_control_ref)}</code></td>"
            f"<td {tip}>{mapping_badge(lang, rel)}</td>"
            f"<td>{escape(m.uncovered_delta or '—')}</td>"
            f"<td>{escape(m.rationale or '—')}</td>"
            f"<td>{escape(str(rev))}</td>"
            "</tr>"
        )
    unmapped_rows = "".join(
        "<tr>"
        f"<td><code>{escape(u.code)}</code></td>"
        f"<td>{escape(u.framework_name)} <code>{escape(u.framework_version)}</code></td>"
        f"<td>{escape(u.title)}</td>"
        f"<td><a class='btn sm' href='/control?{nav_qs}'>{escape(t(lang, 'map.associate'))}</a></td>"
        "</tr>"
        for u in unmapped
    )
    form = f"""
<form class="filter-bar" method="get" action="/mappings">
  <input type="hidden" name="program_id" value="{escape(filters.get('program_id',''))}">
  <input type="hidden" name="lang" value="{escape(lang)}">
  <label>Relazione
    <select name="relation">
      <option value="">—</option>
      <option value="FULL" {"selected" if filters.get("relation")=="FULL" else ""}>Completa (FULL)</option>
      <option value="PARTIAL" {"selected" if filters.get("relation")=="PARTIAL" else ""}>Parziale (PARTIAL)</option>
      <option value="SUPPORTING" {"selected" if filters.get("relation")=="SUPPORTING" else ""}>Di supporto (SUPPORTING)</option>
    </select>
  </label>
  <label>Stato
    <select name="review">
      <option value="">—</option>
      <option value="DRAFT" {"selected" if filters.get("review")=="DRAFT" else ""}>Bozza</option>
      <option value="HUMAN_REVIEWED" {"selected" if filters.get("review")=="HUMAN_REVIEWED" else ""}>Da revisionare</option>
      <option value="APPROVED" {"selected" if filters.get("review")=="APPROVED" else ""}>Approvata</option>
      <option value="REJECTED" {"selected" if filters.get("review")=="REJECTED" else ""}>Rifiutata</option>
    </select>
  </label>
  <label><input type="checkbox" name="unmapped_only" value="1" {"checked" if filters.get("unmapped_only")=="1" else ""}> Non mappati</label>
  <button class="btn primary sm" type="submit">{escape(t(lang, 'gaps.filter'))}</button>
</form>
"""
    table = f"""<table class="data-table"><thead><tr>
<th>{escape(t(lang,'col.requirement'))}</th>
<th>{escape(t(lang,'col.framework'))}</th>
<th>{escape(t(lang,'col.control'))}</th>
<th>{escape(t(lang,'col.mapping'))}</th>
<th>{escape(t(lang,'col.delta'))}</th>
<th>{escape(t(lang,'col.rationale'))}</th>
<th>{escape(t(lang,'col.status'))}</th>
</tr></thead><tbody>{''.join(rows) or f"<tr><td colspan='7'>{escape(t(lang,'map.empty'))}</td></tr>"}</tbody></table>"""
    um_table = f"""<table class="data-table"><thead><tr>
<th>{escape(t(lang,'col.requirement'))}</th><th>{escape(t(lang,'col.framework'))}</th>
<th>{escape(t(lang,'col.title'))}</th><th></th></tr></thead>
<tbody>{unmapped_rows or f"<tr><td colspan='4'>{escape(t(lang,'map.unmapped_empty'))}</td></tr>"}</tbody></table>"""
    body = (
        page_header(
            eyebrow=t(lang, "nav.section.knowledge"),
            title=t(lang, "map.title"),
            subtitle=t(lang, "map.meta"),
        )
        + form
        + f'<div class="panel">{table_wrap(table)}</div>'
        + f"<section style='margin-top:16px'><h2>{escape(t(lang,'map.unmapped'))}</h2>"
        + f'<div class="panel">{table_wrap(um_table)}</div></section>'
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
        detail = ev.detail or ""
        if ev.old_value or ev.new_value:
            detail = (
                f"{detail} "
                f"old={escape(str(ev.old_value or {}))} → new={escape(str(ev.new_value or {}))}"
            ).strip()
        rows.append(
            "<tr>"
            f"<td>{escape(ev.timestamp)}</td>"
            f"<td>{escape(ev.actor_user_id)}</td>"
            f"<td><code>{escape(ev.action)}</code></td>"
            f"<td>{escape(ev.entity_type)} <code>{escape(ev.entity_id)}</code></td>"
            f"<td>{escape(ev.tenant_id or '—')}</td>"
            f"<td class='client-meta'>{detail or '—'}</td>"
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


def clients_page(rows: list[Any], assignments: dict[str, list[str]], nav_qs: str) -> str:
    lang = _lang(nav_qs)
    nav_qs = with_lang(nav_qs, lang)
    # Reverse map tenant -> consultants
    tenant_consultants: dict[str, list[str]] = {}
    for user, tenants in assignments.items():
        for tid in tenants:
            tenant_consultants.setdefault(tid, []).append(user)

    body_rows = []
    for r in rows:
        consultants = ", ".join(tenant_consultants.get(r.tenant_id, [])) or "—"
        qs = urlencode({**dict(parse_qsl(nav_qs)), "program_id": r.program_id})
        href = f"/client?{qs}"
        body_rows.append(
            "<tr>"
            f"<td><a href='{href}'><strong>{escape(r.tenant_name)}</strong></a></td>"
            f"<td>{escape(r.program_name)}</td>"
            f"<td>{escape(', '.join(r.frameworks))}</td>"
            f"<td>{escape(consultants)}</td>"
            f"<td>{escape(getattr(r, 'program_status', 'ACTIVE') or 'ACTIVE')}</td>"
            f"<td><a class='btn sm primary' href='{href}'>{escape(t(lang,'action.open'))}</a></td>"
            "</tr>"
        )
    table = f"""<table class="data-table"><thead><tr>
<th>{escape(t(lang,'col.client'))}</th>
<th>{escape(t(lang,'col.program'))}</th>
<th>{escape(t(lang,'col.framework'))}</th>
<th>{escape(t(lang,'clients.consultant'))}</th>
<th>{escape(t(lang,'col.status'))}</th>
<th></th>
</tr></thead><tbody>{''.join(body_rows) or f"<tr><td colspan='6'>{escape(t(lang,'clients.empty'))}</td></tr>"}</tbody></table>"""
    body = (
        page_header(
            eyebrow=t(lang, "nav.section.workspace"),
            title=t(lang, "clients.title"),
            subtitle=t(lang, "clients.meta"),
        )
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
        f"<td>{escape(u.role)}</td>"
        f"<td>{escape(', '.join(u.tenant_ids) or '—')}</td>"
        f"<td>{'MFA' if u.mfa_enabled else '—'}</td>"
        "</tr>"
        for u in (users or [])
    )
    assign_rows = "".join(
        f"<tr><td>{escape(u)}</td><td>{escape(', '.join(tids))}</td></tr>"
        for u, tids in sorted((assignments or {}).items())
    )
    mfa = mfa_status or {}
    body = f"""
{page_header(
    eyebrow=t(lang, 'nav.section.admin'),
    title=t(lang, 'settings.title'),
    subtitle=t(lang, 'settings.meta'),
)}
<section class="panel" style="margin-bottom:14px">
  <h2>{escape(t(lang, 'settings.general'))}</h2>
  <p class="client-meta">WayFold Compliance · sessione cookie HttpOnly · timeout inattività 45 minuti</p>
</section>
<section class="panel" style="margin-bottom:14px">
  <h2>{escape(t(lang, 'settings.users'))}</h2>
  {table_wrap(f"<table class='data-table'><thead><tr><th>Utente</th><th>Ruolo</th><th>Tenant</th><th>MFA</th></tr></thead><tbody>{user_rows or '<tr><td colspan=4>—</td></tr>'}</tbody></table>")}
</section>
<section class="panel" style="margin-bottom:14px">
  <h2>{escape(t(lang, 'settings.assignments'))}</h2>
  {table_wrap(f"<table class='data-table'><thead><tr><th>Consulente</th><th>Clienti</th></tr></thead><tbody>{assign_rows or '<tr><td colspan=2>—</td></tr>'}</tbody></table>")}
</section>
<section class="panel" style="margin-bottom:14px">
  <h2>{escape(t(lang, 'settings.evidence'))}</h2>
  <p class="client-meta">{escape(t(lang, 'settings.evidence_note'))}</p>
</section>
{ai_block}
<section class="panel">
  <h2>{escape(t(lang, 'settings.security'))}</h2>
  <p>MFA SUPER_ADMIN/CONSULTANT: {"abilitata in directory utenti" if mfa.get("supported") else "hook pronto"}</p>
  <p class="client-meta">Credenziale review temporanea: TEMPORARY REVIEW CREDENTIAL (solo audit esterno).</p>
</section>
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

"""User profile page."""

from __future__ import annotations

from html import escape
from urllib.parse import parse_qsl

from engine.csrf import CSRF_FORM_FIELD
from engine.dates import format_display_datetime
from engine.i18n import DEFAULT_LANG, normalize_lang, t
from engine.ui_components import page_header
from engine.ui_shell import render_shell


def profile_page(
    nav_qs: str,
    *,
    username: str,
    display_name: str,
    role: str,
    tenant_ids: list[str],
    mfa_enabled: bool,
    temporary_review: bool,
    session_issued: int | None,
    session_expires: int | None,
) -> str:
    lang = normalize_lang(dict(parse_qsl(nav_qs)).get("lang", DEFAULT_LANG))
    role_s = role.value if hasattr(role, "value") else str(role or "")
    role_key = f"role.{role_s}"
    role_label = t(lang, role_key)
    if role_label == role_key:
        role_label = role_s or "—"
    tenants = (
        ", ".join(tenant_ids)
        if tenant_ids
        else ("Tutti (amministratore)" if role_s == "SUPER_ADMIN" else "—")
    )
    mfa = "Abilitata" if mfa_enabled else "Non abilitata"
    from datetime import datetime, timezone

    def _epoch(v: int | None) -> str:
        if not v:
            return "—"
        try:
            return format_display_datetime(
                datetime.fromtimestamp(int(v), tz=timezone.utc).isoformat(),
                lang=lang,
            )
        except (OSError, OverflowError, ValueError):
            return "—"

    sess_bits = []
    if session_issued:
        sess_bits.append(f"Emessa: {_epoch(session_issued)}")
    if session_expires:
        sess_bits.append(f"Scade: {_epoch(session_expires)}")
    sess = " · ".join(sess_bits) if sess_bits else "Sessione attiva"

    pwd_form = f"""
<form method="post" action="/profile/password?{nav_qs}" class="panel" style="padding:18px;margin-top:16px" id="password">
  <h2 style="margin-top:0">Cambia password</h2>
  <p class="meta">Aggiorna la password del tuo account.</p>
  <div class="form-grid">
    <div class="form-field"><label>Password attuale</label>
      <input type="password" name="current_password" required autocomplete="current-password"></div>
    <div class="form-field"><label>Nuova password</label>
      <input type="password" name="new_password" required minlength="8" autocomplete="new-password"></div>
    <div class="form-field full"><label>Conferma nuova password</label>
      <input type="password" name="confirm_password" required minlength="8" autocomplete="new-password"></div>
  </div>
  <input type="hidden" name="{CSRF_FORM_FIELD}" value="">
  <div class="page-actions" style="margin-top:12px">
    <button class="btn primary" type="submit">Aggiorna password</button>
  </div>
</form>
<script>
document.querySelector('input[name="{CSRF_FORM_FIELD}"]').value =
  document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('wf_csrf='))?.split('=')[1] || '';
</script>
"""
    review_row = ""
    if temporary_review:
        review_row = (
            "<div class='field'><label>Nota account</label>"
            "<div class='field-value'>Account di servizio — cambia la password dal modulo sotto.</div></div>"
        )
    body = page_header(
        eyebrow="Account",
        title="Profilo",
        subtitle="Dati account e sicurezza.",
    ) + f"""
<div class="panel" style="padding:18px">
  <div class="detail-grid">
    <div class="field"><label>Nome</label><div class="field-value">{escape(display_name or username)}</div></div>
    <div class="field"><label>Username</label><div class="field-value">{escape(username)}</div></div>
    <div class="field"><label>Ruolo</label><div class="field-value">{escape(role_label)}</div></div>
    <div class="field"><label>Assegnazioni</label><div class="field-value">{escape(tenants)}</div></div>
    <div class="field"><label>MFA</label><div class="field-value">{escape(mfa)}</div></div>
    <div class="field"><label>Sessione</label><div class="field-value">{escape(sess)}</div></div>
    {review_row}
  </div>
</div>
{pwd_form}
"""
    return render_shell(
        "Profilo — WayFold Compliance",
        nav_qs,
        body,
        lang=lang,
        active_path="/profile",
        breadcrumb="Profilo",
    )

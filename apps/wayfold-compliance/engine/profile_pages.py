"""User profile page."""

from __future__ import annotations

from html import escape
from urllib.parse import parse_qsl

from engine.csrf import CSRF_FORM_FIELD
from engine.i18n import DEFAULT_LANG, normalize_lang
from engine.rbac import parse_role
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
    role_label = parse_role(role).value if role else "—"
    tenants = ", ".join(tenant_ids) if tenant_ids else "Tutti (super admin)" if role else "—"
    mfa = "Abilitata" if mfa_enabled else "Non abilitata"
    review = "Sì (credenziale temporanea)" if temporary_review else "No"
    sess = ""
    if session_issued:
        sess += f"Emessa (epoch): {session_issued}"
    if session_expires:
        sess += f" · Scadenza (epoch): {session_expires}"
    if not sess:
        sess = "Informazioni sessione disponibili dopo login."

    pwd_form = f"""
<form method="post" action="/profile/password?{nav_qs}" class="panel" style="padding:18px;margin-top:16px">
  <h2>Cambia password</h2>
  <p class="client-meta">La password viene salvata nel directory utenti (non in .auth.env).</p>
  <div class="form-grid">
    <div class="form-field"><label>Password attuale</label>
      <input type="password" name="current_password" required autocomplete="current-password"></div>
    <div class="form-field"><label>Nuova password</label>
      <input type="password" name="new_password" required minlength="8" autocomplete="new-password"></div>
    <div class="form-field"><label>Conferma nuova password</label>
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
    body = page_header(
        eyebrow="Account",
        title="Profilo",
        subtitle="Informazioni account e sessione.",
    ) + f"""
<div class="panel" style="padding:18px">
  <dl class="detail-grid">
    <dt>Nome visualizzato</dt><dd>{escape(display_name or username)}</dd>
    <dt>Username</dt><dd>{escape(username)}</dd>
    <dt>Ruolo</dt><dd>{escape(role_label)}</dd>
    <dt>Tenant / assegnazioni</dt><dd>{escape(tenants)}</dd>
    <dt>MFA</dt><dd>{escape(mfa)}</dd>
    <dt>Credenziale review temporanea</dt><dd>{escape(review)}</dd>
    <dt>Sessione</dt><dd>{escape(sess)}</dd>
  </dl>
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

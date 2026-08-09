"""Knowledge Base import wizard (preview-first)."""

from __future__ import annotations

import json
from html import escape
from pathlib import Path
from typing import Any

from engine.csrf import CSRF_FORM_FIELD
from engine.i18n import DEFAULT_LANG, normalize_lang
from engine.kb_import import import_framework_package
from engine.ui_components import page_header
from engine.ui_shell import render_shell


def import_wizard_page(nav_qs: str, *, step: int = 1, preview: dict[str, Any] | None = None) -> str:
    lang = normalize_lang("it")
    preview = preview or {}
    body = page_header(
        eyebrow="Knowledge Base",
        title="Importazione",
        subtitle="Carica un pacchetto JSON v1 o la matrice legacy Excel (conversione locale).",
    )
    if step == 1:
        body += f"""
<form method="post" action="/kb/import/upload?{nav_qs}" enctype="multipart/form-data" class="panel" style="padding:18px">
  <div class="form-field full">
    <label>File (JSON framework package o .xlsx)</label>
    <input type="file" name="package" required accept=".json,.xlsx,application/json">
  </div>
  <input type="hidden" name="{CSRF_FORM_FIELD}" value="">
  <button class="btn primary" type="submit">Analizza</button>
</form>
<script>document.querySelector('input[name="{CSRF_FORM_FIELD}"]').value=
  document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('wf_csrf='))?.split('=')[1]||'';</script>
"""
    elif step == 2 and preview:
        body += f"""
<div class="panel" style="padding:18px">
  <p><strong>File:</strong> {escape(str(preview.get('filename','')))}</p>
  <p><strong>SHA-256:</strong> <code>{escape(str(preview.get('sha256','')))}</code></p>
  <p><strong>Tipo:</strong> {escape(str(preview.get('sourceType','')))}</p>
  <p><strong>Requisiti:</strong> {int(preview.get('requirementCount') or 0)}</p>
  <p><strong>Avvisi:</strong> {int(preview.get('warningCount') or 0)}</p>
</div>
<form method="post" action="/kb/import/apply?{nav_qs}" class="panel" style="padding:18px;margin-top:12px">
  <input type="hidden" name="staging_id" value="{escape(str(preview.get('stagingId','')))}">
  <input type="hidden" name="{CSRF_FORM_FIELD}" value="">
  <h2>Metadati (obbligatori per publish futuro)</h2>
  <div class="form-grid">
    <div class="form-field"><label>Nome framework</label><input name="framework_name" required value="{escape(str(preview.get('defaultName','')))}"></div>
    <div class="form-field"><label>Versione</label><input name="version_label" value="legacy-import"></div>
    <div class="form-field"><label>Publisher</label><input name="publisher"></div>
    <div class="form-field"><label>Giurisdizione</label><input name="jurisdiction"></div>
  </div>
  <button class="btn primary" type="submit">Importa come BOZZA</button>
</form>
<script>document.querySelector('input[name="{CSRF_FORM_FIELD}"]').value=
  document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('wf_csrf='))?.split('=')[1]||'';</script>
"""
    return render_shell(
        "Importazione — Knowledge Base",
        nav_qs,
        body,
        lang=lang,
        active_path="/kb/import",
        breadcrumb="Importazione",
    )


def stage_upload(raw: bytes, filename: str, data_dir: Path) -> dict[str, Any]:
    staging_dir = data_dir / "import_staging"
    staging_dir.mkdir(parents=True, exist_ok=True)
    import hashlib

    sha = hashlib.sha256(raw).hexdigest()
    staging_id = sha[:16]
    path = staging_dir / f"{staging_id}-{filename}"
    path.write_bytes(raw)
    source_type = "json"
    package = None
    if filename.lower().endswith(".xlsx"):
        source_type = "legacy_xlsx"
        import tempfile

        from engine.importers.multicompliance.__main__ import convert_workbook

        tmp = Path(tempfile.mkdtemp())
        xlsx = tmp / filename
        xlsx.write_bytes(raw)
        convert_workbook(xlsx, tmp / "out")
        pkg_path = tmp / "out" / "frameworks" / "reg-cloud-legacy.json"
        package = json.loads(pkg_path.read_text(encoding="utf-8"))
    else:
        package = json.loads(raw.decode("utf-8"))
    meta = {
        "stagingId": staging_id,
        "filename": filename,
        "sha256": sha,
        "sourceType": source_type,
        "requirementCount": len(package.get("requirements") or []),
        "warningCount": 0,
        "defaultName": (package.get("framework") or {}).get("name") or "",
        "packagePath": str(path),
    }
    (staging_dir / f"{staging_id}.meta.json").write_text(
        json.dumps({"meta": meta, "package": package}, ensure_ascii=False),
        encoding="utf-8",
    )
    return meta


def apply_staged(staging_id: str, data_dir: Path, *, metadata: dict[str, str], actor: str):
    staging_dir = data_dir / "import_staging"
    blob = json.loads((staging_dir / f"{staging_id}.meta.json").read_text(encoding="utf-8"))
    package = blob["package"]
    fw = package.setdefault("framework", {})
    if metadata.get("framework_name"):
        fw["name"] = metadata["framework_name"]
    if metadata.get("publisher"):
        fw["publisher"] = metadata["publisher"]
    if metadata.get("jurisdiction"):
        fw["jurisdiction"] = metadata["jurisdiction"]
    ver = package.setdefault("version", {})
    if metadata.get("version_label"):
        ver["label"] = metadata["version_label"]
    ver["status"] = "DRAFT"
    return import_framework_package(package, actor=actor)

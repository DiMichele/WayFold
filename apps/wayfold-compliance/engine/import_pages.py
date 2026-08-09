"""Knowledge Base import wizard (5-step, preview-first, multi-package)."""

from __future__ import annotations

import hashlib
import json
import tempfile
from html import escape
from pathlib import Path
from typing import Any

from engine.csrf import CSRF_FORM_FIELD
from engine.i18n import normalize_lang
from engine.kb_import import import_packages_batch
from engine.ui_components import page_header
from engine.ui_shell import render_shell

STEPS = (
    (1, "Caricamento"),
    (2, "Analisi"),
    (3, "Metadata"),
    (4, "Verifica"),
    (5, "Importazione"),
)


def _stepper(step: int) -> str:
    parts = []
    for num, label in STEPS:
        cls = "active" if num == step else ("done" if num < step else "")
        parts.append(
            f"<span class='step {cls}'><span class='step-num'>{num}</span> {escape(label)}</span>"
        )
    return "<div class='stepper compact'>" + " · ".join(parts) + "</div>"


def _csrf_script() -> str:
    return f"""<script>document.querySelectorAll('input[name="{CSRF_FORM_FIELD}"]').forEach(el=>{{
  el.value=document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('wf_csrf='))?.split('=')[1]||'';
}});</script>"""


def import_wizard_page(
    nav_qs: str,
    *,
    step: int = 1,
    preview: dict[str, Any] | None = None,
) -> str:
    lang = normalize_lang("it")
    preview = preview or {}
    body = page_header(
        eyebrow="Knowledge Base",
        title="Importazione",
        subtitle="Carica un pacchetto JSON v1 o la matrice legacy Excel.",
    )
    body += _stepper(step)

    if step == 1:
        body += f"""
<div class="panel import-card" style="max-width:560px;margin:24px auto;padding:28px;text-align:center">
  <form method="post" action="/kb/import/upload?{nav_qs}" enctype="multipart/form-data">
    <p class="meta">Trascina un file oppure selezionalo. Formati: JSON WayFold KB v1, Excel legacy (.xlsx).</p>
    <div class="form-field full" style="margin:18px 0">
      <input type="file" name="package" required accept=".json,.xlsx,application/json"
        style="margin:0 auto">
    </div>
    <input type="hidden" name="{CSRF_FORM_FIELD}" value="">
    <button class="btn primary" type="submit">Seleziona / Analizza</button>
  </form>
</div>
"""
    elif step >= 2 and preview:
        fname = escape(str(preview.get("filename", "")))
        size = int(preview.get("size") or 0)
        sha = escape(str(preview.get("sha256", "")))
        stype = escape(str(preview.get("sourceType", "")))
        body += f"""
<div class="panel" style="padding:16px;margin-bottom:12px">
  <strong>{fname}</strong>
  <span class="meta"> · {size:,} byte · {stype}</span>
  <div class="meta" style="margin-top:6px">SHA-256: <code>{sha}</code></div>
</div>
"""
        frameworks = preview.get("frameworks") or []
        if step == 2:
            rows = []
            for fw in frameworks:
                status = escape(str(fw.get("status") or "OK"))
                detail = escape(str(fw.get("detail") or ""))
                rows.append(
                    f"<tr><td><strong>{escape(str(fw.get('name')))}</strong></td>"
                    f"<td>{escape(str(fw.get('summary') or ''))}</td>"
                    f"<td>{status}</td><td class='meta'>{detail}</td></tr>"
                )
            skipped = preview.get("skipped") or []
            for s in skipped:
                rows.append(
                    f"<tr><td><strong>{escape(str(s.get('framework')))}</strong></td>"
                    f"<td>Nessun dato importabile</td><td>Skipped</td>"
                    f"<td class='meta'>{escape(str(s.get('reason') or ''))}</td></tr>"
                )
            body += f"""
<div class="panel" style="padding:16px">
  <table class="data-table"><thead><tr>
    <th>Framework</th><th>Riepilogo</th><th>Stato</th><th>Note</th>
  </tr></thead><tbody>{''.join(rows) or '<tr><td colspan=4>Nessun framework</td></tr>'}</tbody></table>
  <p style="margin-top:14px"><a class="btn primary" href="/kb/import/preview?staging={escape(str(preview.get('stagingId','')))}&step=3&{nav_qs}">Continua → Metadata</a></p>
</div>
"""
        elif step == 3:
            body += f"""
<form method="get" action="/kb/import/preview" class="panel" style="padding:16px">
  <input type="hidden" name="staging" value="{escape(str(preview.get('stagingId','')))}">
  <input type="hidden" name="step" value="4">
  <p class="meta">I pacchetti restano in BOZZA con metadata incompleti fino a pubblicazione manuale.</p>
  <div class="form-grid">
    <div class="form-field"><label>Publisher (opzionale)</label><input name="publisher" value="{escape(str(preview.get('publisher') or ''))}"></div>
    <div class="form-field"><label>Giurisdizione</label><input name="jurisdiction" value="{escape(str(preview.get('jurisdiction') or 'IT'))}"></div>
  </div>
  <button class="btn primary" type="submit">Continua → Verifica</button>
</form>
"""
        elif step == 4:
            issues = preview.get("issueSummary") or {}
            err = int(issues.get("errors") or 0)
            warn = int(issues.get("warnings") or 0)
            info = int(issues.get("info") or 0)
            details = preview.get("issueDetails") or []
            detail_html = "".join(
                f"<li><span class='badge'>{escape(str(d.get('severity')))}</span> "
                f"{escape(str(d.get('code')))} — {escape(str(d.get('suggestedAction') or d.get('sheet') or ''))}</li>"
                for d in details[:40]
            )
            body += f"""
<div class="panel" style="padding:16px">
  <p><strong>Qualità:</strong> {err} errori · {warn} avvisi · {info} info</p>
  <details><summary>Dettaglio issues</summary><ul class="compact">{detail_html or '<li>Nessun dettaglio</li>'}</ul></details>
  <p class="meta" style="margin-top:12px">Diff: nuovi pacchetti framework (nessuna sovrascrittura automatica di requisiti modificati manualmente).</p>
  <form method="post" action="/kb/import/apply?{nav_qs}" style="margin-top:16px">
    <input type="hidden" name="staging_id" value="{escape(str(preview.get('stagingId','')))}">
    <input type="hidden" name="publisher" value="{escape(str(preview.get('publisher') or ''))}">
    <input type="hidden" name="jurisdiction" value="{escape(str(preview.get('jurisdiction') or ''))}">
    <input type="hidden" name="{CSRF_FORM_FIELD}" value="">
    <button class="btn primary" type="submit">Importa come bozza</button>
  </form>
</div>
"""
        elif step == 5:
            body += f"""
<div class="panel" style="padding:16px">
  <p>Importazione completata. I framework sono in <strong>Bozza</strong> con fonte da verificare.</p>
  <p><a class="btn primary" href="/frameworks?{nav_qs}">Apri Framework e normative</a></p>
</div>
"""

    body += _csrf_script()
    return render_shell(
        "Importazione — WayFold Compliance",
        nav_qs,
        body,
        lang=lang,
        active_path="/kb/import",
        breadcrumb="Importazione",
    )


def stage_upload(raw: bytes, filename: str, data_dir: Path) -> dict[str, Any]:
    staging_dir = data_dir / "import_staging"
    staging_dir.mkdir(parents=True, exist_ok=True)
    sha = hashlib.sha256(raw).hexdigest()
    staging_id = sha[:16]
    path = staging_dir / f"{staging_id}-{filename}"
    path.write_bytes(raw)
    source_type = "json"
    packages: list[dict[str, Any]] = []
    frameworks_ui: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    issue_summary = {"errors": 0, "warnings": 0, "info": 0}
    issue_details: list[dict[str, Any]] = []
    analysis: dict[str, Any] = {}

    if filename.lower().endswith(".xlsx"):
        source_type = "legacy_xlsx"
        from engine.importers.multicompliance.__main__ import convert_workbook

        tmp = Path(tempfile.mkdtemp())
        xlsx = tmp / filename
        xlsx.write_bytes(raw)
        out = tmp / "out"
        summary = convert_workbook(xlsx, out)
        analysis = json.loads((out / "analysis.json").read_text(encoding="utf-8"))
        for name in summary.get("frameworkPackages") or []:
            pkg = json.loads((out / "frameworks" / name).read_text(encoding="utf-8"))
            packages.append(pkg)
            counts = pkg.get("counts") or {}
            frameworks_ui.append(
                {
                    "name": (pkg.get("framework") or {}).get("name"),
                    "summary": _fw_summary(pkg, counts),
                    "status": "OK",
                    "detail": pkg.get("sourceStatus") or "",
                }
            )
        skipped = list(summary.get("skipped") or [])
        for issue in analysis.get("issues") or []:
            sev = str(issue.get("severity") or "INFO").upper()
            if sev == "ERROR":
                issue_summary["errors"] += 1
            elif sev == "WARNING":
                issue_summary["warnings"] += 1
            else:
                issue_summary["info"] += 1
            issue_details.append(issue)
        # Persist convert output for apply
        batch_dir = staging_dir / staging_id
        if batch_dir.exists():
            import shutil

            shutil.rmtree(batch_dir)
        import shutil

        shutil.copytree(out, batch_dir)
    else:
        package = json.loads(raw.decode("utf-8"))
        packages = [package]
        counts = package.get("counts") or {}
        frameworks_ui.append(
            {
                "name": (package.get("framework") or {}).get("name"),
                "summary": f"{len(package.get('requirements') or [])} requisiti",
                "status": "OK",
                "detail": "",
            }
        )

    meta = {
        "stagingId": staging_id,
        "filename": filename,
        "size": len(raw),
        "sha256": sha,
        "sourceType": source_type,
        "requirementCount": sum(len(p.get("requirements") or []) for p in packages),
        "warningCount": issue_summary["warnings"],
        "frameworks": frameworks_ui,
        "skipped": skipped,
        "issueSummary": issue_summary,
        "issueDetails": issue_details[:100],
        "analysisCounts": analysis.get("counts") or {},
        "defaultName": frameworks_ui[0]["name"] if frameworks_ui else "",
        "packagePath": str(path),
        "publisher": "",
        "jurisdiction": "IT",
    }
    (staging_dir / f"{staging_id}.meta.json").write_text(
        json.dumps({"meta": meta, "packages": packages}, ensure_ascii=False),
        encoding="utf-8",
    )
    return meta


def _fw_summary(pkg: dict[str, Any], counts: dict[str, Any]) -> str:
    name = (pkg.get("framework") or {}).get("name") or ""
    if "ISO" in name:
        return (
            f"{counts.get('annexAControls', 0)} Annex A · "
            f"{counts.get('clausesPartial', 0)} clausole (parziali)"
        )
    if counts.get("sourceRows"):
        return (
            f"{counts.get('sourceRows')} righe · {counts.get('sourceCodes')} codici · "
            f"{counts.get('normalizedRequirements')} requisiti · "
            f"{counts.get('assessmentQuestions', 0)} domande"
        )
    return f"{len(pkg.get('requirements') or [])} requisiti"


def load_staging_meta(staging_id: str, data_dir: Path) -> dict[str, Any]:
    blob = json.loads((data_dir / "import_staging" / f"{staging_id}.meta.json").read_text(encoding="utf-8"))
    meta = blob.get("meta") or {}
    meta["_packages"] = blob.get("packages") or []
    return meta


def apply_staged(staging_id: str, data_dir: Path, *, metadata: dict[str, str], actor: str):
    blob = json.loads((data_dir / "import_staging" / f"{staging_id}.meta.json").read_text(encoding="utf-8"))
    packages = list(blob.get("packages") or [])
    if not packages and blob.get("package"):
        packages = [blob["package"]]
    for package in packages:
        fw = package.setdefault("framework", {})
        if metadata.get("publisher"):
            fw["publisher"] = metadata["publisher"]
        if metadata.get("jurisdiction"):
            fw["jurisdiction"] = metadata["jurisdiction"]
        ver = package.setdefault("version", {})
        ver["status"] = "DRAFT"
        ver["metadataStatus"] = "INCOMPLETE"
    return import_packages_batch(packages, actor=actor)

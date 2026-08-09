"""Legacy Matrice_MultiCompliance.xlsx → WayFold KB JSON v1 artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]

SOURCE_NAME = "Matrice_MultiCompliance.xlsx"
SHEET_CORP = "Matrice_Multicompliance Corp."
SHEET_BUS = "Matrice_Multicompliance Buss."
SHEET_PTR = "Azioni PTR Business Open - NO M"
SHEET_STAGING = "Foglio1"
SHEET_OLD = "OLD_Matrice Multi-Compliance"
SHEET_IGNORE = "Foglio2"


def default_input_path() -> Path:
    for candidate in (
        ROOT / "import" / "source" / SOURCE_NAME,
        ROOT / "docs" / SOURCE_NAME,
    ):
        if candidate.is_file():
            return candidate
    return ROOT / "import" / "source" / SOURCE_NAME


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _stable_id(namespace: str, *parts: str) -> str:
    payload = "|".join([namespace, *parts])
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
    return f"{namespace}-{digest}"


def _cell_str(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def _normalize_header(h: Any) -> str:
    return _cell_str(h)


def analyze_workbook(path: Path) -> dict[str, Any]:
    from openpyxl import load_workbook

    file_hash = _sha256_file(path)
    wb = load_workbook(path, read_only=True, data_only=True)
    sheets_meta = []
    issues: list[dict[str, Any]] = []
    for name in wb.sheetnames:
        ws = wb[name]
        max_row = ws.max_row or 0
        max_col = ws.max_column or 0
        hdr = []
        if max_row >= 1:
            rows_hdr = list(ws.iter_rows(min_row=1, max_row=1, values_only=True))
            if rows_hdr:
                hdr = list(rows_hdr[0])
        sheets_meta.append(
            {
                "name": name,
                "rows": max_row,
                "columns": max_col,
                "headers": [_normalize_header(h) for h in hdr],
                "classification": _classify_sheet(name),
            }
        )
    wb.close()

    # Re-open for counts
    wb = load_workbook(path, read_only=True, data_only=True)
    corp = _analyze_corp(wb[SHEET_CORP], issues)
    bus = _analyze_business(wb[SHEET_BUS], issues)
    ptr = _analyze_ptr(wb[SHEET_PTR]) if SHEET_PTR in wb.sheetnames else {"rows": 0}
    staging = _psnc_staging_crosscheck(wb)
    wb.close()

    return {
        "importSource": SOURCE_NAME,
        "sha256": file_hash,
        "analyzedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "sheets": sheets_meta,
        "counts": {
            "iso_annex_a": corp.get("annex_a_rows", 0),
            "reg_cloud_rows": bus.get("reg_cloud_rows", 0),
            "reg_cloud_codes": bus.get("reg_cloud_codes", 0),
            "nis2_rows": bus.get("nis2_rows", 0),
            "nis2_codes": bus.get("nis2_codes", 0),
            "psnc_rows": bus.get("psnc_rows", 0),
            "psnc_codes": bus.get("psnc_codes", 0),
            "csa_populated_rows": bus.get("csa_rows", 0),
        },
        "corp": corp,
        "business": bus,
        "remediation": ptr,
        "psnc_crosscheck": staging,
        "issues": issues,
    }


def _classify_sheet(name: str) -> str:
    if name == SHEET_CORP:
        return "ISO_CORPORATE"
    if name == SHEET_BUS:
        return "BUSINESS_FRAMEWORKS"
    if name == SHEET_PTR:
        return "CLIENT_REMEDIATION"
    if name == SHEET_STAGING:
        return "PSNC_STAGING_REFERENCE"
    if name == SHEET_OLD:
        return "LEGACY_REFERENCE_ONLY"
    if name == SHEET_IGNORE:
        return "IGNORE"
    return "UNKNOWN"


def _analyze_corp(ws, issues: list[dict]) -> dict[str, Any]:
    annex = 0
    norma = 0
    missing_scope = 0
    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not any(row):
            continue
        ambito = _cell_str(row[1] if len(row) > 1 else "")
        cat = _cell_str(row[3] if len(row) > 3 else "")
        num = _cell_str(row[4] if len(row) > 4 else "")
        title = _cell_str(row[5] if len(row) > 5 else "")
        if cat and num and title:
            annex += 1
        if _cell_str(row[2] if len(row) > 2 else "") and not cat:
            norma += 1
        if not ambito and (cat or num):
            missing_scope += 1
            issues.append(
                _issue(
                    "MISSING_SCOPE",
                    "WARNING",
                    sheet=SHEET_CORP,
                    row=i,
                    column="Ambito di Applicazione",
                )
            )
    if norma < 5:
        issues.append(
            _issue(
                "INCOMPLETE_FRAMEWORK",
                "INFO",
                sheet=SHEET_CORP,
                suggestedAction="Marcare sezione Norma come INCOMPLETE_SOURCE",
            )
        )
    return {"annex_a_rows": annex, "norma_rows": norma, "missing_scope": missing_scope}


def _analyze_business(ws, issues: list[dict]) -> dict[str, Any]:
    reg_rows = 0
    reg_codes: set[str] = set()
    nis2_rows = 0
    nis2_codes: set[str] = set()
    psnc_rows = 0
    psnc_codes: set[str] = set()
    csa_rows = 0
    hdr = []
    rows_hdr = list(ws.iter_rows(min_row=1, max_row=1, values_only=True))
    if rows_hdr:
        hdr = list(rows_hdr[0])
    for i, h in enumerate(hdr):
        if h is None and i >= 28:
            issues.append(
                _issue(
                    "UNNAMED_COLUMN",
                    "INFO",
                    sheet=SHEET_BUS,
                    column=f"UNNAMED_LEGACY_FIELD_{i + 1}",
                    suggestedAction="Documentare significato; non inventare header",
                )
            )
    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not any(row):
            continue
        scope = _cell_str(row[0])
        if not scope:
            issues.append(
                _issue("MISSING_SCOPE", "WARNING", sheet=SHEET_BUS, row=i, column="Ambito")
            )
        rc = _cell_str(row[1] if len(row) > 1 else "")
        if rc and (_cell_str(row[6] if len(row) > 6 else "") or _cell_str(row[5] if len(row) > 5 else "")):
            reg_rows += 1
            reg_codes.add(rc.split()[0])
        nis2 = _cell_str(row[12] if len(row) > 12 else "")
        if nis2:
            nis2_rows += 1
            nis2_codes.add(nis2)
        psnc = _cell_str(row[15] if len(row) > 15 else "")
        if psnc:
            psnc_rows += 1
            psnc_codes.add(psnc)
        csa = _cell_str(row[17] if len(row) > 17 else "")
        if csa:
            csa_rows += 1
    return {
        "reg_cloud_rows": reg_rows,
        "reg_cloud_codes": len(reg_codes),
        "nis2_rows": nis2_rows,
        "nis2_codes": len(nis2_codes),
        "psnc_rows": psnc_rows,
        "psnc_codes": len(psnc_codes),
        "csa_rows": csa_rows,
    }


def _analyze_ptr(ws) -> dict[str, Any]:
    n = sum(1 for row in ws.iter_rows(min_row=2, values_only=True) if any(row))
    return {"rows": n}


def _psnc_staging_crosscheck(wb) -> dict[str, Any]:
    if SHEET_STAGING not in wb.sheetnames or SHEET_BUS not in wb.sheetnames:
        return {"status": "skipped"}
    bus_psnc = set()
    for row in wb[SHEET_BUS].iter_rows(min_row=2, values_only=True):
        code = _cell_str(row[15] if len(row) > 15 else "")
        if code:
            bus_psnc.add(code)
    staging = set()
    for row in wb[SHEET_STAGING].iter_rows(min_row=2, values_only=True):
        for cell in row:
            s = _cell_str(cell)
            if re.match(r"^[A-Z]{2,}\.", s) or re.match(r"^PSNC", s, re.I):
                staging.add(s)
    return {
        "business_only": sorted(bus_psnc - staging)[:50],
        "staging_only": sorted(staging - bus_psnc)[:50],
        "matched_estimate": len(bus_psnc & staging),
    }


def _issue(
    issue_code: str,
    severity: str,
    *,
    sheet: str = "",
    row: int | None = None,
    column: str = "",
    originalValue: str = "",
    suggestedAction: str = "",
) -> dict[str, Any]:
    return {
        "id": _stable_id("issue", issue_code, sheet, str(row or ""), column),
        "severity": severity,
        "code": issue_code,
        "sheet": sheet,
        "row": row,
        "column": column,
        "originalValue": originalValue,
        "suggestedAction": suggestedAction,
    }


def convert_workbook(path: Path, output_dir: Path, *, batch_id: str | None = None) -> dict[str, Any]:
    from openpyxl import load_workbook

    output_dir.mkdir(parents=True, exist_ok=True)
    analysis = analyze_workbook(path)
    file_hash = analysis["sha256"]
    batch_id = batch_id or _stable_id("batch", file_hash)
    provenance = {
        "importSource": SOURCE_NAME,
        "sha256": file_hash,
        "importBatchId": batch_id,
        "importedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }
    wb = load_workbook(path, read_only=True, data_only=True)
    frameworks_dir = output_dir / "frameworks"
    frameworks_dir.mkdir(exist_ok=True)
    iso = _convert_iso_corp(wb[SHEET_CORP], provenance)
    reg = _convert_reg_cloud(wb[SHEET_BUS], provenance)
    nis2 = _convert_nis2(wb[SHEET_BUS], provenance)
    psnc = _convert_psnc(wb[SHEET_BUS], provenance)
    csa_stub = {
        "schemaVersion": "1.0",
        "framework": {"id": "csa-star-legacy", "name": "CSA STAR", "legacyName": "CSA STAR"},
        "version": {"label": "legacy", "status": "DRAFT", "metadataStatus": "INCOMPLETE"},
        "sourceStatus": "NO_SOURCE_DATA",
        "requirements": [],
        "provenance": provenance,
    }
    crosswalk = _legacy_crosswalk(wb[SHEET_BUS], provenance)
    overlays = _client_overlays(wb, provenance)
    remediation = _remediation_candidates(wb[SHEET_PTR] if SHEET_PTR in wb.sheetnames else None, provenance)
    wb.close()

    artifacts = {
        "iso-27001-legacy.json": iso,
        "reg-cloud-legacy.json": reg,
        "nis2-legacy.json": nis2,
        "psnc-legacy.json": psnc,
        "csa-star-legacy.json": csa_stub,
    }
    for name, payload in artifacts.items():
        (frameworks_dir / name).write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    (output_dir / "analysis.json").write_text(
        json.dumps(analysis, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    mappings_dir = output_dir / "mappings"
    mappings_dir.mkdir(exist_ok=True)
    (mappings_dir / "legacy-crosswalk-candidates.json").write_text(
        json.dumps(crosswalk, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    overlay_dir = output_dir / "client-overlays"
    overlay_dir.mkdir(exist_ok=True)
    for name, payload in overlays.items():
        (overlay_dir / name).write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    rem_dir = output_dir / "remediation"
    rem_dir.mkdir(exist_ok=True)
    (rem_dir / "ptr-business-actions.json").write_text(
        json.dumps(remediation, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    validation_dir = output_dir / "validation"
    validation_dir.mkdir(exist_ok=True)
    summary = {
        "batchId": batch_id,
        "sha256": file_hash,
        "frameworkPackages": list(artifacts.keys()),
        "issueCount": len(analysis.get("issues") or []),
        "counts": analysis.get("counts"),
    }
    (validation_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (validation_dir / "issues.json").write_text(
        json.dumps({"issues": analysis.get("issues") or []}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return summary


def _framework_package(
    *,
    framework_id: str,
    name: str,
    legacy_name: str,
    requirements: list[dict],
    provenance: dict,
    source_status: str = "SOURCE_PARTIAL",
) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "framework": {
            "id": framework_id,
            "name": name,
            "legacyName": legacy_name,
            "type": "Normativa",
            "publisher": "",
            "jurisdiction": "",
            "officialSource": "",
        },
        "version": {
            "id": _stable_id("fv", framework_id, "legacy"),
            "label": "legacy-import",
            "status": "DRAFT",
            "publicationDate": None,
            "effectiveDate": None,
            "metadataStatus": "INCOMPLETE",
        },
        "sourceStatus": source_status,
        "requirements": requirements,
        "assessmentQuestions": [],
        "applicability": [],
        "importSource": provenance,
    }


def _convert_iso_corp(ws, provenance: dict) -> dict[str, Any]:
    reqs = []
    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        cat = _cell_str(row[3] if len(row) > 3 else "")
        num = _cell_str(row[4] if len(row) > 4 else "")
        if not (cat or num):
            continue
        code = f"{cat}-{num}".strip("-")
        title = _cell_str(row[5] if len(row) > 5 else "")
        desc = _cell_str(row[6] if len(row) > 6 else "")
        rid = _stable_id("req", "iso-27001-legacy", code, str(i))
        reqs.append(
            {
                "id": rid,
                "code": code,
                "sourceCode": code,
                "title": title or code,
                "description": desc,
                "section": cat,
                "sourceRow": i,
                "isLeaf": True,
                "order": len(reqs),
            }
        )
    return _framework_package(
        framework_id="iso-27001-legacy",
        name="ISO/IEC 27001 Annex A (legacy matrix)",
        legacy_name="27001 Annex A",
        requirements=reqs,
        provenance=provenance,
        source_status="SOURCE_PARTIAL",
    )


def _convert_reg_cloud(ws, provenance: dict) -> dict[str, Any]:
    reqs: list[dict] = []
    questions: list[dict] = []
    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        code = _cell_str(row[1] if len(row) > 1 else "")
        if not code:
            continue
        desc = _cell_str(row[6] if len(row) > 6 else "")
        q = _cell_str(row[5] if len(row) > 5 else "")
        if not (desc or q):
            continue
        rid = _stable_id("req", "reg-cloud-legacy", code, str(i))
        reqs.append(
            {
                "id": rid,
                "code": code,
                "sourceCode": code,
                "title": desc[:120] if desc else code,
                "description": desc,
                "sourceRow": i,
                "isLeaf": True,
                "order": len(reqs),
            }
        )
        qtext = _cell_str(row[5] if len(row) > 5 else "")
        if qtext:
            questions.append(
                {
                    "id": _stable_id("aq", rid, qtext[:40]),
                    "requirementId": rid,
                    "question": qtext,
                    "answerOptions": _cell_str(row[7] if len(row) > 7 else ""),
                    "serviceModel": {
                        "infra": _cell_str(row[2] if len(row) > 2 else ""),
                        "iaas": _cell_str(row[3] if len(row) > 3 else ""),
                        "paas": _cell_str(row[4] if len(row) > 4 else ""),
                    },
                    "qualificationLevels": {
                        "L1": _cell_str(row[8] if len(row) > 8 else ""),
                        "L2": _cell_str(row[9] if len(row) > 9 else ""),
                        "L3": _cell_str(row[10] if len(row) > 10 else ""),
                        "L4": _cell_str(row[11] if len(row) > 11 else ""),
                    },
                    "sourceRow": i,
                }
            )
    pkg = _framework_package(
        framework_id="reg-cloud-legacy",
        name="Reg.Cloud",
        legacy_name="Reg.Cloud",
        requirements=reqs,
        provenance=provenance,
    )
    pkg["assessmentQuestions"] = questions
    return pkg


def _convert_nis2(ws, provenance: dict) -> dict[str, Any]:
    reqs = []
    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        code = _cell_str(row[12] if len(row) > 12 else "")
        if not code:
            continue
        desc = _cell_str(row[13] if len(row) > 13 else "")
        text = _cell_str(row[14] if len(row) > 14 else "")
        rid = _stable_id("req", "nis2-legacy", code, str(i))
        reqs.append(
            {
                "id": rid,
                "code": code,
                "sourceCode": code,
                "title": text[:120] if text else code,
                "description": desc or text,
                "sourceRow": i,
                "isLeaf": True,
                "order": len(reqs),
            }
        )
    return _framework_package(
        framework_id="nis2-legacy",
        name="NIS2 (legacy matrix)",
        legacy_name="NIS2",
        requirements=reqs,
        provenance=provenance,
    )


def _convert_psnc(ws, provenance: dict) -> dict[str, Any]:
    reqs = []
    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        code = _cell_str(row[15] if len(row) > 15 else "")
        if not code:
            continue
        q = _cell_str(row[16] if len(row) > 16 else "")
        rid = _stable_id("req", "psnc-legacy", code, str(i))
        reqs.append(
            {
                "id": rid,
                "code": code,
                "sourceCode": code,
                "title": q[:120] if q else code,
                "description": q,
                "sourceRow": i,
                "isLeaf": True,
                "order": len(reqs),
            }
        )
    return _framework_package(
        framework_id="psnc-legacy",
        name="PSNC (legacy matrix)",
        legacy_name="PSNC",
        requirements=reqs,
        provenance=provenance,
    )


def _legacy_crosswalk(ws, provenance: dict) -> dict[str, Any]:
    candidates = []
    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        rc = _cell_str(row[1] if len(row) > 1 else "")
        nis2 = _cell_str(row[12] if len(row) > 12 else "")
        psnc = _cell_str(row[15] if len(row) > 15 else "")
        if not (rc and (nis2 or psnc)):
            continue
        if nis2:
            candidates.append(
                {
                    "id": _stable_id("lmc", "reg", rc, "nis2", nis2, str(i)),
                    "sourceFrameworkRequirement": {"framework": "reg-cloud-legacy", "code": rc},
                    "targetFrameworkRequirement": {"framework": "nis2-legacy", "code": nis2},
                    "sourceRow": i,
                    "reason": "legacy_row_alignment",
                    "status": "NEEDS_REVIEW",
                    "relation": None,
                }
            )
        if psnc:
            candidates.append(
                {
                    "id": _stable_id("lmc", "reg", rc, "psnc", psnc, str(i)),
                    "sourceFrameworkRequirement": {"framework": "reg-cloud-legacy", "code": rc},
                    "targetFrameworkRequirement": {"framework": "psnc-legacy", "code": psnc},
                    "sourceRow": i,
                    "reason": "legacy_row_alignment",
                    "status": "NEEDS_REVIEW",
                    "relation": None,
                }
            )
    return {
        "schemaVersion": "1.0",
        "mappingSet": {
            "id": _stable_id("ms", "legacy-crosswalk"),
            "revision": 1,
            "status": "DRAFT",
        },
        "candidates": candidates,
        "importSource": provenance,
    }


def _client_overlays(wb, provenance: dict) -> dict[str, dict]:
    overlays: dict[str, dict] = {}
    if SHEET_BUS in wb.sheetnames:
        rows = []
        ws = wb[SHEET_BUS]
        for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            if not any(row):
                continue
            rows.append(
                {
                    "sourceRow": i,
                    "scope": _cell_str(row[0]),
                    "policyReference": {"originalValue": _cell_str(row[19] if len(row) > 19 else "")},
                    "contractReference": _cell_str(row[20] if len(row) > 20 else ""),
                    "owners": _cell_str(row[24] if len(row) > 24 else ""),
                    "externalOwners": _cell_str(row[25] if len(row) > 25 else ""),
                    "recommendation": _cell_str(row[28] if len(row) > 28 else ""),
                    "regCloudCode": _cell_str(row[1] if len(row) > 1 else ""),
                }
            )
        overlays["business-overlay.json"] = {
            "schemaVersion": "1.0",
            "layer": "CLIENT_PROGRAM_OVERLAY",
            "clientSensitive": True,
            "rows": rows,
            "importSource": provenance,
        }
    return overlays


def _remediation_candidates(ws, provenance: dict) -> dict[str, Any]:
    items = []
    if ws is None:
        return {"schemaVersion": "1.0", "candidates": [], "importSource": provenance}
    for i, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not any(row):
            continue
        items.append(
            {
                "id": _stable_id("rem", str(i)),
                "title": _cell_str(row[0] if len(row) > 0 else ""),
                "source": SHEET_PTR,
                "sourceRow": i,
                "status": "NEEDS_REVIEW",
            }
        )
    return {"schemaVersion": "1.0", "candidates": items, "importSource": provenance}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Matrice_MultiCompliance importer")
    sub = parser.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze")
    a.add_argument("--input", type=Path, default=None)
    c = sub.add_parser("convert")
    c.add_argument("--input", type=Path, default=None)
    c.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    inp = args.input or default_input_path()
    if not inp.is_file():
        raise SystemExit(f"Input not found: {inp}")
    if args.cmd == "analyze":
        result = analyze_workbook(inp)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    summary = convert_workbook(inp, args.output)
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

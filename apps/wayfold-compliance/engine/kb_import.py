"""Knowledge Base JSON v1 import/export (atomic draft-only)."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from engine import framework_registry, framework_versions as fv
from engine.framework_versions import FrameworkRequirement, FrameworkVersionRecord, VersionStatus


def export_framework_version(version_id: str) -> dict[str, Any]:
    ver = fv.get_version(version_id)
    if ver is None:
        raise KeyError(version_id)
    fw = framework_registry.get_framework(ver.framework_id)
    return {
        "schemaVersion": "1.0",
        "framework": {
            "id": ver.framework_id,
            "name": ver.framework_name,
            "shortName": (fw.short_name if fw else "") or ver.framework_name,
            "type": (fw.type if fw else "Framework"),
            "publisher": ver.publisher or (fw.publisher if fw else ""),
            "jurisdiction": (fw.jurisdiction if fw else ""),
            "description": (fw.description if fw else ""),
            "officialSource": ver.source_url or (fw.official_url if fw else ""),
        },
        "version": {
            "id": ver.id,
            "label": ver.version,
            "status": ver.status,
            "publicationDate": ver.publication_date,
            "effectiveDate": ver.effective_date,
            "metadataStatus": "COMPLETE" if ver.publication_date else "INCOMPLETE",
        },
        "requirements": [
            {
                "id": r.id,
                "code": r.code,
                "sourceCode": r.code,
                "title": r.title,
                "description": r.description,
                "type": r.req_type,
                "section": r.section,
                "parentId": r.parent_id,
                "order": r.order,
                "isLeaf": r.is_leaf,
                "sourceReference": r.source_reference,
                "conditions": r.conditions,
                "frequency": r.frequency,
            }
            for r in ver.requirements
        ],
        "assessmentQuestions": [],
        "applicability": [],
    }


def import_framework_package(
    package: dict[str, Any],
    *,
    actor: str,
    allow_publish: bool = False,
) -> FrameworkVersionRecord:
    """Atomic import as DRAFT. Never publishes unless allow_publish and metadata complete."""
    fw_meta = package.get("framework") or {}
    ver_meta = package.get("version") or {}
    status = str(ver_meta.get("status") or VersionStatus.DRAFT.value).upper()
    if status != VersionStatus.DRAFT.value and not allow_publish:
        status = VersionStatus.DRAFT.value
    framework_id = str(fw_meta.get("id") or "").strip()
    if not framework_id:
        raise ValueError("framework_id_required")
    name = str(fw_meta.get("name") or framework_id)
    if not framework_registry.get_framework(framework_id):
        framework_registry.create_framework(
            name=name,
            short_name=str(fw_meta.get("shortName") or ""),
            type=str(fw_meta.get("type") or "Framework"),
            publisher=str(fw_meta.get("publisher") or ""),
            jurisdiction=str(fw_meta.get("jurisdiction") or ""),
            description=str(fw_meta.get("description") or ""),
            official_url=str(fw_meta.get("officialSource") or ""),
        )
    label = str(ver_meta.get("label") or "legacy-import")
    try:
        rec = fv.create_version(
            framework_id=framework_id,
            framework_name=name,
            publisher=str(fw_meta.get("publisher") or ""),
            version=label,
            publication_date=ver_meta.get("publicationDate"),
            effective_date=ver_meta.get("effectiveDate"),
            source_url=str(fw_meta.get("officialSource") or ""),
            status=status,
        )
    except ValueError as exc:
        if "duplicate_version_label" in str(exc):
            for existing in fv.list_versions(framework_id=framework_id):
                if existing.version == label and existing.status == VersionStatus.DRAFT.value:
                    rec = existing
                    rec.requirements = []
                    break
            else:
                raise
        else:
            raise
    reqs: list[FrameworkRequirement] = []
    for i, row in enumerate(package.get("requirements") or []):
        rid = str(row.get("id") or f"req-import-{i}")
        reqs.append(
            FrameworkRequirement(
                id=rid,
                code=str(row.get("code") or row.get("sourceCode") or ""),
                title=str(row.get("title") or ""),
                parent_id=row.get("parentId"),
                section=str(row.get("section") or ""),
                order=int(row.get("order") or i),
                description=str(row.get("description") or ""),
                req_type=str(row.get("type") or "Requisito"),
                source_reference=str(row.get("sourceReference") or ""),
                conditions=str(row.get("conditions") or ""),
                frequency=str(row.get("frequency") or ""),
                is_leaf=bool(row.get("isLeaf", True)),
            )
        )
    rec.requirements = reqs
    notes = rec.notes or ""
    prov = package.get("importSource") or package.get("provenance")
    if prov:
        notes = (notes + "\n" + json.dumps(prov, ensure_ascii=False)).strip()
    rec.notes = notes
    fv.upsert_version(rec)
    return rec


def validate_against_schema(package: dict[str, Any], schema_path: Path) -> list[str]:
    try:
        import jsonschema
    except ImportError:
        return []
    if not schema_path.is_file():
        return []
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(schema)
    return [f"{e.message}" for e in validator.iter_errors(package)]

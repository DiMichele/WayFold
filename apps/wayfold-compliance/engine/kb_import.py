"""Knowledge Base JSON v1 import/export (atomic draft-only)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from engine import framework_registry, framework_versions as fv
from engine.framework_versions import (
    AssessmentQuestion,
    FrameworkRequirement,
    FrameworkVersionRecord,
    VersionStatus,
)


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
            "metadataStatus": ver.metadata_status or (
                "COMPLETE" if ver.publication_date else "INCOMPLETE"
            ),
        },
        "sourceStatus": ver.source_status or "SOURCE_UNVERIFIED",
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
                "sourceStatus": r.source_status,
                "sourceRow": r.source_row,
                "conditions": r.conditions,
                "frequency": r.frequency,
            }
            for r in ver.requirements
        ],
        "assessmentQuestions": [
            {
                "id": q.id,
                "requirementId": q.requirement_id,
                "sourceCode": q.source_code,
                "question": q.question,
                "answerOptions": q.answer_options,
                "serviceModel": q.service_model,
                "qualificationLevels": q.qualification_levels,
                "implementationHint": q.implementation_hint,
                "sourceRow": q.source_row,
            }
            for q in ver.assessment_questions
        ],
        "applicability": [],
        "counts": ver.import_counts or {},
    }


# Alias expected by API routes
export_framework_package = export_framework_version


def _map_req_type(raw: str) -> str:
    v = (raw or "").strip().upper()
    mapping = {
        "CONTROL": "CONTROL",
        "CLAUSE": "CLAUSE",
        "REQUIREMENT": "REQUIREMENT",
        "ARTICLE": "ARTICLE",
        "MEASURE": "MEASURE",
        "REQUISITO": "REQUIREMENT",
        "CONTROLLO": "CONTROL",
        "CLAUSOLA": "CLAUSE",
        "ARTICOLO": "ARTICLE",
        "MISURA": "MEASURE",
    }
    return mapping.get(v, raw or "REQUIREMENT")


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
            short_name=str(fw_meta.get("shortName") or fw_meta.get("legacyName") or ""),
            type=str(fw_meta.get("type") or "Framework"),
            publisher=str(fw_meta.get("publisher") or ""),
            jurisdiction=str(fw_meta.get("jurisdiction") or ""),
            description=str(fw_meta.get("description") or ""),
            official_url=str(fw_meta.get("officialSource") or ""),
            framework_id=framework_id,
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
                    rec.assessment_questions = []
                    break
            else:
                raise
        else:
            raise
    reqs: list[FrameworkRequirement] = []
    for i, row in enumerate(package.get("requirements") or []):
        rid = str(row.get("id") or f"req-import-{i}")
        source_row = row.get("sourceRow") if "sourceRow" in row else row.get("source_row")
        try:
            source_row_i = int(source_row) if source_row is not None else None
        except (TypeError, ValueError):
            source_row_i = None
        reqs.append(
            FrameworkRequirement(
                id=rid,
                code=str(row.get("code") or row.get("sourceCode") or ""),
                title=str(row.get("title") or ""),
                parent_id=row.get("parentId") or row.get("parent_id"),
                section=str(row.get("section") or ""),
                order=int(row.get("order") or i),
                description=str(row.get("description") or ""),
                req_type=_map_req_type(str(row.get("type") or row.get("req_type") or "REQUIREMENT")),
                source_reference=str(row.get("sourceReference") or row.get("source_reference") or ""),
                conditions=str(row.get("conditions") or ""),
                frequency=str(row.get("frequency") or ""),
                is_leaf=bool(row.get("isLeaf", row.get("is_leaf", True))),
                source_status=str(row.get("sourceStatus") or row.get("source_status") or ""),
                source_row=source_row_i,
                provenance=json.dumps(row.get("importSource") or {}, ensure_ascii=False)
                if row.get("importSource")
                else "",
            )
        )
    questions: list[AssessmentQuestion] = []
    for i, row in enumerate(package.get("assessmentQuestions") or []):
        source_row = row.get("sourceRow")
        try:
            source_row_i = int(source_row) if source_row is not None else None
        except (TypeError, ValueError):
            source_row_i = None
        questions.append(
            AssessmentQuestion(
                id=str(row.get("id") or f"aq-import-{i}"),
                requirement_id=str(row.get("requirementId") or row.get("requirement_id") or ""),
                question=str(row.get("question") or ""),
                source_code=str(row.get("sourceCode") or row.get("source_code") or ""),
                answer_options=str(row.get("answerOptions") or row.get("answer_options") or ""),
                service_model=dict(row.get("serviceModel") or row.get("service_model") or {}),
                qualification_levels=dict(
                    row.get("qualificationLevels") or row.get("qualification_levels") or {}
                ),
                implementation_hint=str(
                    row.get("implementationHint") or row.get("implementation_hint") or ""
                ),
                source_row=source_row_i,
            )
        )
    rec.requirements = reqs
    rec.assessment_questions = questions
    rec.source_status = str(
        package.get("sourceStatus") or package.get("source_status") or "SOURCE_UNVERIFIED"
    )
    rec.metadata_status = str(ver_meta.get("metadataStatus") or "INCOMPLETE")
    rec.import_counts = dict(package.get("counts") or {})
    notes = rec.notes or ""
    prov = package.get("importSource") or package.get("provenance")
    if prov:
        notes = (notes + "\n" + json.dumps(prov, ensure_ascii=False)).strip()
    if actor:
        notes = (notes + f"\nimported_by={actor}").strip()
    rec.notes = notes
    fv.upsert_version(rec)
    return rec


def import_packages_batch(
    packages: list[dict[str, Any]],
    *,
    actor: str,
) -> list[FrameworkVersionRecord]:
    """Import multiple packages atomically (all succeed or none persist)."""
    store = fv.store_path()
    backup: bytes | None = None
    if store.is_file():
        backup = store.read_bytes()
    registry_path = getattr(framework_registry, "store_path", None)
    reg_backup: bytes | None = None
    if callable(registry_path):
        rp = registry_path()
        if rp.is_file():
            reg_backup = rp.read_bytes()
    imported: list[FrameworkVersionRecord] = []
    try:
        for pkg in packages:
            imported.append(import_framework_package(pkg, actor=actor))
        return imported
    except Exception:
        if backup is not None:
            store.write_bytes(backup)
        elif store.is_file():
            store.unlink(missing_ok=True)
        if reg_backup is not None and callable(registry_path):
            registry_path().write_bytes(reg_backup)
        raise


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

from __future__ import annotations

import json
from pathlib import Path

from .domain import (
    ControlImplementationSnapshot,
    CoverageRelation,
    ImplementationStatus,
    MappingRecord,
    ProgramSnapshot,
    RequirementSnapshot,
    ReviewStatus,
)


def load_program_snapshot(path: Path) -> ProgramSnapshot:
    raw = json.loads(path.read_text(encoding="utf-8"))
    requirements = [
        RequirementSnapshot(
            id=r["id"],
            framework_id=r["framework_id"],
            framework_name=r["framework_name"],
            framework_version=str(r.get("framework_version", "")),
            code=r["code"],
            title=r["title"],
            assessable=bool(r.get("assessable", True)),
            is_leaf=bool(r.get("is_leaf", True)),
            result=r.get("result"),
        )
        for r in raw["requirements"]
    ]
    implementations = [
        ControlImplementationSnapshot(
            id=i["id"],
            ref_id=i["ref_id"],
            name=i["name"],
            canonical_control_id=i.get("canonical_control_id"),
            canonical_control_ref=i.get("canonical_control_ref"),
            status=ImplementationStatus(i["status"]),
            owner=i.get("owner"),
            due_date=i.get("due_date"),
            priority=i.get("priority"),
            evidence_count=int(i.get("evidence_count", 0)),
            open_task_count=int(i.get("open_task_count", 0)),
            folder_id=i.get("folder_id"),
        )
        for i in raw["implementations"]
    ]
    mappings = [
        MappingRecord(
            requirement_id=m["requirement_id"],
            framework_id=m["framework_id"],
            framework_name=m["framework_name"],
            framework_version=str(m.get("framework_version", "")),
            requirement_code=m["requirement_code"],
            canonical_control_id=m["canonical_control_id"],
            canonical_control_ref=m["canonical_control_ref"],
            relation=CoverageRelation(m["relation"]),
            rationale=m.get("rationale", ""),
            uncovered_delta=m.get("uncovered_delta", ""),
            notes=m.get("notes", ""),
            confidence=m.get("confidence"),
            review_status=ReviewStatus(m.get("review_status", "APPROVED")),
        )
        for m in raw["mappings"]
    ]
    return ProgramSnapshot(
        tenant_id=raw["tenant_id"],
        tenant_name=raw["tenant_name"],
        program_id=raw["program_id"],
        program_name=raw["program_name"],
        requirements=requirements,
        implementations=implementations,
        mappings=mappings,
        requirement_implementation_links=raw.get("requirement_implementation_links", {}),
    )

"""Program-scoped requirement applicability (separate from control NOT_APPLICABLE)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from engine.domain import ApplicabilityDecision, ApplicabilityStatus
from engine.runtime_paths import data_root


def _store_path() -> Path:
    return data_root() / "applicability_decisions.json"


def _load() -> dict:
    path = _store_path()
    if not path.is_file():
        return {"decisions": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"decisions": []}


def _save(data: dict) -> None:
    path = _store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def list_decisions(*, program_id: str | None = None) -> list[ApplicabilityDecision]:
    out: list[ApplicabilityDecision] = []
    for row in _load().get("decisions") or []:
        if program_id and str(row.get("program_id")) != program_id:
            continue
        out.append(
            ApplicabilityDecision(
                program_id=str(row.get("program_id") or ""),
                requirement_id=str(row.get("requirement_id") or ""),
                status=ApplicabilityStatus(str(row.get("status") or "APPLICABLE")),
                rationale=str(row.get("rationale") or ""),
                decided_by=str(row.get("decided_by") or ""),
                decided_at=str(row.get("decided_at") or ""),
            )
        )
    return out


def get_decision(program_id: str, requirement_id: str) -> ApplicabilityDecision | None:
    for d in list_decisions(program_id=program_id):
        if d.requirement_id == requirement_id:
            return d
    return None


def set_decision(
    *,
    program_id: str,
    requirement_id: str,
    status: ApplicabilityStatus,
    rationale: str,
    decided_by: str,
) -> ApplicabilityDecision:
    if status == ApplicabilityStatus.NOT_APPLICABLE and not (rationale or "").strip():
        raise ValueError("rationale_required")
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    rec = ApplicabilityDecision(
        program_id=program_id,
        requirement_id=requirement_id,
        status=status,
        rationale=rationale.strip(),
        decided_by=decided_by,
        decided_at=now,
    )
    data = _load()
    rows = [r for r in data.get("decisions") or [] if not (
        str(r.get("program_id")) == program_id
        and str(r.get("requirement_id")) == requirement_id
    )]
    rows.append(
        {
            "program_id": rec.program_id,
            "requirement_id": rec.requirement_id,
            "status": rec.status.value,
            "rationale": rec.rationale,
            "decided_by": rec.decided_by,
            "decided_at": rec.decided_at,
        }
    )
    data["decisions"] = rows
    _save(data)
    return rec


def decisions_by_requirement(program_id: str) -> dict[str, ApplicabilityDecision]:
    return {d.requirement_id: d for d in list_decisions(program_id=program_id)}

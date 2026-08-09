"""Framework version registry with published immutability.

Published versions cannot be edited in-place. Workflow:
Published → clone draft → edit → review → publish.
"""

from __future__ import annotations

import copy
import json
import secrets
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from engine.runtime_paths import data_root


class VersionStatus(str, Enum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    RETIRED = "RETIRED"


@dataclass
class FrameworkRequirement:
    id: str
    code: str
    title: str
    parent_id: str | None = None
    section: str = ""
    source_url: str = ""
    order: int = 0


@dataclass
class FrameworkVersionRecord:
    id: str
    framework_id: str
    framework_name: str
    publisher: str
    version: str
    status: str
    requirements: list[FrameworkRequirement] = field(default_factory=list)
    effective_date: str | None = None
    source_url: str = ""
    cloned_from: str | None = None
    created_at: str = ""
    published_at: str | None = None


class ImmutabilityError(PermissionError):
    pass


def store_path() -> Path:
    return data_root() / "framework_versions.json"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _load() -> dict[str, Any]:
    path = store_path()
    if not path.is_file():
        return {"versions": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"versions": []}


def _save(data: dict[str, Any]) -> None:
    path = store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def _req_from(raw: dict[str, Any]) -> FrameworkRequirement:
    return FrameworkRequirement(
        id=str(raw.get("id") or ""),
        code=str(raw.get("code") or ""),
        title=str(raw.get("title") or ""),
        parent_id=raw.get("parent_id"),
        section=str(raw.get("section") or ""),
        source_url=str(raw.get("source_url") or ""),
        order=int(raw.get("order") or 0),
    )


def _ver_from(raw: dict[str, Any]) -> FrameworkVersionRecord:
    return FrameworkVersionRecord(
        id=str(raw["id"]),
        framework_id=str(raw.get("framework_id") or ""),
        framework_name=str(raw.get("framework_name") or ""),
        publisher=str(raw.get("publisher") or ""),
        version=str(raw.get("version") or ""),
        status=str(raw.get("status") or VersionStatus.DRAFT.value),
        requirements=[_req_from(r) for r in raw.get("requirements") or []],
        effective_date=raw.get("effective_date"),
        source_url=str(raw.get("source_url") or ""),
        cloned_from=raw.get("cloned_from"),
        created_at=str(raw.get("created_at") or ""),
        published_at=raw.get("published_at"),
    )


def list_versions(*, framework_id: str | None = None) -> list[FrameworkVersionRecord]:
    versions = [_ver_from(r) for r in _load().get("versions", [])]
    if framework_id:
        versions = [v for v in versions if v.framework_id == framework_id]
    versions.sort(key=lambda v: (v.framework_name, v.version), reverse=True)
    return versions


def get_version(version_id: str) -> FrameworkVersionRecord | None:
    for v in list_versions():
        if v.id == version_id:
            return v
    return None


def upsert_version(record: FrameworkVersionRecord, *, force: bool = False) -> FrameworkVersionRecord:
    existing = get_version(record.id)
    if existing and existing.status == VersionStatus.PUBLISHED.value and not force:
        raise ImmutabilityError("published_version_immutable")
    data = _load()
    rows = list(data.get("versions") or [])
    payload = asdict(record)
    found = False
    for i, row in enumerate(rows):
        if str(row.get("id")) == record.id:
            rows[i] = payload
            found = True
            break
    if not found:
        rows.append(payload)
    data["versions"] = rows
    _save(data)
    return record


def update_published_denied(version_id: str, patch: dict[str, Any]) -> None:
    """API-facing guard: PATCH on published → always denied."""
    ver = get_version(version_id)
    if ver is None:
        raise KeyError(version_id)
    if ver.status == VersionStatus.PUBLISHED.value:
        raise ImmutabilityError("published_version_immutable")
    for key, value in patch.items():
        if key == "requirements":
            ver.requirements = [_req_from(r) if isinstance(r, dict) else r for r in value]
        elif hasattr(ver, key) and key not in {"id", "status"}:
            setattr(ver, key, value)
    upsert_version(ver)


def update_requirement(version_id: str, requirement_id: str, patch: dict[str, Any]) -> FrameworkRequirement:
    ver = get_version(version_id)
    if ver is None:
        raise KeyError(version_id)
    if ver.status == VersionStatus.PUBLISHED.value:
        raise ImmutabilityError("published_requirement_immutable")
    for req in ver.requirements:
        if req.id == requirement_id:
            for key, value in patch.items():
                if hasattr(req, key) and key != "id":
                    setattr(req, key, value)
            upsert_version(ver)
            return req
    raise KeyError(requirement_id)


def clone_draft(version_id: str, *, new_version: str) -> FrameworkVersionRecord:
    src = get_version(version_id)
    if src is None:
        raise KeyError(version_id)
    draft = FrameworkVersionRecord(
        id=f"fv-{secrets.token_hex(6)}",
        framework_id=src.framework_id,
        framework_name=src.framework_name,
        publisher=src.publisher,
        version=new_version,
        status=VersionStatus.DRAFT.value,
        requirements=copy.deepcopy(src.requirements),
        effective_date=None,
        source_url=src.source_url,
        cloned_from=src.id,
        created_at=_now(),
        published_at=None,
    )
    return upsert_version(draft)


def publish_version(version_id: str) -> FrameworkVersionRecord:
    ver = get_version(version_id)
    if ver is None:
        raise KeyError(version_id)
    if ver.status == VersionStatus.PUBLISHED.value:
        return ver
    # Retire previous published for same framework
    for other in list_versions(framework_id=ver.framework_id):
        if other.id != ver.id and other.status == VersionStatus.PUBLISHED.value:
            other.status = VersionStatus.RETIRED.value
            upsert_version(other, force=True)
    ver.status = VersionStatus.PUBLISHED.value
    ver.published_at = _now()
    return upsert_version(ver, force=True)


def seed_from_programs(programs: list[Any]) -> list[FrameworkVersionRecord]:
    """Bootstrap KB versions from demo program snapshots (idempotent by framework+version)."""
    existing = {(v.framework_id, v.version): v for v in list_versions()}
    created: list[FrameworkVersionRecord] = []
    for program in programs:
        seen_fw: set[tuple[str, str]] = set()
        for req in program.requirements:
            key = (req.framework_id, req.framework_version)
            if key in seen_fw:
                continue
            seen_fw.add(key)
            if key in existing:
                continue
            reqs = [
                FrameworkRequirement(
                    id=r.id,
                    code=r.code,
                    title=r.title,
                    parent_id=_infer_parent(r.code),
                    section=r.code.split(".")[0] if "." in r.code else r.code[:3],
                    order=i,
                )
                for i, r in enumerate(
                    x for x in program.requirements if x.framework_id == req.framework_id
                )
            ]
            rec = FrameworkVersionRecord(
                id=f"fv-{req.framework_id}-{req.framework_version}".replace(" ", "_"),
                framework_id=req.framework_id,
                framework_name=req.framework_name,
                publisher=_publisher_for(req.framework_name),
                version=req.framework_version,
                status=VersionStatus.PUBLISHED.value,
                requirements=reqs,
                created_at=_now(),
                published_at=_now(),
            )
            upsert_version(rec, force=True)
            existing[key] = rec
            created.append(rec)
        for avail in getattr(program, "available_framework_versions", []) or []:
            fw_id = str(avail.get("framework_id") or "")
            ver = str(avail.get("version") or "")
            status = str(avail.get("status") or VersionStatus.DRAFT.value)
            name = str(avail.get("framework_name") or fw_id)
            if not fw_id or not ver:
                continue
            key = (fw_id, ver)
            if key in existing:
                continue
            rec = FrameworkVersionRecord(
                id=f"fv-{fw_id}-{ver}".replace(" ", "_"),
                framework_id=fw_id,
                framework_name=name,
                publisher=_publisher_for(name),
                version=ver,
                status=status,
                requirements=[],
                created_at=_now(),
            )
            upsert_version(rec, force=True)
            existing[key] = rec
            created.append(rec)
    return created


def _infer_parent(code: str) -> str | None:
    if "." not in code:
        return None
    parts = code.split(".")
    if len(parts) <= 1:
        return None
    return ".".join(parts[:-1])


def _publisher_for(name: str) -> str:
    n = name.lower()
    if "nis2" in n:
        return "ACN / UE"
    if "iso" in n:
        return "ISO/IEC"
    if "psnc" in n:
        return "ACN"
    if "dora" in n:
        return "UE"
    return "Publisher"


def diff_versions(from_id: str, to_id: str) -> dict[str, Any]:
    a = get_version(from_id)
    b = get_version(to_id)
    if a is None or b is None:
        raise KeyError("version_not_found")
    a_map = {r.code: r for r in a.requirements}
    b_map = {r.code: r for r in b.requirements}
    added = [asdict(b_map[c]) for c in b_map if c not in a_map]
    removed = [asdict(a_map[c]) for c in a_map if c not in b_map]
    modified = []
    for code in a_map:
        if code in b_map and (
            a_map[code].title != b_map[code].title
            or a_map[code].section != b_map[code].section
        ):
            modified.append({"from": asdict(a_map[code]), "to": asdict(b_map[code])})
    return {
        "from": {"id": a.id, "version": a.version, "status": a.status},
        "to": {"id": b.id, "version": b.version, "status": b.status},
        "added": added,
        "removed": removed,
        "modified": modified,
        "mapping_changes": [],  # filled by caller when program mappings available
        "client_impact_note": (
            "I programmi con baseline bloccata sulla versione precedente "
            "non vengono aggiornati automaticamente."
        ),
    }

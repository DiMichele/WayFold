from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from .checklist import build_unified_checklist
from .dates import is_overdue, is_upcoming, today
from .domain import ImplementationStatus, ProgramSnapshot, UnifiedChecklist


@dataclass
class OwnerWorkItem:
    owner: str
    control_ref: str | None
    name: str
    status: str
    priority: str | None
    due_date: str | None
    open_task_count: int
    evidence_count: int
    frameworks: list[str]


@dataclass
class DeadlineItem:
    due_date: str
    owner: str | None
    control_ref: str | None
    name: str
    status: str
    priority: str | None
    open_task_count: int
    overdue: bool


@dataclass
class EvidenceItem:
    control_ref: str | None
    name: str
    status: str
    owner: str | None
    evidence_count: int
    missing: bool
    due_date: str | None
    frameworks: list[str]


@dataclass
class TaskItem:
    control_ref: str | None
    name: str
    owner: str | None
    due_date: str | None
    priority: str | None
    open_task_count: int
    status: str
    overdue: bool


@dataclass
class ControlCoverageDetail:
    framework_id: str
    framework_name: str
    framework_version: str
    requirement_id: str
    requirement_code: str
    requirement_title: str
    relation: str
    uncovered_delta: str
    rationale: str


@dataclass
class ControlDetail:
    """Drill-down from Gap / Owner / Deadline: coverage, deltas, evidence, tasks."""

    control_ref: str
    name: str
    status: str
    owner: str | None
    due_date: str | None
    priority: str | None
    evidence_count: int
    open_task_count: int
    gap_notes: str
    framework_coverage: list[ControlCoverageDetail]
    program_id: str
    tenant_id: str


def control_detail(
    program: ProgramSnapshot,
    control_ref: str,
    checklist: UnifiedChecklist | None = None,
) -> ControlDetail | None:
    """Resolve a canonical control from the unified checklist (pinned program)."""
    checklist = checklist or build_unified_checklist(program)
    key = (control_ref or "").strip().lower()
    if not key:
        return None
    req_title = {r.id: r.title for r in program.requirements}
    for ctrl in checklist.controls:
        ref = (ctrl.canonical_control_ref or "").strip()
        if ref.lower() != key and (ctrl.control_key or "").lower() != key:
            continue
        return ControlDetail(
            control_ref=ref or ctrl.control_key,
            name=ctrl.name,
            status=ctrl.status.value,
            owner=ctrl.owner,
            due_date=ctrl.due_date,
            priority=ctrl.priority,
            evidence_count=ctrl.evidence_count,
            open_task_count=ctrl.open_task_count,
            gap_notes=ctrl.gap_notes,
            framework_coverage=[
                ControlCoverageDetail(
                    framework_id=c.framework_id,
                    framework_name=c.framework_name,
                    framework_version=c.framework_version,
                    requirement_id=c.requirement_id,
                    requirement_code=c.requirement_code,
                    requirement_title=req_title.get(c.requirement_id, ""),
                    relation=c.relation.value,
                    uncovered_delta=c.uncovered_delta or "",
                    rationale=c.rationale or "",
                )
                for c in ctrl.framework_coverage
            ],
            program_id=program.program_id,
            tenant_id=program.tenant_id,
        )
    return None


def owner_view(
    program: ProgramSnapshot, checklist: UnifiedChecklist | None = None
) -> dict[str, list[OwnerWorkItem]]:
    checklist = checklist or build_unified_checklist(program)
    by_owner: dict[str, list[OwnerWorkItem]] = defaultdict(list)
    for ctrl in checklist.controls:
        has_open_delta = any(
            c.relation.value in {"PARTIAL", "SUPPORTING"} and c.uncovered_delta
            for c in ctrl.framework_coverage
        )
        # Include open work: non-implemented, open tasks, or residual mapping deltas
        if (
            ctrl.status == ImplementationStatus.IMPLEMENTED
            and ctrl.open_task_count == 0
            and not has_open_delta
        ):
            continue
        owner = ctrl.owner or "(unassigned)"
        by_owner[owner].append(
            OwnerWorkItem(
                owner=owner,
                control_ref=ctrl.canonical_control_ref,
                name=ctrl.name,
                status=ctrl.status.value,
                priority=ctrl.priority,
                due_date=ctrl.due_date,
                open_task_count=ctrl.open_task_count,
                evidence_count=ctrl.evidence_count,
                frameworks=sorted({c.framework_name for c in ctrl.framework_coverage}),
            )
        )
    for items in by_owner.values():
        items.sort(key=lambda i: (i.due_date or "9999", i.priority or "ZZZ"))
    return dict(sorted(by_owner.items()))


def deadline_view(
    program: ProgramSnapshot,
    checklist: UnifiedChecklist | None = None,
    *,
    days: int = 60,
    as_of: date | None = None,
) -> list[DeadlineItem]:
    as_of = as_of or today()
    checklist = checklist or build_unified_checklist(program)
    items: list[DeadlineItem] = []
    for ctrl in checklist.controls:
        if not ctrl.due_date:
            continue
        overdue = is_overdue(ctrl.due_date, as_of=as_of)
        upcoming = is_upcoming(ctrl.due_date, days=days, as_of=as_of)
        if not overdue and not upcoming:
            continue
        if ctrl.status == ImplementationStatus.IMPLEMENTED and ctrl.open_task_count == 0 and not overdue:
            continue
        items.append(
            DeadlineItem(
                due_date=ctrl.due_date,
                owner=ctrl.owner,
                control_ref=ctrl.canonical_control_ref,
                name=ctrl.name,
                status=ctrl.status.value,
                priority=ctrl.priority,
                open_task_count=ctrl.open_task_count,
                overdue=overdue,
            )
        )
    items.sort(key=lambda i: (not i.overdue, i.due_date))
    return items


def evidence_view(
    program: ProgramSnapshot, checklist: UnifiedChecklist | None = None
) -> list[EvidenceItem]:
    checklist = checklist or build_unified_checklist(program)
    items: list[EvidenceItem] = []
    for ctrl in checklist.controls:
        items.append(
            EvidenceItem(
                control_ref=ctrl.canonical_control_ref,
                name=ctrl.name,
                status=ctrl.status.value,
                owner=ctrl.owner,
                evidence_count=ctrl.evidence_count,
                missing=ctrl.evidence_count <= 0
                and ctrl.status != ImplementationStatus.NOT_APPLICABLE,
                due_date=ctrl.due_date,
                frameworks=sorted({c.framework_name for c in ctrl.framework_coverage}),
            )
        )
    items.sort(key=lambda i: (not i.missing, i.control_ref or i.name))
    return items


def task_view(
    program: ProgramSnapshot,
    checklist: UnifiedChecklist | None = None,
    *,
    as_of: date | None = None,
) -> list[TaskItem]:
    as_of = as_of or today()
    checklist = checklist or build_unified_checklist(program)
    items: list[TaskItem] = []
    for ctrl in checklist.controls:
        if ctrl.open_task_count <= 0:
            continue
        items.append(
            TaskItem(
                control_ref=ctrl.canonical_control_ref,
                name=ctrl.name,
                owner=ctrl.owner,
                due_date=ctrl.due_date,
                priority=ctrl.priority,
                open_task_count=ctrl.open_task_count,
                status=ctrl.status.value,
                overdue=is_overdue(ctrl.due_date, as_of=as_of),
            )
        )
    items.sort(key=lambda i: (not i.overdue, i.due_date or "9999"))
    return items

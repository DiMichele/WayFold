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

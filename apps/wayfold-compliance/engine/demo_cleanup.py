"""Identify and remove WF_REVIEW_DEMO_2026 / [Demo] entities from a data directory.

Production default: plan-only. Use --apply to delete planned items only.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from engine.runtime_paths import data_root

DATASET_MARKER = "WF_REVIEW_DEMO_2026"
DEMO_NAME_MARKERS = ("[Demo]",)


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _is_demo_name(name: str) -> bool:
    return any(m in (name or "") for m in DEMO_NAME_MARKERS)


def _plan_item(
    *,
    entity_type: str,
    entity_id: str,
    name: str,
    demo_marker: str,
    reason: str,
    action: str,
    path: str = "",
) -> dict[str, Any]:
    return {
        "entity_type": entity_type,
        "id": entity_id,
        "name": name,
        "demo_marker": demo_marker,
        "reason": reason,
        "action": action,
        "path": path,
    }


def build_cleanup_plan(root: Path | None = None) -> dict[str, Any]:
    root = root or data_root()
    items: list[dict[str, Any]] = []
    preserve: list[dict[str, Any]] = []

    programs_dir = root / "programs"
    if programs_dir.is_dir():
        for path in sorted(programs_dir.glob("*.json")):
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                preserve.append(
                    _plan_item(
                        entity_type="program_file",
                        entity_id=path.name,
                        name=path.name,
                        demo_marker="",
                        reason="unreadable_json",
                        action="PRESERVE_REVIEW_REQUIRED",
                        path=str(path),
                    )
                )
                continue
            tenant = str(raw.get("tenant_name") or "")
            marker = str(raw.get("dataset_marker") or "")
            pid = str(raw.get("program_id") or path.stem)
            if marker == DATASET_MARKER or _is_demo_name(tenant):
                items.append(
                    _plan_item(
                        entity_type="program",
                        entity_id=pid,
                        name=tenant or path.name,
                        demo_marker=marker or "[Demo]",
                        reason="demo_dataset_marker" if marker == DATASET_MARKER else "demo_name",
                        action="DELETE",
                        path=str(path),
                    )
                )
            else:
                preserve.append(
                    _plan_item(
                        entity_type="program",
                        entity_id=pid,
                        name=tenant or path.name,
                        demo_marker="",
                        reason="no_demo_marker",
                        action="PRESERVE_REVIEW_REQUIRED",
                        path=str(path),
                    )
                )

    registry_path = root / "portfolio_registry.json"
    if registry_path.is_file():
        try:
            reg = json.loads(registry_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            reg = {}
        for entry in reg.get("programs") or []:
            marker = str(entry.get("dataset_marker") or "")
            snap = str(entry.get("snapshot") or "")
            if marker == DATASET_MARKER or DATASET_MARKER in snap or "[Demo]" in snap:
                items.append(
                    _plan_item(
                        entity_type="registry_entry",
                        entity_id=snap,
                        name=snap,
                        demo_marker=marker or DATASET_MARKER,
                        reason="demo_registry_entry",
                        action="DELETE",
                        path=str(registry_path),
                    )
                )

    clients_path = root / "clients.json"
    if clients_path.is_file():
        try:
            clients = json.loads(clients_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            clients = {"clients": []}
        for c in clients.get("clients") or []:
            name = str(c.get("name") or c.get("legal_name") or "")
            marker = str(c.get("dataset_marker") or "")
            cid = str(c.get("id") or c.get("tenant_id") or "")
            if marker == DATASET_MARKER or _is_demo_name(name):
                items.append(
                    _plan_item(
                        entity_type="client",
                        entity_id=cid,
                        name=name,
                        demo_marker=marker or "[Demo]",
                        reason="demo_client",
                        action="DELETE",
                        path=str(clients_path),
                    )
                )
            elif cid or name:
                preserve.append(
                    _plan_item(
                        entity_type="client",
                        entity_id=cid,
                        name=name,
                        demo_marker="",
                        reason="no_demo_marker",
                        action="PRESERVE_REVIEW_REQUIRED",
                        path=str(clients_path),
                    )
                )

    # Demo seed frameworks: synthetic names from review seed
    demo_fw_ids = {
        "iso-27001-2022-demo",
        "nis2-italia-demo",
        "psnc-demo",
        "qc4-demo",
        "dora-demo",
        "ai-act-demo",
        "iso-42001-demo",
        "csa-star-demo",
        # Product-review seed framework_ids used in live/prod before cleanup
        "fw-iso27001-2022",
        "fw-nis2-it-2026-1",
        "fw-psnc-2025-3",
        "fw-qc4-2025",
        "fw-dora-2025",
        "fw-aiact-2026",
        "fw-iso42001-2023",
        "fw-ccm-v4",
    }
    tiny_demo_req_cap = 12  # seed frameworks had tiny corpora vs real import
    fw_store = root / "framework_versions.json"
    if fw_store.is_file():
        try:
            data = json.loads(fw_store.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {"versions": []}
        for ver in data.get("versions") or []:
            fw_id = str(ver.get("framework_id") or "")
            name = str(ver.get("framework_name") or "")
            notes = str(ver.get("notes") or "")
            n_req = len(ver.get("requirements") or [])
            is_legacy_import = fw_id.endswith("-legacy") or "legacy-import" in str(
                ver.get("version") or ""
            )
            seed_like = (
                fw_id in demo_fw_ids
                or _is_demo_name(name)
                or DATASET_MARKER in notes
                or "review demo" in notes.lower()
                or (
                    not is_legacy_import
                    and n_req > 0
                    and n_req <= tiny_demo_req_cap
                    and any(
                        x in name
                        for x in (
                            "ISO/IEC 27001",
                            "NIS2",
                            "PSNC",
                            "DORA",
                            "AI Act",
                            "42001",
                            "QC4",
                            "CSA STAR",
                            "CCM",
                        )
                    )
                )
            )
            if seed_like:
                items.append(
                    _plan_item(
                        entity_type="framework_version",
                        entity_id=str(ver.get("id") or ""),
                        name=f"{name}@{ver.get('version')}",
                        demo_marker=DATASET_MARKER,
                        reason="demo_seed_framework",
                        action="DELETE",
                        path=str(fw_store),
                    )
                )

    # Also purge demo framework registry metadata for seed ids
    reg_fw = root / "framework_registry.json"
    if reg_fw.is_file():
        try:
            reg_data = json.loads(reg_fw.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            reg_data = {"frameworks": []}
        for fw in reg_data.get("frameworks") or []:
            fid = str(fw.get("id") or "")
            if fid in demo_fw_ids or _is_demo_name(str(fw.get("name") or "")):
                items.append(
                    _plan_item(
                        entity_type="framework_registry",
                        entity_id=fid,
                        name=str(fw.get("name") or fid),
                        demo_marker=DATASET_MARKER,
                        reason="demo_seed_framework_registry",
                        action="DELETE",
                        path=str(reg_fw),
                    )
                )

    # Evidence / tasks under demo programs are removed with program files;
    # scan evidence store for demo markers if present.
    for sub in ("evidence", "tasks", "report_snapshots", "audit"):
        d = root / sub
        if not d.is_dir():
            continue
        for path in d.rglob("*"):
            if not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if DATASET_MARKER in text or "[Demo]" in text:
                items.append(
                    _plan_item(
                        entity_type=sub.rstrip("s") if sub.endswith("s") else sub,
                        entity_id=path.name,
                        name=path.name,
                        demo_marker=DATASET_MARKER if DATASET_MARKER in text else "[Demo]",
                        reason=f"demo_marker_in_{sub}",
                        action="DELETE",
                        path=str(path),
                    )
                )

    return {
        "generated_at": _now(),
        "data_root": str(root),
        "dataset_marker": DATASET_MARKER,
        "delete": items,
        "preserve_review_required": preserve,
        "summary": {
            "delete_count": len(items),
            "preserve_review_count": len(preserve),
        },
    }


def apply_cleanup_plan(plan: dict[str, Any], *, root: Path | None = None) -> dict[str, Any]:
    root = root or Path(plan.get("data_root") or data_root())
    deleted: list[str] = []
    # Delete standalone files first
    for item in plan.get("delete") or []:
        if item.get("action") != "DELETE":
            continue
        et = item.get("entity_type")
        path = Path(item.get("path") or "")
        if et == "program" and path.is_file():
            path.unlink(missing_ok=True)
            deleted.append(str(path))
        elif et in {"evidence", "task", "report_snapshot", "audit"} and path.is_file():
            path.unlink(missing_ok=True)
            deleted.append(str(path))

    # Rewrite registry
    registry_path = root / "portfolio_registry.json"
    if registry_path.is_file():
        try:
            reg = json.loads(registry_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            reg = {"programs": []}
        kept = []
        for entry in reg.get("programs") or []:
            marker = str(entry.get("dataset_marker") or "")
            snap = str(entry.get("snapshot") or "")
            if marker == DATASET_MARKER or DATASET_MARKER in snap or "[Demo]" in snap:
                continue
            kept.append(entry)
        reg["programs"] = kept
        if reg.get("dataset_marker") == DATASET_MARKER:
            reg.pop("dataset_marker", None)
        registry_path.write_text(json.dumps(reg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        deleted.append(f"registry_filtered:{registry_path}")

    # Rewrite clients
    clients_path = root / "clients.json"
    if clients_path.is_file():
        try:
            clients = json.loads(clients_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            clients = {"clients": []}
        kept_c = []
        for c in clients.get("clients") or []:
            name = str(c.get("name") or c.get("legal_name") or "")
            marker = str(c.get("dataset_marker") or "")
            if marker == DATASET_MARKER or _is_demo_name(name):
                continue
            kept_c.append(c)
        clients["clients"] = kept_c
        clients_path.write_text(
            json.dumps(clients, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        deleted.append(f"clients_filtered:{clients_path}")

    # Rewrite framework versions (remove demo seed only)
    demo_ids = {i["id"] for i in plan.get("delete") or [] if i.get("entity_type") == "framework_version"}
    fw_store = root / "framework_versions.json"
    if fw_store.is_file() and demo_ids:
        data = json.loads(fw_store.read_text(encoding="utf-8"))
        data["versions"] = [v for v in (data.get("versions") or []) if str(v.get("id")) not in demo_ids]
        fw_store.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        deleted.append(f"framework_versions_filtered:{fw_store}")

    # Rewrite framework registry
    demo_fw_reg = {
        i["id"] for i in plan.get("delete") or [] if i.get("entity_type") == "framework_registry"
    }
    reg_fw = root / "framework_registry.json"
    if reg_fw.is_file() and demo_fw_reg:
        data = json.loads(reg_fw.read_text(encoding="utf-8"))
        data["frameworks"] = [
            f for f in (data.get("frameworks") or []) if str(f.get("id")) not in demo_fw_reg
        ]
        reg_fw.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        deleted.append(f"framework_registry_filtered:{reg_fw}")

    # Strip demo mappings tied to seed frameworks
    map_path = root / "kb_mappings.json"
    if map_path.is_file():
        try:
            maps = json.loads(map_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            maps = {}
        before = len(maps.get("mappings") or [])
        kept = []
        for m in maps.get("mappings") or []:
            blob = json.dumps(m, ensure_ascii=False)
            if DATASET_MARKER in blob or "[Demo]" in blob:
                continue
            fw = str(m.get("framework_id") or "")
            if fw.startswith("fw-") and fw in {
                "fw-iso27001-2022",
                "fw-nis2-it-2026-1",
                "fw-psnc-2025-3",
                "fw-qc4-2025",
                "fw-dora-2025",
                "fw-aiact-2026",
                "fw-iso42001-2023",
                "fw-ccm-v4",
            }:
                continue
            kept.append(m)
        maps["mappings"] = kept
        if len(kept) != before:
            map_path.write_text(json.dumps(maps, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            deleted.append(f"kb_mappings_filtered:{before - len(kept)}")

    # Audit append
    audit_dir = root / "audit"
    audit_dir.mkdir(parents=True, exist_ok=True)
    event = {
        "at": _now(),
        "action": "demo_cleanup",
        "deleted_count": len(deleted),
        "plan_summary": plan.get("summary"),
    }
    with (audit_dir / "demo_cleanup.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")

    return {"deleted": deleted, "audit": event}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Demo data cleanup planner/applier")
    parser.add_argument("--data-dir", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=None, help="Write DEMO-DATA-CLEANUP-PLAN.json")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    root = args.data_dir or data_root()
    plan = build_cleanup_plan(root)
    out = args.out or (root / "DEMO-DATA-CLEANUP-PLAN.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"plan": str(out), "summary": plan["summary"]}, indent=2))
    if args.apply:
        result = apply_cleanup_plan(plan, root=root)
        print(json.dumps({"applied": True, "deleted_count": len(result["deleted"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

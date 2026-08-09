"""WayFold Compliance — consultant-facing HTTP surface.

Run:
  python -m engine.api
Default: http://127.0.0.1:8092
Auth: ?superuser=1 OR ?actor_tenants=<tenant-id>[,...]
      With WAYFOLD_OPEN_ACCESS=1, HTML/API browse as consultant demo (no product login).
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.authz import assert_tenant_access
from engine.checklist import build_unified_checklist
from engine.consultant_views import (
    control_detail,
    deadline_view,
    evidence_view,
    owner_view,
    task_view,
)
from engine.gap_assessment import GapFilter, build_gap_rows, filter_gap_rows
from engine.impact import rank_control_impact
from engine.portfolio import (
    DEFAULT_REGISTRY,
    build_client_dashboard,
    build_portfolio,
    load_portfolio_programs,
)
from engine.program_loader import load_program_snapshot
from engine.readiness import framework_readiness
from engine.reports import report_csv, report_html
from engine.serialize import to_jsonable
from engine.ui_shell import render_shell
from engine import ux_pages
from engine.regulatory.demo import seed_demo_source
from engine.regulatory.domain import ChangeStatus
from engine.regulatory.pipeline import check_source, impact_for_change, review_change
from engine.regulatory.store import RegulatoryStore
from engine.regulatory import pages as reg_pages
from engine.ai.domain import SuggestionReviewStatus
from engine.ai.service import AIAssistanceService, AIProcessingDisabled
from engine.ai.store import AIStore
from engine.ai import pages as ai_pages
from engine.automated_evidence.domain import EvidenceReviewStatus
from engine.automated_evidence.demo import seed_demo_connector
from engine.automated_evidence.service import AutomatedEvidenceService
from engine.automated_evidence.store import AutomatedEvidenceStore
from engine.automated_evidence import pages as auto_ev_pages

DEFAULT_PROGRAM = ROOT / "engine" / "fixtures" / "michele_phase2_program.json"
_REG_STORE: RegulatoryStore | None = None
_AI_SERVICE: AIAssistanceService | None = None
_AUTO_EV_SERVICE: AutomatedEvidenceService | None = None


def _reg_store() -> RegulatoryStore:
    global _REG_STORE
    if _REG_STORE is None:
        _REG_STORE = RegulatoryStore()
        if not _REG_STORE.list_sources():
            seed_demo_source(_REG_STORE)
    return _REG_STORE


def _ai_service() -> AIAssistanceService:
    global _AI_SERVICE
    if _AI_SERVICE is None:
        _AI_SERVICE = AIAssistanceService(
            store=AIStore(), regulatory_store=_reg_store()
        )
    return _AI_SERVICE


def _auto_ev_service() -> AutomatedEvidenceService:
    global _AUTO_EV_SERVICE
    if _AUTO_EV_SERVICE is None:
        store = AutomatedEvidenceStore()
        if not store.list_connectors():
            seed_demo_connector(store)
        _AUTO_EV_SERVICE = AutomatedEvidenceService(store=store)
    return _AUTO_EV_SERVICE


def _open_access_enabled() -> bool:
    return os.environ.get("WAYFOLD_OPEN_ACCESS", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _auth_from_qs(qs: dict) -> tuple[set[str], bool]:
    actor_tenants = {
        t.strip() for t in qs.get("actor_tenants", [""])[0].split(",") if t.strip()
    }
    is_super = qs.get("superuser", ["0"])[0].lower() in {"1", "true", "yes"}
    # Product has no WayFold login yet — production demo opens as consultant.
    if _open_access_enabled() and not actor_tenants and not is_super:
        return set(), True
    return actor_tenants, is_super


def _nav_qs(qs: dict, *, program_id: str | None = None) -> str:
    actor = qs.get("actor_tenants", [""])[0]
    superuser = qs.get("superuser", ["0"])[0]
    pid = program_id or qs.get("program_id", [""])[0]
    data = {}
    if superuser in {"1", "true", "yes"}:
        data["superuser"] = "1"
    if actor:
        data["actor_tenants"] = actor
    if pid:
        data["program_id"] = pid
    return urlencode(data)


def _resolve_program(qs: dict):
    """Resolve program snapshot from program_id (portfolio) or program path."""
    program_path = qs.get("program", [None])[0]
    program_id = qs.get("program_id", [None])[0]
    if program_path:
        path = Path(program_path)
        if path.is_file():
            return load_program_snapshot(path)
    if program_id:
        for program, _ in load_portfolio_programs(DEFAULT_REGISTRY):
            if program.program_id == program_id:
                return program
    # default Michele demo
    return load_program_snapshot(DEFAULT_PROGRAM)


def _html_checklist(checklist, readiness, impact, nav_qs: str = "") -> str:
    rows = []
    for c in checklist.controls:
        cov = "<br>".join(
            f"{x.framework_name} {x.requirement_code} "
            f"<strong>{x.relation.value}</strong>"
            + (f" — delta: {x.uncovered_delta}" if x.uncovered_delta else "")
            for x in c.framework_coverage
        )
        rows.append(
            "<tr>"
            f"<td>{c.canonical_control_ref or ''}</td>"
            f"<td>{c.name}</td>"
            f"<td>{c.status.value}</td>"
            f"<td>{cov}</td>"
            f"<td>{c.owner or ''}</td>"
            f"<td>{c.due_date or ''}</td>"
            f"<td>{c.priority or ''}</td>"
            f"<td>{c.evidence_count}</td>"
            f"<td>{c.open_task_count}</td>"
            f"<td>{c.gap_notes}</td>"
            "</tr>"
        )
    unmapped = "".join(
        f"<li>{u.framework_name} <code>{u.code}</code> — {u.title}</li>"
        for u in checklist.unmapped
    )
    ready_rows = "".join(
        "<tr>"
        f"<td>{r.framework_name}</td><td>{r.framework_version}</td>"
        f"<td>{r.fully_covered}</td><td>{r.partially_covered}</td>"
        f"<td>{r.not_covered}</td><td>{r.unmapped}</td>"
        f"<td>{r.not_applicable}</td>"
        f"<td>{(r.implementation_readiness or 0):.0%}</td>"
        "</tr>"
        for r in readiness
    )
    impact_items = "".join(f"<li>{i.readable_summary}</li>" for i in impact[:10])
    body = f"""
<h1>Unified Checklist</h1>
<p class="meta">{checklist.program_name} · raw requirements {checklist.raw_requirement_count}
 · unified controls {checklist.unified_control_count}
 · unmapped {len(checklist.unmapped)}</p>
<section>
<table>
<thead><tr>
<th>Control</th><th>Name</th><th>Status</th><th>Framework coverage</th>
<th>Owner</th><th>Deadline</th><th>Priority</th><th>Evidence</th><th>Tasks</th><th>Gap/delta</th>
</tr></thead>
<tbody>{''.join(rows)}</tbody>
</table>
</section>
<section>
<h2>Unmapped requirements</h2>
<ul class="compact">{unmapped or '<li>None</li>'}</ul>
</section>
<section>
<h2>Framework readiness</h2>
<table><thead><tr>
<th>Framework</th><th>Version</th><th>FULLY</th><th>PARTIAL</th><th>NOT</th>
<th>UNMAPPED</th><th>N/A</th><th>Impl readiness</th>
</tr></thead><tbody>{ready_rows}</tbody></table>
</section>
<section>
<h2>Control impact</h2>
<ul class="compact">{impact_items}</ul>
</section>
"""
    return render_shell(
        f"Unified Checklist — {checklist.program_name}",
        nav_qs,
        body,
    )


class Handler(BaseHTTPRequestHandler):
    def _deny(self, code: int, msg: str):
        body = json.dumps({"error": msg}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send(self, code: int, body: bytes, content_type: str):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _gate(self, qs: dict, target_tenant_id: str | None = None):
        actor_tenants, is_super = _auth_from_qs(qs)
        if not is_super and not actor_tenants:
            self._deny(401, "authentication_required")
            return None
        if target_tenant_id is not None:
            decision = assert_tenant_access(
                actor_tenant_ids=actor_tenants,
                is_superuser=is_super,
                target_tenant_id=target_tenant_id,
            )
            if not decision.allowed:
                self._deny(403, decision.reason)
                return None
        return actor_tenants, is_super

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        path = parsed.path.rstrip("/") or "/"

        if path in {"/api/health", "/healthz"}:
            return self._send(
                200,
                b'{"status":"ok","service":"wayfold-compliance"}',
                "application/json",
            )

        # Portfolio (multi-tenant filtered)
        if path in {"/", "/portfolio"}:
            auth = self._gate(qs)
            if auth is None:
                return
            actor_tenants, is_super = auth
            rows = build_portfolio(
                actor_tenant_ids=actor_tenants, is_superuser=is_super
            )
            nav = _nav_qs(qs)
            return self._send(
                200,
                ux_pages.portfolio_page(rows, nav).encode("utf-8"),
                "text/html; charset=utf-8",
            )

        if path == "/api/portfolio":
            auth = self._gate(qs)
            if auth is None:
                return
            actor_tenants, is_super = auth
            rows = build_portfolio(
                actor_tenant_ids=actor_tenants, is_superuser=is_super
            )
            body = json.dumps(to_jsonable(rows), ensure_ascii=False).encode("utf-8")
            return self._send(200, body, "application/json")

        # Phase 4 — Regulatory Intelligence (engine store; not program-scoped)
        if path in {
            "/sources",
            "/api/sources",
            "/changes",
            "/api/changes",
            "/change",
            "/api/change",
            "/suggestions",
            "/api/suggestions",
            "/api/regulatory/check",
            "/api/regulatory/review",
            "/api/regulatory/impact",
        }:
            auth = self._gate(qs)
            if auth is None:
                return
            actor_tenants, is_super = auth
            store = _reg_store()
            nav = _nav_qs(qs)

            if path == "/sources":
                return self._send(
                    200,
                    reg_pages.sources_page(store.list_sources(), nav).encode("utf-8"),
                    "text/html; charset=utf-8",
                )
            if path == "/api/sources":
                return self._send(
                    200,
                    json.dumps(
                        {"sources": to_jsonable(store.list_sources())}, ensure_ascii=False
                    ).encode("utf-8"),
                    "application/json",
                )
            if path == "/changes":
                return self._send(
                    200,
                    reg_pages.changes_page(store.list_changes(), nav).encode("utf-8"),
                    "text/html; charset=utf-8",
                )
            if path == "/api/changes":
                return self._send(
                    200,
                    json.dumps(
                        {"changes": to_jsonable(store.list_changes())}, ensure_ascii=False
                    ).encode("utf-8"),
                    "application/json",
                )
            if path == "/suggestions":
                return self._send(
                    200,
                    reg_pages.suggestions_page(store.list_suggestions(), nav).encode(
                        "utf-8"
                    ),
                    "text/html; charset=utf-8",
                )
            if path == "/api/suggestions":
                return self._send(
                    200,
                    json.dumps(
                        {"suggestions": to_jsonable(store.list_suggestions())},
                        ensure_ascii=False,
                    ).encode("utf-8"),
                    "application/json",
                )
            if path in {"/change", "/api/change", "/api/regulatory/impact"}:
                change_id = qs.get("change_id", [""])[0]
                change = store.get_change(change_id)
                if change is None:
                    return self._deny(404, "change_not_found")
                impact = impact_for_change(
                    change_id,
                    store,
                    actor_tenant_ids=actor_tenants,
                    is_superuser=is_super,
                )
                if path == "/change":
                    return self._send(
                        200,
                        reg_pages.change_detail_page(change, impact, nav).encode("utf-8"),
                        "text/html; charset=utf-8",
                    )
                payload = {
                    "change": to_jsonable(change),
                    "impact": to_jsonable(impact),
                }
                return self._send(
                    200,
                    json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                    "application/json",
                )
            if path == "/api/regulatory/check":
                source_id = qs.get("source_id", [""])[0]
                source = store.get_source(source_id)
                if source is None:
                    return self._deny(404, "source_not_found")
                result = check_source(source, store)
                return self._send(
                    200,
                    json.dumps(to_jsonable(result), ensure_ascii=False).encode("utf-8"),
                    "application/json",
                )
            if path == "/api/regulatory/review":
                change_id = qs.get("change_id", [""])[0]
                status_raw = qs.get("status", [""])[0].upper()
                try:
                    status = ChangeStatus(status_raw)
                except ValueError:
                    return self._deny(400, "invalid_status")
                try:
                    change = review_change(change_id, store, status=status)
                except KeyError:
                    return self._deny(404, "change_not_found")
                return self._send(
                    200,
                    json.dumps(to_jsonable(change), ensure_ascii=False).encode("utf-8"),
                    "application/json",
                )

        # Phase 6 — Automated Evidence (Prowler/fixture → SUPPORTING evidence; human review)
        if path in {
            "/connectors",
            "/api/auto-evidence/connectors",
            "/auto-evidence",
            "/api/auto-evidence",
            "/api/auto-evidence/ingest",
            "/api/auto-evidence/review",
            "/api/auto-evidence/counts",
        }:
            auth = self._gate(qs)
            if auth is None:
                return
            actor_tenants, is_super = auth
            auto = _auto_ev_service()
            nav = _nav_qs(qs)

            if path in {"/connectors", "/api/auto-evidence/connectors"}:
                items = auto.list_connectors(
                    actor_tenant_ids=actor_tenants, is_superuser=is_super
                )
                if path == "/connectors":
                    return self._send(
                        200,
                        auto_ev_pages.connectors_page(items, nav).encode("utf-8"),
                        "text/html; charset=utf-8",
                    )
                return self._send(
                    200,
                    json.dumps(
                        {"connectors": to_jsonable(items)}, ensure_ascii=False
                    ).encode("utf-8"),
                    "application/json",
                )

            if path in {"/auto-evidence", "/api/auto-evidence"}:
                items = auto.list_evidence(
                    actor_tenant_ids=actor_tenants, is_superuser=is_super
                )
                if path == "/auto-evidence":
                    return self._send(
                        200,
                        auto_ev_pages.evidence_page(items, nav).encode("utf-8"),
                        "text/html; charset=utf-8",
                    )
                return self._send(
                    200,
                    json.dumps(
                        {"evidence": to_jsonable(items)}, ensure_ascii=False
                    ).encode("utf-8"),
                    "application/json",
                )

            if path == "/api/auto-evidence/ingest":
                connector_id = qs.get("connector_id", [""])[0]
                if not connector_id:
                    return self._deny(400, "connector_id_required")
                program = None
                if qs.get("program", [None])[0] or qs.get("program_id", [None])[0]:
                    try:
                        program = _resolve_program(qs)
                    except Exception as exc:  # noqa: BLE001
                        return self._deny(404, f"program_not_found: {exc}")
                try:
                    result = auto.ingest_connector(
                        connector_id,
                        program=program,
                        actor_tenant_ids=actor_tenants,
                        is_superuser=is_super,
                    )
                except KeyError as exc:
                    return self._deny(404, str(exc))
                except PermissionError as exc:
                    return self._deny(403, str(exc))
                return self._send(
                    200,
                    json.dumps(to_jsonable(result), ensure_ascii=False).encode("utf-8"),
                    "application/json",
                )

            if path == "/api/auto-evidence/review":
                eid = qs.get("evidence_id", [""])[0]
                status_raw = qs.get("status", [""])[0].upper()
                try:
                    status = EvidenceReviewStatus(status_raw)
                except ValueError:
                    return self._deny(400, "invalid_status")
                try:
                    rec = auto.review_evidence(
                        eid,
                        status=status,
                        actor_tenant_ids=actor_tenants,
                        is_superuser=is_super,
                    )
                except KeyError:
                    return self._deny(404, "evidence_not_found")
                except PermissionError as exc:
                    return self._deny(403, str(exc))
                except ValueError as exc:
                    return self._deny(400, str(exc))
                return self._send(
                    200,
                    json.dumps(to_jsonable(rec), ensure_ascii=False).encode("utf-8"),
                    "application/json",
                )

            if path == "/api/auto-evidence/counts":
                try:
                    program = _resolve_program(qs)
                except Exception as exc:  # noqa: BLE001
                    return self._deny(404, f"program_not_found: {exc}")
                decision = assert_tenant_access(
                    actor_tenant_ids=actor_tenants,
                    is_superuser=is_super,
                    target_tenant_id=program.tenant_id,
                )
                if not decision.allowed:
                    return self._deny(403, decision.reason)
                counts = auto.project_evidence_counts(program)
                # Explicit: counts are advisory; implementation statuses untouched
                return self._send(
                    200,
                    json.dumps(
                        {
                            "tenant_id": program.tenant_id,
                            "program_id": program.program_id,
                            "approved_auto_evidence_by_control": counts,
                            "note": (
                                "Advisory counts only — does not mutate AppliedControl "
                                "status or framework readiness"
                            ),
                        },
                        ensure_ascii=False,
                    ).encode("utf-8"),
                    "application/json",
                )

        # Phase 5 — AI Assistance (suggest only; human review required)
        if path in {
            "/ai/suggestions",
            "/api/ai/suggestions",
            "/ai/settings",
            "/api/ai/settings",
            "/api/ai/mapping-suggest",
            "/api/ai/regulatory-summary",
            "/api/ai/impact-suggest",
            "/api/ai/gap-explain",
            "/api/ai/review",
        }:
            auth = self._gate(qs)
            if auth is None:
                return
            actor_tenants, is_super = auth
            ai = _ai_service()
            nav = _nav_qs(qs)

            if path in {"/ai/suggestions", "/api/ai/suggestions"}:
                items = ai.list_suggestions(
                    actor_tenant_ids=actor_tenants, is_superuser=is_super
                )
                if path == "/ai/suggestions":
                    return self._send(
                        200,
                        ai_pages.suggestions_page(items, nav).encode("utf-8"),
                        "text/html; charset=utf-8",
                    )
                return self._send(
                    200,
                    json.dumps(
                        {"suggestions": to_jsonable(items)}, ensure_ascii=False
                    ).encode("utf-8"),
                    "application/json",
                )

            if path in {"/ai/settings", "/api/ai/settings"}:
                tenant_id = qs.get("tenant_id", [""])[0]
                if not tenant_id:
                    return self._deny(400, "tenant_id_required")
                if not is_super:
                    decision = assert_tenant_access(
                        actor_tenant_ids=actor_tenants,
                        is_superuser=is_super,
                        target_tenant_id=tenant_id,
                    )
                    if not decision.allowed:
                        return self._deny(403, decision.reason)
                enabled_raw = qs.get("enabled", [None])[0]
                if enabled_raw is not None:
                    settings = ai.set_ai_processing(
                        tenant_id, enabled_raw.lower() in {"1", "true", "yes"}
                    )
                else:
                    settings = ai.tenant_settings(tenant_id)
                if path == "/ai/settings":
                    return self._send(
                        200,
                        ai_pages.settings_page(settings, nav).encode("utf-8"),
                        "text/html; charset=utf-8",
                    )
                return self._send(
                    200,
                    json.dumps(to_jsonable(settings), ensure_ascii=False).encode("utf-8"),
                    "application/json",
                )

            if path == "/api/ai/review":
                sid = qs.get("suggestion_id", [""])[0]
                status_raw = qs.get("status", [""])[0].upper()
                try:
                    status = SuggestionReviewStatus(status_raw)
                except ValueError:
                    return self._deny(400, "invalid_status")
                try:
                    sug = ai.review_suggestion(
                        sid,
                        status=status,
                        actor_tenant_ids=actor_tenants,
                        is_superuser=is_super,
                    )
                except KeyError:
                    return self._deny(404, "suggestion_not_found")
                except PermissionError as exc:
                    return self._deny(403, str(exc))
                except ValueError as exc:
                    return self._deny(400, str(exc))
                return self._send(
                    200,
                    json.dumps(to_jsonable(sug), ensure_ascii=False).encode("utf-8"),
                    "application/json",
                )

            # Suggest endpoints need a program or change context.
            # Explicit program only — never inject default Michele into another tenant's AI call.
            program = None
            program_err = ""
            if qs.get("program", [None])[0] or qs.get("program_id", [None])[0]:
                try:
                    program = _resolve_program(qs)
                except Exception as exc:  # noqa: BLE001
                    program_err = str(exc)

            if path in {
                "/api/ai/mapping-suggest",
                "/api/ai/gap-explain",
            }:
                if program is None and not program_err:
                    # Backward-compatible default only when caller omits program entirely
                    try:
                        program = _resolve_program(qs)
                    except Exception as exc:  # noqa: BLE001
                        program_err = str(exc)
                if program is None:
                    return self._deny(404, f"program_not_found: {program_err}")
                decision = assert_tenant_access(
                    actor_tenant_ids=actor_tenants,
                    is_superuser=is_super,
                    target_tenant_id=program.tenant_id,
                )
                if not decision.allowed:
                    return self._deny(403, decision.reason)
                req_id = qs.get("requirement_id", [""])[0]
                if not req_id:
                    return self._deny(400, "requirement_id_required")
                try:
                    if path == "/api/ai/mapping-suggest":
                        sug = ai.suggest_mapping(program, req_id)
                    else:
                        sug = ai.explain_gap(program, req_id)
                except AIProcessingDisabled as exc:
                    return self._deny(403, str(exc))
                except KeyError as exc:
                    return self._deny(404, str(exc))
                return self._send(
                    200,
                    json.dumps(to_jsonable(sug), ensure_ascii=False).encode("utf-8"),
                    "application/json",
                )

            if path in {"/api/ai/regulatory-summary", "/api/ai/impact-suggest"}:
                change_id = qs.get("change_id", [""])[0]
                if not change_id:
                    return self._deny(400, "change_id_required")
                tenant_id = qs.get("tenant_id", [""])[0]
                if not tenant_id and program is not None:
                    tenant_id = program.tenant_id
                if not tenant_id:
                    return self._deny(400, "tenant_id_required")
                if not is_super:
                    decision = assert_tenant_access(
                        actor_tenant_ids=actor_tenants,
                        is_superuser=is_super,
                        target_tenant_id=tenant_id,
                    )
                    if not decision.allowed:
                        return self._deny(403, decision.reason)
                # Drop mismatched program context (prevents cross-tenant req IDs in AI payload)
                if program is not None and program.tenant_id != tenant_id:
                    program = None
                try:
                    if path == "/api/ai/regulatory-summary":
                        sug = ai.summarize_regulatory_change(
                            change_id, tenant_id=tenant_id, program=program
                        )
                    else:
                        sug = ai.suggest_impact(
                            change_id,
                            tenant_id=tenant_id,
                            actor_tenant_ids=actor_tenants,
                            is_superuser=is_super,
                        )
                except AIProcessingDisabled as exc:
                    return self._deny(403, str(exc))
                except KeyError as exc:
                    return self._deny(404, str(exc))
                return self._send(
                    200,
                    json.dumps(to_jsonable(sug), ensure_ascii=False).encode("utf-8"),
                    "application/json",
                )

        # Program-scoped routes
        try:
            program = _resolve_program(qs)
        except Exception as exc:  # noqa: BLE001
            return self._deny(404, f"program_not_found: {exc}")

        auth = self._gate(qs, program.tenant_id)
        if auth is None:
            return

        nav = _nav_qs(qs, program_id=program.program_id)
        checklist = build_unified_checklist(program)
        readiness = framework_readiness(program, checklist)
        impact = rank_control_impact(program, checklist)

        if path in {"/checklist"}:
            body = _html_checklist(checklist, readiness, impact, nav).encode("utf-8")
            return self._send(200, body, "text/html; charset=utf-8")

        if path == "/api/unified-checklist":
            payload = {
                "checklist": to_jsonable(checklist),
                "readiness": to_jsonable(readiness),
                "impact": to_jsonable(impact),
            }
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            return self._send(200, body, "application/json")

        if path == "/client":
            dash = build_client_dashboard(program)
            return self._send(
                200,
                ux_pages.client_page(dash, nav).encode("utf-8"),
                "text/html; charset=utf-8",
            )

        if path == "/api/client":
            dash = build_client_dashboard(program)
            return self._send(
                200,
                json.dumps(to_jsonable(dash), ensure_ascii=False).encode("utf-8"),
                "application/json",
            )

        def _gap_filter_from_qs() -> GapFilter:
            return GapFilter(
                framework=qs.get("framework", [""])[0] or None,
                status=qs.get("status", [""])[0] or None,
                owner=qs.get("owner", [""])[0] or None,
                priority=qs.get("priority", [""])[0] or None,
                deadline_before=qs.get("deadline_before", [""])[0] or None,
                deadline_after=qs.get("deadline_after", [""])[0] or None,
                mapped=(
                    True
                    if qs.get("mapped", [""])[0] == "1"
                    else False
                    if qs.get("mapped", [""])[0] == "0"
                    else None
                ),
                missing_evidence=True if qs.get("missing_evidence", [""])[0] == "1" else None,
                search=qs.get("search", [""])[0] or None,
            )

        if path == "/gaps":
            flt = _gap_filter_from_qs()
            rows = filter_gap_rows(build_gap_rows(program, checklist), flt)
            filter_values = {
                "superuser": "1" if qs.get("superuser", ["0"])[0] in {"1", "true", "yes"} else "",
                "actor_tenants": qs.get("actor_tenants", [""])[0],
                "program_id": program.program_id,
                "framework": qs.get("framework", [""])[0],
                "status": qs.get("status", [""])[0],
                "owner": qs.get("owner", [""])[0],
                "priority": qs.get("priority", [""])[0],
                "deadline_before": qs.get("deadline_before", [""])[0],
                "deadline_after": qs.get("deadline_after", [""])[0],
                "mapped": qs.get("mapped", [""])[0],
                "missing_evidence": qs.get("missing_evidence", [""])[0],
                "search": qs.get("search", [""])[0],
            }
            return self._send(
                200,
                ux_pages.gaps_page(rows, nav, filter_values).encode("utf-8"),
                "text/html; charset=utf-8",
            )

        if path == "/api/gaps":
            rows = filter_gap_rows(build_gap_rows(program, checklist), _gap_filter_from_qs())
            return self._send(
                200,
                json.dumps(to_jsonable(rows), ensure_ascii=False).encode("utf-8"),
                "application/json",
            )

        if path == "/control":
            ref = qs.get("control_ref", [""])[0]
            detail = control_detail(program, ref, checklist)
            if detail is None:
                return self._deny(404, "control_not_found")
            return self._send(
                200,
                ux_pages.control_page(detail, nav).encode("utf-8"),
                "text/html; charset=utf-8",
            )

        if path == "/api/control":
            ref = qs.get("control_ref", [""])[0]
            detail = control_detail(program, ref, checklist)
            if detail is None:
                return self._deny(404, "control_not_found")
            return self._send(
                200,
                json.dumps(to_jsonable(detail), ensure_ascii=False).encode("utf-8"),
                "application/json",
            )

        if path == "/owners":
            return self._send(
                200,
                ux_pages.owners_page(owner_view(program, checklist), nav).encode("utf-8"),
                "text/html; charset=utf-8",
            )

        if path == "/deadlines":
            return self._send(
                200,
                ux_pages.deadlines_page(deadline_view(program, checklist), nav).encode(
                    "utf-8"
                ),
                "text/html; charset=utf-8",
            )

        if path == "/evidence":
            return self._send(
                200,
                ux_pages.evidence_page(evidence_view(program, checklist), nav).encode(
                    "utf-8"
                ),
                "text/html; charset=utf-8",
            )

        if path == "/tasks":
            return self._send(
                200,
                ux_pages.tasks_page(task_view(program, checklist), nav).encode("utf-8"),
                "text/html; charset=utf-8",
            )

        if path == "/report":
            body = report_html(program, nav_qs=nav).encode("utf-8")
            return self._send(200, body, "text/html; charset=utf-8")

        if path == "/report.csv":
            body = report_csv(program).encode("utf-8")
            return self._send(200, body, "text/csv; charset=utf-8")

        if path == "/api/owners":
            return self._send(
                200,
                json.dumps(to_jsonable(owner_view(program, checklist)), ensure_ascii=False).encode(),
                "application/json",
            )

        if path == "/api/deadlines":
            return self._send(
                200,
                json.dumps(
                    to_jsonable(deadline_view(program, checklist)), ensure_ascii=False
                ).encode(),
                "application/json",
            )

        if path == "/api/evidence":
            return self._send(
                200,
                json.dumps(
                    to_jsonable(evidence_view(program, checklist)), ensure_ascii=False
                ).encode(),
                "application/json",
            )

        if path == "/api/tasks":
            return self._send(
                200,
                json.dumps(to_jsonable(task_view(program, checklist)), ensure_ascii=False).encode(),
                "application/json",
            )

        return self._deny(404, "not found")

    def log_message(self, fmt, *args):  # noqa: A003
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main(argv: list[str] | None = None):
    import argparse

    parser = argparse.ArgumentParser(description="WayFold Compliance consultant HTTP API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8092)
    args = parser.parse_args(argv)
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"WayFold Compliance listening on http://{args.host}:{args.port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()

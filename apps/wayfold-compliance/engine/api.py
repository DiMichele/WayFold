"""Consultant-facing HTTP surface for Unified Compliance + Phase 3 UX.

Run:
  python -m engine.api
Default: http://127.0.0.1:8092
Auth: ?superuser=1 OR ?actor_tenants=<tenant-id>[,...]
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.authz import assert_tenant_access
from engine.checklist import build_unified_checklist
from engine.consultant_views import deadline_view, evidence_view, owner_view, task_view
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
from engine import ux_pages

DEFAULT_PROGRAM = ROOT / "engine" / "fixtures" / "michele_phase2_program.json"


def _auth_from_qs(qs: dict) -> tuple[set[str], bool]:
    actor_tenants = {
        t.strip() for t in qs.get("actor_tenants", [""])[0].split(",") if t.strip()
    }
    is_super = qs.get("superuser", ["0"])[0].lower() in {"1", "true", "yes"}
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


def _html_checklist(checklist, readiness, impact) -> str:
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
    return f"""<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<title>WayFold Unified Checklist — {checklist.program_name}</title>
<style>
body{{font-family:Segoe UI,sans-serif;margin:2rem;background:#f6f7f9;color:#1a1a1a}}
h1{{font-size:1.4rem;margin-bottom:.25rem}}
.meta{{color:#444;margin-bottom:1.5rem}}
table{{border-collapse:collapse;width:100%;background:#fff}}
th,td{{border:1px solid #d0d5dd;padding:.45rem .55rem;vertical-align:top;font-size:.9rem}}
th{{background:#eef2f6;text-align:left;position:sticky;top:0}}
section{{margin:2rem 0}}
code{{background:#eef2f6;padding:0 .25rem}}
</style></head><body>
<h1>WayFold — Unified Checklist</h1>
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
<ul>{unmapped or '<li>None</li>'}</ul>
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
<ul>{impact_items}</ul>
</section>
</body></html>"""


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

        if path == "/api/health":
            return self._send(
                200,
                b'{"status":"ok","service":"wayfold-consultant-ux"}',
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
            body = _html_checklist(checklist, readiness, impact).encode("utf-8")
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

        if path == "/gaps":
            flt = GapFilter(
                framework=qs.get("framework", [""])[0] or None,
                status=qs.get("status", [""])[0] or None,
                owner=qs.get("owner", [""])[0] or None,
                priority=qs.get("priority", [""])[0] or None,
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
            rows = filter_gap_rows(build_gap_rows(program, checklist), flt)
            filter_values = {
                "superuser": "1" if qs.get("superuser", ["0"])[0] in {"1", "true", "yes"} else "",
                "actor_tenants": qs.get("actor_tenants", [""])[0],
                "program_id": program.program_id,
                "framework": qs.get("framework", [""])[0],
                "status": qs.get("status", [""])[0],
                "owner": qs.get("owner", [""])[0],
                "priority": qs.get("priority", [""])[0],
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
            flt = GapFilter(
                framework=qs.get("framework", [""])[0] or None,
                status=qs.get("status", [""])[0] or None,
                owner=qs.get("owner", [""])[0] or None,
                priority=qs.get("priority", [""])[0] or None,
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
            rows = filter_gap_rows(build_gap_rows(program, checklist), flt)
            return self._send(
                200,
                json.dumps(to_jsonable(rows), ensure_ascii=False).encode("utf-8"),
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
            body = report_html(program).encode("utf-8")
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


def main():
    host, port = "127.0.0.1", 8092
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"WayFold Consultant UX listening on http://{host}:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()

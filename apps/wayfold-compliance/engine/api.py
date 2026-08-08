"""Minimal consultant-facing HTTP surface for Unified Compliance.

Run:
  python -m engine.api
Default: http://127.0.0.1:8092
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.authz import assert_tenant_access
from engine.checklist import build_unified_checklist
from engine.impact import rank_control_impact
from engine.program_loader import load_program_snapshot
from engine.readiness import framework_readiness
from engine.serialize import to_jsonable

DEFAULT_PROGRAM = ROOT / "engine" / "fixtures" / "michele_phase2_program.json"


def _html_table(checklist, readiness, impact) -> str:
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
<th>Framework</th><th>Version</th><th>FULLY</th><th>PARTIAL</th><th>NOT</th><th>UNMAPPED</th><th>Impl readiness</th>
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

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        program_path = Path(qs.get("program", [str(DEFAULT_PROGRAM)])[0])
        if not program_path.is_file():
            return self._deny(404, "program snapshot not found")
        program = load_program_snapshot(program_path)
        actor_tenants = {t for t in qs.get("actor_tenants", [""])[0].split(",") if t}
        is_super = qs.get("superuser", ["0"])[0] in {"1", "true", "yes"}
        decision = assert_tenant_access(
            actor_tenant_ids=actor_tenants,
            is_superuser=is_super or not actor_tenants,
            target_tenant_id=program.tenant_id,
        )
        if not decision.allowed:
            return self._deny(403, decision.reason)

        checklist = build_unified_checklist(program)
        readiness = framework_readiness(program, checklist)
        impact = rank_control_impact(program, checklist)

        if parsed.path in {"/", "/checklist"}:
            body = _html_table(checklist, readiness, impact).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path == "/api/unified-checklist":
            payload = {
                "checklist": to_jsonable(checklist),
                "readiness": to_jsonable(readiness),
                "impact": to_jsonable(impact),
            }
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path == "/api/health":
            body = b'{"status":"ok","service":"wayfold-unified-compliance"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        return self._deny(404, "not found")

    def log_message(self, fmt, *args):  # noqa: A003
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    host, port = "127.0.0.1", 8092
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"WayFold Unified Compliance listening on http://{host}:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()

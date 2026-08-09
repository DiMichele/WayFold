"""One-shot production KB import from /tmp/kb-out."""
from __future__ import annotations

import json
import os
from pathlib import Path

os.environ.setdefault("WAYFOLD_DATA_DIR", "/var/lib/wayfold-compliance")

from engine.kb_import import import_packages_batch

out = Path(os.environ.get("IMPORT_OUT", "/tmp/kb-out"))
pkgs = [
    json.loads(p.read_text(encoding="utf-8"))
    for p in sorted((out / "frameworks").glob("*.json"))
    if not p.name.startswith("csa")
]
recs = import_packages_batch(pkgs, actor="prod-bootstrap")
for r in recs:
    ctr = sum(1 for x in r.requirements if x.req_type == "CONTROL")
    print(
        r.framework_name,
        len(r.requirements),
        "CONTROL",
        ctr,
        "AQ",
        len(r.assessment_questions),
        r.source_status,
    )
cand = out / "mappings" / "legacy-crosswalk-candidates.json"
if cand.is_file():
    dest = Path(os.environ["WAYFOLD_DATA_DIR"]) / "mapping_candidates.json"
    dest.write_text(cand.read_text(encoding="utf-8"), encoding="utf-8")
    print("candidates", len(json.loads(cand.read_text()).get("candidates") or []))
programs = Path(os.environ["WAYFOLD_DATA_DIR"]) / "programs"
print("programs", len(list(programs.glob("*.json"))) if programs.is_dir() else 0)

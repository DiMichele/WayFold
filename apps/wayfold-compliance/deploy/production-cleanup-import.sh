#!/usr/bin/env bash
# Production: backup → demo cleanup → import real KB from MultiCompliance package dir.
# Does NOT change admin password. Does NOT seed WF_REVIEW_DEMO_2026.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${WAYFOLD_DATA_DIR:-$ROOT/data}"
BACKUP_ROOT="${WAYFOLD_BACKUP_DIR:-$DATA/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$BACKUP_ROOT/pre-cleanup-$STAMP"
IMPORT_OUT="${1:-}"

mkdir -p "$BACKUP" "$DATA"
echo "==> Backup to $BACKUP"
for f in portfolio_registry.json clients.json framework_versions.json framework_registry.json \
  kb_mappings.json control_catalog.json; do
  [[ -f "$DATA/$f" ]] && cp -a "$DATA/$f" "$BACKUP/" || true
done
[[ -d "$DATA/programs" ]] && cp -a "$DATA/programs" "$BACKUP/programs" || true
[[ -d "$DATA/evidence" ]] && cp -a "$DATA/evidence" "$BACKUP/evidence" || true
[[ -d "$DATA/audit" ]] && cp -a "$DATA/audit" "$BACKUP/audit" || true

echo "==> Demo cleanup plan + apply"
cd "$ROOT"
WAYFOLD_DATA_DIR="$DATA" python -m engine.demo_cleanup --data-dir "$DATA" --out "$DATA/DEMO-DATA-CLEANUP-PLAN.json" --apply

if [[ -n "$IMPORT_OUT" && -d "$IMPORT_OUT/frameworks" ]]; then
  echo "==> Import KB packages from $IMPORT_OUT"
  export IMPORT_OUT WAYFOLD_DATA_DIR="$DATA"
  cd "$ROOT"
  python - <<'PY'
import json, os
from pathlib import Path
from engine.kb_import import import_packages_batch
out = Path(os.environ["IMPORT_OUT"])
pkgs = []
for p in sorted((out / "frameworks").glob("*.json")):
    if p.name.startswith("csa"):
        continue
    pkgs.append(json.loads(p.read_text(encoding="utf-8")))
recs = import_packages_batch(pkgs, actor="prod-bootstrap")
print("imported", [(r.framework_id, len(r.requirements), len(r.assessment_questions)) for r in recs])
cand = out / "mappings" / "legacy-crosswalk-candidates.json"
if cand.is_file():
    dest = Path(os.environ["WAYFOLD_DATA_DIR"]) / "mapping_candidates.json"
    dest.write_text(cand.read_text(encoding="utf-8"), encoding="utf-8")
    print("mapping_candidates", dest)
PY
else
  echo "==> No import dir provided; skipping KB import (pass convert output path as \$1)"
fi

echo "==> Post-import backup"
POST="$BACKUP_ROOT/post-import-$STAMP"
mkdir -p "$POST"
cp -a "$DATA/framework_versions.json" "$POST/" 2>/dev/null || true
cp -a "$DATA/framework_registry.json" "$POST/" 2>/dev/null || true
cp -a "$DATA/DEMO-DATA-CLEANUP-PLAN.json" "$POST/" 2>/dev/null || true
echo "DONE backup=$BACKUP post=$POST"

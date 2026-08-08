# PROGRESS — WayFold Compliance

## Fase corrente

**Phase 1 CLOSED (verification PASS).**  
**Phase 2 — Unified Compliance: IMPLEMENTATION FINISHED — AWAITING INDEPENDENT VERIFICATION.**  
Non dichiarare Phase 2 COMPLETE fino a PASS + tag orchestratore.

## Completato

- Scaffold `apps/wayfold-compliance/`
- Phase -1 discovery + scorecard (`open-source-evaluation.md`)
- Phase 0 decision gate: core **CISO Assistant Community**, Strategy B
- Phase 1 Working Core verified independently (`PHASE1-VERIFICATION.md` → **PASS**)
- Phase 2 engine Unified Compliance in `apps/wayfold-compliance/engine/`:
  - checklist / readiness / control impact
  - mapping FULL / PARTIAL / SUPPORTING + uncovered_delta
  - tenant gate (`authz`)
  - CLI + HTTP UI table (`engine.api` :8092)
  - CISO ORM bridge (`ciso_bridge.py`)
  - unit tests (9) green
- Docs: `unified-compliance.md`, `data-model.md`

## Cosa funziona

- Core CISO Docker locale: health OK, Michele demo seed idempotente
- Tenant isolation live (Michele viewer ↛ Alfa evidence/controls)
- Unified checklist su fixture Michele Phase 2 (3 FW, shared CTRL-IAM-001, PARTIAL+delta, SUPPORTING, UNMAPPED≥2, stati misti)
- Export live da CISO via bridge (opzionale)

## Cosa non funziona / gate aperti

- Phase 2 non ancora chiusa da verification report indipendente
- UI consultant completa (filtri avanzati / portfolio) → Phase 3
- Optimistic locking integer `version` su AppliedControl assente nel core (warning Phase 1)

## Stato DB

- Core: SQLite locale compose (`vendor/.../db/`, gitignored)
- WayFold mappings: overlay JSON / ProgramSnapshot (non nel DB core)

## Migrazioni recenti

- Nessuna migration prodotto WayFold; core CISO migrations applicate nel container

## Comandi di avvio

```powershell
# Core CISO
cd apps/wayfold-compliance/vendor/ciso-assistant-community
# usare docker compose ufficiale del vendor

# Phase 2 engine
cd apps/wayfold-compliance
python -m engine.tests.test_unified_compliance
python -m engine --superuser --format text
python -m engine.api   # http://127.0.0.1:8092/checklist

# Demo seed core
docker exec -w /code -e PYTHONPATH=/code backend /code/.venv/bin/python /code/db/michele_demo_seed.py
```

## Git

- Remote: https://github.com/DiMichele/WayFold-Compliance
- Branch automazione: `automation/wayfold-compliance`
- `vendor/` non versionato

## Problemi aperti

- Auth Cursor Agent CLI per unattended overnight (operativo)
- Phase 2 awaiting independent verification

## Technical debt

- Dedup coverage su export CISO con assessment duplicati — gestito in checklist; pulizia DB demo opzionale
- pytest assente nell'immagine runtime CISO (test engine host-side)

## Prossimo step consigliato

1. Orchestratore: tag `phase-1-complete` post PASS  
2. Independent VERIFY Phase 2 (`2_TO_3`)  
3. Non iniziare Phase 3 finché Phase 2 non ha PASS

# PROGRESS — WayFold Compliance

## Fase corrente

**Phase 1 CLOSED (verification PASS).**  
**Phase 2 CLOSED (verification PASS)** — vedi `PHASE2-VERIFICATION.md`.  
**Phase 3 — Consultant UX: IMPLEMENTATION FINISHED — AWAITING INDEPENDENT VERIFICATION.**  
Non dichiarare Phase 3 COMPLETE fino a PASS + tag orchestratore.

## Completato

- Scaffold `apps/wayfold-compliance/`
- Phase -1 discovery + scorecard (`open-source-evaluation.md`)
- Phase 0 decision gate: core **CISO Assistant Community**, Strategy B
- Phase 1 Working Core verified (`PHASE1-VERIFICATION.md` → **PASS**)
- Phase 2 Unified Compliance verified (`PHASE2-VERIFICATION.md` → **PASS**)
  - checklist / readiness / control impact
  - mapping FULL / PARTIAL / SUPPORTING + uncovered_delta
  - tenant gate default-deny (API/CLI)
  - tests: 13 OK
- Phase 3 Consultant UX in `apps/wayfold-compliance/engine/`:
  - Portfolio + Client dashboard
  - Gap Assessment filtrabile
  - Owner / Deadline / Evidence / Task views
  - Report HTML print-friendly + CSV
  - Multi-client registry (Michele + Alfa)
  - tests: 8 OK (`test_consultant_ux`)
- Docs: `unified-compliance.md`, `consultant-ux.md`, `data-model.md`

## Cosa funziona

- Core CISO Docker locale (Phase 1)
- Unified checklist / readiness / impact (Phase 2)
- Consultant UX locale `:8092` con auth esplicita
- Isolation portfolio: actor su Michele non vede Alfa
- Report e filtri gap su program snapshot pinned

## Cosa non funziona / gate aperti

- Phase 3 non ancora chiusa da verification report indipendente
- Regulatory watcher → Phase 4
- AI assist → Phase 5
- Optimistic locking integer `version` su AppliedControl assente nel core (warning Phase 1)

## Stato DB

- Core: SQLite locale compose (`vendor/.../db/`, gitignored)
- WayFold mappings + portfolio registry: overlay JSON (non nel DB core)

## Migrazioni recenti

- Nessuna migration prodotto WayFold; core CISO migrations applicate nel container

## Comandi di avvio

```powershell
cd apps/wayfold-compliance
python -m engine.tests.test_unified_compliance
python -m engine.tests.test_consultant_ux
python -m engine --superuser --format text
python -m engine.api   # http://127.0.0.1:8092/portfolio?superuser=1
```

## Git

- Remote: https://github.com/DiMichele/WayFold-Compliance
- Branch automazione: `automation/wayfold-compliance`
- `vendor/` non versionato

## Problemi aperti

- Auth Cursor Agent CLI per unattended overnight (operativo)
- Phase 3 awaiting independent verification

## Technical debt

- Dedup coverage su export CISO con assessment duplicati — gestito in checklist/readiness
- pytest assente nell'immagine runtime CISO (test engine host-side)
- UX HTML locale (non fork SvelteKit CISO) — integrazione UI core deferibile

## Prossimo step consigliato

1. Orchestratore: tag `phase-2-complete` post PASS Phase 2  
2. Independent VERIFY Phase 3 (`3_TO_4`)  
3. Non iniziare Phase 4 finché Phase 3 non ha PASS

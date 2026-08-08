# PROGRESS — WayFold Compliance

## Fase corrente

**Phase 1 CLOSED (verification PASS).**  
**Phase 2 CLOSED (verification PASS)** — vedi `PHASE2-VERIFICATION.md`.  
**Phase 3 CLOSED (verification PASS)** — vedi `PHASE3-VERIFICATION.md`.  
**PHASE 4 IMPLEMENTATION FINISHED — AWAITING INDEPENDENT VERIFICATION.**  
Non dichiarare Phase 4 COMPLETE fino a PASS + tag orchestratore.

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
- Phase 3 Consultant UX verified (`PHASE3-VERIFICATION.md` → **PASS**)
  - Portfolio + Client dashboard
  - Gap Assessment filtrabile (+ deadline range)
  - Control detail drill-down (coverage/delta/evidence/task)
  - Owner / Deadline / Evidence / Task views
  - Report HTML print-friendly + CSV
  - Multi-client registry (Michele + Alfa)
  - tests: 9 OK (`test_consultant_ux`)
- Phase 4 Regulatory Intelligence implemented in `engine/regulatory/`:
  - Sources + adapters (HTML/JSON/FILE/fixture)
  - Snapshots + SHA-256 hashes (raw + normalized)
  - Diff + relevance (SUBSTANTIVE vs COSMETIC)
  - RegulatoryChange inbox + human review
  - FrameworkUpdateSuggestion (CLONE_DRAFT, no CISO mutate)
  - Client impact projection on pinned programs
  - Demo locale `fixtures/regulatory/demo-nis2/`
  - tests: 7 OK (`test_regulatory`)
- Docs: `unified-compliance.md`, `consultant-ux.md`, `regulatory-watcher.md`, `data-model.md`

## Cosa funziona

- Core CISO Docker locale (Phase 1)
- Unified checklist / readiness / impact (Phase 2)
- Consultant UX locale `:8092` con auth esplicita
- Isolation portfolio: actor su Michele non vede Alfa
- Report e filtri gap su program snapshot pinned
- Drill-down Gaps → Control detail con framework coverage
- Regulatory demo cycle v1→v2 senza rete esterna

## Cosa non funziona / gate aperti

- Phase 4 non ancora chiusa da verification report indipendente
- AI assist → Phase 5
- Optimistic locking integer `version` su AppliedControl assente nel core (warning Phase 1)
- PDF/RSS/API adapters tipizzati ma senza parser specializzati (estendibili)

## Stato DB

- Core: SQLite locale compose (`vendor/.../db/`, gitignored)
- WayFold mappings + portfolio registry: overlay JSON (non nel DB core)
- Regulatory store: `engine/data/regulatory/` (gitignored runtime)

## Migrazioni recenti

- Nessuna migration prodotto WayFold; core CISO migrations applicate nel container
- Nessuna migration distruttiva; store regulatory è file-based engine-side

## Comandi di avvio

```powershell
cd apps/wayfold-compliance
python -m engine.tests.test_unified_compliance
python -m engine.tests.test_consultant_ux
python -m engine.tests.test_regulatory
python -m engine --superuser --format text
python -m engine.api   # http://127.0.0.1:8092/portfolio?superuser=1
# control: /control?superuser=1&program_id=program-cyber-demo&control_ref=CTRL-IAM-001
# regulatory: /sources?superuser=1  /changes?superuser=1
```

## Git

- Remote: https://github.com/DiMichele/WayFold-Compliance
- Branch automazione: `automation/wayfold-compliance`
- `vendor/` non versionato

## Problemi aperti

- Auth Cursor Agent CLI per unattended overnight (operativo)

## Technical debt

- Dedup coverage su export CISO con assessment duplicati — gestito in checklist/readiness
- pytest assente nell'immagine runtime CISO (test engine host-side)
- UX HTML locale (non fork SvelteKit CISO) — integrazione UI core deferibile
- Regulatory HTTP check on-demand (scheduler/worker persistente deferibile)

## Prossimo step consigliato

1. Orchestratore: tag `phase-3-complete` post PASS Phase 3  
2. Independent VERIFY Phase 4 (`4_TO_5`)  
3. Non iniziare Phase 5 finché Phase 4 non ha PASS

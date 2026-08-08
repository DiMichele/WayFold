# PROGRESS — WayFold Compliance

## Fase corrente

**Phase 1 CLOSED (verification PASS).**  
**Phase 2 CLOSED (verification PASS)** — vedi `PHASE2-VERIFICATION.md`.  
**Phase 3 CLOSED (verification PASS)** — vedi `PHASE3-VERIFICATION.md`.  
**Phase 4 CLOSED (verification PASS)** — vedi `PHASE4-VERIFICATION.md`.  
**PHASE 5 IMPLEMENTATION FINISHED — AWAITING INDEPENDENT VERIFICATION.**  
Non dichiarare Phase 5 COMPLETE fino a PASS + tag orchestratore.

## Completato

- Scaffold `apps/wayfold-compliance/`
- Phase -1 discovery + scorecard (`open-source-evaluation.md`)
- Phase 0 decision gate: core **CISO Assistant Community**, Strategy B
- Phase 1 Working Core verified (`PHASE1-VERIFICATION.md` → **PASS**)
- Phase 2 Unified Compliance verified (`PHASE2-VERIFICATION.md` → **PASS**)
- Phase 3 Consultant UX verified (`PHASE3-VERIFICATION.md` → **PASS**)
- Phase 4 Regulatory Intelligence verified (`PHASE4-VERIFICATION.md` → **PASS**)
  - Sources + adapters, immutable snapshots + SHA-256, deterministic diff
  - RegulatoryChange inbox + FrameworkUpdateSuggestion CLONE_DRAFT
  - Client impact tenant-filtered; tests: 10 OK
- Phase 5 AI Assistance implemented in `engine/ai/`:
  - `AIProvider` abstraction + `HeuristicAIProvider` (no external LLM keys)
  - Mapping suggestions, regulatory diff summaries, impact suggestions, gap explanations
  - Human review obbligatoria (`AI_SUGGESTED` → APPROVED/REJECTED)
  - `TenantAISettings.ai_processing_enabled` default **false**
  - No auto-approve mapping/impact; no compliance auto-close
  - tests: 8 OK (`test_ai`)
- Docs: `unified-compliance.md`, `consultant-ux.md`, `regulatory-watcher.md`, `ai-assistance.md`, `data-model.md`

## Cosa funziona

- Core CISO Docker locale (Phase 1)
- Unified checklist / readiness / impact (Phase 2)
- Consultant UX locale `:8092` con auth esplicita
- Isolation portfolio + regulatory impact per actor tenant
- Regulatory demo cycle v1→v2 senza rete esterna
- AI suggest endpoints con gate tenant + AI disabled-by-default

## Cosa non funziona / gate aperti

- Phase 5 non ancora chiusa da verification report indipendente
- Provider LLM reale non configurato (heuristic locale by design overnight)
- Optimistic locking integer `version` su AppliedControl assente nel core (warning Phase 1)
- PDF/RSS/API adapters tipizzati ma senza parser specializzati (estendibili)

## Stato DB

- Core: SQLite locale compose (`vendor/.../db/`, gitignored)
- WayFold mappings + portfolio registry: overlay JSON (non nel DB core)
- Regulatory store: `engine/data/regulatory/` (gitignored runtime)
- AI store: `engine/data/ai/` (gitignored runtime)

## Migrazioni recenti

- Nessuna migration prodotto WayFold; core CISO migrations applicate nel container
- Nessuna migration distruttiva; store regulatory/AI file-based engine-side

## Comandi di avvio

```powershell
cd apps/wayfold-compliance
python -m engine.tests.test_unified_compliance
python -m engine.tests.test_consultant_ux
python -m engine.tests.test_regulatory
python -m engine.tests.test_ai
python -m engine --superuser --format text
python -m engine.api   # http://127.0.0.1:8092/portfolio?superuser=1
# AI: /ai/suggestions?superuser=1
#     /api/ai/settings?superuser=1&tenant_id=tenant-michele&enabled=1
#     /api/ai/mapping-suggest?superuser=1&requirement_id=req-a-99
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
- Heuristic AI → sostituibile con LLM provider sullo stesso contract

## Prossimo step consigliato

1. Orchestratore: tag `phase-4-complete` post PASS Phase 4  
2. Independent VERIFY Phase 5 (`5_TO_6` quando previsto)  
3. Non iniziare Phase 6 finché Phase 5 non ha PASS

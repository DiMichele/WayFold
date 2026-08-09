# PROGRESS — WayFold Compliance

## Fase corrente

**Phase 1 CLOSED (verification PASS).**  
**Phase 2 CLOSED (verification PASS)** — vedi `PHASE2-VERIFICATION.md`.  
**Phase 3 CLOSED (verification PASS)** — vedi `PHASE3-VERIFICATION.md`.  
**Phase 4 CLOSED (verification PASS)** — vedi `PHASE4-VERIFICATION.md`.  
**Phase 5 CLOSED (verification PASS)** — vedi `PHASE5-VERIFICATION.md`.  
**Phase 6 CLOSED (verification PASS)** — vedi `PHASE6-VERIFICATION.md`.  

### UI redesign (definitive mockup) — COMPLETE

- Design system WayFold Compliance (navy + purple) in `engine/ui_shell.py`
- Docs: `docs/design/DESIGN-SYSTEM.md` + mockup HTML in `docs/design/`
- Sidebar sezionata + icone SVG + localizzazione IT centralizzata
- Pagine migrate: Portfolio, Area cliente, Controlli, Gap, Control detail, Attività, Evidenze, Report, Regulatory, AI, Auto-evidence

### Hardening phase — IN PROGRESS (gate prodotto)

Priorità P0 (prima di nuove feature / dati cliente reali):
1. **Auth** — login sessione; `OPEN_ACCESS=0` in prod; `/portfolio` non pubblico
2. **Tenant isolation** — test negativi API/UI/download (già parziale in suite; da estendere)
3. **Evidence hardening** — non iniziato
4. **SSRF regulatory fetcher** — non iniziato

Completato in questo slice:
- `/login` + cookie sessione firmata (`engine/auth_session.py`)
- Produzione: `WAYFOLD_OPEN_ACCESS=0`, `WAYFOLD_ALLOW_QS_AUTH=0`
- Portfolio empty → onboarding a 4 passi + CTA (niente KPI a zero come contenuto principale)
- Fix navigazione program-scoped (redirect / select client)

Gate E2E Michele (non ancora PASS): login → programma → controlli unificati → delta PARTIAL → evidence → task → dashboard.

Prossima azione: credenziali prod + seed staging Michele + test 401/403 negativi evidence.

## Completato

- Scaffold `apps/wayfold-compliance/`
- Phase -1 discovery + scorecard (`open-source-evaluation.md`)
- Phase 0 decision gate: core **CISO Assistant Community**, Strategy B
- Phase 1 Working Core verified (`PHASE1-VERIFICATION.md` → **PASS**)
- Phase 2 Unified Compliance verified (`PHASE2-VERIFICATION.md` → **PASS**)
- Phase 3 Consultant UX verified (`PHASE3-VERIFICATION.md` → **PASS**)
- Phase 4 Regulatory Intelligence verified (`PHASE4-VERIFICATION.md` → **PASS**)
- Phase 5 AI Assistance verified (`PHASE5-VERIFICATION.md` → **PASS**)
- Phase 6 Automated Evidence verified (`PHASE6-VERIFICATION.md` → **PASS**)
  - `ProwlerJsonAdapter` (fixture-compatible; live scan ENVIRONMENT BLOCKER on Windows)
  - Connector config, normalize finding, map → canonical control (SUPPORTING)
  - `AutomatedEvidenceRecord` with provenance + human review
  - Idempotent ingest / stale on change; scanner failure isolated
  - Technical PASS does **not** mutate AppliedControl / readiness
  - UI pages su `engine/ui_shell.py` (fix verification: no generic admin shell)
  - tests: 10 OK (`test_automated_evidence`)
- Docs: `unified-compliance.md`, `consultant-ux.md`, `regulatory-watcher.md`, `ai-assistance.md`, `automated-evidence.md`, `data-model.md`

## Cosa funziona

- Core CISO Docker locale (Phase 1)
- Unified checklist / readiness / impact (Phase 2)
- Consultant UX locale `:8092` con auth esplicita
- Isolation portfolio + regulatory impact per actor tenant
- Regulatory demo cycle v1→v2 senza rete esterna
- AI suggest endpoints con gate tenant + AI disabled-by-default
- Auto-evidence ingest da fixture Prowler + review umana + shell WayFold

## Cosa non funziona / gate aperti

- Live Prowler scan non eseguibile in questo ambiente Windows (path length) — fixture adapter by design
- Provider LLM reale non configurato (heuristic locale by design overnight)
- Optimistic locking integer `version` su AppliedControl assente nel core (warning Phase 1)
- PDF/RSS/API adapters tipizzati ma senza parser specializzati (estendibili)
- Bridge post-APPROVED → CISO EvidenceRevision deferito

## Stato DB

- Core: SQLite locale compose (`vendor/.../db/`, gitignored)
- WayFold mappings + portfolio registry: overlay JSON (non nel DB core)
- Regulatory store: `engine/data/regulatory/` (gitignored runtime)
- AI store: `engine/data/ai/` (gitignored runtime)
- Automated evidence store: `engine/data/automated_evidence/` (gitignored runtime)

## Migrazioni recenti

- Nessuna migration prodotto WayFold; core CISO migrations applicate nel container
- Nessuna migration distruttiva; store regulatory/AI/auto-evidence file-based engine-side

## Comandi di avvio

```powershell
cd apps/wayfold-compliance
python -m engine.tests.test_unified_compliance
python -m engine.tests.test_consultant_ux
python -m engine.tests.test_regulatory
python -m engine.tests.test_ai
python -m engine.tests.test_automated_evidence
python -m engine --superuser --format text
python -m engine.api   # http://127.0.0.1:8092/portfolio?superuser=1
# Auto evidence: /connectors?superuser=1
#                /auto-evidence?superuser=1
#                /api/auto-evidence/ingest?superuser=1&connector_id=conn-prowler-michele-demo
```

## Git

- Remote: https://github.com/DiMichele/WayFold-Compliance
- Branch automazione: `automation/wayfold-compliance`
- `vendor/` non versionato

## Problemi aperti

- Auth Cursor Agent CLI per unattended overnight (operativo)
- `test_regulatory.test_snapshots_append_only_with_stable_hashes` flaky/hash mismatch (non legato al redesign UI; store runtime)

## UI redesign status

| Area | Stato |
|---|---|
| Design system / tokens | Done |
| App shell / sidebar / topbar | Done |
| Icone SVG navigazione | Done |
| Italian localization | Done |
| Portfolio / Client / Controls / Gaps | Done |
| Tasks / Evidence / Report | Done |
| Regulatory / AI / Auto-evidence | Done (stesso shell) |
| Control drawer (vs page) | Page restyled (drawer non forzato — dettaglio già route `/control`) |
| Kanban tasks | Non forzato (lista densa; engine task non espone colonne kanban) |
| Visual debt | Filtri ancora form classico; command palette non implementata (nascosta di proposito) |

## Technical debt

- Dedup coverage su export CISO con assessment duplicati — gestito in checklist/readiness
- pytest assente nell'immagine runtime CISO (test engine host-side)
- UX HTML locale (non fork SvelteKit CISO) — integrazione UI core deferibile
- Regulatory HTTP check on-demand (scheduler/worker persistente deferibile)
- Heuristic AI → sostituibile con LLM provider sullo stesso contract
- Live Prowler / cloud credentials → quando ambiente lo consente, stesso adapter boundary
- Eventuale drawer laterale controllo + virtualizzazione tabelle 500+ row

## Prossimo step consigliato

1. Orchestratore: FINAL REGRESSION GATE + tag `phase-6-complete` + merge su main  
2. Non sviluppare Phase 7 in questa pipeline di close

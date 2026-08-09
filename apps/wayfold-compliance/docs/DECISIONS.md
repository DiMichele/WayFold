# DECISIONS — WayFold Compliance

## [2026-08-09] Brand prodotto — solo WayFold Compliance

Scelto:
- Il nome pubblico del prodotto è **WayFold Compliance**.
- Nessuna UI, titolo browser, nginx comment rivolto all’utente, README di prodotto o copy deve presentare il motore GRC OSS (o altri vendor) come brand.
- La home pubblica (`compliance.wayfold.xyz/`) serve l’engine WayFold; l’eventuale admin UI del substrate non è esposta sul dominio prodotto.
- `WAYFOLD_OPEN_ACCESS=1` in produzione finché non esiste login prodotto WayFold.

Motivazione:
- Il core OSS era solo punto di partenza tecnico (Strategy B), non identità di prodotto.
- Allineamento all’ecosistema WayFold (Bills / wayfold.xyz).

---

## [2026-08-09] Core GRC selection — substrate OSS + Strategy B

> Nota brand: questa decisione è storica/tecnica. In UI e messaggi utente usare solo «WayFold Compliance» / «GRC core» / «substrate».

Scelto:
- **Core:** CISO Assistant Community (`intuitem/ciso-assistant-community`)
- **Strategy B:** Existing GRC Core + Wayfold Regulatory / Mapping Engine (servizi esterni via API)

Motivazione:
- Scorecard §111 (vedi `open-source-evaluation.md`): CISO vince sui criteri a peso alto (domain model fit 5, reuse 5, mapping 5, evidence/tasks 5).
- Equivalenze semantiche verificate nel codice (`backend/core/models.py`):
  - `ReferenceControl` ≈ CanonicalControl
  - `AppliedControl` ≈ ControlImplementation
  - `RequirementNode` ≈ Requirement
  - `Folder`/`Perimeter` ≈ Client / program scope (adattabile)
  - `ComplianceAssessment` ≈ assessment multi-framework
- Frameworks sono **dati** (YAML libraries), non codice — allineato a WayFold §103.1.
- API DRF/OpenAPI consente estensioni Wayfold senza fork del motore GRC.
- Regulatory monitoring assente in tutti i candidati → naturalmente **esterno** (Strategy B), non motivo per Strategy C.

Alternative considerate:
- **Probo (Strategy A/B):** Measure-centric, GraphQL/MCP eccellenti; manca layer Requirement/Canonical separato; snapshots compliance rimossi. Runner-up.
- **Unicis (Strategy A):** UX Next.js; frameworks hardcoded in TypeScript; evidence assente — scartato come core (non per preferenza linguaggio).
- **Strategy C (custom GRC):** non giustificata — nessuna capability class 4 strutturale sul dominio core in CISO.

Rivedere se:
- la demo Michele fallisce sul riuso di una singola implementazione su più framework (product blocker);
- emergono limiti di licenza/community incompatibili con uso privato;
- Probo introduce un modello Canonical/Requirement superiore e si rivaluta con nuova decisione.

---

## [2026-08-09] Specialized components roles

Scelto:
- OpenCRE → cross-framework relationships / gap analysis API
- Trestle + OSCAL → import/export / compliance-as-code (non UI)
- Prowler → Phase 6 only

Motivazione:
- Non competono come core; evitano architettura Frankenstein.

Alternative considerate:
- Incorporare OpenCRE dentro il DB CISO subito — deferito a Phase 2+.

Rivedere se:
- Phase 2 unified mapping richiede CRE graph operativo.

---

## [2026-08-09] Phase 2 mapping overlay outside CISO DB

Scelto:
- WayFold `MappingRecord` (FULL / PARTIAL / SUPPORTING + `uncovered_delta` + review_status) come overlay JSON / `ProgramSnapshot` nel package `apps/wayfold-compliance/engine/`.
- Checklist/readiness/impact come application services puri + bridge opzionale ORM CISO.
- UI Phase 2 minima: tabella HTML/JSON su `engine.api` (porta 8092), senza fork del frontend SvelteKit.

Motivazione:
- CISO espone già `ReferenceControl`/`AppliedControl` e req↔req `RequirementMapping` (FULL/PARTIAL), ma non il modello req↔canonical con SUPPORTING + delta richiesto da WayFold §19/§34.
- Strategy B: estendere via engine esterno evita fork del core e duplicazione auth/evidence/tasks.
- UI consultant densa completa è Phase 3; Phase 2 consegna la capability + vista professionale minima.

Alternative considerate:
- Patch diretta ai modelli Django CISO (fork) — scartata per costo upgrade.
- Solo `RequirementMapping` req↔req — insufficiente per checklist basata su CanonicalControl.

Rivedere se:
- CISO introduce nativamente req↔control coverage con SUPPORTING;
- serve persistenza DB dedicata engine prima di Phase 4.

---

## [2026-08-09] Phase 2 authz default-deny on engine endpoints

Scelto:
- API (`engine.api`) e CLI richiedono esplicitamente `--superuser` / `superuser=1` **oppure** `actor_tenants` / `--actor-tenants`.
- Empty actor set non implica più superuser.

Motivazione:
- Verification Phase 2: il bypass `is_superuser or not actor_tenants` violava tenant isolation + RBAC sui nuovi endpoint.

Alternative considerate:
- Token sessioni CISO pass-through subito — deferito; overlay gate resta fino a integrazione prod API.

Rivedere se:
- l'engine viene esposto dietro lo stesso IAM CISO in produzione.

---

## [2026-08-09] Phase 3 Consultant UX on engine HTML/JSON (not CISO fork)

Scelto:
- Portfolio / Client / Gaps / Owners / Deadlines / Evidence / Tasks / Reports come servizi + dense HTML su `engine.api` (:8092), riusando checklist/readiness/impact Phase 2 e snapshot programmi (Michele + Alfa registry).

Motivazione:
- Strategy B: UX consulente quotidiana senza fork del frontend SvelteKit; evidence/tasks/owners restano semanticamente quelli del core.
- Filtri e report operano su dati pinned del programma, non su KB globale.

Alternative considerate:
- Patch UI CISO (fork) — scartata per costo upgrade.
- Nuovo SPA separato — overkill per Phase 3 MVP giornaliero.

Rivedere se:
- serve embedding ufficiale nel frontend CISO o autenticazione SSO condivisa.

---

## [2026-08-09] Phase 4 Regulatory store outside CISO DB

Scelto:
- Source / SourceSnapshot / RegulatoryChange / FrameworkUpdateSuggestion persistiti in `engine/data/regulatory/` (JSON + blobs) nel package WayFold Engine.
- Pipeline deterministica `fetch → normalize → hash → compare → diff → change → impact`; review umana obbligatoria per ACCEPTED/IGNORED.
- Cosmetic HTML (normalized hash invariato) non apre change.
- Framework update = `FrameworkUpdateSuggestion` (CLONE_DRAFT) — mai publish/silent mutate delle library CISO.

Motivazione:
- Strategy B e confini DB: regulatory monitoring assente nel core; non forkare CISO per watcher.
- Demo/test con `fixture://` locale evitano dipendenza da siti esterni.
- Allineato a §52–§56 e §103.12 (watcher non muta silenziosamente framework/client).

Alternative considerate:
- Tabelle Django nel core CISO — scartate (fork + coupling).
- Scraper CSS-selector monolitico — scartato; adapter per content-type.

Rivedere se:
- serve DB PostgreSQL dedicato engine in produzione;
- Phase 5 AI analysis richiede coda/worker persistente oltre al check on-demand.

---

## [2026-08-09] Phase 5 AI via AIProvider + heuristic default

Scelto:
- `AIAssistanceService` + protocol `AIProvider` in `engine/ai/`.
- Default provider: `HeuristicAIProvider` (deterministico, no API key / no LLM esterno).
- `TenantAISettings.ai_processing_enabled = false` di default.
- Ogni output è `AISuggestion` con `AI_SUGGESTED`; approve/reject umano obbligatorio.
- Nessuna auto-applicazione a mapping/baseline/compliance CISO.

Motivazione:
- Master plan §57–§62: AI suggerisce, umano approva; prodotto utile senza AI.
- Overnight senza credenziali prodotto / senza secret LLM.
- Strategy B: store AI engine-side (`engine/data/ai/`), non fork CISO.

Alternative considerate:
- Chiamate OpenAI dirette da API handler — scartate (accoppiamento + secret).
- AI sempre on — viola default-off tenant control.

Rivedere se:
- si configura un provider LLM reale dietro lo stesso contract;
- serve coda/worker asincrona per analisi lunghe.

---

## [2026-08-09] Regulatory client impact tenant-filtered

Scelto:
- Sources / Changes inbox restano KB-level autenticati (fonte normativa globale).
- `ClientImpactReport` è filtrato server-side per `actor_tenant_ids` (fail-closed se né superuser né actor).

Motivazione:
- Verification Phase 4: senza filtro, un actor Michele poteva teoricamente vedere row Alfa su source multi-tenant.
- Allineato a tenant isolation Phase 2–3 senza trasformare le fonti ufficiali in dati per-tenant.

Alternative considerate:
- Nascondere l’intera inbox regulatory ai non-superuser — troppo restrittivo per il workflow consulente.
- Fidarsi del fatto che i link source colpiscano un solo tenant — insufficiente.

Rivedere se:
- le Sources diventano tenant-owned (multi-tenant SaaS pubblico).

---

## [2026-08-09] Production deploy in overnight pipeline

Scelto:
- Dopo Phase 6 PASS + final regression + merge su `main`, l’overnight esegue **autoDeploy** su VPS:
  - host `wayfold@167.233.121.159`
  - path `/home/wayfold/apps/wayfold-compliance`
  - dominio `https://compliance.wayfold.xyz`
  - script `deploy/deploy-compliance.ps1` (+ nginx/TLS via `setup-nginx-tls.sh`)
- Stack: substrate GRC (immagini ghcr) + engine WayFold Compliance su `:18092` come UI pubblica `/`
- Nessun deploy del prodotto viaggi (`deploy/deploy.ps1`) da questa pipeline.

Motivazione:
- DNS già punta al VPS; senza deploy+cert il browser mostra `ERR_CERT_COMMON_NAME_INVALID` (cert di bills).

Rivedere se:
- si separa un repo/deploy host dedicato.

---

## [2026-08-09] Visual language — allineamento ecosistema WayFold (Bills)

Scelto:
- L’UI WayFold Compliance (engine HTML consultant) **deve** usare la stessa visual language di `apps/wayfold-bills`:
  - palette charcoal `#1A242B` · sage `#98A9A2` · terracotta `#D97B5C` · sand `#D9C5A0` · bg `#F7F6F3`
  - tipografia **Jost** (display) / **Inter** (UI) / **DM Mono** (label)
  - shell condiviso in `engine/ui_shell.py`
- Vietato introdurre temi generici “admin blue/gray”, purple-on-white, o stili CISO grezzi sulle superfici WayFold.
- Il frontend CISO upstream può restare invariato; le viste WayFold (portfolio/checklist/regulatory/AI) passano dallo shell brand.

Motivazione:
- Coerenza di prodotto nell’ecosistema WayFold (viaggi / bills / compliance).

Rivedere se:
- nasce un design-system package condiviso a livello monorepo.

---

## [2026-08-09] Phase 6 Automated Evidence via Prowler JSON adapter + fixture

Scelto:
- Package `engine/automated_evidence/` con boundary `ScannerAdapter` → `NormalizedFinding` → mapping SUPPORTING → `AutomatedEvidenceRecord`.
- Adapter **Prowler JSON** (fixture-compatible). Live Prowler scan non eseguito qui (ENVIRONMENT BLOCKER Windows path length, già in open-source-evaluation).
- Evidence type semantico `EXTERNAL_REFERENCE` con provenance; store engine-side `engine/data/automated_evidence/`.
- Human review obbligatoria; technical PASS **non** muta `AppliedControl` / readiness / baseline.
- Credenziali solo come `credential_ref` (nome env var), mai inline nel codice/store.

Motivazione:
- DECISIONS precedenti: Prowler = Phase 6 specialized component, non core.
- Master plan §98 + phase-06-develop: non inventare un nuovo CSPM; non trasformare la fase in progetto cloud-security infinito.
- Strategy B: riuso concetto Evidence del core senza fork DB; overnight senza secret cloud.

Alternative considerate:
- Eseguire Prowler live in CI overnight — bloccato da environment Windows.
- Scrivere findings direttamente nelle tabelle Evidence CISO — scartato (coupling + silent mutate).
- Auto-set status IMPLEMENTED su PASS tecnico — viola Unified Compliance (SUPPORTING only).

Rivedere se:
- ambiente Linux/CI consente export Prowler reale sullo stesso adapter;
- serve bridge API CISO per materializzare EvidenceRevision dopo APPROVED.

---

## [2026-08-09] Nessun credential di accesso prodotto (temporaneo)

Scelto:
- **Per il momento** WayFold Compliance **non** deve richiedere / introdurre dati di accesso utente di prodotto (login proprietario WayFold, password utente finali, SSO, invite email, secret di onboarding cliente).
- L’automazione e lo sviluppo delle fasi devono procedere **senza** chiedere all’operatore nuove credenziali di accesso all’app.
- Restano ammessi solo:
  - auth tecnica già esistente del **core CISO locale** per demo/dev (es. admin demo sulla macchina);
  - auth Cursor / Git già configurate per l’overnight (non sono login prodotto Compliance).

Motivazione:
- Evitare blocchi overnight e scope creep su identity prima che il prodotto sia stabile.
- Phase 1–3 devono concentrarsi su GRC / unified compliance / UX consulente, non su un nuovo IdP WayFold.

Vietato per ora:
- inventare o richiedere password/utenti di produzione;
- aggiungere flussi di registrazione/login WayFold obbligatori;
- bloccare una fase perché “mancano le credenziali di accesso Compliance”.

Rivedere quando:
- si introduce un ambiente condiviso o `compliance.wayfold.xyz` con utenti reali;
- serve RBAC multi-consulente oltre al modello CISO già riusato.

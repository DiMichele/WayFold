# DECISIONS — WayFold Compliance

## [2026-08-09] Core GRC selection — CISO Assistant + Strategy B

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

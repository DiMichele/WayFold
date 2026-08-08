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

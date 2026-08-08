# Architecture — WayFold Compliance (Phase 6)

## Selected core

**CISO Assistant Community** — Django/DRF backend + SvelteKit frontend + PostgreSQL (compose ufficiale; locale demo anche SQLite).

Dominio previsto: `compliance.wayfold.xyz` (non deployato da questa pipeline).

## Strategy B

```text
compliance.wayfold.xyz
        │
        ▼
┌───────────────────────┐
│ Compliance UI         │  CISO frontend (+ WayFold consultant UX :8092)
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ GRC CORE              │  CISO Assistant
│ Folders/Perimeters    │
│ Frameworks/Libraries  │
│ RequirementNodes      │
│ ReferenceControls     │
│ AppliedControls       │
│ Assessments           │
│ Evidence / Tasks      │
│ IAM / RBAC            │
└───────────┬───────────┘
            │ REST/OpenAPI (prod) / ORM bridge (local demo)
            ▼
┌───────────────────────┐
│ WAYFOLD ENGINE        │  apps/wayfold-compliance/engine
│ Unified checklist     │  Phase 2
│ Mapping FULL/PARTIAL/ │
│   SUPPORTING + delta  │
│ Framework readiness   │
│ Control impact / ROI  │
│ Tenant access gate    │
│ Portfolio / Client UX │  Phase 3
│ Gap / Owner / Deadline│
│ Evidence / Task / Rpt │
│ Regulatory Sources    │  Phase 4
│ Snapshots / Diff      │
│ Change inbox / Impact │
│ AIProvider + assist   │  Phase 5 (suggest only)
│ Automated evidence    │  Phase 6 (Prowler/fixture → SUPPORTING)
└───────────────────────┘
```

## Database boundaries

- **Core DB:** PostgreSQL gestito da CISO (unico source of truth GRC operativo).
- **Wayfold Engine:** overlay JSON for mapping intelligence + `engine/data/regulatory/` for Source/Snapshot/Change + `engine/data/ai/` for suggestions/settings + `engine/data/automated_evidence/` for connectors/findings; niente silent mutation delle library pubblicate nel core.

## API boundaries

- Wayfold Engine in produzione **legge/scrive** il core solo tramite API documentata (DRF).
- Local overnight: `ciso_bridge.py` può leggere l'ORM CISO per export snapshot (non muta library pubblicate).
- Nessun accesso diretto al DB core dal regulatory engine in produzione.
- OpenCRE (se usato) è servizio read-oriented per suggerimenti mapping; approvazione umana obbligatoria.

## Storage

- Evidence files: storage CISO (EvidenceRevision attachments).
- Automated technical evidence (Phase 6): engine store + EXTERNAL_REFERENCE provenance; bridge to CISO EvidenceRevision deferibile post-APPROVED.
- Regulatory raw snapshots: object storage / filesystem del Wayfold Engine (futuro).

## Deployment (target)

- Stack CISO via Docker Compose dietro reverse proxy verso `compliance.wayfold.xyz`.
- Wayfold Engine come servizio aggiuntivo (compose profile o host separato); checklist UI locale `:8092` in Phase 2.
- Pattern operativo simile a Bills (`apps/wayfold-bills/deploy/`) ma **separato** dal deploy viaggi.

## Semantic map (do not rename in DB)

| WayFold product language | CISO entity |
|---|---|
| Client | Folder (DOMAIN) and/or Perimeter |
| Compliance Program | Campaign + ComplianceAssessment set |
| Canonical Control | ReferenceControl |
| Control Implementation | AppliedControl |
| Requirement | RequirementNode |
| Framework Version | LoadedLibrary.version (+ Framework.library pin) |

## Phase 2–6 engine notes

- Canonical reuse: `ReferenceControl` / `canonical_control_ref` — no duplicate control tables in core.
- Req↔Control coverage relations live in WayFold `MappingRecord` overlay (CISO `RequirementMapping` remains req↔req).
- Client implementations, evidence, tasks stay in CISO; Phase 3 views aggregate snapshot counts.
- Consultant UX: dense HTML/JSON on `:8092` (not a CISO frontend fork).
- Phase 4 regulatory pipeline is engine-local; framework suggestions never auto-publish into CISO.
- Phase 5 AI goes only through `AIAssistanceService` / `AIProvider`; tenant default AI off; human review mandatory.
- Phase 6 automated evidence uses `ScannerAdapter` (Prowler JSON/fixture); SUPPORTING signals only; human review; no auto-compliance.
- See `docs/unified-compliance.md`, `docs/consultant-ux.md`, `docs/regulatory-watcher.md`, `docs/ai-assistance.md`, `docs/automated-evidence.md`, `docs/data-model.md`.

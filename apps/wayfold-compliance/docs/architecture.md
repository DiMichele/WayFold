# Architecture — WayFold Compliance (Phase 2)

## Selected core

**CISO Assistant Community** — Django/DRF backend + SvelteKit frontend + PostgreSQL (compose ufficiale; locale demo anche SQLite).

Dominio previsto: `compliance.wayfold.xyz` (non deployato da questa pipeline).

## Strategy B

```text
compliance.wayfold.xyz
        │
        ▼
┌───────────────────────┐
│ Compliance UI         │  CISO frontend (+ WayFold checklist UI :8092)
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
│ Regulatory (Phase 4+) │
│ AI assist (Phase 5)   │
└───────────────────────┘
```

## Database boundaries

- **Core DB:** PostgreSQL gestito da CISO (unico source of truth GRC operativo).
- **Wayfold Engine:** overlay JSON / future DB for mapping intelligence + regulatory snapshots (Phase 4+); niente silent mutation delle library pubblicate nel core.

## API boundaries

- Wayfold Engine in produzione **legge/scrive** il core solo tramite API documentata (DRF).
- Local overnight: `ciso_bridge.py` può leggere l'ORM CISO per export snapshot (non muta library pubblicate).
- Nessun accesso diretto al DB core dal regulatory engine in produzione.
- OpenCRE (se usato) è servizio read-oriented per suggerimenti mapping; approvazione umana obbligatoria.

## Storage

- Evidence files: storage CISO (EvidenceRevision attachments).
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

## Phase 2 engine notes

- Canonical reuse: `ReferenceControl` / `canonical_control_ref` — no duplicate control tables in core.
- Req↔Control coverage relations live in WayFold `MappingRecord` overlay (CISO `RequirementMapping` remains req↔req).
- Client implementations, evidence, tasks stay in CISO.
- See `docs/unified-compliance.md` and `docs/data-model.md`.

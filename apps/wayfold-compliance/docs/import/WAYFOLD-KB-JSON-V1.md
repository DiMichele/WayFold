# WayFold Knowledge Base JSON v1

Exchange format only — not the runtime database.

## Packages

- **Framework** — `schemas/wayfold-kb-framework-v1.schema.json`
- **Canonical controls** — `schemas/wayfold-kb-controls-v1.schema.json`
- **MappingSet** — `schemas/wayfold-kb-mappings-v1.schema.json`
- **Client overlay** — `schemas/wayfold-client-overlay-v1.schema.json`

## Rules

- Imported framework versions are always **DRAFT** until metadata complete and publish gate passes.
- `metadataStatus: INCOMPLETE` blocks publish when mandatory fields missing.
- Legacy Excel converts to the same JSON shape via `engine.importers.multicompliance`.
- IDs are stable (hash-based) per source row identity, not random UUIDs.

## API

- Import UI: `/kb/import`
- Export: `GET /api/kb/export?version_id=...`
- Create snapshot: `POST /api/report/snapshots` (JSON `program_id`)

## Provenance

Every package should include `importSource` / `importBatchId` / `sha256` / `sheet` / `sourceRow` where applicable.

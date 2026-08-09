# ADR: MappingSet versioning vs FrameworkVersion

## Status

Accepted (design); implementation deferred beyond minimal hooks.

## Context

A **FrameworkVersion** tracks the normative source (e.g. NIS2 2026.1). A **MappingSet** tracks WayFold-authored links between requirements and canonical controls (revision 1, 2, 3…).

Improving mappings (e.g. PARTIAL → FULL, better delta) does not always imply a new normative edition. Coupling mapping edits to `framework_version` bumps forces artificial `2026.2` labels when the official text unchanged.

## Decision

Target model:

```
FrameworkVersion (normative pin)
    └── MappingSet revision N (DRAFT → review → APPROVED)
Program baseline = FrameworkVersion + approved MappingSet revision
```

Interim (current slice): keep existing `framework_versions.json` + `kb_mappings.json` stores but **do not deepen** version↔mapping coupling. Legacy imports produce **DRAFT** framework packages and **NEEDS_REVIEW** mapping candidates only.

## Consequences

- Publish gate checks metadata + blocking quality issues, not mapping revision alone.
- Program assignment must eventually store `mappingSetRevision` alongside `frameworkVersionId`.
- Migration: add `mapping_set_id` + `revision` columns; backfill revision `1` for approved rows.

## Migration plan (summary)

1. Introduce `MappingSet` entity in core gateway (Slice F).
2. UI: canonicalization workspace approves into a revision, not into framework version bump.
3. Readiness/checklist continue to use **APPROVED** mappings only.

# Data model — WayFold Compliance

## Core (CISO Assistant — reuse, do not duplicate)

| Entity | Role |
|---|---|
| `Folder` (DOMAIN) | Client / tenant boundary |
| `Perimeter` | Compliance program / scope |
| `LoadedLibrary` + `version` | Framework package + pin |
| `Framework` | Loaded framework instance |
| `RequirementNode` | Requirement (hierarchy via parent_urn) |
| `ReferenceControl` | Canonical / common control |
| `AppliedControl` | Client control implementation |
| `ComplianceAssessment` | Assessment bound to one Framework |
| `RequirementAssessment` | Per-requirement assessment row |
| `Evidence` / `EvidenceRevision` | Evidence |
| `TaskTemplate` / `TaskNode` | Remediation tasks |
| `User` / `Role` / `RoleAssignment` | AuthZ scoped by folder |

Semantic aliases (product language only — no DB rename):

- CanonicalControl → ReferenceControl  
- ControlImplementation → AppliedControl  
- Client → Folder DOMAIN  
- ComplianceProgram → Perimeter (+ Campaign optional)

## WayFold Engine overlay (Phase 2)

Stored outside the core DB (JSON snapshots / future engine DB):

| Concept | Fields (conceptual) |
|---|---|
| `MappingRecord` | requirement_id, framework_id/version, canonical_control_ref, relation FULL\|PARTIAL\|SUPPORTING, rationale, uncovered_delta, review_status |
| `ProgramSnapshot` | tenant, program, requirements[], implementations[], mappings[], requirement_implementation_links |
| `UnifiedChecklist` | deduplicated controls + unmapped[] |
| `FrameworkReadinessRow` | FULLY_COVERED / PARTIALLY_COVERED / NOT_COVERED / UNMAPPED / NOT_APPLICABLE counts + implementation_readiness |
| `ControlImpactRow` | readable impact summary (requirements × frameworks × open gaps) |

## WayFold Regulatory store (Phase 4)

Persisted under `engine/data/regulatory/` (not CISO DB):

| Concept | Role |
|---|---|
| `Source` | Configured monitored origin (HTML/JSON/FILE/…) + linked framework/requirement anchors |
| `SourceSnapshot` | Fetched raw + normalized content refs + content/normalized hashes |
| `RegulatoryChange` | Diff inbox (`NEW` → `ACCEPTED`/`IGNORED`) with relevance SUBSTANTIVE/COSMETIC |
| `FrameworkUpdateSuggestion` | Human workflow `CLONE_DRAFT` — no auto-publish |
| `ClientImpactReport` | Projection onto pinned programs via mappings (advisory) |

## Boundaries

- Global KB (libraries, reference controls, published frameworks) ≠ client workspace (applied controls, evidence, tasks).  
- Engine reads core via ORM bridge or API; does not silently mutate published libraries.  
- Tenant isolation enforced in core IAM and re-checked by `engine.authz` before checklist responses.
- Regulatory watcher never silently changes framework data or client baselines.

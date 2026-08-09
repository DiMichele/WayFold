# IMPORT SECURITY

- Do not commit the original MultiCompliance workbook to a public repository.
- Client overlay columns (Owner, Contratto, Attività, Raccomandazione, evidence) stay in overlay packages with `doNotImportToGlobalKb: true`.
- Import wizard stages files under `data/import_staging/` (runtime only).
- Admin password is never written to manifests, screenshots, or import JSON.

## HUMAN_ACTION_REQUIRED — PURGE_GIT_HISTORY

If `docs/Matrice_MultiCompliance.xlsx` appears in public git history, purge with filter-repo/BFG and rotate any exposed client data. Current tree: file gitignored; use `.local/import-source/` privately.

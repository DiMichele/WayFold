# KB SOURCE PROVENANCE

- **Kind:** Legacy / internal workbook (not official regulatory publication).
- **File:** `Matrice_MultiCompliance.xlsx`
- **Private path:** `WAYFOLD_IMPORT_SOURCE_DIR` or `.local/import-source/` (gitignored).
- **CI fixture:** `engine/fixtures/import/multicompliance_sanitized.xlsx` (structure preserved; client fields blanked).

Each imported requirement/question carries:

- `importSource.sha256`
- `importBatchId`
- `sheet`
- `sourceRow`
- `sourceCode`

## HUMAN_ACTION_REQUIRED

If the real workbook was previously committed to a public remote:

`PURGE_GIT_HISTORY` — remove `docs/Matrice_MultiCompliance.xlsx` from git history (BFG/filter-repo). Not performed automatically (no force push/history rewrite).

# KB INITIAL IMPORT REPORT

Source: Matrice_MultiCompliance.xlsx (legacy/internal — private path).  
Converter: `python -m engine.importers.multicompliance convert --input <path> --output <dir>`

## Source counts (verified)

| Area | Source rows | Distinct codes | Notes |
|------|-------------|----------------|-------|
| ISO Annex A | 93 | 93 | Organizzativo 37, Personale 8, Fisico 14, Tecnologico 34 |
| ISO clauses | partial | — | SOURCE_PARTIAL; not invented |
| Reg.Cloud | 808 | 91 | |
| NIS2 | 117 | 50 | |
| PSNC | 133 | 58 | |
| CSA STAR | 0 | 0 | Skipped — NO_SOURCE_DATA |

## Normalized (imported)

| Framework | Requirements | Assessment questions | Version status |
|-----------|--------------|----------------------|----------------|
| ISO/IEC 27001 | 93 CONTROL + partial CLAUSE | 0 | DRAFT / METADATA_INCOMPLETE |
| Reg.Cloud | 91 | 808 | DRAFT |
| NIS2 | 50 | 117 | DRAFT |
| PSNC | 58 | 133 | DRAFT |

Source status: `SOURCE_UNVERIFIED` (legacy Matrice MultiCompliance).  
No automatic publish. No auto canonical controls. Mapping candidates: NEEDS_REVIEW only.

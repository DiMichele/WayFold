# Matrice_MultiCompliance — source analysis

Primary file: `docs/Matrice_MultiCompliance.xlsx` (do not edit).  
Converter: `python -m engine.importers.multicompliance analyze --input <path>`.

## Sheets

| Sheet | Classification | Notes |
|--------|----------------|-------|
| Matrice_Multicompliance Corp. | ISO_CORPORATE | Annex A + incomplete Norma |
| Matrice_Multicompliance Buss. | BUSINESS_FRAMEWORKS | Reg.Cloud, NIS2, PSNC, CSA columns |
| Azioni PTR Business Open - NO M | CLIENT_REMEDIATION | Not KB |
| Foglio1 | PSNC_STAGING_REFERENCE | Cross-check only |
| OLD_Matrice Multi-Compliance | LEGACY_REFERENCE_ONLY | Not imported |
| Foglio2 | IGNORE | |

## Counts (automated, fixture file)

| Area | Rows / codes | Review expectation |
|------|----------------|-------------------|
| ISO Annex A (Corp., with title) | **96** | ~93 Annex A controls |
| Reg.Cloud (with Quesito/Descrizione) | **808** rows, **91** codes | ~697 / ~90 |
| NIS2 | **117** rows, **50** codes | ~117 / ~50 |
| PSNC | **133** rows, **58** codes | ~133 / ~58 |
| CSA STAR populated | **0** | 0 |

Reg.Cloud row count includes rows with both code and question text; stricter “effective” filters may be applied in a later pass. CSA: stub only (`NO_SOURCE_DATA`).

## Layer classification (Business sheet)

| Global KB | Guidance | Client overlay |
|-----------|----------|----------------|
| Reg.Cloud / NIS2 / PSNC IDs, Quesito, Descrizione, Opzioni, L1–L4, Infra/IaaS/PaaS | Evidenza esempio* columns | Politica di Riferimento, Contratto, Owner, Periodicita, Attivita, Raccomandazione |
| | | Columns 29–30 unnamed → `UNNAMED_LEGACY_FIELD_29/30` |

## Quality themes

- `MISSING_SCOPE` on Corp./Business rows without Ambito
- `INCOMPLETE_FRAMEWORK` for ISO Norma section
- `UNNAMED_COLUMN` for AD/AE (indexes 29–30)
- Legacy row alignment → `legacy-crosswalk-candidates.json` with `NEEDS_REVIEW` (never FULL)

## PSNC cross-check

Foglio1 vs Business PSNC: see `analysis.json` → `psnc_crosscheck` from converter output (`docs/import/sample-output/analysis.json`).

## SHA-256

Computed at analyze time; stored in `importSource.sha256` on all packages.

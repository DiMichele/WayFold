# PRODUCTION OPERATING GUIDE

Login: credentials configured at deploy (change via **Profilo → Cambia password** when ready).

## Knowledge Base

1. **Framework e normative** → **+ Nuovo framework** or **Importa**
2. Import wizard: Caricamento → Analisi → Metadata → Verifica → Importa come bozza
3. Completa metadata → edit requirements → review mappings → **Pubblica** (confirm unmapped)
4. **Esporta ▾** for JSON v1

## Requirements (DRAFT)

- + Nuovo requisito / edit / delete (impact shown if mappings/children)
- Pagination 25/50/100 + search
- PUBLISHED is read-only → Nuova versione

## Mappings

- Tabs: Approvate / Da revisionare / Non mappati
- Legacy candidates: Da revisionare (not readiness)
- Approve with relation FULL/PARTIAL/SUPPORTING + rationale (+ delta if PARTIAL)
- Create or link canonical control — never auto-generate 1:1 from import

## Client workflow

1. Clienti → + Nuovo cliente  
2. + Nuovo programma → select PUBLISHED FrameworkVersion(s)  
3. Generate unified checklist → controls → gap → evidence → tasks → report  

## Backup

`deploy/production-cleanup-import.sh` or copy `data/*.json`, `programs/`, `evidence/`.

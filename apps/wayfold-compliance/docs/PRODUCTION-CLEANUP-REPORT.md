# PRODUCTION CLEANUP REPORT

Date: 2026-08-09  
Marker removed: `WF_REVIEW_DEMO_2026` / `[Demo]`

## Procedure

1. Backup `data/` stores → `data/backups/pre-cleanup-*` (not committed).
2. `python -m engine.demo_cleanup --data-dir <DATA> --out DEMO-DATA-CLEANUP-PLAN.json --apply`
3. Import KB from converted MultiCompliance packages (ISO, Reg.Cloud, NIS2, PSNC). CSA skipped.
4. Post-import backup.

## Rules

- Only DELETE items with clear demo markers.
- `PRESERVE_REVIEW_REQUIRED` for unmarked records.
- `WAYFOLD_SEED_REVIEW_DEMO=0` (production default).
- admin/admin left unchanged until user rotates via Profilo.

## Plan artifact

`DEMO-DATA-CLEANUP-PLAN.json` (gitignored under data/).

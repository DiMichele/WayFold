# Final Review URL Manifest

Base: https://compliance.wayfold.xyz/  
Dataset: `WF_REVIEW_DEMO_2026`  
Temporary review login: `admin` / `admin` (TEMPORARY REVIEW CREDENTIAL)

| Page | Live URL | Required role | Expected dataset/context | Screenshot |
|---|---|---|---|---|
| Login | `/login` | anonymous | form Accedi | `01-login.png` |
| Portfolio | `/portfolio` | CONSULTANT/SUPER_ADMIN | 5 client demo + Action Center | `02-portfolio.png` |
| Clienti | `/clients` | authenticated | directory 5 client | `03-clients.png` |
| Michele workspace | `/client?program_id=program-michele-cyber-2026` | assigned | Cyber Compliance 2026 | `04-michele-workspace.png` |
| Unified Controls | `/checklist?program_id=program-michele-cyber-2026` | assigned | 8 controlli, CTRL-IAM-001 once | `05-unified-controls.png` |
| Control IAM | `/control?program_id=program-michele-cyber-2026&control_ref=CTRL-IAM-001` | assigned | FULL/PARTIAL + delta | `06-control-iam-detail.png` |
| Gap Assessment | `/gaps?program_id=program-michele-cyber-2026` | assigned | requisiti con problemi + finding | `07-gap-assessment.png` |
| Tasks | `/tasks?program_id=program-michele-cyber-2026` | assigned | TASK-001… | `08-tasks.png` |
| Evidence | `/evidence?program_id=program-michele-cyber-2026` | assigned | EV-001… + download | `09-evidence.png` |
| Frameworks | `/frameworks` | KB read | NIS2 / ISO / PSNC | `10-frameworks.png` |
| Framework NIS2 | `/frameworks/detail?framework_id=fw-nis2-it-2026-1` | KB read | versions + requirements | `11-framework-nis2-detail.png` |
| Mappings | `/mappings?program_id=program-michele-cyber-2026` | assigned | FULL/PARTIAL/SUPPORTING | `12-mappings.png` |
| Regulatory | `/changes` | authenticated | demo sources/changes | `13-regulatory.png` |
| Report | `/report?program_id=program-michele-cyber-2026` | assigned | disclaimer + baselines | `14-report.png` |
| Settings | `/settings` | authenticated | users/AI/security | `15-settings.png` |
| Audit log | `/audit` | AUDIT_READ | registro attività | `16-audit-log.png` |

Screenshots path: `apps/wayfold-compliance/docs/review/final/`

# Product Acceptance Review

## Environment

| Field | Value |
|---|---|
| URL | https://compliance.wayfold.xyz/ |
| Seed version | `2026.08.09-review-1` |
| Dataset marker | `WF_REVIEW_DEMO_2026` |
| Seed command | `python -m engine.seed_review_demo --data-dir <WAYFOLD_DATA_DIR>` |
| Live verified | **YES** (2026-08-09) |
| Build | Engine Python modules + Docker compose prod |

## Authentication

**PASS**

- Unauthenticated `/` → `302 /login?next=/`
- Login `admin` / `admin` → Portfolio
- Cookie session HttpOnly + SameSite=Lax + Secure (prod)

## Portfolio

**PASS**

- 5 client demo visibili
- Metriche non-zero (gap / overdue / unmapped > 0)
- Readiness differenziata per client

## Clients

**PASS**

- Michele / Alfa / Beta / Nova / Delta presenti con suffisso `[Demo]`

## Client Workspace

**PASS**

- Michele → Cyber Compliance 2026
- Scope, 3 framework pinned, stati implementazione, scadenze, impact

## Unified Controls

**PASS**

- 8 controlli unificati
- `CTRL-IAM-001` una sola volta
- Coverage ISO Completa / NIS2 Completa / PSNC Parziale + delta

## Gap Assessment

**PASS**

- 19 righe Michele
- PSNC-06 filtrabile come Non mappato
- Partial / implementation gaps presenti

## Tasks

**PASS**

- TASK-001…008 visibili
- Stati Da fare / In corso / In revisione / Completata
- TASK-001 flag In ritardo

## Evidence

**PASS** (catalogo nominato overlay)

- EV-001…008 + shared evidence
- Stati Valida / Parziale / Da revisionare / In scadenza
- **MISSING**: download file binario protetto (solo catalogo/metadata nel layer attuale)

## Frameworks

**PARTIAL**

- Versioni pinned visibili su client/checklist
- Banner “Nuova versione framework disponibile” (NIS2 2026.2)
- **MISSING**: pagina KB framework dedicata / publish UI

## Mappings

**PARTIAL**

- Mapping FULL/PARTIAL/SUPPORTING visibili in checklist + control detail
- **MISSING**: pagina mapping matrix dedicata

## Regulatory Intelligence

**PASS** (demo fixture)

- Sources demo seedate (ACN / EUR-Lex / ENISA + cycle NIS2 fixture)
- UI Fonti / Intelligence normativa disponibili

## Reports

**PASS** (engine report HTML/CSV esistente)

- Route `/report` presente

## Settings

**PARTIAL**

- Impostazioni AI disponibili
- **MISSING**: settings RBAC/tenant generali

## Audit

**NOT IMPLEMENTED**

- Nessun audit log UI prodotto WayFold nel layer corrente

## RBAC

**PARTIAL**

- Gate tenant su API/portfolio con `actor_tenants` (test unitari PASS)
- Sessione login consultant è superuser globale
- **MISSING**: utenti fixture multi-ruolo (CLIENT_ADMIN_A/B, VIEWER, …) sul login prodotto

## Tenant Isolation

**PASS** (engine portfolio/API con actor tenants)

- Portfolio filtra per tenant
- Test negativi unitari PASS
- **FINDING**: sessione `admin` vede tutti i tenant (by design consultant superuser)

## Evidence Authorization

**PARTIAL / NOT APPLICABLE for binaries**

- Nessun endpoint download file evidence demo
- Isolamento dati evidence a livello program snapshot / tenant filter

## Framework Version Pinning

**PASS**

- Michele pinned a NIS2 `2026.1` con `2026.2` DRAFT non assegnata

## Published Version Immutability

**NOT IMPLEMENTED**

- Nessuna UI edit di library PUBLISHED nel prodotto corrente (substrate non esposto)

## Tests

| Suite | Result |
|---|---|
| `test_review_demo` | PASS (11) |
| `test_unified_compliance` | PASS (13) |
| `test_consultant_ux` | PASS (10) |
| `test_ui_design_system` | PASS (5) |
| `test_ai` | PASS (10) |
| `test_automated_evidence` | PASS (10) |
| `test_auth_session` | PASS (3) |
| `test_regulatory` | PARTIAL — 1 flaky hash preesistente documentato |
| Browser live Michele workflow | PASS |
| Playwright package | NOT PRESENT — E2E via unittest + browser live |

## Findings

### P0 — SECURITY / DATA INTEGRITY

| ID | Description | Expected | Actual | Recommended fix |
|---|---|---|---|---|
| F-P0-01 | Credenziale temporanea `admin/admin` per review | Credenziali forti prima di dati cliente reali | Login review attivo | Ruotare prima di REAL CLIENT DATA — severity **P0 BEFORE REAL CLIENT DATA** |
| F-P0-02 | Sessione consultant = superuser globale | RBAC per-tenant in produzione multi-cliente | Admin vede tutti i tenant demo | Introdurre actor_tenants in sessione / ruoli |

### P1 — BLOCKING PRODUCT WORKFLOW

| ID | Description | Notes |
|---|---|---|
| F-P1-01 | Download evidence binario + authz URL | Catalogo overlay OK; file storage protetto MISSING |
| F-P1-02 | Sidebar nav a volte non porta il `program_id` nel click browser | Workaround: link con query program_id; da harden |

### P2 — IMPORTANT UX / FUNCTIONAL

| ID | Description |
|---|---|
| F-P2-01 | Impact summaries ancora in inglese (`Impacts N requirements…`) |
| F-P2-02 | Pagina Framework KB / Mapping matrix dedicata assente |
| F-P2-03 | Audit log prodotto assente |
| F-P2-04 | Published immutability non esercitabile in UI prodotto |

### P3 — POLISH

| ID | Description |
|---|---|
| F-P3-01 | Label “Remediation” in eyebrow tasks (EN) |
| F-P3-02 | CSP non osservata negli header nginx (HSTS/XFO/XCTO presenti) |

## Security gate

```text
READY FOR EXTERNAL REVIEW: YES
READY FOR REAL CLIENT DATA: NO
```

Blocca REAL CLIENT DATA: F-P0-01, F-P0-02, evidence binary authz, RBAC multi-ruolo.

## Live Michele workflow checklist

- [x] login admin/admin
- [x] Portfolio 5 client
- [x] Michele → Cyber Compliance 2026
- [x] 3 framework
- [x] Unified controls, CTRL-IAM-001 once
- [x] Detail IN_PROGRESS / Luca / 7 ago 2026
- [x] ISO FULL, NIS2 FULL, PSNC PARTIAL + delta
- [x] Evidence ≥3 + shared
- [x] Task overdue
- [x] Gaps PSNC-06 unmapped
- [x] no 500 nel workflow critico

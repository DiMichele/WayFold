# WayFold Compliance

Applicativo privato GRC multi-framework per consulenza cybersecurity.

- Dominio previsto: `compliance.wayfold.xyz`
- Repository: [DiMichele/WayFold-Compliance](https://github.com/DiMichele/WayFold-Compliance)
- Stato: **Phase 1 PASS** · **Phase 2 IMPLEMENTATION FINISHED — AWAITING INDEPENDENT VERIFICATION**
- Raccomandazione: [`docs/PHASE0-RECOMMENDATION.md`](docs/PHASE0-RECOMMENDATION.md)
- Unified Compliance: [`docs/unified-compliance.md`](docs/unified-compliance.md)
- Progress: [`docs/PROGRESS.md`](docs/PROGRESS.md)

## Decisione Phase 0

- **Core:** CISO Assistant Community
- **Strategy B:** GRC Core + Wayfold Regulatory Engine (servizi esterni via API)

## Layout

```text
.
  docs/         stato, decisioni, evaluation, architecture, recommendation
  engine/       WayFold Unified Compliance (Phase 2)
  automation/   orchestratore fasi (overnight)
  prompts/      prompt Cursor per fasi 1–6
  vendor/       clone OSS (gitignored) — solo macchina locale
```

## Avvio core locale (post Phase 0)

Vedi comandi in `docs/PROGRESS.md`.

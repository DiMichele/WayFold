# UI — WayFold Compliance

## Principio

La superficie pubblica è **WayFold Compliance** (engine su produzione: `/`).

Stessa visual language di **WayFold Bills** / wayfold.xyz. Nessun nome di vendor in titoli o copy rivolto all’utente.

## Lingua e tema

- Default: **italiano**
- Toggle **IT/EN** in header (query `?lang=`)
- Toggle **chiaro/scuro** in header (localStorage `wf-theme`, allineato a Bills)

## Token

Vedi `engine/ui_shell.py` (allineati a `apps/wayfold-bills/apps/web/src/app/globals.css`):

| Token | Valore |
|---|---|
| bg | `#F7F6F3` / dark `#141A1F` |
| ink / charcoal | `#1A242B` |
| accent terracotta | `#D97B5C` |
| sage | `#98A9A2` |
| sand | `#D9C5A0` |
| display | Jost |
| ui | Inter |
| mono | DM Mono |

## Shell

```python
from engine.ui_shell import render_shell
from engine.i18n import t

html = render_shell(title, nav_qs, body, lang="it")
```

Nuove pagine: **sempre** `render_shell` + stringhe da `engine/i18n.py`.
